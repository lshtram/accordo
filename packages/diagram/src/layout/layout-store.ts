/**
 * A3 — Layout store: read, write, and patch *.layout.json files.
 *
 * I/O: readLayout / writeLayout handle disk access.
 * Mutations: all other functions are pure — they take a LayoutStore and return
 * a new one. Callers decide when to persist via writeLayout.
 *
 * Source: diag_arch_v4.2.md §5, diag_workplan.md §4.3
 */

import { readFile, writeFile } from "node:fs/promises";

import type {
  LayoutStore,
  SpatialDiagramType,
  NodeLayout,
  EdgeLayout,
  ClusterLayout,
} from "../types.js";

const SPATIAL_TYPES = new Set<string>([
  "flowchart",
  "block-beta",
  "classDiagram",
  "stateDiagram-v2",
  "erDiagram",
  "mindmap",
]);

/**
 * Derive the layout.json path from the corresponding .mmd path.
 * e.g. "diagrams/arch.mmd" → "diagrams/arch.layout.json"
 */
export function layoutPathFor(mmdPath: string): string {
  return mmdPath.replace(/\.mmd$/, ".layout.json");
}

/**
 * Read and parse a *.layout.json file from disk.
 * Returns null if the file does not exist, is corrupt, or has an
 * unrecognised version or diagram_type. Never throws on expected
 * filesystem conditions.
 */
export async function readLayout(filePath: string): Promise<LayoutStore | null> {
  try {
    const raw = await readFile(filePath, "utf-8");
    const candidate = JSON.parse(raw) as unknown;
    if (typeof candidate !== "object" || candidate === null) return null;
    const parsed = candidate as LayoutStore;
    if (parsed.version !== "1.0") return null;
    if (!SPATIAL_TYPES.has(parsed.diagram_type)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Serialise and write a LayoutStore to disk as JSON.
 */
export async function writeLayout(
  filePath: string,
  layout: LayoutStore
): Promise<void> {
  await writeFile(filePath, JSON.stringify(layout, null, 2), "utf-8");
}

/**
 * Return a valid empty LayoutStore for a new diagram.
 * Defaults: roughness=1 (hand-drawn), animationMode="draw-on".
 */
export function createEmptyLayout(diagramType: SpatialDiagramType): LayoutStore {
  return {
    version: "1.0",
    diagram_type: diagramType,
    nodes: {},
    edges: {},
    clusters: {},
    unplaced: [],
    aesthetics: { roughness: 1, animationMode: "draw-on", theme: "hand-drawn" },
  };
}

// ── Pure mutators ─────────────────────────────────────────────────────────────
// All return a new LayoutStore; the original is never modified.

/**
 * Merge patch fields into the named node's layout entry.
 */
export function patchNode(
  layout: LayoutStore,
  nodeId: string,
  patch: Partial<NodeLayout>
): LayoutStore {
  return { ...layout, nodes: { ...layout.nodes, [nodeId]: { ...layout.nodes[nodeId], ...patch } } };
}

/**
 * Merge patch fields into the named edge's layout entry.
 */
export function patchEdge(
  layout: LayoutStore,
  edgeKey: string,
  patch: Partial<EdgeLayout>
): LayoutStore {
  return { ...layout, edges: { ...layout.edges, [edgeKey]: { ...layout.edges[edgeKey], ...patch } } };
}

/**
 * Merge patch fields into the named cluster's layout entry.
 */
export function patchCluster(
  layout: LayoutStore,
  clusterId: string,
  patch: Partial<ClusterLayout>
): LayoutStore {
  return { ...layout, clusters: { ...layout.clusters, [clusterId]: { ...layout.clusters[clusterId], ...patch } } };
}

/**
 * Remove a node from the nodes map.
 * Does not cascade-remove incident edges — that is the reconciler's responsibility.
 */
export function removeNode(layout: LayoutStore, nodeId: string): LayoutStore {
  const { [nodeId]: _removed, ...rest } = layout.nodes;
  return { ...layout, nodes: rest };
}

/**
 * Remove an edge from the edges map.
 */
export function removeEdge(layout: LayoutStore, edgeKey: string): LayoutStore {
  const { [edgeKey]: _removed, ...rest } = layout.edges;
  return { ...layout, edges: rest };
}

/**
 * Add node IDs to the unplaced list, deduplicating against existing entries
 * and against duplicates within the new batch itself.
 */
export function addUnplaced(layout: LayoutStore, nodeIds: string[]): LayoutStore {
  const seen = new Set(layout.unplaced);
  const toAdd: string[] = [];
  for (const id of nodeIds) {
    if (!seen.has(id)) {
      seen.add(id);
      toAdd.push(id);
    }
  }
  return { ...layout, unplaced: [...layout.unplaced, ...toAdd] };
}
