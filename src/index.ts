#!/usr/bin/env node

process.on("SIGINT", () => {
  console.log();
  process.exit(0);
});

import { Command } from "commander";
import { sync } from "./sync";
import { ls } from "./ls";
import { start as startClaudeCode } from "./start-claude-code";
import { start as startOpencode } from "./start-opencode";

const program = new Command();

program
  .name("grass")
  .description("Grass CLI")
  .version(require("../package.json").version);

program
  .command("sync")
  .description("Sync your project to the cloud")
  .action(async () => {
    await sync();
  });

program
  .command("ls")
  .description("List available sandboxes")
  .action(async () => {
    await ls();
  });

program
  .command("start")
  .description("Start a WebSocket server for agent interaction")
  .option("-a, --agent <name>", "agent to use: claude-code or opencode", "claude-code")
  .option("-n, --network <type>", "network for QR code: local, tailscale, or remote-ip", "local")
  .option("-p, --port <number>", "port to listen on (default: auto-select from 32100–32199)", parseInt)
  .option("-c, --caffeinate", "run caffeinate for 8 hours to prevent sleep")
  .action(async (opts) => {
    const startFn = opts.agent === "opencode" ? startOpencode : startClaudeCode;
    await startFn(opts.network, opts.port, opts.caffeinate ?? false);
  });

program.parse();
