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
  ParsedNodeStyle,
  NodeStyle,
  LayoutStore,
  CanvasScene,
  ExcalidrawElement,
} from "../types.js";
import { placeNodes } from "../reconciler/placement.js";
import { getShapeProps } from "./shape-map.js";
import type { CompositeKind } from "./shape-map.js";
import { routeEdge } from "./edge-router.js";

/**
 * Merge parsed Mermaid node style (from `style` / `classDef` directives) with
 * the layout-store style (user overrides via accordo_diagram_patch).
 *
 * Priority (highest wins): layoutStyle > parsedStyle > nothing
 *
 * Returns a merged NodeStyle where only the explicitly-set layout fields
 * override the parsed-source fields. This lets Mermaid style directives
 * supply sensible defaults while user layout overrides remain authoritative.
 */
function mergeNodeStyle(parsedStyle: ParsedNodeStyle | undefined, layoutStyle: NodeStyle): NodeStyle {
  if (!parsedStyle) return layoutStyle;
  return {
    backgroundColor:  layoutStyle.backgroundColor  ?? parsedStyle.backgroundColor,
    strokeColor:      layoutStyle.strokeColor       ?? parsedStyle.strokeColor,
    strokeWidth:      layoutStyle.strokeWidth       ?? parsedStyle.strokeWidth,
    strokeStyle:      layoutStyle.strokeStyle       ?? parsedStyle.strokeStyle,
    strokeDash:       layoutStyle.strokeDash,
    fillStyle:        layoutStyle.fillStyle,
    shape:            layoutStyle.shape,
    fontSize:         layoutStyle.fontSize,
    fontColor:        layoutStyle.fontColor         ?? parsedStyle.fontColor,
    fontWeight:       layoutStyle.fontWeight,
    opacity:          layoutStyle.opacity,
    roughness:        layoutStyle.roughness,
    fontFamily:       layoutStyle.fontFamily,
  };
}

/**
 * Small perpendicular shift applied to each parallel edge's label to prevent
 * label overlap.  ±LABEL_OFFSET_PX separates bidirectional/parallel labels.
 */
const LABEL_OFFSET_PX = 15;

/** Build the EdgeKey string for a given edge. */
function edgeKey(from: string, to: string, ordinal: number): string {
  return `${from}->${to}:${ordinal}`;
}

// ── Arrowhead mapping ─────────────────────────────────────────────────────────

type ExcalidrawArrowhead = "arrow" | "triangle" | "dot" | "bar";

/**
 * Map a ParsedEdge type to Excalidraw arrowhead codes.
 * Returns [startArrowhead, endArrowhead] where null means no arrowhead.
 *
 * UML conventions:
 *   inheritance  → open triangle at target (parent end)
 *   composition  → filled diamond at source + open triangle at target
 *   aggregation  → open diamond at source + arrow at target
 *   realization  → open triangle at target (same as inheritance but dashed)
 *   dependency   → open arrow at target
 *   association  → open arrow at target
 *   arrow        → plain arrow at target
 */
function edgeArrowheads(type: string): [ExcalidrawArrowhead | null, ExcalidrawArrowhead | null] {
  switch (type) {
    case "inheritance":
    case "realization":
      return [null, "triangle"];
    case "composition":
      return ["bar", "triangle"];   // bar = filled diamond (closest available)
    case "aggregation":
      return ["dot", "arrow"];      // dot = open diamond (closest available)
    case "dependency":
    case "association":
    case "arrow":
    default:
      return [null, "arrow"];
  }
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

// ── Composite shape rendering ─────────────────────────────────────────────────

/**
 * Build all Excalidraw elements required to render a composite node shape.
 *
 * Composite shapes cannot be represented by a single Excalidraw primitive.
 * They are rendered as a collection of `line` segments forming a polygon
 * outline, with a separate `text` element for the label.
 *
 * Skew offset used for parallelogram/trapezoid shapes: 20px.
 *
 * Returns the array of ExcalidrawElement objects to push into the scene.
 * The first element in the returned array is the "main" element that text
 * is bound to (containerId).  Remaining elements are decorations.
 *
 * @param kind      CompositeKind discriminator from ShapeProps
 * @param nodeId    Mermaid node ID (used for mermaidId back-links)
 * @param elemId    Pre-generated Excalidraw ID for the main element
 * @param x, y      Top-left position
 * @param w, h      Width and height
 * @param label     Node label text (may be undefined/empty)
 * @param roughness Rough.js level
 * @param fontFamily Font family string
 * @param textFontSize Font size in px
 * @param style     Optional node style overrides
 */
function buildCompositeElements(
  kind: CompositeKind,
  nodeId: string,
  elemId: string,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string | undefined,
  roughness: number,
  fontFamily: string,
  textFontSize: number,
  style?: {
    roughness?: number;
    fontFamily?: string;
    fontColor?: string;
    strokeColor?: string;
    strokeWidth?: number;
    strokeStyle?: "solid" | "dashed" | "dotted";
    strokeDash?: boolean;
    backgroundColor?: string;
    fillStyle?: string;
    opacity?: number;
  },
): ExcalidrawElement[] {
  const textId = label ? randomUUID() : null;
  const lineRoughness = style?.roughness ?? roughness;
  const strokeColor = style?.strokeColor;
  const strokeWidth = style?.strokeWidth;
  const strokeStyle = style?.strokeStyle ?? (style?.strokeDash ? "dashed" : undefined);

  /** Helper: build a `line` segment with absolute positions as relative points. */
  function makeLine(
    id: string,
    mId: string,
    lx: number, ly: number,
    pts: Array<[number, number]>,
  ): ExcalidrawElement {
    return {
      id,
      mermaidId: mId,
      kind: "node" as const,
      type: "line" as const,
      x: lx,
      y: ly,
      width: 0,
      height: 0,
      roughness: lineRoughness,
      fontFamily,
      points: pts,
      startBinding: null,
      endBinding: null,
      arrowheadStart: null,
      arrowheadEnd: null,
      strokeColor,
      strokeWidth,
      strokeStyle,
      backgroundColor: style?.backgroundColor,
      fillStyle: style?.fillStyle,
      opacity: style?.opacity,
      boundElements: null,
    };
  }

  const SKEW = 20; // parallelogram horizontal skew in px

  let outlineElements: ExcalidrawElement[];

  if (kind === "subroutine") {
    // Subroutine: outer rectangle + 2 inner vertical lines
    // The outer rectangle acts as the main "container" for the text.
    const mainEl: ExcalidrawElement = {
      id: elemId,
      mermaidId: nodeId,
      kind: "node",
      type: "rectangle",
      x,
      y,
      width: w,
      height: h,
      roughness: lineRoughness,
      fontFamily,
      roundness: null,
      strokeColor,
      strokeWidth,
      strokeStyle,
      backgroundColor: style?.backgroundColor,
      fillStyle: style?.fillStyle,
      opacity: style?.opacity,
      boundElements: textId ? [{ id: textId, type: "text" }] : null,
    };
    const innerPad = Math.min(10, Math.floor(w * 0.08));
    const leftLine = makeLine(
      randomUUID(),
      `${nodeId}:subroutine-left`,
      x + innerPad, y,
      [[0, 0], [0, h]],
    );
    const rightLine = makeLine(
      randomUUID(),
      `${nodeId}:subroutine-right`,
      x + w - innerPad, y,
      [[0, 0], [0, h]],
    );
    outlineElements = [mainEl, leftLine, rightLine];

  } else if (kind === "double_circle") {
    // Double circle: outer ellipse (main, contains text) + inner ellipse (decoration, ~5px inset)
    const inset = Math.round(Math.min(w, h) * 0.055); // ~5px for 90×90
    const mainEl: ExcalidrawElement = {
      id: elemId,
      mermaidId: nodeId,
      kind: "node",
      type: "ellipse",
      x,
      y,
      width: w,
      height: h,
      roughness: lineRoughness,
      fontFamily,
      roundness: null,
      strokeColor,
      strokeWidth,
      strokeStyle,
      backgroundColor: style?.backgroundColor,
      fillStyle: style?.fillStyle,
      opacity: style?.opacity,
      boundElements: textId ? [{ id: textId, type: "text" }] : null,
    };
    const innerEl: ExcalidrawElement = {
      id: randomUUID(),
      mermaidId: `${nodeId}:inner`,
      kind: "node",
      type: "ellipse",
      x: x + inset,
      y: y + inset,
      width: w - inset * 2,
      height: h - inset * 2,
      roughness: lineRoughness,
      fontFamily,
      roundness: null,
      strokeColor,
      strokeWidth,
      strokeStyle,
      backgroundColor: undefined,
      fillStyle: undefined,
      opacity: style?.opacity,
      boundElements: null,
    };
    outlineElements = [mainEl, innerEl];

  } else {
    // Polygon shapes: 4 line segments forming the outline.
    // The first line segment (top edge) serves as the main element for text binding.
    // We compute the 4 corner points, then emit 4 line segments: top, right, bottom, left.

    let tl: [number, number];  // top-left
    let tr: [number, number];  // top-right
    let br: [number, number];  // bottom-right
    let bl: [number, number];  // bottom-left

    switch (kind) {
      case "parallelogram":
        // Lean right: top edge shifted right by SKEW, bottom edge flush
        // TL=(x+SKEW, y) TR=(x+w+SKEW, y) BR=(x+w, y+h) BL=(x, y+h)
        tl = [x + SKEW, y];
        tr = [x + w + SKEW, y];
        br = [x + w, y + h];
        bl = [x, y + h];
        break;
      case "parallelogram_alt":
        // Lean left: top edge flush, bottom edge shifted right by SKEW
        // TL=(x, y) TR=(x+w, y) BR=(x+w+SKEW, y+h) BL=(x+SKEW, y+h)
        tl = [x, y];
        tr = [x + w, y];
        br = [x + w + SKEW, y + h];
        bl = [x + SKEW, y + h];
        break;
      case "trapezoid":
        // Wider at bottom, narrower at top (Mermaid [/...])
        // TL=(x+SKEW, y) TR=(x+w-SKEW, y) BR=(x+w, y+h) BL=(x, y+h)
        tl = [x + SKEW, y];
        tr = [x + w - SKEW, y];
        br = [x + w, y + h];
        bl = [x, y + h];
        break;
      case "trapezoid_alt":
      default:
        // Wider at top, narrower at bottom (Mermaid [\.../])
        // TL=(x, y) TR=(x+w, y) BR=(x+w-SKEW, y+h) BL=(x+SKEW, y+h)
        tl = [x, y];
        tr = [x + w, y];
        br = [x + w - SKEW, y + h];
        bl = [x + SKEW, y + h];
        break;
    }

    // For a "filled" polygon we use a single line element with a closed path.
    // Excalidraw `line` with points forming a closed polygon renders filled
    // when backgroundColor is set. We emit points relative to tl.
    // The closed polygon: tl → tr → br → bl → tl
    const ox = tl[0];
    const oy = tl[1];
    const polygonPts: Array<[number, number]> = [
      [0,                0],
      [tr[0] - ox,       tr[1] - oy],
      [br[0] - ox,       br[1] - oy],
      [bl[0] - ox,       bl[1] - oy],
      [0,                0],  // close the path
    ];

    const polyWidth  = Math.max(tr[0], br[0], bl[0]) - Math.min(tl[0], bl[0]);
    const polyHeight = Math.max(bl[1], br[1]) - Math.min(tl[1], tr[1]);

    const mainEl: ExcalidrawElement = {
      id: elemId,
      mermaidId: nodeId,
      kind: "node",
      type: "line",
      x: ox,
      y: oy,
      width: polyWidth,
      height: polyHeight,
      roughness: lineRoughness,
      fontFamily,
      points: polygonPts,
      startBinding: null,
      endBinding: null,
      arrowheadStart: null,
      arrowheadEnd: null,
      strokeColor,
      strokeWidth,
      strokeStyle,
      backgroundColor: style?.backgroundColor,
      fillStyle: style?.fillStyle ?? "hachure",
      opacity: style?.opacity,
      boundElements: textId ? [{ id: textId, type: "text" }] : null,
    };
    outlineElements = [mainEl];
  }

  // Text label element (if the node has a label)
  const textElements: ExcalidrawElement[] = textId && label ? [{
    id: textId,
    mermaidId: `${nodeId}:text`,
    kind: "label",
    type: "text",
    x,
    y: y + Math.floor((h - textFontSize * 1.25) / 2),
    width: w,
    height: Math.ceil(textFontSize * 1.25),
    roughness: lineRoughness,
    fontFamily: style?.fontFamily ?? fontFamily,
    fontSize: textFontSize,
    label: normalizeLabel(label),
    strokeColor: style?.fontColor,
    containerId: elemId,
  }] : [];

  return [...outlineElements, ...textElements];
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

    // Merge parsed Mermaid style (classDef / inline style) with layout overrides.
    // Layout-file values take precedence; parsed style supplies the defaults.
    const effectiveStyle = mergeNodeStyle(node.style, nl.style);

    const hasMembers = node.members && node.members.length > 0;
    const textFontSize = effectiveStyle?.fontSize ?? 14;
    const lineH = textFontSize * 1.25;

    if (hasMembers && node.members) {
      // ── Class node: title box + divider line + members text ──────────────
      // Title compartment: class name + vertical padding on both sides
      const titlePad = 8;                                          // px above and below name text
      const titleH = Math.ceil(lineH + titlePad * 2);             // total name compartment height
      const memberLineH = textFontSize - 2;                        // members use smaller font
      const memberLineSpacing = (textFontSize - 2) * 1.35;        // 1.35× line-height for members
      const membersTextH = Math.ceil(node.members.length * memberLineSpacing + titlePad * 2);
      const totalH = titleH + membersTextH;

      // Always expand the box to at least totalH (layout height may be too small
      // for the number of members).
      const boxH = Math.max(nl.h, totalH);

      // Title text id, divider line id, and members text id
      const titleTextId = randomUUID();
      const dividerId = randomUUID();
      const membersTextId = randomUUID();

      pushElement({
        id: elemId,
        mermaidId: nodeId,
        kind: "node",
        type: shapeProps.elementType,
        x: nl.x,
        y: nl.y,
        width: nl.w,
        height: boxH,
        roughness: effectiveStyle?.roughness ?? roughness,
        fontFamily,
        roundness: shapeProps.roundness ?? undefined,
        backgroundColor: effectiveStyle?.backgroundColor,
        strokeColor: effectiveStyle?.strokeColor,
        strokeWidth: effectiveStyle?.strokeWidth,
        strokeStyle: effectiveStyle?.strokeStyle ?? (effectiveStyle?.strokeDash ? "dashed" : undefined),
        fillStyle: effectiveStyle?.fillStyle,
        opacity: effectiveStyle?.opacity,
        boundElements: [
          { id: titleTextId, type: "text" },
          { id: dividerId, type: "arrow" },
          { id: membersTextId, type: "text" },
        ],
      });

      // Title text (bold class name, vertically centered in title compartment)
      pushElement({
        id: titleTextId,
        mermaidId: `${nodeId}:text`,
        kind: "label",
        type: "text",
        x: nl.x,
        y: nl.y + titlePad,
        width: nl.w,
        height: Math.ceil(lineH),
        roughness: effectiveStyle?.roughness ?? roughness,
        fontFamily: effectiveStyle?.fontFamily ?? fontFamily,
        fontSize: textFontSize,
        label: normalizeLabel(node.label),
        strokeColor: effectiveStyle?.fontColor,
        containerId: elemId,
      });

      // Horizontal divider line between name compartment and members compartment
      pushElement({
        id: dividerId,
        mermaidId: `${nodeId}:divider`,
        kind: "label",
        type: "line",
        x: nl.x,
        y: nl.y + titleH,
        width: nl.w,
        height: 0,
        roughness: effectiveStyle?.roughness ?? roughness,
        fontFamily,
        points: [[0, 0], [nl.w, 0]] as Array<[number, number]>,
        startBinding: null,
        endBinding: null,
        arrowheadStart: null,
        arrowheadEnd: null,
        strokeColor: effectiveStyle?.strokeColor,
        strokeWidth: effectiveStyle?.strokeWidth,
      });

      // Members text (attributes + methods joined by newlines)
      // Starts 4px below the divider line (titleH + 4), left-inset 6px.
      const membersText = node.members.join("\n");
      pushElement({
        id: membersTextId,
        mermaidId: `${nodeId}:members`,
        kind: "label",
        type: "text",
        x: nl.x + 6,
        y: nl.y + titleH + 4,
        width: nl.w - 12,
        height: membersTextH - titlePad,
        roughness: effectiveStyle?.roughness ?? roughness,
        fontFamily: effectiveStyle?.fontFamily ?? fontFamily,
        fontSize: memberLineH,  // slightly smaller than title
        label: membersText,
        strokeColor: effectiveStyle?.fontColor,
        containerId: elemId,
      });
      } else {
        // ── Standard node: single text label centered ────────────────────────
        if (shapeProps.composite) {
          // Composite shape: emit multiple line segments + text via helper.
          const compositeEls = buildCompositeElements(
            shapeProps.composite,
            nodeId,
            elemId,
            nl.x,
            nl.y,
            nl.w,
            nl.h,
            node.label,
            roughness,
            fontFamily,
            textFontSize,
            effectiveStyle,
          );
          for (const el of compositeEls) {
            pushElement(el);
          }
        } else {
          // Simple primitive: single shape element + optional text label.
          const textId = node.label ? randomUUID() : null;
          // FC-02: circle nodes must be true circles — enforce width === height
          // using the larger of layout w/h so the circle fully contains its label.
          let elemW = nl.w;
          let elemH = nl.h;
          if (node.shape === "circle") {
            const size = Math.max(nl.w, nl.h);
            elemW = size;
            elemH = size;
          }
          pushElement({
            id: elemId,
            mermaidId: nodeId,
            kind: "node",
            type: shapeProps.elementType,
            x: nl.x,
            y: nl.y,
            width: elemW,
            height: elemH,
            roughness: effectiveStyle?.roughness ?? roughness,
            fontFamily,
            roundness: shapeProps.roundness ?? undefined,
            backgroundColor: effectiveStyle?.backgroundColor,
            strokeColor: effectiveStyle?.strokeColor,
            strokeWidth: effectiveStyle?.strokeWidth,
            // strokeStyle: prefer explicit strokeStyle; fall back to strokeDash boolean.
            strokeStyle: effectiveStyle?.strokeStyle ?? (effectiveStyle?.strokeDash ? "dashed" : undefined),
            fillStyle: effectiveStyle?.fillStyle,
            opacity: effectiveStyle?.opacity,
            boundElements: textId ? [{ id: textId, type: "text" }] : null,
          });
          if (textId && node.label) {
            pushElement({
              id: textId,
              mermaidId: `${nodeId}:text`,
              kind: "label",
              type: "text",
              x: nl.x,
              y: nl.y + Math.floor((nl.h - textFontSize * 1.25) / 2),
              width: nl.w,
              height: Math.ceil(textFontSize * 1.25),
              roughness: effectiveStyle?.roughness ?? roughness,
              fontFamily: effectiveStyle?.fontFamily ?? fontFamily,
              fontSize: textFontSize,
              label: normalizeLabel(node.label),
              strokeColor: effectiveStyle?.fontColor,
              containerId: elemId,
            });
          }
        }
      }
  }

  // ── 3. Edges ────────────────────────────────────────────────────────────────
  for (const edge of parsed.edges) {
    const fromLayout = resolvedLayout.nodes[edge.from];
    const toLayout = resolvedLayout.nodes[edge.to];

    // FC-08: If from/to is a cluster ID, resolve to cluster bounding box centre.
    // Cluster bbox is used as both layout (for routing) and elementId (for binding).
    const fromCluster = resolvedLayout.clusters[edge.from];
    const toCluster = resolvedLayout.clusters[edge.to];
    const hasFromCluster = fromCluster !== undefined && fromLayout === undefined;
    const hasToCluster = toCluster !== undefined && toLayout === undefined;

    // Skip only if both are missing (truly unresolvable)
    if (fromLayout === undefined && !hasFromCluster) continue;
    if (toLayout === undefined && !hasToCluster) continue;

    const key = edgeKey(edge.from, edge.to, edge.ordinal);
    const edgeL = resolvedLayout.edges[key];

    // Default routing stays "auto" (straight baseline). Curved vs hard-angle
    // behavior is selected through explicit edge routing/style settings.
    // Use orthogonal routing when the straight-line path between source and target
    // would pass through any intermediate node.
    let routing = edgeL?.routing ?? "auto";
    const waypoints = edgeL?.waypoints ?? [];
    if (routing === "auto" && waypoints.length === 0) {
      if (wouldPassThroughObstacle(edge.from, edge.to, resolvedLayout.nodes)) {
        routing = "orthogonal";
      }
    }

    // Resolve source and target bounding boxes
    let sourceBB: { x: number; y: number; w: number; h: number };
    let targetBB: { x: number; y: number; w: number; h: number };
    let fromElemId: string | undefined;
    let toElemId: string | undefined;

    if (hasFromCluster) {
      // FC-08: cluster as source → use cluster bbox for routing
      sourceBB = { x: fromCluster.x, y: fromCluster.y, w: fromCluster.w, h: fromCluster.h };
      // For binding: look up the cluster element (rendered as kind:"cluster")
      fromElemId = undefined; // clusters don't have element bindings for edges
    } else {
      sourceBB = { x: fromLayout.x, y: fromLayout.y, w: fromLayout.w, h: fromLayout.h };
      fromElemId = nodeElementIds.get(edge.from);
    }

    if (hasToCluster) {
      // FC-08: cluster as target → use cluster bbox for routing
      targetBB = { x: toCluster.x, y: toCluster.y, w: toCluster.w, h: toCluster.h };
      toElemId = undefined;
    } else {
      targetBB = { x: toLayout.x, y: toLayout.y, w: toLayout.w, h: toLayout.h };
      toElemId = nodeElementIds.get(edge.to);
    }

    // Compute centres for label waypoint (use cluster centres when applicable)
    const sc: [number, number] = hasFromCluster
      ? [fromCluster.x + fromCluster.w / 2, fromCluster.y + fromCluster.h / 2]
      : [fromLayout.x + fromLayout.w / 2, fromLayout.y + fromLayout.h / 2];
    const tc: [number, number] = hasToCluster
      ? [toCluster.x + toCluster.w / 2, toCluster.y + toCluster.h / 2]
      : [toLayout.x + toLayout.w / 2, toLayout.y + toLayout.h / 2];

    // FC-08b/FC-08c: For cluster edges, route using explicit centre-to-centre
    // points. This bypasses routeEdge's border clamping and ensures the arrow
    // endpoint resolves to the cluster bbox centre (per FC-08b/08c requirement).
    // For normal node edges, use routeEdge with direction-aware routing.
    const routeResult = (hasFromCluster || hasToCluster)
      ? { points: [sc, tc] as [number, number][], startBinding: null, endBinding: null }
      : routeEdge(routing, waypoints, sourceBB, targetBB, parsed.direction);

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
    // FC-08: cluster edges are NOT added to nodeArrows (no binding to nodes).
    if (!hasFromCluster) {
      const arr = nodeArrows.get(edge.from) ?? [];
      arr.push(arrowId);
      nodeArrows.set(edge.from, arr);
    }
    if (!hasToCluster) {
      const arr = nodeArrows.get(edge.to) ?? [];
      arr.push(arrowId);
      nodeArrows.set(edge.to, arr);
    }

    // Use explicit arrowheads from parser if present; fall back to type-based derivation
    // for class diagram edge types (inheritance, composition, etc.)
    const [defaultStart, defaultEnd] = edgeArrowheads(edge.type);
    const arrowheadStart = edge.arrowheadStart !== undefined ? edge.arrowheadStart : defaultStart;
    const arrowheadEnd   = edge.arrowheadEnd   !== undefined ? edge.arrowheadEnd   : defaultEnd;

    // Stroke style: classDef layout overrides first, then parser-derived, then default.
    const resolvedStrokeWidth =
      edgeL?.style?.strokeWidth ??
      edge.strokeWidth;
    const resolvedStrokeStyle =
      edgeL?.style?.strokeStyle ??
      (edgeL?.style?.strokeDash ? "dashed" : undefined) ??
      edge.strokeStyle;

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
      arrowheadStart,
      arrowheadEnd,
      label: edge.label ? normalizeLabel(edge.label) : undefined,
      // Stroke properties for edge elements.
      strokeColor: edgeL?.style?.strokeColor,
      strokeWidth: resolvedStrokeWidth,
      strokeStyle: resolvedStrokeStyle,
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
