import { spawn, type ChildProcess } from "child_process";
import { EventEmitter } from "events";
import { createInterface } from "readline";
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
  isFirstMessage: boolean;
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
  const model = store.model ?? "gpt-5-codex";

  let handle = piHandles.get(store.grassId);

  if (!handle) {
    // First message: spawn Pi in RPC mode
    const args = ["--mode", "rpc", "--provider", "openai", "--model", model];
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
    handle = { process: piProcess, emitter, isFirstMessage: true };
    piHandles.set(store.grassId, handle);

    // Pipe stderr to our stderr for debugging
    piProcess.stderr?.on("data", (data: Buffer) => {
      process.stderr.write(data);
    });

    // Read stdout as JSON lines and re-emit as "agent_event"
    const rl = createInterface({ input: piProcess.stdout!, crlfDelay: Infinity });
    rl.on("line", (line) => {
      if (!line.trim()) return;
      try {
        const parsed = JSON.parse(line);
        emitter.emit("agent_event", parsed);
      } catch {
        // ignore non-JSON lines
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
  }

  // Send the right command depending on whether it's the first message
  const command = handle.isFirstMessage ? "prompt" : "follow_up";
  handle.isFirstMessage = false;
  sendCommand(handle.process, { type: command, message: promptText });

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
      const stop = handlePiEvent(event, store);
      if (stop) done();
    };

    const onExit = (code: number | null) => {
      if (!resolved) {
        // Process died unexpectedly
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
 */
function handlePiEvent(event: any, store: SessionStore): boolean {
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
      emitEvent(store, "status", { status: "thinking" });
      return false;
    }

    case "message_update": {
      const ae = event.assistantMessageEvent;
      if (!ae) return false;
      if (ae.type === "text_delta" && ae.delta) {
        emitEvent(store, "assistant", { content: ae.delta });
      } else if (ae.type === "thinking_delta") {
        emitEvent(store, "status", { status: "thinking" });
      } else if (ae.type === "toolcall_start" && ae.toolName) {
        emitEvent(store, "status", { status: "tool", tool_name: ae.toolName });
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
