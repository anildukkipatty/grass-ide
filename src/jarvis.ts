import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, statSync } from "fs";
import { basename, join, resolve } from "path";
import { homedir } from "os";
import { listBots, createBot, updateBot, type Bot } from "./bot-store";
import { cloneRepo } from "./workspace";

/**
 * Jarvis is the persistent engineering partner: one agent that knows every
 * project and decides where work should happen. Its world is a directory:
 *
 *   ~/jarvis/
 *     CLAUDE.md          notes about the user, editable by hand and by Jarvis
 *     projects/
 *       grass.md         one file per project: where it lives, what it is
 *
 * A project is a Markdown file with a small front matter (name, path, repo)
 * and free-form notes under it. Nothing more structured than that: the file is
 * meant to grow as Jarvis learns the project, not to be filled in like a form.
 *
 * Both Jarvis and each project are Bots in the hub, so threads, resume, the
 * transcript reader and the UI all work unchanged. This module owns the files
 * and keeps those bots in step with them.
 */

// --- Directories ---

export function jarvisDir(): string {
  return process.env.JARVIS_DIR || join(homedir(), "jarvis");
}

export function projectsDir(): string {
  return join(jarvisDir(), "projects");
}

/** Creates the Jarvis directory on first run, with a starter CLAUDE.md. */
export function ensureJarvisDir(): void {
  const dir = jarvisDir();
  if (!existsSync(projectsDir())) mkdirSync(projectsDir(), { recursive: true });
  const notes = join(dir, "CLAUDE.md");
  if (!existsSync(notes)) writeFileSync(notes, STARTER_NOTES, "utf-8");
}

const STARTER_NOTES = `# Jarvis notes

This file is loaded into every Jarvis conversation. Keep here what Jarvis
should always know: who you are, how you like work reported, standing rules
("never merge without asking"), people and their GitHub handles, and anything
else that is not specific to one project. Project-specific knowledge belongs
in projects/<name>.md instead.

## About me

## Standing rules

- Never merge, push to a shared branch, or delete anything unless I explicitly
  ask for it in the conversation.

## People
`;

// --- Projects ---

export interface Project {
  /** File name without .md — the stable handle. */
  slug: string;
  /** Display name, as the user says it. */
  name: string;
  /** Absolute path of the local checkout. */
  path: string;
  /** True when path is set but the directory no longer exists on disk. */
  pathMissing?: boolean;
  /** Remote URL, when known. */
  repo?: string;
  /** Everything under the front matter. */
  notes: string;
  updatedAt: string;
}

export function slugify(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "project";
}

export function projectFile(slug: string): string {
  return join(projectsDir(), `${slug}.md`);
}

/** Parses a project file: `key: value` lines between `---` fences, then notes. */
function parseProject(slug: string, raw: string, mtime: Date): Project {
  const meta: Record<string, string> = {};
  let notes = raw;
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (m) {
    for (const line of m[1].split(/\r?\n/)) {
      const kv = line.match(/^([A-Za-z_]+):\s*(.*)$/);
      if (kv) meta[kv[1].toLowerCase()] = kv[2].trim();
    }
    notes = raw.slice(m[0].length);
  }
  const path = meta.path || "";
  return {
    slug,
    name: meta.name || slug,
    path,
    pathMissing: path ? !existsSync(path) : undefined,
    repo: meta.repo || undefined,
    notes: notes.trim(),
    updatedAt: mtime.toISOString(),
  };
}

function serializeProject(p: Omit<Project, "slug" | "updatedAt">): string {
  const head = [`name: ${p.name}`, `path: ${p.path}`, ...(p.repo ? [`repo: ${p.repo}`] : [])];
  return `---\n${head.join("\n")}\n---\n\n${p.notes.trim()}\n`;
}

export function listProjects(): Project[] {
  const dir = projectsDir();
  if (!existsSync(dir)) return [];
  const out: Project[] = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".md")) continue;
    const file = join(dir, f);
    try {
      out.push(parseProject(f.slice(0, -3), readFileSync(file, "utf-8"), statSync(file).mtime));
    } catch (err: any) {
      console.error(`[jarvis] could not read ${file}: ${err.message}`);
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Finds a project by however the user referred to it: slug, name, or a loose
 * match ("zap eve" → zap-eve, "the grass repo" → grass). Returns undefined
 * rather than guessing when nothing is close.
 */
export function findProject(ref: string): Project | undefined {
  const projects = listProjects();
  const want = slugify(ref);
  if (!want) return undefined;
  return projects.find((p) => p.slug === want)
    ?? projects.find((p) => slugify(p.name) === want)
    ?? projects.find((p) => want.includes(p.slug) || p.slug.includes(want))
    ?? projects.find((p) => basename(p.path) && slugify(basename(p.path)) === want);
}

export interface NewProject {
  name: string;
  /** Existing checkout to adopt. Either this or repo is required. */
  path?: string;
  /** Clone this into the workspace when path is not given. */
  repo?: string;
  notes?: string;
}

/**
 * Registers a project. Clones the repo into the workspace when no checkout is
 * given, writes the project file, and makes sure the project has a bot.
 */
export function createProject(input: NewProject, workspaceCwd: string): Project {
  const name = input.name.trim();
  if (!name) throw new Error("A project needs a name");
  const slug = slugify(name);
  if (existsSync(projectFile(slug))) throw new Error(`Project "${name}" already exists`);

  let path = input.path ? resolve(input.path) : "";
  if (path && !existsSync(path)) throw new Error(`No such directory: ${path}`);
  if (!path) {
    if (!input.repo) throw new Error("Give either a repo URL to clone or the path of an existing checkout");
    const folder = basename(input.repo.replace(/\/+$/, "")).replace(/\.git$/, "");
    const existing = join(workspaceCwd, folder);
    // A checkout already sitting in the workspace is the project; don't clone beside it.
    path = existsSync(join(existing, ".git")) ? existing : cloneRepo(input.repo, workspaceCwd);
  }

  const repo = input.repo || detectRemote(path);
  writeFileSync(projectFile(slug), serializeProject({ name, path, repo, notes: input.notes ?? `# ${name}\n` }), "utf-8");
  const project = getProject(slug)!;
  ensureProjectBot(project);
  return project;
}

export function getProject(slug: string): Project | undefined {
  const file = projectFile(slug);
  if (!existsSync(file)) return undefined;
  return parseProject(slug, readFileSync(file, "utf-8"), statSync(file).mtime);
}

/** Rewrites the notes (everything under the front matter); metadata stays. */
export function updateProjectNotes(slug: string, notes: string): Project {
  const p = getProject(slug);
  if (!p) throw new Error(`No project "${slug}"`);
  writeFileSync(projectFile(slug), serializeProject({ ...p, notes }), "utf-8");
  const next = getProject(slug)!;
  ensureProjectBot(next);
  return next;
}

function detectRemote(path: string): string | undefined {
  try {
    const { execSync } = require("child_process") as typeof import("child_process");
    return execSync("git remote get-url origin", { cwd: path, encoding: "utf-8", stdio: "pipe" }).trim() || undefined;
  } catch {
    return undefined;
  }
}

/** Folders in the workspace that no project claims — candidates for adoption. */
export function unregisteredFolders(workspaceCwd: string): { name: string; path: string; isGit: boolean }[] {
  const claimed = new Set(listProjects().map((p) => resolve(p.path)));
  try {
    return readdirSync(workspaceCwd, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => ({ name: e.name, path: join(workspaceCwd, e.name), isGit: existsSync(join(workspaceCwd, e.name, ".git")) }))
      .filter((d) => !claimed.has(resolve(d.path)));
  } catch {
    return [];
  }
}

// --- Bots ---
// Jarvis and each project are bots, so the rest of the hub needs no special
// cases. Their definitions are derived, so they are regenerated on every
// ensure rather than edited by hand.

export function jarvisBot(): Bot | undefined {
  return listBots().find((b) => b.role === "jarvis");
}

export function ensureJarvisBot(): Bot {
  ensureJarvisDir();
  const def = {
    name: "Jarvis",
    emoji: "\u{1F9E0}",
    description: "Your engineering partner. Knows every project; decides where work happens.",
    instructions: jarvisInstructions(),
    repoPath: jarvisDir(),
    permissionMode: "auto-approve" as const,
    // No shell: Jarvis keeps its notes with the file tools and does everything
    // else through project agents, which is the point of it.
    disallowedTools: ["Bash"],
    role: "jarvis" as const,
  };
  const existing = jarvisBot();
  if (existing) return updateBot(existing.id, def) ?? existing;
  return createBot(def);
}

export function projectBot(slug: string): Bot | undefined {
  return listBots().find((b) => b.role === "project" && b.projectSlug === slug);
}

export function ensureProjectBot(project: Project): Bot {
  const def = {
    name: project.name,
    emoji: "\u{1F4E6}",
    description: firstLine(project.notes) || `The ${project.name} project agent.`,
    instructions: projectInstructions(project),
    repoPath: project.path,
    permissionMode: "auto-approve" as const,
    role: "project" as const,
    projectSlug: project.slug,
  };
  const existing = projectBot(project.slug);
  if (existing) return updateBot(existing.id, def) ?? existing;
  return createBot(def);
}

/** Brings every project bot up to date with its file; run at startup. */
export function syncProjectBots(): void {
  for (const p of listProjects()) ensureProjectBot(p);
}

function firstLine(md: string): string {
  return md.split("\n").map((l) => l.replace(/^#+\s*/, "").trim()).find((l) => l && !l.startsWith("#")) ?? "";
}

// --- Prompts ---

/**
 * What Jarvis is and how it works. Appended to Claude Code's own prompt; the
 * user's CLAUDE.md under ~/jarvis rides in through the normal project-settings
 * path, so this stays about the role and the tools.
 */
export function jarvisInstructions(): string {
  return `You are Jarvis, a persistent AI engineering partner. The user talks to you first about
anything engineering-related; you work out which project it concerns and how the work should
be carried out. You are not the coding agent: real repo-level work is done by project agents
(Claude Code sessions running inside a project's checkout) that you dispatch.

YOUR WORLD
- Your working directory (${jarvisDir()}) holds CLAUDE.md (notes about the user) and
  projects/<slug>.md, one file per project. Read and edit these files freely; they are yours.
- A project is more than a repository: the file records where the checkout is, the remote,
  people, useful commands, architecture notes and what has been done before. Add to a project's
  notes whenever you learn something that will save time next time (use update_project).

TOOLS
- list_projects: every project you know, plus workspace folders nobody has claimed yet.
- read_project: a project's full notes.
- create_project: register a project from a repo URL (cloned into the workspace) or an existing
  folder. Use it once you know enough; then continue the original request.
- update_project: rewrite a project's notes.
- find_repos: search the user's GitHub for a repository by name or words in its description.
  It covers their own account and every organisation they belong to, private repos included;
  the result says which owners it actually searched. Use it to turn a project name into a repo
  URL. If it reports that the GitHub CLI is missing, logged out or short a scope, tell the user
  straight away, with the command that fixes it — only they can fix it, and until then any
  search of theirs is incomplete or impossible.
- delegate: give a project agent a bounded task and get its report back. It blocks until the
  agent finishes, which may take minutes. You may call it for several projects at once.
- handoff: move the conversation into a project. The project agent takes over from the next
  message on and answers the user directly; your turn should end right after the call with at
  most one short line. Use the message argument to pass the user's request in full, with any
  context they gave you.

HANDOFF OR DELEGATE
- Handoff is the default whenever a request concerns one project, however small: a question
  about it, a review, a fix. The user's attention is moving into that project and their
  follow-ups ("why did we do that?", "review it properly") should land there, with the context
  the agent already has. Do not delegate a single-project request just because it looks quick.
- Delegate when you must stay in charge: the request spans several projects, you need a result
  in order to combine it with something else, or the user asked you for a synthesis.
- Never do repo-level work yourself (reading code, running tests, git). Dispatch it.

UNKNOWN PROJECTS
- If the user names a project you do not have, do not fail and do not poke at the folder
  yourself. Check list_projects: an unclaimed workspace folder with a matching name is almost
  certainly it, so create_project with that path, say so in a few words, and carry on with the
  original request through the new project agent. If nothing matches, call find_repos: one
  clear hit on GitHub is it, so create_project with its URL (which clones it) and continue.
  Only when that is ambiguous or empty, ask the user which repository it is.

RULES
- Project agents may edit code, run tests and open branches, but nothing is merged, pushed to a
  shared branch or deleted unless the user said so in this conversation. Pass that constraint
  along explicitly when you dispatch work.
- Be brief. The user is often on a phone. Lead with the answer or the outcome; no preamble.
- Refer to people, projects and PRs by the names the user uses.`;
}

/**
 * The project agent is ordinary Claude Code in the checkout, with the project
 * file as standing context and the guardrails Jarvis relies on.
 */
export function projectInstructions(project: Project): string {
  return `You are the project agent for "${project.name}". You run inside its checkout at
${project.path}${project.repo ? ` (remote: ${project.repo})` : ""} and do the actual engineering
work here: reading code, git history, reviewing changes, running tests and dev servers, using
gh, Playwright and whatever else is installed, and making changes when asked.

The user reached you through Jarvis, their engineering partner, and may be on a phone. They
may continue this conversation directly. Lead with the outcome; keep reports short and
concrete: what you looked at, what you found, what you changed, what remains.

Standing rules:
- Do not merge, push to a shared branch, force-push or delete anything unless the user
  explicitly asked for it in this conversation. Work on a branch when changing code.
- When a task was delegated by Jarvis, finish it and end with a clear report; Jarvis passes
  your final message on.

Project notes (kept at ${projectFile(project.slug)}; update them when you learn something
durable about this project):

${project.notes || "(no notes yet)"}`;
}
