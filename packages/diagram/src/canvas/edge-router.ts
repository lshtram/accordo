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
  target: BoundingBox,
  direction?: "TD" | "LR" | "RL" | "BT",
): RouteResult {
  const sc = centre(source);
  const tc = centre(target);

  // Back-edge detection: source is "upstream" of target in the given direction.
  // If so, fall back to centre-to-centre attachment (no face bias).
  const isBackEdge =
    direction === "TD" && source.y >= target.y ||
    direction === "BT" && source.y <= target.y ||
    direction === "LR" && source.x >= target.x ||
    direction === "RL" && source.x <= target.x;

  let start: [number, number];
  let end: [number, number];

  if (isBackEdge) {
    // Fall back to centre-to-centre attachment
    start = clampToBorder(sc, tc, source, ARROW_GAP);
    end   = clampToBorder(tc, sc, target, ARROW_GAP);
  } else {
    // Direction-aware attachment points
    start = clampToBorder(sc, getDirectionBias(direction, sc, tc, source, true), source, ARROW_GAP);
    end   = clampToBorder(tc, getDirectionBias(direction, tc, sc, target, false), target, ARROW_GAP);
  }

  return {
    points: [start, end],
    startBinding: { focus: 0, gap: ARROW_GAP },
    endBinding:   { focus: 0, gap: ARROW_GAP },
  };
}

/**
 * Get the biased attachment point for direction-aware routing.
 * For source (isSource=true): exit face centre
 * For target (isSource=false): entry face centre
 */
function getDirectionBias(
  direction: "TD" | "LR" | "RL" | "BT" | undefined,
  selfCentre: [number, number],
  otherCentre: [number, number],
  box: BoundingBox,
  isSource: boolean,
): [number, number] {
  if (!direction) {
    return otherCentre; // No direction: bias toward other centre (default)
  }

  switch (direction) {
    case "TD":
      // Source exits bottom, target enters top
      return isSource
        ? [selfCentre[0], box.y + box.h]   // exit bottom
        : [selfCentre[0], box.y];           // enter top
    case "BT":
      // Source exits top, target enters bottom
      return isSource
        ? [selfCentre[0], box.y]             // exit top
        : [selfCentre[0], box.y + box.h];   // enter bottom
    case "LR":
      // Source exits right, target enters left
      return isSource
        ? [box.x + box.w, selfCentre[1]]    // exit right
        : [box.x, selfCentre[1]];           // enter left
    case "RL":
      // Source exits left, target enters right
      return isSource
        ? [box.x, selfCentre[1]]             // exit left
        : [box.x + box.w, selfCentre[1]];   // enter right
    default:
      return otherCentre;
  }
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
  // Orthogonal routes have a fully-explicit path; bindings are null (path is not
  // inferred by Excalidraw but is directly encoded in points).
  return {
    points: pts,
    startBinding: null,
    endBinding:   null,
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Compute a curved (Bézier-approximation) path between source and target.
 * Produces ≥ 3 points with a control point offset perpendicular to the midline.
 *
 * The start/end attachment points are clamped toward/away from the curve's
 * first/last control point (FC-09), not toward the opposite node's centre.
 *
 * @param source    Bounding box of the source node.
 * @param target    Bounding box of the target node.
 * @param direction Optional diagram flow direction for biased attachment.
 * @param waypoints Optional user-placed waypoints for curved routing.
 *                  Empty or absent = auto (single control-point heuristic).
 *                  One waypoint = explicit Bézier control point.
 *                  Two+ waypoints = explicit polyline-curve through all points.
 * @returns         RouteResult with curved point path and bindings.
 *
 * @internal — FC-06, FC-09 (Batch 2), diagram-update-plan.md §12.5 (P-B)
 */
export function routeCurved(
  source: BoundingBox,
  target: BoundingBox,
  direction?: "TD" | "LR" | "RL" | "BT",
  waypoints?: ReadonlyArray<{ readonly x: number; readonly y: number }>,
): RouteResult {
  const sc = centre(source);
  const tc = centre(target);

  // ── Waypoint-aware path ─────────────────────────────────────────────────────
  // §12.3 curved waypoint semantics:
  //   0 waypoints → existing auto-curve behavior (single control-point heuristic)
  //   1 waypoint  → that waypoint becomes the explicit single control point
  //   2+ waypoints → all waypoints are explicit control points (path goes through each)
  if (waypoints && waypoints.length > 0) {
    const startPt = clampToBorder(sc, centre(source), source, ARROW_GAP);
    const endPt   = clampToBorder(tc, centre(target), target, ARROW_GAP);

    if (waypoints.length === 1) {
      // Single explicit control point: use the waypoint verbatim as cp.
      const cp: [number, number] = [waypoints[0]!.x, waypoints[0]!.y];
      // Re-clamp start/end relative to the explicit cp (FC-09).
      const clampedStart = clampToBorder(sc, cp, source, ARROW_GAP);
      const clampedEnd   = clampToBorder(tc, cp, target, ARROW_GAP);
      return {
        points: [clampedStart, cp, clampedEnd],
        startBinding: { focus: 0, gap: ARROW_GAP },
        endBinding:   { focus: 0, gap: ARROW_GAP },
      };
    }

    // 2+ waypoints: explicit polyline path through all waypoints.
    // FC-09: start/end are clamped to the source/target border relative to
    // the first/last waypoint direction (not the opposite node centre).
    const wp0 = waypoints[0]!;
    const wpLast = waypoints[waypoints.length - 1]!;
    const clampedStart = clampToBorder(sc, [wp0.x, wp0.y], source, ARROW_GAP);
    const clampedEnd   = clampToBorder(tc, [wpLast.x, wpLast.y], target, ARROW_GAP);
    // pts[pts.length - 1] is guaranteed to be the last waypoint (not startPt)
    // because waypoints.length >= 2 and we have not yet pushed clampedEnd.
    const pts: Array<[number, number]> = [clampedStart];
    for (const wp of waypoints) pts.push([wp.x, wp.y]);
    pts.push(clampedEnd);
    return { points: pts, startBinding: null, endBinding: null };
  }

  // ── Auto-curve (no waypoints) ───────────────────────────────────────────────
  // Straight baseline vector.
  const dx = tc[0] - sc[0];
  const dy = tc[1] - sc[1];
  const len = Math.max(1, Math.hypot(dx, dy));

  // Unit perpendicular to baseline.
  const nx = -dy / len;
  const ny = dx / len;

  // Subtle curve only: small offset from midpoint.
  // Keep curves gentle, close to straight-line behavior.
  const CURVE_OFFSET = Math.min(Math.max(len * 0.12, 10), 22);

  // Deterministic side selection by direction, then geometry fallback.
  let sign = 1;
  if (direction === "RL" || direction === "BT") sign = -1;
  else if (direction === "LR" || direction === "TD") sign = 1;
  else if (dx < 0 || (dx === 0 && dy < 0)) sign = -1;

  // Compute exit/entry face centres based on direction
  const exitFaceCentre = getExitFaceCentre(direction, sc, source);
  const entryFaceCentre = getEntryFaceCentre(direction, tc, target);

  // Clamp to the direction-selected faces
  const startPt = clampToBorder(sc, exitFaceCentre, source, ARROW_GAP);
  const endPt = clampToBorder(tc, entryFaceCentre, target, ARROW_GAP);

  // Single gentle control point near baseline midpoint.
  const midX = (startPt[0] + endPt[0]) / 2;
  const midY = (startPt[1] + endPt[1]) / 2;
  const cp: [number, number] = [
    midX + nx * CURVE_OFFSET * sign,
    midY + ny * CURVE_OFFSET * sign,
  ];

  // FC-09: Clamp start point toward curve tangent control point
  const clampedStart = clampToBorder(sc, cp, source, ARROW_GAP);

  // FC-09: Clamp end point away from curve tangent control point
  const clampedEnd = clampToBorder(tc, cp, target, ARROW_GAP);

  return {
    points: [clampedStart, cp, clampedEnd],
    startBinding: { focus: 0, gap: ARROW_GAP },
    endBinding: { focus: 0, gap: ARROW_GAP },
  };
}

/** Get the exit face centre for direction-aware source attachment. */
function getExitFaceCentre(
  direction: "TD" | "LR" | "RL" | "BT" | undefined,
  sc: [number, number],
  box: BoundingBox,
): [number, number] {
  switch (direction) {
    case "TD": return [sc[0], box.y + box.h];   // exit bottom
    case "BT": return [sc[0], box.y];            // exit top
    case "LR": return [box.x + box.w, sc[1]];   // exit right
    case "RL": return [box.x, sc[1]];            // exit left
    default:   return [sc[0] + (box.w / 2), sc[1] + (box.h / 2)];
  }
}

/** Get the entry face centre for direction-aware target attachment. */
function getEntryFaceCentre(
  direction: "TD" | "LR" | "RL" | "BT" | undefined,
  tc: [number, number],
  box: BoundingBox,
): [number, number] {
  switch (direction) {
    case "TD": return [tc[0], box.y];            // enter top
    case "BT": return [tc[0], box.y + box.h];     // enter bottom
    case "LR": return [box.x, tc[1]];            // enter left
    case "RL": return [box.x + box.w, tc[1]];    // enter right
    default:   return [tc[0] + (box.w / 2), tc[1] + (box.h / 2)];
  }
}

export function routeEdge(
  routing: EdgeRouting,
  waypoints: ReadonlyArray<{ readonly x: number; readonly y: number }>,
  source: BoundingBox,
  target: BoundingBox,
  direction?: "TD" | "LR" | "RL" | "BT",
): RouteResult {
  // Self-loop: same geometry regardless of routing mode — handle first.
  if (isSameBox(source, target)) {
    return routeSelfLoop(source);
  }

  // Normalise unknown values to a canonical mode.
  const mode: EdgeRouting =
    routing === "curved" || routing === "orthogonal" || routing === "direct" ? routing
    : "auto"; // unknown strings fall back to auto

  switch (mode) {
    case "direct":      return routeDirect(waypoints, source, target);
    case "orthogonal":  return routeOrthogonal(waypoints, source, target);
    case "curved":      return routeCurved(source, target, direction, waypoints);
    default:            return routeAuto(source, target, direction);
  }
}
