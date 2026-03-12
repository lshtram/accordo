/**
 * A5 — Edge identity tests
 *
 * Tests cover the public contract of matchEdges() in
 * reconciler/edge-identity.ts.
 *
 * Tests are RED in Phase B (stub throws "not implemented").
 * They turn GREEN in Phase C after implementation.
 *
 * Requirements: diag_arch_v4.2.md §4.4
 * Requirement IDs: EI-01 through EI-22
 */

// API checklist:
// ✓ matchEdges — 22 tests (EI-01..EI-22)
//   covered paths: empty inputs, identical sets, add/remove labeled/unlabeled,
//   label-match priority over ordinal, ordinal tie-break within duplicate labels,
//   edge label change (remove+add), re-index after removal, stale layout key,
//   self-loop, mixed preserve/add/remove, only-additions, only-removals.

import { describe, it, expect } from "vitest";
import { matchEdges } from "../reconciler/edge-identity.js";
import type { ParsedEdge, EdgeLayout } from "../types.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function edge(
  from: string,
  to: string,
  ordinal: number,
  label = ""
): ParsedEdge {
  return { from, to, ordinal, label, type: "arrow" };
}

/** Build the EdgeKey string for a given edge. */
function key(from: string, to: string, ordinal: number): string {
  return `${from}->${to}:${ordinal}`;
}

/** Build a minimal oldLayout object from a list of EdgeKey strings. */
function layout(keys: string[]): Record<string, EdgeLayout> {
  return Object.fromEntries(
    keys.map((k) => [k, { routing: "auto" as const, waypoints: [], style: {} }])
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("matchEdges (A5 — edge identity)", () => {
  // EI-01: empty inputs → all empty
  it("EI-01: empty old and new edges → preserved empty, added empty, removed empty", () => {
    const result = matchEdges([], [], {});
    expect(result.preserved.size).toBe(0);
    expect(result.added).toEqual([]);
    expect(result.removed).toEqual([]);
  });

  // EI-02: identical edge sets → all preserved, keys unchanged
  it("EI-02: identical edge sets → all preserved with oldKey === newKey", () => {
    const edges = [edge("A", "B", 0), edge("B", "C", 0)];
    const result = matchEdges(edges, edges, layout(["A->B:0", "B->C:0"]));
    expect(result.preserved.get(key("A", "B", 0))).toEqual({
      oldKey: key("A", "B", 0),
      newKey: key("A", "B", 0),
    });
    expect(result.preserved.get(key("B", "C", 0))).toEqual({
      oldKey: key("B", "C", 0),
      newKey: key("B", "C", 0),
    });
    expect(result.added).toHaveLength(0);
    expect(result.removed).toHaveLength(0);
  });

  // EI-03: new unlabeled edge added → appears in added[]
  it("EI-03: new unlabeled edge → added", () => {
    const result = matchEdges([], [edge("A", "B", 0)], {});
    expect(result.added).toContain(key("A", "B", 0));
    expect(result.preserved.size).toBe(0);
    expect(result.removed).toHaveLength(0);
  });

  // EI-04: old unlabeled edge removed → appears in removed[]
  it("EI-04: old unlabeled edge removed → removed", () => {
    const result = matchEdges([edge("A", "B", 0)], [], layout(["A->B:0"]));
    expect(result.removed).toContain(key("A", "B", 0));
    expect(result.preserved.size).toBe(0);
    expect(result.added).toHaveLength(0);
  });

  // EI-05: new labeled edge added
  it("EI-05: new labeled edge → added", () => {
    const result = matchEdges([], [edge("A", "B", 0, "login")], {});
    expect(result.added).toContain(key("A", "B", 0));
  });

  // EI-06: old labeled edge removed
  it("EI-06: old labeled edge removed → removed", () => {
    const result = matchEdges([edge("A", "B", 0, "login")], [], layout(["A->B:0"]));
    expect(result.removed).toContain(key("A", "B", 0));
  });

  // EI-07: labeled edge survives reorder — ordinal changes, routing migrates
  it("EI-07: labeled edges survive reorder — preserved with updated key", () => {
    // old: A→B "data" ordinal=0, A→B "ctrl" ordinal=1
    // new: A→B "ctrl" ordinal=0, A→B "data" ordinal=1 (swapped)
    const oldEdges = [edge("A", "B", 0, "data"), edge("A", "B", 1, "ctrl")];
    const newEdges = [edge("A", "B", 0, "ctrl"), edge("A", "B", 1, "data")];
    const result = matchEdges(oldEdges, newEdges, layout(["A->B:0", "A->B:1"]));
    // "data" edge: was key A->B:0, becomes A->B:1
    expect(result.preserved.get(key("A", "B", 1))).toEqual({
      oldKey: key("A", "B", 0),
      newKey: key("A", "B", 1),
    });
    // "ctrl" edge: was key A->B:1, becomes A->B:0
    expect(result.preserved.get(key("A", "B", 0))).toEqual({
      oldKey: key("A", "B", 1),
      newKey: key("A", "B", 0),
    });
    expect(result.added).toHaveLength(0);
    expect(result.removed).toHaveLength(0);
  });

  // EI-08: unlabeled edge preserved when ordinal unchanged
  it("EI-08: unlabeled edge with unchanged ordinal → preserved, same key", () => {
    const e = edge("A", "B", 0);
    const result = matchEdges([e], [e], layout(["A->B:0"]));
    expect(result.preserved.get(key("A", "B", 0))).toEqual({
      oldKey: key("A", "B", 0),
      newKey: key("A", "B", 0),
    });
  });

  // EI-09: two edges same pair, different labels — remove one, keep other
  it("EI-09: remove one of two differently-labeled edges on same pair", () => {
    const old = [edge("A", "B", 0, "x"), edge("A", "B", 1, "y")];
    const newEdges = [edge("A", "B", 0, "x")];
    const result = matchEdges(old, newEdges, layout(["A->B:0", "A->B:1"]));
    expect(result.removed).toContain(key("A", "B", 1));
    expect(result.preserved.get(key("A", "B", 0))).toBeDefined();
    expect(result.added).toHaveLength(0);
  });

  // EI-10: edge label changes → treated as remove + add (no label match)
  it("EI-10: edge label change → remove old key, add new key", () => {
    const old = [edge("A", "B", 0, "old-label")];
    const newEdges = [edge("A", "B", 0, "new-label")];
    const result = matchEdges(old, newEdges, layout(["A->B:0"]));
    expect(result.removed).toContain(key("A", "B", 0));
    expect(result.added).toContain(key("A", "B", 0));
    expect(result.preserved.size).toBe(0);
  });

  // EI-11: unlabeled duplicate removed — remaining re-indexes, routing migrates
  it("EI-11: two unlabeled edges on same pair, one removed — remaining key preserved", () => {
    const old = [edge("A", "B", 0), edge("A", "B", 1)];
    const newEdges = [edge("A", "B", 0)];
    const result = matchEdges(old, newEdges, layout(["A->B:0", "A->B:1"]));
    expect(result.preserved.get(key("A", "B", 0))).toEqual({
      oldKey: key("A", "B", 0),
      newKey: key("A", "B", 0),
    });
    expect(result.removed).toContain(key("A", "B", 1));
    expect(result.added).toHaveLength(0);
  });

  // EI-12: edges with entirely different node IDs → added + removed
  it("EI-12: edges between different node pairs → added + removed, nothing preserved", () => {
    const old = [edge("A", "B", 0)];
    const newEdges = [edge("X", "Y", 0)];
    const result = matchEdges(old, newEdges, layout(["A->B:0"]));
    expect(result.removed).toContain(key("A", "B", 0));
    expect(result.added).toContain(key("X", "Y", 0));
    expect(result.preserved.size).toBe(0);
  });

  // EI-13: oldLayout has key not in oldEdges → silently ignored, not in removed
  it("EI-13: stale oldLayout key not in oldEdges → silently ignored", () => {
    const result = matchEdges([], [], layout(["ghost->node:0"]));
    expect(result.removed).toHaveLength(0);
    expect(result.preserved.size).toBe(0);
  });

  // EI-14: duplicate (from, to, label) — all preserved, matched by ordinal within group
  it("EI-14: duplicate (from,to,label) — both preserved, matched by ordinal within group", () => {
    const old = [edge("A", "B", 0, "data"), edge("A", "B", 1, "data")];
    const newEdges = [edge("A", "B", 0, "data"), edge("A", "B", 1, "data")];
    const result = matchEdges(old, newEdges, layout(["A->B:0", "A->B:1"]));
    expect(result.preserved.get(key("A", "B", 0))).toEqual({
      oldKey: key("A", "B", 0),
      newKey: key("A", "B", 0),
    });
    expect(result.preserved.get(key("A", "B", 1))).toEqual({
      oldKey: key("A", "B", 1),
      newKey: key("A", "B", 1),
    });
    expect(result.added).toHaveLength(0);
    expect(result.removed).toHaveLength(0);
  });

  // EI-15: duplicate label, one removed — deterministic: old:0 preserved, old:1 removed
  it("EI-15: duplicate (from,to,label), one removed — old ordinal-0 preserved, old ordinal-1 removed", () => {
    const old = [edge("A", "B", 0, "data"), edge("A", "B", 1, "data")];
    const newEdges = [edge("A", "B", 0, "data")];
    const result = matchEdges(old, newEdges, layout(["A->B:0", "A->B:1"]));
    expect(result.preserved.get(key("A", "B", 0))).toEqual({
      oldKey: key("A", "B", 0),
      newKey: key("A", "B", 0),
    });
    expect(result.removed).toContain(key("A", "B", 1));
    expect(result.added).toHaveLength(0);
  });

  // EI-16: multiple distinct edges all preserved — each gets correct key mapping
  it("EI-16: three distinct edges all preserved → correct key mapping for each", () => {
    const edges = [edge("A", "B", 0, "x"), edge("B", "C", 0), edge("C", "D", 0, "y")];
    const result = matchEdges(edges, edges, layout(["A->B:0", "B->C:0", "C->D:0"]));
    expect(result.preserved.size).toBe(3);
    expect(result.added).toHaveLength(0);
    expect(result.removed).toHaveLength(0);
  });

  // EI-17: mixed scenario — some preserved, some added, some removed
  it("EI-17: mixed preserve/add/remove in one call", () => {
    const old = [edge("A", "B", 0), edge("B", "C", 0)];
    const newEdges = [edge("A", "B", 0), edge("D", "E", 0)];
    const result = matchEdges(old, newEdges, layout(["A->B:0", "B->C:0"]));
    expect(result.preserved.get(key("A", "B", 0))).toBeDefined();
    expect(result.removed).toContain(key("B", "C", 0));
    expect(result.added).toContain(key("D", "E", 0));
  });

  // EI-18: label-match wins over ordinal position
  it("EI-18: label-match wins over ordinal — labeled edge migrates across ordinals", () => {
    // old: A→B label="x" ordinal=0,  A→B label="" ordinal=1
    // new: A→B label=""  ordinal=0,  A→B label="x" ordinal=1 (reordered)
    const old = [edge("A", "B", 0, "x"), edge("A", "B", 1)];
    const newEdges = [edge("A", "B", 0), edge("A", "B", 1, "x")];
    const result = matchEdges(old, newEdges, layout(["A->B:0", "A->B:1"]));
    // labeled "x" edge: old ordinal=0 → new ordinal=1
    expect(result.preserved.get(key("A", "B", 1))).toEqual({
      oldKey: key("A", "B", 0),
      newKey: key("A", "B", 1),
    });
    // unlabeled "" edge: old ordinal=1 → new ordinal=0
    expect(result.preserved.get(key("A", "B", 0))).toEqual({
      oldKey: key("A", "B", 1),
      newKey: key("A", "B", 0),
    });
    expect(result.added).toHaveLength(0);
    expect(result.removed).toHaveLength(0);
  });

  // EI-19: self-loop edge (from === to) handled normally
  it("EI-19: self-loop edge preserved across reconcile", () => {
    const selfLoop = edge("A", "A", 0);
    const result = matchEdges([selfLoop], [selfLoop], layout(["A->A:0"]));
    expect(result.preserved.get(key("A", "A", 0))).toEqual({
      oldKey: key("A", "A", 0),
      newKey: key("A", "A", 0),
    });
  });

  // EI-20: three edges same pair, two with same label — unique matched by label, others by ordinal
  it("EI-20: three edges, two duplicate labels, one removed — correct key migration", () => {
    // old: A→B "data":0, "data":1, "ctrl":2
    // new: A→B "data":0, "ctrl":1  (one "data" removed)
    const old = [
      edge("A", "B", 0, "data"),
      edge("A", "B", 1, "data"),
      edge("A", "B", 2, "ctrl"),
    ];
    const newEdges = [edge("A", "B", 0, "data"), edge("A", "B", 1, "ctrl")];
    const result = matchEdges(old, newEdges, layout(["A->B:0", "A->B:1", "A->B:2"]));
    // "ctrl" matched by label: old ordinal=2 → new ordinal=1
    expect(result.preserved.get(key("A", "B", 1))).toEqual({
      oldKey: key("A", "B", 2),
      newKey: key("A", "B", 1),
    });
    // first "data" ordinal-0 preserved at ordinal 0
    expect(result.preserved.get(key("A", "B", 0))).toEqual({
      oldKey: key("A", "B", 0),
      newKey: key("A", "B", 0),
    });
    // second "data" (old ordinal=1) removed
    expect(result.removed).toContain(key("A", "B", 1));
  });

  // EI-21: only removals
  it("EI-21: only removals — preserved empty, added empty", () => {
    const result = matchEdges([edge("A", "B", 0)], [], layout(["A->B:0"]));
    expect(result.preserved.size).toBe(0);
    expect(result.added).toHaveLength(0);
    expect(result.removed).toHaveLength(1);
  });

  // EI-22: only additions
  it("EI-22: only additions — preserved empty, removed empty", () => {
    const result = matchEdges([], [edge("A", "B", 0)], {});
    expect(result.preserved.size).toBe(0);
    expect(result.added).toHaveLength(1);
    expect(result.removed).toHaveLength(0);
  });
});
