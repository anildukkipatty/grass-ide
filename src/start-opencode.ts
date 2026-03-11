import { basename } from "path";
import {
  emitEvent,
  scheduleCleanup,
  sessions,
  type SessionStore,
} from "./server-common";

async function loadOpencodeSdk() {
  const sdk = await import("@opencode-ai/sdk");
  return { createOpencode: sdk.createOpencode, createOpencodeClient: sdk.createOpencodeClient };
}

// Per-directory opencode clients
const clientsByDir = new Map<string, any>();

// Reverse-lookup: opencode session ID → grass session ID
const sdkIdToGrassId = new Map<string, string>();

let sdkLoaded: any = null;

const permissionConfig = {
  edit: "ask",
  bash: "ask",
  webfetch: "ask",
  doom_loop: "ask",
  external_directory: "ask",
} as const;

export async function initAgent(): Promise<boolean> {
  console.log("  Starting opencode server...");
  const loaded = await loadOpencodeSdk().catch(() => null) as any;

  if (!loaded?.createOpencode || !loaded?.createOpencodeClient) {
    console.warn("  @opencode-ai/sdk not found — opencode agent unavailable");
    return false;
  }

  sdkLoaded = loaded;

  try {
    const result = await loaded.createOpencode({ config: { permission: permissionConfig } });
    // Seed the default client (no directory) from the spawned server's client
    clientsByDir.set("", result.client);
    console.log("  opencode server ready (spawned), permissions: ask mode enabled");
  } catch {
    console.log("  opencode server already running");
  }

  return true;
}

async function getClientForDir(directory: string): Promise<any> {
  if (clientsByDir.has(directory)) return clientsByDir.get(directory);

  const { createOpencodeClient } = sdkLoaded;
  const client = createOpencodeClient({ baseUrl: "http://127.0.0.1:4096", directory });
  clientsByDir.set(directory, client);

  try {
    const configResult = await client.config.get();
    const currentConfig = (configResult.data ?? {}) as Record<string, any>;
    await client.config.update({
      body: { ...currentConfig, permission: permissionConfig },
    });
    console.log(`  permissions: ask mode enabled (dir: ${directory})`);
  } catch (err: any) {
    console.warn("  permissions: could not set permission config:", err?.message);
  }

  startEventStream(client, directory);
  return client;
}

export async function runAgent(store: SessionStore): Promise<void> {
  const prompt = store.events.find(e => e.type === "user_prompt")?.prompt as string ?? "";
  (store as any)._msgRoles = new Map<string, string>();
  const client = await getClientForDir(store.repoPath);

  try {
    if (!store.sdkSessionId) {
      const repoName = basename(store.repoPath);
      const sessionResult = await client.session.create({
        body: { title: `[${repoName}] ${prompt.slice(0, 60)}` },
        query: { directory: store.repoPath },
      });
      const sdkId = (sessionResult.data as any).id as string;
      const sessionDir = (sessionResult.data as any).directory;
      console.log(`[query] created opencode session ${sdkId}, directory: ${sessionDir}`);
      store.sdkSessionId = sdkId;
    }
    // Always register the mapping so event stream can find the store
    sdkIdToGrassId.set(store.sdkSessionId!, store.grassId);

    console.log(`[query] sending prompt to opencode session ${store.sdkSessionId}`);

    // Use promptAsync so the request returns immediately; completion signaled via event stream
    const promptResult = await client.session.promptAsync({
      path: { id: store.sdkSessionId! },
      body: {
        parts: [{ type: "text", text: prompt }],
      },
    });
    if (promptResult.error) {
      const errMsg = (promptResult.error as any)?.detail || (promptResult.error as any)?.message || "Prompt failed";
      console.error("[query] promptAsync error:", errMsg);
      emitEvent(store, "agent_error", { message: errMsg });
      store.status = "error";
      scheduleCleanup(store);
      return;
    }
    console.log(`[query] promptAsync accepted, waiting for events`);
    // completion signaled via event stream (session.idle or session.status idle)
  } catch (err: any) {
    console.error("[query] error:", err.message);
    emitEvent(store, "agent_error", { message: err?.message ?? "Unknown error" });
    store.status = "error";
    scheduleCleanup(store);
  }
}

export async function getSessionHistory(sdkSessionId: string, directory: string = ""): Promise<{ role: string; content: string }[]> {
  const client = await getClientForDir(directory);
  try {
    const messagesResult = await client.session.messages({ path: { id: sdkSessionId } });
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
    return history;
  } catch (err: any) {
    console.error("Error loading opencode history:", err.message);
    return [];
  }
}

export async function listSessions(
  repoPath: string
): Promise<{ id: string; preview: string; updatedAt: string }[]> {
  const client = await getClientForDir(repoPath);
  try {
    const listOptions = repoPath ? { query: { directory: repoPath } } : undefined;
    const result = await client.session.list(listOptions);
    console.log(`[list_sessions] got ${(result.data ?? []).length} sessions (dir: ${repoPath ?? "default"})`);
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
    return sessionList;
  } catch (err: any) {
    console.error("Error listing sessions:", err.message);
    return [];
  }
}

export async function abortSession(sdkSessionId: string, directory: string = ""): Promise<void> {
  const client = await getClientForDir(directory);
  await client.session.abort({ path: { id: sdkSessionId } });
}

export async function respondPermission(
  sdkSessionId: string,
  permissionId: string,
  approved: boolean,
  directory: string = ""
): Promise<void> {
  const client = await getClientForDir(directory);
  await client.postSessionIdPermissionsPermissionId({
    path: { id: sdkSessionId, permissionID: permissionId },
    body: { response: approved ? "once" : "reject" },
  });
}

// Extract sessionID from any event's properties
function extractSessionId(_type: string, props: any): string | undefined {
  if (props?.sessionID) return props.sessionID;
  if (props?.info?.sessionID) return props.info.sessionID;
  if (props?.part?.sessionID) return props.part.sessionID;
  return undefined;
}

function findStoreByOpencodeSdkId(sdkId: string): SessionStore | undefined {
  const grassId = sdkIdToGrassId.get(sdkId);
  if (!grassId) return undefined;
  return sessions.get(grassId);
}

async function startEventStream(client: any, directory: string) {
  try {
    const events = await client.event.subscribe();
    for await (const event of events.stream) {
      const type = event.type as string;
      const props = event.properties as any;
      const logTypes = new Set(["message.updated", "message.part.updated", "session.status", "permission.asked", "permission.replied"]);
      if (logTypes.has(type)) console.log(`[event-stream] ${type}: ${JSON.stringify(props).slice(0, 500)}`);

      const sdkSessionId = extractSessionId(type, props);
      if (!sdkSessionId) continue;

      const store = findStoreByOpencodeSdkId(sdkSessionId);
      if (!store) continue;

      // Track message roles so we can filter out user message parts
      if (type === "message.updated") {
        const info = props.info;
        if (info?.id && info?.role) {
          if (!(store as any)._msgRoles) (store as any)._msgRoles = new Map<string, string>();
          (store as any)._msgRoles.set(info.id, info.role);
        }
      }

      if (type === "message.part.updated") {
        const part = props.part;
        const msgRole = (store as any)._msgRoles?.get(part.messageID);

        if (part.type === "text") {
          const text = part.text ?? "";
          if (text && msgRole === "assistant") {
            emitEvent(store, "assistant", { content: text });
          }
        }
        if (part.type === "tool") {
          const state = part.state;
          if (state?.status === "running" || state?.status === "completed") {
            const title = state.title;
            const input = state.input ?? {};
            const label = title || formatToolInput(part.tool, input);
            emitEvent(store, "tool_use", { tool_name: part.tool, tool_input: label });
          }
        }
        if (part.type === "step-start") {
          emitEvent(store, "status", { status: "thinking" });
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
            for (const line of (diff as string).split("\n")) {
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
          toolName = permType || props.title || "Unknown";
          input = patterns.length > 0 ? { patterns } : (props.metadata ?? {});
        }

        if (permId) {
          store.pendingPermissions.set(permId, {
            resolve: () => {},
            input,
            toolName,
            toolUseID: permId,
          });
          emitEvent(store, "permission_request", { toolUseID: permId, toolName, input });
        }
      }

      if (type === "session.error") {
        const err = props?.error;
        const message = err?.data?.message || err?.message || err?.name || "Session error";
        emitEvent(store, "agent_error", { message });
        store.status = "error";
        scheduleCleanup(store);
      }

      if (type === "session.idle" || (type === "session.status" && props?.status?.type === "idle")) {
        store.status = "done";
        emitEvent(store, "done", {});
        scheduleCleanup(store);
      }
    }
  } catch (err: any) {
    console.error("[event-stream] error:", err.message);
    setTimeout(() => startEventStream(client, directory), 2000);
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
