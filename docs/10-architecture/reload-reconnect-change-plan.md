# Reconnect-First Hub Lifecycle — Implementation Change Plan

**ADR:** `docs/10-architecture/adr-reload-reconnect.md`  
**Decision:** DEC-024

This document lists every file that needs implementation changes, in dependency order.
Stubs are already in place — this plan guides the implementer.

---

## Phase 1: Types & Constants (no dependencies)

### 1. `packages/bridge-types/src/constants.ts`
**Status:** ✅ DONE (stubs committed)
- Added `DISCONNECT_GRACE_WINDOW_MS = 10_000`
- Added `KILL_SIGKILL_TIMEOUT_MS = 2_000`
- Added `DisconnectResponse` interface

### 2. `packages/bridge-types/src/index.ts`
**Status:** ✅ DONE (stubs committed)
- Added barrel exports for new constants and type

---

## Phase 2: Hub-side — DisconnectHandler + Route (depends on Phase 1)

### 3. `packages/hub/src/disconnect-handler.ts` — NEW FILE
**Status:** ✅ STUB created
**Implementation needed:**
- `constructor()`: store config, initialise timer state to inactive
- `startGraceTimer()`: if already running, clear existing `setTimeout` and restart. Create `setTimeout(graceWindowMs)` that calls `config.onGraceExpired()`. Record `graceStartedAt = Date.now()`
- `cancelGraceTimer()`: clear the timeout. Reset state to inactive. Log the cancellation
- `getState()`: return `{ graceTimerActive, graceStartedAt, graceRemainingMs }`
- `dispose()`: clear timeout if running

### 4. `packages/hub/src/server-routing.ts`
**Status:** ✅ DONE (stubs committed)
- Added `handleDisconnect` to `RouterDeps` interface
- Added `/bridge/disconnect` route with bridge secret auth

### 5. `packages/hub/src/server.ts`
**Status:** ✅ STUB wired (returns 501)
**Implementation needed:**
- Import `DisconnectHandler` and `DISCONNECT_GRACE_WINDOW_MS`
- Create `DisconnectHandler` instance in constructor with `onGraceExpired: () => process.exit(0)`
- Wire `handleDisconnect` to parse request, call `disconnectHandler.startGraceTimer()`, respond with `DisconnectResponse`
- Call `disconnectHandler.dispose()` in `stop()`

### 6. `packages/hub/src/bridge-connection.ts`
**Implementation needed:**
- When a new WS connection is established (`handleConnect`), emit a new event or call a callback that the server uses to cancel the disconnect grace timer
- Option A: Add `onBridgeReconnect?: () => void` to the connection options
- Option B: Have `server.ts` call `disconnectHandler.cancelGraceTimer()` from the `bridgeServer.onConnect()` callback (if such callback exists or is added)
- **Preferred:** Option A — add an optional `onBridgeReconnect` callback to `BridgeConnectionOptions`, called in `handleConnect()`. The server wires it to `disconnectHandler.cancelGraceTimer()`

---

## Phase 3: Bridge-side — Soft Disconnect (depends on Phase 1)

### 7. `packages/bridge/src/hub-health.ts`
**Status:** ✅ STUB created (`sendDisconnect()`)
**Implementation needed:**
- `sendDisconnect(bridgeSecret)`: send `POST /bridge/disconnect` to `127.0.0.1:{port}` with `x-accordo-secret` header. Return `true` on 200, `false` on error/timeout. Timeout: 2 seconds

### 8. `packages/bridge/src/hub-manager.ts`
**Status:** ✅ STUBS created (`softDisconnect()`, `probeExistingHub()`)
**Implementation needed:**

**`softDisconnect()`:**
1. Call `this.hubHealth.sendDisconnect(this.processState.secret ?? "")`
2. Log result to outputChannel
3. Return the boolean result
4. Do NOT set `this.deactivated = true` (the Hub is still alive)
5. Do NOT kill the process

**`probeExistingHub()`:**
1. Read PID from `this.config.pidFilePath` via `this.readPidFile()`
2. Check if alive via `this.isProcessAlive(pid)`
3. If not alive, return `{ alive: false, port: 0 }`
4. Apply port file via `this._applyPortFile()`
5. Call `this.checkHealth()` — if responds, return `{ alive: true, port: this.port }`
6. Otherwise return `{ alive: false, port: 0 }`

**`activate()` modification:**
1. After reading secrets from SecretStorage (existing code)
2. Before the spawn block, call `this.probeExistingHub()`
3. If probe returns `alive: true`:
   a. Set `this.port = probe.port`, `this.healthState.port = probe.port`
   b. Emit `this.events.onHubReady(probe.port, this.processState.token!)`
   c. Return early — skip spawn
4. If probe returns `alive: false`, fall through to existing spawn logic

### 9. `packages/bridge/src/hub-process.ts`
**Status:** ✅ STUB updated (signature + comment, no SIGKILL logic yet)
**Implementation needed:**
- In `killHub()`, after `proc.kill()`:
  1. Start `const sigkillTimer = setTimeout(() => { try { proc.kill("SIGKILL"); } catch {} }, timeoutMs)`
  2. In the `proc.once("exit")` handler, call `clearTimeout(sigkillTimer)` before resolving

---

## Phase 4: Composition Wiring (depends on Phases 2 + 3)

### 10. `packages/bridge/src/extension-composition.ts`
**Implementation needed:**
- In `cleanupExtension()`: add `await services.hubManager.softDisconnect()` **before** the WsClient disconnect
- In `buildHubManagerEvents()` → `onHubReady` callback: check if this is a reconnect (Hub was already alive, no new spawn). If reconnect, **skip** `writeAgentConfigs()` and `syncMcpSettings()` — only create WsClient and connect

### 11. `packages/bridge/src/extension.ts`
**No changes needed.** The `deactivate()` function already calls `cleanupExtension()`, which will now include `softDisconnect()`.

---

## Phase 5: Test File Updates (depends on all above)

### 12. `packages/hub/src/__tests__/server-routing.test.ts`
**Status:** ✅ DONE (mock added for `handleDisconnect`)
**Implementation needed:** Add tests for `/bridge/disconnect` route (auth, delegation, 401 on bad secret)

### 13. `packages/hub/src/__tests__/disconnect-handler.test.ts` — NEW FILE
**Tests needed:** See test scenarios document

### 14. `packages/bridge/src/__tests__/hub-manager.test.ts`
**Tests needed:** `softDisconnect()`, `probeExistingHub()`, modified `activate()` with reconnect

### 15. `packages/bridge/src/__tests__/hub-process.test.ts`
**Tests needed:** SIGKILL fallback timer in `killHub()`

### 16. `packages/bridge/src/__tests__/hub-health.test.ts`
**Tests needed:** `sendDisconnect()` HTTP request

---

## Dependency Graph (implementation order)

```
Phase 1:  bridge-types/constants.ts  ──→  bridge-types/index.ts
                    │
          ┌────────┴────────┐
Phase 2:  │                 │
     disconnect-handler.ts  │
          │                 │
     server-routing.ts ─────┤
          │                 │
     server.ts              │
          │                 │
     bridge-connection.ts   │
                            │
Phase 3:              hub-health.ts
                            │
                     hub-manager.ts
                            │
                     hub-process.ts
                            │
Phase 4:        extension-composition.ts
```
