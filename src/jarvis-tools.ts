import { createSdkMcpServer, tool, type McpSdkServerConfigWithInstance } from "@anthropic-ai/claude-agent-sdk";
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
export const JARVIS_TOOL_NAMES = ["list_projects", "read_project", "create_project", "update_project", "delegate", "handoff"]
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
