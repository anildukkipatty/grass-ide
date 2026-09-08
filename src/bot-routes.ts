import {
  jsonOk,
  jsonError,
  readBody,
  parseQuery,
  IRequest,
  IResponse,
} from "./server-common";
import {
  listBots,
  getBot,
  createBot,
  updateBot,
  deleteBot,
  listThreads,
  getThread,
  createThread,
  updateThread,
  deleteThread,
  type Bot,
} from "./bot-store";
import { loadTranscript } from "./start-claude-code";

/**
 * REST surface for the bot hub: bots, their threads, and a thread's messages.
 * Messages are not stored here — they are read back from Claude Code's own
 * transcript using the thread's sdkSessionId.
 *
 * Returns true when the request was handled.
 */
export async function handleBotRoutes(
  req: IRequest,
  res: IResponse,
  workspaceCwd: string
): Promise<boolean> {
  const url = req.url ?? "/";
  const method = req.method ?? "GET";
  const path = url.split("?")[0];
  const query = parseQuery(url);

  // --- Bots ---

  if (path === "/bots") {
    if (method === "GET") {
      jsonOk(res, { bots: listBots() });
      return true;
    }
    if (method === "POST") {
      const body = await readBody(req);
      if (typeof body.name !== "string" || !body.name.trim()) {
        jsonError(res, 400, "name is required");
        return true;
      }
      jsonOk(res, { bot: createBot({ ...body, name: body.name.trim() }) });
      return true;
    }
  }

  const botId = matchId(path, "/bots/");
  if (botId) {
    if (method === "GET") {
      const bot = getBot(botId);
      if (!bot) { jsonError(res, 404, "Bot not found"); return true; }
      jsonOk(res, { bot });
      return true;
    }
    if (method === "PATCH") {
      const body = await readBody(req);
      const bot = updateBot(botId, body as Partial<Bot>);
      if (!bot) { jsonError(res, 404, "Bot not found"); return true; }
      jsonOk(res, { bot });
      return true;
    }
    if (method === "DELETE") {
      if (!deleteBot(botId)) { jsonError(res, 404, "Bot not found"); return true; }
      jsonOk(res, { deleted: true });
      return true;
    }
  }

  // --- Threads ---

  if (path === "/threads") {
    if (method === "GET") {
      jsonOk(res, { threads: listThreads(query.botId) });
      return true;
    }
    if (method === "POST") {
      const body = await readBody(req);
      const bot = body.botId ? getBot(body.botId) : undefined;
      if (!bot) { jsonError(res, 400, "a valid botId is required"); return true; }
      const repoPath = body.repoPath ?? bot.repoPath ?? workspaceCwd;
      jsonOk(res, { thread: createThread(bot.id, repoPath, body.title) });
      return true;
    }
  }

  // /threads/:id/messages must be matched before /threads/:id
  const messagesId = matchId(path, "/threads/", "/messages");
  if (messagesId && method === "GET") {
    const thread = getThread(messagesId);
    if (!thread) { jsonError(res, 404, "Thread not found"); return true; }
    // A thread that has not had a turn yet has no transcript on disk.
    const messages = thread.sdkSessionId
      ? await loadTranscript(thread.sdkSessionId, thread.repoPath)
      : [];
    jsonOk(res, { messages });
    return true;
  }

  const threadId = matchId(path, "/threads/");
  if (threadId) {
    if (method === "GET") {
      const thread = getThread(threadId);
      if (!thread) { jsonError(res, 404, "Thread not found"); return true; }
      jsonOk(res, { thread });
      return true;
    }
    if (method === "PATCH") {
      const body = await readBody(req);
      const thread = updateThread(threadId, body);
      if (!thread) { jsonError(res, 404, "Thread not found"); return true; }
      jsonOk(res, { thread });
      return true;
    }
    if (method === "DELETE") {
      if (!deleteThread(threadId)) { jsonError(res, 404, "Thread not found"); return true; }
      jsonOk(res, { deleted: true });
      return true;
    }
  }

  return false;
}

/** Extracts a single path segment: matchId("/bots/abc", "/bots/") -> "abc". */
function matchId(path: string, prefix: string, suffix = ""): string | null {
  if (!path.startsWith(prefix)) return null;
  let rest = path.slice(prefix.length);
  if (suffix) {
    if (!rest.endsWith(suffix)) return null;
    rest = rest.slice(0, -suffix.length);
  }
  if (!rest || rest.includes("/")) return null;
  return rest;
}
