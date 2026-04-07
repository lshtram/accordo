# Review — reload-reconnect — Phase A

**Date:** 2026-04-05  
**Reviewer:** Reviewer Agent  
**Module:** Reconnect-First Hub Lifecycle (`packages/bridge`, `packages/hub`, `packages/bridge-types`)  
**ADR:** `docs/10-architecture/adr-reload-reconnect.md`  
**Decision:** DEC-024

---

## Verdict: PASS with non-blocking issues

The overall design is sound. The three-problem decomposition is accurate, the chosen architecture is well-reasoned, and the stubs are coherent. No blocking issues were found.

**Blocking issues: 0**  
**Non-blocking issues: 8**

---

## 1. Architecture Soundness

### ✅ Problem 1 (orphan processes) — SOLVED
`cleanupExtension()` will call `softDisconnect()` before WsClient disconnect. The Hub receives `POST /bridge/disconnect` and starts a 10-second self-termination countdown. This correctly replaces the current "do nothing" deactivation. The existing M31 grace timer in `BridgeConnection` (which clears state, not process) is a different mechanism — the design correctly keeps both and doesn't conflate them.

### ✅ Problem 2 (reload disruption) — SOLVED
The reconnect-first `activate()` probe path is well-structured: read PID → check alive → read port → probe `/health` → if 200, emit `onHubReady` and skip spawn. Token/secret preservation is explicitly documented in the ADR (§D2) and in DEC-024: SecretStorage survives reloads, no rotation on reconnect.

### ✅ Problem 3 (SIGKILL fallback) — SOLVED
`killHub()` design is correct: SIGTERM + timeout + SIGKILL + clearTimeout on exit.

### ✅ opencode.json protection
The plan (`change-plan.md` §10) specifies that `buildHubManagerEvents()` in `extension-composition.ts` must skip `writeAgentConfigs()` and `syncMcpSettings()` on reconnect. The hook point (the `onHubReady` callback) is confirmed in the existing code (lines 132–141 in `extension-composition.ts`). A flag for "is this a reconnect?" must be threaded down from `probeExistingHub()` to the `onHubReady` call — see Issue 1.

---

## 2. Interface Completeness

### ✅ `bridge-types/constants.ts`
- `DISCONNECT_GRACE_WINDOW_MS = 10_000` — correct
- `KILL_SIGKILL_TIMEOUT_MS = 2_000` — correct
- `DisconnectResponse { ok: true; graceWindowMs: number }` — shape is appropriate and importable
- Barrel exports in `index.ts` are complete

### ✅ `disconnect-handler.ts`
- `DisconnectHandlerConfig` — all fields present: `graceWindowMs`, `onGraceExpired`, `log`
- `DisconnectHandlerState` — `graceTimerActive`, `graceStartedAt`, `graceRemainingMs` — correct
- Public API: `startGraceTimer()`, `cancelGraceTimer()`, `getState()`, `dispose()` — all required operations covered

### ✅ `server-routing.ts`
- `/bridge/disconnect` route delegates to `handleDisconnect` behind `validateBridgeSecret()` — correct pattern, mirrors `/bridge/reauth`
- Auth middleware applied before delegate — correct per AGENTS.md §4 rule 2

### ✅ `hub-health.ts`
- `sendDisconnect(bridgeSecret: string): Promise<boolean>` — signature is appropriate and consistent with `attemptReauth` pattern

### ✅ `hub-manager.ts` stubs
- `softDisconnect(): Promise<boolean>` — correct return type
- `probeExistingHub(): Promise<{ alive: boolean; port: number }>` — correct shape

### ⚠️ Issue 1 — Non-blocking: Reconnect flag not threaded to `onHubReady` (interface gap)

**File:** `packages/bridge/src/hub-manager.ts`, `packages/bridge/src/extension-composition.ts`

The `onHubReady(port, token)` signature is a two-argument callback. The `buildHubManagerEvents()` handler currently always calls `writeAgentConfigs()` unconditionally (line 133 in `extension-composition.ts`). To skip config-writing on reconnect, the caller must know whether this is a reconnect.

The change-plan (§10) says "check if this is a reconnect" but doesn't specify the mechanism. Two options exist:

- **Option A (preferred):** Add an optional third parameter to `onHubReady`: `onHubReady(port: number, token: string, isReconnect?: boolean): void`. The reconnect path in `activate()` passes `true`; the spawn path omits it (defaults to `false`).
- **Option B:** Add a separate `onHubReconnected(port, token)` event. More explicit but requires a new entry in `HubManagerEvents`.

**Neither is blocked, but the mechanism must be agreed before Phase B** or the test for `AR-05` and `AR-06` will have nothing to assert against in `extension-composition.ts`.

**Recommendation:** Decide between Option A and Option B and note it in `HubManagerEvents` before implementation starts.

### ⚠️ Issue 2 — Non-blocking: `probeExistingHub()` port fallback not specified

**File:** `packages/bridge/src/hub-manager.ts` (lines 243–245)  
**File:** `docs/10-architecture/reload-reconnect-change-plan.md` (§8, step 4)

The plan says "Apply port file via `this._applyPortFile()`". But `_applyPortFile()` updates `this.port` only if `this.config.portFilePath` is set. If `portFilePath` is not configured (e.g. in tests or minimal configs), `probeExistingHub()` would silently use `this.port` (the config default), which may be wrong.

The plan should explicitly state: "If `portFilePath` is not set, use `this.port` as the candidate port" so the implementer doesn't leave a silent no-op path. This is also relevant for test scenario `PE-05` ("Port file has different port than config default") to be meaningful.

---

## 3. Test Coverage

The 40 test scenarios are well-structured. The following analysis identifies the complete coverage and three gaps.

### ✅ Covered paths
- All `DisconnectHandler` state transitions (DH-01–DH-08) — complete
- `/bridge/disconnect` route auth (SR-01–SR-05) — complete
- `sendDisconnect()` error modes (HH-01–HH-05) — complete
- `softDisconnect()` (SD-01–SD-04) — complete
- `probeExistingHub()` (PE-01–PE-05) — complete
- `activate()` reconnect-first (AR-01–AR-07) — complete
- `killHub()` SIGKILL (KH-01–KH-04) — complete
- `cleanupExtension()` ordering (CE-01–CE-03) — complete
- E2E scenarios (E2E-01–E2E-04) — adequate for integration

### ⚠️ Issue 3 — Non-blocking: Missing test for `activate()` when SecretStorage is empty on first launch

**File:** `docs/10-architecture/reload-reconnect-test-scenarios.md` (Design Risk §1)

The test scenarios document correctly identifies this risk in prose ("Design Risks to Test §1") but there is no corresponding test ID in the `AR-*` group. Scenario `AR-02` ("dead hub → fallback to spawn") is not the same as "no credentials yet, probe must be skipped entirely". A first-launch test case should be added:

> `AR-08` | First launch (SecretStorage empty) → no probe, proceed to spawn | `probeExistingHub` NOT called; spawn proceeds normally

### ⚠️ Issue 4 — Non-blocking: `softDisconnect()` log output not tested

**File:** `docs/10-architecture/reload-reconnect-test-scenarios.md` (§4)

`SD-01` and `SD-02` verify the return value. The change-plan (§8: `softDisconnect()` step 2) states "Log result to outputChannel". There is no scenario checking that the log message is emitted. Low importance but easy to add.

### ⚠️ Issue 5 — Non-blocking: `bridge-connection.ts` reconnect timer-cancel scenario not in unit tests

**File:** `docs/10-architecture/reload-reconnect-test-scenarios.md` (§9, E2E-03)

The disconnect-handler grace timer cancel on WS reconnect (ADR §D1, step 2) is tested only at E2E level (`E2E-03`). The `BridgeConnection.handleConnect()` already cancels the M31 state-grace timer. The new disconnect-handler timer cancel (via `onBridgeReconnect` callback, change-plan §6) is a separate path that needs a unit test in `bridge-connection.test.ts` or `disconnect-handler.test.ts`. The E2E test alone is insufficient for TDD.

**Recommended addition:**
> `E2E-03b` | New WS connection during active disconnect-handler grace timer → `cancelGraceTimer()` called | (in `disconnect-handler.test.ts`: inject `cancelGraceTimer` as the reconnect callback and verify it fires when `handleConnect` is called)

---

## 4. Security

### ✅ `/bridge/disconnect` authentication
The route uses `validateBridgeSecret()` via `validateOrigin()` + `validateBridgeSecret()` chain — the same pattern as `/bridge/reauth`. The bridge secret is a stable UUID generated at first launch and stored in VS Code `SecretStorage` (OS keychain-backed). This is appropriate for a loopback-only endpoint.

### ⚠️ Issue 6 — Non-blocking: `validateBridgeSecret()` is not timing-safe

**File:** `packages/hub/src/security.ts` (line 68)

`validateBearer()` (line 51) uses `timingSafeEqual` — correct. `validateBridgeSecret()` (line 68) uses plain `===` string comparison — not timing-safe. This is a pre-existing issue that existed before this ADR, but this ADR adds a new endpoint relying on `validateBridgeSecret()`, making the exposure slightly wider.

The risk is low on loopback-only (attacker needs local process access, at which point timing attacks are moot), but it is inconsistent and violates the same-pattern principle. This should be fixed as a housekeeping item, not as a blocker.

**Fix:** Replace `return val === secret` with `timingSafeEqual(Buffer.from(val), Buffer.from(secret))` after a length check.

### ✅ Grace timer DoS risk — acceptable
The grace timer can be restarted by calling `POST /bridge/disconnect` repeatedly (scenario `DH-03`). Since the endpoint requires a valid bridge secret, only the legitimate Bridge (or a process that already has the secret) can restart it. Loopback-only binding prevents external access. Acceptable.

### ✅ Two-window secret-mismatch protection
ADR §Consequences correctly documents: "bridge secret will differ, WS auth fails → falls through to spawn". This is an existing WS auth mechanism — no new attack surface.

---

## 5. Token / Config Preservation

### ✅ SecretStorage stability
ADR §D2 explicitly states: "Tokens are preserved in `SecretStorage` across VS Code reloads — they are stable UUIDs generated once and reused. No rotation on reconnect." DEC-024 confirms this. The `activate()` implementation reads secrets from `SecretStorage` first — if present, they are reused, which is the correct path.

### ✅ `opencode.json` protection gated on reconnect flag
The plan (§10) correctly specifies that `writeAgentConfigs()` and `syncMcpSettings()` must be skipped on reconnect. The implementation hook is in `buildHubManagerEvents()`. **This is contingent on Issue 1 being resolved** (reconnect flag mechanism). Without that, config rewriting on reconnect is not preventable.

---

## 6. Race Conditions

### ✅ Grace timer cancel on WS reconnect — design is correct
`DisconnectHandler.cancelGraceTimer()` is called when a new WS connection is established. The change-plan (§6) specifies Option A: `onBridgeReconnect` callback in `BridgeConnectionOptions`, wired by `server.ts` to `disconnectHandler.cancelGraceTimer()`. The existing `handleConnect()` in `BridgeConnection` already cancels the M31 state-grace timer on line 211–214 — the new callback follows the same pattern.

### ⚠️ Issue 7 — Non-blocking: Disconnect-handler timer and WS-state grace timer are independent; double-timer risk

**File:** `packages/hub/src/bridge-connection.ts` (M31 grace, lines 187–196)  
**File:** `packages/hub/src/disconnect-handler.ts` (new grace timer)

After `POST /bridge/disconnect`, two timers may be simultaneously active:
1. `DisconnectHandler` grace timer (10s) — starts on POST
2. `BridgeConnection` M31 grace timer (15s by default) — starts on WS disconnect

If the Bridge disconnects its WS _after_ sending `POST /bridge/disconnect`, both timers start. The first to expire (DisconnectHandler, 10s) fires `process.exit(0)`, which terminates the process before the M31 timer can do anything. This is _correct behaviour_ and harmless.

However, if the Bridge sends `POST /bridge/disconnect` but the WS never disconnects (e.g. the extension host crashes after sending HTTP but before closing WS), only the DisconnectHandler timer runs. This is also fine — `process.exit(0)` terminates everything.

The interaction is not a bug, but it should be documented in `disconnect-handler.ts` with a comment explaining the two-timer coexistence, to prevent future maintainers from "fixing" the apparent redundancy.

### ✅ Concurrent reload race (`E2E-04`) — addressed
The second reload hitting `POST /bridge/disconnect` while a grace timer is already running triggers `startGraceTimer()` restart (DH-03). The timer resets to full 10s. The Hub waits again — the Bridge reconnects and cancels. This is correct.

### ✅ `deactivated` flag interaction
`softDisconnect()` is documented as NOT setting `this.deactivated = true`. The existing `_onProcessExit()` guard (`if (this.deactivated) return`) would suppress restart attempts on exit. If the Hub self-terminates after the grace window, `_onProcessExit()` fires. Since `deactivated` is false, it would trigger a restart attempt. **This is actually correct behaviour** for the "VS Code window still open but Hub died" case. The design is intentional and consistent.

---

## 7. Consistency

### ✅ Constant placement
`DISCONNECT_GRACE_WINDOW_MS` and `KILL_SIGKILL_TIMEOUT_MS` are placed in `bridge-types/constants.ts` — consistent with all other protocol constants (`HEARTBEAT_INTERVAL_MS`, `HEARTBEAT_TIMEOUT_MS`, etc.). Correct placement.

### ✅ `DisconnectResponse` shape
`{ ok: true; graceWindowMs: number }` is symmetric with `HealthResponse { ok: true; uptime: number; ... }`. Consistent with existing response shapes.

### ✅ File naming
`disconnect-handler.ts` follows the `kebab-case` convention.

### ⚠️ Issue 8 — Non-blocking: `sendDisconnect()` missing timeout constant

**File:** `packages/bridge/src/hub-health.ts` (line 153)  
**File:** `packages/bridge/src/hub-manager.ts` change-plan §7

The change-plan specifies `sendDisconnect()` should use a **2-second timeout** to avoid blocking `cleanupExtension()`. This timeout value (2000ms) is hardcoded in the plan text but not extracted to a named constant. `KILL_SIGKILL_TIMEOUT_MS = 2_000` already exists for the SIGKILL case — the disconnect request timeout coincidentally has the same value.

Two options:
- Reuse `KILL_SIGKILL_TIMEOUT_MS` (confusing semantically — different purpose)
- Add `DISCONNECT_REQUEST_TIMEOUT_MS = 2_000` to `constants.ts`

**Recommendation:** Add `DISCONNECT_REQUEST_TIMEOUT_MS = 2_000` with a clear comment. The semantic clarity is worth one line.

---

## 8. Open Questions (require user decision before implementation)

### OQ-1 — Reconnect flag mechanism (see Issue 1)

**Must decide:** Does `onHubReady` get a third `isReconnect?: boolean` parameter, or is a separate `onHubReconnected` event added to `HubManagerEvents`?

**Recommendation:** Option A (`isReconnect?: boolean` flag on `onHubReady`). It is the minimal change and avoids duplicating the wiring logic in `buildHubManagerEvents()`.

### OQ-2 — Architecture.md update

**File:** `docs/10-architecture/architecture.md`

The architecture document (currently dated 2026-03-03) does not mention the reconnect-first lifecycle, `softDisconnect()`, or the `/bridge/disconnect` endpoint. The ADR correctly exists as a separate document, but `architecture.md` should have a short cross-reference to DEC-024 in its Hub lifecycle section, so the document remains the authoritative starting point for new contributors.

This is not an implementation blocker but should be done before Phase D.

---

## Summary Table

| # | Severity | File | Issue |
|---|----------|------|-------|
| 1 | Non-blocking | `hub-manager.ts`, `extension-composition.ts` | Reconnect flag not threaded to `onHubReady` — mechanism must be decided before Phase B |
| 2 | Non-blocking | `hub-manager.ts` | Port-file fallback path when `portFilePath` unset not explicitly specified |
| 3 | Non-blocking | Test scenarios | Missing `AR-08` for first-launch (empty SecretStorage) case |
| 4 | Non-blocking | Test scenarios | No test for `softDisconnect()` log output |
| 5 | Non-blocking | Test scenarios | Disconnect-handler timer cancel on WS reconnect is E2E-only; needs unit test |
| 6 | Non-blocking | `security.ts:68` | `validateBridgeSecret()` uses plain `===` instead of `timingSafeEqual` |
| 7 | Non-blocking | `bridge-connection.ts` + `disconnect-handler.ts` | Two-timer coexistence should be documented to prevent future confusion |
| 8 | Non-blocking | `constants.ts` + `hub-health.ts` | `sendDisconnect()` 2s timeout should be a named constant, not magic number |

---

## Conclusion

The architecture is **sound and implementable**. All three problems are correctly addressed with appropriate separation of concerns. The stub interfaces are well-typed and consistent with the existing codebase patterns. The 40+ test scenarios provide good coverage for the new behaviour.

**OQ-1 (reconnect flag mechanism) should be resolved before Phase B begins**, as tests `AR-05` and `AR-06` cannot be written without knowing the mechanism. All other issues are housekeeping or documentation improvements that can be addressed during implementation.

**Verdict: PASS — proceed to Phase B (test writing).**
