import { WebSocketServer, WebSocket } from "ws";
import http from "node:http";
import { networkInterfaces } from "os";
import { execSync, execFile, spawn } from "child_process";
import qrcode from "qrcode-terminal";
import { html } from "./client-html";

async function loadOpencodeSdk() {
  const sdk = await import("@opencode-ai/sdk");
  return { createOpencode: sdk.createOpencode, createOpencodeClient: sdk.createOpencodeClient };
}

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
  currentPartType: string | null; // tracks whether deltas are "reasoning", "text", etc.
  accumulatedText: string; // accumulates text deltas for the current assistant message
  pendingPermissions: Map<string, { permissionId: string; title: string; metadata: any }>;
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
      currentPartType: null,
      accumulatedText: "",
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
    execFile("tailscale", ["status"], { timeout: 2000 }, (err) => {
      if (err) return resolve(null);
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

export async function start(network: string = "local", portOverride?: number, caffeinate: boolean = false, agent: string = "opencode") {
  const cwd = process.cwd();
  console.log(`Starting grass server (opencode)...`);
  const caffeinatePid = maybeCaffeinate(caffeinate);
  console.log(`  cwd:  ${cwd}`);

  // Initialize opencode SDK client
  console.log("  Starting opencode server...");
  const { createOpencode, createOpencodeClient } = await loadOpencodeSdk();

  const permissionConfig = {
    edit: "ask",
    bash: "ask",
    webfetch: "ask",
    doom_loop: "ask",
    external_directory: "ask",
  } as const;

  let client;
  try {
    const result = await createOpencode({ config: { permission: permissionConfig } });
    client = result.client;
    console.log("  opencode server ready (spawned), permissions: ask mode enabled");
  } catch {
    // Server already running — connect to existing instance and update config
    console.log("  opencode server already running, connecting...");
    client = createOpencodeClient({ baseUrl: "http://127.0.0.1:4096" });
    console.log("  opencode client connected");
    try {
      const configResult = await client.config.get();
      const currentConfig = (configResult.data ?? {}) as Record<string, any>;
      await client.config.update({
        body: { ...currentConfig, permission: permissionConfig },
      });
      console.log("  permissions: ask mode enabled");
    } catch (err: any) {
      console.warn("  permissions: could not set permission config:", err?.message);
    }
  }

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

  // Subscribe to opencode events globally
  // We'll route events to the right session based on sessionID in the event
  startEventStream(client);

  wss.on("connection", (ws) => {
    console.log("Client connected (opencode)");

    let attachedSessionId: string | null = null;

    ws.on("message", async (raw) => {
      let parsed: { type: string; content?: string; sessionId?: string; [key: string]: any };
      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        ws.send(JSON.stringify({ type: "error", message: "Invalid JSON" }));
        return;
      }

      if (parsed.type === "ping") {
        ws.send(JSON.stringify({ type: "pong" }));
        return;
      }

      if (parsed.type === "get_cwd") {
        ws.send(JSON.stringify({ type: "cwd", cwd, agent }));
        return;
      }

      if (parsed.type === "list_sessions") {
        try {
          const result = await client.session.list();
          console.log(`[list_sessions] got ${(result.data ?? []).length} sessions`);
          const sessionList = (result.data ?? []).map((s: any) => ({
            id: s.id,
            preview: s.title || s.id,
            updatedAt: (() => {
              const ts = s.time?.updated || s.time?.created || 0;
              // Handle both seconds and milliseconds timestamps
              const ms = ts > 1e12 ? ts : ts * 1000;
              return new Date(ms).toISOString();
            })(),
          }));
          // Sort by most recent
          sessionList.sort((a: any, b: any) => b.updatedAt.localeCompare(a.updatedAt));
          ws.send(JSON.stringify({ type: "sessions_list", sessions: sessionList }));
        } catch (err: any) {
          console.error("Error listing sessions:", err.message);
          ws.send(JSON.stringify({ type: "sessions_list", sessions: [] }));
        }
        return;
      }

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

      if (parsed.type === "abort") {
        if (attachedSessionId) {
          const ms = sessions.get(attachedSessionId);
          if (ms && ms.streaming) {
            try {
              await client.session.abort({ path: { id: attachedSessionId } });
              console.log("Client requested abort");
            } catch (err: any) {
              console.error("Abort failed:", err.message);
            }
          }
        }
        return;
      }

      if (parsed.type === "permission_response") {
        const { toolUseID, approved } = parsed;
        if (attachedSessionId) {
          const ms = sessions.get(attachedSessionId);
          if (ms) {
            const pending = ms.pendingPermissions.get(toolUseID);
            if (pending) {
              ms.pendingPermissions.delete(toolUseID);
              try {
                await client.postSessionIdPermissionsPermissionId({
                  path: { id: attachedSessionId, permissionID: pending.permissionId },
                  body: { response: approved ? "once" : "reject" },
                });
              } catch (err: any) {
                console.error("Permission response failed:", err.message);
              }
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

          if (attachedSessionId && attachedSessionId !== sessionId) {
            const oldMs = sessions.get(attachedSessionId);
            if (oldMs && oldMs.connectedSocket === ws) {
              oldMs.connectedSocket = null;
              if (!oldMs.streaming) startIdleTimer(oldMs);
            }
          }

          attachedSessionId = sessionId;

          const ms = getOrCreateManagedSession(sessionId);
          if (ms.connectedSocket && ms.connectedSocket !== ws && ms.connectedSocket.readyState === WebSocket.OPEN) {
            ms.connectedSocket.send(JSON.stringify({ type: "error", message: "Another client connected to this session" }));
            ms.connectedSocket.close();
          }
          ms.connectedSocket = ws;
          clearIdleTimer(ms);

          // Load history from opencode API
          try {
            const messagesResult = await client.session.messages({ path: { id: sessionId } });
            const history: { role: string; content: string }[] = [];
            for (const msg of messagesResult.data ?? []) {
              const role = (msg as any).info?.role;
              if (role === "user" || role === "assistant") {
                const parts = (msg as any).parts ?? [];
                const text = parts
                  .filter((p: any) => p.type === "text")
                  .map((p: any) => p.text)
                  .join("");
                if (text) history.push({ role, content: text });
              }
            }
            console.log(`[init] loaded ${history.length} history messages for session ${sessionId}`);
            if (history.length > 0) {
              ws.send(JSON.stringify({ type: "history", messages: history }));
            }
          } catch (err: any) {
            console.error("Error loading history:", err.message);
          }

          const streaming = ms.streaming;
          ws.send(JSON.stringify({ type: "session_status", streaming, sessionId }));

          // Flush pending permissions
          for (const [id, pending] of ms.pendingPermissions) {
            ws.send(JSON.stringify({
              type: "permission_request",
              toolUseID: id,
              toolName: pending.title,
              input: pending.metadata,
            }));
          }
        }
        return;
      }

      if (parsed.type !== "message" || typeof parsed.content !== "string") {
        ws.send(JSON.stringify({
          type: "error",
          message: 'Expected { type: "message", content: string } or { type: "abort" }',
        }));
        return;
      }

      // Check if already streaming
      if (attachedSessionId) {
        const ms = sessions.get(attachedSessionId);
        if (ms && ms.streaming) {
          ws.send(JSON.stringify({
            type: "error",
            message: "Already processing a message, wait for result",
          }));
          return;
        }
      }

      // Send prompt to opencode
      try {
        let sessionId = attachedSessionId;

        // Create a new session if we don't have one
        if (!sessionId) {
          const sessionResult = await client.session.create({
            body: { title: parsed.content.slice(0, 80) },
          });
          sessionId = (sessionResult.data as any).id;
          attachedSessionId = sessionId;
        }

        const ms = getOrCreateManagedSession(sessionId!);
        ms.streaming = true;
        ms.connectedSocket = ws;

        console.log(`[query] sending prompt to opencode session ${sessionId}`);

        // Send the prompt — responses come through the event stream
        // The prompt call returns when the LLM finishes; streaming events handle the UI updates
        client.session.prompt({
          path: { id: sessionId! },
          body: {
            parts: [{ type: "text", text: parsed.content }],
          },
        }).catch((err: any) => {
          ms.streaming = false;
          if (err?.message?.includes("abort")) {
            safeSend(ms, { type: "aborted", message: "Request aborted by user" });
          } else {
            console.error("[query] error:", err.message);
            safeSend(ms, { type: "error", message: err?.message ?? "Unknown error" });
          }
        });

      } catch (err: any) {
        console.error("[query] error:", err.message);
        ws.send(JSON.stringify({ type: "error", message: err?.message ?? "Unknown error" }));
      }
    });

    ws.on("close", () => {
      console.log("Client disconnected");
      if (attachedSessionId) {
        const ms = sessions.get(attachedSessionId);
        if (ms && ms.connectedSocket === ws) {
          ms.connectedSocket = null;
          if (!ms.streaming) {
            startIdleTimer(ms);
          }
          console.log(`Session ${attachedSessionId} detached (streaming=${ms.streaming})`);
        }
      }
    });
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log("\nShutting down...");
    killCaffeinate(caffeinatePid);
    for (const [, ms] of sessions) {
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

// Extract sessionID from any event's properties
function extractSessionId(type: string, props: any): string | undefined {
  // Most events have sessionID at top level of properties
  if (props?.sessionID) return props.sessionID;
  // message.updated wraps in { info: Message }
  if (props?.info?.sessionID) return props.info.sessionID;
  // message.part.updated wraps in { part: Part }
  if (props?.part?.sessionID) return props.part.sessionID;
  return undefined;
}

// Global event stream — routes events to the right managed session
async function startEventStream(client: any) {
  try {
    const events = await client.event.subscribe();
    for await (const event of events.stream) {
      const type = event.type as string;
      const props = event.properties as any;

      // Route event to the right session
      const sessionId = extractSessionId(type, props);
      if (!sessionId) continue;

      const ms = sessions.get(sessionId);
      if (!ms) {
        continue;
      }

      // Map opencode events to our WebSocket protocol
      if (type === "message.part.updated") {
        const part = props.part;
        ms.currentPartType = part.type;

        if (part.type === "text") {
          ms.accumulatedText = "";
          ms.msgSeq++;
        }
        if (part.type === "tool") {
          const state = part.state;
          if (state?.status === "running" || state?.status === "completed") {
            const title = state.title;
            const input = state.input ?? {};
            const label = title || formatToolInput(part.tool, input);
            safeSend(ms, {
              type: "tool_use",
              tool_name: part.tool,
              tool_input: label,
            });
          }
        }
        if (part.type === "step-start") {
          safeSend(ms, { type: "status", status: "thinking" });
        }
      }

      if (type === "message.part.delta") {
        const delta = props?.delta;
        if (delta && ms.currentPartType === "text") {
          ms.accumulatedText += delta;
          safeSend(ms, { type: "assistant", id: ms.msgSeq, content: ms.accumulatedText });
        }
      }

      if (type === "permission.asked") {
        const permId = props.id;
        const permType = props.permission as string || "";
        const patterns: string[] = props.patterns ?? [];

        // Map opencode permission types to Claude Code tool names and readable input
        let toolName: string;
        let input: Record<string, unknown>;
        if (permType === "bash") {
          toolName = "Bash";
          input = { command: patterns.join(" ") };
        } else if (permType === "edit") {
          toolName = "Edit";
          const filePath = props.metadata?.filepath || patterns[0] || "";
          const diff = props.metadata?.diff as string | undefined;
          let old_string = "";
          let new_string = "";
          if (diff) {
            // Parse unified diff to extract removed/added lines
            const removed: string[] = [];
            const added: string[] = [];
            for (const line of diff.split("\n")) {
              if (line.startsWith("-") && !line.startsWith("---")) removed.push(line.slice(1));
              else if (line.startsWith("+") && !line.startsWith("+++")) added.push(line.slice(1));
            }
            old_string = removed.join("\n");
            new_string = added.join("\n");
          }
          input = { file_path: filePath, old_string, new_string };
        } else if (permType === "webfetch") {
          toolName = "WebFetch";
          input = { url: patterns[0] ?? "" };
        } else {
          toolName = permType || "Unknown";
          input = patterns.length > 0 ? { patterns } : (props.metadata ?? {});
        }

        if (permId) {
          ms.pendingPermissions.set(permId, {
            permissionId: permId,
            title: toolName,
            metadata: input,
          });
          safeSend(ms, {
            type: "permission_request",
            toolUseID: permId,
            toolName,
            input,
          });
        }
      }

      if (type === "session.error") {
        const err = props?.error;
        const message = err?.message || err?.type || "Session error";
        safeSend(ms, { type: "error", message });
      }

      if (type === "session.idle") {
        ms.streaming = false;
        safeSend(ms, {
          type: "result",
          subtype: "success",
        });
        if (!ms.connectedSocket || ms.connectedSocket.readyState !== WebSocket.OPEN) {
          startIdleTimer(ms);
        }
      }
    }
  } catch (err: any) {
    console.error("[event-stream] error:", err.message);
    // Reconnect after a brief delay
    setTimeout(() => startEventStream(client), 2000);
  }
}

function formatToolInput(toolName: string, input: Record<string, unknown>): string {
  const name = toolName.toLowerCase().replace(/_/g, "");
  switch (name) {
    case "bash":
      return input.command
        ? (input.description ? `${input.description}: ${input.command}` : `${input.command}`)
        : toolName;
    case "read":
    case "readfile":
      return input.file_path ? `${input.file_path}` : toolName;
    case "write":
    case "writefile":
      if (!input.file_path) return toolName;
      const len = typeof input.content === "string" ? input.content.length : null;
      return len != null ? `${input.file_path} (${len} chars)` : `${input.file_path}`;
    case "edit":
    case "editfile":
      return input.file_path ? `${input.file_path}` : toolName;
    case "glob":
      return input.pattern
        ? (input.path ? `${input.pattern} in ${input.path}` : `${input.pattern}`)
        : toolName;
    case "grep":
      return input.pattern
        ? (input.path ? `/${input.pattern}/ in ${input.path}` : `/${input.pattern}/`)
        : toolName;
    case "task":
      return input.description ? `[${input.subagent_type}] ${input.description}` : toolName;
    case "webfetch":
      return input.url ? `${input.url}` : toolName;
    case "websearch":
      return input.query ? `"${input.query}"` : toolName;
    case "notebookedit":
      return input.notebook_path ? `${input.notebook_path} (${input.edit_mode || "replace"})` : toolName;
    default: {
      // For unknown tools, try to show something useful from input
      const vals = Object.values(input).filter(v => typeof v === "string" && v.length < 100);
      return vals.length > 0 ? `${vals[0]}` : toolName;
    }
  }
}
