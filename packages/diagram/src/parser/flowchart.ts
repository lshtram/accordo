/**
 * A2 — Flowchart-specific Mermaid parser (internal)
 *
 * Accesses the mermaid `diagram.db` API (mermaid 11.x).
 * This is the ONLY file in the codebase that imports mermaid internals.
 * All other modules use the stable ParsedDiagram type via adapter.ts.
 *
 * Source: diag_arch_v4.2.md §6.3
 */

import type {
  ParsedDiagram,
  ParsedNode,
  ParsedNodeStyle,
  ParsedEdge,
  ParsedCluster,
  NodeId,
  ClusterId,
  NodeShape,
  EdgeType,
} from "../types.js";
import { decodeHtmlEntities } from "./decode-html.js";

/**
 * Internal type representing the mermaid flowchart parser database object.
 * Typing is loose (unknown fields) because this is an undocumented API.
 * Narrowed inside parseFlowchart via runtime checks.
 */
export type FlowchartDb = Record<string, unknown>;

/** Mermaid classDef definition as returned by db.getClasses(). */
interface MermaidClassDef {
  id: string;
  /** CSS property strings, e.g. ["fill:#f9f", "stroke:#333", "stroke-width:4px"] */
  styles: string[];
  /** Text/color-related CSS strings, e.g. ["color:#fff"] */
  textStyles?: string[];
}

// ── Internal shapes matching mermaid 11.x flowchart db ───────────────────────

interface MermaidVertex {
  id: string;
  text?: string;  // mermaid 11.x primary field
  label?: string; // fallback for older internal API shapes
  type: string;
  classes?: string[];
  /** Inline styles from `style nodeId prop:val,...` — array of CSS strings */
  styles?: string[];
}

interface MermaidEdge {
  start: string;
  end: string;
  text: string;
  /** Mermaid 11.x uses string type like "arrow_point", "arrow_open", "arrow_circle", etc. */
  type: string;
  /** Mermaid 11.x stroke: "normal" | "dotted" | "thick" */
  stroke: string;
}

interface MermaidSubgraph {
  id: string;
  title: string;
  nodes: string[];
}

// ── Shape / edge-type mapping tables ─────────────────────────────────────────

const SHAPE_MAP: Readonly<Record<string, NodeShape>> = {
  square:       "rectangle",
  round:        "rounded",
  diamond:      "diamond",
  circle:       "circle",
  stadium:      "stadium",
  cylinder:     "cylinder",
  hexagon:      "hexagon",
  // Additional Mermaid 11.x flowchart vertex types
  subroutine:   "subroutine",
  doublecircle: "double_circle",
  odd:          "asymmetric",
  lean_right:   "parallelogram",
  lean_left:    "parallelogram_alt",
  trapezoid:    "trapezoid",
  inv_trapezoid:"trapezoid_alt",
};

/**
 * Map Mermaid 11.x edge `type` string → [startArrowhead, endArrowhead].
 * null = no arrowhead, undefined = use default ("arrow" at end).
 *
 * Note on "bar" for cross types (--x / x--x): Excalidraw has no native X/cross
 * marker. A perpendicular bar is the closest visual approximation for the X
 * terminator that Mermaid renders for `--x` edges.
 */
const MERMAID_EDGE_ARROWHEADS: Readonly<
  Record<string, ["arrow" | "triangle" | "dot" | "bar" | null, "arrow" | "triangle" | "dot" | "bar" | null]>
> = {
  arrow_point:        [null,  "arrow"],  // -->
  arrow_open:         [null,  null],     // ---  (no arrowhead)
  arrow_circle:       [null,  "dot"],    // --o
  arrow_cross:        [null,  "bar"],    // --x
  double_arrow_point: ["arrow", "arrow"],// <-->
  double_arrow_circle:["dot",  "dot"],   // o--o
  double_arrow_cross: ["bar",  "bar"],   // x--x
};

/**
 * Map Mermaid 11.x edge `stroke` string → strokeStyle/strokeWidth.
 * "dotted" produces dashed lines; "thick" produces a heavier stroke.
 */
function mermaidStrokeProps(stroke: string): { strokeStyle?: "solid" | "dashed"; strokeWidth?: number } {
  switch (stroke) {
    case "dotted": return { strokeStyle: "dashed" };
    case "thick":  return { strokeWidth: 4 };
    default:       return {};
  }
}

/**
 * Parse an array of CSS property strings (as returned by Mermaid's db for
 * vertex.styles or classDef.styles) into a ParsedNodeStyle.
 *
 * Each string is "property:value", e.g. "fill:#f9f", "stroke:#333",
 * "stroke-width:4px", "color:#fff", "stroke-dasharray: 5 5".
 *
 * Unknown properties are silently ignored — we never throw here because
 * Mermaid might emit styles we don't model yet.
 */
/**
 * Normalize an array of raw CSS strings into individual `prop:value` tokens.
 *
 * Mermaid may provide classDef/style strings in two forms:
 *   - comma-separated:  ["fill:#f9f", "stroke:#333", "stroke-width:4px"]
 *   - space-separated:  ["stroke:#00f stroke-width:2px"]
 *
 * This function handles both by splitting on the boundary between a CSS
 * property name and a `:` that follows a space (e.g. ` stroke-width:`),
 * without corrupting hex color values (which contain `#` but no `:`).
 */
function normalizeCssTokens(cssStrings: string[]): string[] {
  const tokens: string[] = [];
  // Regex: split before any "word" (optionally hyphenated) that is followed by ":"
  // We use a lookahead so the property name stays with its value.
  const propBoundary = /(?<=\s)(?=[\w-]+:)/;
  for (const raw of cssStrings) {
    const parts = raw.split(propBoundary);
    for (const p of parts) {
      const trimmed = p.trim();
      if (trimmed) tokens.push(trimmed);
    }
  }
  return tokens;
}

function parseCssStyles(cssStrings: string[]): ParsedNodeStyle {
  const style: ParsedNodeStyle = {};
  for (const raw of normalizeCssTokens(cssStrings)) {
    const colon = raw.indexOf(":");
    if (colon < 0) continue;
    const prop = raw.slice(0, colon).trim().toLowerCase();
    const value = raw.slice(colon + 1).trim();
    switch (prop) {
      case "fill":
        if (value && value !== "none") style.backgroundColor = value;
        break;
      case "stroke":
        if (value && value !== "none") style.strokeColor = value;
        break;
      case "stroke-width": {
        const px = parseFloat(value);
        if (!isNaN(px) && px > 0) style.strokeWidth = px;
        break;
      }
      case "color":
        if (value) style.fontColor = value;
        break;
      case "stroke-dasharray":
        // Any non-empty stroke-dasharray means dashed
        if (value.trim()) style.strokeStyle = "dashed";
        break;
      // Other CSS props (e.g. font-size, rx, ry) are not modelled — ignore.
    }
  }
  return style;
}

/**
 * Merge multiple ParsedNodeStyle objects left-to-right, with later values
 * overriding earlier ones (like Object.assign but only defined keys).
 */
function mergeStyles(...styles: ParsedNodeStyle[]): ParsedNodeStyle | undefined {
  const result: ParsedNodeStyle = {};
  let hasAny = false;
  for (const s of styles) {
    if (s.backgroundColor !== undefined) { result.backgroundColor = s.backgroundColor; hasAny = true; }
    if (s.strokeColor !== undefined)     { result.strokeColor = s.strokeColor;         hasAny = true; }
    if (s.strokeWidth !== undefined)     { result.strokeWidth = s.strokeWidth;         hasAny = true; }
    if (s.strokeStyle !== undefined)     { result.strokeStyle = s.strokeStyle;         hasAny = true; }
    if (s.fontColor !== undefined)       { result.fontColor = s.fontColor;             hasAny = true; }
  }
  return hasAny ? result : undefined;
}

/**
 * Convert a mermaid flowchart parser `db` object into a stable ParsedDiagram.
 *
 * Called only from adapter.ts after `mermaid.mermaidAPI.getDiagramFromText()`
 * returns a flowchart diagram. All mermaid-version-specific field access lives
 * here so breakage on Mermaid upgrades is isolated to this file.
 */
export function parseFlowchart(db: FlowchartDb): ParsedDiagram {
  const rawVertices = (db.getVertices as () => Record<string, MermaidVertex> | Map<string, MermaidVertex>)();
  const rawEdges = (db.getEdges as () => MermaidEdge[])();
  const rawSubgraphs = (db.getSubGraphs as () => MermaidSubgraph[])();
  const direction = (db.getDirection as () => string)() as
    | "TD"
    | "TB"
    | "LR"
    | "RL"
    | "BT";

  // Mermaid 11.x uses "TB" (top-to-bottom); normalize to "TD" for downstream code.
  const normalizedDirection =
    direction === "TB" ? "TD" : direction;

  // Load classDef definitions when available (Mermaid 11.x).
  // Returns Map<string, MermaidClassDef> or an empty Map if not present.
  const classDefMap = new Map<string, MermaidClassDef>();
  if (typeof db.getClasses === "function") {
    const raw = (db.getClasses as () => Map<string, MermaidClassDef> | Record<string, MermaidClassDef>)();
    const entries: [string, MermaidClassDef][] =
      raw instanceof Map
        ? [...raw.entries()]
        : Object.entries(raw) as [string, MermaidClassDef][];
    for (const [k, v] of entries) classDefMap.set(k, v);
  }

  // Build cluster membership: nodeId → clusterId
  const nodeToCluster = new Map<NodeId, ClusterId>();
  const clusterIdSet = new Set(rawSubgraphs.map(sg => sg.id));

  // First pass: build all clusters (parent not yet set)
  const clusters: ParsedCluster[] = rawSubgraphs.map((sg) => {
    const directMembers = sg.nodes.filter(id => !clusterIdSet.has(id));
    for (const nodeId of directMembers) {
      nodeToCluster.set(nodeId, sg.id);
    }
    return { id: sg.id, label: sg.title, members: directMembers };
  });

  // Second pass: derive parent from membership
  // If cluster X's nodes array contains cluster Y's ID → Y.parent = X
  for (const sg of rawSubgraphs) {
    for (const nodeId of sg.nodes) {
      if (clusterIdSet.has(nodeId)) {
        const childCluster = clusters.find(c => c.id === nodeId);
        if (childCluster && !childCluster.parent) {
          childCluster.parent = sg.id;
        }
      }
    }
  }

  // Build nodes map
  const nodes = new Map<NodeId, ParsedNode>();
  const vertexEntries: [string, MermaidVertex][] =
    rawVertices instanceof Map
      ? ([...rawVertices.entries()] as [string, MermaidVertex][])
      : (Object.entries(rawVertices) as [string, MermaidVertex][]);
  for (const [id, v] of vertexEntries) {
    // Resolve classDef styles (merged in class-declaration order)
    const classStyles: ParsedNodeStyle[] = (v.classes ?? [])
      .map(cls => classDefMap.get(cls))
      .filter((cd): cd is MermaidClassDef => cd !== undefined)
      .map(cd => {
        const allCss = [
          ...(cd.styles ?? []),
          ...(cd.textStyles ?? []),
        ];
        return parseCssStyles(allCss);
      });

    // Inline `style` directive overrides classDef styles
    const inlineStyle: ParsedNodeStyle =
      v.styles && v.styles.length > 0 ? parseCssStyles(v.styles) : {};

    const resolvedStyle = mergeStyles(...classStyles, inlineStyle);

    nodes.set(id, {
      id,
      label: decodeHtmlEntities(v.text ?? v.label ?? ""),
      shape: SHAPE_MAP[v.type] ?? "rectangle",
      classes: v.classes ? [...v.classes] : [],
      cluster: nodeToCluster.get(id),
      ...(resolvedStyle !== undefined ? { style: resolvedStyle } : {}),
    });
  }

  // Build edges with per-(from,to) ordinal counter
  const ordinalCounter = new Map<string, number>();
  const edges: ParsedEdge[] = rawEdges.map((e) => {
    const key = `${e.start}:${e.end}`;
    const ordinal = ordinalCounter.get(key) ?? 0;
    ordinalCounter.set(key, ordinal + 1);

    const arrowheads = MERMAID_EDGE_ARROWHEADS[e.type as string];
    const [arrowheadStart, arrowheadEnd] = arrowheads ?? [null, "arrow"];
    const strokeProps = mermaidStrokeProps(e.stroke as string ?? "");

    // Derive legacy EdgeType for backward compat (canvas-generator may still read it)
    let edgeType: EdgeType = "arrow";
    if ((e.stroke as string) === "dotted") edgeType = "dotted";
    else if ((e.stroke as string) === "thick") edgeType = "thick";

    return {
      from: e.start,
      to: e.end,
      label: decodeHtmlEntities(e.text ?? ""),
      ordinal,
      type: edgeType,
      arrowheadStart,
      arrowheadEnd,
      ...strokeProps,
    };
  });

  return {
    type: "flowchart", // overridden by adapter.ts spread with detected type
    nodes,
    edges,
    clusters,
    renames: [], // overridden by adapter.ts spread with parsed annotations
    direction: normalizedDirection,
  };
}
