# Shared Browser Relay — Architecture Design (Phase A)

**Status:** DRAFT — Phase A, pending user review  
**Date:** 2026-04-08  
**Scope:** Making the browser relay a shared/global service usable by multiple per-project Hubs simultaneously  
**Companion to:** multi-session-architecture.md (DECISION-MS-07 exception), architecture.md §14, browser-extension-architecture.md  
**Related requirements:** requirements-browser-extension.md §BR-F-120..131 (relay), requirements-browser.md

---

## 1. Executive Summary

### Non-Technical

Today, each VS Code window runs its own browser relay server. The Chrome extension can only connect to one relay at a time. If you have two VS Code windows open (say, one for project A and one for project B), only one of them can talk to Chrome — whichever opened last "steals" the connection from the other.

The **shared browser relay** fixes this. Instead of each VS Code window running its own relay server, a single shared relay server runs on the machine. All VS Code windows register with it as "Hub clients", and the single Chrome extension connects to it once. When an AI agent in project A wants to read a web page, the shared relay routes the request to Chrome and sends the response back to project A's Hub — not project B's.

**What can go wrong:**
- Two agents from different projects try to click different things at the same time → the shared relay uses a write-lock so only one mutating action happens at a time
- The Chrome extension disconnects → all Hubs get a "browser not connected" error until Chrome reconnects
- The shared relay process dies → a new VS Code window restarts it, or an existing window adopts ownership

**How we know it works:** Each Hub still uses the existing `BrowserRelayLike` interface. From a tool's perspective, nothing changes — the shared relay implements the same `request()`, `push()`, `isConnected()` contract. The routing happens transparently below the interface boundary.

### Technical

This document specifies the architecture for converting the browser relay from a per-VS-Code-window singleton to a machine-global shared service.

**Key design decisions:**
1. **One shared relay process**, owned by the first VS Code window that starts. Other windows connect as Hub clients.
2. **Chrome connects once** to the shared relay (single WebSocket, as today). The relay multiplexes across Hub clients.
3. **Hub clients identify via `hubId`** — a UUID generated per VS Code window. All relay requests carry `hubId` for response routing.
4. **Mutating actions** (`navigate`, `click`, `type`, `press_key`) require a write lease — one Hub at a time.
5. **Chrome→VS Code events** (comment mutations via `onRelayRequest`) are routed to the Hub that owns the relevant tab, or broadcast if no owner is known.
6. **Existing `BrowserRelayLike` interface is preserved** — tools are unaware of the shared model.

**What changes:**
- `BrowserRelayServer` becomes `SharedBrowserRelayServer` — accepts multiple Hub client sockets + one Chrome socket
- `RelayBridgeClient` (Chrome extension) is unchanged — it still connects to one endpoint
- A new `SharedRelayClient` implements `BrowserRelayLike` for Hub-side consumers, connecting to the shared relay as a client rather than running its own server
- Port discovery moves from `~/.accordo/relay.port` (last-writer-wins) to `~/.accordo/shared-relay.json` (structured, with PID for liveness checks). This is an explicit exception to DECISION-MS-10 (see §4.4 and multi-session-architecture.md).

**What stays the same:**
- `BrowserRelayLike` interface — unchanged
- Chrome extension code — unchanged  
- All browser tools — unchanged (they consume `BrowserRelayLike`)
- Wire protocol between Chrome ↔ relay — unchanged (`BrowserRelayRequest`/`BrowserRelayResponse`)
- Auth model (token-based) — single shared token for all connections (Chrome and Hub clients alike)

---

## 2. Terminology

| Term | Definition |
|---|---|
| **Shared Relay** | A single WebSocket server process that bridges Chrome and all active VS Code windows. Runs on one well-known port. |
| **Hub Client** | A VS Code window's browser extension connecting to the Shared Relay as a WebSocket client. Identified by `hubId`. |
| **Chrome Client** | The Chrome extension's `RelayBridgeClient` connecting to the Shared Relay. There is exactly one. |
| **hubId** | A UUID identifying a Hub Client. Generated when the VS Code window activates. Included in every relay request for response routing. |
| **Write Lease** | A time-limited, exclusive lock on mutating browser actions. Only one Hub holds the lease at a time. |
| **Owner Window** | The VS Code window whose process hosts the Shared Relay server. If this window closes, ownership transfers. |

---

## 3. Architecture Overview

### 3.1 Current Model (Problem)

```
┌─────────────┐     ┌─────────────┐
│ VS Code #1  │     │ VS Code #2  │
│ relay:40111 │     │ relay:40112 │
└──────┬──────┘     └──────┬──────┘
       │                   │
       │   ┌─────────┐    │
       └───┤ Chrome   ├───┘   ← Can only connect to ONE
           │ Extension│         Last writer of relay.port wins
           └─────────┘
```

- Chrome extension reads `~/.accordo/relay.port` and connects to ONE relay
- Second VS Code window overwrites `relay.port` → Chrome reconnects to window #2
- Window #1 loses all browser tools

### 3.2 Shared Model (Solution)

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│ VS Code #1  │     │ VS Code #2  │     │ VS Code #3  │
│ Hub Client  │     │ Hub Client  │     │ Hub Client  │
│ hubId: aaa  │     │ hubId: bbb  │     │ hubId: ccc  │
└──────┬──────┘     └──────┬──────┘     └──────┬──────┘
       │                   │                   │
       └───────────────────┼───────────────────┘
                           │
                  ┌────────▼────────┐
                  │ Shared Relay    │
                  │ Server          │
                  │ port: 40111     │
                  │ (owned by #1)   │
                  ├─────────────────┤
                  │ Hub Clients: 3  │
                  │ Chrome: 1       │
                  └────────┬────────┘
                           │
                  ┌────────▼────────┐
                  │ Chrome Extension│
                  │ (unchanged)     │
                  └─────────────────┘
```

- One Shared Relay server runs on port 40111
- All VS Code windows connect as Hub Clients via WebSocket
- Chrome extension connects to same port 40111 (unchanged)
- Requests carry `hubId` for response routing
- Shared Relay multiplexes requests to Chrome and routes responses back

---

## 4. Component Design

### 4.1 SharedBrowserRelayServer

**Location:** `packages/browser/src/shared-relay-server.ts`  
**Responsibility:** Accept multiple Hub client WebSocket connections and one Chrome client WebSocket connection. Route requests between them.

**Two listener paths on the same WebSocket server:**
- `/chrome?token=<token>` — Chrome extension connects here (replaces-on-reconnect, as today)
- `/hub?hubId=<hubId>&token=<token>` — Hub clients connect here (multiple simultaneous)

All connections use the same shared token, written to `~/.accordo/shared-relay.json` by the Owner window.

**Request routing (Hub → Chrome):**
1. Hub client sends `SharedRelayRequest` (extends `BrowserRelayRequest` with `hubId`)
2. Server tags the request with `hubId` in its routing table
3. Server forwards the `BrowserRelayRequest` (without `hubId`) to Chrome — Chrome protocol unchanged
4. Chrome responds with `BrowserRelayResponse` containing `requestId`
5. Server looks up `requestId` → `hubId` mapping, forwards response to correct Hub client

**Event routing (Chrome → Hub):**
1. Chrome sends an incoming request (action + payload) via `onRelayRequest` path
2. Server determines target Hub:
   - If payload contains `tabId` and a Hub has claimed that tab → route to that Hub
   - Otherwise → broadcast to all Hub clients (each Hub's `onRelayRequest` decides whether to handle)
3. First Hub to respond wins; response is forwarded back to Chrome

**Connection lifecycle:**
- Hub client disconnect: remove from routing table, release any write lease held by that Hub
- Chrome client disconnect: all pending requests from all Hubs resolve with `browser-not-connected`
- Chrome client reconnect: new Chrome socket replaces old (as today)

### 4.2 SharedRelayClient

**Location:** `packages/browser/src/shared-relay-client.ts`  
**Responsibility:** Implements `BrowserRelayLike` for use inside a VS Code window. Connects to the Shared Relay as a Hub client.

**Key differences from current `BrowserRelayServer`:**
- Is a WebSocket **client**, not a server
- Connects to `ws://127.0.0.1:40111/hub?hubId=<hubId>&token=<token>`
- All outgoing requests include `hubId` in the envelope
- Receives only responses routed to this `hubId`
- Handles Chrome→Hub events via the same message dispatch as today

**Interface compliance:**
- `request(action, payload, timeoutMs)` → sends `SharedRelayRequest`, awaits `BrowserRelayResponse`
- `push(action, payload)` → fire-and-forget send through shared relay
- `isConnected()` → `true` when WebSocket to shared relay is OPEN AND Chrome is reported connected
- `onRelayRequest` → interceptor for Chrome→Hub events (unchanged)
- `onError` → error listener (unchanged)

**Reconnection:** Auto-reconnect on 2s timer (same as Chrome extension's `RelayBridgeClient`).

### 4.3 Write Lease Manager

**Location:** `packages/browser/src/write-lease.ts`  
**Responsibility:** Ensure only one Hub at a time can execute mutating browser actions.

**Mutating actions:**
```typescript
const MUTATING_ACTIONS: readonly BrowserRelayAction[] = [
  "navigate", "click", "type", "press_key",
];
```

**Lease semantics:**
- A Hub requests a write lease implicitly when it sends a mutating action
- The Shared Relay checks: is the lease free? If yes, grant it to this Hub for `LEASE_DURATION_MS` (default: 10_000ms)
- If the lease is held by another Hub, the request is queued (FIFO, max queue depth 8)
- When the action completes (response received from Chrome), the lease auto-extends for `LEASE_EXTENSION_MS` (default: 2_000ms) to allow rapid sequential mutations (e.g., type → press_key Enter)
- When the lease expires or the holding Hub disconnects, the next queued request is processed
- Read-only actions (all page understanding tools) bypass the lease entirely — no blocking

**Why not per-tab leases:** Mutating actions can affect global browser state (e.g., `navigate` on the active tab changes what all other tools see). Per-tab leases would add complexity without meaningful isolation. A simple global write lease is sufficient for the 2-3 concurrent Hub case.

### 4.4 Relay Discovery

**Location:** Handled in `packages/browser/src/extension.ts` (activation logic)

**Discovery file:** `~/.accordo/shared-relay.json`

> **Exception to DECISION-MS-10:** DECISION-MS-10 limits `~/.accordo/` to logs and audit
> files. The shared relay discovery file and its companion lock file are an explicit exception
> because (a) the browser relay is machine-global (not workspace-scoped), so a workspace-local
> file would be wrong, and (b) the files are ephemeral — they are valid only while the owner
> process is alive. Both files are cleaned up on graceful shutdown and validated via PID
> liveness check on read.
>
> **Lifecycle rules:**
> - `shared-relay.json` — created by the Owner window, removed on graceful stop. Stale files
>   (owner PID dead) are overwritten by the next Owner. Permissions: `0600`.
> - `shared-relay.json.lock` — advisory lock held only during discovery-file writes (sub-second).
>   Stale locks (holder PID dead) are removed. Permissions: `0600`.

```json
{
  "port": 40111,
  "pid": 12345,
  "token": "...",
  "startedAt": "2026-04-08T10:00:00.000Z",
  "ownerHubId": "aaa-bbb-ccc"
}
```

The `token` field is the single shared authentication token used by both Chrome and all Hub
clients. The Owner window generates it once at startup.

**Activation flow:**
1. VS Code window activates `accordo-browser`
2. Read `~/.accordo/shared-relay.json`
3. If file exists AND `pid` is alive (via `process.kill(pid, 0)`):
   - Connect as Hub client to `ws://127.0.0.1:40111/hub?hubId=<myHubId>&token=<token>`
   - Create `SharedRelayClient` instead of `BrowserRelayServer`
4. If file missing OR pid is dead:
   - This window becomes the Owner
   - Create `SharedBrowserRelayServer` on port **40111** (canonical, fixed — see DECISION-SBR-05)
   - If port 40111 is unavailable, log an error and fall back to per-window `BrowserRelayServer` (no dynamic port fallback)
   - Write `~/.accordo/shared-relay.json` with this window's details
   - Also connect locally as Hub client (server talks to itself for routing consistency)
5. If connection to shared relay fails (server crashed between file read and connect):
   - Retry once: re-read file, try again
   - If still fails: become Owner (step 4)

**Chrome extension:** Unchanged. It uses the hardcoded default port 40111. Since the shared relay binds to the same canonical port 40111, Chrome connects without changes. There is no dynamic port discovery for the Chrome extension.

### 4.5 Ownership Transfer

When the Owner window closes:
1. `deactivate()` calls `sharedRelay.stop()`
2. All Hub clients receive WebSocket close
3. Each Hub client's reconnect timer fires (2s)
4. The first Hub client to reconnect and find the server dead becomes the new Owner:
   - Reads `~/.accordo/shared-relay.json` → pid is dead
   - Creates `SharedBrowserRelayServer`
   - Writes updated `shared-relay.json`
   - Other Hub clients reconnect to the new server

**Race condition mitigation:**
- File locking: `fs.writeFileSync` with `O_EXCL` flag on a `.lock` companion file
- If lock acquisition fails, wait 500ms and retry as a client
- Lock file is advisory — if the lock file is stale (holder PID is dead), it can be removed

---

## 5. Wire Protocol Changes

### 5.1 Hub Client → Shared Relay

New envelope type extending existing `BrowserRelayRequest`:

```typescript
interface SharedRelayRequest extends BrowserRelayRequest {
  hubId: string;
}
```

The `hubId` field is stripped before forwarding to Chrome. Chrome never sees it.

### 5.2 Shared Relay → Hub Client

Response format unchanged: `BrowserRelayResponse`. The shared relay routes based on the `requestId` → `hubId` mapping established when the request was sent.

### 5.3 Chrome ↔ Shared Relay

**Completely unchanged.** Chrome sends and receives `BrowserRelayRequest`/`BrowserRelayResponse` exactly as today. The shared relay is transparent to Chrome.

### 5.4 Hub Client Registration

On WebSocket connect to `/hub`, the Hub client sends a registration message:

```typescript
interface HubClientRegistration {
  kind: "hub-register";
  hubId: string;
  /** Human-readable label for debugging (e.g., workspace folder name) */
  label?: string;
}
```

The server acknowledges with:

```typescript
interface HubClientRegistrationAck {
  kind: "hub-register-ack";
  hubId: string;
  chromeConnected: boolean;
}
```

### 5.5 Chrome Connection Status Broadcast

When Chrome connects or disconnects, the shared relay broadcasts to all Hub clients:

```typescript
interface ChromeStatusEvent {
  kind: "chrome-status";
  connected: boolean;
}
```

This allows each Hub client's `isConnected()` to return accurate status without polling.

---

## 6. Interface Definitions

### 6.1 SharedBrowserRelayServer (new)

```typescript
interface SharedRelayServerOptions {
  port: number;
  host: string;
  /** Single shared token for all connections (Chrome + Hub clients). */
  token: string;
  onEvent?: (event: string, details?: Record<string, unknown>) => void;
}

// Class: SharedBrowserRelayServer
// Methods:
//   start(): Promise<void>
//   stop(): Promise<void>
//   getConnectedHubs(): ReadonlyMap<string, HubClientInfo>
//   isChromeConnected(): boolean
```

### 6.2 SharedRelayClient (new)

```typescript
interface SharedRelayClientOptions {
  host: string;
  port: number;
  hubId: string;
  token: string;
  onEvent?: (event: string, details?: Record<string, unknown>) => void;
  onRelayRequest?: BrowserRelayLike["onRelayRequest"];
}

// Class: SharedRelayClient implements BrowserRelayLike
// Methods:
//   start(): void
//   stop(): void
//   request(action, payload, timeoutMs?): Promise<BrowserRelayResponse>
//   push(action, payload): void
//   isConnected(): boolean
//   onError?: (error: string) => void
//   onRelayRequest?: BrowserRelayLike["onRelayRequest"]
```

### 6.3 WriteLease (new)

```typescript
interface WriteLeaseOptions {
  leaseDurationMs?: number;      // default: 10_000
  leaseExtensionMs?: number;     // default: 2_000
  maxQueueDepth?: number;        // default: 8
}

interface WriteLeaseManager {
  acquire(hubId: string): Promise<void>;  // resolves when lease is granted
  release(hubId: string): void;
  releaseAll(hubId: string): void;        // release + dequeue all for a hub
  currentHolder(): string | null;
  queueDepth(): number;
}
```

### 6.4 RelayDiscovery (new)

```typescript
interface SharedRelayInfo {
  port: number;
  pid: number;
  token: string;
  startedAt: string;
  ownerHubId: string;
}

// Functions:
//   readSharedRelayInfo(): SharedRelayInfo | null
//   writeSharedRelayInfo(info: SharedRelayInfo): void
//   isRelayAlive(info: SharedRelayInfo): boolean
```

### 6.5 BrowserRelayLike (unchanged)

The existing interface is fully preserved:

```typescript
interface BrowserRelayLike {
  request(action: BrowserRelayAction, payload: Record<string, unknown>, timeoutMs?: number): Promise<BrowserRelayResponse>;
  push(action: BrowserRelayAction, payload: Record<string, unknown>): void;
  isConnected(): boolean;
  getDebuggerUrl?(): string;
  onError?(error: string): void;
  onRelayRequest?: (action: BrowserRelayAction, payload: Record<string, unknown>) => Promise<BrowserRelayResponse>;
}
```

All browser tools continue to consume this interface. They are completely unaware of the shared relay model.

---

## 7. Security Model

### 7.1 Authentication

- **Single shared token model:** The Owner window generates one token at startup and writes it to `~/.accordo/shared-relay.json`. All connections (Chrome and Hub clients) authenticate with the same token via `?token=<token>` on WebSocket connect.
- **Chrome → Shared Relay:** Token-based, same as today. Chrome sends `?token=<token>` on connect.
- **Hub Client → Shared Relay:** Same token. Hub reads the token from `~/.accordo/shared-relay.json` and sends `?token=<token>` on connect.
- **Why a single token:** The shared relay is a loopback-only service (`127.0.0.1`). Separate Chrome vs. Hub tokens would add complexity without meaningful security benefit — any process on localhost that can read the discovery file already has access to the token. A single token simplifies the model and eliminates the contradiction between "per-Hub token set" and "single discovery-file token."

### 7.2 Isolation

- Hub clients cannot see each other's requests or responses (routing is by `hubId`)
- Hub clients cannot impersonate each other (`hubId` is set at connection time and cannot be changed)
- The write lease prevents concurrent mutation from different Hubs

### 7.3 Attack Surface

- Shared relay binds to `127.0.0.1` only — no remote access
- `shared-relay.json` file permissions: `0600` (owner-read/write only)
- Lock file: `0600` permissions, cleaned up on process exit

---

## 8. Failure Modes & Recovery

| Scenario | Behaviour |
|---|---|
| Chrome disconnects | All Hub clients receive `ChromeStatusEvent { connected: false }`. Pending requests resolve with `browser-not-connected`. Chrome auto-reconnects (2s timer, unchanged). |
| Hub client disconnects | Shared relay removes from routing table. Write lease released if held. Other Hubs unaffected. |
| Owner window closes gracefully | Shared relay server stops. All Hub clients receive WS close. First to detect dead PID becomes new Owner (§4.5). |
| Owner window crashes (SIGKILL) | Shared relay server dies. All Hub clients receive WS close (TCP reset). Ownership transfer same as graceful case — PID liveness check detects dead owner. |
| Two windows race to become Owner | File lock (`shared-relay.json.lock`) serialises writes. Loser retries as client. |
| Shared relay port 40111 is occupied by non-Accordo process | Owner cannot start `SharedBrowserRelayServer`. Logs an error. Falls back to per-window `BrowserRelayServer` (current single-client behaviour). Shared relay is unavailable until port 40111 is freed. See DECISION-SBR-05. |

---

## 9. Chrome Extension Changes

**None.** The Chrome extension is unchanged for the shared relay.

The Chrome extension (`packages/browser-extension/src/relay-bridge.ts`) hardcodes:
```typescript
const DEFAULT_RELAY_PORT = 40111;
```

The shared relay binds to the same canonical port 40111 (DECISION-SBR-05). Chrome connects to
`ws://127.0.0.1:40111` exactly as today. No dynamic port discovery, no native messaging, no
file reading. If port 40111 is unavailable, the shared relay does not start and the activating
window falls back to per-window `BrowserRelayServer` (which tries `findFreePort` as today, but
only serves that one window).

---

## 10. Migration Strategy

### 10.1 Backward Compatibility

The `BrowserRelayServer` class is retained for single-window mode. The activation logic in `extension.ts` decides at startup:

1. If `~/.accordo/shared-relay.json` exists and PID is alive → use `SharedRelayClient`
2. If not → start `SharedBrowserRelayServer` (becomes Owner)
3. If shared relay feature is disabled via setting → fall back to current `BrowserRelayServer`

### 10.2 Feature Flag

`accordo.browser.sharedRelay` setting (boolean, default: `true`):
- `true` → use shared relay model
- `false` → use per-window relay (current behaviour)

This allows users to opt out if the shared model causes issues.

---

## 11. Requirement Traceability

| Requirement | Interface Element |
|---|---|
| Multi-window browser access | `SharedBrowserRelayServer` + `SharedRelayClient` |
| Response routing | `hubId` in `SharedRelayRequest`, routing table in server |
| Write safety | `WriteLeaseManager` |
| Chrome protocol unchanged | Wire format `BrowserRelayRequest`/`BrowserRelayResponse` preserved |
| Tool interface unchanged | `BrowserRelayLike` preserved |
| Ownership transfer | Discovery file + PID liveness check + file lock |
| Chrome→Hub event routing | `onRelayRequest` with tab-based or broadcast routing |
| Auth model | Single shared token in discovery file, used by all connections |

---

## 12. Decision Record

### DECISION-SBR-01 — Single shared relay server, not per-Hub relay multiplexing

**Date:** 2026-04-08  
**Context:** Two approaches were considered: (A) a shared relay server that all Hubs connect to, or (B) each Hub runs its own relay server and the Chrome extension multiplexes across them.  
**Decision:** Option A — single shared relay server.  
**Rationale:** Chrome's `RelayBridgeClient` can only maintain one WebSocket connection. Option B would require the Chrome extension to manage multiple connections, fundamentally changing its architecture. Option A keeps Chrome unchanged and centralises routing in one place.

### DECISION-SBR-02 — Global write lease, not per-tab lease

**Date:** 2026-04-08  
**Context:** Mutating actions could be isolated per-tab (each Hub gets exclusive write access to its "own" tabs) or globally (one Hub at a time for all mutations).  
**Decision:** Global write lease.  
**Rationale:** Browser state is inherently shared — navigating one tab can trigger redirects, popups, or side effects that affect other tabs. Per-tab leases would give a false sense of isolation. A global lease is simpler, correct, and sufficient for the expected 2-3 concurrent Hubs. Can be refined to per-tab in a future iteration if needed.

### DECISION-SBR-03 — Owner window hosts the shared relay process

**Date:** 2026-04-08  
**Context:** The shared relay could be (A) hosted inside a VS Code window's extension host, (B) a standalone daemon process, or (C) a systemd/launchd service.  
**Decision:** Option A — first VS Code window becomes the Owner.  
**Rationale:** Avoids introducing a new daemon lifecycle. VS Code extensions already have process management. The ownership transfer mechanism handles the Owner window closing. A standalone daemon can be added later if the ownership transfer proves unreliable.

### DECISION-SBR-04 — Exception to DECISION-MS-07

**Date:** 2026-04-08  
**Context:** DECISION-MS-07 states "Each VSCode window gets an independent Hub. No Hub sharing across windows." The browser relay is an explicit exception.  
**Rationale:** The browser is a machine-global resource (one Chrome instance, one screen). Unlike the Hub (which manages project-specific tools and state), the browser relay must be shared because Chrome can only connect to one endpoint. The browser relay is a transport/routing layer, not a project-scoped service. Hubs remain independent; only the Chrome communication channel is shared.

### DECISION-SBR-05 — Fixed canonical port 40111, no dynamic port fallback

**Date:** 2026-04-08  
**Context:** The Chrome extension hardcodes `DEFAULT_RELAY_PORT = 40111`. Two strategies were considered: (A) fixed port — if 40111 is unavailable, shared relay does not start, or (B) dynamic port — shared relay picks next free port and Chrome discovers it via the discovery file or native messaging.  
**Decision:** Option A — fixed canonical port 40111.  
**Rationale:** Dynamic port requires Chrome extension changes (native messaging or file polling), which contradicts the "Chrome unchanged" design goal. Port 40111 conflicts are rare in practice. If the port is occupied, the activating window falls back to per-window `BrowserRelayServer` (graceful degradation). Dynamic port discovery can be added in a future iteration if needed.  
**Consequence:** If a non-Accordo process holds port 40111, the shared relay is unavailable. Browser tools still work for the first window (via per-window fallback) but not for additional windows.

### DECISION-SBR-06 — Single shared token, not per-client tokens

**Date:** 2026-04-08  
**Context:** Two auth models were considered: (A) separate tokens for Chrome and each Hub client (`chromeToken` + `hubTokens: Set<string>`), or (B) a single shared token for all connections.  
**Decision:** Option B — single shared token.  
**Rationale:** The shared relay binds to `127.0.0.1` only. Any process that can read `~/.accordo/shared-relay.json` (permissions `0600`) already has localhost access. Separate per-client tokens add API complexity (token registration, validation sets) without meaningful security benefit in the loopback-only model. A single token written to the discovery file is simple, coherent, and sufficient.  
**Consequence:** All connections (Chrome + Hub clients) use the same token from `shared-relay.json`. Token rotation requires restarting the shared relay (Owner generates a new token, all clients reconnect with it from the updated file).

### DECISION-SBR-07 — Auth hardening: timing-safe comparison, SecretStorage, unified path

**Date:** 2026-04-10  
**Context:** Auth assessment found gaps in browser relay token handling: `===` comparison (timing side-channel), hardcoded dev token fallback, globalState (unencrypted) storage, inconsistent validation between `BrowserRelayServer` and `SharedBrowserRelayServer`.  
**Decision:** Phase 1 hardening — `isAuthorizedToken()` uses `timingSafeEqual`, both relay servers delegate to it, token stored in VS Code `SecretStorage`, dev token fallback removed, and predictable fallback tokens are disallowed by a fail-closed guardrail. Chrome extension token discovery is deferred to Phase 2 (native messaging).  
**Rationale:** Aligns browser relay security with Hub security (`hub/security.ts` already uses `timingSafeEqual`). Eliminates the lowest-effort attack vectors without requiring Chrome extension changes.  
**Consequence:** Chrome extension cannot connect until deferred Phase 2 native-messaging token discovery is implemented. `resolveRelayToken()` provides migration path from globalState to SecretStorage.  
**Requirements:** `docs/20-requirements/requirements-browser-relay-auth.md` AUTH-01 through AUTH-06.

---

## 13. Files to Create/Modify

### New Files (stubs)

| File | Purpose |
|---|---|
| `packages/browser/src/shared-relay-server.ts` | `SharedBrowserRelayServer` class |
| `packages/browser/src/shared-relay-client.ts` | `SharedRelayClient` class implementing `BrowserRelayLike` |
| `packages/browser/src/write-lease.ts` | `WriteLeaseManager` class |
| `packages/browser/src/relay-discovery.ts` | Discovery file read/write/liveness functions |
| `packages/browser/src/shared-relay-types.ts` | Shared types: `SharedRelayRequest`, `HubClientRegistration`, `ChromeStatusEvent`, etc. |

### Modified Files

| File | Change |
|---|---|
| `packages/browser/src/extension.ts` | Activation logic: detect shared relay, create `SharedRelayClient` or become Owner |
| `packages/browser/src/types.ts` | Export new shared relay types (or re-export from `shared-relay-types.ts`) |
| `docs/10-architecture/multi-session-architecture.md` | Add §6.x noting DECISION-SBR-04 (browser relay exception to MS-07) |
| `docs/10-architecture/architecture.md` | Update §14 with shared relay reference |

### Unchanged Files

| File | Why unchanged |
|---|---|
| `packages/browser-extension/src/relay-bridge.ts` | Chrome extension connects to port 40111 as today |
| `packages/browser-extension/src/service-worker.ts` | Singleton relay bridge lifecycle unchanged |
| All `*-tool.ts` files in `packages/browser/src/` | Tools consume `BrowserRelayLike` — interface unchanged |
| `packages/browser/src/relay-server.ts` | Retained for single-window fallback mode |
