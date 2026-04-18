/**
 * state-identity — State-diagram-specific identity matching for upstream placement.
 *
 * SUP-S02: Pseudostates (`[*]` start/end) have no meaningful label text,
 * so the standard label-based matching in element-mapper.ts cannot identify them.
 * This module provides shape+position heuristic matching for state diagrams.
 *
 * SUP-S03: Composite states need cluster-aware matching that accounts for
 * the isGroup/parentId structure in ParsedDiagram.
 *
 * Called from element-mapper.ts when diagram type is "stateDiagram-v2".
 *
 * Source: docs/20-requirements/requirements-diagram.md §diag.2.6
 */

import type { ParsedDiagram, NodeId, NodeLayout, ClusterLayout } from "../types.js";
import type { UpstreamGeometry } from "./element-mapper.js";
import { layoutDebug } from "./layout-debug.js";

// ── Constants ─────────────────────────────────────────────────────────────────
// These values MUST match the constants in auto-layout.ts so that excalidraw
// and dagre cluster bounds use identical conventions (R5 in diagram-update-plan).

/** Pseudostates emitted by @excalidraw/mermaid-to-excalidraw for state diagrams. */
const PSEUDOSTATE_TYPES = new Set<string>(["circle", "ellipse"]);

/** Padding added around member-node extents when computing cluster bounds. */
const CLUSTER_MARGIN = 20;

/**
 * Extra top padding reserved for the cluster title label.
 * Ensures the label text sits above the topmost member node.
 * Font size 16 + breathing room = 28px.
 */
const CLUSTER_LABEL_HEIGHT = 28;

/** Maximum dimension (width or height) for a geometry to be considered a pseudostate. */
const PSEUDOSTATE_SIZE_THRESHOLD = 40;

/** Minimum dimension for a real state pseudostate outer ring. Tiny inner ellipses are decoration. */
const PSEUDOSTATE_MIN_SIZE = 10;

// ── SUP-S02: Pseudostate identity matching ────────────────────────────────────

/**
 * Determine if an upstream geometry element looks like a pseudostate.
 *
 * Heuristic: small circle (width <= 40, height <= 40) with no meaningful label.
 * Upstream emits start/end circles without text labels.
 *
 * @param geo - Upstream geometry element
 * @returns true if the element is likely a pseudostate
 */
export function isPseudostateGeometry(geo: UpstreamGeometry): boolean {
  if (geo.label !== "" && geo.label !== undefined) {
    return false;
  }
  if (!PSEUDOSTATE_TYPES.has(geo.type ?? "")) {
    return false;
  }
  if (geo.width < PSEUDOSTATE_MIN_SIZE || geo.height < PSEUDOSTATE_MIN_SIZE) {
    return false;
  }
  if (geo.width > PSEUDOSTATE_SIZE_THRESHOLD || geo.height > PSEUDOSTATE_SIZE_THRESHOLD) {
    return false;
  }
  return true;
}

/**
 * Match upstream pseudostate geometry elements to parsed pseudostate nodes.
 *
 * Strategy: sort both by Y then X position (top-to-bottom, left-to-right tiebreak)
 * and pair them in order. This is sufficient for linear chains and works
 * heuristically for more complex layouts.
 *
 * @param geometries - Positioned elements from extractGeometry()
 * @param parsed     - Accordo's ParsedDiagram (must be stateDiagram-v2)
 * @returns Map of geometry index → matched NodeId
 */
export function matchStatePseudostates(
  geometries: readonly UpstreamGeometry[],
  parsed: ParsedDiagram,
): Map<number, NodeId> {
  // Collect pseudostate geometries sorted by position
  const pseudoGeos = geometries
    .map((geo, index) => ({ geo, index }))
    .filter(({ geo }) => isPseudostateGeometry(geo))
    .sort((a, b) => {
      if (a.geo.y !== b.geo.y) return a.geo.y - b.geo.y;
      return a.geo.x - b.geo.x;
    });

  const clusterRects = geometries
    .filter((geo) => geo.label !== "")
    .map((geo) => ({
      label: geo.label,
      left: geo.x,
      right: geo.x + geo.width,
      top: geo.y,
      bottom: geo.y + geo.height,
    }));

  const matches = new Map<number, NodeId>();
  const unmatchedGeoIndices = new Set<number>(pseudoGeos.map(({ index }) => index));

  const clusteredPseudoNodes = [...parsed.nodes.entries()]
    .filter(([, node]) => node.shape === "stateStart" || node.shape === "stateEnd")
    .map(([nodeId, node]) => ({ nodeId, node }))
    .filter(({ node }) => node.cluster);

  for (const cluster of parsed.clusters) {
    const rect = clusterRects.find((r) => r.label === cluster.label);
    if (!rect) continue;

    const geosInCluster = pseudoGeos.filter(({ index, geo }) => (
      unmatchedGeoIndices.has(index)
      && geo.x >= rect.left - 1
      && geo.x + geo.width <= rect.right + 1
      && geo.y >= rect.top - 1
      && geo.y + geo.height <= rect.bottom + 1
    ));

    const clusterNodes = clusteredPseudoNodes.filter(({ node }) => node.cluster === cluster.id);
    const starts = clusterNodes
      .filter(({ node }) => node.shape === "stateStart")
      .sort((a, b) => a.nodeId.localeCompare(b.nodeId));
    const ends = clusterNodes
      .filter(({ node }) => node.shape === "stateEnd")
      .sort((a, b) => a.nodeId.localeCompare(b.nodeId));

    const startGeos = geosInCluster
      .filter(({ geo }) => geo.width >= 10 && geo.height >= 10)
      .sort((a, b) => {
        if (a.geo.y !== b.geo.y) return a.geo.y - b.geo.y;
        return a.geo.x - b.geo.x;
      });
    const endGeos = [...startGeos].reverse();

    for (let i = 0; i < Math.min(starts.length, startGeos.length); i++) {
      matches.set(startGeos[i]!.index, starts[i]!.nodeId);
      unmatchedGeoIndices.delete(startGeos[i]!.index);
    }

    for (let i = 0; i < Math.min(ends.length, endGeos.length); i++) {
      if (matches.has(endGeos[i]!.index)) continue;
      matches.set(endGeos[i]!.index, ends[i]!.nodeId);
      unmatchedGeoIndices.delete(endGeos[i]!.index);
    }
  }

  const remainingPseudoGeos = pseudoGeos.filter(({ index }) => unmatchedGeoIndices.has(index));
  const remainingPseudoNodes: NodeId[] = [];
  for (const [nodeId, node] of parsed.nodes) {
    if ((node.shape === "stateStart" || node.shape === "stateEnd") && ![...matches.values()].includes(nodeId)) {
      remainingPseudoNodes.push(nodeId);
    }
  }

  layoutDebug({
    category: "identity-match",
    message: `matchStatePseudostates: ${pseudoGeos.length} geometries, ${remainingPseudoNodes.length + matches.size} parsed pseudostates`,
    data: {
      geoIndices: pseudoGeos.map(({ index, geo }) => ({ index, type: geo.type, w: geo.width, h: geo.height })),
      nodeIds: [...parsed.nodes.keys()].filter((nodeId) => {
        const node = parsed.nodes.get(nodeId);
        return node?.shape === "stateStart" || node?.shape === "stateEnd";
      }),
    },
  });

  const maxLen = Math.min(remainingPseudoGeos.length, remainingPseudoNodes.length);
  for (let i = 0; i < maxLen; i++) {
    matches.set(remainingPseudoGeos[i]!.index, remainingPseudoNodes[i]!);
  }

  layoutDebug({
    category: "identity-match",
    message: `matchStatePseudostates: ${matches.size} pseudostate pairs matched`,
    data: { pairs: [...matches.entries()].map(([k, v]) => `${k}→${v}`) },
  });

  return matches;
}

// ── SUP-S03: Composite state cluster mapping ────────────────────────────────────

/**
 * Build a ClusterLayout for a composite state from its upstream group geometry.
 *
 * Applies CLUSTER_MARGIN + CLUSTER_LABEL_HEIGHT normalization so that
 * excalidraw-derived state clusters use the same dagre-equivalent convention
 * as the non-state cluster path in mapGeometryToLayout (R5 in diagram-update-plan).
 *
 * @param groupGeo - Upstream group/rectangle geometry for the cluster
 * @param label    - Cluster label
 * @param parentId - Parent cluster ID if nested, undefined for top-level
 */
function buildClusterLayout(
  groupGeo: UpstreamGeometry,
  label: string,
  parentId?: string,
): ClusterLayout {
  // For stateDiagram-v2, upstream rectangle geometry already describes the visible
  // composite-state shell. Do not add dagre-style margin/label padding here or the
  // shell becomes grossly inflated versus the live upstream layout.
  const layout: ClusterLayout = {
    x: groupGeo.x,
    y: groupGeo.y,
    w: groupGeo.width,
    h: groupGeo.height,
    label,
    style: {},
  };
  if (parentId !== undefined) {
    layout.parent = parentId;
  }
  return layout;
}

// ── SUP-S02+SUP-S03: Top-level entry point ─────────────────────────────────────

/**
 * Build a complete MappingResult for a stateDiagram-v2 by combining
 * standard label matching (for regular states) with pseudostate heuristics.
 *
 * This is the top-level entry point called from element-mapper.ts
 * when the diagram type is "stateDiagram-v2".
 *
 * @param geometries - Positioned elements from extractGeometry()
 * @param parsed     - Accordo's ParsedDiagram (must be stateDiagram-v2)
 * @returns Complete MappingResult with all state types matched
 */
export function mapStateGeometryToLayout(
  geometries: readonly UpstreamGeometry[],
  parsed: ParsedDiagram,
): {
  nodes: Record<string, NodeLayout>;
  clusters: Record<string, ClusterLayout>;
  unmatchedNodeIds: string[];
  warnings: string[];
} {
  layoutDebug({
    category: "upstream-parse",
    message: "mapStateGeometryToLayout: received geometries for stateDiagram-v2",
    data: {
      totalGeometries: geometries.length,
      geometries: geometries.map((g) => ({
        label: g.label,
        type: g.type,
        x: g.x,
        y: g.y,
        w: g.width,
        h: g.height,
        groupId: g.groupId,
      })),
    },
  });

  // ── Separate pseudostates from regular geometries ──────────────────────────
  const pseudoMatches = matchStatePseudostates(geometries, parsed);
  const pseudoGeoIndices = new Set(pseudoMatches.keys());

  const regularIndices: number[] = [];
  for (let i = 0; i < geometries.length; i++) {
    if (!pseudoGeoIndices.has(i)) {
      regularIndices.push(i);
    }
  }

  // ── Match regular geometries by label ─────────────────────────────────────
  const labelToNodeIds = buildLabelIndex(parsed);
  const labelCursor: Record<string, number> = {};

  // Sort regular geometry indices by (y, x) for stable matching
  regularIndices.sort((aIdx, bIdx) => {
    const a = geometries[aIdx]!;
    const b = geometries[bIdx]!;
    if (a.y !== b.y) return a.y - b.y;
    return a.x - b.x;
  });

  const nodes: Record<string, NodeLayout> = {};
  const matchedNodeIds = new Set<string>();
  const warnings: string[] = [];

  for (const idx of regularIndices) {
    const geo = geometries[idx]!;
    if (geo.label === "") {
      continue;
    }
    const nodeIds = labelToNodeIds.get(geo.label);
    if (!nodeIds || nodeIds.length === 0) {
      warnings.push(`Unknown geometry label "${geo.label}" — no matching node in diagram`);
      continue;
    }

    const cursor = labelCursor[geo.label] ?? 0;
    if (cursor >= nodeIds.length) {
      warnings.push(`Extra geometry for label "${geo.label}" — no remaining node to match`);
      continue;
    }

    const nodeId = nodeIds[cursor]!;
    labelCursor[geo.label] = cursor + 1;

    nodes[nodeId] = {
      x: geo.x,
      y: geo.y,
      w: geo.width,
      h: geo.height,
      style: {},
    };
    matchedNodeIds.add(nodeId);

    layoutDebug({
      category: "identity-match",
      message: `matched regular geometry "${geo.label}" → nodeId="${nodeId}" (${geo.x}, ${geo.y})`,
    });
  }

  // ── Handle pseudostate matches ─────────────────────────────────────────────
  for (const [geoIndex, nodeId] of pseudoMatches) {
    const geo = geometries[geoIndex]!;
    nodes[nodeId] = {
      x: geo.x,
      y: geo.y,
      w: geo.width,
      h: geo.height,
      style: {},
    };
    matchedNodeIds.add(nodeId);

    layoutDebug({
      category: "identity-match",
      message: `matched pseudostate geometry[${geoIndex}] → nodeId="${nodeId}" (${geo.x}, ${geo.y})`,
    });
  }

  // ── Match composite state clusters (SUP-S03) ───────────────────────────────
  const clusterByLabel = buildClusterLabelIndex(parsed);

  const clusters: Record<string, ClusterLayout> = {};

  for (const geo of geometries) {
    if (!geo.label) continue;

    const clusterId = clusterByLabel.get(geo.label);
    if (!clusterId) continue;

    const parsedCluster = parsed.clusters.find((c) => c.id === clusterId);
    const parentId = parsedCluster?.parent;

    clusters[clusterId] = buildClusterLayout(geo, geo.label, parentId);

    layoutDebug({
      category: "identity-match",
      message: `matched composite cluster "${geo.label}" → clusterId="${clusterId}" parent=${parentId ?? "none"}`,
      data: { x: geo.x, y: geo.y, w: geo.width, h: geo.height, groupId: geo.groupId },
    });
  }

  // ── Collect unmatched nodes ─────────────────────────────────────────────────
  const unmatchedNodeIds: string[] = [];
  for (const nodeId of parsed.nodes.keys()) {
    if (!matchedNodeIds.has(nodeId)) {
      unmatchedNodeIds.push(nodeId);
    }
  }

  layoutDebug({
    category: "fallback",
    message: `mapStateGeometryToLayout: ${unmatchedNodeIds.length} unmatched nodes → dagre fallback`,
    data: { unmatchedNodeIds },
  });

  return { nodes, clusters, unmatchedNodeIds, warnings };
}

// ── Internal helpers ───────────────────────────────────────────────────────────

function buildLabelIndex(parsed: ParsedDiagram): Map<string, readonly string[]> {
  const map = new Map<string, string[]>();
  for (const [nodeId, node] of parsed.nodes) {
    if (node.label === "") {
      continue;
    }
    const existing = map.get(node.label);
    if (existing) {
      existing.push(nodeId);
    } else {
      map.set(node.label, [nodeId]);
    }
  }
  return map;
}

function buildClusterLabelIndex(parsed: ParsedDiagram): Map<string, string> {
  const map = new Map<string, string>();
  for (const cluster of parsed.clusters) {
    map.set(cluster.label, cluster.id);
  }
  return map;
}
