# Phase B Review — BATCH1 tabId Routing

**Date:** 2026-04-01  
**Reviewer:** Reviewer agent  
**Scope:** B2-CTX-001..005 — tabId routing for `capture_region` and `diff_snapshots`  
**Design doc:** `docs/50-reviews/BATCH1-tabId-routing-A.md`  
**Test files reviewed:**
1. `packages/browser/src/__tests__/capture-region-tabid.test.ts` (3 tests)
2. `packages/browser/src/__tests__/diff-snapshots-tabid.test.ts` (5 tests)
3. `packages/browser-extension/tests/capture-tabid-routing.test.ts` (8 tests)

---

## Verdict: **CONDITIONAL PASS** — 2 issues must be fixed before Phase C

All required bugs are covered and most RED tests correctly demonstrate real defects. However there are **2 structural defects** in the B2-CTX-004 tests (vacuous assertions) and a **1 missing coverage assertion** (restore-after-capture) that must be addressed before implementation begins.

---

## Test Run Results

### `packages/browser` — `pnpm --filter accordo-browser run test -- --run`

| Test file | Tests | Pass | Fail |
|---|---|---|---|
| `capture-region-tabid.test.ts` | 3 | **3** | 0 |
| `diff-snapshots-tabid.test.ts` | 5 | 3 | **2** |
| `control-tools.test.ts` (pre-existing) | 73 | 67 | **6** (pre-existing, ignored) |

**New tabId routing tests:** 2 correct RED failures, 6 correct GREEN passes.

```
✓ B2-CTX-001: handleCaptureRegion passes tabId through to relay.request when provided
✓ B2-CTX-001: handleCaptureRegion omits tabId from relay payload when absent
✓ B2-CTX-002: handleCaptureRegion passes correct tabId for non-active tab targeting

✗ B2-CTX-002 RED: resolveFreshSnapshot includes tabId in get_page_map relay call when tabId is provided
  → expected {} to have property "tabId"    ← correct RED: Bug 1 demonstrated

✓ B2-CTX-002: resolveFreshSnapshot omits tabId from get_page_map when tabId is absent (active tab fallback)

✗ B2-CTX-003 RED: resolveFromSnapshot includes tabId in get_page_map relay call when tabId is provided
  → expected undefined to be defined        ← correct RED: Bug 2 demonstrated

✓ B2-CTX-003: resolveFromSnapshot omits tabId when tabId is absent (active tab fallback)
✓ B2-CTX-002/003: with explicit IDs, no get_page_map calls are made (tabId not needed in relay payload)
```

### `packages/browser-extension` — `pnpm --filter browser-extension run test -- --run`

| Test file | Tests | Pass | Fail |
|---|---|---|---|
| `capture-tabid-routing.test.ts` | 8 | 4 | **4** |
| `browser-control-*.test.ts` (pre-existing) | 41 | 27 | **14** (pre-existing, ignored) |

**New tabId routing tests:**

```
✗ B2-CTX-003 RED: toCapturePayload extracts tabId from payload when present
  → expected {...} to have property "tabId"                  ← correct RED: Bug 1 demonstrated

✓ B2-CTX-003: toCapturePayload returns tabId: undefined when absent from payload

✗ B2-CTX-003: toCapturePayload extracts all fields including tabId
  → expected undefined to be 99                             ← correct RED: also Bug 1

✗ B2-CTX-005 RED: requestContentScriptEnvelope uses explicit tabId when provided
  → expected 1 to be 42                                     ← correct RED: Bug 3 demonstrated

✓ B2-CTX-005: requestContentScriptEnvelope falls back to active tab when tabId omitted

✓ B2-CTX-004 RED: captureTab calls chrome.tabs.update to activate target tab before capture
✓ B2-CTX-004: captureTab skips swap when tabId is already the active tab

✗ B2-CTX-003 RED: handleCaptureRegion with tabId routes RESOLVE_ANCHOR_BOUNDS to correct tab
  → expected 1 to be 42                                     ← correct RED: full chain Bug 1+2
```

---

## Issue 1 — DEFECT: B2-CTX-004 "RED" test is structurally vacuous (MUST FIX)

**File:** `packages/browser-extension/tests/capture-tabid-routing.test.ts`, lines 233–256  
**Severity:** High — the test gives a **false coverage signal**

The `B2-CTX-004 RED: captureTab calls chrome.tabs.update to activate target tab before capture` test PASSES, but not because the code is correct. It passes because it never calls the function under test. The test sets up mocks (`updateCalls` array, `captureVisibleTab` mock) but then immediately asserts:

```typescript
expect(updateCalls.length).toBe(0); // FAILS when tab-swap is implemented
```

This assertion is vacuously true (no function was called, so the array is always empty). The comment on that line reveals the confusion: `// FAILS when tab-swap is implemented` — but this is backwards. A RED test must FAIL now (before implementation) and PASS after. This test will **always pass** regardless of whether tab-swap logic exists.

The same structural problem applies to the "skips swap" test at lines 262–274: it also never invokes `handleCaptureRegion` or any other function, and asserts `updateCalls.length === 0` against a mock that was never triggered.

**Required fix:**  
Both tests must invoke `handleCaptureRegion(...)` to actually exercise the code path.

For the RED test (non-active tab), the corrected structure:

```typescript
it("B2-CTX-004 RED: captureTab calls chrome.tabs.update to activate target tab before capture", async () => {
  const { handleCaptureRegion } = await import("../src/relay-capture-handler.js");

  (chrome.tabs.captureVisibleTab as ReturnType<typeof vi.fn>).mockResolvedValue(
    "data:image/jpeg;base64,mockScreenshot"
  );
  (chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockImplementation(
    async (_tabId: number, message: unknown) => {
      if ((message as Record<string, unknown>)["type"] === "CAPTURE_SNAPSHOT_ENVELOPE") {
        return {
          pageId: "page", frameId: "main", snapshotId: "page:0",
          capturedAt: "2025-01-01T00:00:00.000Z",
          viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
          source: "visual" as const,
        };
      }
      return undefined;
    }
  );

  // Target a non-active tab (42 ≠ active tab 1)
  await handleCaptureRegion({
    requestId: "test-tab-swap",
    action: "capture_region",
    payload: { tabId: 42, rect: { x: 0, y: 0, width: 100, height: 100 }, quality: 70 },
  });

  // Currently FAILS: chrome.tabs.update is never called (no tab-swap logic exists)
  const updateCalls = (chrome.tabs.update as ReturnType<typeof vi.fn>).mock.calls;
  expect(updateCalls.length).toBeGreaterThanOrEqual(2); // activate + restore = at least 2 calls
  expect(updateCalls[0]?.[0]).toBe(42);                               // activate target tab
  expect(updateCalls[0]?.[1]).toEqual({ active: true });
  expect(updateCalls[updateCalls.length - 1]?.[0]).toBe(1);           // restore original
  expect(updateCalls[updateCalls.length - 1]?.[1]).toEqual({ active: true });
});
```

For the "skips swap" test (active tab — tab 1), the corrected structure:

```typescript
it("B2-CTX-004: captureTab skips swap when tabId is already the active tab", async () => {
  const { handleCaptureRegion } = await import("../src/relay-capture-handler.js");

  (chrome.tabs.captureVisibleTab as ReturnType<typeof vi.fn>).mockResolvedValue(
    "data:image/jpeg;base64,mockScreenshot"
  );
  (chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockImplementation(
    async (_tabId: number, message: unknown) => {
      if ((message as Record<string, unknown>)["type"] === "CAPTURE_SNAPSHOT_ENVELOPE") {
        return {
          pageId: "page", frameId: "main", snapshotId: "page:0",
          capturedAt: "2025-01-01T00:00:00.000Z",
          viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
          source: "visual" as const,
        };
      }
      return undefined;
    }
  );

  // Target the active tab (tabId: 1 = active tab) — no swap needed
  await handleCaptureRegion({
    requestId: "test-no-swap",
    action: "capture_region",
    payload: { tabId: 1, rect: { x: 0, y: 0, width: 100, height: 100 }, quality: 70 },
  });

  // No chrome.tabs.update should be called when targeting the already-active tab
  const updateCalls = (chrome.tabs.update as ReturnType<typeof vi.fn>).mock.calls;
  expect(updateCalls.length).toBe(0);  // This currently PASSES and should still PASS after fix
});
```

---

## Issue 2 — COVERAGE GAP: Tab restore not explicitly asserted (MUST FIX)

**Related to Issue 1.** The design doc (§7, DEC-010) explicitly requires restoring the previous active tab after capture:

> "5. Call `chrome.tabs.update(savedTabId, { active: true })` to restore the previous tab."

This is a critical UX correctness requirement — without the restore call, the user's browser focus is permanently hijacked every time a background tab is captured. There is no test that verifies the restore step. The corrected RED test in Issue 1 covers this (the assertion on `updateCalls[updateCalls.length - 1]`), so fixing Issue 1 will also satisfy Issue 2.

---

## What Is Correctly Done

1. **`capture-region-tabid.test.ts`** — All 3 tests are well-structured. They PASS because the Hub pass-through already works (confirmed by the design doc: "Hub Passes: ✅ transparent pass-through"). The recording relay pattern is clean and the tests serve as correct regression guards.

2. **`diff-snapshots-tabid.test.ts`** — All 5 tests are well-structured. Both RED tests fail at exactly the right assertion. The call-order assumption (first `get_page_map` call = fresh snapshot resolution, second = from-snapshot preflight) is consistent with how `handleDiffSnapshots` branches. The explicit-IDs path test correctly verifies no implicit `get_page_map` calls are made — this is a valuable boundary-condition test aligned with §13a of the design doc.

3. **B2-CTX-003 tests in `capture-tabid-routing.test.ts`** — The `toCapturePayload` unit tests and the full-chain integration test (`handleCaptureRegion` routes chain) are all correctly RED at the right assertions. The chrome mock infrastructure (`chrome-mock.ts`) is solid, with proper `setMockTabUrl` helpers and `resetChromeMocks` in each `beforeEach`.

4. **B2-CTX-005 test** — Correctly RED: `capturedTabId === 1` (active tab returns) instead of `42`. The backward-compat test correctly passes. The test also exercises the proposed new function signature (`requestContentScriptEnvelope("visual", 42)`) — this will catch TypeScript compile errors before/during Phase C.

5. **Requirement traceability** — Every `describe` block and every `it` name contains a B2-CTX-00x identifier. All 14 requirement-to-bug mappings from the design doc have at least one test.

6. **Test independence** — Each `describe` block has its own `beforeEach` that calls `resetChromeMocks()`. No shared mutable state leaks between test groups.

---

## Full Coverage Assessment

| Requirement | Design Doc Bug | Test | Status |
|---|---|---|---|
| B2-CTX-001 | Hub: `CaptureRegionArgs` missing `tabId` | capture-region-tabid × 3 | ✅ PASS (already fixed) |
| B2-CTX-002 | Hub: `resolveFreshSnapshot` passes `{}` | diff-snapshots-tabid | ✅ RED correctly |
| B2-CTX-002 | Backward compat / explicit IDs path | diff-snapshots-tabid × 2 | ✅ PASS correctly |
| B2-CTX-003 | Hub: `resolveFromSnapshot` passes `{}` | diff-snapshots-tabid | ✅ RED correctly |
| B2-CTX-003 | Ext: `toCapturePayload` drops `tabId` | capture-tabid-routing × 2 | ✅ RED correctly |
| B2-CTX-003 | Ext: `resolvePaddedBounds` ignores `tabId` | capture-tabid-routing (integration) | ✅ RED correctly (via chain) |
| B2-CTX-004 | Ext: no tab-swap in `captureVisibleTab` | capture-tabid-routing | ⚠️ VACUOUS PASS — Issue 1 |
| B2-CTX-004 | Ext: restore active tab after capture | capture-tabid-routing | ❌ MISSING — Issue 2 |
| B2-CTX-004 | Ext: skip swap when already active tab | capture-tabid-routing | ⚠️ VACUOUS PASS — fix with Issue 1 |
| B2-CTX-005 | Ext: `requestContentScriptEnvelope` ignores `tabId` | capture-tabid-routing | ✅ RED correctly |
| B2-CTX-005 | Backward compat | capture-tabid-routing | ✅ PASS correctly |

---

## Actions Required Before Phase C

### MUST FIX (blocking)

**Action 1:** Fix both B2-CTX-004 tests in `capture-tabid-routing.test.ts` (lines 233–274) to actually invoke `handleCaptureRegion(...)`:
- The non-active-tab test must FAIL currently (no `chrome.tabs.update` calls) and PASS after Phase C implementation.
- The active-tab test must continue to PASS both now and after Phase C.
- Add explicit assertion that the restore call (`chrome.tabs.update(1, { active: true })`) is made after the capture — this covers Issue 2 simultaneously.

### SHOULD FIX (non-blocking)

**Action 2:** If `resolvePaddedBounds` is exported during Phase C (recommended for testability), add the two dedicated unit tests sketched in the comment block at lines 347–360. Not required before Phase C begins since the integration test covers the path.

---

## Re-review Required

Yes — after Action 1, the test-builder must re-run `pnpm --filter browser-extension run test -- --run` and confirm:
- The corrected B2-CTX-004 non-active-tab test now **FAILS** (RED — demonstrating the bug)
- The B2-CTX-004 active-tab test still **PASSES** (correct baseline)
- No regressions in any other test

Submit the updated test output for sign-off before Phase C begins.

---

## Re-review — 2026-04-01 — **PASS**

**Reviewer:** Reviewer agent  
**Triggered by:** test-builder fixed Issues 1 and 2 from original review.

### Test runs executed

```
pnpm --filter browser-extension run test -- --run
pnpm --filter accordo-browser run test -- --run
```

### Issue 1 resolution — B2-CTX-004 non-vacuous RED ✅ FIXED

The B2-CTX-004 RED test now calls `handleCaptureRegion(...)` with `payload: { tabId: 42, ... }`
and asserts on `updateCalls.length`:

```
× B2-CTX-004 RED: handleCaptureRegion with non-active tabId triggers tab-swap
  → expected 0 to be greater than or equal to 2
  ❯ tests/capture-tabid-routing.test.ts:284
```

This is a genuine, non-vacuous RED failure. The test invokes the real production function,
the mock captures zero `chrome.tabs.update` calls (because tab-swap logic doesn't exist yet),
and the assertion correctly catches that. The test will go GREEN when Phase C adds the
activate-capture-restore sequence.

The "skips tab-swap" test (`B2-CTX-004: handleCaptureRegion with active tabId skips tab-swap`)
correctly PASSES.

### Issue 2 resolution — Restore assertion present ✅ FIXED

Lines 294–296 of `capture-tabid-routing.test.ts`:

```typescript
const lastUpdate = updateCalls[updateCalls.length - 1];
expect(lastUpdate.tabId).toBe(1);
expect(lastUpdate.properties.active).toBe(true);
```

The restore assertion is present, logically correct (last `update` call must restore the
original active tab 1), and will be exercised once the Phase C implementation lands.

### Full tabId routing RED test status

| Test | File | Expected failure | Actual failure | Status |
|---|---|---|---|---|
| B2-CTX-003 RED: toCapturePayload extracts tabId | capture-tabid-routing | `toHaveProperty("tabId")` | `expected {...} to have property "tabId"` | ✅ correct RED |
| B2-CTX-003: toCapturePayload extracts all fields | capture-tabid-routing | `tabId` to be 99 | `expected undefined to be 99` | ✅ correct RED |
| B2-CTX-005 RED: requestContentScriptEnvelope uses explicit tabId | capture-tabid-routing | `capturedTabId` to be 42 | `expected 1 to be 42` | ✅ correct RED |
| B2-CTX-004 RED: handleCaptureRegion with non-active tabId triggers tab-swap | capture-tabid-routing | `updateCalls.length >= 2` | `expected 0 to be >= 2` | ✅ correct RED |
| B2-CTX-003 RED: handleCaptureRegion routes RESOLVE_ANCHOR_BOUNDS to correct tab | capture-tabid-routing | `capturedTabId` to be 42 | `expected 1 to be 42` | ✅ correct RED |
| B2-CTX-002 RED: resolveFreshSnapshot includes tabId | diff-snapshots-tabid | `toHaveProperty("tabId")` | `expected {} to have property "tabId"` | ✅ correct RED |
| B2-CTX-003 RED: resolveFromSnapshot includes tabId | diff-snapshots-tabid | second `get_page_map` call with tabId | `expected undefined to be defined` | ✅ correct RED |

### Correct GREEN tests (should not regress)

| Test | File | Status |
|---|---|---|
| B2-CTX-003: toCapturePayload returns tabId: undefined when absent | capture-tabid-routing | ✅ PASS |
| B2-CTX-005: requestContentScriptEnvelope falls back to active tab when tabId omitted | capture-tabid-routing | ✅ PASS |
| B2-CTX-004: handleCaptureRegion with active tabId skips tab-swap | capture-tabid-routing | ✅ PASS |
| B2-CTX-002: resolveFreshSnapshot omits tabId when absent | diff-snapshots-tabid | ✅ PASS |
| B2-CTX-003: resolveFromSnapshot omits tabId when absent | diff-snapshots-tabid | ✅ PASS |
| B2-CTX-002/003: explicit IDs — no get_page_map calls | diff-snapshots-tabid | ✅ PASS |
| All 3 capture-region-tabid tests (Hub pass-through) | capture-region-tabid | ✅ PASS |

### Pre-existing failures (out of scope — not introduced by this batch)

The following failures exist in `browser-extension` and `accordo-browser` but are unrelated
to Batch 1 tabId routing and were already present before this batch:

- `browser-control-click.test.ts` — 4 CDP mouse-sequence RED tests (separate batch)
- `browser-control-keyboard.test.ts` — 6 modifier/keyUp RED tests (separate batch)
- `browser-control-type.test.ts` — 4 clearFirst/submitKey RED tests (separate batch)
- `control-tools.test.ts` — 6 edge-case RED tests in `accordo-browser` (separate batch)

None of these are in scope for this review.

### Updated coverage table

| Requirement | Design Doc Bug | Test | Status |
|---|---|---|---|
| B2-CTX-001 | Hub: `CaptureRegionArgs` missing `tabId` | capture-region-tabid × 3 | ✅ PASS (already fixed) |
| B2-CTX-002 | Hub: `resolveFreshSnapshot` passes `{}` | diff-snapshots-tabid | ✅ RED correctly |
| B2-CTX-002 | Backward compat / explicit IDs path | diff-snapshots-tabid × 2 | ✅ PASS correctly |
| B2-CTX-003 | Hub: `resolveFromSnapshot` passes `{}` | diff-snapshots-tabid | ✅ RED correctly |
| B2-CTX-003 | Ext: `toCapturePayload` drops `tabId` | capture-tabid-routing × 2 | ✅ RED correctly |
| B2-CTX-003 | Ext: `resolvePaddedBounds` ignores `tabId` | capture-tabid-routing (integration) | ✅ RED correctly (via chain) |
| B2-CTX-004 | Ext: no tab-swap in `captureVisibleTab` | capture-tabid-routing | ✅ RED correctly — **FIXED** |
| B2-CTX-004 | Ext: restore active tab after capture | capture-tabid-routing | ✅ Asserted in restore step — **FIXED** |
| B2-CTX-004 | Ext: skip swap when already active tab | capture-tabid-routing | ✅ PASS correctly — **FIXED** |
| B2-CTX-005 | Ext: `requestContentScriptEnvelope` ignores `tabId` | capture-tabid-routing | ✅ RED correctly |
| B2-CTX-005 | Backward compat | capture-tabid-routing | ✅ PASS correctly |

### Verdict: **PASS** — Phase B complete, Phase C may begin

All previous blocking issues are resolved:
- Issue 1 (vacuous B2-CTX-004 RED): ✅ Fixed — test now fails at `expected 0 to be >= 2`
- Issue 2 (missing restore assertion): ✅ Fixed — `lastUpdate.tabId === 1` and `lastUpdate.properties.active === true` are asserted

All 7 required RED tests fail at meaningful assertions. All 7 backward-compatibility GREEN
tests pass. No new regressions introduced. Every requirement in B2-CTX-001..005 has at
least one test. Test independence (per-`describe` `beforeEach` + `resetChromeMocks()`)
confirmed intact.

**Phase C (implementation) is unblocked.**
