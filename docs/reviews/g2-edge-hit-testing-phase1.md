# Review — G-2 Edge Hit-Testing — Phase 1: Independent Verification

**Reviewer:** Reviewer agent  
**Date:** 2026-03-31  
**Files inspected:**
- `packages/diagram/src/webview/comment-overlay.ts` (413 lines)
- `packages/diagram/src/canvas/canvas-generator.ts` (291 lines)
- `packages/diagram/src/canvas/edge-router.ts` (204 lines)
- `packages/diagram/src/types.ts` (472 lines)

---

## 1. Root Cause Verification

### 1.1 Bug 1 — AABB hit-test on zero-area arrow elements: CONFIRMED

**Evidence in `comment-overlay.ts` lines 349–362:**

```typescript
if (
  sceneX >= el.x &&
  sceneX <= el.x + el.width &&
  sceneY >= el.y &&
  sceneY <= el.y + el.height
) {
```

**Evidence in `canvas-generator.ts` lines 233–253:**

```typescript
elements.push({
  id: arrowId,
  mermaidId: key,
  kind: "edge",
  type: "arrow",
  x: ox,       // absolute X of the first polyline point
  y: oy,       // absolute Y of the first polyline point
  width: 0,    // ← always 0
  height: 0,   // ← always 0
  ...
  points: relPoints,  // relative coords from (ox, oy)
```

The arrow element is deliberately constructed with `width: 0, height: 0` — this is correct Excalidraw arrow semantics (geometry lives in `points[]`). The AABB check degenerates to the single-point `(el.x, el.y)` which is the first endpoint, not anywhere along the arrow. **The diagnosis is correct.**

### 1.2 Bug 2 — `coordinateToScreen()` pin midpoint also broken: CONFIRMED

**Evidence in `comment-overlay.ts` lines 300–304:**

```typescript
const isEdge = blockId.startsWith("edge:");
const pinSceneX = isEdge ? el.x + el.width / 2 : el.x + el.width;
const pinSceneY = isEdge ? el.y + el.height / 2 : el.y;
```

For an arrow element where `el.width === 0` and `el.height === 0`, this resolves to:
- `pinSceneX = el.x + 0 = el.x` (first anchor point X)
- `pinSceneY = el.y + 0 = el.y` (first anchor point Y)

The intent is to place the comment pin at the visual midpoint of the edge, but it will always place it at the first endpoint. **The diagnosis is correct.**

### 1.3 Arrow geometry: confirmed as relative polyline

**From `canvas-generator.ts` lines 210–215:**

```typescript
const absPoints = routeResult.points;          // absolute canvas coords
const ox = absPoints[0]![0];                   // first point X
const oy = absPoints[0]![1];                   // first point Y
const relPoints: ReadonlyArray<[number, number]> = absPoints.map(
  ([px, py]) => [px - ox, py - oy] as [number, number],
);
```

- `el.x` = absolute position of the first waypoint
- `el.points[i]` = relative offsets from `(el.x, el.y)`
- Absolute point `i` = `[el.x + el.points[i][0], el.y + el.points[i][1]]`
- This is the coordinate convention both fixes must use

---

## 2. Additional Issues Identified

### 2.1 Self-loop arrows: overlooked edge case

`edge-router.ts` `routeAuto()` produces a 4-point self-loop path for edges where `source === target`. The midpoint of a self-loop is not visually the midpoint of the path length — it is typically the apex of the right-side rectangular excursion. The fix should handle the case where `points.length` is 1 (degenerate) or >= 4 (self-loop) gracefully.

### 2.2 "direct" and "orthogonal" routing: 3+ point paths

Edges with `routing: "orthogonal"` produce 3 points (L-shape) or 4 points with a waypoint. The polyline midpoint calculation must iterate over all segments. A naïve `points[floor(n/2)]` index approach will be wrong for odd-segment paths — it picks a vertex, not a segment midpoint.

### 2.3 The AABB check also fails for label text elements on node shapes

Looking at the hit-test loop: text overlay elements (`mermaidId.endsWith(":text")` or `":label"`) are correctly filtered out on line 348. So this is not an issue.

### 2.4 Cluster elements use AABB correctly

Clusters are rendered as `type: "rectangle"` with real `width`/`height` (from `cl.w`/`cl.h`). The AABB check is correct for them. No change needed there.

### 2.5 Missing `points` type in the hit-test loop type annotation

The loop casts elements to `{ id, customData, x, y, width, height }` (line 333) but does **not** include `points` in the type. The fix must widen this type to include `points?: ReadonlyArray<[number, number]>` to access the field without a cast.

### 2.6 Zoom-dependent threshold in hit-test

The click-to-scene-coordinate conversion on lines 341–342 correctly divides by `appState.zoom.value`. This means `sceneX`/`sceneY` are in scene space, and an 8-pixel threshold in scene space is also in scene space. At zoom 0.5, 8 scene-px corresponds to only 4 screen pixels — very tight. At zoom 2.0, 8 scene-px = 16 screen pixels — quite generous. 

**Assessment:** For the hit-test, a threshold in scene space is actually more consistent than screen space because the arrow lines themselves are drawn in scene space. The 8px recommendation is reasonable and aligns with `ARROW_GAP = 8` used in `edge-router.ts`.

### 2.7 `coordinateToScreen()` also lacks `points` in its local element type

Line 289–291 casts the found element to `{ x, y, width, height }` only. The pin midpoint fix must also extend this local type.

---

## 3. Risk Assessment

| Risk | Severity | Notes |
|------|----------|-------|
| Zero-point `points` array on a malformed arrow element | Low | `absPoints[0]` is guarded by the existing `!` assertion in canvas-generator; webview elements come from the same generator |
| Threshold not scaling visually with zoom | Medium | Noted in §2.6 — scene-space threshold is defensible; screen-space alternative would require multiplying by zoom |
| Performance: O(segments × elements) on click | Low | Diagrams rarely exceed 50–100 elements; this is a user-gesture handler, not a hot loop |
| Self-loop midpoint visual accuracy | Low | Wrong visual only; comment will still be attached to correct `blockId` |

---

## 4. Proposed Fix Approach: Assessment

**Hit-test change:** Replace AABB check with point-to-polyline distance for `kind === "edge"` elements; keep AABB for nodes and clusters.

**Algorithm sketch (point-to-segment distance):**
```
for each consecutive pair (P[i], P[i+1]) in the absolute polyline:
    d = distancePointToSegment(clickSceneXY, absP[i], absP[i+1])
    if d <= THRESHOLD: hit
```

This is correct. O(segments) per arrow, O(arrows) per click — entirely acceptable.

**`coordinateToScreen()` change:** Replace the broken `el.x + el.width/2` with the actual geometric midpoint of the polyline:

```
sum over all segment lengths, walk to length/2, interpolate
```

Or simpler: use the midpoint of the middle segment (acceptable approximation for most edges).

**Recommended THRESHOLD:** 8 scene-pixels. Consistent with `ARROW_GAP` from edge-router. Consider naming the constant `EDGE_HIT_THRESHOLD` and placing it at the top of the file.

---

## 5. Verdict

**Both bugs are confirmed exactly as described.** The fix approach is sound. No blocking risks.

**Before implementation, the developer must:**
1. Widen the element type annotation in the click handler to include `points?: ReadonlyArray<[number, number]>`.
2. Widen the element type annotation in `coordinateToScreen()` similarly.
3. Handle the degenerate case where `points` is absent or has fewer than 2 entries (arrow element should always have ≥ 2 but belt-and-suspenders guard prevents a runtime crash on a malformed scene).
4. Add a named constant (`EDGE_HIT_THRESHOLD = 8`) rather than a magic number.
5. Consider: the pin midpoint should be the true geometric centre of the polyline (walk half the total length). A simpler midpoint-of-middle-segment is visually acceptable and far simpler to implement; either is correct.

---

## 6. Existing Test Baseline

- `pnpm test` in `packages/diagram` ran clean: **521 tests, 0 failures**.
- No existing test covers the webview hit-test logic (it is browser DOM code). Tests will need to be added as pure geometry functions extracted from the handler, or via the new test infrastructure for comment-overlay geometry. The reviewer will check test coverage in Phase 3.
