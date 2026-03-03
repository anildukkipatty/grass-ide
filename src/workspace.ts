import { existsSync } from "fs";
import { mkdir, readdir } from "fs/promises";
import { join } from "path";
import { execSync } from "child_process";

export interface RepoInfo {
  name: string;   // folder name
  path: string;   // absolute path
  isGit: boolean; // has .git directory
}

// List subdirectories in workspace that are (or can be) git repos
export async function listRepos(workspaceDir: string): Promise<RepoInfo[]> {
  try {
    const entries = await readdir(workspaceDir, { withFileTypes: true });
    const repos: RepoInfo[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith(".")) continue;
      const absPath = join(workspaceDir, entry.name);
      const isGit = existsSync(join(absPath, ".git"));
      repos.push({ name: entry.name, path: absPath, isGit });
    }
    repos.sort((a, b) => a.name.localeCompare(b.name));
    return repos;
  } catch {
    return [];
  }
}

// Create a new empty folder in workspaceDir; returns the absolute path
export async function createFolder(name: string, workspaceDir: string): Promise<string> {
  // Strip path separators to prevent traversal
  const safeName = name.replace(/[/\\]/g, "").trim();
  if (!safeName) throw new Error("Invalid folder name");
  const absPath = join(workspaceDir, safeName);
  if (existsSync(absPath)) throw new Error(`Folder "${safeName}" already exists`);
  await mkdir(absPath, { recursive: false });
  return absPath;
}

// Clone a repo URL into workspaceDir; returns the absolute path to the cloned folder
export function cloneRepo(url: string, workspaceDir: string): string {
  // Parse folder name from URL (strip .git suffix if present)
  const raw = url.split("/").pop() ?? "repo";
  const folderName = raw.replace(/\.git$/, "") || "repo";
  execSync(`git clone ${JSON.stringify(url)} ${JSON.stringify(folderName)}`, {
    cwd: workspaceDir,
    stdio: "pipe",
  });
  return join(workspaceDir, folderName);
}
