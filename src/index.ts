#!/usr/bin/env node

process.on("SIGINT", () => {
  console.log();
  process.exit(0);
});

import { Command } from "commander";
import { sync } from "./sync";
import { ls } from "./ls";
import { start } from "./server";

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
  .description("Start a workspace server — pick a repo and agent, then chat")
  .option("-c, --caffeinate", "run caffeinate for 8 hours to prevent sleep")
  .option("-r, --relay <url>", "connect to a relay server instead of binding a local port (e.g. wss://relay.example.com)", "wss://relay.codeongrass.com")
  .action(async (opts) => {
    await start("local", undefined, opts.caffeinate ?? false, opts.relay);
  });

program.parse();
