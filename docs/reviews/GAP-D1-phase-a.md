# GAP-D1 Phase A Review — Spatial Relations Design

**Date:** 2026-04-05  
**Module:** GAP-D1 — Geometry helpers, viewport ratios, container grouping  
**Phase:** A (design + stubs)  
**Reviewer:** Architect agent

---

## Scope

Design and create compilable stubs for three components that move the M110-TC Layout/Geometry score from D: 2→4:

| Checklist Item | Status Before | Component |
|---|---|---|
| D2: Relative geometry helpers | ❌ Missing | New `spatial-helpers.ts` + `get_spatial_relations` tool |
| D4: Viewport intersection ratios | ❌ Missing | `PageNode.viewportRatio` enrichment |
| D5: Container / semantic-group membership | ❌ Missing | `PageNode.containerId` enrichment |

---

## Files Created

| File | Package | Purpose |
|---|---|---|
| `content/spatial-helpers.ts` | browser-extension | 8 stub functions: leftOf, above, contains, overlap, distance, viewportIntersectionRatio, computeSpatialRelations, findNearestContainer |
| `content/spatial-relations-handler.ts` | browser-extension | Content script handler for `get_spatial_relations` relay action |
| `spatial-relations-tool.ts` | browser | MCP tool definition + handler following `semantic-graph-tool.ts` pattern |

## Files Modified

| File | Package | Change |
|---|---|---|
| `types.ts` | browser | Added `"get_spatial_relations"` to `BrowserRelayAction` union |
| `page-tool-types.ts` | browser | Added `GetSpatialRelationsArgs`, `SpatialRelationsResponse`, `SPATIAL_RELATIONS_TIMEOUT_MS` |
| `page-tool-handlers.ts` | browser | Re-exported new types and timeout constant |
| `extension.ts` | browser | Imported and registered `buildSpatialRelationsTool` |
| `message-handlers.ts` | browser-extension | Added `get_spatial_relations` action dispatch |
| `page-map-collector.ts` | browser-extension | Added `viewportRatio` and `containerId` fields to `PageNode` |
| `architecture.md` | docs | Added §14.12 Spatial Relations |
| `decisions.md` | docs | Added DEC-025 (tool vs enrichment split) and DEC-026 (container resolution) |

---

## Design Verification

### Requirement → Interface Mapping

| Requirement | Interface Element | Verified |
|---|---|---|
| D2: leftOf | `leftOf(a: Rect, b: Rect): boolean` | ✅ |
| D2: above | `above(a: Rect, b: Rect): boolean` | ✅ |
| D2: contains | `contains(outer: Rect, inner: Rect): boolean` | ✅ |
| D2: overlap | `overlap(a: Rect, b: Rect): number` (IoU) | ✅ |
| D2: distance | `distance(a: Rect, b: Rect): number` (center-to-center) | ✅ |
| D2: MCP tool | `browser_get_spatial_relations` tool with `nodeIds` input | ✅ |
| D4: viewport ratio | `viewportIntersectionRatio(rect, viewport): number` + `PageNode.viewportRatio` | ✅ |
| D5: container grouping | `findNearestContainer(element): Element` + `PageNode.containerId` | ✅ |

### Architecture Coherence

- [x] Follows existing tool builder pattern (`semantic-graph-tool.ts`)
- [x] Uses `BrowserRelayAction` union type for relay dispatch
- [x] Uses `SnapshotEnvelopeFields` for response contract
- [x] Uses security config (origin policy, audit log) for access control
- [x] Dynamic import in message-handlers.ts (consistent with existing actions)
- [x] Node IDs scoped to per-call page map snapshots (consistent with existing ID semantics)
- [x] No new dependencies introduced
- [x] All stubs throw `new Error("not implemented")` — compilable but not functional

### Compilation

- [x] `packages/browser` — `tsc --noEmit` passes (0 errors)
- [x] `packages/browser-extension` — `tsc --noEmit` passes (0 errors)
- [x] `packages/browser-extension` — 955/955 tests pass
- [x] `packages/browser` — 662/663 tests pass (1 pre-existing port collision failure)

### Performance Considerations

1. **O(n²) pairwise cap** — MAX_SPATIAL_NODE_IDS = 50 → 1,225 pairs max. Each pair is 6 arithmetic ops. Bounded to < 5ms.
2. **Page map enrichment is O(n)** — viewportRatio is a simple rect intersection (4 comparisons). containerId walks ancestors (typically < 10 levels).
3. **No extra DOM reads** — spatial-helpers geometry functions operate on cached bounding boxes. Only `findNearestContainer()` reads the DOM (during page map traversal, which already reads the DOM).

---

## Risks & Open Questions

1. **Node ID scope** — `get_spatial_relations` uses node IDs from the most recent `get_page_map` call. If the page mutates between calls, node IDs may be stale. This is consistent with existing behavior (same risk for `inspect_element` with `nodeId`).
2. **`viewportRatio` for fixed/sticky elements** — `getBoundingClientRect()` returns viewport-relative coordinates, so fixed elements will correctly report high viewport ratios regardless of scroll position. No special handling needed.
3. **Container depth for deeply nested pages** — `findNearestContainer()` walks up the ancestor chain. For deeply nested DOMs (e.g., 50+ levels), this could be slow per node. In practice, semantic containers are typically within 5-10 levels of any element.
