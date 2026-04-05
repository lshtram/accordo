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
  ParsedCluster,
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
  stateStart: { w: 30, h: 30 },
  stateEnd:   { w: 30, h: 30 },
};

const FALLBACK_DIMS = { w: 180, h: 60 };

/** Padding added around member-node extents when computing cluster bounds. */
const CLUSTER_MARGIN = 20;

/**
 * Extra top padding reserved for the cluster title label.
 * Ensures the label text sits above the topmost member node rather than
 * overlapping it. Font size 16 + a few pixels breathing room = 28px.
 */
const CLUSTER_LABEL_HEIGHT = 28;

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

function getClusterLeafNodes(
  clusterId: string,
  clusterMembers: ReadonlyMap<string, readonly string[]>,
): string[] {
  const members = clusterMembers.get(clusterId) ?? [];
  const leaves: string[] = [];

  for (const memberId of members) {
    if (clusterMembers.has(memberId)) {
      leaves.push(...getClusterLeafNodes(memberId, clusterMembers));
      continue;
    }
    leaves.push(memberId);
  }

  return leaves;
}

function getClusterAnchorNodes(
  clusterId: string,
  direction: "in" | "out",
  parsed: ParsedDiagram,
  clusterMembers: ReadonlyMap<string, readonly string[]>,
): string[] {
  const descendants = getClusterLeafNodes(clusterId, clusterMembers);
  const descendantSet = new Set(descendants);

  if (direction === "in") {
    const starts = descendants.filter((id) => parsed.nodes.get(id)?.shape === "stateStart");
    if (starts.length > 0) {
      return starts;
    }

    const internalTargets = new Set(
      parsed.edges
        .filter((edge) => descendantSet.has(edge.from) && descendantSet.has(edge.to))
        .map((edge) => edge.to),
    );
    const roots = descendants.filter((id) => !internalTargets.has(id));
    if (roots.length > 0) {
      return roots;
    }

    return descendants.slice(0, 1);
  }

  const ends = descendants.filter((id) => parsed.nodes.get(id)?.shape === "stateEnd");
  if (ends.length > 0) {
    return ends;
  }

  const internalSources = new Set(
    parsed.edges
      .filter((edge) => descendantSet.has(edge.from) && descendantSet.has(edge.to))
      .map((edge) => edge.from),
  );
  const leaves = descendants.filter(
    (id) => !internalSources.has(id) && parsed.nodes.get(id)?.shape !== "stateStart",
  );
  if (leaves.length > 0) {
    return leaves;
  }

  const nonStarts = descendants.filter((id) => parsed.nodes.get(id)?.shape !== "stateStart");
  return nonStarts.length > 0 ? nonStarts : descendants;
}

function shiftClusterSubtree(
  clusterId: string,
  deltaY: number,
  nodes: Record<string, NodeLayout>,
  clusters: Record<string, ClusterLayout>,
  clusterMembers: ReadonlyMap<string, readonly string[]>,
): void {
  const cluster = clusters[clusterId];
  if (cluster !== undefined) {
    cluster.y += deltaY;
  }

  for (const memberId of clusterMembers.get(clusterId) ?? []) {
    const node = nodes[memberId];
    if (node !== undefined) {
      node.y += deltaY;
      continue;
    }
    if (clusters[memberId] !== undefined) {
      shiftClusterSubtree(memberId, deltaY, nodes, clusters, clusterMembers);
    }
  }
}

function recomputeClusterBox(
  cluster: ParsedCluster,
  nodes: Record<string, NodeLayout>,
  clusters: Record<string, ClusterLayout>,
): void {
  const lefts: number[] = [];
  const rights: number[] = [];
  const tops: number[] = [];
  const bottoms: number[] = [];

  for (const memberId of cluster.members) {
    const node = nodes[memberId];
    if (node !== undefined) {
      lefts.push(node.x);
      rights.push(node.x + node.w);
      tops.push(node.y);
      bottoms.push(node.y + node.h);
    }

    const childCluster = clusters[memberId];
    if (childCluster !== undefined) {
      lefts.push(childCluster.x);
      rights.push(childCluster.x + childCluster.w);
      tops.push(childCluster.y);
      bottoms.push(childCluster.y + childCluster.h);
    }
  }

  if (lefts.length === 0) {
    clusters[cluster.id] = { x: 0, y: 0, w: 0, h: 0, label: cluster.label, style: {} };
    return;
  }

  const left = Math.min(...lefts);
  const right = Math.max(...rights);
  const top = Math.min(...tops);
  const bottom = Math.max(...bottoms);

  clusters[cluster.id] = {
    x: left - CLUSTER_MARGIN,
    y: top - CLUSTER_MARGIN - CLUSTER_LABEL_HEIGHT,
    w: right - left + 2 * CLUSTER_MARGIN,
    h: bottom - top + 2 * CLUSTER_MARGIN + CLUSTER_LABEL_HEIGHT,
    label: cluster.label,
    style: {},
  };
}

// ── Core layout ───────────────────────────────────────────────────────────────

/**
 * Run the dagre Sugiyama algorithm over `parsed` and build a LayoutStore.
 * Dagre returns node coordinates at the centre point; NodeLayout stores the
 * rendered node's top-left corner.
 *
 * When the diagram has clusters (subgraphs), the graph is built with
 * `compound: true` and each cluster member's parent is set via setParent().
 * This ensures dagre places external nodes (outside any subgraph) outside the
 * cluster footprint rather than topologically inside it.
 */
function layoutWithDagre(
  parsed: ParsedDiagram,
  options: Required<LayoutOptions>
): LayoutStore {
  const { rankdir, nodeSpacing, rankSpacing } = options;
  const hasCompound = parsed.clusters.length > 0;

  // Use compound mode when there are subgraphs so dagre respects containment.
  const g = new dagre.graphlib.Graph({ multigraph: true, compound: hasCompound });
  g.setGraph({ rankdir, nodesep: nodeSpacing, ranksep: rankSpacing });
  g.setDefaultEdgeLabel(() => ({}));
  const clusterIds = new Set(parsed.clusters.map((cluster) => cluster.id));
  const clusterMembers = new Map(
    parsed.clusters.map((cluster) => [cluster.id, cluster.members] as const),
  );

  // --- cluster nodes (must be added before their children) ---
  if (hasCompound) {
    for (const cluster of parsed.clusters) {
      // Cluster node has no intrinsic size — dagre computes it from members.
      g.setNode(cluster.id, { label: cluster.id });
    }
  }

  // --- regular nodes ---
  for (const [id, node] of parsed.nodes) {
    const { w, h } = getDims(node);
    g.setNode(id, { width: w, height: h });
  }

  // --- parent relationships ---
  if (hasCompound) {
    for (const cluster of parsed.clusters) {
      // Only set parent for regular nodes (not child clusters)
      // Child clusters are handled separately via cluster.parent below
      for (const memberId of cluster.members) {
        if (!clusterIds.has(memberId)) {
          g.setParent(memberId, cluster.id);
        }
      }
      // Set parent for nested clusters
      if (cluster.parent) {
        g.setParent(cluster.id, cluster.parent);
      }
    }
  }

  // --- edges (use EdgeKey as the multigraph edge name) ---
  for (const edge of parsed.edges) {
    const fromIds = clusterIds.has(edge.from)
      ? getClusterAnchorNodes(edge.from, "out", parsed, clusterMembers)
      : [edge.from];
    const toIds = clusterIds.has(edge.to)
      ? getClusterAnchorNodes(edge.to, "in", parsed, clusterMembers)
      : [edge.to];

    let syntheticOrdinal = 0;
    for (const fromId of fromIds) {
      for (const toId of toIds) {
        const key = `${edge.from}->${edge.to}:${edge.ordinal}:${syntheticOrdinal}`;
        g.setEdge(fromId, toId, {}, key);
        syntheticOrdinal += 1;
      }
    }
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
      x: placed.x - (w / 2),
      y: placed.y - (h / 2),
      w,
      h,
      style: {},
    };
  }

  // --- collect edge results ---
  // Skip edges that reference cluster IDs (same filter as when adding to dagre)
  const edges: Record<string, EdgeLayout> = {};
  for (const edge of parsed.edges) {
    if (clusterIds.has(edge.from) || clusterIds.has(edge.to)) {
      continue;
    }
    const key = `${edge.from}->${edge.to}:${edge.ordinal}`;
    edges[key] = {
      routing: "auto",
      waypoints: [],
      style: {},
    };
  }

  // --- compute cluster bounding boxes ---
  // NodeLayout.x/y are stored as top-left coords. Use full extents so the
  // cluster box wraps the rendered shapes on canvas.
  const clusters: Record<string, ClusterLayout> = {};
  
  // Process clusters in reverse order so nested clusters (which appear later
  // in the array) are processed before their parent clusters. This ensures
  // parent clusters can include child cluster bounds in their bounding box.
  for (let i = parsed.clusters.length - 1; i >= 0; i--) {
    const cluster = parsed.clusters[i];
    recomputeClusterBox(cluster, nodes, clusters);
  }

  if (parsed.type === "stateDiagram-v2") {
    for (let i = parsed.clusters.length - 1; i >= 0; i--) {
      const cluster = parsed.clusters[i];
      const directMembers = cluster.members
        .map((memberId) => {
          const node = nodes[memberId];
          if (node !== undefined) {
            return { id: memberId, y: node.y, bottom: node.y + node.h, isCluster: false };
          }

          const childCluster = clusters[memberId];
          if (childCluster !== undefined) {
            return {
              id: memberId,
              y: childCluster.y,
              bottom: childCluster.y + childCluster.h,
              isCluster: true,
            };
          }

          return null;
        })
        .filter((member): member is { id: string; y: number; bottom: number; isCluster: boolean } => member !== null)
        .sort((a, b) => a.y - b.y);

      if (directMembers.length < 2) {
        recomputeClusterBox(cluster, nodes, clusters);
        continue;
      }

      if (directMembers.every((member) => member.isCluster)) {
        const targetY = Math.min(...directMembers.map((member) => member.y));
        for (const member of directMembers) {
          const deltaY = targetY - member.y;
          if (deltaY !== 0) {
            shiftClusterSubtree(member.id, deltaY, nodes, clusters, clusterMembers);
          }
        }
        recomputeClusterBox(cluster, nodes, clusters);
        continue;
      }

      let previousBottom = directMembers[0].bottom;
      for (const member of directMembers.slice(1)) {
        const targetY = previousBottom + rankSpacing;
        const deltaY = targetY - member.y;
        if (deltaY !== 0) {
          if (member.isCluster) {
            shiftClusterSubtree(member.id, deltaY, nodes, clusters, clusterMembers);
          } else {
            nodes[member.id]!.y += deltaY;
          }
        }

        const node = nodes[member.id];
        const childCluster = clusters[member.id];
        previousBottom = node !== undefined
          ? node.y + node.h
          : childCluster.y + childCluster.h;
      }

      recomputeClusterBox(cluster, nodes, clusters);
    }

    for (const edge of parsed.edges) {
      if (!clusterIds.has(edge.to)) {
        continue;
      }

      const externalNode = parsed.nodes.get(edge.from);
      const targetCluster = clusters[edge.to];
      const externalLayout = nodes[edge.from];
      if (
        externalNode?.shape !== "stateStart" ||
        targetCluster === undefined ||
        externalLayout === undefined
      ) {
        continue;
      }

      externalLayout.x = targetCluster.x + (targetCluster.w - externalLayout.w) / 2;
      externalLayout.y = targetCluster.y - rankSpacing - externalLayout.h;
    }

    for (const edge of parsed.edges) {
      if (!clusterIds.has(edge.from)) {
        continue;
      }

      const externalNode = parsed.nodes.get(edge.to);
      const sourceCluster = clusters[edge.from];
      const externalLayout = nodes[edge.to];
      if (
        externalNode?.shape !== "stateEnd" ||
        sourceCluster === undefined ||
        externalLayout === undefined
      ) {
        continue;
      }

      externalLayout.x = sourceCluster.x + (sourceCluster.w - externalLayout.w) / 2;
      externalLayout.y = sourceCluster.y + sourceCluster.h + rankSpacing;
    }
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
