/**
 * A6 — Unplaced node placement with collision avoidance
 *
 * Implements the placement strategy from diag_arch_v4.2.md §7.3.
 * Assigns (x, y, w, h) to nodes that have no position in the layout store.
 *
 * Algorithm (dagre-first, then nearest collision-free spot):
 *   1. Run the full mermaid → dagre layout pass on the complete diagram to get
 *      the topologically-correct "ideal" position for every node.
 *   2. For each unplaced node, find the nearest placed neighbour and compute the
 *      dagre-relative offset between them.  Applying that offset to the actual
 *      canvas position of that neighbour gives a candidate that respects the
 *      graph structure while anchoring to the existing (user-moved) layout.
 *   3. If no placed neighbour exists, use the dagre absolute position directly.
 *   4. From the candidate, search for the closest collision-free cell: first try
 *      cross-axis shifts (preserving rank → sibling placement), then the negative
 *      cross-axis direction, then the flow direction.  Max 10 steps each pass.
 *
 * When dagre is unavailable (e.g. unsupported diagram type), falls back to the
 * original neighbour-adjacent heuristic.
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
 * @param options.direction   Flow direction — "TD" (default), "LR", "BT", or "RL".
 * @param options.nodeSpacing Gap in pixels between placed node and neighbour;
 *                            default 60.
 * @returns Map from nodeId → { x, y, w, h } for the newly placed nodes only.
 *          The caller is responsible for merging these into layout.nodes and
 *          clearing layout.unplaced.
 */
import type { ParsedDiagram, LayoutStore } from "../types.js";
import { computeInitialLayout } from "../layout/auto-layout.js";

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
    direction?: "TD" | "LR" | "BT" | "RL";
    nodeSpacing?: number;
  }
): Map<string, { x: number; y: number; w: number; h: number }> {
  if (unplacedIds.length === 0) return new Map();

  const direction = options?.direction
    ?? (parsed.direction as "TD" | "LR" | "RL" | "BT" | undefined)
    ?? "TD";
  const nodeSpacing = options?.nodeSpacing ?? 60;

  // ── Step 1: Run full dagre layout pass to get ideal positions ──────────────
  // This gives us where dagre WOULD place every node if starting from scratch,
  // respecting the full graph topology (rank, sibling relationships, etc.).
  const idealPos = new Map<string, { x: number; y: number; w: number; h: number }>();
  try {
    const rankdirMap: Record<string, "TB" | "LR" | "RL" | "BT"> = { TD: "TB", BT: "BT", LR: "LR", RL: "RL" };
    const ideal = computeInitialLayout(parsed, {
      rankdir:     rankdirMap[direction] ?? "TB",
      nodeSpacing,
      rankSpacing: nodeSpacing + 20,
    });
    for (const [id, nl] of Object.entries(ideal.nodes)) {
      idealPos.set(id, { x: nl.x, y: nl.y, w: nl.w, h: nl.h });
    }
  } catch {
    // Unsupported diagram type — fall through to neighbour-adjacent heuristic.
  }

  const result = new Map<string, { x: number; y: number; w: number; h: number }>();

  // Mutable view of all placed positions: existing + newly placed in this batch.
  const allPlaced = new Map<string, { x: number; y: number; w: number; h: number }>();
  for (const [id, nl] of Object.entries(existingLayout.nodes)) {
    allPlaced.set(id, { x: nl.x, y: nl.y, w: nl.w, h: nl.h });
  }

  for (const nodeId of unplacedIds) {
    const parsedNode = parsed.nodes.get(nodeId);
    if (!parsedNode) continue; // silently skip absent IDs

    const { w, h } = dimForShape(parsedNode.shape as string);

    // ── Step 2: Compute candidate position ──────────────────────────────────
    let candX = 0;
    let candY = 0;

    const myIdeal = idealPos.get(nodeId);
    if (myIdeal) {
      // Find the nearest PLACED neighbour (in actual layout) that also has an
      // ideal-layout position, so we can anchor the relative offset.
      let bestNbActual: { x: number; y: number; w: number; h: number } | null = null;
      let bestNbIdeal:  { x: number; y: number; w: number; h: number } | null = null;
      let bestDist = Infinity;

      for (const edge of parsed.edges) {
        const nbId = edge.from === nodeId ? edge.to
                   : edge.to   === nodeId ? edge.from
                   : undefined;
        if (nbId === undefined) continue;

        const nbActual = allPlaced.get(nbId);
        if (!nbActual) continue; // neighbour not yet placed
        const nbIdeal  = idealPos.get(nbId);
        if (!nbIdeal)  continue;

        // Distance in dagre-ideal space between this node and its neighbour.
        const dist = Math.hypot(nbIdeal.x - myIdeal.x, nbIdeal.y - myIdeal.y);
        if (dist < bestDist) {
          bestDist     = dist;
          bestNbActual = nbActual;
          bestNbIdeal  = nbIdeal;
        }
      }

      if (bestNbActual && bestNbIdeal) {
        // Translate the dagre-ideal offset to actual canvas space.
        // This preserves sibling rank relationships even when the user has moved nodes.
        candX = bestNbActual.x + (myIdeal.x - bestNbIdeal.x);
        candY = bestNbActual.y + (myIdeal.y - bestNbIdeal.y);
      } else {
        // No placed neighbour — use the dagre absolute position directly.
        candX = myIdeal.x;
        candY = myIdeal.y;
      }
    } else {
      // Dagre did not produce a position (unsupported type) — fall back to
      // the original neighbour-adjacent heuristic.
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
      if (nearestNeighbour) {
        switch (direction) {
          case "LR": candX = nearestNeighbour.x + nearestNeighbour.w + nodeSpacing; candY = nearestNeighbour.y; break;
          case "RL": candX = nearestNeighbour.x - nearestNeighbour.w - nodeSpacing; candY = nearestNeighbour.y; break;
          case "BT": candX = nearestNeighbour.x;                                       candY = nearestNeighbour.y - nearestNeighbour.h - nodeSpacing; break;
          default:  candX = nearestNeighbour.x;                                       candY = nearestNeighbour.y + nearestNeighbour.h + nodeSpacing; break;
        }
      }
    }

    // ── Step 3: Find closest collision-free spot from candidate ─────────────
    // TD: cross-axis = rightward/leftward (preserves rank level)
    // LR: cross-axis = downward/upward
    let crossDx: number, crossDy: number, flowDx: number, flowDy: number;
    switch (direction) {
      case "TD": crossDx = w + nodeSpacing; crossDy = 0;               flowDx = 0;               flowDy = h + nodeSpacing; break;
      case "BT": crossDx = w + nodeSpacing; crossDy = 0;               flowDx = 0;               flowDy = -(h + nodeSpacing); break;
      case "LR": crossDx = 0;               crossDy = h + nodeSpacing; flowDx = w + nodeSpacing; flowDy = 0;               break;
      case "RL": crossDx = 0;               crossDy = h + nodeSpacing; flowDx = -(w + nodeSpacing); flowDy = 0;             break;
      default:  crossDx = w + nodeSpacing; crossDy = 0;               flowDx = 0;               flowDy = h + nodeSpacing; break;
    }

    function hasOverlap(cx: number, cy: number): boolean {
      for (const placed of allPlaced.values()) {
        if (rectsOverlap({ x: cx, y: cy, w, h }, placed)) return true;
      }
      return false;
    }

    let resolved = false;

    // Pass A: cross-axis positive direction (sibling placement preference).
    let cx = candX;
    let cy = candY;
    for (let i = 0; i < 10; i++) {
      if (!hasOverlap(cx, cy)) { candX = cx; candY = cy; resolved = true; break; }
      cx += crossDx;
      cy += crossDy;
    }

    // Pass B: cross-axis negative direction.
    if (!resolved) {
      cx = candX - crossDx;
      cy = candY - crossDy;
      for (let i = 0; i < 10; i++) {
        if (!hasOverlap(cx, cy)) { candX = cx; candY = cy; resolved = true; break; }
        cx -= crossDx;
        cy -= crossDy;
      }
    }

    // Pass C: flow-axis (last resort — further down/right).
    if (!resolved) {
      cx = candX;
      cy = candY;
      for (let i = 0; i < 10; i++) {
        if (!hasOverlap(cx, cy)) { candX = cx; candY = cy; break; }
        cx += flowDx;
        cy += flowDy;
      }
    }

    const placed = { x: candX, y: candY, w, h };
    result.set(nodeId, placed);
    allPlaced.set(nodeId, placed); // visible to subsequent nodes in this batch
  }

  return result;
}
