# Review — reload-reconnect — Phase B

**Reviewer:** reviewer agent  
**Date:** 2026-04-05  
**Verdict: FAIL**  
**Blocking issues: 3 | Non-blocking issues: 5**

---

## Summary

Phase B tests for the reconnect-first Hub lifecycle feature were reviewed across six test files in `packages/hub` and `packages/bridge`. All 8 checklist items were evaluated. Tests were run against the current stubs and the actual output was observed.

**Test run results:**

| Package | Command | Result |
|---|---|---|
| `packages/hub` | `pnpm test` | 18 failed, 573 passed |
| `packages/bridge` | `pnpm test` | 22 failed, 400 passed |

---

## Checklist Results

### 1. Coverage completeness

| Scenario Group | Scenarios | Present | Missing |
|---|---|---|---|
| DH — DisconnectHandler | DH-01 to DH-08 | ✓ All 8 | — |
| SR — Server routing disconnect endpoint | SR-01 to SR-05 | ✓ All 5 | — |
| HH — HubHealth.sendDisconnect | HH-01 to HH-05 | ✓ All 5 (quality issue — see blocking #1) | — |
| SD — HubManager.softDisconnect | SD-01 to SD-04 | ✓ All 4 | — |
| PE — HubManager.probeExistingHub | PE-01 to PE-05 | ✓ All 5 | — |
| AR — activate() reconnect-first | AR-01 to AR-07 | ✓ AR-01 to AR-07 | **AR-08 MISSING** |
| KH — killHub SIGKILL fallback | KH-01 to KH-04 | ✓ All 4 | — |
| CE/RCE — cleanupExtension | RCE-01 to RCE-03 | ✓ All 3 | — |
| isReconnect flag | AR-05, AR-06 (extension-composition) | ✓ Both | — |

**Finding:** AR-08 (first-launch / empty SecretStorage path) is completely absent. This was explicitly flagged in Phase A review Issue 3 as a required test case for the design risk: *"If SecretStorage is not populated, activate() must generate new credentials and spawn — not probe."*

---

### 2. Correct failure mode

All tests were verified to be failing at assertion level, not at import or compile errors.

**DH tests (disconnect-handler.test.ts):** All 18 failures occur because the `DisconnectHandler` constructor throws `Error("not implemented")`. This is a cascade failure — every `new DisconnectHandler(config)` call in each test throws before the interesting assertion is reached. This is acceptable TDD stub behavior: once the constructor is implemented, each method-level stub will cause each test to fail at the correct assertion point.

**All other failing tests:** Fail at assertion level. Confirmed for: HH-01, HH-02, HH-04, SD-01–SD-04, PE-01–PE-05, AR-01, AR-04, AR-05, KH-02, KH-03, RCE-01, RCE-02, RCE-03, AR-05 (extension-composition).

---

### 3. Mock correctness

Mocks are consistent with the stub interfaces. `vi.fn()` signatures match the types declared in Phase A (e.g., `HubHealthClient.sendDisconnect: () => Promise<boolean>`, `HubManager.softDisconnect: () => Promise<void>`, `HubManager.probeExistingHub: () => Promise<{ port: number; token: string } | null>`). No mock mismatches found.

---

### 4. Timer tests

Fake timers are used correctly in both files that require them:

- **disconnect-handler.test.ts:** `vi.useFakeTimers()` in `beforeEach`, `vi.useRealTimers()` in `afterEach`, `vi.advanceTimersByTime()` used to trigger the grace period. Tests DH-02, DH-03, and DH-06 correctly advance time to expire the grace timer.
- **hub-process.test.ts (KH-02/KH-03):** `vi.useFakeTimers()` in `beforeEach`, `vi.advanceTimersByTimeAsync(6000)` used to trigger the 5-second SIGKILL timeout. Correct.

---

### 5. The `isReconnect` flag

The isReconnect flag mechanism (Option A from Phase A review OQ-1: 3rd parameter to `onHubReady`) is correctly tested:

- **hub-manager.test.ts AR-05:** Asserts that after a successful probe + reconnect, `onHubReady` is called with `(port, token, true)` as the third argument. Currently RED (fails at assertion because activate() always spawns, never calls onHubReady with `true`). ✓
- **extension-composition.test.ts AR-05:** Asserts that when `events.onHubReady(port, token, true)` is called (reconnect path), `writeAgentConfigs` is NOT called. Currently RED (fails because buildHubManagerEvents does not yet check the 3rd param). ✓
- **extension-composition.test.ts AR-06:** Asserts that when `events.onHubReady(port, token)` is called without the flag (fresh spawn path), `writeAgentConfigs` IS called. Currently PASSES — this is correct GREEN behavior (existing code always calls writeAgentConfigs). ✓

---

### 6. CE-03 (RCE-03) correctness

The scenario from the test scenarios doc labeled "CE-03: softDisconnect throws but cleanup still runs" is implemented as `RCE-03` in `extension-composition.test.ts`. The test:
1. Sets `mockHubManagerInstance.softDisconnect.mockRejectedValue(new Error("disconnect failed"))`
2. Calls `cleanupExtension()`
3. Asserts the returned promise resolves (does not reject)
4. Asserts `mockHubManagerInstance.disconnect`, `cancelAllPendingRequests`, and `hubHealthClient.dispose` were all still called

This is correctly written. The test will remain RED until `cleanupExtension()` is implemented with proper error isolation around `softDisconnect`. ✓

Note: There is a different structural test labeled `CE-03` in the extension-composition file that tests `buildHubManagerEvents.onHubError` shape — this is unrelated to the scenario doc's CE-03 and uses a parallel numbering scheme. The naming overlap is cosmetically confusing but not incorrect.

---

### 7. AR-08 — first-launch / empty SecretStorage

**ABSENT.** The hub-manager test file contains AR-01 through AR-07 and then stops. There is no AR-08 test for the scenario: *"When SecretStorage returns null/undefined (first launch), activate() must call generateHubCredentials(), store to SecretStorage, then spawn — not probe."*

This was Phase A review Issue 3 and is a design-risk scenario. Without this test, the implementation phase has no guard against the empty-SecretStorage edge case.

---

### 8. Test naming

All new tests reference their scenario IDs in the test description strings. Examples: `"AR-01: activate() when running Hub found, connects without spawn"`, `"DH-03: after grace period expires, onGraceExpired is called"`, `"KH-02: when process survives SIGTERM for 5s, SIGKILL is sent"`. Naming is consistent and correct. ✓

---

## FAIL — Blocking Issues (must fix before Phase C)

### BLOCK-1 — HH-03b and HH-05 are false positives

**File:** `packages/bridge/src/__tests__/hub-health.test.ts`

**HH-05 (`sendDisconnect() returns false when Hub hangs`)** — PASSES against the stub.  
The stub's `sendDisconnect()` throws `Error("not implemented")` synchronously. The test calls `sendDisconnect("not-a-real-token")` and the thrown error is caught by `.catch(() => false)` inside the implementation under test. `expect(result).toBe(false)` passes. This means the test will also pass against a broken implementation that throws synchronously for any other reason.

**HH-03 second sub-case (`resolves does not hang when Hub is unreachable`)** — This test may also pass vacuously depending on how the test infrastructure handles the stub's synchronous throw. If the test wraps the call in a `Promise.race` with a timeout, a synchronous throw resolves the race immediately with `false`, making it appear that the "no-hang" assertion passes.

**Required fix:** The tests for `HH-03b` and `HH-05` must be rewritten to fail against the stub. One approach: the stub should hang indefinitely (return a `new Promise(() => {})` that never resolves) rather than throw. Alternatively, the tests should use a real HTTP server that hangs and assert the behavior through observable state (e.g., a specific timeout log, a mock call). The current coincidental-pass means these tests will not guard the implementation.

---

### BLOCK-2 — AR-02 and AR-03 are false positives

**File:** `packages/bridge/src/__tests__/hub-manager.test.ts`  
**Lines:** AR-02 block (~line 958–985), AR-03 block (~line 990–1020)

**AR-02 (`when existing Hub is dead, activate() falls back to spawn`)** — PASSES against the stub.  
The current `activate()` stub always calls `spawnHub()` unconditionally (it has no reconnect-first probing). AR-02 asserts that after a failed probe, spawn is called — but since the stub skips probing entirely and always spawns, this assertion happens to be satisfied. The test cannot detect a regression where the reconnect-first probe is implemented but the fallback path is broken.

**AR-03 (`when probeExistingHub rejects unexpectedly, falls back to spawn`)** — PASSES for the same reason.

**Required fix:** The tests must be structured so they are RED against the current stub. Options:
1. Add a preliminary assertion that `probeExistingHub` WAS called before spawn (proving the probe path was attempted). Since the stub does not call `probeExistingHub`, this preceding assertion will fail.
2. Configure a mock state that distinguishes "probe was attempted and failed" from "probe was never attempted". For example: assert `mockProbeExistingHub.toHaveBeenCalled()` AND `mockSpawnHub.toHaveBeenCalled()`.

---

### BLOCK-3 — AR-08 is missing

**File:** `packages/bridge/src/__tests__/hub-manager.test.ts`

The test for first-launch / empty SecretStorage path is completely absent. This scenario (Phase A Issue 3, Design Risk: SecretStorage consistency) requires:

```
describe("AR-08: activate() when SecretStorage is empty (first launch)", () => {
  it("generates new credentials and spawns without probing", async () => {
    // mockSecretStorage.getHubToken.mockResolvedValue(null)  ← no stored token
    // ... call activate()
    // expect(probeExistingHub).not.toHaveBeenCalled()
    // expect(generateHubCredentials).toHaveBeenCalled()
    // expect(spawnHub).toHaveBeenCalled()
  });
});
```

**Required fix:** Add AR-08 to `hub-manager.test.ts` covering the case where `SecretStorage.getHubToken()` returns `null` or `undefined`. The test must verify that `activate()` skips probing and goes directly to credential generation + spawn.

---

## Non-Blocking Issues (should fix, not required for Phase C start)

### NB-1 — SR-01 to SR-05 are not RED (router already implements /bridge/disconnect)

**File:** `packages/hub/src/__tests__/server-routing.test.ts`

All five SR tests pass against the current stub. The router stub already has the `/bridge/disconnect` endpoint implemented (not just declared). These tests do not drive any new implementation — they validate pre-existing code. This is not harmful but reduces TDD value. The tests are still useful as regression guards.

**Suggested fix:** If the endpoint was intentionally pre-implemented in the stub, document this in a comment. If not, verify that the router stub is correctly limited and these tests are expected RED.

---

### NB-2 — DH test cascade: constructor-level failures obscure individual assertions

**File:** `packages/hub/src/__tests__/disconnect-handler.test.ts`

All 18 DH test failures cascade from the constructor throwing. Tests DH-04 (`cancelGraceTimer() when no timer running does not throw`) and DH-07 second sub-case (`dispose() does not throw when no timer running`) test "should not throw" behavior but currently fail before reaching the assertion because the constructor throws first. Once the constructor is un-stubbed, these will test correctly. This is acceptable behavior for a stub but adds a phase of "fix constructor, watch some tests go green, then fix methods" that can create confusion.

**Suggested fix:** No code change required. Document in the stub or test file that the constructor throw will be the first thing fixed.

---

### NB-3 — AR-06 (hub-manager.test.ts) passes vacuously

**File:** `packages/bridge/src/__tests__/hub-manager.test.ts`  
**Lines:** AR-06 block (~line 1373–1390)

The test comment explicitly acknowledges: *"If onHubReady was not called, the spawn/pollHealth chain is still pending — that's ok for RED."* As a result, the `if (onHubReadyArgs)` guard is never entered, no assertion is made, and the test passes with zero assertions.

A test with zero assertions passing is a vacuous pass. It provides no signal and could mask a real regression.

**Suggested fix:** Either (a) add a `expect.hasAssertions()` call at the top of the test so it fails when no assertions are made, or (b) restructure the test so it has a meaningful assertion against the current stub (e.g., assert that `onHubReady` was NOT called with `true` as the third argument — which will be true, since the stub never calls it with `true`).

---

### NB-4 — KH-01 and KH-04 are GREEN (pre-existing behavior)

**File:** `packages/bridge/src/__tests__/hub-process.test.ts`

KH-01 (`when process exits on SIGTERM, killHub() resolves without SIGKILL`) and KH-04 (`when hub process is null, killHub() resolves immediately`) both pass against the stub because they test paths already present in the existing `killHub()` implementation. They are valid regression guards but provide no TDD signal for the new SIGKILL fallback behavior. This is acceptable since KH-02 and KH-03 (the new behaviors) are correctly RED.

**Suggested fix:** None required. Document with a comment that KH-01 and KH-04 guard pre-existing behavior.

---

### NB-5 — AR-06 assertion in extension-composition uses weak negation

**File:** `packages/bridge/src/__tests__/extension-composition.test.ts`

The assertion `expect(call[2]).not.toBe(true)` (checking that the `isReconnect` flag is not `true` on fresh spawn) accepts `undefined`, `false`, `0`, `""`, or any other falsy/non-true value as passing. A stronger assertion would be `expect(call[2]).toBeFalsy()` or `expect(call[2]).toBeUndefined()` depending on the intended contract.

**Suggested fix:** Change `not.toBe(true)` to `toBeUndefined()` if the fresh-spawn path passes no third argument, or `toBe(false)` if it explicitly passes `false`.

---

## Required Actions for Phase C Approval

The test-builder must fix the three blocking issues before Phase C (implementation) begins:

1. **BLOCK-1:** Rewrite `HH-03b` and `HH-05` so they fail against the stub. The `sendDisconnect` stub must be changed to hang (not throw), or the test assertions must verify observable state that cannot be satisfied by a synchronous throw.

2. **BLOCK-2:** Add `expect(mockProbeExistingHub).toHaveBeenCalled()` as a preceding assertion in AR-02 and AR-03. This will make both tests RED since the current stub never calls `probeExistingHub`.

3. **BLOCK-3:** Add AR-08 test to `hub-manager.test.ts` covering the empty-SecretStorage first-launch path.

After fixes are applied, re-run `pnpm test` in `packages/bridge` and confirm all three previously-passing tests are now RED, and the new AR-08 test is also RED.

---

## Re-Review — 2026-04-05 (after BLOCK-1, BLOCK-2, BLOCK-3 fixes)

**Verdict: PASS**  
**Blocking issues remaining: 0**

### Test run result

`packages/bridge` — `pnpm test`: **27 failed, 396 passed** (423 total)  
_(Increase from 22 → 27 failures is correct: AR-08 added = +1, HH-03b fixed = +1, HH-05 fixed = +1, AR-02 fixed = +1, AR-03 fixed = +1.)_

### BLOCK-1 — HH-03b and HH-05: RESOLVED ✓

Both tests are now correctly RED.

**HH-03b** (`sendDisconnect() calls fetch when Hub is unreachable`):  
The test now stubs `globalThis.fetch` with a mock that rejects with `ECONNREFUSED`, then asserts `expect(mockFetch).toHaveBeenCalled()`. The stub's `sendDisconnect()` throws `"not implemented"` before ever calling `fetch`, so `mockFetch` is never invoked. The test fails at the `mockFetch.toHaveBeenCalled()` assertion — not coincidentally.  
Failure: `AssertionError: expected "spy" to be called at least once` at line 166. ✓

**HH-05** (`sendDisconnect() returns false when Hub hangs`):  
The test now stubs `globalThis.fetch` with a mock that hangs (`new Promise<never>(() => {})`), then asserts `expect(mockFetch).toHaveBeenCalled()`. The stub throws before reaching fetch, so the mock is never called.  
Failure: `AssertionError: expected "spy" to be called at least once` at line 227. ✓

Both tests will turn GREEN only when `sendDisconnect()` is implemented using `fetch` — coincidental passes via synchronous throw are no longer possible.

### BLOCK-2 — AR-02 and AR-03: RESOLVED ✓

Both tests are now correctly RED.

**AR-02** (`when existing Hub is dead, activate() falls back to spawn`):  
The test now includes `expect(probeSpy).toHaveBeenCalled()` as a leading assertion (line 1290). Since the current `activate()` stub never calls `probeExistingHub()`, this assertion fails before the spawn check is reached.  
Failure: `AssertionError: expected "probeExistingHub" to be called at least once` at line 1290. ✓

**AR-03** (`when existing Hub is alive but unhealthy, activate() falls back to spawn`):  
Same fix applied — `expect(probeSpy).toHaveBeenCalled()` at line 1309.  
Failure: `AssertionError: expected "probeExistingHub" to be called at least once` at line 1309. ✓

### BLOCK-3 — AR-08 added: RESOLVED ✓

AR-08 (`first-launch with no stored credentials skips probing, generates new creds, and spawns`) is present at line 1402–1431 of `hub-manager.test.ts`.

The test:
1. Creates a manager with empty `SecretStorage` (`secrets: {}`) to simulate first launch
2. Spies on `probeExistingHub` — asserts it is **NOT** called (no token means no reconnect attempt)
3. Spies on `generateHubCredentials` — asserts it **IS** called to produce fresh credentials
4. Asserts `secrets.store` is called with both `"accordo.bridgeSecret"` and `"accordo.hubToken"`
5. Asserts `spawn` **IS** called (fresh start after credential generation)

The test fails at the `generateHubCredentials` assertion since the stub's `activate()` does not yet call it.  
Failure: `AssertionError: expected "generateHubCredentials" to be called at least once` at line 1425. ✓

The `probeSpy.not.toHaveBeenCalled()` assertion at line 1423 passes in the stub state (stub never calls probe), which is correct — on first launch the expectation is that probe is skipped, and the stub confirms that. The test will correctly guard the implementation: once `activate()` is wired for reconnect-first, it must branch on empty SecretStorage before calling `probeExistingHub`.

### AR-06 (hub-manager.test.ts) — NB-3 also addressed ✓

`expect.hasAssertions()` was added at line 1363. The test now passes with a vacuous pass only if at least one assertion was made — except the current stub triggers the `if` branch condition to be false (onHubReady not called), meaning the conditional assertion block is not entered. However, `expect.hasAssertions()` requires at least one assertion — and the test currently passes. 

Examining: when `probeExistingHub` returns `alive: false`, the current stub's `activate()` still calls `spawn` and (after `pollHealth`) `onHubReady`. Since `pollHealth` is mocked to return `true` and `spawn` is mocked to resolve, `onHubReady` IS called via the existing always-spawn path. The conditional block at line 1377 IS entered, and `expect(call[2]).toBeUndefined()` is asserted (and passes because the stub calls `onHubReady` without a third arg). `expect.hasAssertions()` is satisfied. This is acceptable GREEN behaviour for AR-06 — the fresh-spawn path already works and the assertion correctly fires.

### No new issues introduced

The fixes are well-contained:
- HH-03b and HH-05 changes are additive (mock-fetch approach) and do not alter test isolation or timer usage
- AR-02 and AR-03 additions are single-line `expect(...).toHaveBeenCalled()` prepended to existing assertions
- AR-08 is a self-contained `it()` block with its own mock setup; it does not affect other tests in the describe block
- All `beforeEach`/`afterEach` cleanup patterns (`vi.restoreAllMocks()`, `vi.useRealTimers()`) are preserved in the AR tests' describe block

**Phase B is approved. Phase C (implementation) may begin.**
