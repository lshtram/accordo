/**
 * A2 — Flowchart-specific Mermaid parser (internal)
 *
 * Accesses the undocumented mermaid `diagram.parser.yy` API.
 * This is the ONLY file in the codebase that imports mermaid internals.
 * All other modules use the stable ParsedDiagram type via adapter.ts.
 *
 * Source: diag_arch_v4.2.md §6.3
 */

import type {
  ParsedDiagram,
  ParsedNode,
  ParsedEdge,
  ParsedCluster,
  NodeId,
  ClusterId,
  NodeShape,
  EdgeType,
} from "../types.js";

/**
 * Internal type representing the mermaid flowchart parser database object.
 * Typing is loose (unknown fields) because this is an undocumented API.
 * Narrowed inside parseFlowchart via runtime checks.
 */
export type FlowchartDb = Record<string, unknown>;

// ── Internal shapes matching mermaid 11.x flowchart db ───────────────────────

interface MermaidVertex {
  id: string;
  label?: string; // mermaid 11.x primary field
  text?: string;  // fallback for older internal API shapes
  type: string;
  classes?: string[];
}

interface MermaidEdge {
  start: string;
  end: string;
  text: string;
  type: number;
}

interface MermaidSubgraph {
  id: string;
  title: string;
  nodes: string[];
}

// ── Shape / edge-type mapping tables ─────────────────────────────────────────

const SHAPE_MAP: Readonly<Record<string, NodeShape>> = {
  square: "rectangle",
  round: "rounded",
  diamond: "diamond",
  circle: "circle",
  stadium: "stadium",
  cylinder: "cylinder",
  hexagon: "hexagon",
};

const EDGE_TYPE_MAP: Readonly<Record<number, EdgeType>> = {
  1: "arrow",
  2: "dotted",
  3: "thick",
};

/**
 * Convert a mermaid flowchart parser `db` object into a stable ParsedDiagram.
 *
 * Called only from adapter.ts after `mermaid.mermaidAPI.getDiagramFromText()`
 * returns a flowchart diagram. All mermaid-version-specific field access lives
 * here so breakage on Mermaid upgrades is isolated to this file.
 */
export function parseFlowchart(db: FlowchartDb): ParsedDiagram {
  const rawVertices = (db.getVertices as () => Record<string, MermaidVertex>)();
  const rawEdges = (db.getEdges as () => MermaidEdge[])();
  const rawSubgraphs = (db.getSubGraphs as () => MermaidSubgraph[])();
  const direction = (db.getDirection as () => string)() as
    | "TD"
    | "LR"
    | "RL"
    | "BT";

  // Build cluster membership: nodeId → clusterId
  const nodeToCluster = new Map<NodeId, ClusterId>();
  const clusters: ParsedCluster[] = rawSubgraphs.map((sg) => {
    for (const nodeId of sg.nodes) {
      nodeToCluster.set(nodeId, sg.id);
    }
    return { id: sg.id, label: sg.title, members: [...sg.nodes] };
  });

  // Build nodes map
  const nodes = new Map<NodeId, ParsedNode>();
  for (const [id, v] of Object.entries(rawVertices)) {
    nodes.set(id, {
      id,
      label: v.label ?? v.text ?? "",
      shape: SHAPE_MAP[v.type] ?? "rectangle",
      classes: v.classes ? [...v.classes] : [],
      cluster: nodeToCluster.get(id),
    });
  }

  // Build edges with per-(from,to) ordinal counter
  const ordinalCounter = new Map<string, number>();
  const edges: ParsedEdge[] = rawEdges.map((e) => {
    const key = `${e.start}:${e.end}`;
    const ordinal = ordinalCounter.get(key) ?? 0;
    ordinalCounter.set(key, ordinal + 1);
    return {
      from: e.start,
      to: e.end,
      label: e.text ?? "",
      ordinal,
      type: EDGE_TYPE_MAP[e.type] ?? "arrow",
    };
  });

  return {
    type: "flowchart", // overridden by adapter.ts spread with detected type
    nodes,
    edges,
    clusters,
    renames: [], // overridden by adapter.ts spread with parsed annotations
    direction,
  };
}
