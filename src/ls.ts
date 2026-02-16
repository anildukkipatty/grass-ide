import { select } from "@inquirer/prompts";
import { runProgress, showQR } from "./progress";

interface Sandbox {
  name: string;
  agent: string;
  lastOpened: string;
  sessionUrl: string;
}

const sandboxes: Sandbox[] = [
  { name: "my-saas-app",       agent: "Claude",   lastOpened: "2 minutes ago",  sessionUrl: "https://grass.dev/session/x7k2m" },
  { name: "blog-redesign",     agent: "OpenCode",  lastOpened: "1 hour ago",     sessionUrl: "https://grass.dev/session/p3n8q" },
  { name: "api-server",        agent: "Claude",   lastOpened: "3 hours ago",    sessionUrl: "https://grass.dev/session/r9w4t" },
  { name: "mobile-backend",    agent: "Cursor",   lastOpened: "yesterday",      sessionUrl: "https://grass.dev/session/j5v1a" },
  { name: "landing-page",      agent: "Windsurf", lastOpened: "2 days ago",     sessionUrl: "https://grass.dev/session/m8c6f" },
  { name: "data-pipeline",     agent: "Claude",   lastOpened: "3 days ago",     sessionUrl: "https://grass.dev/session/k2b7d" },
  { name: "chrome-extension",  agent: "OpenCode",  lastOpened: "1 week ago",     sessionUrl: "https://grass.dev/session/h4x9e" },
];

function pad(str: string, len: number): string {
  return str.padEnd(len);
}

export async function ls() {
  console.log();
  console.log("  Available sandboxes:");
  console.log();

  const nameCol = 20;
  const agentCol = 12;

  let chosen: Sandbox;
  try {
    chosen = await select<Sandbox>({
      message: "Select a sandbox",
      choices: sandboxes.map((s) => ({
        name: `${pad(s.name, nameCol)} ${pad(s.agent, agentCol)} ${s.lastOpened}`,
        value: s,
      })),
    });
  } catch {
    console.log();
    process.exit(0);
  }

  console.log();
  console.log(`  Loading ${chosen.name}...`);
  console.log();

  await runProgress([
    { label: "Connecting to sandbox...", duration: 2000 },
    { label: "Restoring session...", duration: 1500 },
    { label: "Ready!", duration: 1500 },
  ]);

  showQR(chosen.sessionUrl);
}
