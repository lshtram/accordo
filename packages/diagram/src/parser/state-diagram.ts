/**
 * C — StateDiagram-v2 parser (internal)
 *
 * Accesses the mermaid `diagram.db` API (mermaid 11.x).
 * This is the ONLY file in the codebase that imports mermaid internals for
 * stateDiagram-v2. All other modules use the stable ParsedDiagram type via adapter.ts.
 *
 * Source: diagram-types-architecture.md §2
 */

import type {
  ParsedDiagram,
  ParsedNode,
  ParsedEdge,
  ParsedCluster,
  NodeId,
  ClusterId,
  NodeShape,
} from "../types.js";

/**
 * Internal type representing the mermaid stateDiagram-v2 parser database object.
 * Typing is loose (unknown fields) because this is an undocumented API.
 * Narrowed inside parseStateDiagram via runtime checks.
 */
export type StateDiagramDb = Record<string, unknown>;

// ── Internal shapes matching mermaid 11.x stateDiagram db ─────────────────────

interface MermaidStateNode {
  id: string;
  label: string;
  shape: string;
  cssClasses: string;
  isGroup: boolean;
  parentId?: string;
  domId?: string;
  type?: string;
  padding?: number;
  rx?: number;
  ry?: number;
  look?: string;
  centerLabel?: boolean;
  labelStyle?: string;
  cssCompiledStyles?: string[];
  cssStyles?: string[];
}

interface MermaidStateEdge {
  id: string;
  start: string;
  end: string;
  label: string;
  arrowhead?: string;
  arrowTypeEnd?: string;
  thickness?: string;
  classes?: string;
  style?: string;
  labelStyle?: string;
  labelpos?: string;
  labelType?: string;
  arrowheadStyle?: string;
  look?: string;
}

// ── Shape mapping table ───────────────────────────────────────────────────────

const SHAPE_MAP: Readonly<Record<string, NodeShape>> = {
  rect: "rounded",
  stateStart: "stateStart",
  stateEnd: "stateEnd",
  // roundedWithTitle is for composite states (clusters, not nodes)
};

/**
 * Convert a mermaid stateDiagram parser `db` object into a stable ParsedDiagram.
 *
 * Called only from adapter.ts after `mermaid.mermaidAPI.getDiagramFromText()`
 * returns a stateDiagram-v2 diagram. All mermaid-version-specific field access lives
 * here so breakage on Mermaid upgrades is isolated to this file.
 */
export function parseStateDiagram(db: StateDiagramDb): ParsedDiagram {
  // Runtime guards before casting — db is Record<string, unknown>
  const rawNodes = Array.isArray(db.nodes) ? (db.nodes as MermaidStateNode[]) : [];
  const rawEdges = Array.isArray(db.edges) ? (db.edges as MermaidStateEdge[]) : [];

  // Build cluster membership: nodeId → clusterId
  const nodeToCluster = new Map<NodeId, ClusterId>();

  // Build clusters from composite states
  const clusters: ParsedCluster[] = [];
  for (const node of rawNodes) {
    if (node.isGroup) {
      // Find all children of this composite state
      const members = rawNodes
        .filter((n) => n.parentId === node.id)
        .map((n) => n.id);

      for (const memberId of members) {
        nodeToCluster.set(memberId, node.id);
      }

      clusters.push({
        id: node.id,
        label: node.label,
        members,
        // parent will be set in second pass if this cluster is nested
      });
    }
  }

  // Second pass: derive parent from membership for nested clusters
  for (const node of rawNodes) {
    if (node.isGroup && node.parentId) {
      const childCluster = clusters.find((c) => c.id === node.id);
      if (childCluster) {
        childCluster.parent = node.parentId;
      }
    }
  }

  // Build nodes map (exclude composite states — they become clusters)
  const nodes = new Map<NodeId, ParsedNode>();
  for (const node of rawNodes) {
    // Skip composite states — they become clusters, not nodes
    if (node.isGroup) continue;

    // Extract classes from cssClasses string
    // cssClasses format: " statediagram-state" or " statediagram-state critical"
    const classes = node.cssClasses
      .split(/\s+/)
      .filter((c) => c.length > 0);

    nodes.set(node.id, {
      id: node.id,
      label: node.shape === "stateStart" || node.shape === "stateEnd" ? "" : node.label,
      shape: SHAPE_MAP[node.shape] ?? "rounded",
      classes,
      cluster: nodeToCluster.get(node.id),
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
      label: e.label ?? "",
      ordinal,
      type: "arrow" as const, // All stateDiagram edges are arrows
    };
  });

  return {
    type: "stateDiagram-v2", // overridden by adapter.ts spread with detected type
    nodes,
    edges,
    clusters,
    renames: [], // stateDiagram-v2 does not support @rename annotations
    direction: "TD", // Default direction for stateDiagram-v2
  };
}
