import { randomUUID } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "fs";
import { basename, join } from "path";
import { homedir } from "os";

// --- Types ---

export interface Bot {
  id: string;
  name: string;
  description: string;
  emoji: string;
  /** Appended to Claude Code's own system prompt. This is the bot's job description. */
  instructions: string;
  model?: string;
  /** Default working directory for new threads. Threads may override. */
  repoPath?: string;
  permissionMode: "ask-permissions" | "auto-approve" | "plan";
  allowedTools?: string[];
  disallowedTools?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Thread {
  id: string;
  botId: string;
  /** Claude Code session id — the resume handle. Null until the first turn completes. */
  sdkSessionId: string | null;
  title: string;
  /** True while the title is still auto-derived, so a later turn may improve it. */
  titleIsAuto?: boolean;
  repoPath: string;
  preview: string;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

export type NewBot = Partial<Bot> & Pick<Bot, "name">;

// --- Storage ---
// Two JSON files under ~/.grass. Small collections, read fully and written atomically.
// All access goes through this module so the backing store can be swapped later.

const DATA_DIR = process.env.GRASS_DATA_DIR ?? join(homedir(), ".grass");
const BOTS_FILE = join(DATA_DIR, "bots.json");
const THREADS_FILE = join(DATA_DIR, "threads.json");

function readCollection<T>(file: string): T[] {
  if (!existsSync(file)) return [];
  try {
    const parsed = JSON.parse(readFileSync(file, "utf-8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch (err: any) {
    console.error(`[bot-store] could not read ${file}: ${err.message}`);
    return [];
  }
}

function writeCollection<T>(file: string, items: T[]): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(items, null, 2), "utf-8");
  renameSync(tmp, file);
}

const now = () => new Date().toISOString();

// --- Bots ---

export function listBots(): Bot[] {
  return readCollection<Bot>(BOTS_FILE).sort((a, b) => a.name.localeCompare(b.name));
}

export function getBot(id: string): Bot | undefined {
  return readCollection<Bot>(BOTS_FILE).find((b) => b.id === id);
}

export function createBot(input: NewBot): Bot {
  const bots = readCollection<Bot>(BOTS_FILE);
  const ts = now();
  const bot: Bot = {
    id: randomUUID(),
    name: input.name,
    description: input.description ?? "",
    emoji: input.emoji ?? "🤖",
    instructions: input.instructions ?? "",
    model: input.model,
    repoPath: input.repoPath,
    permissionMode: input.permissionMode ?? "ask-permissions",
    allowedTools: input.allowedTools,
    disallowedTools: input.disallowedTools,
    createdAt: ts,
    updatedAt: ts,
  };
  bots.push(bot);
  writeCollection(BOTS_FILE, bots);
  return bot;
}

export function updateBot(id: string, patch: Partial<Bot>): Bot | undefined {
  const bots = readCollection<Bot>(BOTS_FILE);
  const idx = bots.findIndex((b) => b.id === id);
  if (idx === -1) return undefined;
  const { id: _ignored, createdAt: _created, ...rest } = patch;
  bots[idx] = { ...bots[idx], ...rest, updatedAt: now() };
  writeCollection(BOTS_FILE, bots);
  return bots[idx];
}

/** Deletes the bot and every thread belonging to it. */
export function deleteBot(id: string): boolean {
  const bots = readCollection<Bot>(BOTS_FILE);
  const remaining = bots.filter((b) => b.id !== id);
  if (remaining.length === bots.length) return false;
  writeCollection(BOTS_FILE, remaining);
  const threads = readCollection<Thread>(THREADS_FILE);
  writeCollection(THREADS_FILE, threads.filter((t) => t.botId !== id));
  return true;
}

// --- Threads ---

export function listThreads(botId?: string): Thread[] {
  const threads = readCollection<Thread>(THREADS_FILE);
  return threads
    .filter((t) => !botId || t.botId === botId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getThread(id: string): Thread | undefined {
  return readCollection<Thread>(THREADS_FILE).find((t) => t.id === id);
}

export function createThread(botId: string, repoPath: string, title?: string): Thread {
  const threads = readCollection<Thread>(THREADS_FILE);
  const ts = now();
  const thread: Thread = {
    id: randomUUID(),
    botId,
    sdkSessionId: null,
    title: title ?? defaultTitle(repoPath),
    titleIsAuto: !title,
    repoPath,
    preview: "",
    messageCount: 0,
    createdAt: ts,
    updatedAt: ts,
  };
  threads.push(thread);
  writeCollection(THREADS_FILE, threads);
  return thread;
}

export function updateThread(id: string, patch: Partial<Thread>): Thread | undefined {
  const threads = readCollection<Thread>(THREADS_FILE);
  const idx = threads.findIndex((t) => t.id === id);
  if (idx === -1) return undefined;
  const { id: _ignored, botId: _bot, createdAt: _created, ...rest } = patch;
  threads[idx] = { ...threads[idx], ...rest, updatedAt: now() };
  // A title the caller set by hand is the user's, not ours to overwrite.
  if (rest.title !== undefined && rest.titleIsAuto === undefined) threads[idx].titleIsAuto = false;
  writeCollection(THREADS_FILE, threads);
  return threads[idx];
}

export function deleteThread(id: string): boolean {
  const threads = readCollection<Thread>(THREADS_FILE);
  const remaining = threads.filter((t) => t.id !== id);
  if (remaining.length === threads.length) return false;
  writeCollection(THREADS_FILE, remaining);
  return true;
}

/**
 * Binds a thread to the Claude Code session that backs it. Called once, when the
 * SDK reports its session id on the first turn; that id is the resume handle.
 */
export function bindSession(id: string, sdkSessionId: string): Thread | undefined {
  const thread = getThread(id);
  if (!thread || thread.sdkSessionId) return thread;
  return updateThread(id, { sdkSessionId });
}

/**
 * Records a turn on a thread, keeping the title and preview useful in the
 * thread list.
 */
export function touchThread(id: string, prompt: string): Thread | undefined {
  const thread = getThread(id);
  if (!thread) return undefined;
  const patch: Partial<Thread> = { messageCount: thread.messageCount + 1 };
  if (prompt) {
    patch.preview = prompt.slice(0, 140);
    // Conversations open with "hi" as often as not, so keep looking for a name
    // until a turn actually says what the thread is about.
    if (thread.titleIsAuto !== false) {
      const derived = titleFromPrompt(prompt);
      if (derived) { patch.title = derived; patch.titleIsAuto = false; }
    }
  }
  return updateThread(id, patch);
}

/** A thread with no turns yet is named after the folder it will run in. */
function defaultTitle(repoPath: string): string {
  const folder = basename(repoPath || "").trim();
  return folder ? `New thread in ${folder}` : "New thread";
}

/** Prompts that name nothing: greetings, acknowledgements, nudges. */
const LOW_SIGNAL = /^(?:hi|hey|hello|yo|sup|hiya|howdy|good (?:morning|afternoon|evening)|greetings|thanks|thank you|ty|ok|okay|k|kk|cool|nice|great|got it|sure|yes|yep|yeah|no|nope|nah|continue|carry on|go on|go ahead|proceed|next|more|again|do it|please do|test|testing|ping|\?+|.)[\s!.,?]*$/i;

/** Openers that carry no meaning in a list of thread names. */
const FILLER = /^(?:hey|hi|hello|ok|okay|so|now|please|pls|can you(?: please)?|could you(?: please)?|would you(?: please)?|i want you to|i need you to|i'd like you to|let's|lets|help me|i want to|i need to)\b[\s,:-]*/i;

/**
 * Names a thread after a prompt, or returns null when the prompt says too
 * little to name anything. The aim is a label that reads well in a list: one
 * short phrase, no markdown scaffolding, no mid-word cut.
 */
function titleFromPrompt(prompt: string): string | null {
  let text = prompt
    .replace(/```[\s\S]*?```/g, " ")           // fenced code says nothing useful
    .replace(/`([^`]*)`/g, "$1")               // keep inline code, drop the ticks
    .replace(/^\s*(?:[#>*\-+]+|\d+[.)])\s*/gm, "") // markdown bullets/headings
    .replace(/\s+/g, " ")
    .trim();

  if (LOW_SIGNAL.test(text)) return null;

  // Strip leading pleasantries ("hi, can you please ..."), then cut at the
  // first sentence end.
  for (let prev = ""; prev !== text; ) { prev = text; text = text.replace(FILLER, "").trim(); }
  const sentence = text.match(/^[^.!?\n]{8,}?(?=[.!?](?:\s|$))/);
  if (sentence) text = sentence[0].trim();
  text = text.replace(/[\s,;:.\-]+$/, "");
  // Two words or a handful of characters is a fragment, not a name.
  if (text.length < 12 || text.split(" ").length < 3) return null;

  const MAX = 52;
  if (text.length > MAX) {
    const cut = text.slice(0, MAX);
    const space = cut.lastIndexOf(" ");
    text = (space > 20 ? cut.slice(0, space) : cut).replace(/[\s,;:.\-]+$/, "") + "\u2026";
  }
  return text.charAt(0).toUpperCase() + text.slice(1);
}
