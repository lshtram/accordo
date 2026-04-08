/**
 * A3 — Layout store: read, write, and patch *.layout.json files.
 *
 * I/O: readLayout / writeLayout handle disk access.
 * Mutations: all other functions are pure — they take a LayoutStore and return
 * a new one. Callers decide when to persist via writeLayout.
 *
 * Source: diag_arch_v4.2.md §5, diag_workplan.md §4.3
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join, basename, relative } from "node:path";

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
 * Auxiliary files are stored under `<workspaceRoot>/.accordo/diagrams/` with
 * the source file's workspace-relative path preserved as a subdirectory tree.
 *
 * e.g. workspaceRoot=/ws, mmdPath=/ws/design/arch.mmd
 *   → /ws/.accordo/diagrams/design/arch.layout.json
 */
export function layoutPathFor(mmdPath: string, workspaceRoot: string): string {
  if (!workspaceRoot) {
    throw new Error(
      `layoutPathFor: workspaceRoot must not be empty (mmdPath: ${mmdPath})`,
    );
  }
  const rel = relative(workspaceRoot, mmdPath).replace(/\.mmd$/, ".layout.json");
  // Normalize to forward slashes so paths are consistent across all platforms.
  // Node.js on Windows accepts both separators for file I/O.
  return join(workspaceRoot, ".accordo", "diagrams", rel).replace(/\\/g, "/");
}

// ── Structural validators (H0-04) ─────────────────────────────────────────────

function isPlainObject(val: unknown): val is Record<string, unknown> {
  return typeof val === "object" && val !== null && !Array.isArray(val);
}

function isValidNodeEntry(val: unknown): val is NodeLayout {
  if (!isPlainObject(val)) return false;
  const entry = val as Record<string, unknown>;
  if (typeof entry.x !== "number" || !Number.isFinite(entry.x)) return false;
  if (typeof entry.y !== "number" || !Number.isFinite(entry.y)) return false;
  if (typeof entry.w !== "number" || !Number.isFinite(entry.w)) return false;
  if (typeof entry.h !== "number" || !Number.isFinite(entry.h)) return false;
  if (!isPlainObject(entry.style)) return false;
  return true;
}

function isValidEdgeEntry(val: unknown): val is EdgeLayout {
  if (!isPlainObject(val)) return false;
  const entry = val as Record<string, unknown>;
  if (typeof entry.routing !== "string") return false;
  if (!Array.isArray(entry.waypoints)) return false;
  for (const wp of entry.waypoints) {
    if (!isPlainObject(wp)) return false;
    const waypoint = wp as Record<string, unknown>;
    if (typeof waypoint.x !== "number" || !Number.isFinite(waypoint.x)) return false;
    if (typeof waypoint.y !== "number" || !Number.isFinite(waypoint.y)) return false;
  }
  if (!isPlainObject(entry.style)) return false;
  return true;
}

function isValidClusterEntry(val: unknown): val is ClusterLayout {
  if (!isPlainObject(val)) return false;
  const entry = val as Record<string, unknown>;
  if (typeof entry.x !== "number" || !Number.isFinite(entry.x)) return false;
  if (typeof entry.y !== "number" || !Number.isFinite(entry.y)) return false;
  if (typeof entry.w !== "number" || !Number.isFinite(entry.w)) return false;
  if (typeof entry.h !== "number" || !Number.isFinite(entry.h)) return false;
  if (typeof entry.label !== "string") return false;
  if (!isPlainObject(entry.style)) return false;
  return true;
}

function isValidUnplaced(val: unknown): val is string[] {
  if (!Array.isArray(val)) return false;
  for (const item of val) {
    if (typeof item !== "string") return false;
  }
  return true;
}

/**
 * Read and parse a *.layout.json file from disk.
 * Returns null if the file does not exist, is corrupt, has an
 * unrecognised version or diagram_type, or fails structural validation.
 * Never throws on expected filesystem conditions.
 */
export async function readLayout(filePath: string): Promise<LayoutStore | null> {
  try {
    const raw = await readFile(filePath, "utf-8");
    const candidate = JSON.parse(raw) as unknown;
    if (typeof candidate !== "object" || candidate === null) return null;
    const parsed = candidate as LayoutStore;
    if (parsed.version !== "1.0") return null;
    if (!SPATIAL_TYPES.has(parsed.diagram_type)) return null;

    // H0-04a: validate nodes
    if (!isPlainObject(parsed.nodes)) return null;
    for (const entry of Object.values(parsed.nodes)) {
      if (!isValidNodeEntry(entry)) return null;
    }

    // H0-04b: validate edges
    if (!isPlainObject(parsed.edges)) return null;
    for (const entry of Object.values(parsed.edges)) {
      if (!isValidEdgeEntry(entry)) return null;
    }

    // H0-04c: validate clusters
    if (!isPlainObject(parsed.clusters)) return null;
    for (const entry of Object.values(parsed.clusters)) {
      if (!isValidClusterEntry(entry)) return null;
    }

    // H0-04d: validate unplaced
    if (!isValidUnplaced(parsed.unplaced)) return null;

    // H0-04e: validate aesthetics
    if (!isPlainObject(parsed.aesthetics)) return null;

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
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(layout, null, 2), "utf-8");
}

/**
 * Return a valid empty LayoutStore for a new diagram.
 * Defaults: roughness=1 (hand-drawn), animationMode="static".
 * Draw-on animation is a diag.2 feature; diag.1 renders the full scene at once.
 */
export function createEmptyLayout(diagramType: SpatialDiagramType): LayoutStore {
  return {
    version: "1.0",
    diagram_type: diagramType,
    nodes: {},
    edges: {},
    clusters: {},
    unplaced: [],
    aesthetics: { roughness: 1, animationMode: "static", theme: "hand-drawn" },
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
