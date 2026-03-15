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

  // mermaidId → Excalidraw element ID for shapes (used by arrow bindings).
  const nodeElementIds = new Map<string, string>();

  // excalidrawId → element object (mutable reference for later patching).
  const elementById = new Map<string, ExcalidrawElement>();

  // mermaidNodeId → arrowIds[] — built during edge pass, used to patch
  // shape boundElements so Excalidraw physically binds arrows to shapes.
  const nodeArrows = new Map<string, string[]>();

  function pushElement(el: ExcalidrawElement): void {
    elements.push(el);
    elementById.set(el.id, el);
  }

  // ── 1. Cluster backgrounds (rendered first) ─────────────────────────────────
  for (const cluster of parsed.clusters) {
    const cl = resolvedLayout.clusters[cluster.id];
    if (cl === undefined) continue;
    const elemId = randomUUID();
    const textId = cluster.label ? randomUUID() : null;
    pushElement({
      id: elemId,
      mermaidId: cluster.id,
      type: "rectangle",
      x: cl.x,
      y: cl.y,
      width: cl.w,
      height: cl.h,
      roughness,
      fontFamily,
      backgroundColor: cl.style?.backgroundColor,
      strokeColor: cl.style?.strokeColor,
      strokeWidth: cl.style?.strokeWidth,
      boundElements: textId ? [{ id: textId, type: "text" }] : null,
    });
    if (textId && cluster.label) {
      // Pin the label to the top of the cluster box (8px padding) rather than
      // centering vertically — matches the conventional subgraph title position.
      pushElement({
        id: textId,
        mermaidId: `${cluster.id}:text`,
        type: "text",
        x: cl.x,
        y: cl.y + 8,
        width: cl.w,
        height: 20,
        roughness,
        fontFamily,
        label: cluster.label,
        containerId: elemId,
      });
    }
  }

  // ── 2. Node shapes ──────────────────────────────────────────────────────────
  for (const [nodeId, node] of parsed.nodes) {
    const nl = resolvedLayout.nodes[nodeId];
    if (nl === undefined) continue;
    const shapeProps = getShapeProps(node.shape);
    const elemId = randomUUID();
    nodeElementIds.set(nodeId, elemId);
    const textId = node.label ? randomUUID() : null;
    pushElement({
      id: elemId,
      mermaidId: nodeId,
      type: shapeProps.elementType,
      x: nl.x,
      y: nl.y,
      width: nl.w,
      height: nl.h,
      roughness: nl.style?.roughness ?? roughness,
      fontFamily,
      roundness: shapeProps.roundness ?? undefined,
      backgroundColor: nl.style?.backgroundColor,
      strokeColor: nl.style?.strokeColor,
      strokeWidth: nl.style?.strokeWidth,
      // strokeStyle: prefer explicit strokeStyle; fall back to strokeDash boolean.
      strokeStyle: nl.style?.strokeStyle ?? (nl.style?.strokeDash ? "dashed" : undefined),
      fillStyle: nl.style?.fillStyle,
      opacity: nl.style?.opacity,
      boundElements: textId ? [{ id: textId, type: "text" }] : null,
    });
    if (textId && node.label) {
      const textFontSize = nl.style?.fontSize ?? 16;
      pushElement({
        id: textId,
        mermaidId: `${nodeId}:text`,
        type: "text",
        x: nl.x,
        y: nl.y + Math.floor((nl.h - textFontSize * 1.25) / 2),
        width: nl.w,
        height: Math.ceil(textFontSize * 1.25),
        roughness: nl.style?.roughness ?? roughness,
        fontFamily: nl.style?.fontFamily ?? fontFamily,
        fontSize: textFontSize,
        label: node.label,
        strokeColor: nl.style?.fontColor,
        containerId: elemId,
      });
    }
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

    // Excalidraw arrow points must be relative to the element's x,y.
    // Use the first absolute point as the element origin, then subtract.
    const absPoints = routeResult.points;
    const ox = absPoints[0]![0];
    const oy = absPoints[0]![1];
    const relPoints: ReadonlyArray<[number, number]> = absPoints.map(
      ([px, py]) => [px - ox, py - oy] as [number, number],
    );

    // Pre-generate the arrow ID so we can reference it in shape boundElements.
    const arrowId = randomUUID();
    // If this edge has a label, pre-generate its text ID so we can cross-reference
    // the arrow and the text element (Excalidraw requires mutual binding).
    const labelTextId = edge.label ? randomUUID() : null;

    // Track this arrow against its source and target nodes for boundElements patching.
    for (const nid of [edge.from, edge.to]) {
      const arr = nodeArrows.get(nid) ?? [];
      arr.push(arrowId);
      nodeArrows.set(nid, arr);
    }

    const fromElemId = nodeElementIds.get(edge.from);
    const toElemId = nodeElementIds.get(edge.to);

    elements.push({
      id: arrowId,
      mermaidId: key,
      type: "arrow",
      x: ox,
      y: oy,
      width: 0,
      height: 0,
      roughness,
      fontFamily,
      points: relPoints,
      startBinding: fromElemId && routeResult.startBinding
        ? { elementId: fromElemId, ...routeResult.startBinding }
        : null,
      endBinding: toElemId && routeResult.endBinding
        ? { elementId: toElemId, ...routeResult.endBinding }
        : null,
      // Bind the label text element so Excalidraw tracks and moves it with the arrow.
      boundElements: labelTextId ? [{ id: labelTextId, type: "text" }] : null,
    });

    if (edge.label && labelTextId) {
      // containerId = arrowId causes Excalidraw to auto-position the label at
      // the arrow midpoint and keep it there when the arrow is moved.
      elements.push({
        id: labelTextId,
        mermaidId: `${key}:label`,
        type: "text",
        x: ox,
        y: oy,
        width: 120,
        height: 20,
        roughness,
        fontFamily,
        label: edge.label,
        containerId: arrowId,
      });
    }
  }

  // ── 4. Patch shape boundElements with arrow IDs ──────────────────────────────
  // Excalidraw requires arrows to be listed in the shape's boundElements for
  // the arrow to physically connect (move with the shape when dragged).
  for (const [nodeId, arrowIds] of nodeArrows) {
    const elemId = nodeElementIds.get(nodeId);
    if (!elemId) continue;
    const elem = elementById.get(elemId);
    if (!elem) continue;
    const existing = elem.boundElements ?? [];
    elem.boundElements = [
      ...existing,
      ...arrowIds.map((id) => ({ id, type: "arrow" as const })),
    ];
  }

  return { elements, layout: resolvedLayout };
}
