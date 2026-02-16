import { WebSocketServer, WebSocket } from "ws";
import { query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";

const PORT = 3000;

export async function start() {
  const cwd = process.cwd();
  console.log(`Starting grass server...`);
  console.log(`  cwd:  ${cwd}`);
  console.log(`  port: ${PORT}`);

  const wss = new WebSocketServer({ port: PORT });

  console.log(`\nListening on ws://localhost:${PORT}`);

  wss.on("connection", (ws) => {
    console.log("Client connected");

    let streaming = false;
    let msgSeq = 0;
    let abortController: AbortController | null = null;
    let sessionId: string | null = null;

    ws.on("message", async (raw) => {
      let parsed: { type: string; content?: string };
      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        ws.send(JSON.stringify({ type: "error", message: "Invalid JSON" }));
        return;
      }

      // Handle abort signal
      if (parsed.type === "abort") {
        if (streaming && abortController) {
          abortController.abort();
          console.log("Client requested abort");
        }
        return;
      }

      if (parsed.type !== "message" || typeof parsed.content !== "string") {
        ws.send(
          JSON.stringify({
            type: "error",
            message: 'Expected { type: "message", content: string } or { type: "abort" }',
          })
        );
        return;
      }

      if (streaming) {
        ws.send(
          JSON.stringify({
            type: "error",
            message: "Already processing a message, wait for result",
          })
        );
        return;
      }

      streaming = true;
      abortController = new AbortController();

      try {
        const q = query({
          prompt: parsed.content,
          options: {
            model: "claude-sonnet-4-5-20250929",
            permissionMode: "bypassPermissions",
            abortController,
            ...(sessionId ? { resume: sessionId } : {}),
          },
        });

        try {
          for await (const msg of q) {
            if (ws.readyState !== WebSocket.OPEN) break;

            // Capture session ID from init message
            if (msg.type === "system" && msg.subtype === "init") {
              sessionId = (msg as any).session_id ?? sessionId;
            }

            const payload = formatMessage(msg, msgSeq);
            if (payload) {
              if (payload.type === "assistant") msgSeq++;
              ws.send(JSON.stringify(payload));
            }
          }
        } catch (err: any) {
          if (err?.name === "AbortError" || abortController.signal.aborted) {
            console.log("Request aborted successfully");
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(
                JSON.stringify({
                  type: "aborted",
                  message: "Request aborted by user",
                })
              );
            }
          } else {
            throw err;
          }
        }
      } catch (err: any) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(
            JSON.stringify({
              type: "error",
              message: err?.message ?? "Unknown error",
            })
          );
        }
      } finally {
        streaming = false;
        abortController = null;
      }
    });

    ws.on("close", () => {
      console.log("Client disconnected");
      if (abortController) abortController.abort();
    });
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log("\nShutting down...");
    wss.clients.forEach((ws) => ws.close());
    wss.close(() => {
      process.exit(0);
    });
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

function formatMessage(
  msg: SDKMessage,
  seq: number
): Record<string, unknown> | null {
  switch (msg.type) {
    case "system":
      return { type: "system", subtype: msg.subtype, data: msg };

    case "assistant": {
      const text = msg.message.content
        .filter((block: any) => block.type === "text")
        .map((block: any) => block.text)
        .join("");
      if (!text) return null;
      return { type: "assistant", id: seq, content: text };
    }

    case "result":
      if (msg.subtype === "success") {
        return {
          type: "result",
          subtype: "success",
          result: msg.result,
          cost: msg.total_cost_usd,
          duration_ms: msg.duration_ms,
          num_turns: msg.num_turns,
        };
      }
      return {
        type: "result",
        subtype: msg.subtype,
        errors: "errors" in msg ? msg.errors : undefined,
        cost: msg.total_cost_usd,
        duration_ms: msg.duration_ms,
      };

    default:
      return null;
  }
}
