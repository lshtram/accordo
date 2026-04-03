/**
 * A9 — Edge router: routing strategy → Excalidraw point path
 *
 * Pure geometry module. Converts a routing mode, optional waypoints, and the
 * source/target bounding boxes into the `points[]` array and binding hints
 * that an Excalidraw arrow element needs.
 *
 * No Excalidraw imports. Points are in absolute canvas coordinates (same
 * coordinate space as the bounding boxes). The canvas generator normalises
 * them relative to the element origin when constructing the Excalidraw element.
 *
 * Routing vocabulary (aligned with types.ts EdgeLayout.routing):
 *   "auto"        — straight line between element midpoints; Excalidraw renders
 *                   the curved route. Bindings set (focus 0, default gap).
 *   "direct"      — explicit point-to-point line through source centre →
 *                   optional waypoints → target centre. Bindings null.
 *   "orthogonal"  — axis-aligned L-shape / Z-shape; waypoints used as bend
 *                   hints. Bindings null (path is fully explicit).
 *   unknown       — falls back to "auto" behaviour.
 *
 * Source: diag_arch_v4.2.md §9.3, diag_workplan.md §5 A9
 */

/** EdgeRouting vocabulary — matches EdgeLayout.routing from types.ts. */
export type EdgeRouting = "auto" | "curved" | "orthogonal" | "direct" | string;

/**
 * Axis-aligned bounding box for a diagram node on the canvas.
 * Coordinates are in absolute canvas pixels.
 */
export interface BoundingBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Computed edge path.
 *
 * `points` — 2-or-more [x, y] pairs in absolute canvas coordinates.
 *   "auto":        exactly 2 points (start centre-edge, end centre-edge).
 *   "direct":      2 + len(waypoints) points.
 *   "orthogonal":  ≥ 3 points (L-shape or Z-shape through any waypoints).
 *   self-loop:     ≥ 4 points forming a closed loop.
 *
 * `startBinding` / `endBinding` — Excalidraw binding hints:
 *   non-null for "auto" (Excalidraw snaps arrow ends to element boundaries).
 *   null for "direct" and "orthogonal" (path is fully explicit).
 *
 *   `focus`  — normalised attachment point [-1, 1] (0 = element centre axis).
 *   `gap`    — pixel clearance between element boundary and arrow tip (≥ 0).
 *
 * The `elementId` for each binding is NOT set here — the canvas generator
 * attaches the Excalidraw element ID after creating the node elements.
 */
export interface RouteResult {
  points: Array<[number, number]>;
  startBinding: { focus: number; gap: number } | null;
  endBinding: { focus: number; gap: number } | null;
}

/**
 * Compute the Excalidraw arrow path for an edge.
 *
 * @param routing   "auto" | "direct" | "orthogonal" | unknown (→ "auto").
 * @param waypoints User-defined intermediate points (absolute canvas coords).
 *                  Empty array for routing modes that ignore them.
 * @param source    Bounding box of the source node.
 * @param target    Bounding box of the target node.
 */
// ── Geometry helpers ─────────────────────────────────────────────────────────

function centre(box: BoundingBox): [number, number] {
  return [box.x + box.w / 2, box.y + box.h / 2];
}

function isSameBox(a: BoundingBox, b: BoundingBox): boolean {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

// ── Routing strategies ────────────────────────────────────────────────────────

const ARROW_GAP = 8;

/**
 * Clip the line from `from` outward toward `toward`, stopping at the
 * boundary of `box` and pulling back by `gap` pixels.
 * Returns the point on (or just outside) the box border.
 */
function clampToBorder(
  from: [number, number],
  toward: [number, number],
  box: BoundingBox,
  gap: number
): [number, number] {
  const [cx, cy] = from;
  const dx = toward[0] - cx;
  const dy = toward[1] - cy;
  if (dx === 0 && dy === 0) return from;

  // Find smallest positive t where the ray (cx+t·dx, cy+t·dy) exits the box.
  let tExit = Infinity;
  if (dx > 0) tExit = Math.min(tExit, (box.x + box.w - cx) / dx);
  else if (dx < 0) tExit = Math.min(tExit, (box.x - cx) / dx);
  if (dy > 0) tExit = Math.min(tExit, (box.y + box.h - cy) / dy);
  else if (dy < 0) tExit = Math.min(tExit, (box.y - cy) / dy);

  const len = Math.sqrt(dx * dx + dy * dy);
  // tExit is where the ray exits the box boundary.  Adding gap/len places
  // the returned point gap-pixels OUTSIDE the boundary (not inside).
  const t = tExit + gap / len;
  return [cx + t * dx, cy + t * dy];
}

function routeSelfLoop(box: BoundingBox): RouteResult {
  const { x, y, w, h } = box;
  const cx = x + w / 2;
  const off = 60;
  return {
    points: [
      [cx, y],
      [x + w + off, y],
      [x + w + off, y + h / 2],
      [cx, y + h],
    ],
    startBinding: { focus: 0, gap: ARROW_GAP },
    endBinding:   { focus: 0, gap: ARROW_GAP },
  };
}

function routeAuto(
  source: BoundingBox,
  target: BoundingBox
): RouteResult {
  const sc = centre(source);
  const tc = centre(target);
  const start = clampToBorder(sc, tc, source, ARROW_GAP);
  const end   = clampToBorder(tc, sc, target, ARROW_GAP);
  return {
    points: [start, end],
    startBinding: { focus: 0, gap: ARROW_GAP },
    endBinding:   { focus: 0, gap: ARROW_GAP },
  };
}

function routeDirect(
  waypoints: ReadonlyArray<{ readonly x: number; readonly y: number }>,
  source: BoundingBox,
  target: BoundingBox
): RouteResult {
  const [sx, sy] = centre(source);
  const [tx, ty] = centre(target);
  const pts: Array<[number, number]> = [[sx, sy]];
  for (const wp of waypoints) pts.push([wp.x, wp.y]);
  pts.push([tx, ty]);
  return { points: pts, startBinding: null, endBinding: null };
}

/**
 * Route an orthogonal edge through N waypoints (N ≥ 2), producing a
 * Z-shape axis-aligned polyline.
 *
 * Algorithm: for each consecutive pair of control points (source → wp1,
 * wp1 → wp2, …, wpN → target), emit an H-V segment pair (horizontal
 * move then vertical move). Adjacent duplicate points are removed to
 * avoid zero-length segments.
 *
 * @param waypoints  2 or more intermediate waypoints (absolute canvas coords).
 * @param source     Bounding box of the source node.
 * @param target     Bounding box of the target node.
 * @returns          RouteResult with axis-aligned polyline and null bindings.
 *
 * Requirement: ER-16..ER-24 (D-04 Z-shape waypoint routing)
 * @internal — called from routeOrthogonal when waypoints.length >= 2.
 */
function routeOrthogonalMultiWaypoint(
  waypoints: ReadonlyArray<{ readonly x: number; readonly y: number }>,
  source: BoundingBox,
  target: BoundingBox
): RouteResult {
  const [sx, sy] = centre(source);
  const [tx, ty] = centre(target);

  // Build the full control point chain: [S, W1, W2, ..., WN, E]
  const controls: Array<[number, number]> = [[sx, sy]];
  for (const wp of waypoints) controls.push([wp.x, wp.y]);
  controls.push([tx, ty]);

  // Start with S; for each consecutive pair, emit H-first L-junction points
  const pts: Array<[number, number]> = [[sx, sy]];
  for (let i = 0; i < controls.length - 1; i++) {
    // controls[i] and controls[i+1] are guaranteed non-null:
    // controls is built from centre(source), waypoints[], and centre(target),
    // none of which can produce a null element.
    const [, y1] = controls[i]!;
    const [x2, y2] = controls[i + 1]!;
    // Horizontal-first: go to (x2, y1), then to (x2, y2)
    const corner: [number, number] = [x2, y1];
    const endpoint: [number, number] = [x2, y2];
    // pts[pts.length - 1] is guaranteed non-null: pts always has at least [[sx, sy]].
    if (pts[pts.length - 1]![0] !== corner[0] || pts[pts.length - 1]![1] !== corner[1]) {
      pts.push(corner);
    }
    // pts[pts.length - 1] is guaranteed non-null (same reason as above).
    if (pts[pts.length - 1]![0] !== endpoint[0] || pts[pts.length - 1]![1] !== endpoint[1]) {
      pts.push(endpoint);
    }
  }

  return { points: pts, startBinding: null, endBinding: null };
}

function routeOrthogonal(
  waypoints: ReadonlyArray<{ readonly x: number; readonly y: number }>,
  source: BoundingBox,
  target: BoundingBox
): RouteResult {
  const [sx, sy] = centre(source);
  const [tx, ty] = centre(target);
  let pts: Array<[number, number]>;
  if (waypoints.length >= 2) {
    // D-04: Z-shape multi-waypoint routing.
    return routeOrthogonalMultiWaypoint(waypoints, source, target);
  } else if (waypoints.length === 1) {
    // Use first waypoint as explicit bend hint.
    const bend = waypoints[0]!;
    pts = [[sx, sy], [bend.x, sy], [bend.x, bend.y], [tx, ty]];
  } else {
    // L-shape: horizontal-first when dx >= dy, vertical-first otherwise.
    const dx = Math.abs(tx - sx);
    const dy = Math.abs(ty - sy);
    if (dx >= dy) {
      pts = [[sx, sy], [tx, sy], [tx, ty]];
    } else {
      pts = [[sx, sy], [sx, ty], [tx, ty]];
    }
  }
  return { points: pts, startBinding: null, endBinding: null };
}

// ── Public API ────────────────────────────────────────────────────────────────

export function routeEdge(
  routing: EdgeRouting,
  waypoints: ReadonlyArray<{ readonly x: number; readonly y: number }>,
  source: BoundingBox,
  target: BoundingBox
): RouteResult {
  // Self-loop: same geometry regardless of routing mode — handle first.
  if (isSameBox(source, target)) {
    return routeSelfLoop(source);
  }

  // Normalise aliases and unknown values to a canonical mode.
  const mode: EdgeRouting =
    routing === "curved" ? "auto"
    : routing === "orthogonal" || routing === "direct" ? routing
    : "auto"; // unknown strings fall back to auto

  switch (mode) {
    case "direct":      return routeDirect(waypoints, source, target);
    case "orthogonal":  return routeOrthogonal(waypoints, source, target);
    default:            return routeAuto(source, target);
  }
}
