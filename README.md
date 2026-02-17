<div align="center">

# grass

**Claude on your phone. Code on your machine.**

Run one command. Scan a QR code. Start prompting Claude from any device — while it works in your local project directory.

---

[Installation](#installation) · [Quick Start](#quick-start) · [How It Works](#how-it-works) · [Commands](#commands) · [Contributing](#contributing)

</div>

## What is Grass?

You're working on a project. You want Claude to help. But you also want to walk around, lie on the couch, or just not be glued to your laptop.

Grass gives you that. It spins up a local server that connects a chat UI to a real Claude agent session — the same Claude Code agent that reads your files, writes code, and runs commands. The chat runs in your browser, on any device on your network. Your phone, your tablet, whatever.

```
You on the couch          Your laptop
  (phone browser)  <--->  (grass server + Claude agent)
       WiFi                    Local project directory
```

No cloud relay. No copy-pasting. Just scan and go.

## Installation

```bash
npm install -g @grass-ai/ide
```

That's it. `grass` is now available everywhere.

> [!NOTE]
> Grass requires **Node.js 18+** and uses the [Claude Agent SDK](https://github.com/anthropics/claude-code) under the hood. The SDK handles authentication — make sure you have Claude Code set up and authenticated on your machine.

### Build from source

```bash
git clone https://github.com/grass-ai/grass.git
cd grass/cli

npm install
npm run build
npm install -g .
```

## Quick Start

```bash
# Navigate to any project
cd ~/my-project

# Start grass
grass start
```

That's it. You'll see something like:

```
Starting grass server on port 3000...
Working directory: /Users/you/my-project

  http://192.168.1.42:3000

  ▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄
  █ ▄▄▄▄▄ █ █ █ █
  █ █   █ █▄█ █ █
  █ ▄▄▄▄▄ █ ▄▄█ █
  ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀

  Scan to open on your phone
```

Open the URL or scan the QR code. You're now chatting with Claude — and it's working directly in your project.

## How It Works

Grass runs a single server that does two things:

1. **Serves a chat UI** — A full-featured React app, embedded directly in the binary. No separate frontend to deploy.
2. **Bridges to Claude** — Each chat session creates a real Claude agent session via the Claude Agent SDK. Claude sees your project files, can edit code, run commands — everything it normally does.

The connection is local. Your prompts go from your browser, over your WiFi, to the grass server running on your machine. Claude runs locally on your machine through the SDK. Nothing leaves your network (except Claude's own API calls to Anthropic).

### Sessions are persistent

Close your browser tab. Your phone dies. The WiFi drops. It doesn't matter — your Claude session keeps running. When you reconnect, you pick up right where you left off. Session history is loaded from disk and streamed back to you.

### Permissions are forwarded to you

When Claude wants to do something that needs approval (run a bash command, write a file), you'll see a permission prompt right in the chat UI. You approve or deny from your phone. You stay in control.

---

## Commands

### `grass start`

The main command. Starts the combined HTTP + WebSocket server.

```bash
grass start [options]
```

| Flag | Description |
|---|---|
| `-n, --network <type>` | IP address source for the QR code URL |

**Network options:**

| Value | Behavior |
|---|---|
| `local` (default) | Uses your machine's LAN IP |
| `tailscale` | Uses your Tailscale IP (requires Tailscale running) |
| `remote-ip` | Fetches your public IP from `api.ipify.org` |
| Any string | Used as-is (e.g., a custom hostname) |

**Examples:**

```bash
# Default — LAN IP, great for phone on same WiFi
grass start

# Use Tailscale for remote access
grass start --network tailscale

# Use a custom domain
grass start --network mybox.local
```

### `grass sync`

Sync project to cloud. *(Currently a preview/demo — not yet functional.)*

### `grass ls`

List available sandboxes. *(Currently a preview/demo — not yet functional.)*

---

## Architecture

```
┌─────────────────────────────┐
│  Browser (any device)       │
│  React chat UI              │
│  ─ markdown rendering       │
│  ─ syntax highlighting      │
│  ─ permission modals        │
│  ─ diff viewer              │
└──────────┬──────────────────┘
           │ WebSocket + HTTP
           │ (single port: 3000)
┌──────────▼──────────────────┐
│  Grass Server               │
│  ─ session management       │
│  ─ tool permission relay    │
│  ─ streaming message bridge │
│  ─ git diff integration     │
└──────────┬──────────────────┘
           │ Claude Agent SDK
┌──────────▼──────────────────┐
│  Claude Agent Session       │
│  ─ file read/write          │
│  ─ bash execution           │
│  ─ code search              │
│  ─ multi-turn conversation  │
└─────────────────────────────┘
```

### Session Management

Sessions are the core abstraction. Each WebSocket connection is tied to a Claude agent session.

- **Persistence** — Sessions survive disconnects. If a client drops mid-query, Claude keeps running. The client reconnects and receives buffered output.
- **Resumption** — Clients can reconnect to any prior session by ID. History is loaded from Claude's transcript files on disk (`~/.claude/projects/<cwd>/<session-id>.jsonl`).
- **Idle cleanup** — Disconnected sessions with no active query are cleaned up after 10 minutes.
- **Single-client** — Each session supports one active client. A new connection to an existing session evicts the previous one.

### WebSocket Protocol

**Client → Server:**

| Message | Purpose |
|---|---|
| `{ type: "ping" }` | Keepalive |
| `{ type: "init", sessionId }` | Resume existing session |
| `{ type: "message", content }` | Send prompt to Claude |
| `{ type: "abort" }` | Cancel in-progress query |
| `{ type: "list_sessions" }` | List resumable sessions |
| `{ type: "get_diffs" }` | Request `git diff HEAD` |
| `{ type: "permission_response", toolUseID, approved }` | Respond to permission request |

**Server → Client:**

| Message | Purpose |
|---|---|
| `{ type: "pong" }` | Keepalive response |
| `{ type: "sessions_list", sessions }` | List of `{ id, preview }` |
| `{ type: "session_status", streaming, sessionId }` | Current session state |
| `{ type: "history", messages }` | Past transcript on resume |
| `{ type: "system", subtype: "init", data }` | Session initialized |
| `{ type: "assistant", id, content }` | Streaming assistant text |
| `{ type: "tool_use", tool_name, tool_input }` | Claude is calling a tool |
| `{ type: "status", status, tool_name?, elapsed? }` | Activity indicator |
| `{ type: "result", subtype, cost, duration_ms, num_turns }` | Query complete |
| `{ type: "permission_request", toolUseID, toolName, input }` | Permission required |
| `{ type: "diffs", diff }` | Raw git diff output |
| `{ type: "error", message }` | Error |
| `{ type: "aborted", message }` | Query was cancelled |

### Chat UI Features

The UI is a self-contained React app embedded in the server binary. No build step, no separate deployment.

- **Markdown rendering** with syntax-highlighted code blocks (via `marked` + `highlight.js`)
- **Light/dark theme** toggle (persisted in `localStorage`, respects system preference)
- **Session picker** — browse and resume prior conversations
- **Diff viewer** — full-screen file-by-file git diff display with syntax highlighting
- **Permission modals** — approve/deny Claude's tool usage with formatted previews
- **Activity indicators** — animated status showing what Claude is doing ("Thinking", "Reading file", "Running bash")
- **Cost tracking** — each response shows API cost and duration
- **Mobile-first** — safe-area insets, touch targets, disabled zoom, `100dvh` layout
- **Auto-reconnect** — exponential backoff (1s → 30s) with connection status indicator

## Project Structure

```
cli/
├── src/
│   ├── index.ts         # CLI entrypoint (commander setup)
│   ├── start.ts         # Server, WebSocket, Claude integration, session management
│   ├── client-html.ts   # Embedded React chat UI
│   ├── sync.ts          # Sync command (preview)
│   ├── ls.ts            # List command (preview)
│   └── progress.ts      # Progress bar + QR utilities
├── dist/                # Compiled output (CommonJS)
├── package.json
├── tsconfig.json
└── CLAUDE.md            # Project instructions for Claude Code
```

## Tech Stack

| Component | Technology |
|---|---|
| Language | TypeScript (CommonJS, ES2020) |
| CLI | Commander v14 |
| WebSocket | ws v8 |
| AI | Claude Agent SDK v0.2.42 |
| UI | React 18 (CDN), Babel standalone |
| Markdown | marked + highlight.js |
| QR codes | qrcode-terminal |

## Development

```bash
# Run in dev mode (no build step)
npm run dev -- start

# Build
npm run build

# Run built version
./dist/index.js start
```

The working directory where you run `grass start` is the directory Claude operates in. Always `cd` to your project first.

## Security Considerations

> [!IMPORTANT]
> Grass has **no authentication**. Anyone who can reach port 3000 on your network can interact with Claude on your machine. The `--network` flag controls which IP the QR code displays, but does not restrict access.
>
> Use on trusted networks only. For remote access, prefer Tailscale or similar private networking.

## Contributing

Contributions are welcome. If you want to help:

1. Fork the repo
2. Create a branch (`git checkout -b my-feature`)
3. Make your changes
4. Run `npm run build` to verify compilation
5. Open a PR

Please keep changes focused and avoid unnecessary refactoring. If you're unsure whether a change fits, open an issue first.

## License

ISC
