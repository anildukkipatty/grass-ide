# SSE Architecture Implementation Notes

This document covers two implementation paths for the SSE-based streaming
architecture: one using Redis (for multi-user or horizontally-scaled deployments)
and one using in-memory primitives (for single-user self-hosted deployments).

---

## Architecture Overview

The core flow is the same in both variants:

1. Client sends a `POST /message` with a prompt and a `sessionId`
2. Server starts a Claude streaming job and returns immediately
3. Client opens `GET /events?sessionId=...` to receive a Server-Sent Events stream
4. The server replays any already-buffered events, then streams live events as they arrive
5. On reconnect, the client sends `Last-Event-ID` and the server replays any missed events

The SSE `id` field is a monotonically increasing sequence number per session.
This makes replay exact and idempotent.

---

## Variant A: With Redis

Redis provides two things: a pub/sub channel for live event delivery, and a
sorted set as a durable event buffer that survives reconnects.

### Data Structures

```
session:{sessionId}:events   → Redis Sorted Set, score = seq number
session:{sessionId}:status   → Redis String ("running" | "done" | "error")
session:{sessionId}:live     → Redis Pub/Sub channel name
```

### Worker (Bull Job)

```ts
import Queue from 'bull';
import { redis, redisPub } from './redis';

const claudeQueue = new Queue('claude', { redis: redisConfig });

claudeQueue.process(async (job) => {
  const { sessionId, prompt } = job.data;

  for await (const event of claudeStream(prompt)) {
    const seq = await redis.incr(`session:${sessionId}:seq`);
    const payload = JSON.stringify({ seq, ...event });

    await Promise.all([
      // Store in durable buffer (score = seq for ordered replay)
      redis.zadd(`session:${sessionId}:events`, seq, payload),
      // Publish to live channel
      redisPub.publish(`session:${sessionId}:live`, payload),
    ]);
  }

  await redis.set(`session:${sessionId}:status`, 'done');
  const doneSeq = await redis.incr(`session:${sessionId}:seq`);
  const donePayload = JSON.stringify({ seq: doneSeq, type: 'done' });
  await Promise.all([
    redis.zadd(`session:${sessionId}:events`, doneSeq, donePayload),
    redisPub.publish(`session:${sessionId}:live`, donePayload),
  ]);
});
```

### SSE Handler

The handler must subscribe to the live channel **before** replaying buffered
events. This prevents a race condition where an event is published between the
replay query and the subscribe call.

```ts
import { redisSub } from './redis';

app.get('/events', async (req, res) => {
  const { sessionId } = req.query as { sessionId: string };
  const lastSeq = parseInt(req.headers['last-event-id'] as string) || 0;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const channel = `session:${sessionId}:live`;

  // 1. Subscribe FIRST to avoid missing events published during replay
  await redisSub.subscribe(channel);

  const liveHandler = (_chan: string, message: string) => {
    const event = JSON.parse(message);
    res.write(`id: ${event.seq}\nevent: ${event.type}\ndata: ${message}\n\n`);
    if (event.type === 'done') {
      redisSub.unsubscribe(channel);
      res.end();
    }
  };
  redisSub.on('message', liveHandler);

  // 2. Replay buffered events the client missed
  const missed = await redis.zrangebyscore(
    `session:${sessionId}:events`,
    lastSeq + 1,
    '+inf'
  );
  for (const raw of missed) {
    const event = JSON.parse(raw);
    res.write(`id: ${event.seq}\nevent: ${event.type}\ndata: ${raw}\n\n`);
  }

  // 3. Check if job already finished (no more live events coming)
  const status = await redis.get(`session:${sessionId}:status`);
  if (status === 'done') {
    redisSub.unsubscribe(channel);
    redisSub.off('message', liveHandler);
    res.end();
    return;
  }

  req.on('close', () => {
    redisSub.unsubscribe(channel);
    redisSub.off('message', liveHandler);
  });
});
```

### POST /message

```ts
app.post('/message', async (req, res) => {
  const { sessionId, prompt } = req.body;
  await redis.set(`session:${sessionId}:status`, 'running');
  await claudeQueue.add({ sessionId, prompt });
  res.json({ ok: true });
});
```

### Why the Subscribe-Before-Replay Order Matters

If you replay first and subscribe second, there is a window where the worker
publishes an event after your replay query completes but before your subscribe
call runs. That event is silently dropped. Subscribing first means all live
events are buffered in the subscriber, and the replay guarantees no gaps below
the current sequence.

### Redis Key TTL

Set a TTL on session keys so memory doesn't grow unboundedly:

```ts
await redis.expire(`session:${sessionId}:events`, 3600); // 1 hour
await redis.expire(`session:${sessionId}:status`, 3600);
```

### When to Use This Variant

- Multi-user SaaS where many users share one deployment
- Deployments that need horizontal scaling (multiple API server pods)
- Situations where job persistence across process restarts is required
- When you already have Redis in your stack

---

## Variant B: Without Redis (In-Memory, Single-User Self-Hosted)

For a single-user self-hosted deployment, Redis is solving distributed systems
problems that don't exist. Everything can be replaced with two Node.js
primitives:

- **`EventEmitter`** — replaces Redis pub/sub
- **Array on a `Map`** — replaces the Redis sorted set

No Bull, no Redis, no extra infrastructure.

### Data Structures

```ts
interface StoredEvent {
  seq: number;
  type: string;
  [key: string]: unknown;
}

interface SessionStore {
  seq: number;
  events: StoredEvent[];
  status: 'running' | 'done' | 'error';
  emitter: EventEmitter;
}

const sessions = new Map<string, SessionStore>();
```

### Worker (plain async function, no Bull)

```ts
import { EventEmitter } from 'events';

async function runClaude(sessionId: string, prompt: string): Promise<void> {
  const session = sessions.get(sessionId)!;

  for await (const event of claudeStream(prompt)) {
    const seq = ++session.seq;
    const stored: StoredEvent = { seq, ...event };
    session.events.push(stored);           // durable buffer
    session.emitter.emit('event', stored); // live delivery
  }

  session.status = 'done';
  const doneEvent: StoredEvent = { seq: ++session.seq, type: 'done' };
  session.events.push(doneEvent);
  session.emitter.emit('event', doneEvent);

  // Clean up session after 1 hour
  setTimeout(() => sessions.delete(sessionId), 60 * 60 * 1000);
}
```

### POST /message

```ts
app.post('/message', (req, res) => {
  const { sessionId, prompt } = req.body;

  sessions.set(sessionId, {
    seq: 0,
    events: [],
    status: 'running',
    emitter: new EventEmitter(),
  });

  runClaude(sessionId, prompt); // fire and forget
  res.json({ ok: true });
});
```

### SSE Handler

```ts
app.get('/events', (req, res) => {
  const { sessionId } = req.query as { sessionId: string };
  const lastSeq = parseInt(req.headers['last-event-id'] as string) || 0;
  const session = sessions.get(sessionId);

  if (!session) {
    res.status(404).end();
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  // 1. Replay missed events
  for (const event of session.events.filter(e => e.seq > lastSeq)) {
    res.write(
      `id: ${event.seq}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
    );
  }

  // 2. If already done, close immediately
  if (session.status === 'done') {
    res.end();
    return;
  }

  // 3. Subscribe to live events
  const handler = (event: StoredEvent) => {
    res.write(
      `id: ${event.seq}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
    );
    if (event.type === 'done') res.end();
  };

  session.emitter.on('event', handler);
  req.on('close', () => session.emitter.off('event', handler));
});
```

### Why There Is No Race Condition Here

In the Redis variant, subscribe-before-replay order is critical because the
worker and the SSE handler run in separate processes with async network hops
between them.

In the in-memory variant, Node.js is single-threaded. The `for` loop that
replays buffered events runs synchronously to completion. Only after it returns
does the event loop pick up the next tick, which is when any new `emitter.emit`
calls could fire. By the time the emitter can deliver a new event, `emitter.on`
is already registered. There is no window for a missed event.

### Concurrency Control (Optional)

If you want to limit to one active Claude session at a time, use `p-queue`:

```ts
import PQueue from 'p-queue';

const queue = new PQueue({ concurrency: 1 });

app.post('/message', (req, res) => {
  const { sessionId, prompt } = req.body;

  sessions.set(sessionId, {
    seq: 0,
    events: [],
    status: 'running',
    emitter: new EventEmitter(),
  });

  queue.add(() => runClaude(sessionId, prompt)); // queued, not fire-and-forget
  res.json({ ok: true });
});
```

### What You Lose vs. Redis

| Capability                        | In-Memory | Redis |
|-----------------------------------|-----------|-------|
| Survives process restart          | No        | Yes   |
| Horizontal scaling (multi-pod)    | No        | Yes   |
| Memory automatically bounded      | Manual TTL | Key TTL built-in |
| Operational complexity            | Zero      | Needs Redis running |
| Job queue features (retry, delay) | No (use p-queue for basic control) | Yes (Bull/BullMQ) |

For single-user self-hosted, the only meaningful gap is **process restart
durability** — if the server crashes mid-stream, buffered events are lost and
the user must re-send their prompt. This is an acceptable trade-off for the
zero-infrastructure overhead.

---

## Choosing Between the Two

| Scenario | Recommendation |
|---|---|
| Single user, self-hosted | In-memory (Variant B) |
| Multi-user SaaS | Redis (Variant A) |
| Need job persistence across restarts | Redis (Variant A) |
| Already have Redis in stack | Redis (Variant A) |
| Want zero infrastructure | In-memory (Variant B) |
| Need horizontal scaling | Redis (Variant A) |
