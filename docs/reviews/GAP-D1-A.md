# Review — GAP-D1 — Phase A (Design + Stubs)

**Date:** 2026-04-05  
**Module:** GAP-D1 — Geometry helpers, viewport ratios, container grouping  
**Reviewer:** Reviewer agent  
**Verdict:** CONDITIONAL PASS — 3 issues must be fixed before Phase B begins

---

## Summary

The overall design is sound. The hybrid approach (O(n) page-map enrichment + O(n²) opt-in pairwise tool) is well-reasoned, the function signatures are correct and implementable, types compile cleanly, and the architectural decisions are documented. However, three issues were found that must be addressed before the test-builder writes tests, because they would cause Phase B tests to exercise the wrong contracts.

---

## PASS Items

### ✅ Compilation
- `packages/browser`: `tsc --noEmit` — 0 errors  
- `packages/browser-extension`: `tsc --noEmit` — 0 errors  
- `packages/browser-extension` tests: 955/955 pass  
- `packages/browser` tests: 662/663 pass — 1 pre-existing port-collision failure (`BR-F-123`) unrelated to GAP-D1

### ✅ Requirement → interface mapping
All D2/D4/D5 checklist items are covered:

| Checklist | Function / Field |
|-----------|-----------------|
| D2: leftOf | `leftOf(a, b): boolean` — center-x comparison, clear spec |
| D2: above | `above(a, b): boolean` — center-y comparison, clear spec |
| D2: contains | `contains(outer, inner): boolean` — 4-edge containment, clear spec |
| D2: overlap | `overlap(a, b): number` — IoU algorithm fully documented |
| D2: distance | `distance(a, b): number` — center-to-center Euclidean, clear spec |
| D2: MCP tool | `browser_get_spatial_relations` — correct shape, registered in extension.ts |
| D4: viewport ratio | `viewportIntersectionRatio(rect, viewport): number` — algorithm documented |
| D4: enrichment | `PageNode.viewportRatio?: number` — field declared |
| D5: container | `findNearestContainer(element): Element \| null` — tag + role dual match |
| D5: enrichment | `PageNode.containerId?: number` — field declared |

### ✅ API design (hybrid approach)
The split between O(n) enrichment on `get_page_map` (2 scalar fields per node) and O(n²) pairwise via a separate tool with a 50-node cap is architecturally sound. The performance analysis in the review document is correct. DEC-025 and DEC-026 are properly recorded.

### ✅ Pure-function design for spatial-helpers
The geometry functions operate exclusively on `Rect` / `ViewportInfo` structs — no DOM coupling. Only `findNearestContainer()` touches the DOM, and that is explicitly documented. This makes the geometry layer independently unit-testable.

### ✅ Architecture coherence
- Tool follows the `semantic-graph-tool.ts` factory pattern
- `BrowserRelayAction` union extended with `"get_spatial_relations"`
- `SnapshotEnvelopeFields` used in response (snapshot correlation)
- Security middleware applied (origin policy check, audit log)
- Dynamic import in `message-handlers.ts` (line 89) — consistent with all other actions
- Tool registered in `extension.ts` (line 310) and included in `allBrowserTools` (line 312)
- `architecture.md §14.12` updated
- `decisions.md` DEC-025 and DEC-026 added

### ✅ Stub shape
All 8 stubs in `spatial-helpers.ts` throw `new Error("not implemented")` and have complete, correct signatures. The handler stub (`spatial-relations-handler.ts`) has a correct signature and the right doc comment describing the expected implementation steps.

### ✅ NodeId→Element resolution
The handler imports `getElementByRef` from `page-map-traversal.ts`. The existing pattern for resolving nodeId→element is `getElementByRef("ref-" + nodeId)` — already used in `element-inspector.ts` (line 317). The doc comment in the handler correctly says "resolves each nodeId to a DOM element via the page map's ref index." The implementation path is clear and unblocked.

### ✅ SEMANTIC_CONTAINER_TAGS includes `nav`/`header`/`footer`/`form`
The architecture doc says containers are `article/section/aside/dialog/[role=dialog]/details/main`. The actual constant in `spatial-helpers.ts` (lines 86–96) expands this to 10 tags including `nav`, `header`, `footer`, `form`. DEC-026 documents the expansion rationale (SPA role-based markup). This is an improvement over the original spec description.

---

## FAIL — Must Fix Before Phase B

### Issue 1 (CRITICAL): Page map enrichment is declared but never wired

**Files:** `packages/browser-extension/src/content/page-map-traversal.ts` and `page-map-collector.ts`  
**Severity:** Blocker — Phase B tests for D4/D5 would exercise a no-op

`PageNode.viewportRatio` and `PageNode.containerId` are declared in the type (lines 49, 55 of `page-map-collector.ts`) but **neither `viewportIntersectionRatio()` nor `findNearestContainer()` is imported or called in `page-map-traversal.ts` or `page-map-collector.ts`**. The fields will always be `undefined`, even after the geometry functions are implemented.

The wiring must be added to `buildPassedNode()` in `page-map-traversal.ts`:
```typescript
// After the existing `if (opts.includeBounds)` block that sets node.bounds:
if (opts.includeBounds) {
  const rect = element.getBoundingClientRect();
  node.bounds = { x: ..., y: ..., width: ..., height: ... };
  
  // GAP-D1/D4 — add this:
  const viewport: ViewportInfo = {
    width: window.innerWidth,
    height: window.innerHeight,
    scrollX: window.scrollX,
    scrollY: window.scrollY,
  };
  node.viewportRatio = viewportIntersectionRatio(rect, viewport);
  
  // GAP-D1/D5 — add this:
  const container = findNearestContainer(element);
  if (container !== null) {
    // container.nodeId: the ref index uses "ref-{nodeId}" so we need
    // to find the container's nodeId — this requires a reverse lookup
    // or a pre-built element→nodeId map (see Issue 2 below).
  }
}
```

This is a Phase A stub omission. The type shape is correct but the call-site was never added.

**Fix:** Add the import and call-site in `page-map-traversal.ts` as a stub (`// not implemented` comment with the correct shape), so Phase B test expectations align with the real wiring path.

---

### Issue 2 (SIGNIFICANT): `containerId` resolution requires an element→nodeId reverse lookup that doesn't exist yet

**File:** `packages/browser-extension/src/content/page-map-traversal.ts`  
**Severity:** Design gap — the implementation path is unclear

`containerId` must be the **nodeId** (integer) of the nearest container ancestor. But `findNearestContainer()` returns an `Element`. To turn that `Element` into a `nodeId`, the caller needs to know what nodeId that element was assigned.

The current `refIndex` in `page-map-traversal.ts` is a `Map<string, Element>` (ref → element), which only supports lookup by ref string, not reverse lookup of element → nodeId.

Two resolution strategies exist:
- **Strategy A:** Build a parallel `Map<Element, number>` (element → nodeId) during traversal. This reverse map is populated as each element is added to `refIndex`.
- **Strategy B:** Use `Array.from(refIndex.entries()).find(...)` — O(n) per node, making containerId resolution O(n²) overall. Unacceptable for large pages.

**Strategy A is correct.** The design document does not mention this reverse-lookup requirement. It must be addressed before Phase B, either:
- By adding a `elementToNodeId: Map<Element, number>` module-level variable to `page-map-traversal.ts` (mirroring `refIndex`), populated in `buildPassedNode`, or
- By documenting in the stub that the implementation must build this map.

Without this, `containerId` either cannot be filled in or requires an O(n²) scan.

---

### Issue 3 (MINOR): Duplicate type definitions across `spatial-relations-tool.ts` and `page-tool-types.ts`

**Files:** `packages/browser/src/spatial-relations-tool.ts` and `packages/browser/src/page-tool-types.ts`  
**Severity:** Code quality / maintainability — not a blocker but will cause divergence

The following are defined in **both** files:

| Symbol | `page-tool-types.ts` | `spatial-relations-tool.ts` |
|--------|---------------------|---------------------------|
| `GetSpatialRelationsArgs` | lines 309–321 | lines 45–59 |
| `SpatialRelationsResponse` | lines 327–343 | lines 89–102 |
| `SPATIAL_RELATIONS_TIMEOUT_MS` | line 346 | line 35 |
| `classifyRelayError()` | lines 400–408 | lines 243–251 (private re-impl) |

Additionally, `SpatialRelationsToolError.error` union contains `"too-many-nodes"` and `"no-bounds"` which are not present in the canonical `BrowserToolErrorCode` type in `page-tool-types.ts`.

**Consequence:** If the types diverge during Phase C (e.g. someone adds a field to `SpatialRelationsResponse` in one place but not the other), there is no compiler error because both are separate declarations. `page-tool-handlers.ts` re-exports from `page-tool-types.ts`, meaning consumers get the `page-tool-types.ts` version — the `spatial-relations-tool.ts` versions are only used internally.

**Fix:** `spatial-relations-tool.ts` should import `GetSpatialRelationsArgs`, `SpatialRelationsResponse`, `SPATIAL_RELATIONS_TIMEOUT_MS`, and `classifyRelayError` from `page-tool-types.ts` and remove its own copies. The two `SpatialRelationsResponse` definitions are currently identical, so this is a refactor with no behaviour change.

---

## Edge Cases Noted (Non-blocking for Phase A)

These are valid risks but do not block Phase B test writing. They should be addressed during Phase C implementation.

1. **Zero-area elements**: `overlap()` with both rects of zero area: IoU = 0/0. The doc comment says "Return 0 when unionArea is 0" — this is correct and handles it. `viewportIntersectionRatio()` similarly: "Return 0 when elementArea is 0" — correct.

2. **Negative-dimension rects**: `getBoundingClientRect()` never returns negative width/height. Stubs don't need to guard this. But the `overlap()` algorithm should document that it assumes non-negative dimensions.

3. **`containerId` for container elements themselves**: If a `<section>` is itself in the page map, should its `containerId` point to its nearest container ancestor (another section, article, etc.)? The design says "nearest ancestor" — so yes, a container's `containerId` is its parent container (or undefined if it IS the outermost). This is correct behavior and should be tested.

4. **`findNearestContainer` during page map traversal vs. at query time**: The design correctly places this call during traversal (when elements are already being read), not at `get_spatial_relations` query time. This is the right choice.

5. **`computeSpatialRelations` signature**: The Phase A description mentioned `(nodes: SpatialNode[], relations: string[])` but the actual stub uses `ReadonlyMap<number, Rect>`. The stub's signature is **better** — it's more type-safe and directly maps nodeId to Rect. This is an improvement over the initial description, not a problem.

---

## Required Actions Before Phase B

| # | Severity | File | Action |
|---|----------|------|--------|
| 1 | BLOCKER | `page-map-traversal.ts` | Add the wiring call-sites (as stubs/comments) for `viewportIntersectionRatio()` and `findNearestContainer()` inside `buildPassedNode()`, gated on `opts.includeBounds` |
| 2 | SIGNIFICANT | `page-map-traversal.ts` | Declare a `elementToNodeId: Map<Element, number>` reverse-lookup map (populated alongside `refIndex`) so `containerId` can be filled in with an O(1) lookup |
| 3 | MINOR | `spatial-relations-tool.ts` | Remove duplicate type definitions (`GetSpatialRelationsArgs`, `SpatialRelationsResponse`, `SPATIAL_RELATIONS_TIMEOUT_MS`, `classifyRelayError`) and import them from `page-tool-types.ts` instead |

Issues 1 and 2 must be fixed before Phase B begins; they affect what the tests should assert. Issue 3 can be deferred to Phase C but should not grow further.

---

**Overall verdict: CONDITIONAL PASS**  
Design direction and API shape are correct. Three concrete fixups needed, two of which directly affect the correctness of the enrichment path. Once the wiring call-sites and reverse-lookup map are in place (even as stubs), Phase B can proceed.
