import { randomUUID } from "crypto";
import http from "node:http";
import {
  createHttpServer,
  setupShutdown,
  maybeCaffeinate,
  handleWorkspaceRoutes,
  createSession,
  shouldAutoApprove,
  sessions,
  emitEvent,
  scheduleCleanup,
  sseHeaders,
  writeSseEvent,
  parseQuery,
  parsePathParam,
  jsonOk,
  jsonError,
  readBody,
  permissionsEmitter,
  buildPermissionsDump,
  buildSessionsDump,
  notifyPermissionsChanged,
  IRequest,
  IResponse,
  type PermissionMode,
} from "./server-common";
import { initAgent as initClaudeCode, runAgent as runClaudeCode, listSessions as listClaudeSessions, loadTranscript } from "./start-claude-code";
import { initAgent as initOpencode, runAgent as runOpencode, listSessions as listOpencodeSessions, getSessionHistory, abortSession as opencodeAbort, respondPermission as opencodePermission } from "./start-opencode";
import { startRelayMode } from "./relay-client";

export async function handleRequest(
  req: IRequest,
  res: IResponse,
  availableAgents: string[],
  workspaceCwd: string,
): Promise<void> {
  const url = req.url ?? "/";
  const method = req.method ?? "GET";
  const path = url.split("?")[0];
  const query = parseQuery(url);

  // CORS preflight
  if (method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Last-Event-ID, X-Client-Version, X-Daytona-Skip-Preview-Warning",
    });
    res.end();
    return;
  }

  // SPA served by createHttpServer's listener — only handle API routes here
  if (method === "GET" && (path === "/" || path === "")) return;

  try {
    // Workspace + file system routes
    if (await handleWorkspaceRoutes(req, res, workspaceCwd, availableAgents)) return;

    // GET /sessions
    if (method === "GET" && path === "/sessions") {
      const repoPath = query.repoPath ?? workspaceCwd;
      const agent = query.agent as "claude-code" | "opencode" | undefined;

      if (!agent || agent === "claude-code") {
        const list = await listClaudeSessions(repoPath);
        jsonOk(res, { sessions: list });
        return;
      }
      if (agent === "opencode") {
        const list = await listOpencodeSessions(repoPath);
        jsonOk(res, { sessions: list });
        return;
      }
      jsonOk(res, { sessions: [] });
      return;
    }

    // GET /sessions/:id/history
    const historyId = parsePathParam(path, "/sessions/")?.replace(/\/history$/, "");
    if (method === "GET" && path.endsWith("/history") && historyId) {
      const store = sessions.get(historyId);
      if (!store) {
        const agentParam = query.agent as "claude-code" | "opencode" | undefined;
        if (agentParam === "opencode") {
          const history = await getSessionHistory(historyId, query.repoPath ?? workspaceCwd);
          jsonOk(res, { messages: history });
        } else {
          const repoPath = query.repoPath ?? workspaceCwd;
          const history = await loadTranscript(historyId, repoPath);
          jsonOk(res, { messages: history });
        }
        return;
      }
      if (store.agent === "opencode" && store.sdkSessionId) {
        const history = await getSessionHistory(store.sdkSessionId, store.repoPath);
        jsonOk(res, { messages: history });
      } else {
        const history = await loadTranscript(store.sdkSessionId ?? historyId, store.repoPath);
        jsonOk(res, { messages: history });
      }
      return;
    }

    // GET /sessions/:id/config
    const configId = parsePathParam(path, "/sessions/")?.replace(/\/config$/, "");
    if (method === "GET" && path.endsWith("/config") && configId) {
      const store = sessions.get(configId)
        ?? [...sessions.values()].find(s => s.sdkSessionId === configId);
      if (!store) { jsonError(res, 404, "Session not found"); return; }
      jsonOk(res, {
        grassId: store.grassId,
        sessionId: store.sdkSessionId,
        agent: store.agent,
        model: store.model ?? null,
        mode: store.mode ?? null,
        permissionMode: store.permissionMode,
      });
      return;
    }

    // GET /sessions/:id/status
    const statusId = parsePathParam(path, "/sessions/")?.replace(/\/status$/, "");
    if (method === "GET" && path.endsWith("/status") && statusId) {
      const store = sessions.get(statusId)
        ?? [...sessions.values()].find(s => s.sdkSessionId === statusId);
      if (!store) { jsonError(res, 404, "Session not found"); return; }
      jsonOk(res, { streaming: store.status === "running", sdkSessionId: store.sdkSessionId ?? null });
      return;
    }

    // POST /sessions/:id/abort
    const abortId = parsePathParam(path, "/sessions/")?.replace(/\/abort$/, "");
    if (method === "POST" && path.endsWith("/abort") && abortId) {
      const store = sessions.get(abortId)
        ?? [...sessions.values()].find(s => s.sdkSessionId === abortId);
      if (!store) { jsonError(res, 404, "Session not found"); return; }
      if (store.status !== "running") { jsonOk(res, { ok: true }); return; }
      if (store.agent === "claude-code" && store.abortController) {
        store.abortController.abort();
      } else if (store.agent === "opencode" && store.sdkSessionId) {
        await opencodeAbort(store.sdkSessionId, store.repoPath).catch(() => {});
        store.status = "done";
        store.pendingPermissions.clear();
        notifyPermissionsChanged();
        emitEvent(store, "aborted", { message: "Aborted by user" });
        scheduleCleanup(store);
      }
      console.log(`[abort] session ${abortId}`);
      jsonOk(res, { ok: true });
      return;
    }

    // POST /sessions/:id/permission
    const permBase = parsePathParam(path, "/sessions/")?.replace(/\/permission$/, "");
    if (method === "POST" && path.endsWith("/permission") && permBase) {
      const store = sessions.get(permBase);
      if (!store) { jsonError(res, 404, "Session not found"); return; }
      const body = await readBody(req);
      const { toolUseID, approved, updatedInput } = body;
      if (!toolUseID) { jsonError(res, 400, "toolUseID is required"); return; }
      console.log(`[permission] id=${toolUseID} approved=${approved}`);

      if (store.agent === "claude-code") {
        const pending = store.pendingPermissions.get(toolUseID);
        if (pending) {
          store.pendingPermissions.delete(toolUseID);
          notifyPermissionsChanged();
          pending.resolve(approved
            ? { behavior: "allow", updatedInput: updatedInput ?? pending.input }
            : { behavior: "deny", message: "User denied" }
          );
        }
      } else if (store.agent === "opencode" && store.sdkSessionId) {
        const pending = store.pendingPermissions.get(toolUseID);
        if (pending) {
          store.pendingPermissions.delete(toolUseID);
          notifyPermissionsChanged();
          // For subagent permissions, respond on the child sdkSessionId that actually raised the request.
          const respondSdkId = pending.askedBySdkSessionId ?? store.sdkSessionId;
          await opencodePermission(respondSdkId, toolUseID, approved, store.repoPath).catch((err: any) => {
            console.error("Permission response failed:", err.message);
          });
        }
      }
      jsonOk(res, { ok: true });
      return;
    }

    // POST /chat
    if (method === "POST" && path === "/chat") {
      const body = await readBody(req);
      const { repoPath, agent, prompt, sessionId: existingId, model, mode, permissionMode } = body;

      if (!repoPath) { jsonError(res, 400, "repoPath is required"); return; }
      if (!prompt) { jsonError(res, 400, "prompt is required"); return; }
      if (agent !== "claude-code" && agent !== "opencode") {
        jsonError(res, 400, "agent must be claude-code or opencode");
        return;
      }
      if (!availableAgents.includes(agent)) {
        jsonError(res, 400, `Agent '${agent}' is not available`);
        return;
      }

      let store = existingId ? sessions.get(existingId) : undefined;

      if (store) {
        if (store.status === "running") {
          jsonError(res, 409, "Session is already running");
          return;
        }
        store.status = "running";
        notifyPermissionsChanged();
        store.events = [];
        store.seq = 0;
        if (model) store.model = model;
        if (mode) store.mode = mode;
        if (permissionMode) store.permissionMode = permissionMode as PermissionMode;
        emitEvent(store, 'user_prompt', { prompt });
      } else {
        const grassId = existingId ?? randomUUID();
        store = createSession(grassId, agent, repoPath, model, mode, permissionMode as PermissionMode | undefined);
        if (existingId) {
          store.sdkSessionId = existingId;
        }
        emitEvent(store, 'user_prompt', { prompt });
        notifyPermissionsChanged();
      }

      const s = store;
      if (agent === "claude-code") {
        runClaudeCode(s).catch((err) => {
          console.error("[runAgent] unhandled:", err);
        });
      } else {
        runOpencode(s).catch((err) => {
          console.error("[runAgent] unhandled:", err);
        });
      }

      jsonOk(res, { sessionId: s.grassId });
      return;
    }

    // GET /events?sessionId=X
    if (method === "GET" && path === "/events") {
      const sessionId = query.sessionId;
      if (!sessionId) { jsonError(res, 400, "sessionId is required"); return; }

      const store = sessions.get(sessionId)
        ?? [...sessions.values()].find(s => s.sdkSessionId === sessionId);
      if (!store) { jsonError(res, 404, "Session not found"); return; }

      const lastSeq = parseInt(req.headers["last-event-id"] as string ?? "0", 10) || 0;

      res.writeHead(200, sseHeaders());

      for (const event of store.events) {
        if (event.seq > lastSeq) {
          writeSseEvent(res, event);
        }
      }

      if (store.status !== "running") {
        res.end();
        return;
      }

      const listener = (event: any) => {
        writeSseEvent(res, event);
        if (event.type === "done" || event.type === "error" || event.type === "aborted") {
          res.end();
        }
      };

      store.emitter.on("event", listener);

      req.on("close", () => {
        store.emitter.off("event", listener);
      });

      return;
    }

    // GET /permissions/events
    if (method === "GET" && path === "/permissions/events") {
      res.writeHead(200, sseHeaders());

      const sendDump = (permissions: ReturnType<typeof buildPermissionsDump>, sessions: ReturnType<typeof buildSessionsDump>) => {
        if (res.writableEnded) return;
        res.write(`event: permissions\ndata: ${JSON.stringify({ permissions, sessions })}\n\n`);
      };

      sendDump(buildPermissionsDump(), buildSessionsDump());

      permissionsEmitter.on("update", sendDump);
      req.on("close", () => {
        permissionsEmitter.off("update", sendDump);
      });

      return;
    }

    // PATCH /sessions/:id — update session settings mid-run
    if (method === "PATCH" && path.startsWith("/sessions/")) {
      const sessionId = path.slice("/sessions/".length);
      const store = sessions.get(sessionId);
      if (!store) { jsonError(res, 404, "Session not found"); return; }

      const body = await readBody(req);
      if (body.permissionMode !== undefined) {
        const valid: PermissionMode[] = ["ask-permissions", "allow-all-edits", "yolo"];
        if (!valid.includes(body.permissionMode)) {
          jsonError(res, 400, "Invalid permissionMode"); return;
        }
        store.permissionMode = body.permissionMode as PermissionMode;

        if (store.agent === "claude-code") {
          for (const [id, perm] of store.pendingPermissions) {
            if (shouldAutoApprove(store.agent, perm.toolName, store.permissionMode)) {
              store.pendingPermissions.delete(id);
              perm.resolve({ behavior: "allow", updatedInput: perm.input });
            }
          }
          notifyPermissionsChanged();
        } else if (store.agent === "opencode" && store.sdkSessionId) {
          for (const [id, perm] of store.pendingPermissions) {
            if (shouldAutoApprove(store.agent, perm.toolName, store.permissionMode)) {
              store.pendingPermissions.delete(id);
              const respondSdkId = perm.askedBySdkSessionId ?? store.sdkSessionId;
              await opencodePermission(respondSdkId, id, true, store.repoPath).catch(() => {});
            }
          }
          notifyPermissionsChanged();
        }
      }

      jsonOk(res, { sessionId: store.grassId, permissionMode: store.permissionMode });
      return;
    }

    jsonError(res, 404, "Not found");
  } catch (err: any) {
    console.error("[request] unhandled error:", err.message);
    if (!res.headersSent) {
      jsonError(res, 500, "Internal server error");
    }
  }
}

export async function start(network: string = "local", portOverride?: number, caffeinate: boolean = false, relayUrl?: string) {
  const workspaceCwd = process.cwd();
  console.log(`Starting grass server...`);

  const claudeAvailable = await initClaudeCode();
  const opencodeAvailable = await initOpencode();
  const availableAgents: string[] = [
    ...(claudeAvailable ? ["claude-code"] : []),
    ...(opencodeAvailable ? ["opencode"] : []),
  ];
  console.log(`  available agents: ${availableAgents.join(", ") || "none"}`);

  if (relayUrl) {
    const caffeinatePid = maybeCaffeinate(caffeinate);
    setupShutdown(() => {}, caffeinatePid);
    await startRelayMode(relayUrl, availableAgents, workspaceCwd);
    return;
  }

  const { server, caffeinatePid } = await createHttpServer({
    portOverride,
    caffeinate,
    network,
    label: "grass server",
  });

  server.on("request", (req: http.IncomingMessage, res: http.ServerResponse) => {
    handleRequest(req as unknown as IRequest, res as unknown as IResponse, availableAgents, workspaceCwd);
  });

  setupShutdown(() => {
    server.close(() => process.exit(0));
  }, caffeinatePid);
}
