/**
 * M101-DIFF — Diff Engine
 *
 * Pure comparison logic for computing structural differences between two
 * `VersionedSnapshot` trees. Operates entirely on in-memory data — no DOM
 * access, no Chrome APIs, no side effects.
 *
 * The diff algorithm matches nodes across snapshots using `persistentId`
 * (deterministic hash of `tag:id:text`) as the primary key and `nodeId`
 * as a positional fallback. It produces three arrays — `added`, `removed`,
 * `changed` — plus a human-readable `summary`.
 *
 * Implements B2-DE-002, B2-DE-005.
 *
 * @module
 */

import type { NodeIdentity, VersionedSnapshot, SnapshotEnvelope } from "./snapshot-versioning.js";

// ── Public Types ─────────────────────────────────────────────────────────────

/**
 * A node that was added or removed between two snapshots.
 *
 * Matches the `DiffNode` contract in `docs/browser2.0-architecture.md` §5.2.
 */
export interface DiffNode {
  /** Node ID from the snapshot where this node appears. */
  nodeId: number;
  /** HTML tag name (lowercase). */
  tag: string;
  /** Element id attribute, if any. */
  id?: string;
  /** Visible text content, if any. */
  text?: string;
  /** ARIA role or equivalent, if any. */
  role?: string;
}

/**
 * A single field-level change detected on a matched node.
 *
 * Matches the `DiffChange` contract in `docs/browser2.0-architecture.md` §5.2.
 */
export interface DiffChange {
  /** Node ID in the `to` snapshot. */
  nodeId: number;
  /** HTML tag name (lowercase). */
  tag: string;
  /** Which aspect of the node changed. */
  field: "textContent" | `attribute:${string}` | "role";
  /** Value in the `from` snapshot. */
  before: string;
  /** Value in the `to` snapshot. */
  after: string;
}

/**
 * Human-readable summary statistics for a diff result.
 *
 * B2-DE-005: `addedCount`, `removedCount`, `changedCount` MUST match array
 * lengths. `textDelta` is a human-readable string summarising the changes.
 */
export interface DiffSummary {
  addedCount: number;
  removedCount: number;
  changedCount: number;
  /** Human-readable summary, e.g. "3 added, 1 removed, 2 changed". */
  textDelta: string;
}

/**
 * Complete diff result returned by `computeDiff()`.
 *
 * Extends `SnapshotEnvelope` with the envelope from the `to` snapshot,
 * matching the `DiffResult` contract in `docs/browser2.0-architecture.md` §5.2.
 */
export interface DiffResult extends SnapshotEnvelope {
  /** Snapshot ID of the `from` snapshot. */
  fromSnapshotId: string;
  /** Snapshot ID of the `to` snapshot. */
  toSnapshotId: string;
  /** Nodes present in `to` but not in `from`. */
  added: DiffNode[];
  /** Nodes present in `from` but not in `to`. */
  removed: DiffNode[];
  /** Nodes present in both but with changed text, attributes, or role. */
  changed: DiffChange[];
  /** Summary statistics (B2-DE-005). */
  summary: DiffSummary;
}

/**
 * Error result returned when diff cannot be computed.
 *
 * B2-DE-006: `"snapshot-not-found"` when a requested snapshot does not exist.
 * B2-DE-007: `"snapshot-stale"` when a snapshot is from a previous navigation.
 */
export interface DiffError {
  success: false;
  error: "snapshot-not-found" | "snapshot-stale";
}

// ── Flattening Helper Type ───────────────────────────────────────────────────

/**
 * A flattened node extracted from the recursive `NodeIdentity` tree.
 * Used internally for building the match index.
 */
export interface FlatNode {
  nodeId: number;
  persistentId: string;
  tag: string;
  text: string | undefined;
  role: string | undefined;
  id: string | undefined;
}

// ── Core Diff Function ───────────────────────────────────────────────────────

/**
 * Compute the structural diff between two versioned snapshots.
 *
 * **Algorithm:**
 * 1. Flatten both snapshot trees into arrays of `FlatNode` (DFS order).
 * 2. Build a `Map<persistentId, FlatNode>` for each snapshot.
 * 3. Added = nodes in `to` whose `persistentId` is not in `from`.
 * 4. Removed = nodes in `from` whose `persistentId` is not in `to`.
 * 5. Changed = nodes in both where `text`, `id`, or `role` differ.
 * 6. Produce a summary with counts and a human-readable `textDelta`.
 *
 * B2-DE-002: Returns `added`, `removed`, `changed` arrays.
 * B2-DE-005: Returns `summary` with counts matching array lengths.
 *
 * @param from — The earlier snapshot (baseline)
 * @param to — The later snapshot (current state)
 * @returns A complete `DiffResult` with envelope from the `to` snapshot
 */
export function computeDiff(from: VersionedSnapshot, to: VersionedSnapshot): DiffResult {
  const fromFlat = flattenNodes(from.nodes);
  const toFlat = flattenNodes(to.nodes);

  const fromIndex = buildNodeIndex(fromFlat);
  const toIndex = buildNodeIndex(toFlat);

  // Added: in `to` but not in `from`
  const added: DiffNode[] = [];
  for (const [pid, node] of toIndex) {
    if (!fromIndex.has(pid)) {
      added.push({ nodeId: node.nodeId, tag: node.tag, id: node.id, text: node.text, role: node.role });
    }
  }

  // Removed: in `from` but not in `to`
  const removed: DiffNode[] = [];
  for (const [pid, node] of fromIndex) {
    if (!toIndex.has(pid)) {
      removed.push({ nodeId: node.nodeId, tag: node.tag, id: node.id, text: node.text, role: node.role });
    }
  }

  // Changed: in both, but with differing text or role
  const changed: DiffChange[] = [];
  for (const [pid, fromNode] of fromIndex) {
    const toNode = toIndex.get(pid);
    if (toNode === undefined) continue;

    // Check textContent change
    if ((fromNode.text ?? "") !== (toNode.text ?? "")) {
      changed.push({
        nodeId: toNode.nodeId,
        tag: toNode.tag,
        field: "textContent",
        before: fromNode.text ?? "",
        after: toNode.text ?? "",
      });
    }

    // Check role change
    if (
      fromNode.role !== undefined &&
      toNode.role !== undefined &&
      fromNode.role !== toNode.role
    ) {
      changed.push({
        nodeId: toNode.nodeId,
        tag: toNode.tag,
        field: "role",
        before: fromNode.role,
        after: toNode.role,
      });
    } else if (fromNode.role !== toNode.role) {
      // One side is undefined and the other isn't
      if (fromNode.role !== undefined || toNode.role !== undefined) {
        changed.push({
          nodeId: toNode.nodeId,
          tag: toNode.tag,
          field: "role",
          before: fromNode.role ?? "",
          after: toNode.role ?? "",
        });
      }
    }
  }

  // Build summary (B2-DE-005)
  const textDelta = formatTextDelta(added.length, removed.length, changed.length);
  const summary: DiffSummary = {
    addedCount: added.length,
    removedCount: removed.length,
    changedCount: changed.length,
    textDelta,
  };

  // Return DiffResult extending the `to` snapshot's SnapshotEnvelope
  return {
    // SnapshotEnvelope fields from `to`
    pageId: to.pageId,
    frameId: to.frameId,
    snapshotId: to.snapshotId,
    capturedAt: to.capturedAt,
    viewport: to.viewport,
    source: to.source,
    // Diff-specific fields
    fromSnapshotId: from.snapshotId,
    toSnapshotId: to.snapshotId,
    added,
    removed,
    changed,
    summary,
  };
}

// ── Internal Helpers ─────────────────────────────────────────────────────────

/**
 * Flatten a recursive `NodeIdentity` tree into an array of `FlatNode` records
 * suitable for index construction. Performs a depth-first traversal.
 *
 * @param nodes — Root-level nodes from a `VersionedSnapshot`
 * @returns Flat array of all nodes with their identity fields
 */
export function flattenNodes(nodes: readonly NodeIdentity[]): FlatNode[] {
  const result: FlatNode[] = [];

  function visit(node: NodeIdentity): void {
    result.push({
      nodeId: node.nodeId,
      // Use the pre-computed persistentId if present; fall back to a raw key
      persistentId: node.persistentId ?? `${node.tag}:${node.id ?? ""}:${node.text ?? ""}`,
      tag: node.tag,
      text: node.text,
      role: node.role,
      id: node.id,
    });
    for (const child of node.children ?? []) {
      visit(child);
    }
  }

  for (const node of nodes) {
    visit(node);
  }

  return result;
}

/**
 * Build a lookup index from `persistentId` → `FlatNode`.
 *
 * When multiple nodes share the same `persistentId` (e.g., repeated list items),
 * the first occurrence wins. This is a known limitation; future iterations
 * may use positional disambiguation.
 *
 * @param flatNodes — Output of `flattenNodes()`
 * @returns Map keyed by `persistentId`
 */
export function buildNodeIndex(flatNodes: readonly FlatNode[]): Map<string, FlatNode> {
  const index = new Map<string, FlatNode>();
  for (const node of flatNodes) {
    if (!index.has(node.persistentId)) {
      index.set(node.persistentId, node);
    }
  }
  return index;
}

/**
 * Generate a human-readable `textDelta` string from diff counts.
 *
 * Examples:
 * - "3 added, 1 removed, 2 changed"
 * - "no changes"
 *
 * @param added — Number of added nodes
 * @param removed — Number of removed nodes
 * @param changed — Number of changed nodes
 * @returns Human-readable summary string
 */
export function formatTextDelta(added: number, removed: number, changed: number): string {
  if (added === 0 && removed === 0 && changed === 0) {
    return "no changes";
  }
  const parts: string[] = [];
  if (added > 0) parts.push(`${added} added`);
  if (removed > 0) parts.push(`${removed} removed`);
  if (changed > 0) parts.push(`${changed} changed`);
  return parts.join(", ");
}
