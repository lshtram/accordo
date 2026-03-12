/**
 * A10 — Canvas generator tests
 *
 * Tests cover the public contract of generateCanvas() in
 * canvas/canvas-generator.ts.
 *
 * Tests are RED in Phase B (stub throws "not implemented").
 * They turn GREEN in Phase C after implementation.
 *
 * Uses real getShapeProps() (A8), routeEdge() (A9), and placeNodes() (A6) as
 * dependencies — these are pure, fully-tested functions whose correctness is
 * verified in their own test files.  The canvas-generator tests verify the
 * composition.
 *
 * Requirements: diag_arch_v4.2.md §9.2, §9.3
 * Requirement IDs: CG-01 through CG-25
 */

// API checklist:
// ✓ generateCanvas — 25 tests (CG-01..CG-25)
//   covered paths:
//   CG-01..CG-03  return shape (empty diagram, single node, CanvasScene structure)
//   CG-04..CG-10  node rendering (element type, position/size, roughness, fontFamily)
//   CG-11..CG-14  edge rendering (arrow element, auto fallback, orthogonal points, label)
//   CG-15..CG-16  cluster rendering (background rect, render order before nodes)
//   CG-17..CG-19  unplaced node resolution (placeNodes called, unplaced cleared, element visible)
//   CG-20         skip node with no layout entry and not in unplaced
//   CG-21         roughness 0 applied uniformly to all elements
//   CG-22..CG-25  element count invariants and self-loop edge

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

  it("CG-14: labeled edge → produces a text element carrying the label", () => {
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
    const labelEl = scene.elements.find((e) => e.type === "text" && e.label === "yes");
    expect(labelEl).toBeDefined();
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

  it("CG-23: 2 nodes + 1 labeled edge → at least 4 elements (2 shapes + arrow + text)", () => {
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
    expect(scene.elements.length).toBeGreaterThanOrEqual(4);
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
