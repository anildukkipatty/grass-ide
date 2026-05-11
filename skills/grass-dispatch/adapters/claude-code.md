# Adapter — Claude Code

Claude Code loads user-level skills from `<HOME>/.claude/skills/<skill-name>/SKILL.md`. To install `grass-dispatch`:

## Install location

| OS | Target path |
|---|---|
| macOS / Linux | `$HOME/.claude/skills/grass-dispatch/SKILL.md` |
| Windows | `%USERPROFILE%\.claude\skills\grass-dispatch\SKILL.md` |

## Install steps (the agent runs these)

1. Locate the bundled SKILL.md inside the installed npm package:
   - It lives at `<global node_modules>/@grass-ai/ide/skills/grass-dispatch/SKILL.md`.
   - Resolve `<global node_modules>` with `npm root -g`.
2. Ensure the target directory exists: `mkdir -p` (POSIX) or `New-Item -ItemType Directory -Force` (PowerShell).
3. Copy `SKILL.md` to the target path. Overwrite if a previous version exists.
4. Tell the user: "`grass-dispatch` skill installed. Try: `dispatch a task to my Grass VM`."

## Detection

The agent is running in Claude Code if **any** of these are true:
- The current process has env var `CLAUDE_CODE_VERSION` set, OR
- `claude --version` resolves and prints a version, OR
- The user explicitly says they're using Claude Code.

## Notes

- Claude Code rereads skills on each new session; no daemon restart needed.
- If `~/.claude/skills/` does not yet exist, create it — it is the expected user-level skill directory.
- Do not write to project-level `.claude/skills/` — those are project-scoped and would not survive switching directories.
