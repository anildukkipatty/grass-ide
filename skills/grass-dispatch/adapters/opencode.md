# Adapter — OpenCode

OpenCode does **not** have a file-based skill loader equivalent to Claude Code's `~/.claude/skills/`. It does support **`AGENTS.md`** — a markdown file that opencode prepends to every session as additional context. We use this mechanism to make the dispatch skill always available.

## Install location

OpenCode reads `AGENTS.md` from (in order of precedence):

| Scope | Path |
|---|---|
| Project | `<project root>/AGENTS.md` |
| Global | macOS / Linux: `$HOME/.config/opencode/AGENTS.md`<br>Windows: `%USERPROFILE%\.config\opencode\AGENTS.md` |

Prefer **global** for the dispatch skill so the user can run `dispatch …` from any project.

## Install steps (the agent runs these)

1. Locate the bundled SKILL.md inside the installed npm package:
   - It lives at `<global node_modules>/@grass-ai/ide/skills/grass-dispatch/SKILL.md`.
   - Resolve `<global node_modules>` with `npm root -g`.
2. Ensure the target directory exists: `mkdir -p ~/.config/opencode` (POSIX) or `New-Item -ItemType Directory -Force` (PowerShell).
3. Append the skill content to `~/.config/opencode/AGENTS.md` under a clear delimiter so it does not collide with anything else in the file:
   ```
   <!-- BEGIN grass-dispatch -->
   <contents of SKILL.md>
   <!-- END grass-dispatch -->
   ```
   If the delimited block already exists, replace it (do not duplicate).
4. Tell the user: "`grass-dispatch` skill installed for OpenCode. Restart OpenCode and try: `dispatch a task to my Grass VM`."

## Detection

The agent is running in OpenCode if **any** of these are true:
- The current process has env var `OPENCODE_VERSION` set, OR
- `opencode --version` resolves, OR
- The user explicitly says they're using OpenCode.

## Notes

- OpenCode reloads `AGENTS.md` on session start; a restart of the OpenCode CLI is usually enough.
- If the global `AGENTS.md` becomes large, an alternative is to place it project-scoped at `<project>/AGENTS.md` — but the user must repeat that per repo.
- This adapter assumes OpenCode 1.x. Verify the `AGENTS.md` path with `opencode --help` if behaviour differs in a newer version.
