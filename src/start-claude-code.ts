import { WebSocket } from "ws";
import { query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { createReadStream, existsSync } from "fs";
import { execSync } from "child_process";
import { readdir, stat } from "fs/promises";
import { createInterface } from "readline";
import { join } from "path";
import { homedir } from "os";
import {
  clearIdleTimer,
  startIdleTimer,
  safeSend,
  type ManagedSessionBase,
  type ConnectionState,
} from "./server-common";

interface ManagedSession extends ManagedSessionBase {
  abortController: AbortController | null;
  pendingPermissions: Map<string, { resolve: (result: any) => void; input: any; toolName: string; toolUseID: string }>;
}

const sessions = new Map<string, ManagedSession>();

function getOrCreateManagedSession(sessionId: string): ManagedSession {
  let ms = sessions.get(sessionId);
  if (!ms) {
    ms = {
      sessionId,
      connectedSocket: null,
      streaming: false,
      msgSeq: 0,
      abortController: null,
      pendingPermissions: new Map(),
      idleTimer: null,
    };
    sessions.set(sessionId, ms);
  }
  clearIdleTimer(ms);
  return ms;
}

// Called once at server startup. Checks that the claude CLI is available.
// Returns true if the agent is available, false otherwise.
export async function initAgent(): Promise<boolean> {
  try {
    execSync("claude --version", { stdio: "ignore" });
    return true;
  } catch {
    console.warn("  claude CLI not found — claude-code agent unavailable");
    return false;
  }
}

// Handles all agent-specific WebSocket messages for a connection.
// Called by server.ts for every message that isn't handled by the workspace layer.
// Also called with { type: "__disconnect__" } on socket close.
export async function handleMessage(
  parsed: { type: string; [key: string]: any },
  ws: WebSocket,
  state: ConnectionState,
  workspaceCwd: string,
): Promise<void> {
  const { selectedRepoPath } = state;

  // --- Disconnect cleanup ---
  if (parsed.type === "__disconnect__") {
    if (state.attachedSessionId) {
      const ms = sessions.get(state.attachedSessionId);
      if (ms && ms.connectedSocket === ws) {
        ms.connectedSocket = null;
        if (!ms.streaming) startIdleTimer(ms, sessions);
        console.log(`Session ${state.attachedSessionId} detached (streaming=${ms.streaming})`);
      }
    }
    return;
  }

  // --- Abort ---
  if (parsed.type === "abort") {
    if (state.attachedSessionId) {
      const ms = sessions.get(state.attachedSessionId);
      if (ms && ms.streaming && ms.abortController) {
        ms.abortController.abort();
        console.log("Client requested abort");
      }
    }
    return;
  }

  // --- Permission response ---
  if (parsed.type === "permission_response") {
    const { toolUseID, approved } = parsed;
    console.log(`[permission_response] id=${toolUseID} approved=${approved}`);
    if (state.attachedSessionId) {
      const ms = sessions.get(state.attachedSessionId);
      if (ms) {
        const pending = ms.pendingPermissions.get(toolUseID);
        if (pending) {
          ms.pendingPermissions.delete(toolUseID);
          console.log(`[permission_response] resolving with behavior=${approved ? "allow" : "deny"}`);
          pending.resolve(approved
            ? { behavior: "allow", updatedInput: pending.input }
            : { behavior: "deny", message: "User denied" }
          );
        } else {
          console.log(`[permission_response] no resolver found for ${toolUseID}`);
        }
      }
    }
    return;
  }

  // --- Session list ---
  if (parsed.type === "list_sessions") {
    const cwd = selectedRepoPath ?? workspaceCwd;
    const sessionList = await listSessions(cwd);
    ws.send(JSON.stringify({ type: "sessions_list", sessions: sessionList }));
    return;
  }

  // --- Init / resume session ---
  if (parsed.type === "init") {
    if (parsed.sessionId && typeof parsed.sessionId === "string") {
      const sessionId = parsed.sessionId;
      console.log("Client requested session resume:", sessionId);

      // Detach from previous session if switching
      if (state.attachedSessionId && state.attachedSessionId !== sessionId) {
        const oldMs = sessions.get(state.attachedSessionId);
        if (oldMs && oldMs.connectedSocket === ws) {
          oldMs.connectedSocket = null;
          if (!oldMs.streaming) startIdleTimer(oldMs, sessions);
        }
      }

      state.attachedSessionId = sessionId;

      // Attach socket to managed session (if it exists)
      const ms = sessions.get(sessionId);
      if (ms) {
        if (ms.connectedSocket && ms.connectedSocket !== ws && ms.connectedSocket.readyState === WebSocket.OPEN) {
          ms.connectedSocket.send(JSON.stringify({ type: "error", message: "Another client connected to this session" }));
          ms.connectedSocket.close();
        }
        ms.connectedSocket = ws;
        clearIdleTimer(ms);
      }

      // Load and send transcript history
      const cwd = selectedRepoPath ?? workspaceCwd;
      const history = await loadTranscript(sessionId, cwd);
      if (history.length > 0) {
        ws.send(JSON.stringify({ type: "history", messages: history }));
      }

      const streaming = ms?.streaming ?? false;
      ws.send(JSON.stringify({ type: "session_status", streaming, sessionId }));

      // Flush any pending permission requests
      if (ms) {
        for (const [id, pending] of ms.pendingPermissions) {
          ws.send(JSON.stringify({
            type: "permission_request",
            toolUseID: id,
            toolName: pending.toolName,
            input: pending.input,
          }));
        }
      }
    } else {
      // No sessionId — client is starting a new chat; detach from any current session
      console.log("Client requested new chat (detaching from session)");
      if (state.attachedSessionId) {
        const oldMs = sessions.get(state.attachedSessionId);
        if (oldMs && oldMs.connectedSocket === ws) {
          oldMs.connectedSocket = null;
          if (!oldMs.streaming) startIdleTimer(oldMs, sessions);
        }
        state.attachedSessionId = null;
      }
    }
    return;
  }

  // --- Chat message ---
  if (parsed.type !== "message" || typeof parsed.content !== "string") {
    ws.send(JSON.stringify({
      type: "error",
      message: 'Expected { type: "message", content: string } or { type: "abort" }',
    }));
    return;
  }

  if (!selectedRepoPath) {
    ws.send(JSON.stringify({ type: "error", message: "Please select a repository before starting a chat." }));
    return;
  }

  if (state.attachedSessionId) {
    const ms = sessions.get(state.attachedSessionId);
    if (ms && ms.streaming) {
      ws.send(JSON.stringify({ type: "error", message: "Already processing a message, wait for result" }));
      return;
    }
  }

  const sessionId = state.attachedSessionId;
  const abortController = new AbortController();

  let ms: ManagedSession | null = null;
  if (sessionId) {
    ms = getOrCreateManagedSession(sessionId);
  }

  if (ms) {
    ms.streaming = true;
    ms.abortController = abortController;
    ms.connectedSocket = ws;
  }

  const repoCwd = selectedRepoPath;

  try {
    console.log("[query] starting with permissionMode=default + canUseTool");
    const q = query({
      prompt: parsed.content,
      options: {
        model: "claude-opus-4-6",
        permissionMode: "default",
        abortController,
        includePartialMessages: true,
        cwd: repoCwd,
        ...(sessionId ? { resume: sessionId } : {}),
        canUseTool: (toolName, input, { signal, toolUseID, decisionReason }) => {
          console.log(`[canUseTool] tool=${toolName} id=${toolUseID} reason=${decisionReason}`);
          return new Promise((resolve) => {
            if (!ms) {
              resolve({ behavior: "deny", message: "Session not ready" });
              return;
            }

            ms.pendingPermissions.set(toolUseID, { resolve, input, toolName, toolUseID });

            safeSend(ms, {
              type: "permission_request",
              toolUseID,
              toolName,
              input,
            });

            signal.addEventListener("abort", () => {
              const p = ms!.pendingPermissions.get(toolUseID);
              if (p) {
                ms!.pendingPermissions.delete(toolUseID);
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
          const newSessionId = (msg as any).session_id;
          if (newSessionId && !ms) {
            ms = getOrCreateManagedSession(newSessionId);
            ms.streaming = true;
            ms.abortController = abortController;
            ms.connectedSocket = ws;
            state.attachedSessionId = newSessionId;
          }
        }

        if (!ms) continue;

        const payload = formatMessage(msg, ms.msgSeq);
        if (payload) {
          const items = Array.isArray(payload) ? payload : [payload];
          for (const item of items) {
            if (item.type === "assistant") ms.msgSeq++;
            safeSend(ms, item as Record<string, unknown>);
          }
        }
      }
    } catch (err: any) {
      if (err?.name === "AbortError" || abortController.signal.aborted) {
        console.log("[query] aborted");
        if (ms) safeSend(ms, { type: "aborted", message: "Request aborted by user" });
      } else {
        throw err;
      }
    }
  } catch (err: any) {
    console.log("[query] outer error:", err?.message, err?.stack);
    if (ms) safeSend(ms, { type: "error", message: err?.message ?? "Unknown error" });
  } finally {
    if (ms) {
      ms.streaming = false;
      ms.abortController = null;
      ms.pendingPermissions.clear();
      if (!ms.connectedSocket || ms.connectedSocket.readyState !== WebSocket.OPEN) {
        startIdleTimer(ms, sessions);
      }
    }
  }
}

function formatMessage(
  msg: SDKMessage,
  seq: number
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
        payloads.push({ type: "assistant", id: seq, content: text });
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

async function loadTranscript(
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

async function listSessions(
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
