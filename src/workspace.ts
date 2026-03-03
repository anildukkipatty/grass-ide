import { existsSync } from "fs";
import { mkdir, readdir, stat, readFile as fsReadFile } from "fs/promises";
import { join, resolve } from "path";
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

export interface DirEntry {
  name: string;
  path: string;
  type: "file" | "directory";
  size: number | null;
}

// List entries in dirPath, validated to be inside repoRoot
export async function listDir(dirPath: string, repoRoot: string): Promise<DirEntry[]> {
  const resolvedDir = resolve(dirPath);
  const resolvedRoot = resolve(repoRoot);
  if (!resolvedDir.startsWith(resolvedRoot)) {
    throw new Error("Path is outside the selected repository");
  }
  const entries = await readdir(resolvedDir, { withFileTypes: true });
  const result: DirEntry[] = [];
  for (const entry of entries) {
    const entryPath = join(resolvedDir, entry.name);
    if (entry.isDirectory()) {
      result.push({ name: entry.name, path: entryPath, type: "directory", size: null });
    } else if (entry.isFile()) {
      const s = await stat(entryPath);
      result.push({ name: entry.name, path: entryPath, type: "file", size: s.size });
    }
  }
  result.sort((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  });
  return result;
}

// Read a file, validated to be inside repoRoot; enforces 5 MB max
export async function readFile(filePath: string, repoRoot: string): Promise<{ content: string; size: number }> {
  const resolvedFile = resolve(filePath);
  const resolvedRoot = resolve(repoRoot);
  if (!resolvedFile.startsWith(resolvedRoot)) {
    throw new Error("Path is outside the selected repository");
  }
  const s = await stat(resolvedFile);
  const MAX_SIZE = 5 * 1024 * 1024;
  if (s.size > MAX_SIZE) {
    throw new Error(`File exceeds 5 MB limit (${s.size} bytes)`);
  }
  const content = await fsReadFile(resolvedFile, "utf-8");
  return { content, size: s.size };
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
