# D-03 Curved Routing — Research Findings

**Date**: 2026-04-03  
**Task**: D-03 Curved Routing — Excalidraw Curved Arrow Implementation  
**Status**: Research Complete

---

## 1. Current Routing Implementation Summary

### Files Examined
- `packages/diagram/src/canvas/edge-router.ts` — primary routing logic
- `packages/diagram/src/canvas/canvas-generator.ts` — element creation
- `packages/diagram/src/webview/scene-adapter.ts` — Excalidraw API payload
- `packages/diagram/src/types.ts` — type definitions

### Current State (edge-router.ts)

The `routeEdge()` function (line 244) handles routing with this decision tree:

```
routing === "curved"  →  alias to "auto"  (LINE 257)
routing === "orthogonal" → routeOrthogonal()
routing === "direct"  → routeDirect()
default               → routeAuto()
```

**Current "curved" behavior**: Aliased to `"auto"`, which produces:
- 2-point path: `[startEdge, endEdge]`
- `startBinding` and `endBinding` set (Excalidraw snaps to node borders)
- No intermediate waypoints
- No actual curve

```typescript
// edge-router.ts:132-145 (routeAuto)
function routeAuto(source, target): RouteResult {
  const sc = centre(source);
  const tc = centre(target);
  const start = clampToBorder(sc, tc, source, ARROW_GAP);
  const end   = clampToBorder(tc, sc, target, ARROW_GAP);
  return {
    points: [start, end],          // Only 2 points — straight line
    startBinding: { focus: 0, gap: 8 },
    endBinding:   { focus: 0, gap: 8 },
  };
}
```

### Integration Points
- **canvas-generator.ts** (line 206): Calls `routeEdge()` and uses `routeResult.points` directly
- **scene-adapter.ts** (line 82): `points` field passed through to Excalidraw API
- **types.ts** (line 121): `routing` field accepts `"curved"` (string-typed, no validation)

---

## 2. Excalidraw Native Curved Arrow Support

### Answer: Excalidraw Does NOT Have a "Curved Arrow" Type

Excalidraw arrows use `type: "arrow"` with a `points: ReadonlyArray<[number, number]>` array. There is **no separate `type: "curvedArrow"`** or similar.

### How Excalidraw Handles Multi-Point Arrows

From PR #7181 ("Splitting curves in linear elements like lines and arrows"):

> "When you draw a curved line through a set of points, Excalidraw draws a **single curve going through the points**."

**Key Finding**: Excalidraw uses **Catmull-Rom spline interpolation** for "rounded" line types. When a linear element (arrow/line) has:
- 2 points → straight line
- 3+ points with "rounded" rendering → smooth curve through all points

### Excalidraw Element Structure for Arrows

```typescript
// Minimal arrow element
{
  type: "arrow",
  x: number,           // origin.x of first point
  y: number,           // origin.y of first point  
  points: [[dx, dy], [dx, dy], ...],  // relative to x,y
  startBinding: { elementId: string, focus: number, gap: number } | null,
  endBinding: { elementId: string, focus: number, gap: number } | null,
  startArrowhead: null,
  endArrowhead: "arrow",
  // ... other styling fields
}
```

### How Other Projects Implement Curved Arrows

From PR #1274 ("Add curved lines/arrows shortcuts" — merged):
- Excalidraw draws curves through multiple user-provided waypoints
- The curve is rendered by Excalidraw's canvas, not pre-computed as bezier control points

From Issue #148 ("Curved arrows"):
- Two approaches discussed: 2-point bezier with handles, or 3-point bezier
- Neither was implemented as a native type; instead multi-point paths with curve rendering were used

### What This Means for D-03

To implement true curved routing, Accordo must:
1. **Generate multiple intermediate points** along a smooth curve path
2. **Pass these points to Excalidraw** via the `points` array
3. **Let Excalidraw render the curve** (it handles the smoothing internally)

---

## 3. Recommended Approach

### Option A: Catmull-Rom Spline Interpolation (Recommended)

**Approach**: Generate N intermediate points along a Catmull-Rom spline between source and target centers.

**Algorithm**:
1. Start from source center, end at target center (with border clamping)
2. For 0 waypoints: Generate ~10-20 intermediate points along a circular arc or smooth S-curve
3. For N waypoints: Generate smooth curve through source → waypoints → target

**Pros**:
- Excalidraw natively renders smooth curves through points
- No pre-computed bezier control points needed
- Consistent with Excalidraw's "rounded line" behavior

**Cons**:
- Need to determine optimal number of points to sample

### Option B: Pre-Computed Cubic Bezier

**Approach**: Compute bezier control points explicitly, render as polyline approximating the curve.

**Pros**:
- Full control over curve shape

**Cons**:
- Excalidraw doesn't have native bezier rendering for arrows
- Would need to sample many points to approximate curve
- More complex than Option A

### Effort Estimate

| Phase | Effort | Description |
|-------|--------|-------------|
| Analysis | 1-2 days | Understand Catmull-Rom implementation needs |
| Implementation | 2-3 days | `routeCurved()` function with spline sampling |
| Testing | 1-2 days | Edge cases (self-loops, multiple waypoints, bounds) |
| **Total** | **4-7 days** | |

---

## 4. Key Implementation Decisions

### Decision 1: Algorithm — Catmull-Rom vs Bezier

**Choice**: Catmull-Rom spline

**Rationale**: Excalidraw already uses this internally for rounded lines. Generating control points that Excalidraw can render natively is simpler than pre-computing bezier sampling.

### Decision 2: Point Count

**Choice**: 16-20 points per curve segment

**Rationale**: Provides smooth appearance without excessive data. Each point is a `[number, number]` tuple.

### Decision 3: Bindings — Null vs Set

**Choice**: `startBinding: null, endBinding: null`

**Rationale**: Curved paths with explicit intermediate points are fully determined by the points array. Bindings would interfere with the smooth curve shape by forcing snaps to element borders.

### Decision 4: Waypoint Handling

**Choice**: Curve passes through user-defined waypoints (if any)

**Rationale**: Consistent with orthogonal routing behavior (D-04) where waypoints serve as bend hints.

### Decision 5: Self-Loop Curves

**Choice**: Reuse existing `routeSelfLoop()` or create curved variant

**Current**: `routeSelfLoop` returns 4-point box shape  
**Curved variant**: Would return ~12-16 points forming a smooth rounded rectangle loop

---

## 5. Implementation Plan (Phases)

### Phase A: Type & Stub
1. Add `routeCurved()` stub to `edge-router.ts`
2. Remove "curved" alias to "auto" (line 257)
3. Wire `routeCurved` into switch statement

### Phase B: Core Algorithm
1. Implement Catmull-Rom spline sampling in `routeCurved()`
2. Handle 0-waypoint case (simple arc)
3. Handle N-waypoint case (curve through waypoints)

### Phase C: Edge Cases
1. Self-loop curves
2. Very short edges (min point count)
3. Bounds checking

### Phase D: Integration
1. Update `canvas-generator.ts` if needed
2. Verify `scene-adapter.ts` passes points through
3. Update tool definitions if routing enum changes

---

## 6. Files to Modify

| File | Change |
|------|--------|
| `packages/diagram/src/canvas/edge-router.ts` | Add `routeCurved()` function, remove alias |
| `packages/diagram/src/__tests__/edge-router.test.ts` | Add tests for curved routing (new or extend existing) |
| `packages/diagram/src/tools/diagram-tool-definitions.ts` | Verify routing enum allows "curved" |

**No changes needed** to:
- `scene-adapter.ts` — already passes `points` through
- `types.ts` — `routing: string` already accepts "curved"

---

## 7. References

- Excalidraw Issue #148: Curved arrows (original feature request)
- Excalidraw PR #7181: Splitting curves in linear elements
- Excalidraw PR #1274: Add curved lines/arrows shortcuts
- Excalidraw PR #6546: Creating elements programmatically
- Excalidraw `packages/math/src/curve.ts`: Internal curve math utilities
- Excalidraw `packages/element/src/elbowArrow.ts`: Elbow/orthogonal arrow implementation
