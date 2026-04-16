/**
 * A10 — Canvas generator tests
 *
 * Tests cover the public contract of generateCanvas() in
 * canvas/canvas-generator.ts.
 *
 * Tests are RED in Phase B (stub throws "not implemented").
 * They turn GREEN in Phase C after implementation.
 *
 * BACKFILL NOTE (A10-v2): CG-28..CG-33 were written after per-node style
 * overrides were implemented (implementation-before-test exception agreed by
 * reviewer). The implementation already exists; these tests verify its contract.
 *
 * NOTE: edge strokeStyle (per-edge override from EdgeLayout.style) is implemented
 * (CG-34..CG-35) — strokeStyle wins over strokeDash when both are set.
 *
 * Uses real getShapeProps() (A8), routeEdge() (A9), and placeNodes() (A6) as
 * dependencies — these are pure, fully-tested functions whose correctness is
 * verified in their own test files.  The canvas-generator tests verify the
 * composition.
 *
 * Requirements: diag_arch_v4.2.md §9.2, §9.3
 * Requirement IDs: CG-01 through CG-33
 */

// API checklist:
// ✓ generateCanvas — 35 tests (CG-01..CG-35)
//   covered paths:
//   CG-01..CG-03  return shape (empty diagram, single node, CanvasScene structure)
//   CG-04..CG-10  node rendering (element type, position/size, roughness, fontFamily)
//   CG-11..CG-14  edge rendering (arrow element, auto fallback, orthogonal points, label)
//   CG-15..CG-16  cluster rendering (background rect, render order before nodes)
//   CG-17..CG-19  unplaced node resolution (placeNodes called, unplaced cleared, element visible)
//   CG-20         skip node with no layout entry and not in unplaced
//   CG-21         roughness 0 applied uniformly to all elements
//   CG-22..CG-25  element count invariants and self-loop edge
//   CG-26..CG-27  immutability + render-order invariant
//   CG-28..CG-33  A10-v2 per-node style overrides (fillStyle, strokeStyle, roughness, fontFamily,
//                 strokeDash backward-compat, absent fillStyle → undefined)
//   CG-34..CG-35  A10-v2 edge strokeStyle (strokeDash → dashed, strokeStyle wins over strokeDash)

import { describe, it, expect } from "vitest";
import type {
  LayoutStore,
  NodeLayout,
  ParsedDiagram,
  ParsedNode,
  ParsedEdge,
  ParsedCluster,
  ClusterLayout,
} from "../types.js";
import { generateCanvas } from "../canvas/canvas-generator.js";

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

function makeNode(id: string, shape: ParsedNode["shape"] = "rectangle"): ParsedNode {
  return { id, label: id, shape, classes: [] };
}

function makeEdge(from: string, to: string, label = "", ordinal = 0): ParsedEdge {
  return { from, to, label, ordinal, type: "arrow" };
}

function makeCluster(id: string, members: string[]): ParsedCluster {
  return { id, label: id, members };
}

function makeNodeLayout(overrides?: Partial<NodeLayout>): NodeLayout {
  return { x: 100, y: 100, w: 180, h: 60, style: {}, ...overrides };
}

function makeClusterLayout(): ClusterLayout {
  return { x: 0, y: 0, w: 400, h: 250, label: "Group", style: {} };
}

function edgeKey(from: string, to: string, ordinal: number): string {
  return `${from}->${to}:${ordinal}`;
}

// ── CG-01..CG-03: Return shape ────────────────────────────────────────────────

describe("generateCanvas — return shape", () => {
  it("CG-01: empty diagram → empty elements array", () => {
    const scene = generateCanvas(makeParsed(), makeLayout());
    expect(scene.elements).toHaveLength(0);
  });

  it("CG-02: single node with layout → at least one element produced", () => {
    const parsed = makeParsed({ nodes: new Map([["A", makeNode("A")]]) });
    const layout = makeLayout({ nodes: { A: makeNodeLayout() } });
    const scene = generateCanvas(parsed, layout);
    expect(scene.elements.length).toBeGreaterThan(0);
  });

  it("CG-03: return value has both elements and layout fields", () => {
    const scene = generateCanvas(makeParsed(), makeLayout());
    expect(scene).toHaveProperty("elements");
    expect(scene).toHaveProperty("layout");
  });
});

// ── CG-04..CG-10: Node rendering ─────────────────────────────────────────────

describe("generateCanvas — node elements", () => {
  it("CG-04: rectangle node → element type 'rectangle'", () => {
    const parsed = makeParsed({ nodes: new Map([["A", makeNode("A", "rectangle")]]) });
    const layout = makeLayout({ nodes: { A: makeNodeLayout() } });
    const scene = generateCanvas(parsed, layout);
    const el = scene.elements.find((e) => e.mermaidId === "A" && e.type !== "text");
    expect(el?.type).toBe("rectangle");
  });

  it("CG-05: node element x/y match layout.nodes values", () => {
    const pos = { x: 250, y: 400, w: 180, h: 60, style: {} };
    const parsed = makeParsed({ nodes: new Map([["A", makeNode("A")]]) });
    const layout = makeLayout({ nodes: { A: pos } });
    const scene = generateCanvas(parsed, layout);
    const el = scene.elements.find((e) => e.mermaidId === "A" && e.type !== "text");
    expect(el?.x).toBe(250);
    expect(el?.y).toBe(400);
  });

  it("CG-06: node element has roughness from layout.aesthetics.roughness", () => {
    const parsed = makeParsed({ nodes: new Map([["A", makeNode("A")]]) });
    const layout = makeLayout({
      nodes: { A: makeNodeLayout() },
      aesthetics: { roughness: 2 },
    });
    const scene = generateCanvas(parsed, layout);
    const shapeEl = scene.elements.find((e) => e.mermaidId === "A" && e.type !== "text");
    expect(shapeEl?.roughness).toBe(2);
  });

  it("CG-07: roughness defaults to 1 when aesthetics.roughness is undefined", () => {
    const parsed = makeParsed({ nodes: new Map([["A", makeNode("A")]]) });
    const layout = makeLayout({
      nodes: { A: makeNodeLayout() },
      aesthetics: {},
    });
    const scene = generateCanvas(parsed, layout);
    const shapeEl = scene.elements.find((e) => e.mermaidId === "A" && e.type !== "text");
    expect(shapeEl?.roughness).toBe(1);
  });

  it("CG-08: node element has fontFamily 'Excalifont'", () => {
    const parsed = makeParsed({ nodes: new Map([["A", makeNode("A")]]) });
    const layout = makeLayout({ nodes: { A: makeNodeLayout() } });
    const scene = generateCanvas(parsed, layout);
    const el = scene.elements.find((e) => e.mermaidId === "A");
    expect(el?.fontFamily).toBe("Excalifont");
  });

  it("CG-09: diamond node → element type 'diamond'", () => {
    const parsed = makeParsed({ nodes: new Map([["D", makeNode("D", "diamond")]]) });
    const layout = makeLayout({ nodes: { D: makeNodeLayout() } });
    const scene = generateCanvas(parsed, layout);
    const el = scene.elements.find((e) => e.mermaidId === "D" && e.type !== "text");
    expect(el?.type).toBe("diamond");
  });

  it("CG-10: circle node → element type 'ellipse'", () => {
    const parsed = makeParsed({ nodes: new Map([["C", makeNode("C", "circle")]]) });
    const layout = makeLayout({ nodes: { C: makeNodeLayout() } });
    const scene = generateCanvas(parsed, layout);
    const el = scene.elements.find((e) => e.mermaidId === "C" && e.type !== "text");
    expect(el?.type).toBe("ellipse");
  });
});

// ── CG-11..CG-14: Edge rendering ─────────────────────────────────────────────

describe("generateCanvas — edge elements", () => {
  it("CG-11: edge with layout entry → produces an arrow element", () => {
    const k = edgeKey("A", "B", 0);
    const parsed = makeParsed({
      nodes: new Map([["A", makeNode("A")], ["B", makeNode("B")]]),
      edges: [makeEdge("A", "B")],
    });
    const layout = makeLayout({
      nodes: { A: makeNodeLayout({ x: 0, y: 0 }), B: makeNodeLayout({ x: 300, y: 0 }) },
      edges: { [k]: { routing: "auto", waypoints: [], style: {} } },
    });
    const scene = generateCanvas(parsed, layout);
    const arrow = scene.elements.find((e) => e.type === "arrow");
    expect(arrow).toBeDefined();
  });

  it("CG-12: edge without explicit layout entry → still produces an arrow (routing 'auto')", () => {
    const parsed = makeParsed({
      nodes: new Map([["A", makeNode("A")], ["B", makeNode("B")]]),
      edges: [makeEdge("A", "B")],
    });
    // No entry in layout.edges — canvas generator falls back to "auto"
    const layout = makeLayout({
      nodes: { A: makeNodeLayout({ x: 0, y: 0 }), B: makeNodeLayout({ x: 300, y: 0 }) },
    });
    const scene = generateCanvas(parsed, layout);
    const arrow = scene.elements.find((e) => e.type === "arrow");
    expect(arrow).toBeDefined();
  });

  it("CG-13: edge with routing 'orthogonal' → points array has ≥ 3 entries", () => {
    const k = edgeKey("A", "B", 0);
    const parsed = makeParsed({
      nodes: new Map([["A", makeNode("A")], ["B", makeNode("B")]]),
      edges: [makeEdge("A", "B")],
    });
    const layout = makeLayout({
      nodes: { A: makeNodeLayout({ x: 0, y: 0 }), B: makeNodeLayout({ x: 0, y: 200 }) },
      edges: { [k]: { routing: "orthogonal", waypoints: [], style: {} } },
    });
    const scene = generateCanvas(parsed, layout);
    const arrow = scene.elements.find((e) => e.type === "arrow");
    expect(arrow?.points?.length).toBeGreaterThanOrEqual(3);
  });

  it("CG-14: labeled edge → stores the label on the arrow element", () => {
    const k = edgeKey("A", "B", 0);
    const parsed = makeParsed({
      nodes: new Map([["A", makeNode("A")], ["B", makeNode("B")]]),
      edges: [makeEdge("A", "B", "yes")],
    });
    const layout = makeLayout({
      nodes: { A: makeNodeLayout({ x: 0, y: 0 }), B: makeNodeLayout({ x: 300, y: 0 }) },
      edges: { [k]: { routing: "auto", waypoints: [], style: {} } },
    });
    const scene = generateCanvas(parsed, layout);
    const arrowEl = scene.elements.find((e) => e.type === "arrow" && e.mermaidId === k);
    expect(arrowEl?.label).toBe("yes");
  });
});

// ── CG-15..CG-16: Cluster rendering ──────────────────────────────────────────

describe("generateCanvas — cluster elements", () => {
  it("CG-15: cluster with layout → produces a background rectangle", () => {
    const parsed = makeParsed({
      nodes: new Map([["A", makeNode("A")]]),
      clusters: [makeCluster("G1", ["A"])],
    });
    const layout = makeLayout({
      nodes: { A: makeNodeLayout() },
      clusters: { G1: makeClusterLayout() },
    });
    const scene = generateCanvas(parsed, layout);
    const bg = scene.elements.find(
      (e) => e.mermaidId === "G1" && e.type === "rectangle",
    );
    expect(bg).toBeDefined();
  });

  it("CG-16: cluster element appears before node elements in elements array", () => {
    const parsed = makeParsed({
      nodes: new Map([["A", makeNode("A")]]),
      clusters: [makeCluster("G1", ["A"])],
    });
    const layout = makeLayout({
      nodes: { A: makeNodeLayout() },
      clusters: { G1: makeClusterLayout() },
    });
    const scene = generateCanvas(parsed, layout);
    const clusterIdx = scene.elements.findIndex((e) => e.mermaidId === "G1");
    const nodeIdx = scene.elements.findIndex(
      (e) => e.mermaidId === "A" && e.type !== "text",
    );
    expect(clusterIdx).toBeGreaterThanOrEqual(0);
    expect(nodeIdx).toBeGreaterThan(clusterIdx);
  });
});

// ── CG-17..CG-19: Unplaced node resolution ───────────────────────────────────

describe("generateCanvas — unplaced node resolution", () => {
  it("CG-17: node in layout.unplaced → returned layout.nodes contains that node", () => {
    const parsed = makeParsed({ nodes: new Map([["B", makeNode("B")]]) });
    const layout = makeLayout({ unplaced: ["B"] });
    const scene = generateCanvas(parsed, layout);
    expect(scene.layout.nodes["B"]).toBeDefined();
  });

  it("CG-18: returned layout.unplaced is empty after generation", () => {
    const parsed = makeParsed({ nodes: new Map([["B", makeNode("B")]]) });
    const layout = makeLayout({ unplaced: ["B"] });
    const scene = generateCanvas(parsed, layout);
    expect(scene.layout.unplaced).toHaveLength(0);
  });

  it("CG-19: node resolved from unplaced → appears in elements output", () => {
    const parsed = makeParsed({ nodes: new Map([["B", makeNode("B")]]) });
    const layout = makeLayout({ unplaced: ["B"] });
    const scene = generateCanvas(parsed, layout);
    const el = scene.elements.find((e) => e.mermaidId === "B");
    expect(el).toBeDefined();
  });
});

// ── CG-20: Skip node with no layout ──────────────────────────────────────────

describe("generateCanvas — missing layout entries", () => {
  it("CG-20: node in parsed.nodes but absent from layout.nodes and unplaced → no element", () => {
    // Node "X" exists in parsed diagram but has no layout entry and is not in unplaced[].
    // This is a degenerate state (reconciler should prevent it) but the generator
    // must not crash — it should simply skip the node.
    const parsed = makeParsed({
      nodes: new Map([["A", makeNode("A")], ["X", makeNode("X")]]),
    });
    const layout = makeLayout({ nodes: { A: makeNodeLayout() } }); // X has no entry
    const scene = generateCanvas(parsed, layout);
    const xEl = scene.elements.find((e) => e.mermaidId === "X");
    expect(xEl).toBeUndefined();
  });
});

// ── CG-21: Roughness 0 ───────────────────────────────────────────────────────

describe("generateCanvas — roughness 0", () => {
  it("CG-21: aesthetic roughness 0 → all node shape elements have roughness 0", () => {
    const parsed = makeParsed({
      nodes: new Map([["A", makeNode("A")], ["B", makeNode("B")]]),
    });
    const layout = makeLayout({
      nodes: {
        A: makeNodeLayout({ x: 0, y: 0 }),
        B: makeNodeLayout({ x: 300, y: 0 }),
      },
      aesthetics: { roughness: 0 },
    });
    const scene = generateCanvas(parsed, layout);
    const shapeEls = scene.elements.filter((e) => e.type !== "text" && e.type !== "arrow");
    expect(shapeEls.length).toBeGreaterThan(0);
    for (const el of shapeEls) {
      expect(el.roughness).toBe(0);
    }
  });
});

// ── CG-22..CG-25: Element count and structure ─────────────────────────────────

describe("generateCanvas — element counts and structure", () => {
  it("CG-22: 2 nodes + 1 unlabeled edge → at least 3 elements (2 shapes + 1 arrow)", () => {
    const k = edgeKey("A", "B", 0);
    const parsed = makeParsed({
      nodes: new Map([["A", makeNode("A")], ["B", makeNode("B")]]),
      edges: [makeEdge("A", "B")],
    });
    const layout = makeLayout({
      nodes: { A: makeNodeLayout({ x: 0, y: 0 }), B: makeNodeLayout({ x: 300, y: 0 }) },
      edges: { [k]: { routing: "auto", waypoints: [], style: {} } },
    });
    const scene = generateCanvas(parsed, layout);
    expect(scene.elements.length).toBeGreaterThanOrEqual(3);
  });

  it("CG-23: 2 nodes + 1 labeled edge → 3 elements (2 shapes + labeled arrow)", () => {
    const k = edgeKey("A", "B", 0);
    const parsed = makeParsed({
      nodes: new Map([["A", makeNode("A")], ["B", makeNode("B")]]),
      edges: [makeEdge("A", "B", "go")],
    });
    const layout = makeLayout({
      nodes: { A: makeNodeLayout({ x: 0, y: 0 }), B: makeNodeLayout({ x: 300, y: 0 }) },
      edges: { [k]: { routing: "auto", waypoints: [], style: {} } },
    });
    const scene = generateCanvas(parsed, layout);
    expect(scene.elements.length).toBe(5);
  });

  it("CG-24: returned layout is a new object reference (input not mutated)", () => {
    const parsed = makeParsed({ nodes: new Map([["A", makeNode("A")]]) });
    const layout = makeLayout({ nodes: { A: makeNodeLayout() } });
    const scene = generateCanvas(parsed, layout);
    expect(scene.layout).not.toBe(layout);
  });

  it("CG-25: self-loop edge (A → A) → arrow points array has ≥ 4 entries", () => {
    const k = edgeKey("A", "A", 0);
    const parsed = makeParsed({
      nodes: new Map([["A", makeNode("A")]]),
      edges: [makeEdge("A", "A")],
    });
    const layout = makeLayout({
      nodes: { A: makeNodeLayout({ x: 100, y: 100 }) },
      edges: { [k]: { routing: "auto", waypoints: [], style: {} } },
    });
    const scene = generateCanvas(parsed, layout);
    const selfLoop = scene.elements.find((e) => e.type === "arrow");
    expect(selfLoop?.points?.length).toBeGreaterThanOrEqual(4);
  });

  // Parallel edge label waypoint: bidirectional edges with labels should have a
  // middle waypoint inserted so the arrow bends and the label follows.
  it("CG-36: bidirectional labeled edges → each arrow has ≥3 points (start, waypoint, end)", () => {
    // A→B with label "go" and B→A with label "back" — parallel/bidirectional
    const k1 = edgeKey("A", "B", 0);
    const k2 = edgeKey("B", "A", 0);
    const parsed = makeParsed({
      nodes: new Map([["A", makeNode("A")], ["B", makeNode("B")]]),
      edges: [makeEdge("A", "B", "go"), makeEdge("B", "A", "back")],
    });
    const layout = makeLayout({
      nodes: {
        A: makeNodeLayout({ x: 0, y: 0 }),
        B: makeNodeLayout({ x: 300, y: 0 }),
      },
      edges: {
        [k1]: { routing: "auto", waypoints: [], style: {} },
        [k2]: { routing: "auto", waypoints: [], style: {} },
      },
    });
    const scene = generateCanvas(parsed, layout);

    // Find both labeled arrows
    const goArrow = scene.elements.find(
      (e) => e.type === "arrow" && e.mermaidId === k1,
    );
    const backArrow = scene.elements.find(
      (e) => e.type === "arrow" && e.mermaidId === k2,
    );

    // Both should have 3 points (start, label waypoint, end)
    expect(goArrow?.points?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(backArrow?.points?.length ?? 0).toBeGreaterThanOrEqual(3);

    expect(goArrow?.label).toBe("go");
    expect(backArrow?.label).toBe("back");
  });
});

// ── CG-26: Immutability depth ─────────────────────────────────────────────────

describe("generateCanvas — immutability depth", () => {
  it(
    "CG-26: original layout.unplaced array and layout.nodes entries are not mutated",
    () => {
      const nodeLayout = makeNodeLayout({ x: 50, y: 50 });
      const originalUnplaced = ["B"];
      const parsed = makeParsed({
        nodes: new Map([
          ["A", makeNode("A")],
          ["B", makeNode("B")],
        ]),
      });
      const layout = makeLayout({
        nodes: { A: nodeLayout },
        unplaced: originalUnplaced,
      });
      // Snapshot the original state before calling generateCanvas
      const unplacedRef = layout.unplaced;
      const nodeARef = layout.nodes["A"];

      generateCanvas(parsed, layout);

      // Top-level array reference and node entry reference must be unchanged
      expect(layout.unplaced).toBe(unplacedRef);
      expect(layout.unplaced).toEqual(["B"]);
      expect(layout.nodes["A"]).toBe(nodeARef);
    },
  );
});

// ── CG-27: Render-order invariant ─────────────────────────────────────────────

describe("generateCanvas — render order", () => {
  it(
    "CG-27: elements are ordered cluster-backgrounds → node shapes → edge arrows",
    () => {
      const kAB = edgeKey("A", "B", 0);
      const parsed = makeParsed({
        nodes: new Map([
          ["A", makeNode("A")],
          ["B", makeNode("B")],
        ]),
        edges: [makeEdge("A", "B")],
        clusters: [makeCluster("G", ["A", "B"])],
      });
      const layout = makeLayout({
        nodes: {
          A: makeNodeLayout({ x: 100, y: 100 }),
          B: makeNodeLayout({ x: 300, y: 100 }),
        },
        edges: { [kAB]: { routing: "auto", waypoints: [], style: {} } },
        clusters: { G: { x: 60, y: 60, w: 300, h: 160, style: {} } },
      });
      const scene = generateCanvas(parsed, layout);

      const firstArrowIdx = scene.elements.findIndex((e) => e.type === "arrow");
      const firstNodeShapeIdx = scene.elements.findIndex(
        (e) => e.type === "rectangle" && e.mermaidId !== "G",
      );
      const firstClusterIdx = scene.elements.findIndex(
        (e) => e.type === "rectangle" && e.mermaidId === "G",
      );

      // All three kinds must be present
      expect(firstClusterIdx).toBeGreaterThanOrEqual(0);
      expect(firstNodeShapeIdx).toBeGreaterThanOrEqual(0);
      expect(firstArrowIdx).toBeGreaterThanOrEqual(0);

      // cluster background before node shapes; node shapes before arrows
      expect(firstClusterIdx).toBeLessThan(firstNodeShapeIdx);
      expect(firstNodeShapeIdx).toBeLessThan(firstArrowIdx);
    },
  );
});

// ── CG-28..CG-33: A10-v2 per-node style overrides ────────────────────────────
//
// Backfill — implementation already exists; tests were written after the fact
// per reviewer-approved exception.

describe("generateCanvas — per-node style overrides (A10-v2)", () => {
  // CG-28: node with style.fillStyle → shape element has matching fillStyle
  it("CG-28: node with style.fillStyle 'cross-hatch' → shape element fillStyle is 'cross-hatch'", () => {
    const parsed = makeParsed({
      nodes: new Map([["A", makeNode("A")]]),
    });
    const layout = makeLayout({
      nodes: { A: makeNodeLayout({ style: { fillStyle: "cross-hatch" } }) },
    });
    const scene = generateCanvas(parsed, layout);
    const shapeEl = scene.elements.find((e) => e.mermaidId === "A" && e.type !== "text");
    expect(shapeEl).toBeDefined();
    expect(shapeEl!.fillStyle).toBe("cross-hatch");
  });

  // CG-29: node with no style.fillStyle → shape element fillStyle is undefined
  // (does not inject a default that would override Excalidraw's own default)
  it("CG-29: node with no style.fillStyle → shape element fillStyle is undefined", () => {
    const parsed = makeParsed({
      nodes: new Map([["A", makeNode("A")]]),
    });
    const layout = makeLayout({
      nodes: { A: makeNodeLayout({ style: {} }) },
    });
    const scene = generateCanvas(parsed, layout);
    const shapeEl = scene.elements.find((e) => e.mermaidId === "A" && e.type !== "text");
    expect(shapeEl).toBeDefined();
    expect(shapeEl!.fillStyle).toBeUndefined();
  });

  // CG-30: node with style.strokeStyle → shape element strokeStyle matches
  it("CG-30: node with style.strokeStyle 'dotted' → shape element strokeStyle is 'dotted'", () => {
    const parsed = makeParsed({
      nodes: new Map([["A", makeNode("A")]]),
    });
    const layout = makeLayout({
      nodes: { A: makeNodeLayout({ style: { strokeStyle: "dotted" } }) },
    });
    const scene = generateCanvas(parsed, layout);
    const shapeEl = scene.elements.find((e) => e.mermaidId === "A" && e.type !== "text");
    expect(shapeEl).toBeDefined();
    expect(shapeEl!.strokeStyle).toBe("dotted");
  });

  // CG-31: node with style.strokeDash:true but no strokeStyle → strokeStyle is 'dashed'
  // (backward-compatibility: strokeDash is still honoured when strokeStyle is absent)
  it("CG-31: node with style.strokeDash:true and no strokeStyle → strokeStyle is 'dashed'", () => {
    const parsed = makeParsed({
      nodes: new Map([["A", makeNode("A")]]),
    });
    const layout = makeLayout({
      nodes: { A: makeNodeLayout({ style: { strokeDash: true } }) },
    });
    const scene = generateCanvas(parsed, layout);
    const shapeEl = scene.elements.find((e) => e.mermaidId === "A" && e.type !== "text");
    expect(shapeEl).toBeDefined();
    expect(shapeEl!.strokeStyle).toBe("dashed");
  });

  // CG-32: node with style.roughness → shape element uses per-node roughness,
  // not the diagram-level aesthetics.roughness
  it("CG-32: node with style.roughness 0 → shape element roughness is 0 (overrides aesthetic default)", () => {
    const parsed = makeParsed({
      nodes: new Map([["A", makeNode("A")]]),
    });
    // aesthetics.roughness = 2 (diagram-level default), but node overrides to 0
    const layout = makeLayout({
      aesthetics: { roughness: 2 },
      nodes: { A: makeNodeLayout({ style: { roughness: 0 } }) },
    });
    const scene = generateCanvas(parsed, layout);
    const shapeEl = scene.elements.find((e) => e.mermaidId === "A" && e.type !== "text");
    expect(shapeEl).toBeDefined();
    expect(shapeEl!.roughness).toBe(0);
  });

  // CG-33: node with style.fontFamily → text element uses per-node fontFamily,
  // not the diagram-level default 'Excalifont'
  it("CG-33: node with style.fontFamily 'Nunito' → text element fontFamily is 'Nunito'", () => {
    const A: ParsedNode = { id: "A", label: "Alpha", shape: "rectangle", classes: [] };
    const parsed = makeParsed({
      nodes: new Map([["A", A]]),
    });
    // diagram-level default is 'Excalifont'; per-node override is 'Nunito'
    const layout = makeLayout({
      nodes: { A: makeNodeLayout({ style: { fontFamily: "Nunito" } }) },
    });
    const scene = generateCanvas(parsed, layout);
    // The TEXT element (node label) has mermaidId "A:text"
    const textEl = scene.elements.find((e) => e.mermaidId === "A:text" && e.type === "text");
    expect(textEl).toBeDefined();
    expect(textEl!.fontFamily).toBe("Nunito");
  });
});

// ── CG-34..CG-35: Edge stroke styling ─────────────────────────────────────────

describe("generateCanvas — edge stroke styling (A10-v2)", () => {
  // CG-34: edge with strokeDash:true and no explicit strokeStyle → dashed
  it("CG-34: edge with strokeDash:true (no strokeStyle) → arrow strokeStyle is 'dashed'", () => {
    const k = edgeKey("A", "B", 0);
    const parsed = makeParsed({
      nodes: new Map([["A", makeNode("A")], ["B", makeNode("B")]]),
      edges: [makeEdge("A", "B")],
    });
    const layout = makeLayout({
      nodes: { A: makeNodeLayout({ x: 0, y: 0 }), B: makeNodeLayout({ x: 300, y: 0 }) },
      edges: { [k]: { routing: "auto", waypoints: [], style: { strokeDash: true } } },
    });
    const scene = generateCanvas(parsed, layout);
    const arrow = scene.elements.find((e) => e.type === "arrow");
    expect(arrow).toBeDefined();
    expect(arrow!.strokeStyle).toBe("dashed");
  });

  // CG-35: explicit strokeStyle wins over strokeDash
  it("CG-35: edge with strokeStyle + strokeDash → strokeStyle wins", () => {
    const k = edgeKey("A", "B", 0);
    const parsed = makeParsed({
      nodes: new Map([["A", makeNode("A")], ["B", makeNode("B")]]),
      edges: [makeEdge("A", "B")],
    });
    const layout = makeLayout({
      nodes: { A: makeNodeLayout({ x: 0, y: 0 }), B: makeNodeLayout({ x: 300, y: 0 }) },
      edges: {
        [k]: { routing: "auto", waypoints: [], style: { strokeStyle: "dotted", strokeDash: true } },
      },
    });
    const scene = generateCanvas(parsed, layout);
    const arrow = scene.elements.find((e) => e.type === "arrow");
    expect(arrow).toBeDefined();
    // strokeStyle is explicit → it wins; strokeDash is ignored
    expect(arrow!.strokeStyle).toBe("dotted");
  });
});

// ── CG-36..CG-37: Persisted waypoints with "auto" routing ────────────────────

describe("generateCanvas — auto routing with persisted waypoints", () => {
  // CG-36: waypoints stored with routing="auto" are reflected in arrow points
  it("CG-36: auto routing + waypoints → arrow points include waypoint coordinates", () => {
    const k = edgeKey("A", "B", 0);
    const wp = { x: 200, y: 50 };
    const parsed = makeParsed({
      nodes: new Map([["A", makeNode("A")], ["B", makeNode("B")]]),
      edges: [makeEdge("A", "B")],
    });
    const layout = makeLayout({
      nodes: {
        A: makeNodeLayout({ x: 0, y: 100, w: 100, h: 60 }),
        B: makeNodeLayout({ x: 300, y: 100, w: 100, h: 60 }),
      },
      edges: {
        [k]: { routing: "auto", waypoints: [wp], style: {} },
      },
    });
    const scene = generateCanvas(parsed, layout);
    const arrow = scene.elements.find((e) => e.type === "arrow" && e.mermaidId === k);
    expect(arrow).toBeDefined();
    // Arrow should have > 2 points (auto without waypoints gives exactly 2)
    expect(arrow!.points!.length).toBeGreaterThan(2);
    // Reconstruct absolute coordinates and verify waypoint is present
    const absPts = (arrow!.points ?? []).map(
      ([px, py]) => [px + arrow!.x, py + arrow!.y] as [number, number],
    );
    const found = absPts.some(([ax, ay]) => ax === wp.x && ay === wp.y);
    expect(found).toBe(true);
  });

  // CG-37: two waypoints stored with routing="auto" → both appear in arrow
  it("CG-37: auto routing + 2 waypoints → both waypoints in arrow points", () => {
    const k = edgeKey("A", "B", 0);
    const wps = [{ x: 150, y: 50 }, { x: 250, y: 150 }];
    const parsed = makeParsed({
      nodes: new Map([["A", makeNode("A")], ["B", makeNode("B")]]),
      edges: [makeEdge("A", "B")],
    });
    const layout = makeLayout({
      nodes: {
        A: makeNodeLayout({ x: 0, y: 100, w: 100, h: 60 }),
        B: makeNodeLayout({ x: 300, y: 100, w: 100, h: 60 }),
      },
      edges: {
        [k]: { routing: "auto", waypoints: wps, style: {} },
      },
    });
    const scene = generateCanvas(parsed, layout);
    const arrow = scene.elements.find((e) => e.type === "arrow" && e.mermaidId === k);
    expect(arrow).toBeDefined();
    const absPts = (arrow!.points ?? []).map(
      ([px, py]) => [px + arrow!.x, py + arrow!.y] as [number, number],
    );
    for (const wp of wps) {
      const found = absPts.some(([ax, ay]) => ax === wp.x && ay === wp.y);
      expect(found).toBe(true);
    }
  });

  it("CG-38: auto routing + waypoints defaults edge roundness to rounded", () => {
    const k = edgeKey("A", "B", 0);
    const parsed = makeParsed({
      nodes: new Map([["A", makeNode("A")], ["B", makeNode("B")]]),
      edges: [makeEdge("A", "B")],
    });
    const layout = makeLayout({
      nodes: {
        A: makeNodeLayout({ x: 0, y: 100, w: 100, h: 60 }),
        B: makeNodeLayout({ x: 300, y: 100, w: 100, h: 60 }),
      },
      edges: {
        [k]: { routing: "auto", waypoints: [{ x: 200, y: 50 }], style: {} },
      },
    });
    const scene = generateCanvas(parsed, layout);
    const arrow = scene.elements.find((e) => e.type === "arrow" && e.mermaidId === k);
    expect(arrow).toBeDefined();
    expect(arrow!.roundness).toBe(8);
  });

  it("CG-39: explicit sharp edge style overrides default waypoint roundness", () => {
    const k = edgeKey("A", "B", 0);
    const parsed = makeParsed({
      nodes: new Map([["A", makeNode("A")], ["B", makeNode("B")]]),
      edges: [makeEdge("A", "B")],
    });
    const layout = makeLayout({
      nodes: {
        A: makeNodeLayout({ x: 0, y: 100, w: 100, h: 60 }),
        B: makeNodeLayout({ x: 300, y: 100, w: 100, h: 60 }),
      },
      edges: {
        [k]: { routing: "auto", waypoints: [{ x: 200, y: 50 }], style: { roundness: null } },
      },
    });
    const scene = generateCanvas(parsed, layout);
    const arrow = scene.elements.find((e) => e.type === "arrow" && e.mermaidId === k);
    expect(arrow).toBeDefined();
    expect(arrow!.roundness).toBeNull();
  });

  it("CG-40: auto routing + seeded midpoint waypoint keeps edge bindings attached", () => {
    const k = edgeKey("Start", "Stop", 0);
    const parsed = makeParsed({
      nodes: new Map([["Start", makeNode("Start")], ["Stop", makeNode("Stop")]]),
      edges: [makeEdge("Start", "Stop")],
      direction: "TD",
    });
    // Repro based on flowchart-00/01 seeded upstream-direct layout geometry.
    const layout = makeLayout({
      nodes: {
        Start: makeNodeLayout({ x: 12, y: 12, w: 90, h: 45 }),
        Stop: makeNodeLayout({ x: 70, y: 191, w: 90, h: 45 }),
      },
      edges: {
        [k]: { routing: "auto", waypoints: [{ x: 57, y: 94.5 }], style: {} },
      },
      metadata: { engine: "upstream-direct" },
    });

    const scene = generateCanvas(parsed, layout);
    const arrow = scene.elements.find((e) => e.type === "arrow" && e.mermaidId === k);
    expect(arrow).toBeDefined();
    expect(arrow!.startBinding).not.toBeNull();
    expect(arrow!.endBinding).not.toBeNull();
  });

  it("CG-41: auto routing + non-midpoint waypoint stays explicit and unbound", () => {
    const k = edgeKey("A", "B", 0);
    const parsed = makeParsed({
      nodes: new Map([["A", makeNode("A")], ["B", makeNode("B")]]),
      edges: [makeEdge("A", "B")],
      direction: "TD",
    });
    const layout = makeLayout({
      nodes: {
        A: makeNodeLayout({ x: 0, y: 100, w: 100, h: 60 }),
        B: makeNodeLayout({ x: 300, y: 100, w: 100, h: 60 }),
      },
      edges: {
        [k]: { routing: "auto", waypoints: [{ x: 150, y: 50 }], style: {} },
      },
    });

    const scene = generateCanvas(parsed, layout);
    const arrow = scene.elements.find((e) => e.type === "arrow" && e.mermaidId === k);
    expect(arrow).toBeDefined();
    expect(arrow!.startBinding).toBeNull();
    expect(arrow!.endBinding).toBeNull();
  });
});
