import { spawn, type ChildProcess } from "child_process";
import { EventEmitter } from "events";
import {
  emitEvent,
  scheduleCleanup,
  notifyPermissionsChanged,
  notifySessionDone,
  type SessionStore,
} from "./server-common";

// ── Persistent per-session Pi process ────────────────────────────────────────

interface PiHandle {
  process: ChildProcess;
  emitter: EventEmitter;  // emits "agent_event" with raw Pi JSON events
  textBuffer: string;     // accumulates text_delta chunks so we always emit full content
}

const piHandles = new Map<string, PiHandle>();

// ── Init ─────────────────────────────────────────────────────────────────────

export async function initAgent(): Promise<boolean> {
  try {
    const { execSync } = await import("child_process");
    execSync("pi --version", { stdio: "ignore" });
    return true;
  } catch {
    console.warn("  pi CLI not found — pi agent unavailable");
    return false;
  }
}

// ── Run ──────────────────────────────────────────────────────────────────────

export async function runAgent(store: SessionStore): Promise<void> {
  const lastUserEvent = [...store.events].reverse().find((e) => e.type === "user_prompt");
  const promptText = (lastUserEvent?.prompt as string) ?? "";
  const attachments = lastUserEvent?.attachments as Array<{ url: string }> | undefined;
  const model = store.model ?? "gpt-5.5";

  let handle = piHandles.get(store.grassId);

  if (!handle) {
    // First message: spawn Pi in RPC mode
    const args = ["--mode", "rpc", "--provider", "openai-codex", "--model", model];
    let piProcess: ChildProcess;
    try {
      piProcess = spawn("pi", args, {
        cwd: store.repoPath,
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env },
      });
    } catch (err: any) {
      emitEvent(store, "error", { message: `Failed to start pi: ${err.message}` });
      store.status = "error";
      scheduleCleanup(store);
      return;
    }

    const emitter = new EventEmitter();
    handle = { process: piProcess, emitter, textBuffer: "" };
    piHandles.set(store.grassId, handle);

    // Pipe stderr to our stderr for debugging
    piProcess.stderr?.on("data", (data: Buffer) => {
      process.stderr.write(data);
    });

    // Pi RPC docs: readline is not protocol-compliant — it splits on U+2028/U+2029
    // inside JSON strings. Use a manual \n-only splitter instead.
    let lineBuffer = "";
    piProcess.stdout!.on("data", (chunk: Buffer) => {
      lineBuffer += chunk.toString("utf8");
      const parts = lineBuffer.split("\n");
      lineBuffer = parts.pop()!; // keep the incomplete trailing fragment
      for (const line of parts) {
        const trimmed = line.trimEnd();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed);
          emitter.emit("agent_event", parsed);
        } catch {
          // ignore non-JSON startup noise
        }
      }
    });

    piProcess.on("exit", (code) => {
      piHandles.delete(store.grassId);
      emitter.emit("process_exit", code);
    });

    // Give Pi ~300 ms to initialise before sending the first prompt
    await new Promise<void>((r) => setTimeout(r, 300));

    if (piProcess.exitCode !== null) {
      emitEvent(store, "error", { message: "Pi process exited before receiving prompt" });
      store.status = "error";
      scheduleCleanup(store);
      return;
    }

    // Emit a system event so the client's connection-store gets a session_id.
    // Without this the "first send" overlay never dismisses (it waits for sdkSessionId).
    store.sdkSessionId = store.grassId;
    emitEvent(store, "system", { session_id: store.grassId });
  }

  // Fetch any image attachments and convert to base64 (Pi requires inline base64, not URLs)
  let piImages: Array<{ type: "image"; data: string; mimeType: string }> | undefined;
  if (attachments && attachments.length > 0) {
    const results = await Promise.all(attachments.map(fetchImageAsBase64));
    const valid = results.filter((r): r is { data: string; mimeType: string } => r !== null);
    if (valid.length > 0) {
      piImages = valid.map((r) => ({ type: "image" as const, ...r }));
    }
  }

  // Always use "prompt" — Pi RPC uses it for every turn, including follow-ups.
  // "follow_up" means "queue for after current run", not "continue conversation".
  sendCommand(handle!.process, {
    type: "prompt",
    message: promptText,
    ...(piImages ? { images: piImages } : {}),
  });

  // Collect events until agent_end or process exit
  await new Promise<void>((resolve) => {
    let resolved = false;
    const done = () => {
      if (resolved) return;
      resolved = true;
      handle!.emitter.off("agent_event", onEvent);
      handle!.emitter.off("process_exit", onExit);
      resolve();
    };

    const onEvent = (event: any) => {
      const stop = handlePiEvent(event, store, handle!);
      if (stop) done();
    };

    const onExit = (code: number | null) => {
      if (!resolved) {
        emitEvent(store, "error", { message: `Pi process exited unexpectedly (code ${code ?? "?"})` });
        store.status = "error";
        scheduleCleanup(store);
      }
      done();
    };

    handle!.emitter.on("agent_event", onEvent);
    handle!.emitter.once("process_exit", onExit);
  });

  if (store.status === "error") return;

  store.status = "done";
  notifyPermissionsChanged();
  emitEvent(store, "done", {});
  notifySessionDone(store);
  scheduleCleanup(store);
}

// ── Abort ─────────────────────────────────────────────────────────────────────

export async function abortSession(grassId: string): Promise<void> {
  const handle = piHandles.get(grassId);
  if (!handle) return;
  try {
    sendCommand(handle.process, { type: "abort" });
  } catch {
    handle.process.kill("SIGTERM");
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sendCommand(proc: ChildProcess, cmd: object): void {
  proc.stdin?.write(JSON.stringify(cmd) + "\n");
}

/**
 * Map a Pi AgentEvent to grass SSE events.
 * Returns true when the agent has finished (agent_end).
 *
 * Key invariant: the connection-store REPLACES the last assistant message content
 * on each "assistant" SSE event (same as Claude). So we must emit the FULL
 * accumulated text on every text_delta — not just the delta chunk itself.
 */
function handlePiEvent(event: any, store: SessionStore, handle: PiHandle): boolean {
  if (!event?.type) return false;

  switch (event.type) {
    case "response": {
      // Command acknowledgement — only care about errors
      if (!event.success && event.error) {
        emitEvent(store, "error", { message: event.error });
        store.status = "error";
        scheduleCleanup(store);
        return true;
      }
      return false;
    }

    case "turn_start": {
      // New turn — reset text accumulator so this turn's message starts fresh
      handle.textBuffer = "";
      emitEvent(store, "status", { status: "thinking" });
      return false;
    }

    case "message_update": {
      const ae = event.assistantMessageEvent;
      if (!ae) return false;

      if (ae.type === "text_delta" && ae.delta) {
        // Accumulate — emit full content so far (store replaces, not appends)
        handle.textBuffer += ae.delta;
        emitEvent(store, "assistant", { content: handle.textBuffer });
      } else if (ae.type === "thinking_delta") {
        emitEvent(store, "status", { status: "thinking" });
      }
      return false;
    }

    case "tool_execution_start": {
      const input = formatToolInput(event.toolName, event.args);
      emitEvent(store, "tool_use", { tool_name: event.toolName ?? "tool", tool_input: input });
      return false;
    }

    case "tool_execution_end": {
      if (event.isError) {
        emitEvent(store, "status", { status: "tool_error", tool_name: event.toolName });
      } else {
        emitEvent(store, "status", { status: "tool_summary", summary: event.toolName ?? "tool" });
      }
      return false;
    }

    case "agent_end": {
      return true;
    }

    default:
      return false;
  }
}

async function fetchImageAsBase64(att: { url: string }): Promise<{ data: string; mimeType: string } | null> {
  try {
    const res = await fetch(att.url);
    if (!res.ok) return null;
    const mimeType = (res.headers.get("content-type") ?? "image/jpeg").split(";")[0].trim();
    const buffer = await res.arrayBuffer();
    return { data: Buffer.from(buffer).toString("base64"), mimeType };
  } catch {
    return null;
  }
}

function formatToolInput(toolName: string | undefined, args: any): string {
  if (!args) return "";
  const name = (toolName ?? "").toLowerCase();
  if (name === "bash" && args.command) return String(args.command);
  if ((name === "read" || name === "write" || name === "edit") && args.path) return String(args.path);
  if (typeof args === "object") {
    const s = JSON.stringify(args);
    return s.length > 200 ? s.slice(0, 200) + "…" : s;
  }
  return String(args);
}
