# Diagram Flowchart Fidelity — Batch 2 Design Note

**Date:** 2026-04-09  
**Module:** `diagram-flowchart-fidelity-batch2`  
**Requirements:** `docs/20-requirements/requirements-diagram-fidelity.md` (FC-06 through FC-09)  
**Architecture reference:** `docs/10-architecture/diagram-architecture.md` (v4.2)  
**Status:** Phase A — design + stubs

---

## 1. Summary

Four user-validated defect groups in flowchart edge routing and subgraph rendering
need targeted fixes across the edge-router, canvas-generator, and auto-layout layers.
Unlike Batch 1 (which was parser/shape-level), Batch 2 operates on the geometry and
layout pipeline — changes are more structurally coupled but remain within the existing
`parser → layout → canvas-generator → edge-router → scene-adapter` pipeline.

| Defect Group | Root Cause | Fix Location | Risk |
|---|---|---|---|
| FC-06: Curved edges render as straight | `"curved"` aliased to `"auto"` (2-point path); no Bézier control points produced | `edge-router.ts` — new `routeCurved()` | MEDIUM — new routing mode |
| FC-07: Direction-unaware edge attachment | Edge router always uses centre-to-centre geometry regardless of flow direction | `canvas-generator.ts` + `edge-router.ts` | MEDIUM — direction must thread through |
| FC-08: Subgraph-targeted edges dropped | `auto-layout.ts` skips edges where from/to is a cluster ID (line 362) | `auto-layout.ts` + `canvas-generator.ts` | HIGH — requires cluster anchor node concept |
| FC-09: Edge attachment points imprecise | `clampToBorder()` uses ray-from-centre without direction bias | `edge-router.ts` — direction-biased attachment | MEDIUM — coupled with FC-07 |

**New file:** None.  
**New exported function:** `routeCurved()` in `edge-router.ts` (stub only — Phase A).  
**Architecture impact:** None — all changes within existing component boundaries.

---

## 2. Detailed Design Per Defect Group

### 2.1 FC-06: Curved Edges Render as Straight (Cases 28, 48, 49)

**Root cause analysis:**

In `edge-router.ts` line 263, `"curved"` is aliased directly to `"auto"`:

```typescript
const mode: EdgeRouting =
  routing === "curved" ? "auto"      // ← alias, no curved geometry
  : routing === "orthogonal" || routing === "direct" ? routing
  : "auto";
```

The `routeAuto()` function (line 132) produces exactly **2 points** (source
centre-edge, target centre-edge) with bindings. Excalidraw renders these 2-point
arrows as straight lines with optional binding-based curve — but the visual
result does not match Mermaid's curved spline rendering.

Mermaid renders edges as Bézier splines (typically cubic) that visually arc
between nodes. To match this, we need to produce intermediate control points
that create a visible curve in Excalidraw's point-based arrow path.

**Fix approach:**

1. **Add a `routeCurved()` function** in `edge-router.ts` that computes a
   3-point path: `[start, controlPoint, end]` where:
   - `start` = clamped exit point on source boundary
   - `controlPoint` = offset perpendicular to the source→target midline
   - `end` = clamped entry point on target boundary
   
   The offset amount is proportional to the edge length (e.g. 20-30% of the
   straight-line distance). The perpendicular direction should alternate for
   parallel edges to avoid overlap.

2. **Remove the `"curved" → "auto"` alias** in the mode normalisation switch
   and add `case "curved": return routeCurved(...)`.

3. **In `canvas-generator.ts`**, default flowchart edge routing to `"curved"`
   instead of `"auto"` when no explicit routing is specified and the obstacle
   check does not upgrade to `"orthogonal"`. This applies only to flowcharts
   (not ER diagrams or class diagrams which have their own conventions).

4. **Bindings:** `routeCurved()` should return non-null bindings (like `routeAuto()`)
   so Excalidraw maintains the arrow↔shape connection. The 3+ point path with
   bindings produces a visually curved arrow that snaps to element boundaries.

**Files changed:**
- `packages/diagram/src/canvas/edge-router.ts` — new `routeCurved()`, updated switch
- `packages/diagram/src/canvas/canvas-generator.ts` — default routing for flowcharts

**Test strategy:**
- Unit: `routeCurved()` returns ≥ 3 points with non-null bindings
- Unit: control point is offset from the straight-line midpoint
- Integration: flowchart edge produces a curved path (point count > 2)

---

### 2.2 FC-07: Direction-Unaware Edge Attachment (Case 33)

**Root cause analysis:**

The parser correctly extracts direction (`TD`/`LR`/`RL`/`BT`) and auto-layout
correctly maps it to dagre's `rankdir`. However, the **edge routing pipeline is
entirely direction-agnostic**:

1. `canvas-generator.ts` line 886 defaults routing to `"auto"` — no direction considered
2. `routeEdge()` in `edge-router.ts` receives only `routing`, `waypoints`, `source`,
   `target` — **not the diagram direction**
3. `clampToBorder()` computes the exit point by ray-casting from centre toward the
   other node's centre — it does not know whether the diagram flows top-down or
   left-right

In an `RL` (right-to-left) diagram, edges should visually exit the **left** side
of the source node and enter the **right** side of the target node. But
centre-to-centre ray casting may produce an exit on any side depending on
relative node positions.

**Fix approach:**

1. **Thread `direction` through the edge pipeline.** Add an optional `direction`
   parameter to `routeEdge()`:
   ```typescript
   export function routeEdge(
     routing: EdgeRouting,
     waypoints: ...,
     source: BoundingBox,
     target: BoundingBox,
     direction?: "TD" | "LR" | "RL" | "BT"    // NEW
   ): RouteResult
   ```

2. **Direction-biased attachment points.** When `direction` is provided, the
   exit face of the source and entry face of the target should be biased:
   - `TD`: source exits bottom, target enters top
   - `LR`: source exits right, target enters left
   - `RL`: source exits left, target enters right
   - `BT`: source exits top, target enters bottom
   
   The bias is a "preference" — if the target is not in the expected direction
   (e.g. back-edge in TD), fall back to centre-to-centre.

3. **Pass `parsed.direction` from `canvas-generator.ts`** to each `routeEdge()`
   call (line 900).

**Files changed:**
- `packages/diagram/src/canvas/edge-router.ts` — add `direction` param, biased attachment
- `packages/diagram/src/canvas/canvas-generator.ts` — pass `parsed.direction` to `routeEdge()`

**Test strategy:**
- Unit: TD diagram edge exits source bottom, enters target top
- Unit: RL diagram edge exits source left, enters target right
- Unit: back-edge (target above source in TD) falls back to centre-to-centre
- Integration: case 33 Mermaid source produces visually correct direction

---

### 2.3 FC-08: Subgraph-Targeted Edges Dropped (Cases 35, 36)

**Root cause analysis:**

In `auto-layout.ts` lines 361-364:

```typescript
for (const edge of parsed.edges) {
  if (clusterIds.has(edge.from) || clusterIds.has(edge.to)) {
    continue;   // ← edges targeting clusters are SKIPPED entirely
  }
```

This means any edge declared as `A --> subgraph_id` in Mermaid is silently
dropped from the layout output. The canvas generator then finds no layout data
for these edges and skips them (line 878: `if (fromLayout === undefined || toLayout === undefined) continue`).

The state diagram code (auto-layout.ts lines 386+) has a partial pattern for
handling cluster references — it creates anchor nodes for composite states. But
the flowchart path has **no equivalent** cluster anchor logic.

**Fix approach:**

1. **Cluster anchor nodes for flowcharts.** When an edge references a cluster ID,
   resolve it to an **anchor point** within the cluster:
   - If the cluster has an explicit "entry" or "exit" node (Mermaid convention),
     redirect the edge to that node.
   - Otherwise, use the cluster bounding box centre as a synthetic anchor point.

2. **In `auto-layout.ts`**, instead of skipping cluster-targeted edges, emit
   a layout entry that maps to the cluster's bounding box. This requires the
   cluster layout to be computed first (which it already is in the code — clusters
   are computed at lines 373-384, before the edge skip at line 361 which is actually
   in a loop that runs earlier). So we need to **reorder**: compute cluster boxes
   first, then process edges with cluster resolution.

3. **In `canvas-generator.ts`**, the edge rendering loop already resolves
   `fromLayout` and `toLayout` from `resolvedLayout.nodes`. For cluster-targeted
   edges, we need to also check `resolvedLayout.clusters` and synthesize a
   "virtual" node layout from the cluster bounding box.

**Files changed:**
- `packages/diagram/src/layout/auto-layout.ts` — cluster-targeted edge resolution
- `packages/diagram/src/canvas/canvas-generator.ts` — fallback to cluster layout for edge endpoints

**Test strategy:**
- Unit: edge `A --> subgraph_B` produces layout entry (not skipped)
- Unit: cluster-targeted edge resolves to cluster bounding box centre
- Integration: cases 35/36 render edges connecting to subgraphs

**Risk: HIGH** — This is the most structurally involved change. The reordering
of cluster computation vs edge collection requires careful testing to avoid
regressions in non-cluster diagrams.

---

### 2.4 FC-09: Edge Attachment Points Imprecise (Cases 48, 49)

**Root cause analysis:**

`clampToBorder()` in `edge-router.ts` (line 91) ray-casts from the node centre
outward toward the **other node's centre**. This produces the geometrically
correct exit point for a straight line, but:

1. For **non-rectangular shapes** (diamonds, hexagons, parallelograms), the ray
   hits the rectangular bounding box rather than the actual shape boundary. This
   places the attachment point in empty space outside the visible shape.

2. For **direction-constrained flow** (addressed partially by FC-07), the
   attachment should be on the expected face even when the geometry would
   produce a different result.

3. For **curved edges** (FC-06), the attachment point should account for the
   curve's initial tangent, not the straight-line direction to the target.

**Fix approach:**

1. **Direction-biased face selection** (shared implementation with FC-07): when
   the diagram direction is known, prefer attaching to the canonical exit/entry
   face. This is the same `direction` parameter added in FC-07.

2. **Shape-aware clamping (deferred to future batch):** Full shape-aware boundary
   clipping (e.g. diamond boundary is rotated square, not axis-aligned box) is
   desirable but complex. For Batch 2, we improve attachment via direction bias
   only. True shape-aware clipping is noted as future work.

3. **Curve tangent adjustment:** When `routeCurved()` is used, the exit point
   should be clamped toward the first control point (not toward the target
   centre), and the entry point clamped from the last control point. This
   produces a smoother visual curve start/end.

**Files changed:**
- `packages/diagram/src/canvas/edge-router.ts` — curve-tangent-aware clamping in `routeCurved()`
- (Direction bias changes are shared with FC-07, same files)

**Test strategy:**
- Unit: curved edge start point is clamped toward control point, not target centre
- Unit: curved edge end point is clamped from control point, not source centre
- Integration: cases 48/49 show visually improved attachment positions

---

## 3. Code Seam Summary

| File | Lines/Area | Change Type | Requirements |
|---|---|---|---|
| `packages/diagram/src/canvas/edge-router.ts` | `routeEdge()` switch, new `routeCurved()`, `clampToBorder()` curve variant | Modify + Add | FC-06, FC-07, FC-09 |
| `packages/diagram/src/canvas/canvas-generator.ts` | Edge section (874–992), cluster fallback for endpoints | Modify | FC-06, FC-07, FC-08 |
| `packages/diagram/src/layout/auto-layout.ts` | Edge collection (358–371), cluster-edge resolution | Modify | FC-08 |

**Files NOT changed:**
- `types.ts` — `EdgeLayout.routing` already includes `"curved"`; `ParsedDiagram.direction` already typed. No type additions needed.
- `scene-adapter.ts` — arrow element construction already passes through all point arrays and bindings correctly. No changes needed.
- `flowchart.ts` — parser is not involved in Batch 2 defects (edge routing is downstream of parsing).
- `decode-html.ts` — Batch 1 utility; not relevant to Batch 2.
- `shape-map.ts` — shape dimensions not involved.

---

## 4. Stubs

### 4.1 `routeCurved()` in `edge-router.ts`

A stub function is added to `edge-router.ts` with the correct signature, returning
a "not implemented" error. The `"curved" → "auto"` alias in the mode switch is NOT
yet removed (that would change production behaviour). The stub is called only by
tests during Phase B.

```typescript
/**
 * Compute a curved (Bézier-approximation) path between source and target.
 * Produces ≥ 3 points with a control point offset perpendicular to the midline.
 *
 * @param source    Bounding box of the source node.
 * @param target    Bounding box of the target node.
 * @param direction Optional diagram flow direction for biased attachment.
 * @returns         RouteResult with curved point path and bindings.
 *
 * @internal — FC-06, FC-09 (Batch 2)
 */
export function routeCurved(
  source: BoundingBox,
  target: BoundingBox,
  direction?: "TD" | "LR" | "RL" | "BT",
): RouteResult {
  void source; void target; void direction;
  throw new Error("routeCurved: not implemented (Batch 2 stub)");
}
```

### 4.2 No other new files or functions

All other Batch 2 changes are modifications to existing function signatures
(adding `direction` parameter) and logic changes within existing functions.
These do not need stubs — the existing functions remain functional during Phase A,
and the new parameter is optional with backwards-compatible default behaviour.

---

## 5. Dependency Graph (Implementation Order)

```
FC-07 (direction threading) ──┐
                               ├──→ FC-06 (curved routing) ──→ FC-09 (attachment precision)
FC-08 (subgraph edges)    ────┘
```

**Recommended implementation order:**
1. **FC-07** first — threads `direction` through the pipeline (prerequisite for FC-06 and FC-09)
2. **FC-08** second — independent of FC-06/FC-07 but may interact with edge routing for cluster endpoints
3. **FC-06** third — uses the `direction` parameter from FC-07
4. **FC-09** last — refinement on top of FC-06 and FC-07

---

## 6. Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| FC-06: Excalidraw may not render 3+ point arrows as smooth curves | MEDIUM | Visual still not curved | Test with real Excalidraw renderer; may need `roundness` property on arrow element |
| FC-07: Direction bias produces worse attachment for back-edges | MEDIUM | Back-edges look wrong | Fallback to centre-to-centre for edges that oppose the flow direction |
| FC-08: Cluster bounding box as anchor is imprecise | HIGH | Edges land on cluster border, not on a node | Allow edge to target the nearest member node as a secondary resolution strategy |
| FC-08: Reordering cluster computation may regress other diagrams | MEDIUM | Broken state/class/ER diagrams | Run full 568+ test suite after every FC-08 change |
| FC-09: Shape-aware clamping deferred — diamonds still imprecise | LOW | Known limitation | Document as future work; direction bias alone improves most cases |
| New `direction` param on `routeEdge()` breaks callers | LOW | Compile error | Parameter is optional with undefined default (backwards-compatible) |

---

## 7. Rollback Strategy

Each defect group is independently revertable:

- **FC-06:** Revert `routeCurved()` and restore `"curved" → "auto"` alias. One function + one switch case.
- **FC-07:** Remove `direction` parameter from `routeEdge()` and its call sites. Parameter is optional, so removing it is backwards-compatible.
- **FC-08:** Restore the `continue` statement for cluster-targeted edges in `auto-layout.ts`. Single line revert.
- **FC-09:** Revert curve-tangent clamping in `routeCurved()`. Contained within the new function.

All four can be rolled back independently without cross-contamination because
they touch different logic branches within the same files.

---

## 8. Architecture Impact

**None.** All changes are within the existing `parser → layout → canvas-generator → edge-router → scene-adapter` pipeline documented in `docs/10-architecture/diagram-architecture.md` §4–§9. No new components, no new package boundaries, no new external dependencies. The `routeCurved()` function is a new internal function within the existing `edge-router.ts` module — not a new module.

The `direction` parameter threading (FC-07) adds an optional parameter to `routeEdge()`'s public API but does not change the function's contract — existing callers that omit `direction` get identical behaviour to today.
