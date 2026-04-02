/**
 * A7 — Reconciliation engine
 *
 * Core reconciliation pass: given old and new Mermaid source strings and the
 * current layout store, produces an updated layout store and a change summary.
 *
 * Delegates to:
 *   matchEdges()    (A5) — edge identity matching and routing data migration
 *   addUnplaced()   (A3) — append newly-added nodes to the unplaced list
 *   parseMermaid()  (A2) — parse both sources; validate newSource
 *
 * Pure function: no disk I/O, no side effects.  Callers are responsible for
 * writing the updated layout.json and the mermaidCleaned source back to disk.
 *
 * Source: diag_arch_v4.2.md §7.1, diag_workplan.md §5 A7
 */

import type { LayoutStore, ReconcileResult, NodeId, EdgeLayout } from "../types.js";
import { parseMermaid } from "../parser/adapter.js";
import { matchEdges } from "./edge-identity.js";
import { addUnplaced } from "../layout/layout-store.js";

/**
 * Thrown when the new Mermaid source fails parsing.
 * The reconciler never mutates the current layout when this is thrown.
 */
export class InvalidMermaidError extends Error {
  constructor(
    /** Line number reported by the Mermaid parser.  0 = unknown. */
    public readonly line: number,
    message: string,
  ) {
    super(message);
    this.name = "InvalidMermaidError";
  }
}

/** Strip `%% @rename: old -> new` directive lines from Mermaid source. */
function stripRenameDirectives(source: string): string {
  return source
    .split("\n")
    .filter((line) => !/^%%\s*@rename:/.test(line))
    .join("\n");
}

/**
 * Reconcile old and new Mermaid source against the current layout store.
 *
 * Behaviour summary (arch §7.1):
 *   1. Parse newSource — throw InvalidMermaidError if invalid.
 *   2. Parse oldSource — treat as empty diagram if invalid/unrecognised.
 *   3. Process @rename annotations: migrate layout keys, strip from source.
 *   4. Diff node IDs: removed nodes deleted; added nodes → unplaced[].
 *   5. Diff edge keys via matchEdges(): preserved routing migrated;
 *      new edges get routing "auto"; removed edges deleted.
 *   6. Diff cluster sets: clustersChanged count updated.
 *
 * @param oldSource     Previous known-good Mermaid source.
 * @param newSource     Incoming Mermaid source to validate and reconcile.
 * @param currentLayout Current layout.json contents (not mutated).
 * @returns ReconcileResult with updated layout and change summary.
 * @throws InvalidMermaidError if newSource fails Mermaid parsing.
 */
export async function reconcile(
  oldSource: string,
  newSource: string,
  currentLayout: LayoutStore,
): Promise<ReconcileResult> {
  // ── Parse new source (must succeed) ──────────────────────────────────────────
  const newResult = await parseMermaid(newSource);
  if (!newResult.valid) {
    throw new InvalidMermaidError(newResult.error.line, newResult.error.message);
  }
  const newDiagram = newResult.diagram;

  // ── Parse old source (failure → treat as empty baseline) ────────────────────────────────
  const oldResult = await parseMermaid(oldSource);
  const oldDiagram = oldResult.valid
    ? oldResult.diagram
    : {
        nodes: new Map() as typeof newDiagram.nodes,
        edges: [] as typeof newDiagram.edges,
        clusters: [] as typeof newDiagram.clusters,
        renames: [] as typeof newDiagram.renames,
        type: newDiagram.type,
      };

  // ── Work on a shallow copy (never mutate the caller's object) ────────────────
  let layout: LayoutStore = {
    ...currentLayout,
    nodes: { ...currentLayout.nodes },
    edges: { ...currentLayout.edges },
    clusters: { ...currentLayout.clusters },
    unplaced: [...currentLayout.unplaced],
  };

  // ── Process @rename annotations ──────────────────────────────────────────────
  const renames = newDiagram.renames ?? [];
  const renamesApplied: string[] = [];
  let mermaidCleaned: string | undefined;

  // Build lookup map before the rename loop so it can be used for edge key migration.
  const renameMap = new Map<string, string>();
  for (const { oldId, newId } of renames) {
    renameMap.set(oldId, newId);
  }

  if (renames.length > 0) {
    for (const { oldId, newId } of renames) {
      if (layout.nodes[oldId] !== undefined) {
        const { [oldId]: movedEntry, ...remainingNodes } = layout.nodes;
        layout = { ...layout, nodes: { ...remainingNodes, [newId]: movedEntry! } };
        renamesApplied.push(`${oldId} -> ${newId}`);
      }
    }
    mermaidCleaned = stripRenameDirectives(newSource);

    // Migrate edge keys when nodes are renamed (§7.2).
    const updatedEdges: Record<string, EdgeLayout> = {};
    for (const [edgeKey, edgeLayout] of Object.entries(layout.edges)) {
      const arrowIdx = edgeKey.indexOf("->");
      const colonIdx = edgeKey.lastIndexOf(":");
      if (arrowIdx === -1 || colonIdx === -1) {
        // Malformed key — pass through unchanged
        updatedEdges[edgeKey] = edgeLayout;
        continue;
      }
      const from = edgeKey.slice(0, arrowIdx);
      const to   = edgeKey.slice(arrowIdx + 2, colonIdx);
      const ord  = edgeKey.slice(colonIdx + 1);
      const newFrom = renameMap.has(from) ? renameMap.get(from)! : from;
      const newTo   = renameMap.has(to)   ? renameMap.get(to)! : to;
      const newKey  = `${newFrom}->${newTo}:${ord}`;
      updatedEdges[newKey] = edgeLayout;
    }
    layout = { ...layout, edges: updatedEdges };
  }

  // ── Apply renames to oldParsed edges before matchEdges ──────────────────────
  // matchEdges groups edges by (from, to) pair key.  When a node is renamed
  // A → A2 the old diagram has pair "A>B" and the new diagram has "A2>B" —
  // they never match, so the edge lands in 'added' and routing is reset to
  // "auto".  Fix: produce a renamed copy of oldDiagram.edges so matchEdges
  // sees matching pair keys.  The early edge-key migration above already
  // updated layout.edges, so the 'preserved' lookup in oldKey space works.
  const oldEdgesForMatch: typeof oldDiagram.edges =
    renameMap.size > 0
      ? oldDiagram.edges.map((e) => ({
          ...e,
          from: renameMap.get(e.from) ?? e.from,
          to:   renameMap.get(e.to)   ?? e.to,
        }))
      : oldDiagram.edges;

  // ── Node diff ────────────────────────────────────────────────────────────────
  const oldNodeIds = new Set<string>(oldDiagram.nodes.keys());
  const newNodeIds = new Set<string>(newDiagram.nodes.keys());

  const nodesAdded: NodeId[] = [];
  const nodesRemoved: NodeId[] = [];

  for (const id of newNodeIds) {
    if (!oldNodeIds.has(id) && layout.nodes[id] === undefined) {
      nodesAdded.push(id);
    }
  }

  for (const id of oldNodeIds) {
    if (!newNodeIds.has(id)) {
      nodesRemoved.push(id);
      const { [id]: _dropped, ...remaining } = layout.nodes;
      layout = { ...layout, nodes: remaining };
    }
  }

  if (nodesAdded.length > 0) {
    layout = addUnplaced(layout, nodesAdded);
  }

  // ── Edge reconciliation via A5 matchEdges ────────────────────────────────────
  const { preserved, added: edgesAddedKeys, removed: edgesRemovedKeys } =
    matchEdges(oldEdgesForMatch, newDiagram.edges, layout.edges);

  const newEdges: LayoutStore["edges"] = {};

  for (const [newKey, { oldKey }] of preserved) {
    newEdges[newKey] = layout.edges[oldKey] ?? { routing: "auto", waypoints: [], style: {} };
  }
  for (const key of edgesAddedKeys) {
    newEdges[key] = { routing: "auto", waypoints: [], style: {} };
  }

  layout = { ...layout, edges: newEdges };

  // ── Cluster diff ─────────────────────────────────────────────────────────────
  const oldClusterIds = new Set(oldDiagram.clusters.map((c) => c.id));
  const newClusterIds = new Set(newDiagram.clusters.map((c) => c.id));

  let clustersChanged = 0;
  for (const id of newClusterIds) {
    if (!oldClusterIds.has(id)) clustersChanged++;
  }
  for (const id of oldClusterIds) {
    if (!newClusterIds.has(id)) {
      clustersChanged++;
      const { [id]: _dropped, ...remainingClusters } = layout.clusters;
      layout = { ...layout, clusters: remainingClusters };
    }
  }

  return {
    layout,
    ...(mermaidCleaned !== undefined ? { mermaidCleaned } : {}),
    changes: {
      nodesAdded,
      nodesRemoved,
      edgesAdded: edgesAddedKeys.length,
      edgesRemoved: edgesRemovedKeys.length,
      clustersChanged,
      renamesApplied,
    },
    diagram: newDiagram,
  };
}
