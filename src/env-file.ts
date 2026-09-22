import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

/**
 * Loads API keys from an env file so they don't have to be exported by hand on
 * every run. Keys already present in the real environment always win, so an
 * explicit `FOO=bar jarvis start` still overrides the file.
 *
 * Files are read in order, first definition of a name winning:
 *
 *   $JARVIS_ENV_FILE        explicit override
 *   ./.env                  the directory jarvis was started in
 *   ~/.config/jarvis/env    machine-wide, written by scripts/sandbox-setup.sh
 *
 * Format is the usual one: KEY=value per line, # comments, blank lines, and
 * optional matching quotes around the value. No interpolation, no `export`
 * expansion beyond stripping the keyword.
 */

export function envFileCandidates(): string[] {
  const paths: string[] = [];
  if (process.env.JARVIS_ENV_FILE) paths.push(process.env.JARVIS_ENV_FILE);
  paths.push(join(process.cwd(), ".env"));
  paths.push(join(homedir(), ".config", "jarvis", "env"));
  return paths;
}

function parse(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim().replace(/^export\s+/, "");
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = line.slice(eq + 1).trim();
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.endsWith(quote) && value.length > 1) {
      value = value.slice(1, -1);
    }
    if (!(key in out)) out[key] = value;
  }
  return out;
}

/** Returns the files that were actually read, for the startup banner. */
export function loadEnvFiles(): string[] {
  const loaded: string[] = [];
  for (const path of envFileCandidates()) {
    if (!existsSync(path)) continue;
    let text: string;
    try {
      text = readFileSync(path, "utf-8");
    } catch (err: any) {
      console.error(`[env] could not read ${path}: ${err.message}`);
      continue;
    }
    const vars = parse(text);
    let used = false;
    for (const [key, value] of Object.entries(vars)) {
      if (process.env[key] === undefined) { process.env[key] = value; used = true; }
    }
    if (used) loaded.push(path);
  }
  return loaded;
}
