import {
  createHttpServer,
  setupShutdown,
  handleWorkspaceMessage,
  type ConnectionState,
} from "./server-common";
import { handleMessage as handleClaudeCode, initAgent as initClaudeCode } from "./start-claude-code";
import { handleMessage as handleOpencode, initAgent as initOpencode } from "./start-opencode";

export async function start(network: string = "local", portOverride?: number, caffeinate: boolean = false) {
  const workspaceCwd = process.cwd();
  console.log(`Starting grass server...`);

  const { server, wss, caffeinatePid } = await createHttpServer({
    portOverride,
    caffeinate,
    network,
    label: "grass server",
  });

  // Initialize agent backends once at server startup
  const claudeAvailable = await initClaudeCode();
  const opencodeAvailable = await initOpencode();
  const availableAgents: string[] = [
    ...(claudeAvailable ? ["claude-code"] : []),
    ...(opencodeAvailable ? ["opencode"] : []),
  ];
  console.log(`  available agents: ${availableAgents.join(", ") || "none"}`);

  wss.on("connection", (ws) => {
    console.log("Client connected");

    const state: ConnectionState = {
      selectedRepoPath: null,
      selectedAgent: null,
      attachedSessionId: null,
    };

    ws.on("message", async (raw) => {
      let parsed: { type: string; [key: string]: any };
      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        ws.send(JSON.stringify({ type: "error", message: "Invalid JSON" }));
        return;
      }

      // Agent availability ping-pong
      if (parsed.type === "get_agents") {
        ws.send(JSON.stringify({ type: "agents_available", agents: availableAgents }));
        return;
      }

      // Workspace-layer messages (identical for all agents)
      if (await handleWorkspaceMessage(parsed, ws, workspaceCwd, state)) return;

      // Agent selection — happens after repo is picked, before first message
      if (parsed.type === "select_agent") {
        const agent = parsed.agent as string;
        if (agent !== "claude-code" && agent !== "opencode") {
          ws.send(JSON.stringify({ type: "error", message: "Unknown agent. Use claude-code or opencode." }));
          return;
        }
        if (!availableAgents.includes(agent)) {
          ws.send(JSON.stringify({ type: "error", message: `Agent '${agent}' is not available on this server.` }));
          return;
        }
        state.selectedAgent = agent;
        console.log(`[workspace] selected agent: ${agent}`);
        ws.send(JSON.stringify({ type: "agent_selected", agent }));
        return;
      }

      // get_cwd is workspace-aware but also reports the active agent
      if (parsed.type === "get_cwd") {
        const cwd = state.selectedRepoPath ?? workspaceCwd;
        ws.send(JSON.stringify({ type: "cwd", cwd, agent: state.selectedAgent ?? "none" }));
        return;
      }

      // All remaining messages require an agent to be selected
      if (!state.selectedAgent) {
        ws.send(JSON.stringify({ type: "error", message: "No agent selected. Pick an agent first." }));
        return;
      }

      // Delegate to the selected agent's handler
      if (state.selectedAgent === "claude-code") {
        await handleClaudeCode(parsed, ws, state, workspaceCwd);
      } else {
        await handleOpencode(parsed, ws, state, workspaceCwd);
      }
    });

    ws.on("close", () => {
      console.log("Client disconnected");
      // Notify the active agent so it can clean up its session attachment
      if (state.selectedAgent === "claude-code") {
        handleClaudeCode({ type: "__disconnect__" }, ws, state, workspaceCwd);
      } else if (state.selectedAgent === "opencode") {
        handleOpencode({ type: "__disconnect__" }, ws, state, workspaceCwd);
      }
    });
  });

  setupShutdown(() => {
    wss.clients.forEach((ws) => ws.close());
    wss.close();
    server.close(() => process.exit(0));
  }, caffeinatePid);
}
