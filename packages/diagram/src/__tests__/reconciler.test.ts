/**
 * A7 — Reconciler tests
 *
 * Tests cover the public contract of reconcile() and InvalidMermaidError in
 * reconciler/reconciler.ts.
 *
 * Tests are RED in Phase B (stub throws "not implemented").
 * They turn GREEN in Phase C after implementation.
 *
 * parseMermaid() is mocked so the reconciler's behaviour can be controlled
 * precisely without requiring a DOM or a real Mermaid parse.
 * The reconciler calls parseMermaid(newSource) first, then parseMermaid(oldSource).
 *
 * Requirements: diag_arch_v4.2.md §7.1, §7.3, §7.4
 * Requirement IDs: RC-01 through RC-35
 */

// API checklist:
// ✓ reconcile — 34 tests (RC-01..RC-34)
//   covered paths:
//   RC-01..RC-03  no-op / identical source / invalid new source
//   RC-04..RC-09  node add/remove: lists, unplaced, position preservation
//   RC-10..RC-15  edge reconciliation: preserved routing, new=auto, removed
//   RC-16..RC-18  cluster add/remove/member-layout preservation
//   RC-19..RC-23  @rename: key migration, source cleanup, unknown-id safety
//   RC-24..RC-25  empty oldSource treated as all-add
//   RC-26..RC-28  InvalidMermaidError: thrown, .line, layout unmodified
//   RC-29..RC-30  immutability: currentLayout not mutated, new object returned
//   RC-31..RC-34  batch add, clustersChanged invariant, combined scenario
// ✓ InvalidMermaidError class — RC-35: extends Error, .line, .name

import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  LayoutStore,
  NodeLayout,
  ParsedDiagram,
  ParsedNode,
  ParsedEdge,
  ParsedCluster,
} from "../types.js";

// ── Mock parseMermaid ─────────────────────────────────────────────────────────
// Reconciler calls parseMermaid(newSource) first, then parseMermaid(oldSource).
// Use mockReturnValueOnce() to control each call independently.
//
// vi.mock() is hoisted to the top of the file by Vitest's transform; the factory
// must only reference variables created with vi.hoisted() to avoid TDZ errors.

const { parseMermaidMock } = vi.hoisted(() => ({
  parseMermaidMock: vi.fn(),
}));
vi.mock("../parser/adapter.js", () => ({
  parseMermaid: parseMermaidMock,
}));

import { reconcile, InvalidMermaidError } from "../reconciler/reconciler.js";

// ── Test helpers ──────────────────────────────────────────────────────────────

function makeLayout(overrides: Partial<LayoutStore> = {}): LayoutStore {
  return {
    version: "1.0",
    diagram_type: "flowchart",
    nodes: {},
    edges: {},
    clusters: {},
    unplaced: [],
    aesthetics: { roughness: 1 },
    ...overrides,
  };
}

function makeParsed(overrides: Partial<ParsedDiagram> = {}): ParsedDiagram {
  return {
    type: "flowchart",
    nodes: new Map(),
    edges: [],
    clusters: [],
    renames: [],
    ...overrides,
  };
}

function makeNode(id: string, shape = "rectangle"): ParsedNode {
  return { id, label: id, shape, classes: [] };
}

function makeEdge(
  from: string,
  to: string,
  ordinal = 0,
  label = "",
): ParsedEdge {
  return { from, to, ordinal, label, type: "arrow" };
}

function makeCluster(
  id: string,
  members: string[],
): ParsedCluster {
  return { id, label: id, members };
}

/** Build the EdgeKey string for a given edge. */
function edgeKey(from: string, to: string, ordinal: number): string {
  return `${from}->${to}:${ordinal}`;
}

function makeNodeLayout(overrides?: Partial<NodeLayout>): NodeLayout {
  return { x: 100, y: 100, w: 180, h: 60, style: {}, ...overrides };
}

function makeEdgeLayout(routing: "auto" | "orthogonal" = "auto") {
  return { routing, waypoints: [] as const, style: {} };
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  parseMermaidMock.mockReset();
});

/** Configure mock: parseMermaid(newSource) → valid, parseMermaid(oldSource) → valid. */
function mockBoth(newParsed: ParsedDiagram, oldParsed: ParsedDiagram): void {
  parseMermaidMock
    .mockResolvedValueOnce({ valid: true, diagram: newParsed })
    .mockResolvedValueOnce({ valid: true, diagram: oldParsed });
}

/** Configure mock: parseMermaid(newSource) → valid, parseMermaid(oldSource) → unrecognised. */
function mockEmptyOld(newParsed: ParsedDiagram): void {
  parseMermaidMock
    .mockResolvedValueOnce({ valid: true, diagram: newParsed })
    .mockResolvedValueOnce({
      valid: false,
      error: { line: 0, message: "Unrecognised or empty diagram source" },
    });
}

/** Configure mock: parseMermaid() always returns this error (new source invalid). */
function mockInvalid(line = 0, msg = "parse error"): void {
  parseMermaidMock.mockResolvedValue({
    valid: false,
    error: { line, message: msg },
  });
}

// ── RC-01..RC-03: Baseline ────────────────────────────────────────────────────

describe("reconcile — no topology change", () => {
  it("RC-01: identical source with no nodes → zero changes in all fields", async () => {
    const parsed = makeParsed();
    mockBoth(parsed, parsed);
    const result = await reconcile("flowchart TD", "flowchart TD", makeLayout());
    expect(result.changes.nodesAdded).toHaveLength(0);
    expect(result.changes.nodesRemoved).toHaveLength(0);
    expect(result.changes.edgesAdded).toBe(0);
    expect(result.changes.edgesRemoved).toBe(0);
    expect(result.changes.clustersChanged).toBe(0);
  });

  it("RC-02: existing node layout preserved when source is unchanged", async () => {
    const node = makeNode("A");
    const nodeLayout = makeNodeLayout({ x: 200, y: 300 });
    const parsed = makeParsed({ nodes: new Map([["A", node]]) });
    const layout = makeLayout({ nodes: { A: nodeLayout } });
    mockBoth(parsed, parsed);
    const result = await reconcile("old", "old", layout);
    expect(result.layout.nodes["A"]).toEqual(nodeLayout);
  });

  it("RC-03: invalid newSource → throws InvalidMermaidError", async () => {
    mockInvalid(5, "unexpected token");
    await expect(
      reconcile("flowchart TD", "invalid{{", makeLayout()),
    ).rejects.toThrow(InvalidMermaidError);
  });
});

// ── RC-04..RC-09: Node changes ────────────────────────────────────────────────

describe("reconcile — node add/remove", () => {
  it("RC-04: added node → appears in changes.nodesAdded", async () => {
    const oldParsed = makeParsed({ nodes: new Map([["A", makeNode("A")]]) });
    const newParsed = makeParsed({
      nodes: new Map([["A", makeNode("A")], ["B", makeNode("B")]]),
    });
    mockBoth(newParsed, oldParsed);
    const result = await reconcile("old", "new", makeLayout({ nodes: { A: makeNodeLayout() } }));
    expect(result.changes.nodesAdded).toContain("B");
  });

  it("RC-05: added node → placed in layout.unplaced, not layout.nodes", async () => {
    const oldParsed = makeParsed({ nodes: new Map([["A", makeNode("A")]]) });
    const newParsed = makeParsed({
      nodes: new Map([["A", makeNode("A")], ["B", makeNode("B")]]),
    });
    mockBoth(newParsed, oldParsed);
    const result = await reconcile("old", "new", makeLayout({ nodes: { A: makeNodeLayout() } }));
    expect(result.layout.unplaced).toContain("B");
    expect(result.layout.nodes["B"]).toBeUndefined();
  });

  it("RC-06: removed node → absent from result layout.nodes", async () => {
    const oldParsed = makeParsed({
      nodes: new Map([["A", makeNode("A")], ["B", makeNode("B")]]),
    });
    const newParsed = makeParsed({ nodes: new Map([["A", makeNode("A")]]) });
    const layout = makeLayout({ nodes: { A: makeNodeLayout(), B: makeNodeLayout() } });
    mockBoth(newParsed, oldParsed);
    const result = await reconcile("old", "new", layout);
    expect(result.layout.nodes["B"]).toBeUndefined();
  });

  it("RC-07: removed node → appears in changes.nodesRemoved", async () => {
    const oldParsed = makeParsed({
      nodes: new Map([["A", makeNode("A")], ["B", makeNode("B")]]),
    });
    const newParsed = makeParsed({ nodes: new Map([["A", makeNode("A")]]) });
    const layout = makeLayout({ nodes: { A: makeNodeLayout(), B: makeNodeLayout() } });
    mockBoth(newParsed, oldParsed);
    const result = await reconcile("old", "new", layout);
    expect(result.changes.nodesRemoved).toContain("B");
  });

  it("RC-08: existing node layout preserved when another node is added", async () => {
    const aLayout = makeNodeLayout({ x: 200, y: 300 });
    const oldParsed = makeParsed({ nodes: new Map([["A", makeNode("A")]]) });
    const newParsed = makeParsed({
      nodes: new Map([["A", makeNode("A")], ["B", makeNode("B")]]),
    });
    mockBoth(newParsed, oldParsed);
    const result = await reconcile("old", "new", makeLayout({ nodes: { A: aLayout } }));
    expect(result.layout.nodes["A"]).toEqual(aLayout);
  });

  it("RC-09: existing node layout preserved when another node is removed", async () => {
    const aLayout = makeNodeLayout({ x: 200, y: 300 });
    const oldParsed = makeParsed({
      nodes: new Map([["A", makeNode("A")], ["B", makeNode("B")]]),
    });
    const newParsed = makeParsed({ nodes: new Map([["A", makeNode("A")]]) });
    const layout = makeLayout({ nodes: { A: aLayout, B: makeNodeLayout() } });
    mockBoth(newParsed, oldParsed);
    const result = await reconcile("old", "new", layout);
    expect(result.layout.nodes["A"]).toEqual(aLayout);
  });
});

// ── RC-10..RC-15: Edge changes ────────────────────────────────────────────────

describe("reconcile — edge reconciliation", () => {
  it("RC-10: matching edge → routing data migrated to result", async () => {
    const edge = makeEdge("A", "B");
    const k = edgeKey("A", "B", 0);
    const parsed = makeParsed({
      nodes: new Map([["A", makeNode("A")], ["B", makeNode("B")]]),
      edges: [edge],
    });
    const layout = makeLayout({
      nodes: { A: makeNodeLayout(), B: makeNodeLayout() },
      edges: { [k]: makeEdgeLayout("orthogonal") },
    });
    mockBoth(parsed, parsed);
    const result = await reconcile("old", "new", layout);
    expect(result.layout.edges[k]?.routing).toBe("orthogonal");
  });

  it("RC-11: new edge (no old match) → gets routing 'auto'", async () => {
    const oldParsed = makeParsed({
      nodes: new Map([["A", makeNode("A")], ["B", makeNode("B")]]),
    });
    const newParsed = makeParsed({
      nodes: new Map([["A", makeNode("A")], ["B", makeNode("B")]]),
      edges: [makeEdge("A", "B")],
    });
    const layout = makeLayout({ nodes: { A: makeNodeLayout(), B: makeNodeLayout() } });
    mockBoth(newParsed, oldParsed);
    const result = await reconcile("old", "new", layout);
    expect(result.layout.edges[edgeKey("A", "B", 0)]?.routing).toBe("auto");
  });

  it("RC-12: removed edge → key absent from result layout.edges", async () => {
    const k = edgeKey("A", "B", 0);
    const oldParsed = makeParsed({
      nodes: new Map([["A", makeNode("A")], ["B", makeNode("B")]]),
      edges: [makeEdge("A", "B")],
    });
    const newParsed = makeParsed({
      nodes: new Map([["A", makeNode("A")], ["B", makeNode("B")]]),
    });
    const layout = makeLayout({
      nodes: { A: makeNodeLayout(), B: makeNodeLayout() },
      edges: { [k]: makeEdgeLayout() },
    });
    mockBoth(newParsed, oldParsed);
    const result = await reconcile("old", "new", layout);
    expect(result.layout.edges[k]).toBeUndefined();
  });

  it("RC-13: changes.edgesAdded reflects count of unmatched new edges", async () => {
    const oldParsed = makeParsed({
      nodes: new Map([["A", makeNode("A")], ["B", makeNode("B")], ["C", makeNode("C")]]),
    });
    const newParsed = makeParsed({
      nodes: new Map([["A", makeNode("A")], ["B", makeNode("B")], ["C", makeNode("C")]]),
      edges: [makeEdge("A", "B"), makeEdge("B", "C")],
    });
    const layout = makeLayout({
      nodes: { A: makeNodeLayout(), B: makeNodeLayout(), C: makeNodeLayout() },
    });
    mockBoth(newParsed, oldParsed);
    const result = await reconcile("old", "new", layout);
    expect(result.changes.edgesAdded).toBe(2);
  });

  it("RC-14: changes.edgesRemoved reflects count of removed unmatched edges", async () => {
    const k1 = edgeKey("A", "B", 0);
    const k2 = edgeKey("B", "C", 0);
    const oldParsed = makeParsed({
      nodes: new Map([["A", makeNode("A")], ["B", makeNode("B")], ["C", makeNode("C")]]),
      edges: [makeEdge("A", "B"), makeEdge("B", "C")],
    });
    const newParsed = makeParsed({
      nodes: new Map([["A", makeNode("A")], ["B", makeNode("B")]]),
    });
    const layout = makeLayout({
      nodes: { A: makeNodeLayout(), B: makeNodeLayout(), C: makeNodeLayout() },
      edges: { [k1]: makeEdgeLayout(), [k2]: makeEdgeLayout() },
    });
    mockBoth(newParsed, oldParsed);
    const result = await reconcile("old", "new", layout);
    expect(result.changes.edgesRemoved).toBe(2);
  });

  it("RC-15: edge whose endpoint node was removed → removed from result layout.edges", async () => {
    const k = edgeKey("A", "B", 0);
    const oldParsed = makeParsed({
      nodes: new Map([["A", makeNode("A")], ["B", makeNode("B")]]),
      edges: [makeEdge("A", "B")],
    });
    const newParsed = makeParsed({ nodes: new Map([["A", makeNode("A")]]) });
    const layout = makeLayout({
      nodes: { A: makeNodeLayout(), B: makeNodeLayout() },
      edges: { [k]: makeEdgeLayout() },
    });
    mockBoth(newParsed, oldParsed);
    const result = await reconcile("old", "new", layout);
    expect(result.layout.edges[k]).toBeUndefined();
  });
});

// ── RC-16..RC-18: Cluster changes ─────────────────────────────────────────────

describe("reconcile — cluster changes", () => {
  it("RC-16: added cluster → changes.clustersChanged ≥ 1", async () => {
    const oldParsed = makeParsed({ nodes: new Map([["A", makeNode("A")]]) });
    const newParsed = makeParsed({
      nodes: new Map([["A", makeNode("A")]]),
      clusters: [makeCluster("G1", ["A"])],
    });
    const layout = makeLayout({ nodes: { A: makeNodeLayout() } });
    mockBoth(newParsed, oldParsed);
    const result = await reconcile("old", "new", layout);
    expect(result.changes.clustersChanged).toBeGreaterThanOrEqual(1);
  });

  it("RC-17: removed cluster → changes.clustersChanged ≥ 1", async () => {
    const oldParsed = makeParsed({
      nodes: new Map([["A", makeNode("A")]]),
      clusters: [makeCluster("G1", ["A"])],
    });
    const newParsed = makeParsed({ nodes: new Map([["A", makeNode("A")]]) });
    const layout = makeLayout({
      nodes: { A: makeNodeLayout() },
      clusters: { G1: { x: 0, y: 0, w: 300, h: 200, label: "G1", style: {} } },
    });
    mockBoth(newParsed, oldParsed);
    const result = await reconcile("old", "new", layout);
    expect(result.changes.clustersChanged).toBeGreaterThanOrEqual(1);
  });

  it("RC-18: removed cluster — member nodes retain their node layout", async () => {
    const aLayout = makeNodeLayout({ x: 50, y: 50 });
    const oldParsed = makeParsed({
      nodes: new Map([["A", makeNode("A")]]),
      clusters: [makeCluster("G1", ["A"])],
    });
    const newParsed = makeParsed({ nodes: new Map([["A", makeNode("A")]]) });
    const layout = makeLayout({
      nodes: { A: aLayout },
      clusters: { G1: { x: 0, y: 0, w: 300, h: 200, label: "G1", style: {} } },
    });
    mockBoth(newParsed, oldParsed);
    const result = await reconcile("old", "new", layout);
    expect(result.layout.nodes["A"]).toEqual(aLayout);
  });
});

// ── RC-19..RC-23: @rename annotations ─────────────────────────────────────────

describe("reconcile — @rename annotations", () => {
  it("RC-19: @rename → old layout key migrated to new key", async () => {
    const aLayout = makeNodeLayout({ x: 50, y: 100 });
    const oldParsed = makeParsed({ nodes: new Map([["A", makeNode("A")]]) });
    const newParsed = makeParsed({
      nodes: new Map([["A2", makeNode("A2")]]),
      renames: [{ oldId: "A", newId: "A2" }],
    });
    mockBoth(newParsed, oldParsed);
    const result = await reconcile(
      "old",
      "flowchart TD\n%% @rename: A -> A2\nA2[A2]",
      makeLayout({ nodes: { A: aLayout } }),
    );
    expect(result.layout.nodes["A2"]).toEqual(aLayout);
    expect(result.layout.nodes["A"]).toBeUndefined();
  });

  it("RC-20: @rename → mermaidCleaned has the @rename annotation line stripped", async () => {
    const oldParsed = makeParsed({ nodes: new Map([["A", makeNode("A")]]) });
    const newParsed = makeParsed({
      nodes: new Map([["A2", makeNode("A2")]]),
      renames: [{ oldId: "A", newId: "A2" }],
    });
    mockBoth(newParsed, oldParsed);
    const result = await reconcile(
      "old",
      "flowchart TD\n%% @rename: A -> A2\nA2[A2]",
      makeLayout({ nodes: { A: makeNodeLayout() } }),
    );
    expect(result.mermaidCleaned).toBeDefined();
    expect(result.mermaidCleaned).not.toContain("@rename");
  });

  it("RC-21: @rename → renamesApplied includes 'A -> A2'", async () => {
    const oldParsed = makeParsed({ nodes: new Map([["A", makeNode("A")]]) });
    const newParsed = makeParsed({
      nodes: new Map([["A2", makeNode("A2")]]),
      renames: [{ oldId: "A", newId: "A2" }],
    });
    mockBoth(newParsed, oldParsed);
    const result = await reconcile(
      "old",
      "flowchart TD\n%% @rename: A -> A2\nA2[A2]",
      makeLayout({ nodes: { A: makeNodeLayout() } }),
    );
    expect(result.changes.renamesApplied).toContain("A -> A2");
  });

  it("RC-22: no @rename annotations → mermaidCleaned is undefined", async () => {
    const parsed = makeParsed({ nodes: new Map([["A", makeNode("A")]]) });
    mockBoth(parsed, parsed);
    const result = await reconcile(
      "flowchart TD\nA[A]",
      "flowchart TD\nA[A]",
      makeLayout({ nodes: { A: makeNodeLayout() } }),
    );
    expect(result.mermaidCleaned).toBeUndefined();
  });

  it("RC-23: @rename with unknown oldId → no crash, rename is silently skipped", async () => {
    const oldParsed = makeParsed({ nodes: new Map([["A", makeNode("A")]]) });
    const newParsed = makeParsed({
      nodes: new Map([["A2", makeNode("A2")]]),
      renames: [{ oldId: "GHOST", newId: "A2" }],
    });
    mockBoth(newParsed, oldParsed);
    await expect(
      reconcile(
        "old",
        "flowchart TD\n%% @rename: GHOST -> A2\nA2[A2]",
        makeLayout({ nodes: { A: makeNodeLayout() } }),
      ),
    ).resolves.toBeDefined();
  });
});

// ── RC-24..RC-25: Empty oldSource ─────────────────────────────────────────────

describe("reconcile — empty oldSource", () => {
  it("RC-24: empty oldSource → all nodes in newSource appear in nodesAdded", async () => {
    const newParsed = makeParsed({
      nodes: new Map([["A", makeNode("A")], ["B", makeNode("B")]]),
    });
    mockEmptyOld(newParsed);
    const result = await reconcile("", "flowchart TD\nA\nB", makeLayout());
    expect(result.changes.nodesAdded).toContain("A");
    expect(result.changes.nodesAdded).toContain("B");
  });

  it("RC-25: empty oldSource → all edges in newSource added with routing 'auto'", async () => {
    const newParsed = makeParsed({
      nodes: new Map([["A", makeNode("A")], ["B", makeNode("B")]]),
      edges: [makeEdge("A", "B")],
    });
    mockEmptyOld(newParsed);
    const result = await reconcile("", "flowchart TD\nA-->B", makeLayout());
    expect(result.layout.edges[edgeKey("A", "B", 0)]?.routing).toBe("auto");
  });
});

// ── RC-26..RC-28: Error handling ──────────────────────────────────────────────

describe("reconcile — InvalidMermaidError", () => {
  it("RC-26: thrown error carries the .line number from the parse result", async () => {
    mockInvalid(7, "unexpected token");
    let caught: unknown;
    try {
      await reconcile("old", "bad mermaid", makeLayout());
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(InvalidMermaidError);
    expect((caught as InvalidMermaidError).line).toBe(7);
  });

  it("RC-27: empty newSource → throws InvalidMermaidError", async () => {
    parseMermaidMock.mockReturnValue({
      valid: false,
      error: { line: 0, message: "Unrecognised or empty diagram source" },
    });
    await expect(reconcile("flowchart TD\nA", "", makeLayout())).rejects.toThrow(
      InvalidMermaidError,
    );
  });

  it("RC-28: after throwing, the currentLayout object is not mutated", async () => {
    const layout = makeLayout({ nodes: { A: makeNodeLayout() } });
    const nodesBefore = JSON.stringify(layout.nodes);
    mockInvalid(1, "error");
    try {
      await reconcile("old", "bad", layout);
    } catch {
      /* expected */
    }
    expect(JSON.stringify(layout.nodes)).toBe(nodesBefore);
  });
});

// ── RC-29..RC-30: Immutability ────────────────────────────────────────────────

describe("reconcile — immutability", () => {
  it("RC-29: currentLayout nodes object is not mutated", async () => {
    const parsed = makeParsed({ nodes: new Map([["A", makeNode("A")]]) });
    const layout = makeLayout({ nodes: { A: makeNodeLayout() } });
    const nodesBefore = JSON.stringify(layout.nodes);
    mockBoth(parsed, parsed);
    await reconcile("old", "new", layout);
    expect(JSON.stringify(layout.nodes)).toBe(nodesBefore);
  });

  it("RC-30: returned layout is a different object reference than currentLayout", async () => {
    const parsed = makeParsed();
    const layout = makeLayout();
    mockBoth(parsed, parsed);
    const result = await reconcile("old", "new", layout);
    expect(result.layout).not.toBe(layout);
  });
});

// ── RC-31..RC-35: Batch / combined ────────────────────────────────────────────

describe("reconcile — batch and combined scenarios", () => {
  it("RC-31: batch add (3 nodes) — all appear in layout.unplaced, none in nodes", async () => {
    const oldParsed = makeParsed({ nodes: new Map([["A", makeNode("A")]]) });
    const newParsed = makeParsed({
      nodes: new Map([
        ["A", makeNode("A")],
        ["B", makeNode("B")],
        ["C", makeNode("C")],
        ["D", makeNode("D")],
      ]),
    });
    mockBoth(newParsed, oldParsed);
    const result = await reconcile("old", "new", makeLayout({ nodes: { A: makeNodeLayout() } }));
    expect(result.layout.unplaced).toContain("B");
    expect(result.layout.unplaced).toContain("C");
    expect(result.layout.unplaced).toContain("D");
    expect(result.layout.nodes["B"]).toBeUndefined();
    expect(result.layout.nodes["C"]).toBeUndefined();
    expect(result.layout.nodes["D"]).toBeUndefined();
  });

  it("RC-32: clustersChanged is 0 when only nodes change and no cluster diff", async () => {
    const oldParsed = makeParsed({ nodes: new Map([["A", makeNode("A")]]) });
    const newParsed = makeParsed({
      nodes: new Map([["A", makeNode("A")], ["B", makeNode("B")]]),
    });
    mockBoth(newParsed, oldParsed);
    const result = await reconcile("old", "new", makeLayout({ nodes: { A: makeNodeLayout() } }));
    expect(result.changes.clustersChanged).toBe(0);
  });

  it("RC-33: removed cluster entry absent from result layout.clusters", async () => {
    const oldParsed = makeParsed({
      nodes: new Map([["A", makeNode("A")]]),
      clusters: [makeCluster("G1", ["A"])],
    });
    const newParsed = makeParsed({ nodes: new Map([["A", makeNode("A")]]) });
    const layout = makeLayout({
      nodes: { A: makeNodeLayout() },
      clusters: { G1: { x: 0, y: 0, w: 300, h: 200, label: "G1", style: {} } },
    });
    mockBoth(newParsed, oldParsed);
    const result = await reconcile("old", "new", layout);
    expect(result.layout.clusters["G1"]).toBeUndefined();
  });

  it("RC-34: add node + remove node in same pass → both change lists populated", async () => {
    const oldParsed = makeParsed({
      nodes: new Map([["A", makeNode("A")], ["B", makeNode("B")]]),
    });
    const newParsed = makeParsed({
      nodes: new Map([["A", makeNode("A")], ["C", makeNode("C")]]),
    });
    mockBoth(newParsed, oldParsed);
    const layout = makeLayout({ nodes: { A: makeNodeLayout(), B: makeNodeLayout() } });
    const result = await reconcile("old", "new", layout);
    expect(result.changes.nodesAdded).toContain("C");
    expect(result.changes.nodesRemoved).toContain("B");
  });

  it("RC-35: InvalidMermaidError is an Error, has .line and .name", () => {
    const err = new InvalidMermaidError(3, "test error");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(InvalidMermaidError);
    expect(err.line).toBe(3);
    expect(err.message).toBe("test error");
    expect(err.name).toBe("InvalidMermaidError");
  });
});

// ── RC-36: Parallel-edge ordinal migration (A5 behaviour via A7) ──────────────

describe("reconcile — parallel-edge ordinal migration", () => {
  it(
    "RC-36: when A→B has ordinal 0 in old layout and topology adds a second " +
      "A→B edge (ordinal 1), the ordinal-0 edge routing is preserved and ordinal-1 is auto",
    async () => {
      // Old diagram: one A→B edge (ordinal 0) with existing layout
      const oldParsed = makeParsed({
        nodes: new Map([
          ["A", makeNode("A")],
          ["B", makeNode("B")],
        ]),
        edges: [makeEdge("A", "B", 0)],
      });

      // New diagram: two A→B edges (ordinals 0 + 1)
      const newParsed = makeParsed({
        nodes: new Map([
          ["A", makeNode("A")],
          ["B", makeNode("B")],
        ]),
        edges: [makeEdge("A", "B", 0), makeEdge("A", "B", 1)],
      });

      const k0 = edgeKey("A", "B", 0);
      const k1 = edgeKey("A", "B", 1);

      const currentLayout = makeLayout({
        nodes: { A: makeNodeLayout(), B: makeNodeLayout({ x: 300 }) },
        edges: { [k0]: { routing: "orthogonal", waypoints: [], style: {} } },
      });

      mockBoth(newParsed, oldParsed);
      const result = await reconcile("new", "old", currentLayout);

      // Ordinal-0 edge: routing preserved from currentLayout (orthogonal)
      expect(result.layout.edges[k0]?.routing).toBe("orthogonal");
      // Ordinal-1 edge: brand new, should start as "auto"
      expect(result.layout.edges[k1]?.routing).toBe("auto");
      // Summary counters
      expect(result.changes.edgesAdded).toBe(1);
      expect(result.changes.edgesRemoved).toBe(0);
    },
  );
});
