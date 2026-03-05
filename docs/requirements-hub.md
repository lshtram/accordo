# accordo-hub — Requirements Specification

**Package:** `accordo-hub`  
**Type:** npm package (standalone Node.js process)  
**Version:** 0.1.0  
**Date:** 2026-03-02

---

## 1. Purpose

The Hub is the central, editor-agnostic control plane. It speaks MCP to agents, receives IDE state from the Bridge, routes tool invocations, and generates context-aware system prompts.

---

## 2. Interfaces

### 2.1 MCP Streamable HTTP — `POST /mcp`

**Spec compliance:** MCP 2025-03-26 Streamable HTTP transport.

| Aspect | Requirement |
|---|---|
| Method | `POST` only |
| Content-Type (request) | `application/json` |
| Body (request) | JSON-RPC 2.0 single request or notification |
| Content-Type (response) | `application/json` for synchronous results; `text/event-stream` for streaming |
| Session management | Hub returns `Mcp-Session-Id` header on `initialize` response. Client MUST include it on all subsequent requests. |
| Protocol version | Hub advertises `protocolVersion: "2025-03-26"` in `initialize` result. Client negotiates during `initialize`. |
| Authentication | `Authorization: Bearer <ACCORDO_TOKEN>` required. 401 if missing/invalid. |
| Origin validation | Reject if `Origin` header present and not `http://localhost:*` or `http://127.0.0.1:*`. 403 if rejected. |

**MCP methods required for Phase 1:**

| Method | Direction | Purpose |
|---|---|---|
| `initialize` | Client → Hub | Capability negotiation, protocol version agreement |
| `initialized` | Client → Hub | Client signals it is ready (notification) |
| `tools/list` | Client → Hub | Returns all registered tools with full `inputSchema` |
| `tools/call` | Client → Hub | Invoke a tool. Hub routes to Bridge via WS. |
| `ping` | Client ↔ Hub | Liveness check |

### 2.2 MCP stdio

When launched with `--stdio`:
- Read newline-delimited JSON-RPC from stdin
- Write newline-delimited JSON-RPC to stdout
- No HTTP server started
- Same MCP methods as Streamable HTTP
- No authentication (process-level trust)
- Log to stderr only (never pollute stdout)

### 2.3 System Prompt — `GET /instructions`

| Aspect | Requirement |
|---|---|
| Method | `GET` |
| Authentication | `Authorization: Bearer <ACCORDO_TOKEN>` required |
| Response Content-Type | `text/markdown; charset=utf-8` |
| Response body | Rendered system prompt |
| Cache | `Cache-Control: no-cache` — always returns current state |

**Template structure:**

```
[Fixed prefix: ~300 tokens — identity, behaviour guidelines]
[Dynamic state: activeFile, openEditors, workspace, terminals, modalities]
[Tool summary: visible tools only (grouped tools hidden, one .discover stub per group)]
```

**Progressive tool disclosure:** Tools with a `group` field are excluded from the tool summary. For each group, a single `accordo.<group>.discover` tool is visible. The agent calls it to learn the full schemas of the group’s tools on demand. This keeps the prompt compact as modalities grow.

**Token budget:** Dynamic section MUST NOT exceed 1,500 tokens. If exceeded:
1. Omit null/empty fields from state
2. Omit modality state for modalities where `isOpen !== true`
3. Truncate visible tool list to name-only (no descriptions) beyond top 10

**Comment Threads section (M42):** When `state.modalities["accordo-comments"]` is present and its `openThreadCount` is greater than zero, `renderPrompt` emits a dedicated section **instead of** JSON-stringifying that modality in the generic "Extension state" block:

```
## Open Comment Threads (N)

- [threadId] uri:line — "preview" (intent)
```

- N = `openThreadCount`.
- Entries come from the `summary` array (capped at `COMMENT_MAX_SUMMARY_THREADS` = 10 by `state-contribution`).
- Line number (`:line`) is included only for text-anchored threads (when `line` field is present).
- Intent (`(intent)`) is included only when present on the summary entry.
- When `openThreadCount === 0` the section is omitted entirely.
- The `accordo-comments` key is **excluded** from the generic "Extension state" block whenever this dedicated section is rendered.

### 2.4 Health Check — `GET /health`

| Aspect | Requirement |
|---|---|
| Method | `GET` |
| Authentication | None |
| Response | `{ "ok": true, "uptime": <seconds>, "bridge": "connected"\|"disconnected", "toolCount": <number>, "protocolVersion": <string>, "inflight": <number>, "queued": <number> }` |

### 2.5 WebSocket Server — `/bridge`

| Aspect | Requirement |
|---|---|
| Path | `/bridge` |
| Protocol | `ws://` (localhost only, so no TLS needed) |
| Authentication | `x-accordo-secret` header validated on upgrade. Value from `ACCORDO_BRIDGE_SECRET` env var. |
| Max connections | 1. Reject additional connections with HTTP 409. |
| Wire format | JSON — see message types below |

### 2.6 Credential Rotation — `POST /bridge/reauth`

| Aspect | Requirement |
|---|---|
| Method | `POST` |
| Authentication | `x-accordo-secret: <current-secret>` header. 401 if wrong. |
| Request body | `{ "secret": "<new-secret>", "token": "<new-token>" }`. Both fields required. |
| Response | `200 OK` with empty body on success. |
| Behaviour | Hub atomically updates `ACCORDO_BRIDGE_SECRET` and `ACCORDO_TOKEN` in memory and rewrites `~/.accordo/token`. The WebSocket server immediately begins accepting the new secret. Active CLI agent MCP sessions are **not disrupted**. |
| Use case | Bridge calls this before reconnecting with a new secret, avoiding a Hub kill-and-respawn that would disrupt in-flight CLI agent sessions. |

### 2.7 IDE State Debug Endpoint — `GET /state`

| Aspect | Requirement |
|---|---|
| Method | `GET` |
| Authentication | `Authorization: Bearer <ACCORDO_TOKEN>` required. 401 if missing/invalid. |
| Response Content-Type | `application/json` |
| Cache | `Cache-Control: no-cache` |
| Response body | Current `IDEState` snapshot as pretty-printed JSON. |

**Comment Threads enrichment (M43):** When `state.modalities["accordo-comments"]` contains a `threads` field (array of `CommentThread`), the response body includes an additional top-level `commentThreads` key equal to that array. This exposes un-truncated thread data for tooling without changing the `IDEState` wire schema. When the modality is absent or has no `threads` array, `commentThreads` is omitted from the response.

---

## 3. WebSocket Message Types (Hub ↔ Bridge)

### 3.1 Hub → Bridge

```typescript
// Invoke a tool
interface InvokeMessage {
  type: "invoke";
  id: string;                        // UUID v4
  tool: string;                      // "accordo.editor.open"
  args: Record<string, unknown>;
  timeout: number;                   // milliseconds
}

// Cancel an in-flight invocation
interface CancelMessage {
  type: "cancel";
  id: string;                        // UUID of the InvokeMessage to cancel
}

// Request full state snapshot
interface GetStateMessage {
  type: "getState";
  id: string;
}

// Heartbeat
interface PingMessage {
  type: "ping";
  ts: number;                        // Date.now()
}
```

### 3.2 Bridge → Hub

```typescript
// Tool invocation result
interface ResultMessage {
  type: "result";
  id: string;                        // correlates with InvokeMessage.id
  success: boolean;
  data?: unknown;                    // Tool-specific return value
  error?: string;                    // Human-readable error if success=false
}

// Partial state update
interface StateUpdateMessage {
  type: "stateUpdate";
  patch: Partial<IDEState>;
}

// Full state snapshot (on connect/reconnect/getState response)
interface StateSnapshotMessage {
  type: "stateSnapshot";
  protocolVersion: string;           // "1" for Phase 1. Hub validates on receive.
  state: IDEState;
}

// Tool registry update (full replacement)
interface ToolRegistryMessage {
  type: "toolRegistry";
  tools: ToolRegistration[];         // complete list — replaces previous
}

// Heartbeat response
interface PongMessage {
  type: "pong";
  ts: number;
}

// Acknowledgement that a cancellation was processed
interface CancelledMessage {
  type: "cancelled";
  id: string;                        // correlates with CancelMessage.id
  late: boolean;                     // true if handler completed before cancel arrived
}
```

### 3.3 IDEState Schema

```typescript
interface IDEState {
  activeFile: string | null;
  activeFileLine: number;
  activeFileColumn: number;
  openEditors: string[];             // relative paths
  visibleEditors: string[];          // relative paths
  workspaceFolders: string[];        // absolute paths
  activeTerminal: string | null;     // terminal name
  workspaceName: string | null;      // vscode.workspace.name — display name
  remoteAuthority: string | null;    // vscode.env.remoteName — null=local, else "ssh-remote","wsl","dev-container","codespaces","tunnel"
  modalities: {
    [extensionId: string]: Record<string, unknown>;
  };
}
```

### 3.4 ToolRegistration Schema

```typescript
interface ToolRegistration {
  name: string;                      // "accordo.editor.open"
  description: string;               // one-liner for prompt
  inputSchema: {                     // JSON Schema object
    type: "object";
    properties: Record<string, {
      type: string;
      description: string;
      enum?: string[];
    }>;
    required?: string[];
  };
  dangerLevel: "safe" | "moderate" | "destructive";
  requiresConfirmation: boolean;
  idempotent: boolean;
}
```

---

## 4. Configuration

### 4.1 CLI Arguments

| Flag | Default | Description |
|---|---|---|
| `--port` | `3000` | HTTP server port |
| `--host` | `127.0.0.1` | Bind address. Only `0.0.0.0` or `127.0.0.1` accepted. |
| `--stdio` | (off) | stdio-only mode. No HTTP server. |
| `--log-level` | `info` | `debug`, `info`, `warn`, `error` |

### 4.2 Environment Variables

| Variable | Purpose |
|---|---|
| `ACCORDO_HUB_PORT` | Override for `--port`. CLI flag wins. |
| `ACCORDO_TOKEN` | Bearer token for HTTP auth. Set by Bridge on Hub spawn. Hub writes it to `~/.accordo/token` on startup for out-of-band agent use (e.g. CLI agents not managed by Bridge). Never read from workspace config files. |
| `ACCORDO_BRIDGE_SECRET` | Shared secret for WS auth. Set by Bridge on spawn. Rotates every time Hub is (re)spawned or when `/bridge/reauth` is called. |
| `ACCORDO_LOG_DIR` | Directory for log files. Default: `~/.accordo/logs/` |
| `ACCORDO_AUDIT_FILE` | Audit log path. Default: `~/.accordo/audit.jsonl` |
| `ACCORDO_MAX_CONCURRENT_INVOCATIONS` | Maximum in-flight tool invocations Hub-wide across all agents. Default: `16`. |

**File permissions:** Hub creates `~/.accordo/` with mode `0700` if it does not exist. It writes `~/.accordo/token` and `~/.accordo/hub.pid` with mode `0600`. These files are never world-readable.

---

## 5. Internal Components

### 5.1 Tool Registry (`tool-registry.ts`)

| Method | Signature | Description |
|---|---|---|
| `register` | `(tools: ToolRegistration[]) → void` | Replace entire registry with provided list |
| `get` | `(name: string) → ToolRegistration \| undefined` | Lookup by tool name |
| `list` | `() → ToolRegistration[]` | All registered tools |
| `toMcpTools` | `() → McpTool[]` | Convert to MCP `tools/list` response format. Strips internal fields (`group`, `dangerLevel`, etc.); returns only `name`, `description`, `inputSchema`. |

### 5.2 State Cache (`state-cache.ts`)

| Method | Signature | Description |
|---|---|---|
| `applyPatch` | `(patch: Partial<IDEState>) → void` | Merge patch into current state |
| `setSnapshot` | `(state: IDEState) → void` | Replace entire state |
| `getState` | `() → IDEState` | Return current snapshot |
| `clearModalities` | `() → void` | Clear modality state only (on Bridge disconnect timeout) |

### 5.3 Prompt Engine (`prompt-engine.ts`)

| Method | Signature | Description |
|---|---|---|
| `render` | `(state: IDEState, tools: ToolRegistration[]) → string` | Render system prompt markdown. Only **visible** tools (those without a `group` field) are included in the tool summary section. Grouped tools are excluded — agents discover them via per-group `.discover` stub tools. |
| `estimateTokens` | `(text: string) → number` | Approximate token count (`chars / 4`). Apply a **10% safety margin**: treat the effective budget as 1,350 tokens (not 1,500) to account for tokenizer variance on code-heavy content. |

### 5.4 Bridge Server (`bridge-server.ts`)

| Method | Signature | Description |
|---|---|---|
| `start` | `(server: http.Server) → void` | Attach WS upgrade handler to HTTP server |
| `invoke` | `(tool: string, args: Record<string, unknown>, timeout: number) => Promise<ResultMessage>` | Send invoke, await result, enforce timeout. Respects the concurrent invocation limit — queues if limit is reached. |
| `cancel` | `(id: string) => void` | Send CancelMessage to Bridge. Used by Hub when client disconnects mid-call. |
| `requestState` | `() => Promise<IDEState>` | Send getState, await snapshot |
| `isConnected` | `() => boolean` | Bridge connection status |
| `onRegistryUpdate` | `(cb: (tools: ToolRegistration[]) ⇒ void) → void` | Callback when Bridge sends toolRegistry |
| `onStateUpdate` | `(cb: (patch: Partial<IDEState>) ⇒ void) → void` | Callback when Bridge sends stateUpdate/stateSnapshot |
| `validateProtocolVersion` | `(received: string) → boolean` | Compare received `stateSnapshot.protocolVersion` against this Hub's `ACCORDO_PROTOCOL_VERSION` constant. If mismatch: close WS with code 4002 and message `"Protocol version mismatch: expected <x>, got <y>"`. Never proceed with a mismatched client. |
| `getConcurrencyStats` | `() → { inflight: number; queued: number; limit: number }` | Returns current concurrency state for `/health` and diagnostics. |

### 5.5 MCP Handler (`mcp-handler.ts`)

| Method | Signature | Description |
|---|---|---|
| `handleRequest` | `(jsonrpc: JsonRpcRequest, session: Session) → JsonRpcResponse` | Dispatch JSON-RPC methods to internal handlers |
| `createSession` | `() → Session` | Create new MCP session (on initialize) |
| `getSession` | `(id: string) → Session \| undefined` | Lookup session by Mcp-Session-Id |

### 5.6 Security (`security.ts`)

| Method | Signature | Description |
|---|---|---|
| `validateOrigin` | `(req: http.IncomingMessage) → boolean` | Check Origin header. Return true if absent or localhost. |
| `validateBearer` | `(req: http.IncomingMessage) → boolean` | Check Authorization header against ACCORDO_TOKEN. |
| `validateBridgeSecret` | `(req: http.IncomingMessage) → boolean` | Check x-accordo-secret against ACCORDO_BRIDGE_SECRET. |
| `generateToken` | `() → string` | Generate and persist a new bearer token. |

---

## 6. Error Handling

| Scenario | Behaviour |
|---|---|
| Bridge not connected when tool call arrives | Return MCP error: `{ code: -32603, message: "Bridge not connected" }` |
| Tool not found in registry | Return MCP error: `{ code: -32601, message: "Unknown tool: <name>" }` |
| Tool invocation times out | Return MCP error: `{ code: -32001, message: "Tool invocation timed out" }` |
| Invocation queue full | Return MCP error: `{ code: -32004, message: "Server busy — invocation queue full" }` |
| Invalid JSON-RPC request | Return JSON-RPC error: `{ code: -32600, message: "Invalid request" }` |
| Invalid MCP session | Return HTTP 400 with `{ error: "Invalid or expired session" }` |
| Origin validation failure | Return HTTP 403 |
| Auth failure | Return HTTP 401 |

---

## 7. Audit Log

Every tool invocation is logged to `ACCORDO_AUDIT_FILE` as newline-delimited JSON:

```typescript
interface AuditEntry {
  ts: string;                        // ISO 8601
  tool: string;                      // tool name
  argsHash: string;                  // sha256 of JSON.stringify(args)
  sessionId: string;                 // MCP session
  result: "success" | "error" | "timeout" | "cancelled";
  durationMs: number;
  errorMessage?: string;             // if result is "error"
}
```

**Rotation:** When `audit.jsonl` exceeds **10 MB**, Hub renames it to `audit.1.jsonl` (overwriting any previous rotation) and starts a new `audit.jsonl`. Maximum retained: 2 files (~20 MB total). Rotation is checked on every write; no background timer needed.

---

## 8. PID File

Hub writes its process ID to `~/.accordo/hub.pid` on startup and removes it on graceful shutdown.

| Requirement | Detail |
|---|---|
| Write on start | Immediately after binding the HTTP port, before processing any requests |
| File mode | `0600` (owner read/write only) |
| Directory | `~/.accordo/` — created with mode `0700` if absent |
| Remove on shutdown | On `SIGTERM` or `SIGINT` before process exits |
| Stale PID detection | Bridge reads the PID file on activation and sends a `kill -0 <pid>` check. If the process does not exist, the PID file is stale and Bridge proceeds with a fresh spawn. If the process exists and `/health` returns OK, Bridge reconnects. |

---

## 9. Concurrency

| Requirement | Detail |
|---|---|
| CONC-01 | Hub maintains an in-flight counter (invocations sent to Bridge, awaiting result). |
| CONC-02 | Maximum in-flight invocations: `ACCORDO_MAX_CONCURRENT_INVOCATIONS` (default `16`). |
| CONC-03 | Invocations arriving when the limit is reached are placed in a Hub-wide FIFO queue. Max queue depth: `64`. |
| CONC-04 | If the queue is full, Hub immediately returns MCP error `-32004` (`"Server busy — invocation queue full"`). |
| CONC-05 | When a result (or timeout) returns, the counter decrements and the next queued invocation is dequeued and forwarded in the same tick. |
| CONC-06 | Cancelled invocations that have already been forwarded to Bridge still occupy an in-flight slot until Bridge sends `cancelled` or `result`. |
| CONC-07 | Per-session parallelism is not limited. Multiple agents from a swarm may each have multiple calls in flight simultaneously, subject only to the Hub-wide limit. |

---

## 10. Non-Functional Requirements

| Requirement | Target |
|---|---|
| Startup time (to /health ok) | < 2 seconds |
| Tool call latency (Hub overhead, excluding handler time) | < 10ms P99 |
| State update propagation (Bridge patch → state cache) | < 5ms |
| Prompt render time | < 50ms |
| Memory (idle, no tools registered) | < 50 MB |
| Memory (16 tools, active state) | < 100 MB |
| Node.js version | >= 20 |
| Dependencies | Minimal. No framework (no Express/Fastify). Use `node:http`, `ws`, `node:crypto`. |

---

## 11. Testing Requirements

| Test Type | Coverage |
|---|---|
| Unit: tool-registry CRUD | register, get, list, toMcpTools |
| Unit: state-cache patch merging | partial update, full snapshot, clearModalities |
| Unit: prompt-engine token budget | under budget, at budget, over budget truncation |
| Unit: security validators | origin accept/reject, bearer accept/reject, secret accept/reject |
| Integration: MCP Streamable HTTP | initialize → tools/list → tools/call → result |
| Integration: MCP stdio | same flow over stdin/stdout |
| Integration: WebSocket lifecycle | connect → stateSnapshot → stateUpdate → invoke → result → disconnect → reconnect |
| Integration: heartbeat | ping → pong, missed pong → disconnect detection |
| E2E: Full stack | Hub + Bridge + Editor tools → agent tool call → editor action |
