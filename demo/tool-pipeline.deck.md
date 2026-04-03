---
marp: true
theme: accordo-dark
paginate: true
size: 16:9
---

<!-- _class: lead -->
<!-- _paginate: false -->

# The Tool Call Pipeline
## How an AI request reaches your editor

*Accordo Hub · Security · Dispatch · Retry*

<!-- notes
Every time an AI agent calls a tool — open a file, run a terminal command, highlight code — a lot happens in milliseconds. Let's trace that journey.
-->

---

# The Journey at a Glance

An agent issues one tool call. Five layers handle it.

1. 🔐 **Security** — Origin check + Bearer token
2. 📋 **Session** — which agent is calling?
3. 🔀 **Executor** — look up the tool, decide where to route it
4. 🚦 **Dispatch** — concurrency control, FIFO queue, timeout
5. 🔄 **Retry** — automatic recovery for idempotent tools

<!-- notes
Five layers, each with a single responsibility. The beauty is that the agent sees none of this — it just gets a result back.
-->

---

# 🔐 Layer 1 — Security

Two guards at the front door.

```typescript
// Guard 1: block DNS-rebinding attacks
validateOrigin(req)   // only localhost / 127.0.0.1

// Guard 2: constant-time token check
validateBearer(req, token)  // timingSafeEqual — no timing leaks
```

> If either check fails → **401. Request dies here.**

<!-- notes
Security comes first — before any routing, before any tool lookup. Origin validation blocks browser-based DNS rebinding. Bearer validation uses constant-time comparison so an attacker cannot measure token correctness by response time.
-->

---

# 🔀 Layer 2 — The Routing Decision

Hub-native tool or Bridge tool?

```
           ┌─────────────┐
 tool call →│  Registry   │── isHubTool? ──▶ run locally
           │   lookup    │
           └─────────────┘── Bridge tool? ──▶ WebSocket → VS Code
```

- **Hub tools** — run inside the Hub process (e.g. script runner)
- **Bridge tools** — cross the WebSocket into your editor

<!-- notes
This is where the executor makes its key decision. Hub tools like the script runner execute locally. Everything else — opening files, highlighting code, running terminals — crosses the WebSocket bridge into VS Code.
-->

---

# 🚦 Layer 3 — Concurrency & Dispatch

No thundering herd. Strict FIFO control.

```typescript
if (inflight >= maxConcurrent && queued >= maxQueueDepth)
  throw "Server busy"          // reject immediately

if (inflight >= maxConcurrent)
  queue(invoke)                // wait your turn — FIFO

// slot free → assign UUID, set timeout, send over WebSocket
send({ type: "invoke", id, tool, args, timeout })
```

<!-- notes
The dispatcher is the traffic controller. If all slots are full it queues the call. If the queue is also full it rejects immediately with a clear error. Each dispatched call gets a UUID, a timeout timer, and is fired over the WebSocket to the Bridge extension in VS Code.
-->

---

# 🔄 Layer 4 — Idempotent Retry

One automatic second chance — no agent involvement.

```typescript
if (isInvokeTimeout(err) && tool.idempotent === true) {
  // safe to retry exactly once
  return await bridgeServer.invoke(tool, args, timeout)
}
```

> Idempotent = "calling it twice gives the same result"
> e.g. *open file*, *highlight lines*, *get state*

<!-- notes
If a Bridge-routed call times out and the tool is marked idempotent, the executor retries it once automatically. This handles transient VS Code slowness without the agent needing to know anything went wrong.
-->

---

<!-- _class: lead -->
<!-- _paginate: false -->

# Let's See the Real Code

*Walking each layer live →*

<!-- notes
Now let's jump into the actual source files and see exactly where each of these layers lives.
-->
