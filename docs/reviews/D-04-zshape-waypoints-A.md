# D-04 Phase A — Z-Shape Waypoint Routing for Orthogonal Edges

**Date:** 2026-04-03  
**Module:** diagram / canvas / edge-router  
**Phase:** A (architect)  
**Status:** Ready for review

---

## 1. Problem Statement

Currently, `routeOrthogonal()` in `edge-router.ts` (line 160–183) only uses the **first** waypoint as a bend hint, producing a fixed 4-point path: `[start, [wp1.x, sy], [wp1.x, wp1.y], end]`. If a user sets multiple waypoints (e.g., via `edgeStyles` or future drag interaction), waypoints beyond the first are silently ignored.

The goal is to support **full Z-shape routing**: an orthogonal edge with N waypoints should produce a proper axis-aligned polyline with N-1 direction changes, rendering as an H/V/H/V staircase pattern.

**Scope:** `flowchart` diagram type only (MVP). The algorithm is diagram-type-agnostic, but only flowchart edges are tested.

---

## 2. Requirements

| ID | Requirement | Test coverage |
|---|---|---|
| ER-16 | `routeOrthogonal` with 2 waypoints produces ≥ 5 points (Z-shape) | ER-16 |
| ER-17 | `routeOrthogonal` with 3 waypoints produces ≥ 6 points | ER-17 |
| ER-18 | All segments in the multi-waypoint path are axis-aligned (Δx=0 or Δy=0) | ER-18 |
| ER-19 | Multi-waypoint path starts at source centre and ends at target centre | ER-19 |
| ER-20 | Multi-waypoint path visits each waypoint in order (waypoints lie on the path) | ER-20 |
| ER-21 | Backward compatibility: 0-waypoint orthogonal routing unchanged (L-shape) | Existing ER-05, ER-06 |
| ER-22 | Backward compatibility: 1-waypoint orthogonal routing unchanged (bend hint) | Existing ER-07 |
| ER-23 | Multi-waypoint path with collinear consecutive waypoints produces no zero-length segments | ER-23 |
| ER-24 | Multi-waypoint orthogonal still returns `startBinding: null, endBinding: null` | ER-24 |

---

## 3. Interface Design

### 3.1 New function: `routeOrthogonalMultiWaypoint`

```typescript
/**
 * Route an orthogonal edge through N waypoints (N ≥ 2), producing a
 * Z-shape axis-aligned polyline.
 *
 * Algorithm: for each consecutive pair of points (including source→wp1
 * and wpN→target), emit an H-V or V-H segment pair. The direction
 * alternates based on the dominant axis between each pair.
 *
 * @param waypoints  2 or more intermediate waypoints (absolute canvas coords).
 * @param source     Bounding box of the source node.
 * @param target     Bounding box of the target node.
 * @returns          RouteResult with axis-aligned polyline and null bindings.
 *
 * @internal — called from routeOrthogonal when waypoints.length >= 2.
 */
function routeOrthogonalMultiWaypoint(
  waypoints: ReadonlyArray<{ readonly x: number; readonly y: number }>,
  source: BoundingBox,
  target: BoundingBox
): RouteResult;
```

**Visibility:** module-private (`function`, not `export`). Only `routeOrthogonal` calls it.

### 3.2 Dispatch change in `routeOrthogonal`

The existing `routeOrthogonal` function gains a three-way branch:

```
waypoints.length === 0  →  existing L-shape logic (unchanged)
waypoints.length === 1  →  existing bend-hint logic (unchanged)
waypoints.length >= 2   →  delegate to routeOrthogonalMultiWaypoint()
```

No signature change to `routeOrthogonal` or `routeEdge`. The public API is unchanged.

### 3.3 No type changes

- `EdgeLayout.waypoints` already supports `ReadonlyArray<{ readonly x: number; readonly y: number }>` — no schema change needed.
- `RouteResult` already supports variable-length `points[]` — no change needed.
- `EdgeRouting` already includes `"orthogonal"` — no change needed.

---

## 4. Algorithm Design

### 4.1 Staircase construction

Given source centre `S`, waypoints `[W1, W2, …, WN]`, and target centre `T`, the algorithm builds a path through all control points `[S, W1, W2, …, WN, T]`.

For each consecutive pair `(A, B)` in the control-point sequence:
1. If `A` and `B` share an x-coordinate (vertical alignment), emit a single vertical segment: `(A.x, A.y) → (B.x, B.y)`.
2. If `A` and `B` share a y-coordinate (horizontal alignment), emit a single horizontal segment: `(A.x, A.y) → (B.x, B.y)`.
3. Otherwise, emit an L-junction: `(A.x, A.y) → (B.x, A.y) → (B.x, B.y)` (horizontal-first).

This produces an axis-aligned polyline where every segment is purely horizontal or purely vertical. Adjacent duplicate points are removed to avoid zero-length segments.

### 4.2 Why horizontal-first for L-junctions

The horizontal-first strategy (`H-V`) is consistent with the existing 1-waypoint `routeOrthogonal` behaviour (line 171: `[bend.x, sy]` → horizontal move first). This gives visual consistency regardless of waypoint count.

### 4.3 Excalidraw representation

Excalidraw arrow elements already support N-point paths natively. The `points[]` array on an arrow element can have any number of `[x, y]` pairs (confirmed: Excalidraw PRs #338, #660, #8299). Our canvas-generator normalizes absolute→relative coordinates at render time (canvas-generator.ts lines 210–215). No changes needed in the canvas generator or Excalidraw layer.

---

## 5. Backward Compatibility

The dispatch logic explicitly preserves existing behaviour:

| Waypoint count | Before D-04 | After D-04 |
|---|---|---|
| 0 | L-shape (3 points) | **Unchanged** — same code path |
| 1 | Bend-hint (4 points) | **Unchanged** — same code path |
| ≥ 2 | First waypoint used, rest ignored | **New** — Z-shape polyline through all waypoints |

The only behavioural change is for `waypoints.length >= 2`, which was previously producing incorrect output (ignoring waypoints 2+). This is a bug fix, not a breaking change.

---

## 6. Out of Scope (D-04 deferred sub-items)

The following are NOT part of this design:

1. **Edge mutation capture** — wiring `canvas:edge-routed` messages from the webview to `patchEdge()`. The protocol message already exists (protocol.ts line 42–46) and the handler stub exists (panel-core.ts line 181–183). This is a separate feature.
2. **UI for dragging waypoints** — waypoint creation via user interaction in the Excalidraw canvas. Currently waypoints come only from `edgeStyles` in `accordo_diagram_patch`.
3. **Auto-waypoint computation** — algorithmically placing waypoints to avoid node overlaps.

---

## 7. Files Modified

| File | Change |
|---|---|
| `packages/diagram/src/canvas/edge-router.ts` | Add `routeOrthogonalMultiWaypoint()` stub; modify `routeOrthogonal()` dispatch |
| `packages/diagram/src/__tests__/edge-router.test.ts` | Add tests ER-16 through ER-24 |
| `docs/decisions.md` | Add DEC-012 |
| `docs/00-workplan/workplan.md` | Update D-04 status |

---

## 8. Test Strategy

Seven new tests (ER-16..ER-20, ER-23, ER-24) covering:
- **Shape correctness:** 2-waypoint and 3-waypoint paths produce expected point counts
- **Axis alignment invariant:** every segment in the output is purely H or V
- **Endpoint correctness:** path starts at source centre, ends at target centre
- **Waypoint fidelity:** each waypoint appears as a vertex in the output path
- **Collinear dedup:** no zero-length segments from aligned consecutive waypoints
- **Binding contract:** multi-waypoint paths return null bindings (explicit path, no Excalidraw auto-routing)

All tests should fail at assertion level against the stub (which throws `"not implemented"`), not skip.
