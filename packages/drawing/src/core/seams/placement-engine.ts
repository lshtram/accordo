/**
 * DRW-R11..R16 — Deterministic placement engine for newly added nodes.
 *
 * Rules:
 * - DRW-R12: No randomness — same inputs always produce identical coordinates.
 * - DRW-R13: Anchor-based placement for connected nodes (within MAIN_GAP_PX).
 * - DRW-R14: Frontier placement (below scene) when no anchor exists.
 * - DRW-R15: Collision detection with PLACEMENT_COLLISION_MARGIN_PX.
 * - DRW-R16: bootstrap engine selected when scene has no active managed elements.
 *
 * Source: docs/20-requirements/requirements-drawing.md §4 (DRW-R11..R16)
 * Source: docs/10-architecture/drawing-architecture.md §5
 * Requirements: DRW-R11, DRW-R12, DRW-R13, DRW-R14, DRW-R15, DRW-R16
 */

import type { SourceGraph, SceneElement, MergePlan } from "../types.js";
import {
  PLACEMENT_GRID_PX,
  PLACEMENT_MAIN_GAP_PX,
  PLACEMENT_COMPONENT_GAP_PX,
  PLACEMENT_COLLISION_MARGIN_PX,
  PLACEMENT_SEARCH_MAX_STEPS,
} from "../types.js";

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * DRW-R11 — Place newly added elements using the accordo engine.
 *
 * Returns a new MergePlan with `added` elements assigned concrete coordinates.
 * The bootstrap engine (scene with no active managed) is a no-op — placement
 * happens only during incremental merge into existing scenes.
 */
export function placeNewNodes(plan: MergePlan, source: SourceGraph): MergePlan {
  if (plan.added.length === 0) return plan;
  if (plan.placementEngine === "bootstrap") return plan;

  // Build adjacency list for anchor search
  const adjacency = buildAdjacency(source);

  // Find anchor for each added node (connected preserved element)
  const anchors = new Map<string, SceneElement | null>();
  for (const el of plan.added) {
    const identity = el.customData?.accordo?.identity ?? "";
    anchors.set(identity, findNearestAnchor(identity, plan.preserved, source, adjacency));
  }

  // All occupied elements (preserved + unmanaged) for collision detection
  const baseOccupied = [...plan.preserved, ...plan.unmanaged];
  const placed: SceneElement[] = [];

  // Place each node
  for (const el of plan.added) {
    const identity = el.customData?.accordo?.identity ?? "";
    const anchor = anchors.get(identity) ?? null;

    let baseX: number;
    let baseY: number;

    if (anchor) {
      // DRW-R13: anchor-based placement — right of anchor at MAIN_GAP_PX
      baseX = anchor.x + PLACEMENT_MAIN_GAP_PX;
      baseY = anchor.y;
    } else {
      // DRW-R14: frontier placement — below scene at component gap
      const sceneMaxY = [...baseOccupied, ...placed].reduce(
        (m, e) => Math.max(m, e.y + (e.height ?? 40)), 0
      );
      baseX = PLACEMENT_MAIN_GAP_PX;
      baseY = sceneMaxY + PLACEMENT_COMPONENT_GAP_PX;
    }

    const w = el.width ?? 100;
    const h = el.height ?? 40;
    const { x, y } = resolveCollision(baseX, baseY, w, h, baseOccupied, placed);
    placed.push({ ...el, x, y });
  }

  return {
    ...plan,
    added: placed,
    counts: { ...plan.counts, added: placed.length },
  };
}

// ── Anchor search ────────────────────────────────────────────────────────────

function buildAdjacency(source: SourceGraph): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  for (const edge of source.edges) {
    if (!adj.has(edge.from)) adj.set(edge.from, new Set());
    if (!adj.has(edge.to)) adj.set(edge.to, new Set());
    adj.get(edge.from)!.add(edge.to);
    adj.get(edge.to)!.add(edge.from);
  }
  return adj;
}

/**
 * DRW-R13 — BFS anchor search up to depth 3.
 * Returns the first preserved element whose identity matches or is a neighbor.
 */
function findNearestAnchor(
  nodeId: string,
  preserved: SceneElement[],
  source: SourceGraph,
  adjacency: Map<string, Set<string>>
): SceneElement | null {
  if (preserved.length === 0) return null;

  const visited = new Set<string>();
  const queue: Array<{ id: string; depth: number }> = [{ id: nodeId, depth: 0 }];

  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    if (depth > 3) continue;

    const found = preserved.find(p => p.customData?.accordo?.identity === id);
    if (found) return found;

    const neighbors = adjacency.get(id);
    if (neighbors) {
      for (const n of neighbors) {
        if (!visited.has(n)) queue.push({ id: n, depth: depth + 1 });
      }
    }
  }

  return null;
}

// ── Collision resolution ─────────────────────────────────────────────────────

/**
 * DRW-R15 — Slot search: step 0 (ideal), then alternating ±grid, ±2*grid, ...
 * DRW-R12: deterministic — same step always gives same slot.
 */
function resolveCollision(
  baseX: number,
  baseY: number,
  w: number,
  h: number,
  baseOccupied: SceneElement[],
  placed: SceneElement[]
): { x: number; y: number } {
  const combined = [...baseOccupied, ...placed];
  for (let step = 0; step < PLACEMENT_SEARCH_MAX_STEPS; step++) {
    const { x, y } = getSlot(baseX, baseY, step);
    if (!combined.some(el => rectanglesOverlap(
      x - PLACEMENT_COLLISION_MARGIN_PX,
      y - PLACEMENT_COLLISION_MARGIN_PX,
      w + 2 * PLACEMENT_COLLISION_MARGIN_PX,
      h + 2 * PLACEMENT_COLLISION_MARGIN_PX,
      el.x,
      el.y,
      el.width ?? 100,
      el.height ?? 40
    ))) {
      return { x, y };
    }
  }
  return getSlot(baseX, baseY, PLACEMENT_SEARCH_MAX_STEPS - 1);
}

/** DRW-R12 — Stable slot formula: even steps (+offset), odd steps (-offset). */
function getSlot(baseX: number, baseY: number, step: number): { x: number; y: number } {
  const sign = step % 2 === 0 ? 1 : -1;
  const offset = (Math.floor(step / 2) + 1) * PLACEMENT_GRID_PX;
  return { x: baseX + sign * offset, y: baseY };
}

function rectanglesOverlap(
  ax: number, ay: number, aw: number, ah: number,
  bx: number, by: number, bw: number, bh: number
): boolean {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}