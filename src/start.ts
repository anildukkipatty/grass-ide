import { WebSocketServer, WebSocket } from "ws";
import { query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { createReadStream, existsSync } from "fs";
import { readdir } from "fs/promises";
import { createInterface } from "readline";
import { join } from "path";
import { homedir, networkInterfaces } from "os";
import { execSync, execFile, spawn } from "child_process";
import http from "node:http";
import qrcode from "qrcode-terminal";
import { html } from "./client-html";

const PORT_RANGE_START = 32100;
const PORT_RANGE_END = 32199;
const IDLE_CLEANUP_MS = 10 * 60 * 1000; // 10 minutes

function findAvailablePort(startPort: number, endPort: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const tryPort = (port: number) => {
      if (port > endPort) {
        reject(new Error(`No available port found in range ${startPort}–${endPort}`));
        return;
      }
      const server = http.createServer();
      server.listen(port, () => {
        server.close(() => resolve(port));
      });
      server.on("error", () => tryPort(port + 1));
    };
    tryPort(startPort);
  });
}

interface ManagedSession {
  sessionId: string;
  connectedSocket: WebSocket | null;
  streaming: boolean;
  msgSeq: number;
  abortController: AbortController | null;
  pendingPermissions: Map<string, { resolve: (result: any) => void; input: any; toolName: string; toolUseID: string }>;
  idleTimer: ReturnType<typeof setTimeout> | null;
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

function clearIdleTimer(ms: ManagedSession) {
  if (ms.idleTimer) {
    clearTimeout(ms.idleTimer);
    ms.idleTimer = null;
  }
}

function startIdleTimer(ms: ManagedSession) {
  clearIdleTimer(ms);
  ms.idleTimer = setTimeout(() => {
    console.log(`[idle] Cleaning up session ${ms.sessionId} after ${IDLE_CLEANUP_MS / 1000}s idle`);
    sessions.delete(ms.sessionId);
  }, IDLE_CLEANUP_MS);
}

function safeSend(ms: ManagedSession, payload: Record<string, unknown>) {
  const ws = ms.connectedSocket;
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function getLocalIP(): string {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]!) {
      if (net.family === "IPv4" && !net.internal) {
        return net.address;
      }
    }
  }
  return "localhost";
}

function getPublicIP(): Promise<string | null> {
  return new Promise((resolve) => {
    http.get("http://api.ipify.org", (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => resolve(data.trim() || null));
      res.on("error", () => resolve(null));
    }).on("error", () => resolve(null));
  });
}

function getTailscaleIP(): Promise<string | null> {
  return new Promise((resolve) => {
    // Check if Tailscale is actually running and connected
    execFile("tailscale", ["status"], { timeout: 2000 }, (err) => {
      if (err) return resolve(null);
      // Status succeeded, now get the IP
      execFile("tailscale", ["ip", "-4"], { timeout: 2000 }, (err, stdout) => {
        if (err) return resolve(null);
        const ip = stdout.trim().split("\n")[0];
        resolve(ip || null);
      });
    });
  });
}

async function showQR(network: string, port: number): Promise<void> {
  let ip: string;
  let label: string;

  if (network === "tailscale") {
    const tsIP = await getTailscaleIP();
    if (!tsIP) {
      console.error("  Tailscale IP not found. Is Tailscale running?");
      process.exit(1);
    }
    ip = tsIP;
    label = "Tailscale";
  } else if (network === "remote-ip") {
    const publicIP = await getPublicIP();
    if (!publicIP) {
      console.error("  Could not determine public IP address.");
      process.exit(1);
    }
    ip = publicIP;
    label = "Public";
  } else if (network === "local") {
    ip = getLocalIP();
    label = "Local Network";
  } else {
    // Treat as a literal IP/hostname
    ip = network;
    label = "Custom";
  }

  const url = `http://${ip}:${port}`;

  console.log(`\n  ${label}  ${url}\n`);

  const qrCode = await new Promise<string>((resolve) => {
    qrcode.generate(url, { small: true }, (code: string) => {
      resolve(code.trimEnd());
    });
  });

  console.log(qrCode);
}

function maybeCaffeinate(enabled: boolean): number | null {
  if (!enabled) return null;
  try {
    execSync("which caffeinate", { stdio: "ignore" });
  } catch {
    return null;
  }
  const hours = 8;
  const seconds = hours * 60 * 60;
  const child = spawn("caffeinate", ["-t", String(seconds)], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  console.log(`  caffeinate: running for ${hours}h (pid ${child.pid})`);
  return child.pid ?? null;
}

function killCaffeinate(pid: number | null): void {
  if (pid === null) return;
  try {
    process.kill(pid);
  } catch {
    // already gone
  }
}

export async function start(network: string = "local", portOverride?: number, caffeinate: boolean = false) {
  const cwd = process.cwd();
  console.log(`Starting grass server...`);
  const caffeinatePid = maybeCaffeinate(caffeinate);
  console.log(`  cwd:  ${cwd}`);

  let PORT: number;
  if (portOverride !== undefined) {
    PORT = portOverride;
    console.log(`  port: ${PORT} (specified)`);
  } else {
    try {
      PORT = await findAvailablePort(PORT_RANGE_START, PORT_RANGE_END);
      console.log(`  port: ${PORT} (auto-selected from ${PORT_RANGE_START}–${PORT_RANGE_END})`);
    } catch {
      console.error(`\n  No available port found in range ${PORT_RANGE_START}–${PORT_RANGE_END}.`);
      console.error(`  Try stopping other grass sessions, or run with -p to specify a port.\n`);
      process.exit(1);
    }
  }

  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
  });

  const wss = new WebSocketServer({ server });

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(`\n  Port ${PORT} is not available.`);
      if (portOverride !== undefined) {
        console.error(`  Please choose a different port with -p, or run without -p to auto-select one.\n`);
      } else {
        console.error(`  Try stopping other grass sessions, or run with -p to specify a port.\n`);
      }
      process.exit(1);
    }
    throw err;
  });

  server.listen(PORT, async () => {
    await showQR(network, PORT);
  });

  wss.on("connection", (ws) => {
    console.log("Client connected");

    // Track which managed session this socket is attached to
    let attachedSessionId: string | null = null;

    ws.on("message", async (raw) => {
      let parsed: { type: string; content?: string; sessionId?: string; [key: string]: any };
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

      // Handle list_sessions request
      if (parsed.type === "list_sessions") {
        const sessionList = await listSessions(cwd);
        ws.send(JSON.stringify({ type: "sessions_list", sessions: sessionList }));
        return;
      }

      // Handle get_diffs request
      if (parsed.type === "get_diffs") {
        let diff = "";
        try {
          diff = execSync("git diff HEAD", { cwd, encoding: "utf-8", maxBuffer: 10 * 1024 * 1024 });
        } catch {
          diff = "";
        }
        ws.send(JSON.stringify({ type: "diffs", diff }));
        return;
      }

      // Handle abort signal
      if (parsed.type === "abort") {
        if (attachedSessionId) {
          const ms = sessions.get(attachedSessionId);
          if (ms && ms.streaming && ms.abortController) {
            ms.abortController.abort();
            console.log("Client requested abort");
          }
        }
        return;
      }

      // Handle permission response from client
      if (parsed.type === "permission_response") {
        const { toolUseID, approved } = parsed;
        console.log(`[permission_response] id=${toolUseID} approved=${approved}`);
        if (attachedSessionId) {
          const ms = sessions.get(attachedSessionId);
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

      // Handle init — client sends sessionId to resume
      if (parsed.type === "init") {
        if (parsed.sessionId && typeof parsed.sessionId === "string") {
          const sessionId = parsed.sessionId;
          console.log("Client requested session resume:", sessionId);

          // Detach from previous session if switching
          if (attachedSessionId && attachedSessionId !== sessionId) {
            const oldMs = sessions.get(attachedSessionId);
            if (oldMs && oldMs.connectedSocket === ws) {
              oldMs.connectedSocket = null;
              if (!oldMs.streaming) startIdleTimer(oldMs);
            }
          }

          attachedSessionId = sessionId;

          // Attach socket to managed session (if it exists)
          const ms = sessions.get(sessionId);
          if (ms) {
            // Disconnect previous client on this session (last one wins)
            if (ms.connectedSocket && ms.connectedSocket !== ws && ms.connectedSocket.readyState === WebSocket.OPEN) {
              ms.connectedSocket.send(JSON.stringify({ type: "error", message: "Another client connected to this session" }));
              ms.connectedSocket.close();
            }
            ms.connectedSocket = ws;
            clearIdleTimer(ms);
          }

          // Load and send transcript history
          const history = await loadTranscript(sessionId, cwd);
          if (history.length > 0) {
            ws.send(JSON.stringify({ type: "history", messages: history }));
          }

          // Send session status so client knows if a query is running
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

      // Check if already streaming on this session
      if (attachedSessionId) {
        const ms = sessions.get(attachedSessionId);
        if (ms && ms.streaming) {
          ws.send(
            JSON.stringify({
              type: "error",
              message: "Already processing a message, wait for result",
            })
          );
          return;
        }
      }

      // Start query — create or reuse managed session
      const sessionId = attachedSessionId; // may be null for new session
      const abortController = new AbortController();

      // We'll get the real session ID from the init message, but need a placeholder MS
      // For now, create a temporary reference that we'll update
      let ms: ManagedSession | null = null;
      if (sessionId) {
        ms = getOrCreateManagedSession(sessionId);
      }

      if (ms) {
        ms.streaming = true;
        ms.abortController = abortController;
        ms.connectedSocket = ws;
      }

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
                if (!ms) {
                  // Session not yet initialized, deny
                  resolve({ behavior: "deny", message: "Session not ready" });
                  return;
                }

                // Store resolver with tool info for reconnect
                ms.pendingPermissions.set(toolUseID, { resolve, input, toolName, toolUseID });

                // Send to client if connected
                safeSend(ms, {
                  type: "permission_request",
                  toolUseID,
                  toolName,
                  input,
                });

                // If aborted, clean up and deny
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
            // Capture session ID from init message
            if (msg.type === "system" && msg.subtype === "init") {
              const newSessionId = (msg as any).session_id;
              if (newSessionId && !ms) {
                // First time seeing session ID — create managed session
                ms = getOrCreateManagedSession(newSessionId);
                ms.streaming = true;
                ms.abortController = abortController;
                ms.connectedSocket = ws;
                attachedSessionId = newSessionId;
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
            if (ms) {
              safeSend(ms, {
                type: "aborted",
                message: "Request aborted by user",
              });
            }
          } else {
            throw err;
          }
        }
      } catch (err: any) {
        console.log("[query] outer error:", err?.message, err?.stack);
        if (ms) {
          safeSend(ms, {
            type: "error",
            message: err?.message ?? "Unknown error",
          });
        }
      } finally {
        if (ms) {
          ms.streaming = false;
          ms.abortController = null;
          // Clear any stale pending permissions so they don't get flushed on reconnect
          ms.pendingPermissions.clear();
          // If no client connected, start idle cleanup
          if (!ms.connectedSocket || ms.connectedSocket.readyState !== WebSocket.OPEN) {
            startIdleTimer(ms);
          }
        }
      }
    });

    ws.on("close", () => {
      console.log("Client disconnected");
      // Detach socket but do NOT abort the query
      if (attachedSessionId) {
        const ms = sessions.get(attachedSessionId);
        if (ms && ms.connectedSocket === ws) {
          ms.connectedSocket = null;
          // If not streaming, start idle cleanup
          if (!ms.streaming) {
            startIdleTimer(ms);
          }
          // If streaming, query continues headlessly — no abort
          console.log(`Session ${attachedSessionId} detached (streaming=${ms.streaming})`);
        }
      }
    });
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log("\nShutting down...");
    killCaffeinate(caffeinatePid);
    // Abort all running queries
    for (const [, ms] of sessions) {
      if (ms.abortController) ms.abortController.abort();
      clearIdleTimer(ms);
    }
    wss.clients.forEach((ws) => ws.close());
    wss.close();
    server.close(() => {
      process.exit(0);
    });
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  process.on("exit", () => killCaffeinate(caffeinatePid));
  process.on("uncaughtException", (err) => {
    console.error("Uncaught exception:", err);
    killCaffeinate(caffeinatePid);
    process.exit(1);
  });
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

async function getSessionPreview(filePath: string): Promise<string> {
  try {
    const rl = createInterface({
      input: createReadStream(filePath, { encoding: "utf-8" }),
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

      // Look for the first user message or assistant message with real content
      if (entry.type === "user" && entry.userType === "external" && !entry.isMeta) {
        const text = extractText(entry.message?.content).trim();
        if (text) {
          rl.close();
          return text.length > 80 ? text.slice(0, 80) + "..." : text;
        }
      }
      if (entry.type === "assistant") {
        const text = extractText(entry.message?.content).trim();
        if (text) {
          rl.close();
          return text.length > 80 ? text.slice(0, 80) + "..." : text;
        }
      }
    }

    return "";
  } catch {
    return "";
  }
}

async function listSessions(
  cwd: string
): Promise<{ id: string; preview: string }[]> {
  const encodedCwd = cwd.replace(/\//g, "-");
  const projectDir = join(homedir(), ".claude", "projects", encodedCwd);

  if (!existsSync(projectDir)) return [];

  try {
    const files = await readdir(projectDir);
    const jsonlFiles = files.filter((f) => f.endsWith(".jsonl"));

    const sessionList = await Promise.all(
      jsonlFiles.map(async (f) => {
        const id = f.replace(/\.jsonl$/, "");
        const preview = await getSessionPreview(join(projectDir, f));
        return { id, preview };
      })
    );

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
