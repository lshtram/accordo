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
import { routeEdge, type EdgeInfo } from "./edge-router.js";

/**
 * Small perpendicular shift applied to each parallel edge's label to prevent
 * label overlap.  ±LABEL_OFFSET_PX separates bidirectional/parallel labels.
 */
const LABEL_OFFSET_PX = 15;

/** Build the EdgeKey string for a given edge. */
function edgeKey(from: string, to: string, ordinal: number): string {
  return `${from}->${to}:${ordinal}`;
}

// ── Obstacle detection for arrow routing ───────────────────────────────────────

/**
 * Check if the axis-aligned bounding box intersects the line segment p1→p2.
 * Uses the separating axis theorem for axis-aligned boxes.
 */
function boxIntersectsSegment(
  bx: number, by: number, bw: number, bh: number,
  p1: [number, number], p2: [number, number],
): boolean {
  // Check if either endpoint is inside the box
  if (p1[0]! >= bx && p1[0]! <= bx + bw && p1[1]! >= by && p1[1]! <= by + bh) return true;
  if (p2[0]! >= bx && p2[0]! <= bx + bw && p2[1]! >= by && p2[1]! <= by + bh) return true;

  // Check intersection with each box edge using cross-product method
  const minX = Math.min(p1[0]!, p2[0]!);
  const maxX = Math.max(p1[0]!, p2[0]!);
  const minY = Math.min(p1[1]!, p2[1]!);
  const maxY = Math.max(p1[1]!, p2[1]!);

  // If the bounding boxes don't overlap at all, no intersection
  if (maxX < bx || minX > bx + bw) return false;
  if (maxY < by || minY > by + bh) return false;

  // Check if the line segment crosses the box — use the bounding box of the segment
  // as a quick reject, then do precise checks
  const [ax, ay] = p1;
  const [bx2, by2] = p2;

  // For each edge of the box, check if segment crosses it
  const edges: Array<[[number, number], [number, number]]> = [
    [[bx, by], [bx + bw, by]],           // top
    [[bx + bw, by], [bx + bw, by + bh]], // right
    [[bx, by + bh], [bx, by]],           // left (going down)
    [[bx, by + bh], [bx + bw, by + bh]], // bottom
  ];

  for (const [[x1, y1], [x2, y2]] of edges) {
    if (segmentsIntersect([ax, ay], [bx2, by2], [x1, y1], [x2, y2])) {
      return true;
    }
  }

  return false;
}

function segmentsIntersect(
  p1: [number, number], p2: [number, number],
  p3: [number, number], p4: [number, number],
): boolean {
  const d1x = p2[0]! - p1[0]!;
  const d1y = p2[1]! - p1[1]!;
  const d2x = p4[0]! - p3[0]!;
  const d2y = p4[1]! - p3[1]!;
  const cross = d1x * d2y - d1y * d2x;
  if (Math.abs(cross) < 1e-10) return false; // parallel

  const dx = p3[0]! - p1[0]!;
  const dy = p3[1]! - p1[1]!;
  const t = (dx * d2y - dy * d2x) / cross;
  const u = (dx * d1y - dy * d1x) / cross;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

/**
 * Detect if the straight-line path between two nodes would pass through
 * any intermediate node. If so, the caller should use orthogonal routing.
 *
 * @param fromId  Source node ID
 * @param toId    Target node ID
 * @param nodes   All node layouts (from LayoutStore)
 * @param margin  Extra padding around obstacle boxes (default 5px)
 */
function wouldPassThroughObstacle(
  fromId: string,
  toId: string,
  nodes: Record<string, { x: number; y: number; w: number; h: number }>,
  margin: number = 5,
): boolean {
  const fromNL = nodes[fromId];
  const toNL = nodes[toId];
  if (!fromNL || !toNL) return false;

  const sc: [number, number] = [fromNL.x + fromNL.w / 2, fromNL.y + fromNL.h / 2];
  const tc: [number, number] = [toNL.x + toNL.w / 2, toNL.y + toNL.h / 2];

  for (const [nodeId, nl] of Object.entries(nodes)) {
    if (nodeId === fromId || nodeId === toId) continue;
    // Add small margin to the obstacle box
    const bx = nl.x - margin;
    const by = nl.y - margin;
    const bw = nl.w + 2 * margin;
    const bh = nl.h + 2 * margin;

    if (boxIntersectsSegment(bx, by, bw, bh, sc, tc)) {
      return true;
    }
  }

  return false;
}

/**
 * Convert Mermaid label escapes to Excalidraw newlines.
 * Mermaid uses \\n (escaped backslash-n) in label text for line breaks,
 * but Excalidraw text elements need actual newline characters.
 */
function normalizeLabel(label: string): string {
  return label.replace(/\\n/g, "\n");
}

/**
 * Compute the label waypoint position for a parallel edge.
 * Returns the midpoint of the canonical edge path (from smaller node ID to larger),
 * shifted perpendicular to separate parallel/bidirectional labels.  Returns null if
 * no parallel siblings exist.
 *
 * @param sc        Centre of source node [x, y].
 * @param tc        Centre of target node [x, y].
 * @param edge      The edge being labeled.
 * @param allEdges  All edges in the diagram (for parallel sibling detection).
 * @returns         Absolute [x, y] waypoint for the label, or null.
 */
function computeLabelWaypoint(
  sc: [number, number],
  tc: [number, number],
  edge: { from: string; to: string; ordinal: number },
  allEdges: readonly { from: string; to: string; ordinal: number }[],
): [number, number] | null {
  // Find all parallel siblings (same node pair, either direction).
  const siblings = allEdges.filter(
    (e) =>
      (e.from === edge.from && e.to === edge.to) ||
      (e.from === edge.to && e.to === edge.from),
  );
  if (siblings.length <= 1) return null;

  siblings.sort((a, b) => {
    if (a.from !== b.from) return a.from.localeCompare(b.from);
    return a.ordinal - b.ordinal;
  });

  const idx = siblings.findIndex(
    (e) => e.from === edge.from && e.to === edge.to && e.ordinal === edge.ordinal,
  );
  if (idx < 0) return null;

  // Canonical direction: from smaller node ID to larger node ID.
  let cdx = tc[0] - sc[0];
  let cdy = tc[1] - sc[1];
  if (edge.from > edge.to) {
    cdx = -cdx;
    cdy = -cdy;
  }

  // Midpoint of the canonical path (in absolute coordinates).
  const mx = (sc[0] + tc[0]) / 2;
  const my = (sc[1] + tc[1]) / 2;

  // Dominant-axis perpendicular: same formula as routeAuto.
  let perpX: number, perpY: number;
  const clen = Math.sqrt(cdx * cdx + cdy * cdy);
  if (clen > 0 && Math.abs(cdx) >= Math.abs(cdy)) {
    perpX = 0;
    perpY = cdx > 0 ? 1 : -1;
  } else if (clen > 0) {
    perpX = cdy > 0 ? -1 : 1;
    perpY = 0;
  } else {
    perpX = 0;
    perpY = 0;
  }

  // Alternate ±LABEL_OFFSET_PX for each sibling.
  const side = idx % 2 === 0 ? 1 : -1;
  const offset = side * LABEL_OFFSET_PX;

  // Small diagonal spread: ±spread pixels horizontal shift.
  const spread = 10;
  const horizShift = cdx >= 0 ? -side * spread : side * spread;

  return [
    mx + perpX * offset + horizShift,
    my + perpY * offset,
  ] as [number, number];
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
      kind: "cluster",
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
        kind: "label",
        type: "text",
        x: cl.x,
        y: cl.y + 8,
        width: cl.w,
        height: 20,
        roughness,
        fontFamily,
        label: normalizeLabel(cluster.label),
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
      kind: "node",
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
        kind: "label",
        type: "text",
        x: nl.x,
        y: nl.y + Math.floor((nl.h - textFontSize * 1.25) / 2),
        width: nl.w,
        height: Math.ceil(textFontSize * 1.25),
        roughness: nl.style?.roughness ?? roughness,
        fontFamily: nl.style?.fontFamily ?? fontFamily,
        fontSize: textFontSize,
        label: normalizeLabel(node.label),
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

    // Use orthogonal routing when the straight-line path between source and target
    // would pass through any intermediate node. This prevents edges from visually
    // "cutting through" other nodes in the diagram.
    let routing = edgeL?.routing ?? "auto";
    const waypoints = edgeL?.waypoints ?? [];
    if (routing === "auto" && waypoints.length === 0) {
      if (wouldPassThroughObstacle(edge.from, edge.to, resolvedLayout.nodes)) {
        routing = "orthogonal";
      }
    }

    const sourceBB = { x: fromLayout.x, y: fromLayout.y, w: fromLayout.w, h: fromLayout.h };
    const targetBB = { x: toLayout.x, y: toLayout.y, w: toLayout.w, h: toLayout.h };

    const sc: [number, number] = [fromLayout.x + fromLayout.w / 2, fromLayout.y + fromLayout.h / 2];
    const tc: [number, number] = [toLayout.x + toLayout.w / 2, toLayout.y + toLayout.h / 2];

    const routeResult = routeEdge(
      routing,
      waypoints,
      sourceBB,
      targetBB,
      { from: edge.from, to: edge.to, ordinal: edge.ordinal },
      parsed.edges as readonly EdgeInfo[],
    );

    // Excalidraw arrow points must be relative to the element's x,y.
    // Use the first absolute point as the element origin, then subtract.
    const absPoints = routeResult.points;
    const ox = absPoints[0]![0];
    const oy = absPoints[0]![1];

    // For parallel edges with labels: compute the label waypoint from node centers
    // (not from the already-offset endpoints) to avoid double-offsetting.
    let finalAbsPoints = absPoints;
    let labelWpForPosition: [number, number] | null = null;
    if (edge.label) {
      labelWpForPosition = computeLabelWaypoint(
        sc,
        tc,
        { from: edge.from, to: edge.to, ordinal: edge.ordinal },
        parsed.edges as readonly { from: string; to: string; ordinal: number }[],
      );
      if (labelWpForPosition != null) {
        // Insert waypoint at position 1 (between start and end) so the arrow
        // bends through the label position.
        finalAbsPoints = [
          absPoints[0],
          labelWpForPosition,
          ...absPoints.slice(1),
        ];
      }
    }

    const relPoints: ReadonlyArray<[number, number]> = finalAbsPoints.map(
      ([px, py]) => [px - ox, py - oy] as [number, number],
    );

    // Pre-generate the arrow ID so we can reference it in shape boundElements.
    const arrowId = randomUUID();
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
      kind: "edge",
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
      label: edge.label ? normalizeLabel(edge.label) : undefined,
      // Stroke properties for edge elements.
      strokeColor: edgeL?.style?.strokeColor,
      strokeWidth: edgeL?.style?.strokeWidth,
      strokeStyle: edgeL?.style?.strokeStyle ?? (edgeL?.style?.strokeDash ? "dashed" : undefined),
    });
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
