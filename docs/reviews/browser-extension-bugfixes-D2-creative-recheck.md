## Review — browser-extension-bugfixes — Phase D2 creative recheck

Date: 2026-04-09

## Scope re-verified

- `packages/browser-extension/src/relay-control-handlers.ts`
- `packages/browser-extension/tests/browser-control-navigate.test.ts`
- `packages/browser/src/diff-tool.ts`
- `packages/browser/src/__tests__/diff-tool.test.ts`

Also inspected related test coverage in:

- `packages/browser-extension/tests/relay-control-handlers.test.ts`

---

## Blocker 1 — Navigation waiters resolving on iframe events

### Status: ⚠️ **Partially addressed**

### What is correct now

1. **`createFrameNavigatedWaiter` main-frame filtering is implemented**
   - In `relay-control-handlers.ts`, it now resolves only when:
     - event is `Page.frameNavigated`
     - tabId matches
     - `params.frame` exists
     - `frame.parentId === undefined` (main frame)

2. **`createLifecycleWaiter` now filters by frameId**
   - It accepts `mainFrameId: string` and checks `p?.frameId === mainFrameId`.

3. **`Page.getFrameTree` is called before the navigation command for URL/reload**
   - URL path: `Page.setLifecycleEventsEnabled` → `Page.getFrameTree` → create waiter → `Page.navigate`
   - Reload path: `Page.setLifecycleEventsEnabled` → `Page.getFrameTree` → create waiter → `Page.reload`
   - This is the correct ordering to avoid missing early lifecycle events.

### Remaining issues

1. **Claimed test location mismatch**
   - The requested file `browser-control-navigate.test.ts` does **not** contain iframe filtering assertions.
   - Iframe filtering tests are in `relay-control-handlers.test.ts` instead.

2. **Existing iframe tests are weak / potentially false-green**
   - In `relay-control-handlers.test.ts`, tests fire iframe event then main-frame event and only assert final success.
   - They do **not** assert that the promise remained pending after the iframe event.
   - A regressed implementation that resolves on iframe event could still pass these tests.

3. **Fail-open fallback in lifecycle waiter**
   - `mainFrameId` defaults to `""` when `Page.getFrameTree` result is missing.
   - Waiter then accepts **any frame** (`mainFrameId === "" || frameId matches`), which re-opens the original false-success class under malformed/partial frameTree responses.

### Edge-case checks requested

- If `Page.getFrameTree` throws: handler returns `action-failed` (safe failure).
- If `params.frame` is missing on `Page.frameNavigated`: waiter ignores event and times out (safe, no false success).

---

## Blocker 2 — Reversed explicit snapshot IDs silently accepted

### Status: ✅ **Resolved**

### Verified

1. **`parseSnapshotId` added and used**
   - Implemented in `packages/browser/src/diff-tool.ts`.
   - Uses `lastIndexOf(":")` so page IDs containing colons are handled correctly.

2. **Reversed same-page explicit IDs now produce warning**
   - When both parse, pageId matches, and `fromVersion > toVersion`, `orderingWarning` is set.
   - Relay call is still made (non-blocking behavior), as intended.

3. **Warning is returned in successful diff response**
   - Success response merges `orderingWarning` into returned result.

4. **Tests are meaningful and directly assert behavior**
   - `packages/browser/src/__tests__/diff-tool.test.ts` includes BUG-B tests for:
     - reversed same-page IDs → warning present
     - correct order same-page IDs → warning absent
     - cross-page IDs → warning absent

### Minor caveat (non-blocking)

- `parseSnapshotId` uses `parseInt`, so strings like `"page:3xyz"` parse as version `3` rather than being rejected.
- This is not part of the blocker and does not break the stated fix, but stricter parsing would be safer.

---

## Test / Build / Typecheck results

### `packages/browser-extension`

- `pnpm test`: **PASS**
  - Test files: **47 passed**
  - Tests: **1132 passed, 0 failed**
- `pnpm build`: **PASS**
- `pnpm typecheck`: **PASS**

### `packages/browser`

- `pnpm test`: **PASS**
  - Test files: **33 passed**
  - Tests: **932 passed, 0 failed**
  - `diff-tool.test.ts`: **44 passed**
  - `shared-relay-server.test.ts`: passed in this run (no EADDRINUSE observed)
- `pnpm build`: **PASS**
- `pnpm typecheck`: **PASS**

---

## New issues introduced by the fixes

### Must-fix before closing this recheck

1. **Strengthen iframe-filtering tests to prove non-resolution on iframe events**
   - Add assertion that waiter remains pending after iframe-only event (before main-frame event).
   - Current tests can pass even if iframe filtering regresses.

2. **Avoid fail-open behavior when mainFrameId is unavailable**
   - Do not treat `mainFrameId === ""` as “accept any frame”.
   - Prefer fail-closed behavior (return `action-failed`) or an explicit fallback strategy that still excludes iframe events.

### Recommendations

- Tighten snapshot ID parsing to require strictly numeric version segments.

---

## Overall verdict: **FAIL**

- **Blocker 1:** ⚠️ Partially addressed (core code fixed, but verification is not robust and one fail-open path remains).
- **Blocker 2:** ✅ Resolved.

Phase should not be considered fully closed until Blocker 1 verification/fail-open gaps are fixed and re-reviewed.
