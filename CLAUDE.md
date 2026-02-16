# Grass CLI — Claude Code Project Guide

## Project Overview

**Grass** is a CLI tool that bridges clients to Claude agents via the Claude Agent SDK v2. It provides:
- WebSocket server for real-time Claude agent interaction
- Web-based chat UI with light/dark theme support
- Project sync and listing capabilities

**Package name:** `grass`
**Binary:** `grass` (globally installable)
**Tech stack:** TypeScript (CommonJS), Claude Agent SDK v2, WebSocket

## Architecture

```
Client Browser (port 3001) <--> WebSocket (port 3000) <--> Claude Agent SDK (session)
```

- One Claude session per WebSocket connection (multi-turn, persistent)
- Streaming responses forwarded as JSON messages
- Separate HTTP server serves the chat UI

## Key Commands

```bash
grass sync      # Sync project to cloud
grass ls        # List available sandboxes
grass start     # Start WebSocket server (port 3000)
grass client    # Serve chat UI (port 3001)
```

## Project Structure

```
cli/
├── src/
│   ├── index.ts         # CLI entrypoint with commander setup
│   ├── start.ts         # WebSocket server + Claude Agent SDK
│   ├── client.ts        # HTTP server for chat UI
│   ├── client-html.ts   # Embedded HTML for chat interface
│   ├── sync.ts          # Project sync command
│   ├── ls.ts            # List sandboxes command
│   └── progress.ts      # Progress bar utility
├── dist/                # Compiled JS output (CommonJS)
├── package.json         # Dependencies and scripts
└── tsconfig.json        # TypeScript config
```

## Development Workflow

**Build:** `npm run build` — compiles TypeScript to `dist/`
**Dev:** `npm run dev` — runs with tsx (no build step)
**Test locally:** `npm run build && ./dist/index.js [command]`

## Dependencies

### Core
- `@anthropic-ai/claude-agent-sdk` (v0.2.42) — Claude Agent SDK v2 preview
- `ws` — WebSocket server
- `commander` — CLI framework
- `typescript` — Language

### Utilities
- `cli-progress` — Progress bars
- `qrcode-terminal` — QR code generation
- `@inquirer/prompts` — Interactive prompts

## Claude Agent SDK v2 Usage

The SDK uses the `unstable_v2_*` API:

```typescript
const session = unstable_v2_createSession({
  model: "claude-sonnet-4-5-20250929",
  permissionMode: "acceptEdits"
});

await session.send("Your prompt");
for await (const msg of session.stream()) {
  // Handle streaming messages
}
```

**Important notes:**
- `cwd` is NOT a v2 session option (only v1) — sessions use process cwd
- SDK is ESM but works with CommonJS via require
- Session IDs are persistent and can be resumed with `unstable_v2_resumeSession()`

## WebSocket Protocol

**Client → Server:**
```json
{ "type": "message", "content": "your prompt here" }
```

**Server → Client:**
```json
{ "type": "system", "subtype": "init", "data": {...} }
{ "type": "assistant", "content": "response text" }
{ "type": "result", "subtype": "success", "cost": 0.01 }
```

## Recent Changes

### Latest (f6914ae)
- Added light/dark theme toggle to chat UI
- Fixed WebSocket host configuration
- Disabled mobile zoom for better UX
- Fixed disappearing messages bug

## Code Style & Conventions

- **Type:** CommonJS (not ESM)
- **Format:** 2-space indent, no semicolons optional (currently using them)
- **Async:** Use async/await, not callbacks
- **Errors:** Handle WebSocket errors, log clearly
- **Cleanup:** Always implement graceful shutdown (SIGINT/SIGTERM handlers)

## Environment & Configuration

- **Node version:** Works with modern Node.js (18+)
- **Ports:**
  - 3000: WebSocket server (`grass start`)
  - 3001: Chat UI (`grass client`)
- **Required env:** Inherits from process (SDK handles API keys internally)

## Testing & Debugging

- Test WebSocket: Use browser DevTools console or wscat
- Test UI: Open http://localhost:3001 after running `grass client`
- Logs: Console.log statements for debugging (no formal logger yet)

## Future Considerations

- Add proper logging framework
- Add tests (unit + integration)
- Consider splitting WebSocket protocol into separate module
- Add configuration file support (ports, model, etc.)
- Add reconnection logic to client UI
- Add message history persistence

## Notes for AI Assistants

- Always read files before modifying them
- Maintain CommonJS module format (don't convert to ESM)
- Keep WebSocket protocol backward compatible
- Test both `grass start` and `grass client` after changes
- Update BUILD_NOTES.md for significant architectural changes
- Don't add features that aren't requested — keep it simple
