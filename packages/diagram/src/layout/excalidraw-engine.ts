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

function getCentre(box: { x: number; y: number; w: number; h: number } | undefined): { x: number; y: number } | null {
  if (!box) return null;
  return { x: box.x + box.w / 2, y: box.y + box.h / 2 };
}

function scoreArrowMatch(
  points: ReadonlyArray<{ readonly x: number; readonly y: number }>,
  sourceCentre: { x: number; y: number } | null,
  targetCentre: { x: number; y: number } | null,
): number {
  if (points.length < 2 || !sourceCentre || !targetCentre) {
    return Number.POSITIVE_INFINITY;
  }
  return pointDistance(points[0]!, sourceCentre) + pointDistance(points[points.length - 1]!, targetCentre);
}

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

  const usedArrowIndexes = new Set<number>();

  for (const edge of parsed.edges) {
    const key = edgeKey(edge.from, edge.to, edge.ordinal);
    const sourceCentre = getCentre(
      mappedNodes[edge.from]
      ?? dagreLayout.nodes[edge.from]
      ?? mappedClusters[edge.from]
      ?? dagreLayout.clusters[edge.from]
    );
    const targetCentre = getCentre(
      mappedNodes[edge.to]
      ?? dagreLayout.nodes[edge.to]
      ?? mappedClusters[edge.to]
      ?? dagreLayout.clusters[edge.to]
    );

    let bestMatchIndex = -1;
    let bestScore = Number.POSITIVE_INFINITY;

    for (let i = 0; i < arrowPool.length; i++) {
      if (usedArrowIndexes.has(i)) continue;
      const score = scoreArrowMatch(arrowPool[i]!.points, sourceCentre, targetCentre);
      if (score < bestScore) {
        bestScore = score;
        bestMatchIndex = i;
      }
    }

    if (bestMatchIndex === -1) {
      continue;
    }

    usedArrowIndexes.add(bestMatchIndex);
    const matched = arrowPool[bestMatchIndex]!;
    edges[key] = {
      ...(edges[key] ?? ({ routing: "auto", waypoints: [], style: {} } satisfies EdgeLayout)),
      routing: matched.points.length > 2 ? "direct" : "auto",
      waypoints: matched.points.slice(1, -1),
    };
  }

  return edges;
}

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
