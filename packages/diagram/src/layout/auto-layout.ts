/**
 * A4 — Auto-layout: compute initial (x,y,w,h) positions for a ParsedDiagram.
 *
 * Entry point: computeInitialLayout()
 *   - Dispatches on diagramType to the correct per-type layout function.
 *   - diag.1 supports: flowchart, stateDiagram-v2, classDiagram, erDiagram
 *     all via @dagrejs/dagre (Sugiyama layered algorithm).
 *   - block-beta and mindmap throw UnsupportedDiagramTypeError — they require
 *     cytoscape-fcose and d3-hierarchy respectively (diag.2 additions).
 *
 * Tech debt: TD-AL-01 — layout-aware incremental re-layout (pin existing nodes
 * as dagre fixed constraints for batch-add / subgraph-rewrite scenarios).
 *
 * Source: diag_arch_v4.2.md §15.1, diag_workplan.md §5 A4
 */

import dagre from "@dagrejs/dagre";

import type {
  ParsedDiagram,
  ParsedNode,
  LayoutStore,
  NodeLayout,
  EdgeLayout,
  ClusterLayout,
  SpatialDiagramType,
} from "../types.js";
import { createEmptyLayout } from "./layout-store.js";

// ── Constants ─────────────────────────────────────────────────────────────────

/** Diagram types handled by dagre in diag.1. */
const DAGRE_TYPES = new Set<string>([
  "flowchart",
  "classDiagram",
  "stateDiagram-v2",
  "erDiagram",
]);

/** Default node dimensions by shape (width × height, pixels). */
const SHAPE_DIMS: Record<string, { w: number; h: number }> = {
  rectangle: { w: 180, h: 60 },
  rounded:   { w: 180, h: 60 },
  diamond:   { w: 140, h: 80 },
  circle:    { w: 80,  h: 80 },
  cylinder:  { w: 120, h: 80 },
};

const FALLBACK_DIMS = { w: 180, h: 60 };

/** Padding added around member-node centres when computing cluster bounds. */
const CLUSTER_MARGIN = 20;

/**
 * Per-type rankdir defaults (diag_arch_v4.2.md §15.1).
 * erDiagram is conventionally read left-to-right and its relationships are
 * undirected, so LR gives a more natural reading direction than TB.
 * All other dagre types default to TB.
 */
const DEFAULT_RANKDIR: Partial<Record<string, LayoutOptions["rankdir"]>> = {
  erDiagram: "LR",
};

// ── Public interfaces ─────────────────────────────────────────────────────────

/**
 * Options that tune the dagre layout pass.
 * All fields optional; sensible defaults are applied.
 */
export interface LayoutOptions {
  /** Rank direction. Defaults to "TB" (top-to-bottom). */
  rankdir?: "TB" | "LR" | "RL" | "BT";
  /** Horizontal gap between nodes in the same rank (dagre nodesep). Default: 60. */
  nodeSpacing?: number;
  /** Vertical gap between ranks (dagre ranksep). Default: 80. */
  rankSpacing?: number;
}

/**
 * Thrown when computeInitialLayout is called for a diagram type that has no
 * layout implementation in the current diag version.
 */
export class UnsupportedDiagramTypeError extends Error {
  constructor(type: string) {
    super(
      `Auto-layout for diagram type "${type}" is not supported in diag.1. ` +
        `block-beta requires cytoscape-fcose; mindmap requires d3-hierarchy (diag.2).`
    );
    this.name = "UnsupportedDiagramTypeError";
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getDims(node: ParsedNode): { w: number; h: number; } {
  return SHAPE_DIMS[node.shape] ?? FALLBACK_DIMS;
}

// ── Core layout ───────────────────────────────────────────────────────────────

/**
 * Run the dagre Sugiyama algorithm over `parsed` and build a LayoutStore.
 * x/y values stored in NodeLayout are the dagre-computed CENTRE coordinates.
 */
function layoutWithDagre(
  parsed: ParsedDiagram,
  options: Required<LayoutOptions>
): LayoutStore {
  const { rankdir, nodeSpacing, rankSpacing } = options;

  // Multigraph to support parallel edges between the same pair of nodes.
  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setGraph({ rankdir, nodesep: nodeSpacing, ranksep: rankSpacing });
  g.setDefaultEdgeLabel(() => ({}));

  // --- nodes ---
  for (const [id, node] of parsed.nodes) {
    const { w, h } = getDims(node);
    g.setNode(id, { width: w, height: h });
  }

  // --- edges (use EdgeKey as the multigraph edge name) ---
  for (const edge of parsed.edges) {
    const key = `${edge.from}->${edge.to}:${edge.ordinal}`;
    g.setEdge(edge.from, edge.to, {}, key);
  }

  dagre.layout(g);

  // --- collect node results ---
  const nodes: Record<string, NodeLayout> = {};
  for (const [id, parsedNode] of parsed.nodes) {
    // @dagrejs/dagre mutates the node label object in-place during layout(),
    // injecting `x` and `y` fields. The type definitions do not reflect this
    // runtime behaviour, so the cast is the only way to access these fields.
    const placed = g.node(id) as { x: number; y: number; width: number; height: number };
    const { w, h } = getDims(parsedNode);
    nodes[id] = {
      x: placed.x,
      y: placed.y,
      w,
      h,
      style: {},
    };
  }

  // --- collect edge results ---
  const edges: Record<string, EdgeLayout> = {};
  for (const edge of parsed.edges) {
    const key = `${edge.from}->${edge.to}:${edge.ordinal}`;
    edges[key] = {
      routing: "auto",
      waypoints: [],
      style: {},
    };
  }

  // --- compute cluster bounding boxes ---
  const clusters: Record<string, ClusterLayout> = {};
  for (const cluster of parsed.clusters) {
    const xs: number[] = [];
    const ys: number[] = [];

    for (const memberId of cluster.members) {
      const n = nodes[memberId];
      if (n === undefined) continue;
      xs.push(n.x);
      ys.push(n.y);
    }

    if (xs.length === 0) {
      // Cluster with no placed members: zero-size at origin.
      clusters[cluster.id] = { x: 0, y: 0, w: 0, h: 0, label: cluster.label, style: {} };
      continue;
    }

    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    clusters[cluster.id] = {
      x: minX - CLUSTER_MARGIN,
      y: minY - CLUSTER_MARGIN,
      w: maxX - minX + 2 * CLUSTER_MARGIN,
      h: maxY - minY + 2 * CLUSTER_MARGIN,
      label: cluster.label,
      style: {},
    };
  }

  // Safe: the DAGRE_TYPES guard at call-site ensures parsed.type is one of the
  // four SpatialDiagramType values in DAGRE_TYPES before this function is reached.
  const base = createEmptyLayout(parsed.type as SpatialDiagramType);
  return { ...base, nodes, edges, clusters };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Compute the initial LayoutStore for a freshly parsed spatial diagram.
 * Called once on accordo_diagram_create and on resetLayout.
 *
 * @param parsed   - ParsedDiagram from parseMermaid()
 * @param options  - Optional layout tuning
 * @returns A complete LayoutStore with every node, edge, and cluster placed.
 * @throws UnsupportedDiagramTypeError for non-dagre types in diag.1.
 */
export function computeInitialLayout(
  parsed: ParsedDiagram,
  options?: LayoutOptions
): LayoutStore {
  if (!DAGRE_TYPES.has(parsed.type)) {
    throw new UnsupportedDiagramTypeError(parsed.type);
  }

  const typeDefaultRankdir = DEFAULT_RANKDIR[parsed.type] ?? "TB";
  const opts: Required<LayoutOptions> = {
    rankdir:     options?.rankdir     ?? typeDefaultRankdir,
    nodeSpacing: options?.nodeSpacing ?? 60,
    rankSpacing: options?.rankSpacing ?? 80,
  };

  return layoutWithDagre(parsed, opts);
}
