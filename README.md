<div align="center">

# Jarvis

**A persistent AI engineering partner. Talk to it from anywhere; it puts coding agents to work on your machine.**

Run one command. Scan a QR code. Say what you need — Jarvis works out which project it concerns, hands the work to a Claude Code agent in that project's checkout, and you come back when it's done.

---

[Installation](#installation) · [Quick Start](#quick-start) · [How It Works](#how-it-works) · [Commands](#commands) · [API Reference](#api-reference) · [Contributing](#contributing)

</div>

## What is Jarvis?

Jarvis is a **persistent engineering partner** built on top of Claude Code and other coding harnesses (Opencode, Codex). Underneath it is a bot hub:

A *bot* is a named, reusable agent you define once: a job description that is appended to the harness's own system prompt, an emoji and a name, setup instructions for what it needs on a machine, a default repo, a model, and a permission mode. Once a bot exists, you give it work in *threads* — each thread is a live agent session scoped to a folder, and a bot can have as many as you want.

Jarvis spins up a local server that serves the bot hub UI and bridges every thread to a real agent session on your machine — one that reads your files, writes code, and runs commands. The hub runs in your browser, on any device on your network. Your phone, your tablet, whatever.

```
You on the couch          Your laptop
  (phone browser)  <--->  (jarvis server)
       WiFi                bots → threads → Claude Code / Opencode / Codex
                           running in your local project directories
```

No copy-pasting. Just scan and go.

## Jarvis

Jarvis is the front door. Instead of picking a bot and a folder, you open the hub and say what you need:

> What's the latest commit on Grass? · Review Madan's latest PR · Did we ever build the MCP feature in Zap Eve? Check it's ready for tomorrow's demo.

Jarvis works out which **project** the request concerns and how the work should happen:

- **Handoff** — the conversation moves into the project. Its agent (Claude Code, running in the project's checkout) answers you directly, and your follow-ups ("why did we do that?", "review it properly", "fix it, but don't merge") stay there with full context.
- **Delegate** — Jarvis gives one or more project agents a bounded task, waits for their reports, and answers you itself. Used for cross-project questions and anything Jarvis needs to combine.

Work runs on the machine where `jarvis start` is running, so you can close your phone and come back: the **Recent** list on the Jarvis screen shows every thread across projects, with the ones still running marked live, and opening one rejoins it.

### Projects

A project is an engineering context, not just a repo. Each one is a Markdown file under `~/jarvis/projects/<slug>.md`:

```markdown
---
name: Grass
path: /Users/you/projects/grass
repo: https://github.com/you/grass
---
# Grass
People, useful commands, architecture notes, previous work — whatever helps.
```

Jarvis reads these, keeps them up to date as it learns, and creates one when you mention a project it doesn't know: it will offer an unclaimed folder in the workspace if one matches, or ask for the repo URL and clone it. `~/jarvis/CLAUDE.md` holds what Jarvis should always know about you (standing rules, people). Set `JARVIS_DIR` to move the directory.

Under the hood, Jarvis and every project are bots in the hub — so threads, resume, transcripts and the Projects & bots page all work as before. Jarvis runs with its own in-process tools (`list_projects`, `read_project`, `create_project`, `update_project`, `delegate`, `handoff`) and without a shell of its own; project agents run in `auto-approve` mode so dispatched work does not stall waiting for taps. Neither merges, pushes to a shared branch or deletes anything unless you asked for it in the conversation.

Run `jarvis start` from the directory that holds your checkouts (e.g. `~/projects`) — that is where new projects are cloned.

## Installation

```bash
npm install -g jarvis-ai
```

That's it. `jarvis` is now available everywhere.

> [!NOTE]
> Jarvis requires **Node.js 18+**. The Claude Code agent requires the `claude` CLI to be installed and authenticated on your machine. The Opencode agent requires the `@opencode-ai/sdk` package. The Codex agent requires the `codex` CLI.

### Build from source

```bash
git clone https://github.com/anildukkipatty/grass-ide.git
cd grass-ide/cli   # branch: jarvis

npm install
npm run build
npm install -g .
```


## Quick Start

```bash
# Navigate to a workspace directory (parent of your repos, or a specific project)
cd ~/projects

# Start Jarvis
jarvis start -p 3000
```

That's it. You'll see something like:

```
jarvis — starting in /Users/you/projects
  available agents: claude-code, opencode, codex
  workspace: /Users/you/projects
  port: 3000 (specified)

  Local Network  http://192.168.1.42:3000

  ▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄
  █ ▄▄▄▄▄ █ █ █ █
  █ █   █ █▄█ █ █
  █ ▄▄▄▄▄ █ ▄▄█ █
  ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀

  Scan to open on your phone
```

Open the URL or scan the QR code. You land on the Jarvis screen: ask about any project, or hand over some work. The Projects page underneath still lets you make hand-crafted bots with their own instructions and setup steps.

## How It Works

Jarvis runs a single HTTP server that handles everything:

1. **Serves the bot hub UI** — A full-featured React app, embedded directly in the binary. No separate frontend to deploy.
2. **Stores your bots** — Bots and their threads live in a JSON store under your home directory, so they survive restarts and are shared by every workspace on the machine.
3. **Manages a workspace** — Jarvis treats the directory where you run `jarvis start` as a workspace. It can list the subdirectories as repos, browse their file trees, read files, and clone new repos into the workspace.
4. **Bridges bots to harnesses** — Each thread creates a real agent session via the Claude Agent SDK (Claude Code), the Opencode SDK, or the Codex CLI, with the bot's instructions appended to the harness's own system prompt. The agent sees your project files, can edit code, run commands — everything it normally does.
5. **Streams events to the UI** — Agent output is delivered via Server-Sent Events (SSE), so the UI receives a live stream of assistant messages, tool calls, permission requests, and status updates.

By default the connection is local: your prompts go from your browser, over your WiFi, to the Jarvis server on your machine. Nothing leaves your network (except the agent's own API calls to Anthropic or its configured provider). Pass `--relay` instead and the server dials out to a relay so you can reach it from outside your LAN.

### Bots carry their own setup

A bot can declare what it needs from a machine — "ffmpeg must be on PATH", "run `npm install` in the repo". The first time that bot lands on a machine, Jarvis opens a **setup thread** and lets the bot prepare the machine itself, once. Until that setup is marked complete, the bot will not accept work threads. Setup travels with the bot definition, so a bot shared with someone else knows how to set itself up on their machine too.

### Threads are where the work happens

A thread belongs to one bot and runs in one folder — the folder you pick, else the bot's default repo, else the directory you started Jarvis in. Threads are listed, renamed, rejoined and deleted from the hub, and their messages are read back from the harness's own transcript on disk rather than duplicated into Jarvis's store.

### Sessions are persistent

Close your browser tab. Your phone dies. The WiFi drops. It doesn't matter — your agent session keeps running on your machine. When you reconnect, you pick up right where you left off. Claude Code session history is loaded from its transcript files on disk; Opencode history is fetched from its local server.

### Permissions are forwarded to you

When the agent wants to do something that needs approval (run a bash command, edit a file, fetch a URL), you'll see a permission prompt right in the chat UI. You approve or deny from your phone. You stay in control.

### Dictation

Both message boxes have a mic button: tap to record, tap again to stop. The clip is transcribed with Deepgram (`nova-2`) and then cleaned up by `gpt-4o-mini` — filler words dropped, self-corrections resolved ("5, no, make it 6" becomes "6") — and the polished instruction lands in the box for you to review and send. Set `DEEPGRAM_API_KEY` and `OPENAI_API_KEY` to enable it — either exported in the shell or in an env file (see below). Browsers only allow microphone access over `https` or on `localhost`, so on a plain-`http` LAN address the button will report that; relay mode works from any device.

### API keys and env files

Jarvis reads keys from `process.env`, and on startup it also loads them from the first of these files that defines them — a real environment variable always wins:

| Path | When to use it |
|---|---|
| `$JARVIS_ENV_FILE` | explicit override |
| `./.env` | the directory you run `jarvis start` in |
| `~/.config/jarvis/env` | machine-wide; written by `scripts/sandbox-setup.sh` |

```sh
# .env
DEEPGRAM_API_KEY=...
OPENAI_API_KEY=...
```

Usual format: `KEY=value` per line, `#` comments, optional quotes, a leading `export` is ignored. Each file that supplies a key is printed at startup. `.env` is gitignored — keep keys out of the repo.

### Ports and the relay

`jarvis start` runs locally and binds port `3000` by default. Pass `-p <port>` to use a different one — handy when several instances run at once in different directories. Passing `-r <url>` (and no `-p`) switches to relay mode instead: the server dials out to the relay, defaulting to `wss://relay.codeongrass.com`, so the hub is reachable from outside your LAN. An explicit `-p` always wins over `-r`.

---

## Commands

### `jarvis start`

The only command. Starts Jarvis — an HTTP server with SSE event streaming.

```bash
jarvis start [options]
```

| Flag | Description |
|---|---|
| `-p, --port <number>` | Bind this local port and serve the UI at `http://localhost:<port>` (implies `--local`; default `3000`) |
| `-l, --local` | Bind a local port instead of connecting to the relay |
| `-r, --relay <url>` | Connect to a relay server instead of binding a local port (default: `wss://relay.codeongrass.com`) |
| `-c, --caffeinate` | Prevent macOS sleep for 8 hours while the server is running |

**Examples:**

```bash
# Default — local server on port 3000, great for a phone on the same WiFi
jarvis start

# A different local port
jarvis start -p 4000

# Relay mode — reachable from outside your LAN
jarvis start --relay wss://relay.codeongrass.com

# Point at your own relay
jarvis start --relay wss://relay.example.com

# Keep your Mac awake while your bots work
jarvis start -p 3000 --caffeinate
```

---

## API Reference

Jarvis exposes a REST + SSE API. All endpoints return JSON unless noted.

### Workspace & Infrastructure

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Returns `{ status: "ok", cwd }` |
| `GET` | `/agents` | Returns `{ agents: string[] }` — list of available agents |
| `GET` | `/repos` | List subdirectories of the workspace as `{ name, path, isGit }[]` |
| `GET` | `/repos/details?repoPath=<path>` | Returns `{ branch, lastCommit, dominantLanguage }` for a specific repo |
| `POST` | `/repos/clone` | Clone a git repo into the workspace. Body: `{ url }`. Returns `{ path, name }` |
| `POST` | `/folders` | Create an empty folder in the workspace. Body: `{ name }`. Returns `{ path, name }` |
| `GET` | `/dir?repoPath=<path>&path=<subpath>` | List directory entries (files and folders) within a repo. Path is validated to stay inside `repoPath`. |
| `GET` | `/file?repoPath=<path>&path=<filePath>` | Read a file. Path is validated to stay inside `repoPath`. 5 MB max. |
| `GET` | `/diffs?repoPath=<path>` | Returns `git diff HEAD` output for a repo as `{ diff }` |

### Jarvis

| Method | Path | Description |
|---|---|---|
| `GET` | `/jarvis` | Jarvis's bot, its directory, and the known projects |
| `POST` | `/jarvis/ask` | Start a fresh Jarvis conversation. Body: `{ prompt }`. Returns `{ thread, sessionId }` |
| `GET` | `/sessions/active` | Threads with a turn in flight, as `{ active: { threadId, sessionId }[] }` — for rejoining after a reload |

Jarvis's event stream carries three extra event types: `delegation` (`project`, `botId`, `threadId`, `sessionId`, `title`, `status`), `handoff` (same fields, no status — the client moves to that thread) and `project_created` (`project`).

### Bots & Threads

| Method | Path | Description |
|---|---|---|
| `GET` | `/bots` | List all bots |
| `POST` | `/bots` | Create a bot. Body: `{ name, description?, emoji?, instructions?, setupInstructions?, model?, repoPath?, permissionMode?, allowedTools?, disallowedTools? }`. Returns `{ bot, setupThread? }` |
| `GET` | `/bots/:id` | Fetch one bot |
| `PATCH` | `/bots/:id` | Update a bot. Returns `{ bot, setupThread? }` |
| `DELETE` | `/bots/:id` | Delete a bot |
| `POST` | `/bots/:id/setup` | Mark this machine's setup. Body: `{ action: "complete" \| "reset" \| "fail" }` |
| `GET` | `/threads?botId=<id>` | List threads, optionally filtered to one bot |
| `POST` | `/threads` | Open a thread. Body: `{ botId, repoPath?, title? }`. Returns `409` with `setupRequired` if the bot has not set up this machine yet |
| `GET` | `/threads/:id` | Fetch one thread |
| `PATCH` | `/threads/:id` | Update a thread (e.g. rename) |
| `DELETE` | `/threads/:id` | Delete a thread |
| `GET` | `/threads/:id/messages` | Message history for a thread, read from the harness transcript |

### Sessions

| Method | Path | Description |
|---|---|---|
| `GET` | `/sessions?agent=<agent>&repoPath=<path>` | List past sessions for a repo and agent |
| `GET` | `/sessions/:id/history?agent=<agent>&repoPath=<path>` | Load message history for a session |
| `GET` | `/sessions/:id/status` | Returns `{ streaming: boolean }` |
| `POST` | `/sessions/:id/abort` | Cancel an in-progress session |
| `POST` | `/sessions/:id/permission` | Respond to a permission request. Body: `{ toolUseID, approved: boolean }` |

### Chat

| Method | Path | Description |
|---|---|---|
| `POST` | `/chat` | Start or continue a session. Body: `{ repoPath, agent, prompt, sessionId? }`. Returns `{ sessionId }` |

### Dictation

| Method | Path | Description |
|---|---|---|
| `GET` | `/dictate/status` | Returns `{ deepgram: boolean, openai: boolean }` — whether each key is set |
| `POST` | `/dictate` | Transcribe and clean up a voice clip. Body: `{ audio: <base64>, mimeType }`. Returns `{ text }` |

### Streaming Events

| Method | Path | Description |
|---|---|---|
| `GET` | `/events?sessionId=<id>` | SSE stream for a specific session. Supports `Last-Event-ID` for reconnect/replay. |
| `GET` | `/permissions/events` | Global SSE stream of all pending permission requests across all active sessions |

#### SSE Event Types (`/events`)

| Event type | Payload fields | Description |
|---|---|---|
| `user_prompt` | `prompt` | The prompt that was sent to the agent |
| `system` | `subtype`, `data` | Agent session initialized |
| `assistant` | `content` | Streaming assistant text |
| `tool_use` | `tool_name`, `tool_input` | Agent is calling a tool |
| `status` | `status`, `tool_name?` | Activity indicator ("thinking", "tool") |
| `permission_request` | `toolUseID`, `toolName`, `input` | Agent is requesting permission |
| `result` | `subtype`, `cost`, `duration_ms`, `num_turns` | Query complete (success or error) |
| `done` | — | Session finished |
| `aborted` | `message` | Session was cancelled |
| `error` | `message` | An error occurred |
| `agent_error` | `message` | Agent-side error (opencode) |

Events include a `seq` field and are delivered with SSE `id:` headers so clients can use `Last-Event-ID` to resume a stream without missing events.

#### SSE Event Types (`/permissions/events`)

| Event type | Payload fields | Description |
|---|---|---|
| `permissions` | `permissions[]` | Full snapshot of all pending permissions across all sessions |

Each permission entry includes `sessionId`, `agent`, `repoPath`, `repoName`, `toolUseID`, `toolName`, and `input`.

---

## Architecture

```
┌─────────────────────────────┐
│  Browser (any device)       │
│  React bot hub UI           │
│  ─ bots + threads           │
│  ─ repo + folder picker     │
│  ─ markdown rendering       │
│  ─ syntax highlighting      │
│  ─ permission modals        │
│  ─ diff viewer              │
│  ─ file browser             │
└──────────┬──────────────────┘
           │ HTTP + SSE
           │ (local port, or via relay)
┌──────────▼──────────────────┐
│  Jarvis Server              │
│  ─ bot + thread store       │
│  ─ workspace management     │
│  ─ session management       │
│  ─ tool permission relay    │
│  ─ SSE event streaming      │
│  ─ repo details + file API  │
└──────┬───────────┬──────────┘
       │           │            │
  Claude SDK   Opencode SDK   Codex CLI
┌──────▼──────┐ ┌──▼──────────┐ ┌▼────────────┐
│ Claude Code │ │  Opencode   │ │   Codex     │
│  harness    │ │  harness    │ │   harness   │
└─────────────┘ └─────────────┘ └─────────────┘
```

### Transport: SSE instead of WebSocket

Jarvis uses **Server-Sent Events (SSE)** for streaming, not WebSockets. The client sends requests via regular HTTP POST and receives the response stream via a GET `/events` connection. This means:

- Standard HTTP — works through proxies and most network configurations
- The `Last-Event-ID` header lets clients reconnect and replay any buffered events they missed
- The `/permissions/events` endpoint provides a single global stream for all pending permissions, useful for building dashboard-style UIs that manage multiple sessions at once

### Session Management

Sessions are the core abstraction. A session is created when a `/chat` POST is received, and lives in memory on the server.

- **Persistence** — Sessions survive client disconnects. If the browser closes mid-query, the agent keeps running. When the client reconnects, it can replay buffered events using `Last-Event-ID`.
- **Resumption** — Clients can resume prior sessions by passing `sessionId` to `/chat`. For Claude Code, the SDK resumes from the `.jsonl` transcript file on disk. For Opencode, the SDK resumes from its local session store.
- **Multi-repo** — Each session is scoped to a `repoPath`. The agent runs with that directory as its working directory.
- **Idle cleanup** — Automatic cleanup is currently disabled. Sessions are kept in memory indefinitely (cleanup will be re-enabled once a race-condition-free implementation is ready).
- **Abort** — `POST /sessions/:id/abort` cancels a running session. For Claude Code, this signals an `AbortController`. For Opencode, it calls the SDK abort endpoint and immediately marks the session done.

### Multi-Agent Support

Jarvis detects which harnesses are available at startup by checking for the `claude` CLI, the `@opencode-ai/sdk` package, and the `codex` CLI. It reports the available agents at `/agents`. A bot's `model` and `permissionMode` are applied to whichever harness runs its threads.

**Claude Code** (`claude-code`): Uses the `@anthropic-ai/claude-agent-sdk` `query()` function. Runs the `claude-opus-4-6` model in `default` permission mode. Supports `canUseTool` for per-tool permission prompts. Session transcripts are stored at `~/.claude/projects/<cwd>/<session-id>.jsonl`.

**Opencode** (`opencode`): Uses the `@opencode-ai/sdk`. Jarvis spawns an Opencode server process at startup (or connects to one already running on port 4096). Per-directory clients are maintained so sessions can be scoped to different repos simultaneously. Events are received via a persistent Opencode event stream (`client.event.subscribe()`). If the stream fails, it reconnects automatically after 2 seconds.

### Repo Details

`GET /repos/details?repoPath=<path>` returns metadata about a git repository without loading its full file tree:

- **`branch`** — current HEAD branch name
- **`lastCommit`** — message, hash, and timestamp of the most recent commit
- **`dominantLanguage`** — the most common file extension in the repo (determined by `git ls-files`, so it respects `.gitignore`)

### File System API

`GET /dir` and `GET /file` provide a sandboxed file browser. Both endpoints validate that the requested path is inside the given `repoPath` before serving anything, preventing path traversal. `readFile` enforces a 5 MB cap.

### Session Titles

When listing Claude Code sessions, Jarvis first looks for a `custom-title` entry in the session's `.jsonl` transcript. If found, that title is used as the session preview. Otherwise, it collects text from the first few user and assistant messages to build a ~80-character preview string.

### Chat UI Features

The UI is a self-contained React app embedded in the server binary. No build step, no separate deployment.

- **Bot hub** — create, edit and delete bots; presets to start from; per-bot thread lists
- **Setup threads** — a bot prepares this machine once, in a thread of its own, before it takes work
- **Repo + folder picker** — choose where a thread runs
- **Markdown rendering** with syntax-highlighted code blocks (via `marked` + `highlight.js`)
- **Light/dark theme** toggle (persisted in `localStorage`, respects system preference)
- **Session picker** — browse and resume prior conversations
- **Diff viewer** — full-screen file-by-file git diff display with syntax highlighting
- **File browser** — browse the repo file tree and read file contents from within the UI
- **Permission modals** — approve/deny the agent's tool usage with formatted previews (including diff previews for file edits)
- **Activity indicators** — animated status showing what the agent is doing ("Thinking", "Reading file", "Running bash")
- **Cost tracking** — each response shows API cost and duration
- **Mobile-first** — safe-area insets, touch targets, disabled zoom, `100dvh` layout
- **Auto-reconnect** — exponential backoff with connection status indicator

## Project Structure

```
cli/
├── src/
│   ├── index.ts           # CLI entrypoint (commander setup)
│   ├── server.ts          # HTTP request routing, session lifecycle
│   ├── server-common.ts   # Shared: HTTP server, SSE, session store, workspace routes
│   ├── start-claude-code.ts  # Claude Code harness integration
│   ├── start-opencode.ts  # Opencode harness integration
│   ├── start-codex.ts     # Codex harness integration
│   ├── workspace.ts       # Repo listing, file browser, git details, clone
│   ├── bot-store.ts       # Bot + thread persistence (JSON store)
│   ├── bot-routes.ts      # REST surface for /bots and /threads
│   ├── jarvis.ts          # Jarvis directory, project files, Jarvis/project bots and prompts
│   ├── jarvis-tools.ts    # Jarvis's in-process tools: projects, delegate, handoff
│   ├── turns.ts           # Start a turn on a thread (shared by /chat and Jarvis)
│   ├── relay-client.ts    # Relay mode transport
│   └── client-html.ts     # Embedded React bot hub UI
├── dist/                  # Compiled output (CommonJS)
├── package.json
├── tsconfig.json
└── CLAUDE.md              # Project instructions for Claude Code
```

## Tech Stack

| Component | Technology |
|---|---|
| Language | TypeScript (CommonJS, ES2020) |
| CLI | Commander v14 |
| Transport | HTTP + Server-Sent Events (SSE) |
| Claude Code | `@anthropic-ai/claude-agent-sdk` |
| Opencode | `@opencode-ai/sdk` |
| Codex | `codex` CLI |
| UI | React 18 (CDN), Babel standalone |
| Markdown | marked + highlight.js |
| QR codes | qrcode-terminal |

## Development

```bash
# Run in dev mode (no build step)
npm run dev -- start -p 3000

# Build
npm run build

# Run built version
./dist/index.js start -p 3000
```

The working directory where you run `jarvis start` is treated as the workspace root. Repos are the subdirectories of that workspace. You can run Jarvis from any directory — the hub lets you pick the folder a thread runs in. Bots themselves are stored per-machine, not per-workspace.

## Security Considerations

> [!IMPORTANT]
> Jarvis has **no authentication**. Anyone who can reach the Jarvis port on your network can run your bots on your machine, browse your project files, and read file contents. Bots can be given `auto-approve` permission mode, in which case they act without asking you first.
>
> Use local mode on trusted networks only. Relay mode exposes the hub beyond your LAN — only use it if you accept that.

## Contributing

Contributions are welcome. If you want to help:

1. Fork the repo
2. Create a branch (`git checkout -b my-feature`)
3. Make your changes
4. Run `npm run build` to verify compilation
5. Open a PR

Please keep changes focused and avoid unnecessary refactoring. If you're unsure whether a change fits, open an issue first.

## License

MIT — see [LICENSE](LICENSE) for details.
