import { randomUUID } from "crypto";
import { existsSync } from "fs";
import {
  createSession,
  sessions,
  emitEvent,
  notifyPermissionsChanged,
  notifySessionStarted,
  notifySessionEnded,
  botPermissionToSession,
  type BotPreset,
  type PermissionMode,
  type SessionStore,
} from "./server-common";
import { touchThread, type Bot, type Thread } from "./bot-store";
import { runAgent as runClaudeCode } from "./start-claude-code";

/**
 * Starts one turn on a hub thread: the user's prompt goes to the Claude Code
 * session behind the thread, resuming it when there is one. This is the single
 * path for turns started from the UI (/chat) and turns started by Jarvis when
 * it delegates to, or hands off to, a project agent.
 *
 * Returns the live session store; `done` resolves when the turn has ended,
 * with the agent's final result text when it produced one.
 */
export interface TurnOptions {
  prompt: string;
  attachments?: Array<{ url: string }>;
  model?: string;
  permissionMode?: PermissionMode;
  mode?: "plan" | "build";
  /** Suppress the completion push; Jarvis relays the outcome itself. */
  silent?: boolean;
}

export class TurnBusyError extends Error {
  constructor() { super("Session is already running"); }
}

export function beginThreadTurn(thread: Thread, bot: Bot, opts: TurnOptions): { store: SessionStore; done: Promise<string> } {
  const isSetup = thread.kind === "setup";
  const botPermission = botPermissionToSession(bot.permissionMode);
  const preset: BotPreset = {
    id: bot.id,
    name: bot.name,
    instructions: bot.instructions,
    allowedTools: bot.allowedTools,
    disallowedTools: bot.disallowedTools,
    ...(isSetup ? { setup: true, setupInstructions: bot.setupInstructions } : {}),
    ...(bot.role === "jarvis" ? { jarvis: true } : {}),
  };
  const model = opts.model ?? bot.model;
  const permissionMode = opts.permissionMode ?? botPermission.permissionMode;
  const mode = opts.mode ?? botPermission.mode;
  const promptEvent = { prompt: opts.prompt, ...(opts.attachments?.length ? { attachments: opts.attachments } : {}) };

  if (thread.repoPath && !existsSync(thread.repoPath)) {
    throw new Error(`Working directory no longer exists: ${thread.repoPath}. The folder may have been renamed or moved.`);
  }

  let store = thread.sdkSessionId ? sessions.get(thread.sdkSessionId) : undefined;
  if (store) {
    if (store.status === "running") throw new TurnBusyError();
    store.status = "running";
    notifyPermissionsChanged();
    store.events = [];
    store.seq = 0;
    if (model) store.model = model;
    if (mode) store.mode = mode;
    store.permissionMode = permissionMode;
    store.threadId = thread.id;
    store.botPreset = preset;
    store.silent = opts.silent;
    emitEvent(store, "user_prompt", promptEvent);
  } else {
    // The thread's SDK session id doubles as the hub id, so a thread resumed
    // after a restart is found by the same key next time.
    const id = thread.sdkSessionId ?? randomUUID();
    store = createSession(id, "claude-code", thread.repoPath, model, mode, permissionMode, { threadId: thread.id, preset });
    if (thread.sdkSessionId) store.sdkSessionId = thread.sdkSessionId;
    store.silent = opts.silent;
    emitEvent(store, "user_prompt", promptEvent);
    notifyPermissionsChanged();
  }

  const s = store;
  touchThread(thread.id, opts.prompt);
  notifySessionStarted();
  const done = runClaudeCode(s)
    .catch((err) => { console.error("[runAgent] unhandled:", err); })
    .finally(() => notifySessionEnded())
    .then(() => finalText(s));
  return { store: s, done };
}

/** The agent's closing message for a turn, from the events it emitted. */
export function finalText(store: SessionStore): string {
  const result = [...store.events].reverse().find((e) => e.type === "result");
  if (result && typeof result.result === "string" && result.result.trim()) return result.result;
  // No result (aborted, errored): fall back to whatever text was streamed.
  const text = store.events.filter((e) => e.type === "assistant").map((e) => e.content).join("");
  const error = [...store.events].reverse().find((e) => e.type === "error" || e.type === "aborted");
  return text || (error ? `(${error.type}: ${error.message})` : "");
}

/** Every thread with a turn in flight, for a client that just (re)opened. */
export function activeTurns(): { threadId: string; sessionId: string }[] {
  const out: { threadId: string; sessionId: string }[] = [];
  for (const s of sessions.values()) {
    if (s.status === "running" && s.threadId) out.push({ threadId: s.threadId, sessionId: s.gitbotId });
  }
  return out;
}
