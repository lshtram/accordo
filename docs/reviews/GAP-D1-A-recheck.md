# Review — GAP-D1 — Phase A Re-check (After 3 Fixes)

**Date:** 2026-04-05  
**Module:** GAP-D1 — Geometry helpers, viewport ratios, container grouping  
**Reviewer:** Reviewer agent  
**Prior verdict:** CONDITIONAL PASS (3 issues required — see `GAP-D1-A.md`)  
**Re-check verdict:** ✅ PASS — all 3 issues resolved correctly

---

## Re-check scope

The original review (`GAP-D1-A.md`) identified three issues:

1. **BLOCKER:** Page map enrichment wired — `viewportIntersectionRatio()` and `findNearestContainer()` were never called in `buildPassedNode()`
2. **SIGNIFICANT:** `containerId` resolution required an element→nodeId reverse lookup that did not exist
3. **MINOR:** Duplicate type definitions across `spatial-relations-tool.ts` and `page-tool-types.ts`

All three fixes were applied. Each is reviewed below.

---

## Fix 1 — Page Map Enrichment Wired

**File:** `packages/browser-extension/src/content/page-map-traversal.ts`

### What was required
Inside `buildPassedNode()`, inside the `if (opts.includeBounds)` block: import and call `viewportIntersectionRatio()` to populate `node.viewportRatio`, and import and call `findNearestContainer()` to start the `containerId` resolution chain.

### What was delivered

**Line 20** — both helpers are now imported:
```typescript
import { viewportIntersectionRatio, findNearestContainer } from "./spatial-helpers.js";
```

**Lines 171–196** — inside `if (opts.includeBounds)`:
```typescript
// GAP-D1 / D4: Viewport intersection ratio
const viewport = {
  width: window.innerWidth || document.documentElement.clientWidth,
  height: window.innerHeight || document.documentElement.clientHeight,
  scrollX: window.scrollX,
  scrollY: window.scrollY,
};
node.viewportRatio = viewportIntersectionRatio(node.bounds, viewport);

// GAP-D1 / D5: Nearest semantic container (resolved to nodeId)
const containerEl = findNearestContainer(element);
if (containerEl !== null) {
  const containerNodeId = getNodeIdByElement(containerEl);
  if (containerNodeId !== undefined) {
    node.containerId = containerNodeId;
  }
}
```

### Assessment

✅ **Correct and complete.** The call-sites are inside the `if (opts.includeBounds)` gate, which is the correct condition. The `viewport` object is constructed from `window.inner*` with `document.documentElement.*` fallback — consistent with `isInViewport()` above it. Both stubs return safe defaults (`viewportIntersectionRatio` returns `0`, `findNearestContainer` returns `null`), so no exceptions are thrown during page map collection before Phase C implements them.

One note: the original review suggested using `node.bounds` as the rect argument (re-using the already-computed rect). The fix computes the viewport info and passes `node.bounds` correctly (`node.bounds` was just set two lines above), so the `Rect` shape matches `ViewportInfo` expectations. ✅

**VERDICT: PASS**

---

## Fix 2 — Element→NodeId Reverse Lookup

**File:** `packages/browser-extension/src/content/page-map-traversal.ts`

### What was required
A `Map<Element, number>` reverse lookup populated in lock-step with `refIndex`, plus an exported `getNodeIdByElement()` accessor.

### What was delivered

**Line 31** — module-level map declared:
```typescript
let elementToNodeId: Map<Element, number> = new Map();
```

**Lines 42–44** — exported O(1) accessor:
```typescript
export function getNodeIdByElement(element: Element): number | undefined {
  return elementToNodeId.get(element);
}
```

**Lines 48–50** — `clearRefIndex()` resets both maps atomically:
```typescript
export function clearRefIndex(): void {
  refIndex = new Map();
  elementToNodeId = new Map();
}
```

**Lines 133–137** — populated in `buildPassedNode()` **before** any children are recursed, so container ancestors are always in the map before their descendants try to look them up:
```typescript
const ref = `ref-${refCounter.count}`;
const nodeId = refCounter.count;
refCounter.count++;
refIndex.set(ref, element);
elementToNodeId.set(element, nodeId);
```

### Assessment

✅ **Correct and complete.** The ordering is critical and it is right: `elementToNodeId` is populated at the top of `buildPassedNode()` (line 137), before children are recursed (lines 199–208). This means when a child calls `findNearestContainer()` and gets a container ancestor, that ancestor's nodeId is already in `elementToNodeId`. The lookup is O(1) as required.

The `clearRefIndex()` reset is atomic — both maps reset together, preventing stale entries from a prior page map collection corrupting the current one. ✅

**VERDICT: PASS**

---

## Fix 3 — Type Deduplication

**Files:** `packages/browser/src/spatial-relations-tool.ts` and `packages/browser/src/page-tool-types.ts`

### What was required
Remove duplicate definitions of `GetSpatialRelationsArgs`, `SpatialRelationsResponse`, `SPATIAL_RELATIONS_TIMEOUT_MS`, and `classifyRelayError` from `spatial-relations-tool.ts` and import them from `page-tool-types.ts`. Add `SpatialError = "too-many-nodes" | "no-bounds"` to `BrowserToolErrorCode`.

### What was delivered

**`spatial-relations-tool.ts` lines 27–34** — now imports from `page-tool-types.ts`:
```typescript
import {
  buildStructuredError,
  classifyRelayError,
  SPATIAL_RELATIONS_TIMEOUT_MS,
  type GetSpatialRelationsArgs,
  type SpatialRelationsResponse,
  type PageToolError,
} from "./page-tool-types.js";
```

**`page-tool-types.ts` lines 375–381** — `SpatialError` added and unioned:
```typescript
export type SpatialError =
  | "too-many-nodes"
  | "no-bounds";

export type BrowserToolErrorCode = CaptureError | RelayError | SecurityError | SpatialError;
```

**`page-tool-handlers.ts` line 5** — `SpatialError` is re-exported to consumers (already present).

### Residual item — `SpatialRelationsToolError.error` inline union

`SpatialRelationsToolError` (lines 69–72 of `spatial-relations-tool.ts`) still uses an inline string-literal union for its `error` field:

```typescript
export interface SpatialRelationsToolError {
  success: false;
  error: "browser-not-connected" | "timeout" | "action-failed" | "origin-blocked" | "too-many-nodes" | "no-bounds";
}
```

This is not derived from `BrowserToolErrorCode`. However, this is an **internal** type used only for cast targets within `spatial-relations-tool.ts` (6 sites, all `as SpatialRelationsToolError`). The canonical error codes returned over the wire come from `buildStructuredError()` which accepts `string`, and the actual error strings used at each call-site (`"browser-not-connected"`, `"timeout"`, `"action-failed"`, `"origin-blocked"`, `"too-many-nodes"`) are all members of the now-complete `BrowserToolErrorCode`. 

The inline union in `SpatialRelationsToolError.error` is a minor redundancy but does not create the divergence risk that was the original concern (two separate `SpatialRelationsResponse` definitions). The original Issue 3 was about the four duplicated types — all four are now consolidated. The `SpatialRelationsToolError` was not one of them. This residual is acceptable.

Also noted: `SpatialRelation` (lines 46–63) is still locally defined in `spatial-relations-tool.ts`. This is also not a duplicate — `spatial-helpers.ts` defines a `SpatialRelation` in the browser-extension package (content script), while this one is in the browser package (MCP tool). They serve different compilation units and cannot be shared across packages. ✅

### Assessment

✅ **All four originally-duplicated symbols are consolidated.** The `SpatialError` union is correctly added to `BrowserToolErrorCode`. The residual `SpatialRelationsToolError.error` inline is a pre-existing minor issue, not introduced by the fixes, and does not affect correctness.

**VERDICT: PASS**

---

## Build and Test Verification

| Check | Result |
|-------|--------|
| `packages/browser-extension` — `tsc --noEmit` | ✅ 0 errors |
| `packages/browser` — `tsc --noEmit` | ✅ 0 errors |
| `packages/browser-extension` — `pnpm test` | ✅ 955/955 pass |
| `packages/browser` — `pnpm test` | ✅ 662/663 pass — 1 pre-existing failure (`BR-F-123` port collision in `extension-activation.test.ts`, confirmed pre-existing from baseline: same test was failing before the GAP-D1 changes were stashed) |

---

## Overall Verdict

| Fix | Status |
|-----|--------|
| Fix 1: Page map enrichment wired | ✅ PASS |
| Fix 2: Element→nodeId reverse lookup | ✅ PASS |
| Fix 3: Type deduplication | ✅ PASS |

**OVERALL: ✅ PASS**

All three issues from the original Phase A review are resolved. The stubs are correctly wired, safe to call (return zero/null), and the data structures are in place for Phase C to implement. Phase B can proceed.
