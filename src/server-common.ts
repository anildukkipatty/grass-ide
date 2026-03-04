import { WebSocket, WebSocketServer } from "ws";
import { networkInterfaces } from "os";
import { execSync, execFile, spawn } from "child_process";
import http from "node:http";
import qrcode from "qrcode-terminal";
import { basename } from "path";
import { html } from "./client-html";
import { listRepos, cloneRepo, createFolder, listDir, readFile } from "./workspace";

export const PORT_RANGE_START = 32100;
export const PORT_RANGE_END = 32199;
export const IDLE_CLEANUP_MS = 10 * 60 * 1000; // 10 minutes

export function findAvailablePort(startPort: number, endPort: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const tryPort = (port: number) => {
      if (port > endPort) {
        reject(new Error(`No available port found in range ${startPort}–${endPort}`));
        return;
      }
      const server = http.createServer();
      server.listen(port, () => {
        server.close(() => resolve(port));
      });
      server.on("error", () => tryPort(port + 1));
    };
    tryPort(startPort);
  });
}

export function getLocalIP(): string {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]!) {
      if (net.family === "IPv4" && !net.internal) {
        return net.address;
      }
    }
  }
  return "localhost";
}

export function getPublicIP(): Promise<string | null> {
  return new Promise((resolve) => {
    http.get("http://api.ipify.org", (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => resolve(data.trim() || null));
      res.on("error", () => resolve(null));
    }).on("error", () => resolve(null));
  });
}

export function getTailscaleIP(): Promise<string | null> {
  return new Promise((resolve) => {
    execFile("tailscale", ["status"], { timeout: 2000 }, (err) => {
      if (err) return resolve(null);
      execFile("tailscale", ["ip", "-4"], { timeout: 2000 }, (err, stdout) => {
        if (err) return resolve(null);
        const ip = stdout.trim().split("\n")[0];
        resolve(ip || null);
      });
    });
  });
}

export async function showQR(network: string, port: number): Promise<void> {
  let ip: string;
  let label: string;

  if (network === "tailscale") {
    const tsIP = await getTailscaleIP();
    if (!tsIP) {
      console.error("  Tailscale IP not found. Is Tailscale running?");
      process.exit(1);
    }
    ip = tsIP;
    label = "Tailscale";
  } else if (network === "remote-ip") {
    const publicIP = await getPublicIP();
    if (!publicIP) {
      console.error("  Could not determine public IP address.");
      process.exit(1);
    }
    ip = publicIP;
    label = "Public";
  } else if (network === "local") {
    ip = getLocalIP();
    label = "Local Network";
  } else {
    ip = network;
    label = "Custom";
  }

  const url = `http://${ip}:${port}`;
  console.log(`\n  ${label}  ${url}\n`);

  const qrCode = await new Promise<string>((resolve) => {
    qrcode.generate(url, { small: true }, (code: string) => {
      resolve(code.trimEnd());
    });
  });

  console.log(qrCode);
}

export function maybeCaffeinate(enabled: boolean): number | null {
  if (!enabled) return null;
  try {
    execSync("which caffeinate", { stdio: "ignore" });
  } catch {
    return null;
  }
  const hours = 8;
  const seconds = hours * 60 * 60;
  const child = spawn("caffeinate", ["-t", String(seconds)], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  console.log(`  caffeinate: running for ${hours}h (pid ${child.pid})`);
  return child.pid ?? null;
}

export function killCaffeinate(pid: number | null): void {
  if (pid === null) return;
  try {
    process.kill(pid);
  } catch {
    // already gone
  }
}

// Minimal common fields shared between both agent implementations.
// Each agent file still defines its own full ManagedSession interface
// (with agent-specific fields) and casts as needed.
export interface ManagedSessionBase {
  sessionId: string;
  connectedSocket: WebSocket | null;
  streaming: boolean;
  msgSeq: number;
  idleTimer: ReturnType<typeof setTimeout> | null;
}

export function clearIdleTimer(ms: ManagedSessionBase): void {
  if (ms.idleTimer) {
    clearTimeout(ms.idleTimer);
    ms.idleTimer = null;
  }
}

export function startIdleTimer<T extends ManagedSessionBase>(
  ms: T,
  sessions: Map<string, T>
): void {
  clearIdleTimer(ms);
  ms.idleTimer = setTimeout(() => {
    console.log(`[idle] Cleaning up session ${ms.sessionId} after ${IDLE_CLEANUP_MS / 1000}s idle`);
    sessions.delete(ms.sessionId);
  }, IDLE_CLEANUP_MS);
}

export function safeSend(ms: ManagedSessionBase, payload: Record<string, unknown>): void {
  const ws = ms.connectedSocket;
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

// Shared connection state passed into handleWorkspaceMessage and agent handleMessage.
// The server owns this object; both the workspace handler and agent handler mutate it.
export interface ConnectionState {
  selectedRepoPath: string | null;
  selectedAgent: "claude-code" | "opencode" | null;
  attachedSessionId: string | null;
}

// Creates the HTTP + WebSocket server, binds to a port, shows the QR code.
// Returns the bound server, wss, port, and caffeinate pid.
export async function createHttpServer(opts: {
  portOverride?: number;
  caffeinate: boolean;
  network: string;
  label: string;
}): Promise<{ server: http.Server; wss: WebSocketServer; PORT: number; caffeinatePid: number | null }> {
  const caffeinatePid = maybeCaffeinate(opts.caffeinate);
  console.log(`  workspace: ${process.cwd()}`);

  let PORT: number;
  if (opts.portOverride !== undefined) {
    PORT = opts.portOverride;
    console.log(`  port: ${PORT} (specified)`);
  } else {
    try {
      PORT = await findAvailablePort(PORT_RANGE_START, PORT_RANGE_END);
      console.log(`  port: ${PORT} (auto-selected from ${PORT_RANGE_START}–${PORT_RANGE_END})`);
    } catch {
      console.error(`\n  No available port found in range ${PORT_RANGE_START}–${PORT_RANGE_END}.`);
      console.error(`  Try stopping other grass sessions, or run with -p to specify a port.\n`);
      process.exit(1);
    }
  }

  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
  });

  const wss = new WebSocketServer({ server });

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(`\n  Port ${PORT} is not available.`);
      if (opts.portOverride !== undefined) {
        console.error(`  Please choose a different port with -p, or run without -p to auto-select one.\n`);
      } else {
        console.error(`  Try stopping other grass sessions, or run with -p to specify a port.\n`);
      }
      process.exit(1);
    }
    throw err;
  });

  await new Promise<void>((resolve) => {
    server.listen(PORT, async () => {
      await showQR(opts.network, PORT);
      resolve();
    });
  });

  return { server, wss, PORT, caffeinatePid };
}

// Registers SIGINT/SIGTERM/exit/uncaughtException handlers.
// cleanup() should abort in-flight work, close sockets, and close the server.
export function setupShutdown(cleanup: () => void, caffeinatePid: number | null): void {
  const shutdown = () => {
    console.log("\nShutting down...");
    killCaffeinate(caffeinatePid);
    cleanup();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  process.on("exit", () => killCaffeinate(caffeinatePid));
  process.on("uncaughtException", (err) => {
    console.error("Uncaught exception:", err);
    killCaffeinate(caffeinatePid);
    process.exit(1);
  });
}

// Handles the workspace-layer WebSocket messages that are identical across all agents.
// Returns true if the message was handled, false if the agent should handle it.
export async function handleWorkspaceMessage(
  parsed: { type: string; [key: string]: any },
  ws: WebSocket,
  workspaceCwd: string,
  state: ConnectionState,
): Promise<boolean> {
  if (parsed.type === "ping") {
    ws.send(JSON.stringify({ type: "pong" }));
    return true;
  }

  if (parsed.type === "list_repos") {
    const repos = await listRepos(workspaceCwd);
    ws.send(JSON.stringify({ type: "repos_list", repos }));
    return true;
  }

  if (parsed.type === "select_repo") {
    const repoPath = parsed.path as string;
    if (!repoPath) {
      ws.send(JSON.stringify({ type: "error", message: "select_repo requires a path" }));
      return true;
    }
    state.selectedRepoPath = repoPath;
    const name = basename(repoPath);
    console.log(`[workspace] selected repo: ${repoPath}`);
    ws.send(JSON.stringify({ type: "repo_selected", path: repoPath, name }));
    return true;
  }

  if (parsed.type === "clone_repo") {
    const url = parsed.url as string;
    if (!url) {
      ws.send(JSON.stringify({ type: "error", message: "clone_repo requires a url" }));
      return true;
    }
    ws.send(JSON.stringify({ type: "status", status: "cloning", message: `Cloning ${url}...` }));
    try {
      const clonedPath = cloneRepo(url, workspaceCwd);
      state.selectedRepoPath = clonedPath;
      const name = basename(clonedPath);
      console.log(`[workspace] cloned repo: ${clonedPath}`);
      ws.send(JSON.stringify({ type: "repo_cloned", path: clonedPath, name }));
    } catch (err: any) {
      ws.send(JSON.stringify({ type: "error", message: `Clone failed: ${err?.message ?? "unknown error"}` }));
    }
    return true;
  }

  if (parsed.type === "create_folder") {
    const name = parsed.name as string;
    if (!name) {
      ws.send(JSON.stringify({ type: "error", message: "create_folder requires a name" }));
      return true;
    }
    try {
      const createdPath = await createFolder(name, workspaceCwd);
      state.selectedRepoPath = createdPath;
      const folderName = basename(createdPath);
      console.log(`[workspace] created folder: ${createdPath}`);
      ws.send(JSON.stringify({ type: "folder_created", path: createdPath, name: folderName }));
    } catch (err: any) {
      ws.send(JSON.stringify({ type: "error", message: `Create failed: ${err?.message ?? "unknown error"}` }));
    }
    return true;
  }

  if (parsed.type === "list_dir") {
    const repoRoot = (parsed.repoPath as string | undefined) || state.selectedRepoPath;
    if (!repoRoot) {
      ws.send(JSON.stringify({ type: "error", message: "No repo selected" }));
      return true;
    }
    const targetPath = (parsed.path as string) ?? repoRoot;
    try {
      const entries = await listDir(targetPath, repoRoot);
      ws.send(JSON.stringify({ type: "dir_listing", path: targetPath, entries }));
    } catch (err: any) {
      ws.send(JSON.stringify({ type: "error", message: err?.message ?? "Failed to list directory" }));
    }
    return true;
  }

  if (parsed.type === "read_file") {
    const repoRoot = (parsed.repoPath as string | undefined) || state.selectedRepoPath;
    if (!repoRoot) {
      ws.send(JSON.stringify({ type: "error", message: "No repo selected" }));
      return true;
    }
    const filePath = parsed.path as string;
    if (!filePath) {
      ws.send(JSON.stringify({ type: "error", message: "read_file requires a path" }));
      return true;
    }
    try {
      const { content, size } = await readFile(filePath, repoRoot);
      ws.send(JSON.stringify({ type: "file_content", path: filePath, content, size }));
    } catch (err: any) {
      ws.send(JSON.stringify({ type: "error", message: err?.message ?? "Failed to read file" }));
    }
    return true;
  }

  if (parsed.type === "get_diffs") {
    const cwd = state.selectedRepoPath ?? workspaceCwd;
    let diff = "";
    try {
      diff = execSync("git diff HEAD", { cwd, encoding: "utf-8", maxBuffer: 10 * 1024 * 1024 });
    } catch {
      diff = "";
    }
    ws.send(JSON.stringify({ type: "diffs", diff }));
    return true;
  }

  return false;
}
