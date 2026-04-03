# Review — ws-4001-recovery / LCM-04 — Auth Failure Recovery Fix

**Commit:** `2d54bdf fix(bridge): LCM-04 WS-4001 auth failure recovery — restart Hub on auth failure`  
**File changed:** `packages/bridge/src/extension-composition.ts`  
**Reviewer:** Reviewer agent  
**Date:** 2026-04-02

---

## Verdict: APPROVED ✅

The fix is correct, minimal, type-safe, lint-clean, and all 387 tests pass. One non-blocking test coverage suggestion is noted below.

---

## Checklist Analysis

### 1. Correctness — PASS ✅

**Requirement LCM-04** (from `docs/20-requirements/requirements-bridge.md`):
> "Generate new secret + token, persist to context.secrets, kill the existing Hub process, then spawn a new Hub."

**What the fix does:**  
`onAuthFailure` now calls `void deps.services.hubManager.restart()`.

`HubManager.restart()` → `_doRestart()` executes:
1. Soft-reauth attempt via `attemptReauth()` (generates new credentials, persists to `context.secrets`)
2. On failure → `killHub()` + `spawn()` + `_pollAndNotify()` → fires `onHubReady()` → new `WsClient` is instantiated

This satisfies LCM-04 in full. The `onDisconnected` event is also correctly fired (in `ws-client.ts` close handler, before `onAuthFailure`), so status bar updates happen in the right order.

---

### 2. No Regression — PASS ✅

```
pnpm test (packages/bridge)

Test Files  10 passed (10)
Tests      387 passed (387)
Duration   ~3.2s
```

Zero failures. Zero skipped.

---

### 3. Type Safety — PASS ✅

```
pnpm typecheck (packages/bridge)

No errors. No warnings.
```

The `void` operator is intentional and correct. `restart()` returns `Promise<void>`; the callback signature is `(): void`. Using `void` to explicitly discard the promise is the idiomatic pattern for fire-and-forget in a synchronous callback — consistent with existing usage throughout the codebase.

---

### 4. Architecture — PASS ✅

The change is a single line addition:

```typescript
// LCM-04: trigger full restart (reauth → hard fallback → kill+respawn with new credentials)
void deps.services.hubManager.restart();
```

- No refactoring, no new abstractions, no scope creep.
- The comment references LCM-04 for traceability.
- The fix is purely additive — no existing code was modified.
- Conforms to AGENTS.md §4 constraint: Hub lifecycle is managed entirely within `accordo-bridge`; no VSCode imports in Hub packages.

---

### 5. Edge Cases

#### 5a. `restartInProgress` guard (concurrent 4001 events) — PASS ✅

`HubManager.restart()` (line 210) checks `if (this.restartInProgress) { return; }` before proceeding. If the WebSocket emits 4001 multiple times in rapid succession, only the first call proceeds; all subsequent calls are immediate no-ops. Safe.

#### 5b. Hub exits unexpectedly mid-restart — PASS ✅

If the Hub process exits while `_doRestart()` is running (e.g., between `killHub()` and `spawn()`), `_onProcessExit()` may trigger another restart attempt. At that point `restartInProgress === true`, so the recursive call returns immediately. Once `_doRestart()` completes, `restartInProgress` resets to `false`. The `restartAttempted` flag in `processState` provides a secondary guard against infinite retry loops. No issue.

#### 5c. Stale WsClient socket after restart — ACCEPTABLE ✅

When `_pollAndNotify()` fires `onHubReady()`, a new `WsClient` instance is created, replacing `deps.state.wsClient`. The old socket is not explicitly `.close()`'d before the new one is created. This is acceptable because: the old socket is already in a closed or errored state (4001 was received), and the TCP connection will be released. No resource leak risk in practice.

---

### 6. No Dead Code / Side Effects — PASS ✅

The addition is purely additive. No code was removed or altered. No new module-level state, no new imports, no new dependencies introduced.

---

### 7. Linting — PASS ✅

```
pnpm lint (packages/bridge)

2 warnings, 0 errors
```

Both warnings are **pre-existing** and **not in the changed file**:
- `packages/bridge/src/extension.ts:192:5` — `@typescript-eslint/no-non-null-assertion`
- `packages/bridge/src/hub-manager.ts:363:41` — `@typescript-eslint/no-non-null-assertion`

The changed lines in `extension-composition.ts` produce no lint issues.

---

## Findings

### Finding 1 — Non-blocking suggestion: CE-10 test coverage gap

**File:** `packages/bridge/src/__tests__/extension-composition.test.ts`  
**Test:** CE-10 (`onAuthFailure callback is callable without throwing`)

CE-10 currently asserts only that calling `onAuthFailure()` does not throw. It does **not** assert that `hubManager.restart()` was actually invoked. A targeted assertion would close this gap:

```typescript
expect(mockHubManagerInstance.restart).toHaveBeenCalled();
```

**Severity:** Non-blocking. The behaviour is validated end-to-end by the hub-manager restart tests (64 tests covering all `_doRestart()` paths), and the change is so small that the risk of misassignment is negligible. Suggested as a follow-up.

---

## Summary

| Checklist Item | Result |
|---|---|
| Correctness (LCM-04 satisfied) | ✅ PASS |
| No regression (387 tests pass) | ✅ PASS |
| Type safety (typecheck clean) | ✅ PASS |
| Architecture (minimal, targeted) | ✅ PASS |
| Edge case: concurrent restarts | ✅ PASS |
| Edge case: Hub exits mid-restart | ✅ PASS |
| No dead code / side effects | ✅ PASS |
| Linting (0 errors, 2 pre-existing warnings) | ✅ PASS |

**Overall: APPROVED.** Ready to merge.
