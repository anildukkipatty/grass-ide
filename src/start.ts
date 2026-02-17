import { WebSocketServer, WebSocket } from "ws";
import { query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { createReadStream, existsSync } from "fs";
import { createInterface } from "readline";
import { join } from "path";
import { homedir } from "os";

const PORT = 3000;

export async function start() {
  const cwd = process.cwd();
  console.log(`Starting grass server...`);
  console.log(`  cwd:  ${cwd}`);
  console.log(`  port: ${PORT}`);

  const wss = new WebSocketServer({ port: PORT });

  console.log(`\nListening on ws://localhost:${PORT}`);

  wss.on("connection", (ws) => {
    console.log("Client connected");

    let streaming = false;
    let msgSeq = 0;
    let abortController: AbortController | null = null;
    let sessionId: string | null = null;
    const pendingPermissions = new Map<string, { resolve: (result: any) => void; input: any }>();

    ws.on("message", async (raw) => {
      let parsed: { type: string; content?: string; sessionId?: string };
      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        ws.send(JSON.stringify({ type: "error", message: "Invalid JSON" }));
        return;
      }

      // Handle ping from client
      if (parsed.type === "ping") {
        ws.send(JSON.stringify({ type: "pong" }));
        return;
      }

      // Handle abort signal
      if (parsed.type === "abort") {
        if (streaming && abortController) {
          abortController.abort();
          console.log("Client requested abort");
        }
        return;
      }

      // Handle permission response from client
      if (parsed.type === "permission_response") {
        const { toolUseID, approved } = parsed as any;
        console.log(`[permission_response] id=${toolUseID} approved=${approved}`);
        const pending = pendingPermissions.get(toolUseID);
        if (pending) {
          pendingPermissions.delete(toolUseID);
          console.log(`[permission_response] resolving with behavior=${approved ? "allow" : "deny"}`);
          pending.resolve(approved
            ? { behavior: "allow", updatedInput: pending.input }
            : { behavior: "deny", message: "User denied" }
          );
        } else {
          console.log(`[permission_response] no resolver found for ${toolUseID}`);
        }
        return;
      }

      // Handle init — client sends sessionId to resume
      if (parsed.type === "init") {
        if (parsed.sessionId && typeof parsed.sessionId === "string") {
          sessionId = parsed.sessionId;
          console.log("Client requested session resume:", sessionId);
          const history = await loadTranscript(sessionId, cwd);
          if (history.length > 0) {
            ws.send(JSON.stringify({ type: "history", messages: history }));
          }
        }
        return;
      }

      if (parsed.type !== "message" || typeof parsed.content !== "string") {
        ws.send(
          JSON.stringify({
            type: "error",
            message: 'Expected { type: "message", content: string } or { type: "abort" }',
          })
        );
        return;
      }

      if (streaming) {
        ws.send(
          JSON.stringify({
            type: "error",
            message: "Already processing a message, wait for result",
          })
        );
        return;
      }

      streaming = true;
      abortController = new AbortController();

      try {
        console.log("[query] starting with permissionMode=default + canUseTool");
        const q = query({
          prompt: parsed.content,
          options: {
            model: "claude-opus-4-6",
            permissionMode: "default",
            abortController,
            includePartialMessages: true,
            ...(sessionId ? { resume: sessionId } : {}),
            canUseTool: (toolName, input, { signal, toolUseID, decisionReason }) => {
              console.log(`[canUseTool] tool=${toolName} id=${toolUseID} reason=${decisionReason}`);
              return new Promise((resolve) => {
                // If connection is gone, deny
                if (ws.readyState !== WebSocket.OPEN) {
                  console.log(`[canUseTool] denying — client disconnected`);
                  resolve({ behavior: "deny", message: "Client disconnected" });
                  return;
                }

                // Store resolver and input
                pendingPermissions.set(toolUseID, { resolve, input });

                // Send permission request to client
                ws.send(JSON.stringify({
                  type: "permission_request",
                  toolUseID,
                  toolName,
                  input,
                }));

                // If aborted, clean up and deny
                signal.addEventListener("abort", () => {
                  const p = pendingPermissions.get(toolUseID);
                  if (p) {
                    pendingPermissions.delete(toolUseID);
                    p.resolve({ behavior: "deny", message: "Request aborted" });
                  }
                }, { once: true });
              });
            },
          },
        });

        try {
          for await (const msg of q) {
            if (ws.readyState !== WebSocket.OPEN) break;

            // Capture session ID from init message
            if (msg.type === "system" && msg.subtype === "init") {
              sessionId = (msg as any).session_id ?? sessionId;
            }

            const payload = formatMessage(msg, msgSeq);
            if (payload) {
              const items = Array.isArray(payload) ? payload : [payload];
              for (const item of items) {
                if (item.type === "assistant") msgSeq++;
                ws.send(JSON.stringify(item));
              }
            }
          }
        } catch (err: any) {
          console.log("[query] inner error:", err?.message, err?.stack);
          if (err?.name === "AbortError" || abortController.signal.aborted) {
            console.log("Request aborted successfully");
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(
                JSON.stringify({
                  type: "aborted",
                  message: "Request aborted by user",
                })
              );
            }
          } else {
            throw err;
          }
        }
      } catch (err: any) {
        console.log("[query] outer error:", err?.message, err?.stack);
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(
            JSON.stringify({
              type: "error",
              message: err?.message ?? "Unknown error",
            })
          );
        }
      } finally {
        streaming = false;
        abortController = null;
      }
    });

    ws.on("close", () => {
      console.log("Client disconnected");
      if (abortController) abortController.abort();
    });
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log("\nShutting down...");
    wss.clients.forEach((ws) => ws.close());
    wss.close(() => {
      process.exit(0);
    });
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
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
          return {
            type: "status",
            status: "tool",
            tool_name: event.content_block.name,
          };
        }
      }
      return null;
    }

    case "tool_progress": {
      const tp = msg as any;
      return {
        type: "status",
        status: "tool",
        tool_name: tp.tool_name,
        elapsed: tp.elapsed_time_seconds,
      };
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
  const encodedCwd = cwd.replace(/\//g, "-");
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
