# Reconnect-First Hub Lifecycle — Test Scenarios

**ADR:** `docs/10-architecture/adr-reload-reconnect.md`  
**Decision:** DEC-024

---

## 1. DisconnectHandler (Hub-side) — `packages/hub/src/__tests__/disconnect-handler.test.ts`

| ID | Scenario | Expected |
|----|----------|----------|
| DH-01 | `startGraceTimer()` → wait grace period → timer fires | `onGraceExpired` callback invoked after `graceWindowMs` |
| DH-02 | `startGraceTimer()` → `cancelGraceTimer()` before expiry | `onGraceExpired` never called; `getState().graceTimerActive === false` |
| DH-03 | `startGraceTimer()` called twice — second resets timer | First timer cancelled; only one `onGraceExpired` fires, at the second start's deadline |
| DH-04 | `cancelGraceTimer()` when no timer running | No-op, no error thrown |
| DH-05 | `getState()` when timer is inactive | `{ graceTimerActive: false, graceStartedAt: null, graceRemainingMs: null }` |
| DH-06 | `getState()` when timer is active | `graceTimerActive === true`, `graceStartedAt` is recent timestamp, `graceRemainingMs > 0` |
| DH-07 | `dispose()` cancels running timer | `onGraceExpired` never called after dispose |
| DH-08 | Custom `graceWindowMs` value is respected | Timer fires at custom ms, not default |

---

## 2. Server Routing — `/bridge/disconnect` endpoint — `packages/hub/src/__tests__/server-routing.test.ts`

| ID | Scenario | Expected |
|----|----------|----------|
| SR-01 | `POST /bridge/disconnect` with valid bridge secret | `handleDisconnect` delegate called; response 200 |
| SR-02 | `POST /bridge/disconnect` with invalid bridge secret | 401 Unauthorized; `handleDisconnect` NOT called |
| SR-03 | `POST /bridge/disconnect` missing `x-accordo-secret` header | 401 Unauthorized |
| SR-04 | `GET /bridge/disconnect` (wrong method) | 404 Not Found |
| SR-05 | `POST /bridge/disconnect` with valid secret but missing origin | 403 Forbidden (origin validation) |

---

## 3. HubHealth — `sendDisconnect()` — `packages/bridge/src/__tests__/hub-health.test.ts`

| ID | Scenario | Expected |
|----|----------|----------|
| HH-01 | Hub responds 200 to disconnect request | `sendDisconnect()` returns `true` |
| HH-02 | Hub responds non-200 | `sendDisconnect()` returns `false` |
| HH-03 | Hub not reachable (ECONNREFUSED) | `sendDisconnect()` returns `false` (no throw) |
| HH-04 | Request includes `x-accordo-secret` header with provided secret | Header value matches `bridgeSecret` param |
| HH-05 | Request timeout (Hub hangs) | `sendDisconnect()` returns `false` after timeout |

---

## 4. HubManager — `softDisconnect()` — `packages/bridge/src/__tests__/hub-manager.test.ts`

| ID | Scenario | Expected |
|----|----------|----------|
| SD-01 | `softDisconnect()` when Hub is alive | Calls `hubHealth.sendDisconnect()` with current secret; returns `true` |
| SD-02 | `softDisconnect()` when Hub is dead | `sendDisconnect()` fails; returns `false`; no throw |
| SD-03 | `softDisconnect()` does NOT set `deactivated = true` | `deactivated` remains false |
| SD-04 | `softDisconnect()` does NOT call `killHub()` | Hub process remains alive |

---

## 5. HubManager — `probeExistingHub()` — `packages/bridge/src/__tests__/hub-manager.test.ts`

| ID | Scenario | Expected |
|----|----------|----------|
| PE-01 | PID file exists, process alive, health responds 200 | Returns `{ alive: true, port: <actual-port> }` |
| PE-02 | PID file exists but process is dead (ESRCH) | Returns `{ alive: false, port: 0 }` |
| PE-03 | PID file does not exist | Returns `{ alive: false, port: 0 }` |
| PE-04 | PID file exists, process alive, but health fails | Returns `{ alive: false, port: 0 }` |
| PE-05 | Port file has different port than config default | Uses port from file, not default |

---

## 6. HubManager — `activate()` reconnect-first — `packages/bridge/src/__tests__/hub-manager.test.ts`

| ID | Scenario | Expected |
|----|----------|----------|
| AR-01 | Existing Hub alive + healthy → reconnect | `onHubReady` emitted with existing port/token; `spawn` NOT called |
| AR-02 | Existing Hub dead → fallback to spawn | `spawn` called; normal activation path |
| AR-03 | Existing Hub alive but unhealthy → fallback to spawn | `spawn` called (probe fails at health step) |
| AR-04 | Reconnect uses stored token from SecretStorage | Token passed to `onHubReady` matches SecretStorage value |
| AR-05 | Reconnect does NOT rewrite agent configs | `writeAgentConfigs` NOT called on reconnect (verified at composition level) |
| AR-06 | Reconnect does NOT rewrite MCP settings | `syncMcpSettings` NOT called on reconnect |
| AR-07 | `autoStart = false` → no probe, no spawn | Neither `probeExistingHub` nor `spawn` called |

---

## 7. HubProcess — `killHub()` SIGKILL fallback — `packages/bridge/src/__tests__/hub-process.test.ts`

| ID | Scenario | Expected |
|----|----------|----------|
| KH-01 | Process exits within SIGTERM timeout | No SIGKILL sent; `killHub()` resolves |
| KH-02 | Process ignores SIGTERM → SIGKILL after 2s | SIGKILL sent; process exits; `killHub()` resolves |
| KH-03 | Custom `timeoutMs` parameter respected | SIGKILL sent after custom timeout, not default |
| KH-04 | No process running → immediate resolve | No signals sent |

---

## 8. Extension Composition — `cleanupExtension()` — `packages/bridge/src/__tests__/extension-composition.test.ts`

| ID | Scenario | Expected |
|----|----------|----------|
| CE-01 | `cleanupExtension()` calls `softDisconnect()` | `hubManager.softDisconnect()` called before WsClient disconnect |
| CE-02 | `cleanupExtension()` order: softDisconnect → WsClient disconnect → router cancel → dispose | Correct sequencing |
| CE-03 | `softDisconnect()` failure does NOT prevent cleanup | Remaining cleanup proceeds even if soft disconnect throws |

---

## 9. Integration / E2E Scenarios

| ID | Scenario | Expected |
|----|----------|----------|
| E2E-01 | VS Code reload: deactivate → activate | Hub survives; Bridge reconnects within grace window; no new spawn; agents uninterrupted |
| E2E-02 | VS Code close: deactivate → no re-activate | Grace timer expires; Hub self-terminates after 10s |
| E2E-03 | Grace timer cancel on WS reconnect | New WS connection cancels grace timer; Hub stays alive |
| E2E-04 | Concurrent reload: two fast reloads in succession | Second reload also reconnects; no race conditions |

---

## Design Risks to Test

1. **SecretStorage consistency:** If SecretStorage is not populated (first launch), `activate()` must generate new credentials and spawn — not probe
2. **Port file stale data:** Port file from a previous crashed Hub → PID dead → falls through to spawn correctly
3. **Multiple VS Code windows:** Window B probes Window A's Hub → bridge secret mismatch → WS auth fails → Window B spawns its own Hub (existing behavior, should not regress)
