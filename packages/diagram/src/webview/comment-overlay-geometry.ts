/**
 * G-2 — Edge hit-testing geometry helpers.
 *
 * Pure geometry functions with no browser dependencies.
 * These are imported by comment-overlay.ts and tested here directly.
 *
 * Requirements: docs/reviews/g2-edge-hit-testing-phase2.md §7–§8
 */

/**
 * Scene-space threshold (px) for edge hit-testing.
 * Consistent with ARROW_GAP in edge-router.ts.
 */
export const EDGE_HIT_THRESHOLD = 8;

/**
 * Squared distance from point (px, py) to segment (ax, ay) → (bx, by).
 * Uses squared distance to avoid sqrt — compare squared threshold to avoid the cost.
 */
function pointSegDistSq(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    // Degenerate zero-length segment — fall back to point distance
    const dpx = px - ax;
    const dpy = py - ay;
    return dpx * dpx + dpy * dpy;
  }
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  const dx2 = px - (ax + t * dx);
  const dy2 = py - (ay + t * dy);
  return dx2 * dx2 + dy2 * dy2;
}

/**
 * Whether the click point is within EDGE_HIT_THRESHOLD scene-pixels of the
 * edge polyline defined by el.x/el.y + el.points.
 *
 * Guarded against absent / empty / single-point points arrays.
 */
export function hitsEdgePolyline(
  sceneX: number, sceneY: number,
  el: { x: number; y: number; points?: ReadonlyArray<readonly [number, number]> },
): boolean {
  const pts = el.points;
  if (!pts || pts.length < 2) return false;
  const thresholdSq = EDGE_HIT_THRESHOLD * EDGE_HIT_THRESHOLD;
  for (let i = 0; i < pts.length - 1; i++) {
    const ax = el.x + pts[i]![0];
    const ay = el.y + pts[i]![1];
    const bx = el.x + pts[i + 1]![0];
    const by = el.y + pts[i + 1]![1];
    if (pointSegDistSq(sceneX, sceneY, ax, ay, bx, by) <= thresholdSq) {
      return true;
    }
  }
  return false;
}

/**
 * Compute the absolute scene-space midpoint of the edge polyline by walking
 * half the total arc length. Handles self-loops correctly (apex midpoint, not
 * middle-vertex midpoint).
 *
 * Guarded against absent / empty / degenerate points arrays.
 * Returns el.x, el.y (first point) as fallback when total length is zero.
 */
export function edgePolylineMidpoint(
  el: { x: number; y: number; points?: ReadonlyArray<readonly [number, number]> },
): { x: number; y: number } {
  const pts = el.points;
  if (!pts || pts.length < 2) return { x: el.x, y: el.y };

  // Compute segment lengths
  const segLens: number[] = [];
  let totalLen = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const ax = el.x + pts[i]![0];
    const ay = el.y + pts[i]![1];
    const bx = el.x + pts[i + 1]![0];
    const by = el.y + pts[i + 1]![1];
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.sqrt(dx * dx + dy * dy);
    segLens.push(len);
    totalLen += len;
  }

  if (totalLen === 0) return { x: el.x, y: el.y };

  const half = totalLen / 2;
  let walk = 0;
  for (let i = 0; i < segLens.length; i++) {
    const remaining = half - walk;
    if (remaining <= 0) {
      // Half-point landed exactly on a prior vertex — clamp to P[i] (current segment start)
      return { x: el.x + pts[i]![0], y: el.y + pts[i]![1] };
    }
    if (walk + segLens[i]! >= half) {
      // Half-point is inside or at the end of this segment
      const t = segLens[i] === 0 ? 0 : remaining / segLens[i]!;
      const ax = el.x + pts[i]![0];
      const ay = el.y + pts[i]![1];
      const bx = el.x + pts[i + 1]![0];
      const by = el.y + pts[i + 1]![1];
      return {
        x: ax + t * (bx - ax),
        y: ay + t * (by - ay),
      };
    }
    walk += segLens[i]!;
  }

  // Fallback (should not reach here with well-formed data)
  return { x: el.x, y: el.y };
}
