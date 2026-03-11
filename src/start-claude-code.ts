import { query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { createReadStream, existsSync } from "fs";
import { execSync } from "child_process";
import { readdir, stat } from "fs/promises";
import { createInterface } from "readline";
import { join } from "path";
import { homedir } from "os";
import {
  emitEvent,
  scheduleCleanup,
  type SessionStore,
} from "./server-common";

export async function initAgent(): Promise<boolean> {
  try {
    execSync("claude --version", { stdio: "ignore" });
    return true;
  } catch {
    console.warn("  claude CLI not found — claude-code agent unavailable");
    return false;
  }
}

export async function runAgent(store: SessionStore): Promise<void> {
  const abortController = new AbortController();
  store.abortController = abortController;

  try {
    const q = query({
      prompt: [...store.events].reverse().find(e => e.type === "user_prompt")?.prompt as string ?? "",
      options: {
        model: "claude-opus-4-6",
        permissionMode: "default",
        abortController,
        includePartialMessages: true,
        cwd: store.repoPath,
        ...(store.sdkSessionId ? { resume: store.sdkSessionId } : {}),
        canUseTool: (toolName, input, { signal, toolUseID, decisionReason }) => {
          console.log(`[canUseTool] tool=${toolName} id=${toolUseID} reason=${decisionReason}`);
          return new Promise((resolve) => {
            store.pendingPermissions.set(toolUseID, { resolve, input, toolName, toolUseID });
            emitEvent(store, "permission_request", { toolUseID, toolName, input });

            signal.addEventListener("abort", () => {
              const p = store.pendingPermissions.get(toolUseID);
              if (p) {
                store.pendingPermissions.delete(toolUseID);
                p.resolve({ behavior: "deny", message: "Request aborted" });
              }
            }, { once: true });
          });
        },
      },
    });

    try {
      for await (const msg of q) {
        if (msg.type === "system" && msg.subtype === "init") {
          const newSdkId = (msg as any).session_id;
          if (newSdkId && !store.sdkSessionId) {
            store.sdkSessionId = newSdkId;
          }
        }

        const payload = formatMessage(msg);
        if (payload) {
          const items = Array.isArray(payload) ? payload : [payload];
          for (const item of items) {
            emitEvent(store, item.type as string, item);
          }
        }
      }
    } catch (err: any) {
      if (err?.name === "AbortError" || abortController.signal.aborted) {
        console.log("[query] aborted");
        emitEvent(store, "aborted", { message: "Request aborted by user" });
      } else {
        throw err;
      }
    }
  } catch (err: any) {
    console.log("[query] outer error:", err?.message, err?.stack);
    emitEvent(store, "error", { message: err?.message ?? "Unknown error" });
    store.status = "error";
    scheduleCleanup(store);
    return;
  } finally {
    store.abortController = null;
    store.pendingPermissions.clear();
  }

  store.status = "done";
  emitEvent(store, "done", {});
  scheduleCleanup(store);
}

// Re-entrant: called for subsequent prompts on the same session
export async function continueAgent(store: SessionStore, prompt: string): Promise<void> {
  // Inject the prompt as a stored event for reference (not replayed to SDK)
  // Then run agent — sdkSessionId already set so SDK will resume
  store.events.push({ seq: 0, type: "user_prompt", prompt });
  store.status = "running";
  await runAgent(store);
}

function formatMessage(
  msg: SDKMessage,
): Record<string, unknown> | Record<string, unknown>[] | null {
  switch (msg.type) {
    case "system":
      return { type: "system", subtype: (msg as any).subtype, data: msg };

    case "assistant": {
      const payloads: Record<string, unknown>[] = [];

      const text = msg.message.content
        .filter((block: any) => block.type === "text")
        .map((block: any) => block.text)
        .join("");
      if (text) {
        payloads.push({ type: "assistant", content: text });
      }

      for (const block of msg.message.content) {
        if ((block as any).type === "tool_use") {
          const b = block as any;
          payloads.push({
            type: "tool_use",
            tool_name: b.name,
            tool_input: formatToolInput(b.name, b.input),
          });
        }
      }

      return payloads.length === 1 ? payloads[0] : payloads.length > 1 ? payloads : null;
    }

    case "stream_event": {
      const event = (msg as any).event;
      if (event?.type === "content_block_start") {
        if (event.content_block?.type === "thinking") {
          return { type: "status", status: "thinking" };
        }
        if (event.content_block?.type === "tool_use") {
          return { type: "status", status: "tool", tool_name: event.content_block.name };
        }
      }
      return null;
    }

    case "tool_progress": {
      const tp = msg as any;
      return { type: "status", status: "tool", tool_name: tp.tool_name, elapsed: tp.elapsed_time_seconds };
    }

    case "tool_use_summary": {
      const ts = msg as any;
      return { type: "status", status: "tool_summary", summary: ts.summary };
    }

    case "result":
      if (msg.subtype === "success") {
        return {
          type: "result",
          subtype: "success",
          result: msg.result,
          cost: msg.total_cost_usd,
          duration_ms: msg.duration_ms,
          num_turns: msg.num_turns,
        };
      }
      return {
        type: "result",
        subtype: msg.subtype,
        errors: "errors" in msg ? msg.errors : undefined,
        cost: msg.total_cost_usd,
        duration_ms: msg.duration_ms,
      };

    default:
      return null;
  }
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("");
  }
  return "";
}

export async function loadTranscript(
  sessionId: string,
  cwd: string
): Promise<{ role: string; content: string }[]> {
  const encodedCwd = cwd.replace(/[/\\]/g, "-");
  const transcriptPath = join(
    homedir(),
    ".claude",
    "projects",
    encodedCwd,
    `${sessionId}.jsonl`
  );

  if (!existsSync(transcriptPath)) return [];

  const messages: { role: string; content: string }[] = [];

  try {
    const rl = createInterface({
      input: createReadStream(transcriptPath, { encoding: "utf-8" }),
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      if (!line) continue;
      let entry: any;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }

      if (entry.type === "user" && entry.userType === "external" && !entry.isMeta) {
        const text = extractText(entry.message?.content);
        if (text) messages.push({ role: "user", content: text });
      }

      if (entry.type === "assistant") {
        const text = extractText(entry.message?.content);
        if (text) messages.push({ role: "assistant", content: text });
      }
    }

    console.log(`Loaded ${messages.length} messages from transcript`);
    return messages;
  } catch (err: any) {
    console.error("Error reading transcript:", err.message);
    return [];
  }
}

async function getSessionPreview(filePath: string): Promise<string> {
  try {
    const rl = createInterface({
      input: createReadStream(filePath, { encoding: "utf-8" }),
      crlfDelay: Infinity,
    });

    const parts: string[] = [];
    let totalLen = 0;

    for await (const line of rl) {
      if (!line) continue;
      let entry: any;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }

      if (
        (entry.type === "user" && entry.userType === "external" && !entry.isMeta) ||
        entry.type === "assistant"
      ) {
        const raw = extractText(entry.message?.content).trim();
        const text = raw.replace(/<[^>]*>/g, "").trim();
        if (!text) continue;
        parts.push(text);
        totalLen += (parts.length > 1 ? 3 : 0) + text.length;
        if (totalLen >= 80) {
          rl.close();
          break;
        }
      }
    }

    const preview = parts.join(" — ");
    return preview.length > 80 ? preview.slice(0, 80) + "..." : preview;
  } catch {
    return "";
  }
}

export async function listSessions(
  cwd: string
): Promise<{ id: string; preview: string; updatedAt: string }[]> {
  const encodedCwd = cwd.replace(/[/\\]/g, "-");
  const projectDir = join(homedir(), ".claude", "projects", encodedCwd);

  if (!existsSync(projectDir)) return [];

  try {
    const files = await readdir(projectDir);
    const jsonlFiles = files.filter((f) => f.endsWith(".jsonl"));

    const sessionList = await Promise.all(
      jsonlFiles.map(async (f) => {
        const filePath = join(projectDir, f);
        const id = f.replace(/\.jsonl$/, "");
        const [preview, fileStat] = await Promise.all([
          getSessionPreview(filePath),
          stat(filePath),
        ]);
        return { id, preview, updatedAt: fileStat.mtime.toISOString() };
      })
    );

    sessionList.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return sessionList;
  } catch (err: any) {
    console.error("Error listing sessions:", err.message);
    return [];
  }
}

function formatToolInput(toolName: string, input: Record<string, unknown>): string {
  switch (toolName) {
    case "Bash":
      return input.description
        ? `${input.description}: ${input.command}`
        : `${input.command}`;
    case "Read":
      return `${input.file_path}`;
    case "Write":
      return `${input.file_path} (${(input.content as string).length} chars)`;
    case "Edit":
      return `${input.file_path}`;
    case "Glob":
      return input.path ? `${input.pattern} in ${input.path}` : `${input.pattern}`;
    case "Grep":
      return input.path ? `/${input.pattern}/ in ${input.path}` : `/${input.pattern}/`;
    case "Task":
      return `[${input.subagent_type}] ${input.description}`;
    case "WebFetch":
      return `${input.url}`;
    case "WebSearch":
      return `"${input.query}"`;
    case "NotebookEdit":
      return `${input.notebook_path} (${input.edit_mode || "replace"})`;
    case "TodoWrite": {
      const todos = input.todos as { content: string; status: string }[];
      return todos.map((t) => `[${t.status}] ${t.content}`).join(", ");
    }
    default:
      return JSON.stringify(input);
  }
}
