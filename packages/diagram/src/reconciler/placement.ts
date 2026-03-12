/**
 * A6 — Unplaced node placement with collision avoidance
 *
 * Implements the placement strategy from diag_arch_v4.2.md §7.3.
 * Assigns (x, y, w, h) to nodes that have no position in the layout store.
 *
 * Known limitation (deferred to diag.4): when a new node is topologically
 * inserted between two already-placed nodes that have insufficient gap, the
 * placer positions it adjacent to the nearest neighbour rather than splitting
 * the existing gap. The human can drag it to the preferred location afterward.
 *
 * Source: diag_arch_v4.2.md §7.3, diag_workplan.md §5 A6
 */

import type { ParsedDiagram, LayoutStore } from "../types.js";

/**
 * Compute collision-free positions for nodes that have no layout entry yet.
 *
 * Algorithm (arch §7.3):
 *   1. For each unplaced node, find connected neighbours with positions.
 *   2. If neighbours exist → candidate = adjacent to nearest neighbour in flow
 *      direction, at 1.5× nodeSpacing.
 *   3. If no neighbours → first open grid cell scanning from top-left.
 *   4. Collision avoidance pass after all candidates are computed; max 10
 *      shift iterations per node.
 *
 * Node dimensions default to shape-specific sizes:
 *   rectangle/rounded/stadium/parallelogram → 180 × 60
 *   diamond/hexagon → 140 × 80
 *   circle/ellipse  → 80 × 80
 *   cylinder        → 120 × 80
 *   unknown         → 180 × 60  (fallback)
 *
 * @param unplacedIds     Node IDs to position (must exist in parsed.nodes;
 *                        IDs absent from parsed.nodes are silently skipped).
 * @param parsed          Current parsed diagram (provides edges for neighbour
 *                        lookup and node shapes for sizing).
 * @param existingLayout  Current layout store (read-only; not mutated).
 * @param options.direction   Flow direction — "TD" (default) or "LR".
 * @param options.nodeSpacing Gap in pixels between placed node and neighbour;
 *                            default 60.
 * @returns Map from nodeId → { x, y, w, h } for the newly placed nodes only.
 *          The caller is responsible for merging these into layout.nodes and
 *          clearing layout.unplaced.
 */
// ── Shape dimensions (independent of A8 shape-map — no cross-module import) ──

/** Default node dimensions by shape. Unknown shapes fall back to FALLBACK_DIMS. */
const SHAPE_DIMS: Record<string, { w: number; h: number }> = {
  rectangle:    { w: 180, h: 60 },
  rounded:      { w: 180, h: 60 },
  stadium:      { w: 180, h: 60 },
  parallelogram:{ w: 180, h: 60 },
  diamond:      { w: 140, h: 80 },
  hexagon:      { w: 140, h: 80 },
  circle:       { w: 80,  h: 80 },
  ellipse:      { w: 80,  h: 80 },
  cylinder:     { w: 120, h: 80 },
  subgraph:     { w: 200, h: 120 },
};
const FALLBACK_DIMS = { w: 180, h: 60 };

function dimForShape(shape: string): { w: number; h: number } {
  return SHAPE_DIMS[shape] ?? FALLBACK_DIMS;
}

function rectsOverlap(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number }
): boolean {
  return !(
    a.x + a.w <= b.x ||
    b.x + b.w <= a.x ||
    a.y + a.h <= b.y ||
    b.y + b.h <= a.y
  );
}

export function placeNodes(
  unplacedIds: string[],
  parsed: ParsedDiagram,
  existingLayout: LayoutStore,
  options?: {
    direction?: "TD" | "LR";
    nodeSpacing?: number;
  }
): Map<string, { x: number; y: number; w: number; h: number }> {
  const direction = options?.direction ?? "TD";
  const nodeSpacing = options?.nodeSpacing ?? 60;

  const result = new Map<string, { x: number; y: number; w: number; h: number }>();

  // Mutable view of all placed positions: existing + newly placed in this batch.
  // We read shapes from existingLayout but do not mutate it.
  const allPlaced = new Map<string, { x: number; y: number; w: number; h: number }>();
  for (const [id, nl] of Object.entries(existingLayout.nodes)) {
    allPlaced.set(id, { x: nl.x, y: nl.y, w: nl.w, h: nl.h });
  }

  for (const nodeId of unplacedIds) {
    const parsedNode = parsed.nodes.get(nodeId);
    if (!parsedNode) continue; // silently skip absent IDs

    // NodeShape is an open union (string | named literals); cast to string
    // is safe — we're widening to the type the union already extends.
    const { w, h } = dimForShape(parsedNode.shape as string);

    // Find nearest positioned neighbour (by distance of its centre from canvas origin).
    // Known limitation (deferred to diag.4): when a new node is topologically between
    // two placed nodes with insufficient gap, this places it adjacent to the nearest
    // neighbour rather than splitting the existing gap.
    let nearestNeighbour: { x: number; y: number; w: number; h: number } | null = null;
    let nearestDist = Infinity;
    for (const edge of parsed.edges) {
      const nbId = edge.from === nodeId ? edge.to
                 : edge.to   === nodeId ? edge.from
                 : undefined;
      if (nbId === undefined) continue;
      const pos = allPlaced.get(nbId);
      if (!pos) continue;
      const dist = Math.hypot(pos.x + pos.w / 2, pos.y + pos.h / 2);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestNeighbour = pos;
      }
    }

    // Compute initial candidate position.
    let candX: number;
    let candY: number;
    if (nearestNeighbour) {
      if (direction === "LR") {
        candX = nearestNeighbour.x + nearestNeighbour.w + nodeSpacing;
        candY = nearestNeighbour.y;
      } else {
        candX = nearestNeighbour.x;
        candY = nearestNeighbour.y + nearestNeighbour.h + nodeSpacing;
      }
    } else {
      // Grid fallback: start at origin, shift will find the first open cell.
      candX = 0;
      candY = 0;
    }

    // Collision avoidance: shift in the flow direction until clear, max 10 iterations.
    for (let iter = 0; iter < 10; iter++) {
      let overlapping = false;
      for (const placed of allPlaced.values()) {
        if (rectsOverlap({ x: candX, y: candY, w, h }, placed)) {
          overlapping = true;
          break;
        }
      }
      if (!overlapping) break;
      if (direction === "LR") {
        candX += w + nodeSpacing;
      } else {
        candY += h + nodeSpacing;
      }
    }

    const placed = { x: candX, y: candY, w, h };
    result.set(nodeId, placed);
    allPlaced.set(nodeId, placed); // visible to subsequent nodes in this batch
  }

  return result;
}
