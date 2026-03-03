import { WebSocket } from "ws";
import { basename } from "path";
import {
  clearIdleTimer,
  startIdleTimer,
  safeSend,
  type ManagedSessionBase,
  type ConnectionState,
} from "./server-common";

async function loadOpencodeSdk() {
  const sdk = await import("@opencode-ai/sdk");
  return { createOpencode: sdk.createOpencode, createOpencodeClient: sdk.createOpencodeClient };
}

interface ManagedSession extends ManagedSessionBase {
  currentPartType: string | null;
  accumulatedText: string;
  pendingPermissions: Map<string, { permissionId: string; title: string; metadata: any }>;
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

// Opencode client — initialized once in initAgent()
let client: any = null;

// Called once at server startup. Starts or connects to the opencode backend process.
// Returns true if the agent is available, false otherwise.
export async function initAgent(): Promise<boolean> {
  console.log("  Starting opencode server...");
  const { createOpencode, createOpencodeClient } = await loadOpencodeSdk().catch(() => null) as any;

  if (!createOpencode || !createOpencodeClient) {
    console.warn("  @opencode-ai/sdk not found — opencode agent unavailable");
    return false;
  }

  const permissionConfig = {
    edit: "ask",
    bash: "ask",
    webfetch: "ask",
    doom_loop: "ask",
    external_directory: "ask",
  } as const;

  try {
    const result = await createOpencode({ config: { permission: permissionConfig } });
    client = result.client;
    console.log("  opencode server ready (spawned), permissions: ask mode enabled");
  } catch {
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

  // Subscribe to opencode events globally
  startEventStream();
  return true;
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
      if (ms && ms.streaming) {
        try {
          await client.session.abort({ path: { id: state.attachedSessionId } });
          console.log("Client requested abort");
        } catch (err: any) {
          console.error("Abort failed:", err.message);
        }
      }
    }
    return;
  }

  // --- Permission response ---
  if (parsed.type === "permission_response") {
    const { toolUseID, approved } = parsed;
    if (state.attachedSessionId) {
      const ms = sessions.get(state.attachedSessionId);
      if (ms) {
        const pending = ms.pendingPermissions.get(toolUseID);
        if (pending) {
          ms.pendingPermissions.delete(toolUseID);
          try {
            await client.postSessionIdPermissionsPermissionId({
              path: { id: state.attachedSessionId, permissionID: pending.permissionId },
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

  // --- Session list ---
  if (parsed.type === "list_sessions") {
    try {
      const listOptions = selectedRepoPath
        ? { headers: { "x-opencode-directory": encodeURIComponent(selectedRepoPath) } }
        : undefined;
      const result = await client.session.list(listOptions);
      console.log(`[list_sessions] got ${(result.data ?? []).length} sessions (dir: ${selectedRepoPath ?? "default"})`);
      const sessionList = (result.data ?? []).map((s: any) => ({
        id: s.id,
        preview: s.title || s.id,
        updatedAt: (() => {
          const ts = s.time?.updated || s.time?.created || 0;
          const ms = ts > 1e12 ? ts : ts * 1000;
          return new Date(ms).toISOString();
        })(),
      }));
      sessionList.sort((a: any, b: any) => b.updatedAt.localeCompare(a.updatedAt));
      ws.send(JSON.stringify({ type: "sessions_list", sessions: sessionList }));
    } catch (err: any) {
      console.error("Error listing sessions:", err.message);
      ws.send(JSON.stringify({ type: "sessions_list", sessions: [] }));
    }
    return;
  }

  // --- Init / resume session ---
  if (parsed.type === "init") {
    if (parsed.sessionId && typeof parsed.sessionId === "string") {
      const sessionId = parsed.sessionId;
      console.log("Client requested session resume:", sessionId);

      if (state.attachedSessionId && state.attachedSessionId !== sessionId) {
        const oldMs = sessions.get(state.attachedSessionId);
        if (oldMs && oldMs.connectedSocket === ws) {
          oldMs.connectedSocket = null;
          if (!oldMs.streaming) startIdleTimer(oldMs, sessions);
        }
      }

      state.attachedSessionId = sessionId;

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

  try {
    let sessionId = state.attachedSessionId;

    if (!sessionId) {
      const repoName = basename(selectedRepoPath);
      const sessionResult = await client.session.create({
        body: { title: `[${repoName}] ${parsed.content.slice(0, 60)}` },
      });
      sessionId = (sessionResult.data as any).id;
      state.attachedSessionId = sessionId;
    }

    const ms = getOrCreateManagedSession(sessionId!);
    ms.streaming = true;
    ms.connectedSocket = ws;

    console.log(`[query] sending prompt to opencode session ${sessionId}`);

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
}

// Extract sessionID from any event's properties
function extractSessionId(type: string, props: any): string | undefined {
  if (props?.sessionID) return props.sessionID;
  if (props?.info?.sessionID) return props.info.sessionID;
  if (props?.part?.sessionID) return props.part.sessionID;
  return undefined;
}

// Global event stream — routes events to the right managed session
async function startEventStream() {
  try {
    const events = await client.event.subscribe();
    for await (const event of events.stream) {
      const type = event.type as string;
      const props = event.properties as any;

      const sessionId = extractSessionId(type, props);
      if (!sessionId) continue;

      const ms = sessions.get(sessionId);
      if (!ms) continue;

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
            safeSend(ms, { type: "tool_use", tool_name: part.tool, tool_input: label });
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
          ms.pendingPermissions.set(permId, { permissionId: permId, title: toolName, metadata: input });
          safeSend(ms, { type: "permission_request", toolUseID: permId, toolName, input });
        }
      }

      if (type === "session.error") {
        const err = props?.error;
        const message = err?.message || err?.type || "Session error";
        safeSend(ms, { type: "error", message });
      }

      if (type === "session.idle") {
        ms.streaming = false;
        safeSend(ms, { type: "result", subtype: "success" });
        if (!ms.connectedSocket || ms.connectedSocket.readyState !== WebSocket.OPEN) {
          startIdleTimer(ms, sessions);
        }
      }
    }
  } catch (err: any) {
    console.error("[event-stream] error:", err.message);
    setTimeout(() => startEventStream(), 2000);
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
    case "writefile": {
      if (!input.file_path) return toolName;
      const len = typeof input.content === "string" ? input.content.length : null;
      return len != null ? `${input.file_path} (${len} chars)` : `${input.file_path}`;
    }
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
      const vals = Object.values(input).filter(v => typeof v === "string" && v.length < 100);
      return vals.length > 0 ? `${vals[0]}` : toolName;
    }
  }
}
