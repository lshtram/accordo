/**
 * Element mapper — maps @excalidraw/mermaid-to-excalidraw output
 * back to Accordo's identity model (NodeId, EdgeKey, ClusterId).
 *
 * The upstream library returns positioned ExcalidrawElementSkeleton[]
 * with labels but no Mermaid IDs. This module reverse-maps labels to
 * Accordo's stable IDs using the ParsedDiagram as the source of truth.
 *
 * Source: docs/30-development/diagram-update-plan.md §7.2
 */

import type { ParsedDiagram, NodeLayout, ClusterLayout } from "../types.js";
import { mapStateGeometryToLayout } from "./state-identity.js";

// ── Public types ──────────────────────────────────────────────────────────────

/** A positioned element extracted from upstream output. */
export interface UpstreamGeometry {
  /** Display label text (used for matching back to Accordo IDs). */
  label: string;
  /** X coordinate (top-left). */
  x: number;
  /** Y coordinate (top-left). */
  y: number;
  /** Width in pixels. */
  width: number;
  /** Height in pixels. */
  height: number;
  /** Upstream element type hint (rectangle, diamond, etc.). */
  type?: string;
  /**
   * Group ID from upstream — used to identify cluster membership.
   * Elements in the same groupId belong to the same subgraph.
   */
  groupId?: string;
}

/** Result of the mapping pass. */
export interface MappingResult {
  /** Successfully mapped node positions, keyed by NodeId. */
  nodes: Record<string, NodeLayout>;
  /** Successfully mapped cluster bounds, keyed by ClusterId. */
  clusters: Record<string, ClusterLayout>;
  /** Node IDs that could not be matched (will fall back to dagre). */
  unmatchedNodeIds: string[];
  /** Warnings generated during mapping (logged, not thrown). */
  warnings: string[];
}

// ── Supported shape types ────────────────────────────────────────────────────

const SUPPORTED_TYPES = new Set<string>(["rectangle", "diamond", "ellipse", "circle"]);

// ── Cluster bounds normalization ──────────────────────────────────────────────
// These values MUST match the constants in auto-layout.ts so that excalidraw
// and dagre cluster bounds use identical conventions (R5 in diagram-update-plan).

/** Padding added around member-node extents when computing cluster bounds. */
const CLUSTER_MARGIN = 20;

/**
 * Extra top padding reserved for the cluster title label.
 * Ensures the label text sits above the topmost member node.
 * Font size 16 + breathing room = 28px.
 */
const CLUSTER_LABEL_HEIGHT = 28;

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Extract positioned elements from upstream ExcalidrawElementSkeleton[].
 *
 * Filters to shape elements (rectangles, diamonds, ellipses) and extracts
 * their geometry + label text for subsequent identity matching.
 *
 * @param skeletons - Raw elements from parseMermaidToExcalidraw().elements
 * @returns Extracted geometry entries ready for identity matching
 */
export function extractGeometry(
  // ExcalidrawElementSkeleton[] — typed as unknown[] to avoid tight coupling
  // to the upstream library's internal types at the module boundary.
  skeletons: readonly unknown[],
): UpstreamGeometry[] {
  const result: UpstreamGeometry[] = [];

  for (const skeleton of skeletons) {
    if (!isSupportedSkeleton(skeleton)) {
      continue;
    }

    const typed = skeleton as Record<string, unknown>;

    // label/text is used for matching regular shapes.
    // For circle/ellipse pseudostate candidates, allow through even with no label —
    // isPseudostateGeometry() downstream will classify them by size+shape.
    const label = extractLabel(typed) ?? (isPseudostateType(typed.type) ? "" : undefined);
    if (label === undefined) {
      continue;
    }

    result.push({
      label,
      x: Number(typed.x) || 0,
      y: Number(typed.y) || 0,
      width: Number(typed.width) || 0,
      height: Number(typed.height) || 0,
      type: typeof typed.type === "string" ? typed.type : undefined,
      groupId: typeof typed.groupId === "string" ? typed.groupId : undefined,
    });
  }

  return result;
}

/**
 * Map upstream geometry to Accordo's identity model.
 *
 * Algorithm:
 * 1. Build a reverse index: label → NodeId[] from ParsedDiagram.nodes
 * 2. For each upstream geometry element, find matching NodeId(s) by label
 * 3. If multiple nodes share a label, match in declaration order
 *    (consume NodeIds in ParsedDiagram.nodes insertion order)
 * 4. Sort geometries by (y, x) as a stable tiebreaker when output order is unstable
 * 5. For clusters: match by subgraph label via ParsedDiagram.clusters (requires groupId)
 * 6. Unmatched nodes are reported in MappingResult.unmatchedNodeIds
 *
 * @param geometries - Positioned elements from extractGeometry()
 * @param parsed     - Accordo's ParsedDiagram (source of truth for IDs)
 * @returns MappingResult with matched positions and unmatched fallbacks
 */
export function mapGeometryToLayout(
  geometries: readonly UpstreamGeometry[],
  parsed: ParsedDiagram,
): MappingResult {
  // ── State diagram dispatch (diag.2.6 SUP-S) ────────────────────────────────
  if (parsed.type === "stateDiagram-v2") {
    return mapStateGeometryToLayout(geometries, parsed);
  }

  // Build label → NodeId[] reverse index, preserving insertion order
  const labelToNodeIds = buildLabelIndex(parsed);

  // Track how many nodes have been consumed per label (for declaration-order matching)
  const labelCursor: Record<string, number> = {};

  // Sort geometries by (y, x) for stable matching when upstream output order is unstable
  const sorted = [...geometries].sort(sortByPosition);

  const nodes: Record<string, NodeLayout> = {};
  const clusters: Record<string, ClusterLayout> = {};
  const matchedNodeIds = new Set<string>();
  const warnings: string[] = [];

  // ── Pass 1: match nodes ──────────────────────────────────────────────────────
  for (const geo of sorted) {
    const nodeIds = labelToNodeIds.get(geo.label);
    if (!nodeIds || nodeIds.length === 0) {
      // Geometry label has no corresponding node in the parsed diagram
      warnings.push(`Unknown geometry label "${geo.label}" — no matching node in diagram`);
      continue;
    }

    // Consume nodes in declaration order for this label
    const cursor = labelCursor[geo.label] ?? 0;
    if (cursor >= nodeIds.length) {
      // All nodes with this label have already been matched; this geometry is extra
      warnings.push(`Extra geometry for label "${geo.label}" — no remaining node to match`);
      continue;
    }

    const nodeId = nodeIds[cursor];
    labelCursor[geo.label] = cursor + 1;

    nodes[nodeId] = {
      x: geo.x,
      y: geo.y,
      w: geo.width,
      h: geo.height,
      style: {},
    };
    matchedNodeIds.add(nodeId);
  }

  // ── Pass 2: match clusters (requires groupId) ────────────────────────────────
  const clusterByLabel = buildClusterLabelIndex(parsed);

  // Normalized clusters (built in reverse order so nested clusters are
  // processed before their parent clusters). This mirrors the logic in
  // auto-layout.ts recomputeClusterBox() so that excalidraw-derived bounds
  // use the same CLUSTER_MARGIN + CLUSTER_LABEL_HEIGHT convention as dagre.
  const normalizedClusters: Record<string, ClusterLayout> = {};

  // Iterate in reverse so children (which appear later in parsed.clusters)
  // are normalized before their parent clusters.
  for (let i = parsed.clusters.length - 1; i >= 0; i--) {
    const cluster = parsed.clusters[i];

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

      const childCluster = normalizedClusters[memberId];
      if (childCluster !== undefined) {
        lefts.push(childCluster.x);
        rights.push(childCluster.x + childCluster.w);
        tops.push(childCluster.y);
        bottoms.push(childCluster.y + childCluster.h);
      }
    }

    if (lefts.length === 0) {
      normalizedClusters[cluster.id] = { x: 0, y: 0, w: 0, h: 0, label: cluster.label, style: {} };
      continue;
    }

    const left = Math.min(...lefts);
    const right = Math.max(...rights);
    const top = Math.min(...tops);
    const bottom = Math.max(...bottoms);

    // Apply same margin + label-height convention as recomputeClusterBox in
    // auto-layout.ts so excalidraw and dagre cluster bounds are consistent.
    normalizedClusters[cluster.id] = {
      x: left - CLUSTER_MARGIN,
      y: top - CLUSTER_MARGIN - CLUSTER_LABEL_HEIGHT,
      w: right - left + 2 * CLUSTER_MARGIN,
      h: bottom - top + 2 * CLUSTER_MARGIN + CLUSTER_LABEL_HEIGHT,
      label: cluster.label,
      style: {},
    };
  }

  // Assign normalized clusters for which we have upstream geometry (groupId match)
  for (const geo of sorted) {
    if (!geo.groupId) {
      continue;
    }

    const clusterId = clusterByLabel.get(geo.label);
    if (!clusterId) {
      continue;
    }

    // Use the pre-normalized cluster bounds (from the reverse-order pass above)
    if (normalizedClusters[clusterId] !== undefined) {
      clusters[clusterId] = normalizedClusters[clusterId];
    }
  }

  // ── Collect unmatched nodes ──────────────────────────────────────────────────
  const unmatchedNodeIds: string[] = [];
  for (const nodeId of parsed.nodes.keys()) {
    if (!matchedNodeIds.has(nodeId)) {
      unmatchedNodeIds.push(nodeId);
    }
  }

  return { nodes, clusters, unmatchedNodeIds, warnings };
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/** Extract label from a skeleton element (tries `text` then `label`). */
function extractLabel(skeleton: Record<string, unknown>): string | undefined {
  if (typeof skeleton.text === "string" && skeleton.text.length > 0) {
    return skeleton.text;
  }
  if (typeof skeleton.label === "string" && skeleton.label.length > 0) {
    return skeleton.label;
  }
  if (
    typeof skeleton.label === "object" &&
    skeleton.label !== null &&
    typeof (skeleton.label as { text?: unknown }).text === "string" &&
    (skeleton.label as { text: string }).text.length > 0
  ) {
    return (skeleton.label as { text: string }).text;
  }
  return undefined;
}

function isPseudostateType(type: unknown): boolean {
  return type === "circle" || type === "ellipse";
}

/**
 * Returns true if the skeleton object looks like a supported shape type.
 * A supported skeleton must have `type` set to one of the known shape types
 * and have numeric geometry fields.
 */
function isSupportedSkeleton(skeleton: unknown): skeleton is Record<string, unknown> {
  if (typeof skeleton !== "object" || skeleton === null) {
    return false;
  }
  const s = skeleton as Record<string, unknown>;
  if (typeof s.type !== "string") {
    return false;
  }
  if (!SUPPORTED_TYPES.has(s.type)) {
    return false;
  }
  // Must have numeric geometry fields (at least width/height to be meaningful)
  if (typeof s.width !== "number" && typeof s.width !== "string") {
    return false;
  }
  if (typeof s.height !== "number" && typeof s.height !== "string") {
    return false;
  }
  return true;
}

/**
 * Build label → NodeId[] index from ParsedDiagram.nodes.
 * Maintains insertion order (Map iteration order = declaration order in source).
 */
function buildLabelIndex(parsed: ParsedDiagram): Map<string, readonly string[]> {
  const map = new Map<string, string[]>();
  for (const [nodeId, node] of parsed.nodes) {
    const existing = map.get(node.label);
    if (existing) {
      existing.push(nodeId);
    } else {
      map.set(node.label, [nodeId]);
    }
  }
  return map;
}

/**
 * Build label → ClusterId index from ParsedDiagram.clusters.
 * Multiple clusters with the same label are not supported in Mermaid,
 * but we handle it by keeping the last one.
 */
function buildClusterLabelIndex(parsed: ParsedDiagram): Map<string, string> {
  const map = new Map<string, string>();
  for (const cluster of parsed.clusters) {
    map.set(cluster.label, cluster.id);
  }
  return map;
}

/** Sort key: primary by y (top-to-bottom), secondary by x (left-to-right). */
function sortByPosition(a: UpstreamGeometry, b: UpstreamGeometry): number {
  if (a.y !== b.y) return a.y - b.y;
  return a.x - b.x;
}
