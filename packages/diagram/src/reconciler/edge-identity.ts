/**
 * A5 — Edge identity matching
 *
 * Implements the edge reconciliation algorithm from diag_arch_v4.2.md §4.4.
 * Given a before/after snapshot of parsed edges, classifies each current edge
 * as preserved, added, or removed, and computes the new EdgeKey for migrating
 * routing data when an edge ordinal shifts.
 *
 * Source: diag_arch_v4.2.md §4.4, diag_workplan.md §5 A5
 */

import type { ParsedEdge, EdgeLayout } from "../types.js";

/**
 * Classify edges between two parsed snapshots.
 *
 * Matching priority (arch §4.4):
 *   1. Match by (from, to, label) — labeled edges survive reorder.
 *      For duplicate (from, to, label) groups: tie-break by ordinal within
 *      the matched group (declaration order), deterministically.
 *   2. Match by (from, to, ordinal) — fallback for unlabeled edges in stable order.
 *   3. Unmatched new edges → added[]; unmatched old edges → removed[].
 *
 * @param oldEdges   Edge array from the previous parsed diagram.
 * @param newEdges   Edge array from the newly parsed diagram.
 * @param oldLayout  Current layout.json edges section (keyed by EdgeKey).
 *                   Entries whose key is not present in oldEdges are ignored.
 * @returns
 *   preserved — Map keyed by newKey; value contains both oldKey and newKey so
 *               the caller can copy routing data.
 *   added     — New EdgeKeys with no routing data match; caller assigns "auto".
 *   removed   — Old EdgeKeys with no new counterpart; caller deletes from layout.
 */
export function matchEdges(
  oldEdges: readonly ParsedEdge[],
  newEdges: readonly ParsedEdge[],
  _oldLayout: Record<string, EdgeLayout>
): {
  preserved: Map<string, { oldKey: string; newKey: string }>;
  added: string[];
  removed: string[];
} {
  const preserved = new Map<string, { oldKey: string; newKey: string }>();
  const added: string[] = [];
  const removed: string[] = [];

  // ── Group edges by (from, to) pair ──────────────────────────────────────────
  function pairKey(e: ParsedEdge): string {
    return `${e.from}>${e.to}`;
  }
  function edgeKey(e: ParsedEdge): string {
    return `${e.from}->${e.to}:${e.ordinal}`;
  }

  const oldByPair = new Map<string, ParsedEdge[]>();
  for (const e of oldEdges) {
    const k = pairKey(e);
    const g = oldByPair.get(k) ?? [];
    g.push(e);
    oldByPair.set(k, g);
  }

  const newByPair = new Map<string, ParsedEdge[]>();
  for (const e of newEdges) {
    const k = pairKey(e);
    const g = newByPair.get(k) ?? [];
    g.push(e);
    newByPair.set(k, g);
  }

  // ── Process each (from, to) pair ─────────────────────────────────────────────
  const allPairs = new Set([...oldByPair.keys(), ...newByPair.keys()]);

  for (const pair of allPairs) {
    const oldGroup = oldByPair.get(pair) ?? [];
    const newGroup = newByPair.get(pair) ?? [];

    const oldGroupMatched = new Set<number>(); // indices within oldGroup
    const newGroupMatched = new Set<number>(); // indices within newGroup

    // ── Step 1: Match by label (non-empty) within this pair ───────────────────
    // For duplicate (from,to,label) groups: tie-break by position within the
    // label group (declaration order) — this is deterministic.
    const oldByLabel = new Map<string, number[]>();
    for (let i = 0; i < oldGroup.length; i++) {
      const lbl = oldGroup[i]!.label;
      if (lbl === "") continue;
      const g = oldByLabel.get(lbl) ?? [];
      g.push(i);
      oldByLabel.set(lbl, g);
    }
    const newByLabel = new Map<string, number[]>();
    for (let i = 0; i < newGroup.length; i++) {
      const lbl = newGroup[i]!.label;
      if (lbl === "") continue;
      const g = newByLabel.get(lbl) ?? [];
      g.push(i);
      newByLabel.set(lbl, g);
    }

    for (const [lbl, oldLblIndices] of oldByLabel) {
      const newLblIndices = newByLabel.get(lbl);
      if (!newLblIndices) continue;
      const limit = Math.min(oldLblIndices.length, newLblIndices.length);
      for (let j = 0; j < limit; j++) {
        const oi = oldLblIndices[j]!;
        const ni = newLblIndices[j]!;
        const oldK = edgeKey(oldGroup[oi]!);
        const newK = edgeKey(newGroup[ni]!);
        preserved.set(newK, { oldKey: oldK, newKey: newK });
        oldGroupMatched.add(oi);
        newGroupMatched.add(ni);
      }
    }

    // ── Step 2: Match remaining UNLABELED edges by position in group ──────────
    // Labeled edges that did not match in step 1 go directly to remove/add.
    // Only unlabeled edges participate in ordinal-position fallback.
    const oldUnlabeled: number[] = [];
    for (let i = 0; i < oldGroup.length; i++) {
      if (!oldGroupMatched.has(i) && oldGroup[i]!.label === "") {
        oldUnlabeled.push(i);
      }
    }
    const newUnlabeled: number[] = [];
    for (let i = 0; i < newGroup.length; i++) {
      if (!newGroupMatched.has(i) && newGroup[i]!.label === "") {
        newUnlabeled.push(i);
      }
    }
    const ulLimit = Math.min(oldUnlabeled.length, newUnlabeled.length);
    for (let j = 0; j < ulLimit; j++) {
      const oi = oldUnlabeled[j]!;
      const ni = newUnlabeled[j]!;
      const oldK = edgeKey(oldGroup[oi]!);
      const newK = edgeKey(newGroup[ni]!);
      preserved.set(newK, { oldKey: oldK, newKey: newK });
      oldGroupMatched.add(oi);
      newGroupMatched.add(ni);
    }

    // ── Classify unmatched ────────────────────────────────────────────────────
    for (let i = 0; i < oldGroup.length; i++) {
      if (!oldGroupMatched.has(i)) removed.push(edgeKey(oldGroup[i]!));
    }
    for (let i = 0; i < newGroup.length; i++) {
      if (!newGroupMatched.has(i)) added.push(edgeKey(newGroup[i]!));
    }
  }

  return { preserved, added, removed };
}
