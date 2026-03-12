/**
 * A10 — Canvas generator
 *
 * Converts (ParsedDiagram + LayoutStore) → CanvasScene.
 *
 * Render order: cluster backgrounds → node shapes → edge arrows (+ labels).
 *
 * Unplaced nodes (layout.unplaced[]) are resolved via placeNodes() (A6) before
 * rendering.  The returned CanvasScene.layout has unplaced[] cleared.
 *
 * Every element produced receives:
 *   roughness  = layout.aesthetics.roughness ?? 1
 *   fontFamily = "Excalifont"
 *
 * Delegates to:
 *   getShapeProps()  (A8) — NodeShape → Excalidraw element type + dims
 *   routeEdge()      (A9) — routing mode → point path + bindings
 *   placeNodes()     (A6) — unplaced nodes → collision-free positions
 *
 * Pure function: no disk I/O, no side effects.
 *
 * Source: diag_arch_v4.2.md §9.3, diag_workplan.md §5 A8–A10
 */

import { randomUUID } from "crypto";
import type {
  ParsedDiagram,
  LayoutStore,
  CanvasScene,
  ExcalidrawElement,
} from "../types.js";
import { placeNodes } from "../reconciler/placement.js";
import { getShapeProps } from "./shape-map.js";
import { routeEdge } from "./edge-router.js";

/** Build the EdgeKey string for a given edge. */
function edgeKey(from: string, to: string, ordinal: number): string {
  return `${from}->${to}:${ordinal}`;
}

/**
 * Generate an Excalidraw canvas scene from a parsed diagram and its layout.
 *
 * @param parsed  Parsed diagram graph (nodes, edges, clusters, renames).
 * @param layout  Current layout store (may contain nodes in unplaced[]).
 * @returns       CanvasScene: all elements in render order + updated layout.
 */
export function generateCanvas(
  parsed: ParsedDiagram,
  layout: LayoutStore,
): CanvasScene {
  // ── Resolve unplaced nodes via A6 placeNodes ────────────────────────────────
  let resolvedLayout: LayoutStore = {
    ...layout,
    nodes: { ...layout.nodes },
    edges: { ...layout.edges },
    clusters: { ...layout.clusters },
    unplaced: [...layout.unplaced],
  };

  if (resolvedLayout.unplaced.length > 0) {
    const placedMap = placeNodes(resolvedLayout.unplaced, parsed, resolvedLayout);
    const placedRecord: LayoutStore["nodes"] = {};
    for (const [id, nl] of placedMap) {
      placedRecord[id] = { ...nl, style: {} };
    }
    resolvedLayout = { ...resolvedLayout, nodes: { ...resolvedLayout.nodes, ...placedRecord }, unplaced: [] };
  } else {
    resolvedLayout = { ...resolvedLayout, unplaced: [] };
  }

  const roughness = resolvedLayout.aesthetics?.roughness ?? 1;
  const fontFamily = "Excalifont";
  const elements: ExcalidrawElement[] = [];

  // ── 1. Cluster backgrounds (rendered first) ─────────────────────────────────
  for (const cluster of parsed.clusters) {
    const cl = resolvedLayout.clusters[cluster.id];
    if (cl === undefined) continue;
    elements.push({
      id: randomUUID(),
      mermaidId: cluster.id,
      type: "rectangle",
      x: cl.x,
      y: cl.y,
      width: cl.w,
      height: cl.h,
      roughness,
      fontFamily,
      label: cluster.label,
      backgroundColor: cl.style?.backgroundColor,
      strokeColor: cl.style?.strokeColor,
    });
  }

  // ── 2. Node shapes ──────────────────────────────────────────────────────────
  for (const [nodeId, node] of parsed.nodes) {
    const nl = resolvedLayout.nodes[nodeId];
    if (nl === undefined) continue;
    const shapeProps = getShapeProps(node.shape);
    elements.push({
      id: randomUUID(),
      mermaidId: nodeId,
      type: shapeProps.elementType,
      x: nl.x,
      y: nl.y,
      width: nl.w,
      height: nl.h,
      roughness,
      fontFamily,
      label: node.label,
      roundness: shapeProps.roundness ?? undefined,
    });
  }

  // ── 3. Edges ────────────────────────────────────────────────────────────────
  for (const edge of parsed.edges) {
    const fromLayout = resolvedLayout.nodes[edge.from];
    const toLayout = resolvedLayout.nodes[edge.to];
    if (fromLayout === undefined || toLayout === undefined) continue;

    const key = edgeKey(edge.from, edge.to, edge.ordinal);
    const edgeL = resolvedLayout.edges[key];
    const routing = edgeL?.routing ?? "auto";
    const waypoints = edgeL?.waypoints ?? [];

    const sourceBB = { x: fromLayout.x, y: fromLayout.y, w: fromLayout.w, h: fromLayout.h };
    const targetBB = { x: toLayout.x, y: toLayout.y, w: toLayout.w, h: toLayout.h };

    const routeResult = routeEdge(routing, waypoints, sourceBB, targetBB);

    elements.push({
      id: randomUUID(),
      mermaidId: key,
      type: "arrow",
      x: sourceBB.x,
      y: sourceBB.y,
      width: 0,
      height: 0,
      roughness,
      fontFamily,
      points: routeResult.points as ReadonlyArray<[number, number]>,
    });

    if (edge.label) {
      elements.push({
        id: randomUUID(),
        mermaidId: `${key}:label`,
        type: "text",
        x: sourceBB.x,
        y: sourceBB.y,
        width: 120,
        height: 24,
        roughness,
        fontFamily,
        label: edge.label,
      });
    }
  }

  return { elements, layout: resolvedLayout };
}
