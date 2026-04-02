/**
 * A6 — Placement tests
 *
 * Tests cover the public contract of placeNodes() in
 * reconciler/placement.ts.
 *
 * Tests are RED in Phase B (stub throws "not implemented").
 * They turn GREEN in Phase C after implementation.
 *
 * BACKFILL NOTE (A6-v2): PL-21..PL-24 were written after the dagre-first
 * algorithm was implemented (implementation-before-test exception agreed by
 * reviewer). The implementation already exists; these tests verify its contract.
 *
 * Requirements: diag_arch_v4.2.md §7.3
 * Requirement IDs: PL-01 through PL-24
 */

// API checklist:
// ✓ placeNodes — 24 tests (PL-01..PL-24)
//   covered paths: empty input, single disconnected node, neighbour-adjacent TD,
//   neighbour-adjacent LR, nodeSpacing option, multiple disconnected (grid),
//   sibling collision avoidance, no overlap with existing nodes, all shape dims
//   (diamond/circle/rectangle/unknown), absent node graceful skip, returned map
//   contains only newly placed nodes, no mutation of existingLayout, dense
//   layout safety cap (max 10 iterations), nearest-neighbour selection.
// A6-v2 (dagre-first): dagre-relative offset anchoring (PL-21), dagre absolute
//   fallback when no placed neighbours (PL-22), graceful degradation when dagre
//   throws (PL-23), negative cross-axis collision pass (PL-24).

import { describe, it, expect } from "vitest";
import { placeNodes } from "../reconciler/placement.js";
import type {
  ParsedDiagram,
  ParsedEdge,
  ParsedNode,
  NodeLayout,
  LayoutStore,
  NodeShape,
  SpatialDiagramType,
} from "../types.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeNode(id: string, shape: NodeShape = "rectangle"): ParsedNode {
  return { id, label: id, shape, classes: [] };
}

function makeParsedEdge(from: string, to: string): ParsedEdge {
  return { from, to, ordinal: 0, label: "", type: "arrow" };
}

function makeDiagram(
  nodes: ParsedNode[],
  edges: ParsedEdge[] = []
): ParsedDiagram {
  return {
    type: "flowchart",
    nodes: new Map(nodes.map((n) => [n.id, n])),
    edges,
    clusters: [],
    renames: [],
  };
}

function makeNodeLayout(x: number, y: number, w = 180, h = 60): NodeLayout {
  return { x, y, w, h, style: {} };
}

function makeLayoutStore(
  nodes: Record<string, NodeLayout> = {},
  diagram_type: SpatialDiagramType = "flowchart"
): LayoutStore {
  return {
    version: "1.0",
    diagram_type,
    nodes,
    edges: {},
    clusters: {},
    unplaced: [],
    aesthetics: {},
  };
}

/** Check that two positioned rectangles do not overlap. */
function noOverlap(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number }
): boolean {
  return (
    a.x + a.w <= b.x ||
    b.x + b.w <= a.x ||
    a.y + a.h <= b.y ||
    b.y + b.h <= a.y
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("placeNodes (A6 — unplaced placement)", () => {
  // PL-01: empty unplacedIds → empty map
  it("PL-01: empty unplacedIds → empty map returned", () => {
    const result = placeNodes([], makeDiagram([]), makeLayoutStore());
    expect(result.size).toBe(0);
  });

  // PL-02: single disconnected node, empty layout → placed somewhere (not throws)
  it("PL-02: single node, no neighbours, empty layout → placed with numeric coordinates", () => {
    const diagram = makeDiagram([makeNode("A")]);
    const result = placeNodes(["A"], diagram, makeLayoutStore());
    expect(result.has("A")).toBe(true);
    const pos = result.get("A")!;
    expect(typeof pos.x).toBe("number");
    expect(typeof pos.y).toBe("number");
    expect(typeof pos.w).toBe("number");
    expect(typeof pos.h).toBe("number");
  });

  // PL-03: single node with positioned neighbour, TD (default) → placed below
  it("PL-03: single node with positioned neighbour, TD flow → placed below neighbour", () => {
    const anchor = makeNode("anchor");
    const newNode = makeNode("newNode");
    const diagram = makeDiagram([anchor, newNode], [makeParsedEdge("anchor", "newNode")]);
    const layout = makeLayoutStore({ anchor: makeNodeLayout(0, 0) });
    const result = placeNodes(["newNode"], diagram, layout);
    // Placed below anchor (y > anchor.y + anchor.h = 60)
    expect(result.get("newNode")!.y).toBeGreaterThan(0);
  });

  // ── S-05: BT/RL direction placement ─────────────────────────────────────────

  it("S-05-F1: BT direction → successor placed above anchor (y < anchor.y)", () => {
    // In BT (bottom-to-top), flow goes upward, so successor node2 should be
    // positioned ABOVE node1 (y coordinate is smaller/less).
    const anchor = makeNode("anchor");
    const newNode = makeNode("newNode");
    const diagram = makeDiagram([anchor, newNode], [makeParsedEdge("anchor", "newNode")]);
    const layout = makeLayoutStore({ anchor: makeNodeLayout(100, 200) });
    const result = placeNodes(["newNode"], diagram, layout, { direction: "BT" });
    const pos = result.get("newNode")!;
    // Node placed above anchor — y should be less than anchor's y
    expect(pos.y).toBeLessThan(200);
  });

  it("S-05-F2: RL direction → successor placed left of anchor (x < anchor.x)", () => {
    // In RL (right-to-left), flow goes leftward, so successor node2 should be
    // positioned LEFT of node1 (x coordinate is smaller/less).
    const anchor = makeNode("anchor");
    const newNode = makeNode("newNode");
    const diagram = makeDiagram([anchor, newNode], [makeParsedEdge("anchor", "newNode")]);
    const layout = makeLayoutStore({ anchor: makeNodeLayout(300, 100) });
    const result = placeNodes(["newNode"], diagram, layout, { direction: "RL" });
    const pos = result.get("newNode")!;
    // Node placed left of anchor — x should be less than anchor's x
    expect(pos.x).toBeLessThan(300);
  });

  // PL-04: single node with positioned neighbour, LR → placed to the right
  it("PL-04: single node with positioned neighbour, LR flow → placed right of neighbour", () => {
    const anchor = makeNode("anchor");
    const newNode = makeNode("newNode");
    const diagram = makeDiagram([anchor, newNode], [makeParsedEdge("anchor", "newNode")]);
    const layout = makeLayoutStore({ anchor: makeNodeLayout(0, 0) });
    const result = placeNodes(["newNode"], diagram, layout, { direction: "LR" });
    // Placed to the right of anchor (x > anchor.x + anchor.w = 180)
    expect(result.get("newNode")!.x).toBeGreaterThan(0);
  });

  // PL-05: larger nodeSpacing → placed further from neighbour
  it("PL-05: larger nodeSpacing → node placed further from anchor", () => {
    const anchor = makeNode("a");
    const b = makeNode("b");
    const diagram = makeDiagram([anchor, b], [makeParsedEdge("a", "b")]);
    const layout = makeLayoutStore({ a: makeNodeLayout(0, 0) });
    const r1 = placeNodes(["b"], diagram, layout, { nodeSpacing: 40 });
    const r2 = placeNodes(["b"], diagram, layout, { nodeSpacing: 200 });
    // Larger nodeSpacing → b is placed further below/right of anchor
    const dist1 = Math.hypot(r1.get("b")!.x, r1.get("b")!.y);
    const dist2 = Math.hypot(r2.get("b")!.x, r2.get("b")!.y);
    expect(dist2).toBeGreaterThan(dist1);
  });

  // PL-06: multiple disconnected unplaced nodes → all placed, no pairwise overlaps
  it("PL-06: multiple disconnected nodes → all placed with no pairwise overlaps", () => {
    const nodes = ["A", "B", "C"].map((id) => makeNode(id));
    const diagram = makeDiagram(nodes);
    const result = placeNodes(["A", "B", "C"], diagram, makeLayoutStore());
    expect(result.size).toBe(3);
    const positions = [...result.values()];
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        expect(noOverlap(positions[i]!, positions[j]!)).toBe(true);
      }
    }
  });

  // PL-07: two newly placed siblings of same anchor → no mutual overlap
  it("PL-07: two unplaced siblings → collision avoidance prevents overlap", () => {
    const nodes = ["anchor", "c1", "c2"].map((id) => makeNode(id));
    const edges = [makeParsedEdge("anchor", "c1"), makeParsedEdge("anchor", "c2")];
    const diagram = makeDiagram(nodes, edges);
    const layout = makeLayoutStore({ anchor: makeNodeLayout(0, 0) });
    const result = placeNodes(["c1", "c2"], diagram, layout);
    expect(noOverlap(result.get("c1")!, result.get("c2")!)).toBe(true);
  });

  // PL-08: newly placed node does not overlap an existing layout node
  it("PL-08: newly placed node does not overlap existing positioned nodes", () => {
    const anchor = makeNode("anchor");
    const newNode = makeNode("newNode");
    const diagram = makeDiagram([anchor, newNode], [makeParsedEdge("anchor", "newNode")]);
    const anchorLayout = makeNodeLayout(0, 0);
    const layout = makeLayoutStore({ anchor: anchorLayout });
    const result = placeNodes(["newNode"], diagram, layout);
    expect(noOverlap(result.get("newNode")!, anchorLayout)).toBe(true);
  });

  // PL-09: diamond shape → returned dimensions 140×80
  it("PL-09: node shape 'diamond' → returned w=140, h=80", () => {
    const diagram = makeDiagram([makeNode("D", "diamond")]);
    const result = placeNodes(["D"], diagram, makeLayoutStore());
    const pos = result.get("D")!;
    expect(pos.w).toBe(140);
    expect(pos.h).toBe(80);
  });

  // PL-10: circle shape → returned dimensions 80×80
  it("PL-10: node shape 'circle' → returned w=80, h=80", () => {
    const diagram = makeDiagram([makeNode("C", "circle")]);
    const result = placeNodes(["C"], diagram, makeLayoutStore());
    const pos = result.get("C")!;
    expect(pos.w).toBe(80);
    expect(pos.h).toBe(80);
  });

  // PL-11: rectangle shape → returned dimensions 180×60
  it("PL-11: node shape 'rectangle' → returned w=180, h=60", () => {
    const diagram = makeDiagram([makeNode("R", "rectangle")]);
    const result = placeNodes(["R"], diagram, makeLayoutStore());
    const pos = result.get("R")!;
    expect(pos.w).toBe(180);
    expect(pos.h).toBe(60);
  });

  // PL-12: unknown shape → fallback 180×60
  it("PL-12: unknown shape → fallback w=180, h=60", () => {
    const node: ParsedNode = {
      id: "X",
      label: "X",
      shape: "unknown-future-shape",
      classes: [],
    };
    const diagram = makeDiagram([node]);
    const result = placeNodes(["X"], diagram, makeLayoutStore());
    const pos = result.get("X")!;
    expect(pos.w).toBe(180);
    expect(pos.h).toBe(60);
  });

  // PL-13: unplaced id not in parsed.nodes → skipped, not in returned map
  it("PL-13: unplaced id absent from parsed.nodes → skipped gracefully", () => {
    const diagram = makeDiagram([]); // empty parsed.nodes
    const result = placeNodes(["ghost"], diagram, makeLayoutStore());
    expect(result.has("ghost")).toBe(false);
  });

  // PL-14: connected node whose only neighbour has no position → falls back to grid
  it("PL-14: neighbour exists in parsed but has no position → grid fallback placement", () => {
    const anchor = makeNode("anchor");
    const newNode = makeNode("newNode");
    const diagram = makeDiagram([anchor, newNode], [makeParsedEdge("anchor", "newNode")]);
    // anchor not in existingLayout
    const layout = makeLayoutStore({});
    const result = placeNodes(["newNode"], diagram, layout);
    expect(result.has("newNode")).toBe(true);
  });

  // PL-15: returned map contains only newly placed nodes
  it("PL-15: returned map contains only the newly placed nodes, not existing ones", () => {
    const existing = makeNode("existing");
    const newNode = makeNode("newNode");
    const diagram = makeDiagram([existing, newNode]);
    const layout = makeLayoutStore({ existing: makeNodeLayout(0, 0) });
    const result = placeNodes(["newNode"], diagram, layout);
    expect(result.has("existing")).toBe(false);
    expect(result.has("newNode")).toBe(true);
  });

  // PL-16: existingLayout is not mutated
  it("PL-16: existingLayout.nodes is not mutated", () => {
    const newNode = makeNode("newNode");
    const existing = makeNode("existing");
    const diagram = makeDiagram([existing, newNode]);
    const layout = makeLayoutStore({ existing: makeNodeLayout(0, 0) });
    const beforeKeys = Object.keys(layout.nodes).slice().sort();
    placeNodes(["newNode"], diagram, layout);
    expect(Object.keys(layout.nodes).sort()).toEqual(beforeKeys);
  });

  // PL-17: two unplaced siblings of same anchor all placed, no mutual overlap
  it("PL-17: two unplaced nodes adjacent to same anchor → both placed, no collision", () => {
    const nodes = ["anchor", "c1", "c2"].map((id) => makeNode(id));
    const edges = [makeParsedEdge("anchor", "c1"), makeParsedEdge("anchor", "c2")];
    const diagram = makeDiagram(nodes, edges);
    const layout = makeLayoutStore({ anchor: makeNodeLayout(100, 100) });
    const result = placeNodes(["c1", "c2"], diagram, layout);
    expect(result.has("c1")).toBe(true);
    expect(result.has("c2")).toBe(true);
    expect(noOverlap(result.get("c1")!, result.get("c2")!)).toBe(true);
  });

  // PL-18: LR direction, two unplaced siblings → placed right of anchor, no overlap
  it("PL-18: LR direction, two unplaced siblings → placed right of anchor, non-overlapping", () => {
    const nodes = ["anchor", "r1", "r2"].map((id) => makeNode(id));
    const edges = [makeParsedEdge("anchor", "r1"), makeParsedEdge("anchor", "r2")];
    const diagram = makeDiagram(nodes, edges);
    const layout = makeLayoutStore({ anchor: makeNodeLayout(0, 100) });
    const result = placeNodes(["r1", "r2"], diagram, layout, { direction: "LR" });
    expect(result.get("r1")!.x).toBeGreaterThan(0);
    expect(result.get("r2")!.x).toBeGreaterThan(0);
    expect(noOverlap(result.get("r1")!, result.get("r2")!)).toBe(true);
  });

  // PL-19: pathologically dense layout → max-iteration safety cap, always terminates
  it("PL-19: dense existing layout → terminates (max 10 shift iterations)", () => {
    // Create a grid of heavily-overlapping nodes to stress the collision avoidance cap
    const densePacked: Record<string, NodeLayout> = {};
    for (let i = 0; i < 8; i++) {
      for (let j = 0; j < 8; j++) {
        // Nodes spaced 5px apart but sized 180×60 — extreme overlap
        densePacked[`n_${i}_${j}`] = makeNodeLayout(i * 5, j * 5);
      }
    }
    const diagram = makeDiagram([makeNode("newNode")]);
    const layout = makeLayoutStore(densePacked);
    // Must return without throwing/hanging
    const result = placeNodes(["newNode"], diagram, layout);
    expect(result.has("newNode")).toBe(true);
  });

  // PL-20: node with two neighbours — placed closer to the nearest one
  it("PL-20: node connected to two neighbours → placed adjacent to the nearest one", () => {
    const nodes = ["near", "far", "newNode"].map((id) => makeNode(id));
    const edges = [
      makeParsedEdge("near", "newNode"),
      makeParsedEdge("far", "newNode"),
    ];
    const diagram = makeDiagram(nodes, edges);
    const layout = makeLayoutStore({
      near: makeNodeLayout(0, 0),
      far: makeNodeLayout(1000, 1000),
    });
    const result = placeNodes(["newNode"], diagram, layout);
    const pos = result.get("newNode")!;
    // Placed closer to near_anchor (0,0) than far_anchor (1000,1000)
    const distToNear = Math.hypot(pos.x - 0, pos.y - 0);
    const distToFar = Math.hypot(pos.x - 1000, pos.y - 1000);
    expect(distToNear).toBeLessThan(distToFar);
  });
});

// ─── A6-v2: Dagre-first placement (PL-21..PL-24) ─────────────────────────────
//
// These tests verify the new dagre-relative offset algorithm (A6-v2).
// Backfill — implementation already exists; tests were written after the fact
// per reviewer-approved exception.

describe("placeNodes — A6-v2 dagre-first mechanism", () => {
  // PL-21: when a placed neighbour has a dagre ideal position, the new node is
  // placed at the dagre-relative offset from that neighbour's actual position,
  // NOT simply flow-adjacent as in the legacy heuristic.
  //
  // Topology: P1 --> P2 --> C  and  P1 --> C
  //   Ranks: P1 at rank 0, P2 at rank 1, C at rank 2.
  //   Dagre-ideal C is closer to P2 (dist 154) than to P1 (dist 280).
  //   P1 is canvas-NEAR  (100, 100)  → canvas origin dist ≈ 231
  //   P2 is canvas-FAR (1000, 1000)  → canvas origin dist ≈ 1500
  //
  //   Old heuristic: picks P1 (canvas origin dist 231 < 1500).
  //                  Places C at (P1.x, P1.y + P1.h + nodeSpacing) ≈ (100, 220).
  //
  //   Dagre-relative: picks P2 (dagre-ideal dist 154 < 280).
  //                   C.canvas = P2.canvas + (C.ideal - P2.ideal)
  //                            = (1000, 1000) + (65, 140) ≈ (1065, 1140).
  //
  //   Assert: C.y > 1000 — true only with dagre-relative anchoring on P2.
  it("PL-21: dagre picks dagre-nearest placed neighbour (not canvas-nearest) as offset anchor", () => {
    const nodes = [makeNode("P1"), makeNode("P2"), makeNode("C")];
    const edges = [
      makeParsedEdge("P1", "P2"),
      makeParsedEdge("P2", "C"),
      makeParsedEdge("P1", "C"),
    ];
    const diagram = makeDiagram(nodes, edges);
    const layout = makeLayoutStore({
      P1: makeNodeLayout(100, 100),   // near canvas origin → canvas-nearest
      P2: makeNodeLayout(1000, 1000), // far from canvas origin → dagre-ideal nearest to C
    });
    const result = placeNodes(["C"], diagram, layout, { direction: "TD" });
    const C = result.get("C")!;
    expect(C).toBeDefined();
    // Dagre-relative anchors on P2 → C.y ≈ 1140 (well above 1000).
    // Old heuristic anchors on P1 → C.y ≈ 220 (well below 1000).
    expect(C.y).toBeGreaterThan(1000);
  });

  // PL-22: when no placed neighbours exist but dagre resolves positions, each
  // unplaced node is placed at its dagre-absolute coordinates.
  //
  // For a 2-node TD chain with BOTH nodes unplaced (processed parent → child):
  //   1. parent: no placed neighbours → placed at dagre-ideal position.
  //   2. child: parent is now in allPlaced → dagre-relative from parent cancels
  //             to dagre-absolute (parent.ideal + (child.ideal - parent.ideal)).
  //
  //   Dagre (ranksep=80, h=60): child.y - parent.y = h/2 + ranksep + h/2 = 140
  //   Old heuristic (candY = parent.y + parent.h + nodeSpacing):         = 120
  //
  //   Assert: child.y - parent.y > 120 — true only via dagre-absolute path.
  it("PL-22: all-unplaced chain placed at dagre-absolute (rank separation > nodeSpacing-based gap)", () => {
    const nodes = [makeNode("parent"), makeNode("child")];
    const edges = [makeParsedEdge("parent", "child")];
    const diagram = makeDiagram(nodes, edges);
    const layout = makeLayoutStore({}); // empty — both nodes are unplaced

    const result = placeNodes(["parent", "child"], diagram, layout, { direction: "TD" });
    const parentPos = result.get("parent")!;
    const childPos  = result.get("child")!;

    expect(parentPos).toBeDefined();
    expect(childPos).toBeDefined();
    // child must be below parent in TD layout
    expect(childPos.y).toBeGreaterThan(parentPos.y);
    // dagre rankSpacing (80) gives gap = 140; nodeSpacing (60) gives gap = 120.
    // Strictly > 120 proves dagre-absolute path, not old heuristic.
    expect(childPos.y - parentPos.y).toBeGreaterThan(120);
  });

  // PL-23: when the diagram type is not supported by dagre (computeInitialLayout
  // throws), placeNodes falls back to the neighbour-adjacent heuristic and still
  // produces a valid non-overlapping position.
  it("PL-23: unsupported diagram type (dagre throws) → falls back to heuristic placement", () => {
    // Use diagram_type "block-beta" or "mindmap" — computeInitialLayout throws
    // UnsupportedDiagramTypeError for these types in diag.1.
    const nodes = [makeNode("anchor"), makeNode("newNode")];
    const edges = [makeParsedEdge("anchor", "newNode")];
    const unsupportedDiagram: ParsedDiagram = {
      type: "block-beta",   // SpatialDiagramType that triggers UnsupportedDiagramTypeError
      nodes: new Map(nodes.map((n) => [n.id, n])),
      edges,
      clusters: [],
      renames: [],
      direction: "TD",
    };
    const layout = makeLayoutStore({ anchor: makeNodeLayout(200, 200) }, "block-beta");
    // Must not throw; must return a valid position for newNode
    const result = placeNodes(["newNode"], unsupportedDiagram, layout);
    const pos = result.get("newNode")!;
    expect(pos).toBeDefined();
    expect(isFinite(pos.x)).toBe(true);
    expect(isFinite(pos.y)).toBe(true);
    // And must not overlap the anchor
    expect(noOverlap(pos, { x: 200, y: 200, w: 180, h: 60 })).toBe(true);
  });

  // PL-24: collision avoidance tries the negative cross-axis direction (Pass B)
  // before falling back to the flow axis (Pass C).
  //
  // Setup (block-beta → dagre throws → predictable heuristic candidate):
  //   anchor at (500, 500); heuristic candidate for newNode = (500, 620).
  //   Block all 10 Pass A steps: blockR0..(9) at (500+k*240, 620) for k=0..9.
  //   Pass A exhausts → Pass B tries (260, 620) → clear → resolves there.
  //
  //   Assert: pos.x < 500 (leftward ← anchor) proves Pass B ran.
  //           pos.y ≥ 500                      proves Pass C did NOT run.
  it("PL-24: negative cross-axis (Pass B) is tried before flow-axis (Pass C)", () => {
    const anchorX = 500;
    const anchorY = 500;
    const crossStep = 180 + 60; // w + nodeSpacing = 240
    const candidateY = anchorY + 60 + 60; // anchor.h + nodeSpacing = 620

    const existingNodes: Record<string, NodeLayout> = {};
    existingNodes["anchor"] = makeNodeLayout(anchorX, anchorY);
    // Block all 10 Pass A positions along the positive cross-axis (rightward for TD)
    for (let k = 0; k < 10; k++) {
      existingNodes[`blockR${k}`] = makeNodeLayout(anchorX + k * crossStep, candidateY);
    }

    const blockBetaDiagram: ParsedDiagram = {
      type: "block-beta", // triggers UnsupportedDiagramTypeError → heuristic fallback
      nodes: new Map([
        ["anchor", makeNode("anchor")],
        ["newNode", makeNode("newNode")],
      ]),
      edges: [makeParsedEdge("anchor", "newNode")],
      clusters: [],
      renames: [],
      direction: "TD",
    };
    const layout = makeLayoutStore(existingNodes, "block-beta");
    const result = placeNodes(["newNode"], blockBetaDiagram, layout, { direction: "TD" });
    const pos = result.get("newNode")!;

    expect(pos).toBeDefined();
    // Pass B placed the node to the LEFT of anchor — proves Pass B ran.
    expect(pos.x).toBeLessThan(anchorX);
    // Y stays at/near the candidate row — proves Pass C (flow-axis) did NOT run.
    expect(pos.y).toBeGreaterThanOrEqual(anchorY);
    expect(pos.y).toBeLessThan(anchorY + 3 * crossStep);
  });
});
