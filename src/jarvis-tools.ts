import { createSdkMcpServer, tool, type McpSdkServerConfigWithInstance } from "@anthropic-ai/claude-agent-sdk";
import { execFile } from "child_process";
import { promisify } from "util";
import { z } from "zod";
import { emitEvent, type SessionStore } from "./server-common";
import { createThread, listThreads, type Thread } from "./bot-store";
import {
  listProjects,
  findProject,
  createProject,
  updateProjectNotes,
  unregisteredFolders,
  ensureProjectBot,
  projectFile,
  type Project,
} from "./jarvis";
import { beginThreadTurn, TurnBusyError } from "./turns";

/**
 * The tools that make Jarvis more than a chat: it sees the projects, can add
 * one, and can put a project agent to work — either waiting for a report
 * (delegate) or handing the conversation over (handoff). They run in-process
 * via the SDK's MCP bridge, so a tool call is a plain function call here.
 *
 * Both dispatch tools start a real turn on a real hub thread under the
 * project's bot, so what Jarvis dispatches shows up in the UI like any other
 * work and can be rejoined, continued or read back later.
 */
export const JARVIS_MCP_NAME = "jarvis";

export function buildJarvisTools(store: SessionStore, workspaceCwd: string): McpSdkServerConfigWithInstance {
  const text = (s: string) => ({ content: [{ type: "text" as const, text: s }] });
  const fail = (s: string) => ({ content: [{ type: "text" as const, text: s }], isError: true });

  return createSdkMcpServer({
    name: JARVIS_MCP_NAME,
    version: "1.0.0",
    tools: [
      tool(
        "list_projects",
        "Every project Jarvis knows (name, slug, checkout path, remote, first line of notes), plus folders in the workspace that no project has claimed yet.",
        {},
        async () => text(JSON.stringify({
          projects: listProjects().map(summary),
          unclaimed_folders: unregisteredFolders(workspaceCwd),
          workspace: workspaceCwd,
        }, null, 2)),
      ),

      tool(
        "read_project",
        "The full notes of one project, by name or slug.",
        { project: z.string().describe("Project name or slug, as the user refers to it") },
        async ({ project }) => {
          const p = findProject(project);
          if (!p) return fail(`No project matches "${project}". Call list_projects to see what exists.`);
          return text(JSON.stringify({ ...summary(p), notes: p.notes }, null, 2));
        },
      ),

      tool(
        "create_project",
        "Register a new project. Give a repo URL to clone it into the workspace, or the path of a folder that already exists. Creates the project file and the project's agent.",
        {
          name: z.string().describe("The name the user uses for the project"),
          repo: z.string().optional().describe("Git URL to clone, e.g. https://github.com/org/repo"),
          path: z.string().optional().describe("Absolute path of an existing checkout to adopt instead of cloning"),
          notes: z.string().optional().describe("Initial Markdown notes: what the project is, people, commands"),
        },
        async ({ name, repo, path, notes }) => {
          try {
            const p = createProject({ name, repo, path, notes }, workspaceCwd);
            emitEvent(store, "project_created", { project: summary(p) });
            return text(`Created project "${p.name}" (slug ${p.slug}) at ${p.path}.`);
          } catch (err: any) {
            return fail(err?.message ?? "Could not create the project");
          }
        },
      ),

      tool(
        "update_project",
        "Rewrite a project's notes (the Markdown under its front matter). Read them first and pass the whole new text; use this to record what you learn.",
        {
          project: z.string().describe("Project name or slug"),
          notes: z.string().describe("The complete new notes in Markdown"),
        },
        async ({ project, notes }) => {
          const p = findProject(project);
          if (!p) return fail(`No project matches "${project}".`);
          try {
            updateProjectNotes(p.slug, notes);
            return text(`Updated notes for ${p.name}.`);
          } catch (err: any) {
            return fail(err?.message ?? "Could not update the project");
          }
        },
      ),

      tool(
        "find_repos",
        "Search the user's GitHub for a repository: their own repos and every organisation they belong to. Use it when the user names a project you do not have and no workspace folder matches, before asking them for a URL — then pass the clone URL to create_project.",
        {
          query: z.string().optional().describe("Words to match against the repo name and description, e.g. 'relay' or 'expo client'. Omit to list everything."),
          owner: z.string().optional().describe("Restrict to one user or organisation login. Omit to search the user's account and all their orgs."),
          limit: z.number().optional().describe("Maximum repos to return (default 30)"),
        },
        async ({ query, owner, limit }) => {
          try {
            const { repos, searched, warnings } = await findRepos({ query, owner, limit: limit ?? 30 });
            const note = warnings.length ? { incomplete_results: warnings, tell_the_user: "Say this to the user; it is something only they can fix." } : {};
            if (!repos.length) {
              return text(JSON.stringify({
                repos: [],
                searched_owners: searched,
                ...note,
                next: `Nothing on GitHub matches ${query ? `"${query}"` : "that"}${owner ? ` under ${owner}` : ""}. Report any incomplete_results above, then ask the user for the repo URL.`,
              }, null, 2));
            }
            return text(JSON.stringify({ repos, searched_owners: searched, ...note }, null, 2));
          } catch (err: any) {
            if (err instanceof GhSetupError) {
              emitEvent(store, "github_unavailable", { kind: err.kind, message: err.message });
              return fail(`GITHUB IS NOT SET UP ON THIS MACHINE. Tell the user exactly this, including the command, and do not ask them for a repo URL until you have:\n\n${err.message}`);
            }
            return fail(`${err?.message ?? "Could not reach GitHub"}. Tell the user the search failed and why.`);
          }
        },
      ),

      tool(
        "delegate",
        "Give a project's agent a bounded task and wait for its report, so you can combine it with other things. Blocks until the agent finishes (seconds to many minutes); call it for several projects in parallel when a request spans projects. Not for a request about a single project, however small — that is a handoff, so the user's follow-ups land in the project.",
        {
          project: z.string().describe("Project name or slug"),
          task: z.string().describe("The task, self-contained: what to do, what to report back, and any constraints such as 'do not merge'"),
        },
        async ({ project, task }) => {
          const p = findProject(project);
          if (!p) return fail(`No project matches "${project}". Ask the user which repository it is, then create_project.`);
          if (p.pathMissing) return fail(`The checkout for "${p.name}" no longer exists at ${p.path}. The folder may have been renamed or moved. Ask the user for the new path, then update the project file at ${projectFile(p.slug)}.`);
          try {
            const bot = ensureProjectBot(p);
            const thread = createThread(bot.id, p.path, titleFor(task));
            const { store: child, done } = beginThreadTurn(thread, bot, { prompt: delegatedPrompt(task), silent: true });
            emitEvent(store, "delegation", { project: summary(p), botId: bot.id, threadId: thread.id, sessionId: child.gitbotId, title: thread.title, status: "running" });
            const report = await done;
            emitEvent(store, "delegation", { project: summary(p), botId: bot.id, threadId: thread.id, sessionId: child.gitbotId, title: thread.title, status: child.status === "done" ? "done" : "error" });
            return text(`Report from ${p.name} (thread ${thread.id}):\n\n${report || "(the agent produced no final message)"}`);
          } catch (err: any) {
            return fail(err?.message ?? "Delegation failed");
          }
        },
      ),

      tool(
        "handoff",
        "Move this conversation into a project. The default for any request about one project, including quick questions: the project's agent receives the message, answers the user directly, and keeps the context for their follow-ups. End your turn immediately after calling this, with at most one short line. Pass the user's request in full, with any context you gathered.",
        {
          project: z.string().describe("Project name or slug"),
          message: z.string().describe("The message for the project agent: the user's request as they put it, plus context and constraints"),
          continue_thread: z.boolean().optional().describe("Continue the project's most recent thread instead of opening a new one; use when the user is clearly following up on earlier work there"),
        },
        async ({ project, message, continue_thread }) => {
          const p = findProject(project);
          if (!p) return fail(`No project matches "${project}". Ask the user which repository it is, then create_project.`);
          if (p.pathMissing) return fail(`The checkout for "${p.name}" no longer exists at ${p.path}. The folder may have been renamed or moved. Ask the user for the new path, then update the project file at ${projectFile(p.slug)}.`);
          const bot = ensureProjectBot(p);
          let thread: Thread | undefined;
          if (continue_thread) thread = listThreads(bot.id).find((t) => t.kind !== "setup");
          if (!thread) thread = createThread(bot.id, p.path, titleFor(message));
          try {
            const { store: child } = beginThreadTurn(thread, bot, { prompt: message });
            emitEvent(store, "handoff", { project: summary(p), botId: bot.id, threadId: thread.id, sessionId: child.gitbotId, title: thread.title });
            return text(`Handed off to ${p.name}. The project agent is now answering the user in thread ${thread.id}; end your turn.`);
          } catch (err: any) {
            if (err instanceof TurnBusyError) {
              return fail(`${p.name}'s latest thread is still busy. Call handoff again without continue_thread to open a new one.`);
            }
            return fail(err?.message ?? "Handoff failed");
          }
        },
      ),
    ],
  });
}

/** Tool names as Claude Code sees them, for the allowed-tools list. */
export const JARVIS_TOOL_NAMES = ["list_projects", "read_project", "create_project", "update_project", "find_repos", "delegate", "handoff"]
  .map((t) => `mcp__${JARVIS_MCP_NAME}__${t}`);

function summary(p: Project) {
  return {
    name: p.name,
    slug: p.slug,
    path: p.path,
    repo: p.repo ?? null,
    summary: p.notes.split("\n").map((l) => l.replace(/^#+\s*/, "").trim()).find(Boolean) ?? "",
  };
}

function delegatedPrompt(task: string): string {
  return `Task delegated by Jarvis. Do it, then end with a report Jarvis can pass on: the answer or outcome first, then what you checked or changed and anything the user should know.\n\n${task}`;
}

function titleFor(text: string): string | undefined {
  const line = text.split("\n").map((l) => l.trim()).find((l) => l && !/^task delegated/i.test(l));
  if (!line) return undefined;
  return line.length > 60 ? line.slice(0, 57).replace(/\s+\S*$/, "") + "…" : line;
}

// --- GitHub ---
// Jarvis has no shell, so `gh` is exposed as one read-only tool rather than as
// a command line: fixed subcommands, arguments passed as an argv array (never
// through a shell), and only what is needed to turn a name the user said into
// a repository to clone.
//
// gh lives on the machine, not in the conversation, so when it is missing,
// logged out or short a scope only the user can fix it. Those cases are
// separated from ordinary failures and carry the exact command to run, which
// find_repos tells Jarvis to pass on verbatim rather than quietly falling back
// to "what is the repo URL?".

const run = promisify(execFile);

interface Repo {
  nameWithOwner: string;
  description: string;
  url: string;
  isPrivate: boolean;
  language: string | null;
  updatedAt: string;
}

/** A problem with the machine's gh install that the user has to fix. */
class GhSetupError extends Error {
  constructor(readonly kind: "missing" | "auth", message: string) {
    super(message);
  }
}

const INSTALL_HINT = process.platform === "darwin"
  ? "install it with `brew install gh`"
  : process.platform === "win32"
    ? "install it with `winget install --id GitHub.cli`"
    : "install it from https://cli.github.com (on Debian/Ubuntu: `sudo apt install gh`)";

/**
 * Confirms gh is installed and logged in before any real call, so a setup
 * problem is reported once, precisely, instead of as a puzzling empty search.
 * Successful results are cached; a failure is always re-checked, so the user
 * can fix it and retry immediately.
 */
let authCache: { at: number; login: string; scopes: string[] } | undefined;

async function ghAuth(): Promise<{ login: string; scopes: string[] }> {
  if (authCache && Date.now() - authCache.at < 10 * 60 * 1000) return authCache;

  let out: string;
  try {
    const r = await run("gh", ["auth", "status"], { timeout: 20_000 });
    out = r.stdout + r.stderr;
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      throw new GhSetupError("missing", `The GitHub CLI (gh) is not installed on the machine running Jarvis, so I cannot search GitHub. To fix it, ${INSTALL_HINT}, then run \`gh auth login\`.`);
    }
    const detail = String(err?.stderr || err?.stdout || err?.message || "").trim();
    if (/not logged|no accounts|gh auth login|authentication/i.test(detail) || typeof err?.code === "number") {
      throw new GhSetupError("auth", "The GitHub CLI is installed but not logged in, so I cannot search GitHub. To fix it, run `gh auth login` on the machine running Jarvis (or set a GH_TOKEN with `repo` and `read:org` scopes) and ask me again.");
    }
    throw new GhSetupError("auth", `Could not check the GitHub CLI's login: ${firstLine(detail) || "unknown error"}. Try \`gh auth status\` on the machine running Jarvis.`);
  }

  const login = /account (\S+)/.exec(out)?.[1] ?? "";
  const scopes = Array.from(out.matchAll(/'([^']+)'/g)).map((m) => m[1]);
  if (!login) {
    // gh exited 0 but named no account: a token with no user, or an unexpected format.
    const me = await ghRaw(["api", "user", "--jq", ".login"]).catch(() => "");
    if (!me.trim()) throw new GhSetupError("auth", "The GitHub CLI is not logged in to an account I can use. Run `gh auth login` on the machine running Jarvis and ask me again.");
    authCache = { at: Date.now(), login: me.trim(), scopes };
    return authCache;
  }
  authCache = { at: Date.now(), login, scopes };
  return authCache;
}

/** The logins to search: the account itself plus every org it belongs to. */
let ownersCache: { at: number; owners: string[]; warnings: string[] } | undefined;

async function accountOwners(): Promise<{ owners: string[]; warnings: string[] }> {
  if (ownersCache && Date.now() - ownersCache.at < 10 * 60 * 1000) return ownersCache;
  const { login, scopes } = await ghAuth();

  const warnings: string[] = [];
  let orgs: string[] = [];
  try {
    orgs = (await ghRaw(["api", "user/orgs", "--jq", ".[].login"])).split("\n").map((l) => l.trim()).filter(Boolean);
  } catch (err: any) {
    warnings.push(`I could not list your GitHub organisations, so I only searched your personal repositories (${firstLine(err?.message) || "unknown error"}). Try \`gh auth status\` on the machine running Jarvis.`);
  }

  // Without the read:org scope the orgs endpoint does not fail — it quietly
  // returns only public memberships, so a private org's repos look like they
  // do not exist. Say so whenever the scope is absent.
  if (scopes.length && !scopes.includes("read:org")) {
    warnings.push(`The GitHub CLI's token has no \`read:org\` scope, so I can only see organisations you are a public member of${orgs.length ? ` (${orgs.join(", ")})` : ""} — private ones are invisible to me. To fix it, run \`gh auth refresh -s read:org\` on the machine running Jarvis.`);
  }

  ownersCache = { at: Date.now(), owners: [login, ...orgs], warnings };
  return ownersCache;
}

async function findRepos({ query, owner, limit }: { query?: string; owner?: string; limit: number }): Promise<{ repos: Repo[]; searched: string[]; warnings: string[] }> {
  const warnings: string[] = [];
  let owners: string[];
  if (owner) {
    await ghAuth();
    owners = [owner];
  } else {
    const found = await accountOwners();
    owners = found.owners;
    warnings.push(...found.warnings);
  }

  const perOwner = Math.max(limit, 100);
  const searched: string[] = [];
  const lists = await Promise.all(owners.map(async (o) => {
    try {
      const out = await ghRaw(["repo", "list", o, "--limit", String(perOwner), "--json", "nameWithOwner,description,url,isPrivate,primaryLanguage,updatedAt"]);
      searched.push(o);
      return JSON.parse(out) as any[];
    } catch (err: any) {
      // One unreadable org should not sink the whole search, but the user
      // should know their results are incomplete and why.
      warnings.push(`Could not list repositories for "${o}": ${firstLine(err?.message) || "unknown error"}.`);
      return [] as any[];
    }
  }));

  const terms = (query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const repos = lists
    .flat()
    .map((r): Repo => ({
      nameWithOwner: r.nameWithOwner,
      description: r.description ?? "",
      url: r.url,
      isPrivate: !!r.isPrivate,
      language: r.primaryLanguage?.name ?? null,
      updatedAt: r.updatedAt,
    }))
    .filter((r) => terms.every((t) => `${r.nameWithOwner} ${r.description}`.toLowerCase().includes(t)))
    .sort((a, b) => score(b, terms) - score(a, terms) || b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, limit);

  return { repos, searched, warnings };
}

/** A hit in the repo name beats one that only matched the description. */
function score(r: Repo, terms: string[]): number {
  const name = r.nameWithOwner.split("/")[1]?.toLowerCase() ?? "";
  return terms.filter((t) => name.includes(t)).length;
}

/** One gh call. Setup problems are classified; everything else is the caller's to handle. */
async function ghRaw(args: string[]): Promise<string> {
  try {
    const { stdout } = await run("gh", args, { maxBuffer: 8 * 1024 * 1024, timeout: 30_000 });
    return stdout;
  } catch (err: any) {
    if (err?.code === "ENOENT") throw new GhSetupError("missing", `The GitHub CLI (gh) is not installed on the machine running Jarvis. To fix it, ${INSTALL_HINT}, then run \`gh auth login\`.`);
    const detail = firstLine(String(err?.stderr || err?.message || ""));
    if (/not logged|gh auth login|bad credentials|401/i.test(detail)) {
      authCache = undefined;
      throw new GhSetupError("auth", "The GitHub CLI's login has expired or was revoked. To fix it, run `gh auth login` on the machine running Jarvis and ask me again.");
    }
    throw new Error(`gh ${args[0]} ${args[1] ?? ""}`.trim() + ` failed: ${detail || "unknown error"}`);
  }
}

function firstLine(s?: string): string {
  return String(s ?? "").trim().split("\n")[0].trim();
}
