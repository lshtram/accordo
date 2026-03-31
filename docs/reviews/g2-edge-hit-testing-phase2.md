# Review — G-2 Edge Hit-Testing — Phase 2: Design Review

**Reviewer:** Reviewer agent  
**Date:** 2026-03-31  
**Prerequisite:** Phase 1 verification complete — both bugs confirmed.

---

## 1. Proposed Approach

Replace the AABB bounding-box test for `kind === "edge"` elements with a **point-to-polyline distance test** using an ~8px threshold. Replace the broken `coordinateToScreen()` midpoint for edges with the **true geometric midpoint** of the polyline.

---

## 2. Algorithm Correctness

### 2.1 Point-to-segment distance

Standard perpendicular-distance formula, clamped to segment endpoints:

```
// Absolute point Pi = [el.x + el.points[i][0], el.y + el.points[i][1]]
function ptSegDist(px, py, ax, ay, bx, by): number {
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx*dx + dy*dy;
  if (lenSq === 0) return Math.sqrt((px-ax)**2 + (py-ay)**2);
  const t = Math.max(0, Math.min(1, ((px-ax)*dx + (py-ay)*dy) / lenSq));
  return Math.sqrt((px - (ax + t*dx))**2 + (py - (ay + t*dy))**2);
}
```

**Assessment:** Correct. The `t = clamp(0,1,...)` ensures the closest point is on the segment, not on the line extended past the endpoints.

**Edge case — zero-length segment:** `lenSq === 0` guard is required and must be present. Without it, division by zero produces `NaN` which then fails the threshold test silently (correct fallback behaviour, but still worth the guard for clarity).

### 2.2 Polyline scan

```
for i in 0 .. points.length-2:
    absA = [el.x + el.points[i][0], el.y + el.points[i][1]]
    absB = [el.x + el.points[i+1][0], el.y + el.points[i+1][1]]
    if ptSegDist(sceneX, sceneY, absA, absB) <= THRESHOLD: return true
return false
```

**Assessment:** Correct and complete. O(n-1) where n is the number of points (typically 2–4).

### 2.3 Polyline midpoint for `coordinateToScreen()`

Two options:

| Option | Accuracy | Complexity |
|--------|----------|------------|
| A: midpoint of the middle segment | ±half-segment-length visual error | O(1) |
| B: walk total length / 2 | Exact visual midpoint | O(n) |

**Recommendation: Option B.** The extra O(n) cost is negligible (n ≤ 4 for all current routing modes). Option A is wrong for self-loops (4 points, mid-segment is at a corner, not the apex) and for long orthogonal paths. The comment pin placement is user-visible; accuracy matters.

Option B algorithm:
```
totalLen = sum of segment lengths
half = totalLen / 2
walk = 0
for each segment (A, B):
  segLen = dist(A, B)
  if walk + segLen >= half:
    t = (half - walk) / segLen
    midX = A[0] + t * (B[0] - A[0])
    midY = A[1] + t * (B[1] - A[1])
    return {x: midX, y: midY}
  walk += segLen
```

Degenerate guard: if `totalLen === 0`, return `el.x, el.y` (first point).

---

## 3. Threshold Value: 8px in Scene Space

**Scene-space threshold analysis:**

At zoom level `z`, 8 scene-pixels = `8 × z` screen pixels.

| Zoom | Screen pixels equivalent |
|------|--------------------------|
| 0.25 | 2 px — borderline too tight |
| 0.5  | 4 px |
| 1.0  | 8 px — comfortable |
| 2.0  | 16 px — generous |
| 4.0  | 32 px — very wide |

**Alternative: screen-space threshold**

To maintain a constant screen-space hit area regardless of zoom, divide threshold by zoom:
```
const EDGE_HIT_THRESHOLD = 8 / appState.zoom.value;
```

This is more user-friendly at low zoom but may produce surprising over-selection at high zoom. For the use case (Alt+click to create a comment), generous hit area at high zoom is desirable — the user is trying to target a specific edge and has zoomed in. **Scene-space threshold is the correct choice.** Keep it as a constant.

**Decision: 8 scene-pixels, named constant.**

```typescript
const EDGE_HIT_THRESHOLD = 8;
```

This is consistent with `ARROW_GAP = 8` in `edge-router.ts` (the clearance used between arrow tip and node boundary), which is a good semantic parallel.

---

## 4. Performance

- Elements per typical diagram: 20–150 (nodes + edges + labels)
- Arrow elements: typically 10–50% of that = 10–75 arrows
- Points per arrow: 2 (auto), 3 (orthogonal), 4 (orthogonal with waypoint), ≥4 (self-loop)
- Operations per click: O(elements × avg_points) ≈ 75 × 4 = 300 floating-point operations

This is well within acceptable bounds for a user gesture handler. No performance concern.

---

## 5. Floating-Point Precision

- All coordinates are canvas pixels (double-precision floats, typical values 0–5000)
- `lenSq` computation: max magnitude ≈ `5000² + 5000² = 50,000,000` — within double precision
- `t` clamped to `[0,1]` — no precision issue
- Distance comparison `<= 8` — no precision issue at this scale

No floating-point concerns.

---

## 6. Type Safety Issues to Resolve

The click handler (line 332–334) casts `getSceneElements()` to:
```typescript
Array<{ id: string; customData?: { mermaidId?: string; kind?: string }; x: number; y: number; width: number; height: number }>
```

The `points` field must be added:
```typescript
Array<{
  id: string;
  customData?: { mermaidId?: string; kind?: string };
  x: number;
  y: number;
  width: number;
  height: number;
  points?: ReadonlyArray<readonly [number, number]>;
}>
```

Same extension required in the `coordinateToScreen()` element cast (lines 289–291).

---

## 7. Code Organisation

The point-to-segment distance function and the polyline-midpoint function should be **extracted as named top-level functions** (not inlined into the event handler closure) for two reasons:
1. The click handler already pushes against the 40-line function limit (coding-guidelines §3.4).
2. Named functions enable unit testing of the geometry without a browser DOM.

Suggested module structure addition at top of `comment-overlay.ts`:

```typescript
// ── Geometry helpers (also tested in comment-overlay.test.ts) ────────────────

/** Squared distance from point (px,py) to segment (ax,ay)→(bx,by). */
function pointSegDistSq(...): number { ... }

/** Whether click point is within EDGE_HIT_THRESHOLD scene-pixels of the polyline. */
function hitsEdgePolyline(
  sceneX: number, sceneY: number,
  el: { x: number; y: number; points: ReadonlyArray<readonly [number, number]> }
): boolean { ... }

/** Compute the absolute scene-space midpoint of the edge polyline. */
function edgePolylineMidpoint(
  el: { x: number; y: number; points: ReadonlyArray<readonly [number, number]> }
): { x: number; y: number } { ... }
```

---

## 8. Test Requirements

Since `comment-overlay.ts` is browser-only (no Node.js imports), the geometry helpers should be **exported** so they can be unit-tested from a `.test.ts` file using jsdom or pure-JS. The functions take only plain numbers — no DOM required.

**Minimum required tests:**
1. `hitsEdgePolyline` returns true when click is exactly on segment
2. `hitsEdgePolyline` returns true when click is within 8px of segment
3. `hitsEdgePolyline` returns false when click is 9px away from segment
4. `hitsEdgePolyline` returns false when click is beyond endpoint (not on extended line)
5. `hitsEdgePolyline` with 3-point orthogonal path — misses both segments → false
6. `edgePolylineMidpoint` on a 2-point horizontal edge → midpoint correct
7. `edgePolylineMidpoint` on a 3-point L-shape → correct geometric midpoint
8. `edgePolylineMidpoint` degenerate (1 point or zero length) → does not throw

---

## 9. Alternatives Considered

| Alternative | Verdict |
|-------------|---------|
| Use Excalidraw's own hit-test API | Not available in the webview API surface; getSceneElements() returns raw data only |
| Expand AABB by computing arrow bounding box over all points | Correct for hit-test but fails narrow diagonal arrows (false positives in the wide dimension); inferior to polyline test |
| Use a 2D canvas `isPointInStroke()` | Requires rendering to an offscreen canvas and managing stroke width — far more complex, same result |

**Conclusion:** The point-to-polyline distance approach is the correct and simplest solution.

---

## 10. Summary

**PASS — proceed to implementation** with the following mandatory requirements:

| # | Requirement |
|---|-------------|
| R1 | Extract `hitsEdgePolyline` and `edgePolylineMidpoint` as named, exported top-level functions |
| R2 | Use exact geometric midpoint (walk half total polyline length), not segment midpoint |
| R3 | Name the threshold constant `EDGE_HIT_THRESHOLD = 8` (scene pixels) |
| R4 | Guard against zero-length segments in `hitsEdgePolyline` |
| R5 | Guard against degenerate `points` (absent, empty, single-point) in both functions |
| R6 | Widen element type annotations in click handler and `coordinateToScreen()` to include `points?` |
| R7 | Add unit tests covering all 8 cases listed in §8 |
| R8 | AABB check is retained unchanged for nodes and clusters |
