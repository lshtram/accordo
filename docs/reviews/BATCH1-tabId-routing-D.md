# Phase D Review — BATCH1 tabId Routing

**Date:** 2026-04-02  
**Reviewer:** Reviewer agent  
**Scope:** B2-CTX-001..005 — tabId routing for `capture_region` and `diff_snapshots`  
**Phase:** D preflight — deep review before Phase D3 (testing guide) and Phase E (commit)  
**Files under review:**

| File | Package | Nature |
|---|---|---|
| `packages/browser/src/diff-tool.ts` | `accordo-browser` | Production — Hub |
| `packages/browser-extension/src/relay-type-guards.ts` | `browser-extension` | Production — Extension |
| `packages/browser-extension/src/relay-forwarder.ts` | `browser-extension` | Production — Extension |
| `packages/browser-extension/src/relay-capture-handler.ts` | `browser-extension` | Production — Extension |
| `packages/browser/src/__tests__/diff-snapshots-tabid.test.ts` | `accordo-browser` | Tests |
| `packages/browser-extension/tests/capture-tabid-routing.test.ts` | `browser-extension` | Tests |

---

## Verdict: **PASS** — Phase E (commit) is unblocked

All 13 new tests pass. TypeScript is clean on both packages. No banned patterns found in changed code. All architecture constraints satisfied. Pre-existing failures are unchanged and out of scope.

---

## 1. Tests

### Command: `pnpm --filter accordo-browser run test -- --run`

| Test file | Tests | Pass | Fail |
|---|---|---|---|
| `diff-snapshots-tabid.test.ts` | 5 | **5** | 0 |
| `control-tools.test.ts` (pre-existing) | 73 | 67 | **6** (pre-existing, out of scope) |

```
✓ B2-CTX-002 RED: resolveFreshSnapshot includes tabId in get_page_map relay call when tabId is provided
✓ B2-CTX-002: resolveFreshSnapshot omits tabId from get_page_map when tabId is absent (active tab fallback)
✓ B2-CTX-003 RED: resolveFromSnapshot includes tabId in get_page_map relay call when tabId is provided
✓ B2-CTX-003: resolveFromSnapshot omits tabId when tabId is absent (active tab fallback)
✓ B2-CTX-002/003: with explicit IDs, no get_page_map calls are made (tabId not needed in relay payload)
```

All 5 tests pass. ✅

### Command: `pnpm --filter browser-extension run test -- --run`

| Test file | Tests | Pass | Fail |
|---|---|---|---|
| `capture-tabid-routing.test.ts` | 8 | **8** | 0 |
| `browser-control-click.test.ts` (pre-existing) | — | — | **4** (pre-existing, out of scope) |
| `browser-control-keyboard.test.ts` (pre-existing) | — | — | **6** (pre-existing, out of scope) |
| `browser-control-type.test.ts` (pre-existing) | — | — | **4** (pre-existing, out of scope) |

```
✓ B2-CTX-003: toCapturePayload extracts tabId from payload when present
✓ B2-CTX-003: toCapturePayload returns tabId: undefined when absent from payload
✓ B2-CTX-003: toCapturePayload extracts all fields including tabId
✓ B2-CTX-005: requestContentScriptEnvelope uses explicit tabId when provided
✓ B2-CTX-005: requestContentScriptEnvelope falls back to active tab when tabId omitted
✓ B2-CTX-004: handleCaptureRegion with non-active tabId triggers tab-swap
✓ B2-CTX-004: handleCaptureRegion with active tabId skips tab-swap
✓ B2-CTX-003: handleCaptureRegion with tabId routes RESOLVE_ANCHOR_BOUNDS to correct tab
```

All 8 tests pass. ✅

**Pre-existing failures** (14 total across browser-extension, 6 in accordo-browser) match exactly what was documented in the review prompt. None introduced by this batch.

---

## 2. TypeScript

### `packages/browser` — `npx tsc --noEmit`

**Zero errors.** ✅

### `packages/browser-extension` — `npx tsc --noEmit`

**Zero errors.** ✅

---

## 3. Banned Patterns

Checked against `docs/30-development/coding-guidelines.md §3` across all four changed production files:

| Pattern | Files checked | Result |
|---|---|---|
| `: any` (untyped escape hatch) | All 4 production files | ✅ None found |
| `@ts-ignore` / `@ts-expect-error` | All 4 production files | ✅ None found |
| `console.log` / `console.error` in production | All 4 production files | ✅ None found |
| `TODO` / `FIXME` without tracking reference | All 4 production files | ✅ None found |
| Commented-out code | All 4 production files | ✅ None found |
| Hardcoded values that should be config | All 4 production files | ✅ None found |

---

## 4. Type Safety

### Non-null assertions (`!`)

Test files use the `[0]!` non-null assertion after array index access — these are guarded by preceding `expect(arr.length).toBeGreaterThanOrEqual(1)` checks and are an acceptable pattern in test code.

No non-null assertions on dynamic or unguarded objects in production files. ✅

### Type casts (`as X`)

**`diff-tool.ts` line ~378: `return response.data as DiffSnapshotsResponse`**

This cast appears inside a conditional block that first verifies: (1) `response.success` is true, (2) `response.data` exists, (3) `response.data` has `added`, `removed`, `changed` properties, and (4) `hasSnapshotEnvelope(response.data)` returns true (structural deep-check). The cast is after 7 distinct structural checks — narrowing is present. This is a pre-existing pattern (not introduced by this batch). Acceptable. ✅

**`relay-type-guards.ts`: `as Record<string, unknown>` casts** inside type guard functions. These are the correct idiom for type guard implementations and are pre-existing patterns. ✅

---

## 5. Architectural Constraints

Per `AGENTS.md §4`:

| Constraint | Check | Result |
|---|---|---|
| No `vscode` imports in Hub packages | Searched `packages/browser/src/diff-tool.ts` | ✅ None found |
| Security middleware first on authenticated endpoints | N/A — no new HTTP endpoints added | ✅ N/A |
| Handler functions never serialized across boundary | No new handler serialization | ✅ |

### `CapturePayload` type contract

`packages/browser-extension/src/relay-definitions.ts` confirms `tabId?: number` is present in the `CapturePayload` interface. The extension-side deserialisation (`toCapturePayload`) and Hub-side forward pass are consistent with this type. ✅

---

## 6. Requirement Coverage

Every B2-CTX requirement has at least one test:

| Requirement | Tests | Status |
|---|---|---|
| B2-CTX-001 | `capture-region-tabid.test.ts` × 3 (prior batch, GREEN) | ✅ |
| B2-CTX-002 | `diff-snapshots-tabid.test.ts` × 3 | ✅ |
| B2-CTX-003 (Hub) | `diff-snapshots-tabid.test.ts` × 2 | ✅ |
| B2-CTX-003 (Extension) | `capture-tabid-routing.test.ts` × 3 | ✅ |
| B2-CTX-004 (tab-swap) | `capture-tabid-routing.test.ts` × 1 | ✅ |
| B2-CTX-004 (skip-swap) | `capture-tabid-routing.test.ts` × 1 | ✅ |
| B2-CTX-004 (restore) | Asserted within tab-swap test | ✅ |
| B2-CTX-005 (explicit tabId) | `capture-tabid-routing.test.ts` × 1 | ✅ |
| B2-CTX-005 (fallback) | `capture-tabid-routing.test.ts` × 1 | ✅ |

No test was weakened. No requirement is uncovered. ✅

---

## 7. Implementation Quality

### Key changes introduced by this batch

**`diff-tool.ts` — `resolveFreshSnapshot` and `resolveFromSnapshot`**

Both functions now build `payload: Record<string, unknown> = {}` and conditionally add `tabId` only when `tabId !== undefined` before passing to `relay.request("get_page_map", payload, ...)`. The conditional-build pattern avoids sending `tabId: undefined` on the wire. Clean. ✅

**`relay-type-guards.ts` — `toCapturePayload`**

Added `tabId: readOptionalNumber(payload, "tabId")` using the existing `readOptionalNumber` helper. Consistent with the existing guard style. ✅

**`relay-forwarder.ts` — `requestContentScriptEnvelope`**

Signature extended to accept `tabId?: number`. Uses `tabId ?? (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id` — explicit nullish coalescing, no implicit active-tab assumption when a caller provides a target. Clean. ✅

**`relay-capture-handler.ts` — tab-swap logic**

`executeCaptureRegion` now:
1. Queries the current active tab ID before capture.
2. If `targetTabId !== activeTabId`, calls `chrome.tabs.update(targetTabId, { active: true })` and sets `swapped = true`.
3. Performs the capture.
4. Restores the original active tab (`chrome.tabs.update(savedActiveTabId, { active: true })`) before the envelope request — this ensures the restore happens even if the capture step fails (restore is in the `finally` block of the swap logic). ✅

`resolvePaddedBounds`, `buildCaptureSuccess`, `retryCaptureAtReducedQuality` all accept and thread `targetTabId?: number` correctly.

### Modularity observations (pre-existing, not introduced by this batch)

- `diff-tool.ts` (391 lines) and `relay-capture-handler.ts` (343 lines) exceed the 200-line file threshold from `coding-guidelines.md`. This batch added ~15 lines to each file. The overage is pre-existing and should be addressed in a dedicated refactor.
- `handleDiffSnapshots` function (~50 non-blank/non-comment lines) slightly exceeds the ~40-line function guideline. Pre-existing. The increase from this batch is minimal (3–4 lines).

Neither observation is a blocker for this batch.

---

## 8. Summary

| Check | Result |
|---|---|
| Tests: 13 new tests pass, zero new failures | ✅ PASS |
| TypeScript: zero errors (`tsc --noEmit`) on both packages | ✅ PASS |
| Banned patterns: none found in changed production files | ✅ PASS |
| Type safety: all casts guarded or in type guard context | ✅ PASS |
| Architectural constraints: no vscode imports, no handler serialization | ✅ PASS |
| Requirement coverage: all B2-CTX-001..005 requirements tested | ✅ PASS |
| Pre-existing failures: unchanged (14 browser-extension, 6 browser) | ✅ PASS (out of scope) |

**All Phase D2 checklist items pass. Phase D3 (testing guide) and Phase E (commit) are unblocked.**
