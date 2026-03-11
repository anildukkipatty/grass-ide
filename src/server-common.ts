import { networkInterfaces } from "os";
import { execSync, execFile, spawn } from "child_process";
import http from "node:http";
import { EventEmitter } from "events";
import qrcode from "qrcode-terminal";
import { html } from "./client-html";
import { listRepos, cloneRepo, createFolder, listDir, readFile } from "./workspace";

export const PORT_RANGE_START = 32100;
export const PORT_RANGE_END = 32199;

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

// --- Session Store ---

export interface StoredEvent {
  seq: number;
  type: string;
  [key: string]: unknown;
}

export interface PendingPermission {
  resolve: (result: any) => void;
  input: any;
  toolName: string;
  toolUseID: string;
}

export interface SessionStore {
  grassId: string;
  sdkSessionId: string | null;
  agent: "claude-code" | "opencode";
  repoPath: string;
  seq: number;
  events: StoredEvent[];
  status: "running" | "done" | "error";
  emitter: EventEmitter;
  abortController: AbortController | null;
  pendingPermissions: Map<string, PendingPermission>;
  cleanupTimer: ReturnType<typeof setTimeout> | null;
}

export const sessions = new Map<string, SessionStore>();

export function createSession(
  grassId: string,
  agent: "claude-code" | "opencode",
  repoPath: string
): SessionStore {
  const store: SessionStore = {
    grassId,
    sdkSessionId: null,
    agent,
    repoPath,
    seq: 0,
    events: [],
    status: "running",
    emitter: new EventEmitter(),
    abortController: null,
    pendingPermissions: new Map(),
    cleanupTimer: null,
  };
  sessions.set(grassId, store);
  return store;
}

export function scheduleCleanup(store: SessionStore): void {
  if (store.cleanupTimer) clearTimeout(store.cleanupTimer);
  store.cleanupTimer = setTimeout(() => {
    sessions.delete(store.grassId);
  }, 60 * 60 * 1000);
}

export function emitEvent(store: SessionStore, type: string, data: Record<string, unknown>): void {
  const seq = ++store.seq;
  const event: StoredEvent = { seq, type, ...data };
  store.events.push(event);
  store.emitter.emit("event", event);
}

// --- HTTP Server ---

export async function createHttpServer(opts: {
  portOverride?: number;
  caffeinate: boolean;
  network: string;
  label: string;
}): Promise<{ server: http.Server; PORT: number; caffeinatePid: number | null }> {
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

  const server = http.createServer();

  // Serve the SPA for GET /
  server.on("request", (req, res) => {
    if (req.method === "GET" && (req.url === "/" || req.url === "")) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
    }
    // All other routes handled by server.ts listener
  });

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

  return { server, PORT, caffeinatePid };
}

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

// --- SSE helper ---

export function sseHeaders(): Record<string, string> {
  return {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "Access-Control-Allow-Origin": "*",
  };
}

export function writeSseEvent(
  res: http.ServerResponse,
  event: StoredEvent
): void {
  if (res.writableEnded) return;
  res.write(`id: ${event.seq}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
}

// --- Route helpers ---

export function parseQuery(url: string): Record<string, string> {
  const idx = url.indexOf("?");
  if (idx === -1) return {};
  const params: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(url.slice(idx + 1))) {
    params[k] = v;
  }
  return params;
}

export function parsePathParam(url: string, prefix: string): string | null {
  const path = url.split("?")[0];
  if (!path.startsWith(prefix)) return null;
  return path.slice(prefix.length) || null;
}

export function jsonOk(res: http.ServerResponse, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(data);
}

export function jsonError(res: http.ServerResponse, status: number, message: string): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: message }));
}

export function readBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      try { resolve(JSON.parse(raw)); } catch { resolve({}); }
    });
    req.on("error", reject);
  });
}

// --- Workspace REST handlers ---

export async function handleWorkspaceRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  workspaceCwd: string,
  availableAgents: string[],
): Promise<boolean> {
  const url = req.url ?? "/";
  const method = req.method ?? "GET";
  const path = url.split("?")[0];
  const query = parseQuery(url);

  if (method === "GET" && path === "/health") {
    jsonOk(res, { status: "ok", cwd: workspaceCwd });
    return true;
  }

  if (method === "GET" && path === "/agents") {
    jsonOk(res, { agents: availableAgents });
    return true;
  }

  if (method === "GET" && path === "/repos") {
    const repos = await listRepos(workspaceCwd);
    jsonOk(res, { repos });
    return true;
  }

  if (method === "POST" && path === "/repos/clone") {
    const body = await readBody(req);
    const { url: cloneUrl } = body;
    if (!cloneUrl) { jsonError(res, 400, "url is required"); return true; }
    try {
      const clonedPath = cloneRepo(cloneUrl, workspaceCwd);
      const { basename } = await import("path");
      jsonOk(res, { path: clonedPath, name: basename(clonedPath) });
    } catch (err: any) {
      jsonError(res, 500, err?.message ?? "Clone failed");
    }
    return true;
  }

  if (method === "POST" && path === "/folders") {
    const body = await readBody(req);
    const { name } = body;
    if (!name) { jsonError(res, 400, "name is required"); return true; }
    try {
      const createdPath = await createFolder(name, workspaceCwd);
      const { basename } = await import("path");
      jsonOk(res, { path: createdPath, name: basename(createdPath) });
    } catch (err: any) {
      jsonError(res, 500, err?.message ?? "Create failed");
    }
    return true;
  }

  if (method === "GET" && path === "/dir") {
    const repoPath = query.repoPath;
    if (!repoPath) { jsonError(res, 400, "repoPath is required"); return true; }
    const targetPath = query.path ?? repoPath;
    try {
      const entries = await listDir(targetPath, repoPath);
      jsonOk(res, { entries });
    } catch (err: any) {
      jsonError(res, 400, err?.message ?? "Failed to list directory");
    }
    return true;
  }

  if (method === "GET" && path === "/file") {
    const repoPath = query.repoPath;
    const filePath = query.path;
    if (!repoPath) { jsonError(res, 400, "repoPath is required"); return true; }
    if (!filePath) { jsonError(res, 400, "path is required"); return true; }
    try {
      const { content, size } = await readFile(filePath, repoPath);
      jsonOk(res, { content, size });
    } catch (err: any) {
      jsonError(res, 400, err?.message ?? "Failed to read file");
    }
    return true;
  }

  if (method === "GET" && path === "/diffs") {
    const repoPath = query.repoPath ?? workspaceCwd;
    let diff = "";
    try {
      diff = execSync("git diff HEAD", { cwd: repoPath, encoding: "utf-8", maxBuffer: 10 * 1024 * 1024 });
    } catch {
      diff = "";
    }
    jsonOk(res, { diff });
    return true;
  }

  return false;
}
