# Review — Browser Tab Control — Phase B (Test Coverage)

**Date:** 2026-04-01  
**Reviewer:** Reviewer agent  
**Module:** Browser Tab Control (`packages/browser-extension`)  
**Phase A review:** `docs/reviews/browser-tab-control-architecture.md` — APPROVED ✅  
**Design doc:** `docs/10-architecture/browser-tab-control-architecture.md`

---

## Verdict: FAIL — one blocking issue remains after re-review

Fix #2 (typo) is fully resolved. Fix #1 (`dispatchRuntimeMessage`) was applied but is **insufficient** — 5 tests in `resolve-element-coords.test.ts` still crash with `TypeError` before reaching assertion level. A third fix (a `RESOLVE_ELEMENT_COORDS` stub in `message-handlers.ts`) is required.

---

## Re-review — Test Run Output (2026-04-01)

```
Test Files  9 failed | 33 passed (42)
      Tests  153 failed | 770 passed (923)
   Duration  ~13s
```

Total count is correct: **153 failures, 770 passing**. However, **5 of the 153 failures are still pre-assertion TypeErrors**, not assertion-level failures. The Phase B contract requires all 153 to fail at assertion level.

---

## ✅ Fix #2 RESOLVED — `browser-control-navigate.test.ts` typo

The `chger` → `chrome` fix was applied successfully. Line 76 now correctly reads:

```ts
expect(globalThis.chrome.debugger.sendCommand).toHaveBeenCalledWith(
```

No remaining instances of `chger` anywhere in the test file. All 11 navigate tests fail with `Error: not implemented` (assertion-level). ✅

---

## ✅ Fix #1 PARTIALLY APPLIED — `dispatchRuntimeMessage` now returns `Promise<unknown>`

The fix was applied to `tests/setup/chrome-mock.ts`. The function signature is now:

```ts
export function dispatchRuntimeMessage(
  message: unknown,
  sender: unknown = {},
  sendResponse: (response: unknown) => void = () => undefined
): Promise<unknown>
```

It wraps `sendResponse` and resolves the returned Promise with whatever value the listener passes to it. A 100ms safety timeout resolves with `undefined` if `sendResponse` is never called.

**The fix is correct in design but insufficient on its own.** The root cause of the 5 remaining TypeErrors is that the `RESOLVE_ELEMENT_COORDS` message type has **no handler case in `message-handlers.ts`**. There is no `case "RESOLVE_ELEMENT_COORDS":` in the `chrome.runtime.onMessage` switch statement, so `sendResponse` is never invoked by any listener. The 100ms timeout fires and the Promise resolves with `undefined`. The tests then call `expect(undefined).toHaveProperty(…)` or `"error" in undefined`, both of which throw `TypeError` before reaching the assertion.

---

## FAIL — Issue 3 (new): Missing `RESOLVE_ELEMENT_COORDS` stub in `message-handlers.ts`

### Root cause

`src/content/message-handlers.ts` handles `PAGE_UNDERSTANDING_ACTION`, `CAPTURE_SNAPSHOT_ENVELOPE`, `RESOLVE_ANCHOR_BOUNDS`, and comment messages — but has **no stub for `RESOLVE_ELEMENT_COORDS`**. When a test dispatches `{ type: "RESOLVE_ELEMENT_COORDS", … }`, the switch statement falls through to `default: break;` without calling `sendResponse`. The `dispatchRuntimeMessage` timeout then resolves with `undefined`, and the test throws `TypeError`.

### Affected tests (5 TypeErrors — NOT assertion-level)

| Test | Line | Error |
|---|---|---|
| `RESOLVE_ELEMENT_COORDS: dispatching message triggers the handler…` | 52 | `TypeError: Cannot convert undefined or null to object` |
| `RESOLVE_ELEMENT_COORDS: selector '#submit-btn' should resolve to coordinates` | 64 | `TypeError: Cannot use 'in' operator to search for 'error' in undefined` |
| `RESOLVE_ELEMENT_COORDS: non-existent selector returns not-found error` | 82 | `TypeError: Cannot convert undefined or null to object` |
| `error 'no-identifier': neither uid nor selector provided` | 182 | `TypeError: Cannot convert undefined or null to object` |
| `error 'not-found': uid not in refIndex and not a valid anchor key` | 194 | `TypeError: Cannot convert undefined or null to object` |

### What must be fixed

Add a `case "RESOLVE_ELEMENT_COORDS":` stub to the `chrome.runtime.onMessage.addListener` switch in `src/content/message-handlers.ts` that calls `sendResponse` with a stub body. The stub must call `sendResponse(…)` and return `true` (to signal async response). A minimal Phase B stub is:

```ts
case "RESOLVE_ELEMENT_COORDS": {
  const { uid, selector } = message as { uid?: string; selector?: string };
  void (async () => {
    try {
      // Phase C will implement this
      throw new Error("not implemented");
    } catch {
      _sendResponse({ error: "not-implemented" });
    }
  })();
  return true;
}
```

Any stub that calls `_sendResponse(…)` synchronously or asynchronously is acceptable, as long as it does not allow the `dispatchRuntimeMessage` timeout to fire first. The simplest valid stub that makes all 5 tests reach assertion level is:

```ts
case "RESOLVE_ELEMENT_COORDS":
  _sendResponse({ error: "not-implemented" });
  return false;
```

This ensures `response` is a non-null object, so `expect(response).toHaveProperty(…)` reaches the assertion (which will then fail because `"not-implemented"` ≠ `"no-identifier"` — a proper assertion-level Phase B failure).

---

## Pre-existing non-blocking observations (unchanged from original review)

### Observation A: 2 jsdom geometry failures (assertion-level ✅ — non-blocking)

Two tests fail because jsdom does not implement `getBoundingClientRect` (always returns `{width:0, height:0, …}`):

- `getBoundingClientRect: returns correct center for #submit-btn` (line 115: `expected 0 to be greater than 0`)
- `center computation: verifies center point calculation matches architecture` (line 166: `expected 0 to be greater than 0`)

These **are** assertion-level failures and do not block Phase C. However, they will not become green when the implementation is written because the assertions test DOM mock behavior that is impossible in jsdom. The developer should mock `getBoundingClientRect` explicitly in `beforeEach` (e.g., `element.getBoundingClientRect = () => ({ left: 10, top: 20, width: 100, height: 40, … })`) when implementing these tests. They are noted here as a developer awareness item — not a Phase B gate.

---

## Summary of required fixes before Phase C

| # | Status | File | Fix |
|---|---|---|---|
| 1 | ✅ RESOLVED | `tests/browser-control-navigate.test.ts` line 76 | `chger` → `chrome` — done |
| 2 | ⚠️ PARTIAL | `tests/setup/chrome-mock.ts` `dispatchRuntimeMessage` | Returns `Promise<unknown>` — applied correctly, but insufficient without Fix #3 |
| 3 | ❌ NEW — BLOCKING | `src/content/message-handlers.ts` | Add `case "RESOLVE_ELEMENT_COORDS":` stub that calls `sendResponse` before the 100ms timeout |

After Fix #3 is applied, re-run `pnpm --filter browser-extension test` to confirm:
- All 153 failures are at assertion level (no TypeErrors)
- All 770 passing tests remain green
- Then Phase C may begin
