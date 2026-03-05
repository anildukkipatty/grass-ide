# WebSockets vs SSE + Service/Event Architecture — Feasibility Research

## Context

Grass is a local CLI bridge that serves an embedded React app and channels Claude Agent sessions over WebSocket to a browser on the LAN. One Node.js process per working directory, trusted network only, no auth. The WebSocket is the only transport — it handles both streaming server events and all client commands.

---

## Current WebSocket Protocol

The message protocol splits into two fundamentally different categories:

**Server → Client (streaming/push)**
- `assistant` — streamed Claude response chunks
- `tool_use` — Claude calling a tool
- `status` — activity indicator (thinking, running tool)
- `permission_request` — user must approve/deny a tool before it executes
- `result` — query completed (cost, duration, turns)
- `error`, `aborted`, `session_status`, `history`, `repos_list`, `sessions_list`, `diffs`

**Client → Server (commands/request-response)**
- `message` — send a chat prompt
- `abort` — cancel in-flight query
- `permission_response` — approve/deny a tool
- `select_repo`, `select_agent`, `list_repos`, `list_sessions`
- `list_dir`, `read_file`, `clone_repo`, `create_folder`, `get_diffs`

The second category has no business being in a streaming protocol — these are pure request/response semantics forced through a WebSocket message channel.

---

## Architecture: What SSE + REST Would Look Like

**REST endpoints (client → server)**
```
POST /api/message
POST /api/abort
POST /api/permission
GET  /api/repos
GET  /api/sessions
GET  /api/dir
GET  /api/file
POST /api/session/select
POST /api/agent/select
```

**SSE stream (server → client)**
```
GET /api/events?sessionId=...
```
Server pushes: `assistant`, `tool_use`, `status`, `result`, `permission_request`, `error`, `aborted`

This split better reflects actual semantics. `list_dir` is a request/response — forcing it through a WebSocket protocol requires inventing request-ID schemes or relying on ordering. SSE also gives `Last-Event-ID` reconnection semantics for free via the browser's `EventSource` API, replacing the manual `msgSeq` + socket-eviction + ping/pong logic (~80 lines of careful client code) with a built-in mechanism.

---

## Scaling: The Real Argument

The WebSocket scaling problem is not primarily memory per connection — both WebSocket and SSE hold a persistent TCP connection with similar kernel resources. The real problem is **state locality**.

**Current design constraints:**
- `ManagedSession` objects live in memory of the owning Node.js process
- Load balancer must use sticky sessions
- Horizontal scaling requires a WebSocket-aware proxy (NGINX, HAProxy)
- Process crash = session lost from memory (even though JSONL survives on disk)
- A reconnect after crash lands on a different server with no in-memory state

**SSE + Redis pub/sub architecture:**
1. Client POSTs a message → hits any server instance (stateless REST)
2. Server hands work to a job queue or agent runner
3. Agent emits events → publishes to Redis channel `events:{sessionId}`
4. All server instances subscribe to Redis; whichever holds the SSE connection for that session forwards the event to the client
5. No sticky sessions required; any instance can serve any SSE connection

This is the architecture that enables thousands of users across multiple server pods.

**Caveat:** The Claude Code SDK and OpenCode run as stateful, long-running async generators. You cannot put the agent layer behind stateless REST without also introducing a worker/job system (BullMQ, Temporal, dedicated agent runner pool). That is a significant component that does not currently exist.

---

## The Permission Flow Problem

The trickiest migration challenge. Currently:

1. Claude decides to use a tool
2. Server holds execution, waiting on a Promise
3. Sends `permission_request` over WebSocket
4. Awaits `permission_response`
5. Resolves Promise → Claude continues

With SSE + REST:
1. Server pushes `permission_request` over SSE
2. Client sends `POST /api/permission { toolUseId, approved }`
3. Server looks up the pending permission callback by `toolUseId` and resolves it

This works if the HTTP handler and the agent runner share the same process (simple Map lookup). If the agent runner is in a separate worker or pod, you need another coordination layer (Redis, shared memory, etc.).

---

## Recommendation

**Today, for a local CLI tool — no change needed.** The WebSocket approach is appropriate for the use case. The complexity of SSE + REST + message broker + worker pool would dwarf the current codebase for zero user-visible benefit.

**For a cloud-hosted multi-tenant version — yes, but WebSocket is not the biggest problem.** The harder architectural questions are:
- Where do agent sessions run? (Process isolation, per-user sandboxing)
- How to handle stateful, long-running Claude sessions across pod restarts?
- How to store and replay session history from a real database instead of JSONL on disk?
- Auth, rate limiting, cost attribution per tenant

The WebSocket-to-SSE migration is one of the easier parts of that transition. It would happen as part of a broader rearchitecture, not as a standalone change.

**One genuine win available today:** simpler client reconnection. The current `onclose` backoff + ping/pong keepalive + `msgSeq` deduplication is ~80 lines of careful client code. `EventSource` handles most of that for free.

---

## Summary Table

| Concern | WebSocket (current) | SSE + REST |
|---|---|---|
| Bidirectional comms | Native | REST for client → server |
| Streaming server events | Works well | Works better (EventSource reconnect) |
| Memory per connection | ~same | ~same |
| Horizontal scaling | Sticky sessions required | Redis pub/sub enables stateless scaling |
| Proxy/LB compatibility | Needs WS-aware proxy | Standard HTTP everywhere |
| Permission flow | Elegant (Promise-based) | Requires coordination mechanism |
| Current codebase fit | Perfect | Significant rewrite |
| Right time to migrate | When going multi-tenant cloud | Same |

---

## iOS / React Native Battery Consideration

**Question:** Would switching from persistent WebSocket to SSE give serious battery savings on an iOS React Native client?

**Answer: No.**

SSE is still a persistent TCP connection — just HTTP framing instead of WebSocket framing. The iOS radio state machine does not care about the protocol on top of TCP. It cares about bytes being transmitted or received.

**The mechanism:** On LTE, every byte transmission spins the cellular radio up to full power, then triggers a "tail state" (typically 5–20 seconds, carrier-dependent RRC timers) before the radio can drop back to idle. The current code pings every 30 seconds. That means the radio barely ever reaches idle — it wakes, waits out the tail, has a brief idle window, then wakes again. SSE has the same problem: servers must send heartbeat comments (`: keep-alive`) on a similar cadence to prevent proxies from closing the connection.

**The only mechanism that gives serious iOS battery wins is APNs.** Apple maintains a single system-wide persistent connection to their push servers, shared across every app. Individual apps hold no persistent connections — the OS wakes the app when a notification arrives. This is how iOS achieves genuine radio sleep.

However, APNs means a fundamentally disconnected model: server queues events, delivers them as pushes, app reconnects to fetch. For an IDE assistant where the core UX is watching Claude stream a response in real time, this is incompatible with the product.

**Conclusion:** Switching WebSocket to SSE on a React Native iOS client would rewrite meaningful transport code for zero measurable battery improvement. The transport layer is not the problem.
