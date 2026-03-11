import { randomUUID } from "crypto";
import http from "node:http";
import {
  createHttpServer,
  setupShutdown,
  handleWorkspaceRoutes,
  createSession,
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
} from "./server-common";
import { initAgent as initClaudeCode, runAgent as runClaudeCode, listSessions as listClaudeSessions, loadTranscript } from "./start-claude-code";
import { initAgent as initOpencode, runAgent as runOpencode, listSessions as listOpencodeSessions, getSessionHistory, abortSession as opencodeAbort, respondPermission as opencodePermission } from "./start-opencode";

export async function start(network: string = "local", portOverride?: number, caffeinate: boolean = false) {
  const workspaceCwd = process.cwd();
  console.log(`Starting grass server...`);

  const { server, caffeinatePid } = await createHttpServer({
    portOverride,
    caffeinate,
    network,
    label: "grass server",
  });

  const claudeAvailable = await initClaudeCode();
  const opencodeAvailable = await initOpencode();
  const availableAgents: string[] = [
    ...(claudeAvailable ? ["claude-code"] : []),
    ...(opencodeAvailable ? ["opencode"] : []),
  ];
  console.log(`  available agents: ${availableAgents.join(", ") || "none"}`);

  server.on("request", async (req: http.IncomingMessage, res: http.ServerResponse) => {
    const url = req.url ?? "/";
    const method = req.method ?? "GET";
    const path = url.split("?")[0];
    const query = parseQuery(url);

    // CORS preflight
    if (method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Last-Event-ID",
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
          // Try loading from disk (claude-code) or API (opencode)
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
        // Store exists — use stored agent type
        if (store.agent === "opencode" && store.sdkSessionId) {
          const history = await getSessionHistory(store.sdkSessionId, store.repoPath);
          jsonOk(res, { messages: history });
        } else {
          const history = await loadTranscript(store.sdkSessionId ?? historyId, store.repoPath);
          jsonOk(res, { messages: history });
        }
        return;
      }

      // GET /sessions/:id/status
      const statusId = parsePathParam(path, "/sessions/")?.replace(/\/status$/, "");
      if (method === "GET" && path.endsWith("/status") && statusId) {
        const store = sessions.get(statusId);
        if (!store) { jsonError(res, 404, "Session not found"); return; }
        jsonOk(res, { streaming: store.status === "running" });
        return;
      }

      // POST /sessions/:id/abort
      const abortId = parsePathParam(path, "/sessions/")?.replace(/\/abort$/, "");
      if (method === "POST" && path.endsWith("/abort") && abortId) {
        const store = sessions.get(abortId);
        if (!store) { jsonError(res, 404, "Session not found"); return; }
        if (store.status !== "running") { jsonOk(res, { ok: true }); return; }
        if (store.agent === "claude-code" && store.abortController) {
          store.abortController.abort();
        } else if (store.agent === "opencode" && store.sdkSessionId) {
          await opencodeAbort(store.sdkSessionId, store.repoPath).catch(() => {});
          // For opencode, session.idle may never arrive — mark done immediately
          store.status = "done";
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
        const { toolUseID, approved } = body;
        if (!toolUseID) { jsonError(res, 400, "toolUseID is required"); return; }
        console.log(`[permission] id=${toolUseID} approved=${approved}`);

        if (store.agent === "claude-code") {
          const pending = store.pendingPermissions.get(toolUseID);
          if (pending) {
            store.pendingPermissions.delete(toolUseID);
            pending.resolve(approved
              ? { behavior: "allow", updatedInput: pending.input }
              : { behavior: "deny", message: "User denied" }
            );
          }
        } else if (store.agent === "opencode" && store.sdkSessionId) {
          const pending = store.pendingPermissions.get(toolUseID);
          if (pending) {
            store.pendingPermissions.delete(toolUseID);
            await opencodePermission(store.sdkSessionId, toolUseID, approved, store.repoPath).catch((err: any) => {
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
        const { repoPath, agent, prompt, sessionId: existingId } = body;

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
          // Resume: reset status and clear old events so SSE replay doesn't re-fire stale done/result
          store.status = "running";
          store.events = [];
          store.seq = 0;
          emitEvent(store, 'user_prompt', { prompt });
        } else {
          const grassId = existingId ?? randomUUID();
          store = createSession(grassId, agent, repoPath);
          // If resuming a known session (from disk), tell the SDK to resume it
          if (existingId) {
            store.sdkSessionId = existingId;
          }
          emitEvent(store, 'user_prompt', { prompt });
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

        const store = sessions.get(sessionId);
        if (!store) { jsonError(res, 404, "Session not found"); return; }

        const lastSeq = parseInt(req.headers["last-event-id"] as string ?? "0", 10) || 0;

        res.writeHead(200, sseHeaders());

        // Replay buffered events the client missed
        for (const event of store.events) {
          if (event.seq > lastSeq) {
            writeSseEvent(res, event);
          }
        }

        if (store.status !== "running") {
          res.end();
          return;
        }

        // Subscribe for live events
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

      jsonError(res, 404, "Not found");
    } catch (err: any) {
      console.error("[request] unhandled error:", err.message);
      if (!res.headersSent) {
        jsonError(res, 500, "Internal server error");
      }
    }
  });

  setupShutdown(() => {
    server.close(() => process.exit(0));
  }, caffeinatePid);
}
