/**
 * Excalidraw layout engine adapter.
 *
 * Calls @excalidraw/mermaid-to-excalidraw with raw Mermaid source,
 * then maps the output geometry back to Accordo's LayoutStore format
 * using the element-mapper.
 *
 * This is a pluggable alternative to layoutWithDagre() — same output
 * contract (LayoutStore). Input: raw Mermaid source + ParsedDiagram.
 *
 * Source: docs/30-development/diagram-update-plan.md §7.3
 */

import type { EdgeLayout, LayoutStore, ParsedDiagram, SpatialDiagramType } from "../types.js";
import { createEmptyLayout } from "./layout-store.js";
import { extractGeometry, mapGeometryToLayout } from "./element-mapper.js";
import { layoutWithDagre } from "./auto-layout.js";
import { renderUpstreamDirect } from "./upstream-direct.js";

type ExcalidrawElementSkeleton = Record<string, unknown>;

const STATE_LAYOUT_SCALE = 1.5;

// ── Geometry helpers ────────────────────────────────────────────────────────────

function edgeKey(from: string, to: string, ordinal: number): string {
  return `${from}->${to}:${ordinal}`;
}

function isArrowElement(element: ExcalidrawElementSkeleton): boolean {
  return element.type === "arrow" && Array.isArray(element.points);
}

function toAbsolutePoints(
  element: ExcalidrawElementSkeleton,
): ReadonlyArray<{ readonly x: number; readonly y: number }> {
  const x = Number(element.x) || 0;
  const y = Number(element.y) || 0;
  const points = Array.isArray(element.points) ? element.points : [];
  return points
    .filter((point): point is [number, number] => (
      Array.isArray(point)
      && point.length >= 2
      && Number.isFinite(Number(point[0]))
      && Number.isFinite(Number(point[1]))
    ))
    .map(([px, py]) => ({ x: x + Number(px), y: y + Number(py) }));
}

function pointDistance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

function getBox(box: Box | undefined): Box | null {
  return box ?? null;
}

function getCentre(box: Box | undefined): { x: number; y: number } | null {
  if (!box) return null;
  return { x: box.x + box.w / 2, y: box.y + box.h / 2 };
}

/**
 * Find the closest point on the perimeter of `box` to `towards`.
 */
function anchorOnBox(box: Box, towards: { x: number; y: number }): { x: number; y: number } {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const dx = towards.x - cx;
  const dy = towards.y - cy;
  if (dx === 0 && dy === 0) {
    return { x: cx, y: cy };
  }
  const halfW = box.w / 2;
  const halfH = box.h / 2;
  const tx = dx === 0 ? Number.POSITIVE_INFINITY : halfW / Math.abs(dx);
  const ty = dy === 0 ? Number.POSITIVE_INFINITY : halfH / Math.abs(dy);
  const t = Math.min(tx, ty);
  return { x: cx + dx * t, y: cy + dy * t };
}

// ── Improved scoring: perimeter-anchor distance ─────────────────────────────────

/**
 * Score how well an arrow fits an edge.
 *
 * Uses perimeter-anchor distance (not centre distance):
 * - Expected start = closest perimeter point on source box to target centre
 * - Expected end   = closest perimeter point on target box to source centre
 * - Score = endpoint distance to expected anchors + direction similarity bonus
 *
 * Lower score = better match.
 */
function scoreArrowMatch(
  arrowPts: readonly { x: number; y: number }[],
  sourceBox: Box | null,
  targetBox: Box | null,
): number {
  if (arrowPts.length < 2 || !sourceBox || !targetBox) {
    return Number.POSITIVE_INFINITY;
  }

  const sourceCentre = getCentre(sourceBox)!;
  const targetCentre = getCentre(targetBox)!;

  // Perimeter anchor: closest point on source perimeter to target centre
  const expectedStart = anchorOnBox(sourceBox, targetCentre);
  // Perimeter anchor: closest point on target perimeter to source centre
  const expectedEnd = anchorOnBox(targetBox, sourceCentre);

  const arrowStart = arrowPts[0]!;
  const arrowEnd = arrowPts[arrowPts.length - 1]!;

  const endpointPenalty =
    pointDistance(arrowStart, expectedStart) +
    pointDistance(arrowEnd, expectedEnd);

  // Direction similarity: penalise arrows whose vector doesn't align with
  // the source→target direction
  const expDx = expectedEnd.x - expectedStart.x;
  const expDy = expectedEnd.y - expectedStart.y;
  const actDx = arrowEnd.x - arrowStart.x;
  const actDy = arrowEnd.y - arrowStart.y;
  const expMag = Math.hypot(expDx, expDy);
  const actMag = Math.hypot(actDx, actDy);
  const directionPenalty =
    expMag > 0 && actMag > 0
      ? (1 - Math.max(-1, Math.min(1,
          (expDx * actDx + expDy * actDy) / (expMag * actMag)
        ))) * 80
      : 0;

  // Locality bonus: if arrow is entirely inside the union box of source+target,
  // reduce score slightly (prefers arrows that stay local)
  const unionX = Math.min(sourceBox.x, targetBox.x);
  const unionY = Math.min(sourceBox.y, targetBox.y);
  const unionR = Math.max(sourceBox.x + sourceBox.w, targetBox.x + targetBox.w);
  const unionB = Math.max(sourceBox.y + sourceBox.h, targetBox.y + targetBox.h);
  const overflow = Math.max(0, Math.min(...arrowPts.map(p => p.x)) - unionX)
    + Math.max(0, unionR - Math.max(...arrowPts.map(p => p.x)))
    + Math.max(0, Math.min(...arrowPts.map(p => p.y)) - unionY)
    + Math.max(0, unionB - Math.max(...arrowPts.map(p => p.y)));

  return endpointPenalty + directionPenalty + overflow * 0.5;
}

// ── Greedy assignment with improved scoring (stable, no infinite loops) ─────────

/**
 * Assign edges to arrows using greedy matching with the improved perimeter-anchor
 * scoring. Uses a fresh score computation per edge (no cumulative state corruption).
 *
 * This avoids the Hungarian algorithm's infinite-loop failure mode when rows
 * are entirely INF, while providing correct perimeter-anchor matching.
 */
function buildStateEdgeLayout(
  elements: readonly ExcalidrawElementSkeleton[],
  parsed: ParsedDiagram,
  dagreLayout: LayoutStore,
  mappedNodes: LayoutStore["nodes"],
  mappedClusters: LayoutStore["clusters"],
): LayoutStore["edges"] {
  const edges: LayoutStore["edges"] = { ...dagreLayout.edges };
  if (parsed.type !== "stateDiagram-v2") {
    return edges;
  }

  const arrowPool = elements
    .filter(isArrowElement)
    .map((element) => ({ element, points: toAbsolutePoints(element) }))
    .filter(({ points }) => points.length >= 2);

  if (arrowPool.length === 0 || parsed.edges.length === 0) {
    return edges;
  }

  // Build box lookup for each edge (compute once, reuse)
  const edgeBoxes = parsed.edges.map((edge) => ({
    sourceBox: getBox(
      mappedNodes[edge.from]
      ?? dagreLayout.nodes[edge.from]
      ?? mappedClusters[edge.from]
      ?? dagreLayout.clusters[edge.from]
    ) as Box | null,
    targetBox: getBox(
      mappedNodes[edge.to]
      ?? dagreLayout.nodes[edge.to]
      ?? mappedClusters[edge.to]
      ?? dagreLayout.clusters[edge.to]
    ) as Box | null,
  }));

  // Pre-compute all scores: scores[edgeIdx][arrowIdx]
  const scores: number[][] = parsed.edges.map((_, ei) =>
    arrowPool.map((_, ai) => {
      const { sourceBox, targetBox } = edgeBoxes[ei]!;
      if (!sourceBox || !targetBox) return Number.POSITIVE_INFINITY;
      return scoreArrowMatch(arrowPool[ai]!.points, sourceBox, targetBox);
    })
  );

  // Greedy assignment: pick best available arrow for each edge in order
  const usedArrowIndexes = new Set<number>();

  for (let ei = 0; ei < parsed.edges.length; ei++) {
    const { sourceBox, targetBox } = edgeBoxes[ei]!;
    if (!sourceBox || !targetBox) continue;

    let bestMatchIndex = -1;
    let bestScore = Number.POSITIVE_INFINITY;

    for (let ai = 0; ai < arrowPool.length; ai++) {
      if (usedArrowIndexes.has(ai)) continue;
      const sc = scores[ei]![ai]!;
      if (sc < bestScore) {
        bestScore = sc;
        bestMatchIndex = ai;
      }
    }

    if (bestMatchIndex === -1) continue;

    usedArrowIndexes.add(bestMatchIndex);
    const edge = parsed.edges[ei]!;
    const key = edgeKey(edge.from, edge.to, edge.ordinal);
    const matched = arrowPool[bestMatchIndex]!;

    edges[key] = {
      ...(edges[key] ?? ({ routing: "auto", waypoints: [], style: {} } satisfies EdgeLayout)),
      routing: matched.points.length > 2 ? "direct" : "auto",
      waypoints: matched.points.slice(1, -1),
    };
  }

  return edges;
}

// ── scaleStateLayout and layoutWithExcalidraw ─────────────────────────────────

function scaleStateLayout(layout: LayoutStore, parsed: ParsedDiagram): LayoutStore {
  if (parsed.type !== "stateDiagram-v2") {
    return layout;
  }

  return {
    ...layout,
    nodes: Object.fromEntries(
      Object.entries(layout.nodes).map(([nodeId, node]) => [
        nodeId,
        {
          ...node,
          x: node.x * STATE_LAYOUT_SCALE,
          y: node.y * STATE_LAYOUT_SCALE,
          w: node.w * STATE_LAYOUT_SCALE,
          h: node.h * STATE_LAYOUT_SCALE,
        },
      ]),
    ),
    edges: Object.fromEntries(
      Object.entries(layout.edges).map(([edgeId, edge]) => [
        edgeId,
        {
          ...edge,
          waypoints: edge.waypoints.map((waypoint) => ({
            x: waypoint.x * STATE_LAYOUT_SCALE,
            y: waypoint.y * STATE_LAYOUT_SCALE,
          })),
        },
      ]),
    ),
    clusters: Object.fromEntries(
      Object.entries(layout.clusters).map(([clusterId, cluster]) => [
        clusterId,
        {
          ...cluster,
          x: cluster.x * STATE_LAYOUT_SCALE,
          y: cluster.y * STATE_LAYOUT_SCALE,
          w: cluster.w * STATE_LAYOUT_SCALE,
          h: cluster.h * STATE_LAYOUT_SCALE,
        },
      ]),
    ),
  };
}

/**
 * Compute a LayoutStore for a flowchart or state diagram using the
 * @excalidraw/mermaid-to-excalidraw library for geometry.
 */
export async function layoutWithExcalidraw(
  source: string,
  parsed: ParsedDiagram,
): Promise<LayoutStore> {
  if (!source || source.trim().length === 0) {
    throw new Error("layoutWithExcalidraw: source must be a non-empty string");
  }

  if (parsed.type !== "flowchart" && parsed.type !== "stateDiagram-v2") {
    throw new Error(
      `layoutWithExcalidraw: only "flowchart" and "stateDiagram-v2" types are supported, got "${parsed.type}"`
    );
  }

  const elements = await renderUpstreamDirect(source);
  const geometries = extractGeometry(elements);
  const mapping = mapGeometryToLayout(geometries, parsed);
  const base = createEmptyLayout(parsed.type as SpatialDiagramType);

  const dagreLayout = layoutWithDagre(parsed, {
    rankdir: "TB",
    nodeSpacing: 60,
    rankSpacing: 80,
  });

  const nodes: typeof dagreLayout.nodes = { ...dagreLayout.nodes };
  for (const [nodeId, layout] of Object.entries(mapping.nodes)) {
    nodes[nodeId] = layout;
  }

  return scaleStateLayout({
    ...base,
    nodes,
    edges: buildStateEdgeLayout(elements, parsed, dagreLayout, nodes, mapping.clusters),
    clusters: {
      ...dagreLayout.clusters,
      ...mapping.clusters,
    },
  }, parsed);
}