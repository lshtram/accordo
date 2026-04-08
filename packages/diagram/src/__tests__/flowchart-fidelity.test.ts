/**
 * FC-01, FC-02, FC-03, FC-04 — Flowchart Fidelity Batch 1 Tests
 *
 * Tests for visual defect fixes in flowchart rendering:
 *   FC-01: Trapezoid orientation matches Mermaid convention (Cases 12, 13)
 *   FC-02: Circle nodes render as true circles (Case 14)
 *   FC-03: Edge label text preserved through rendering (Cases 16, 17, 19, 21)
 *   FC-04: Cross (`--x`) arrowhead maps to "bar" (Case 29)
 *
 * FC-05 is covered in decode-html.test.ts
 *
 * All tests are RED in Phase B (stubs throw "not implemented" or
 * assertions fail against current buggy implementation).
 * They turn GREEN in Phase C after implementation.
 *
 * Requirements: docs/20-requirements/requirements-diagram-fidelity.md (FC-01..FC-05)
 *
 * API checklist:
 *   FC-01a,b  buildCompositeElements trapezoid/trapezoid_alt polygon geometry — 4 tests
 *   FC-02a    circle shape → width === height — 1 test
 *   FC-02b    circle uses Math.max(layout.w, layout.h) — 1 test
 *   FC-02c    ellipse NOT affected by circle enforcement — 1 test
 *   FC-03a    non-empty edge label appears on arrow element — 1 test
 *   FC-03b    empty-string edge label → no label element — 1 test
 *   FC-03c    HTML-encoded edge label decoded in rendered arrow — 1 test
 *   FC-04a    --x maps to arrowheadEnd "bar" in ParsedEdge — 1 test
 *   FC-04b    x--x maps to both arrowheads "bar" — 1 test
 *   FC-04c    arrowhead values flow through to ExcalidrawElement — 2 tests
 *   FC-05f,g  flowchart labels decoded — 2 tests (here, end-to-end)
 */

import { describe, it, expect } from "vitest";
import { generateCanvas } from "../canvas/canvas-generator.js";
import { parseFlowchart } from "../parser/flowchart.js";
import { decodeHtmlEntities } from "../parser/decode-html.js";
import type {
  LayoutStore,
  NodeLayout,
  ParsedDiagram,
  ParsedNode,
  ParsedEdge,
} from "../types.js";

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

function makeEdge(
  from: string,
  to: string,
  label = "",
  arrowheadStart?: string | null,
  arrowheadEnd?: string | null,
): ParsedEdge {
  return {
    from,
    to,
    label,
    ordinal: 0,
    type: "arrow",
    ...(arrowheadStart !== undefined ? { arrowheadStart: arrowheadStart as ParsedEdge["arrowheadStart"] } : {}),
    ...(arrowheadEnd !== undefined ? { arrowheadEnd: arrowheadEnd as ParsedEdge["arrowheadEnd"] } : {}),
  };
}

function makeNodeLayout(overrides?: Partial<NodeLayout>): NodeLayout {
  return { x: 100, y: 100, w: 180, h: 60, style: {}, ...overrides };
}

function edgeKey(from: string, to: string, ordinal: number): string {
  return `${from}->${to}:${ordinal}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// FC-01: Trapezoid orientation
//
// Mermaid convention:
//   [/text\]  → trapezoid       → wider at BOTTOM, narrower at TOP
//   [\text/] → inv_trapezoid → wider at TOP, narrower at BOTTOM
//
// Defect: geometry cases in buildCompositeElements() are swapped.
// Current (buggy): case "trapezoid" produces wider-at-top polygon
//                 case "trapezoid_alt" produces wider-at-bottom polygon
// Correct:       case "trapezoid" produces wider-at-BOTTOM polygon
//                 case "trapezoid_alt" produces wider-at-TOP polygon
//
// We test by inspecting the polygon points on the main line element.
// For trapezoid (wider at bottom): bottom edge length > top edge length
// For trapezoid_alt (wider at top): top edge length > bottom edge length
// ─────────────────────────────────────────────────────────────────────────────

describe("FC-01: Trapezoid orientation", () => {
  // FC-01a: [/text\] (trapezoid) → wider at bottom, narrower at top
  it("FC-01a: trapezoid shape → polygon bottom edge longer than top edge", () => {
    // trapezoid shape is composite → rendered via buildCompositeElements
    const parsed = makeParsed({
      nodes: new Map([["A", makeNode("A", "trapezoid")]]),
    });
    // Use known dimensions so we can compute expected edge lengths
    const layout = makeLayout({
      nodes: { A: makeNodeLayout({ w: 180, h: 60 }) },
    });
    const scene = generateCanvas(parsed, layout);

    // The polygon is a single "line" type element with 5 points (closed path).
    // Length assertion narrows the tuple type so indexed access is provably safe.
    const polyEl = scene.elements.find(
      (e) => e.mermaidId === "A" && e.type === "line",
    );
    expect(polyEl).toBeDefined();
    expect(polyEl!.points).toBeDefined(); // ! safe: confirmed defined above
    const pts = polyEl!.points!; // ! safe: confirmed defined above
    expect(pts.length).toBe(5); // 4 corners + closing point; narrows tuple for safe indexed access

    // pts[0]=top-left, pts[1]=top-right, pts[2]=bottom-right, pts[3]=bottom-left, pts[4]=closing
    const [tl, tr, br, bl] = pts;
    const topEdgeLen = Math.sqrt(Math.pow(tr[0] - tl[0], 2) + Math.pow(tr[1] - tl[1], 2));
    const bottomEdgeLen = Math.sqrt(Math.pow(br[0] - bl[0], 2) + Math.pow(br[1] - bl[1], 2));

    // For wider-at-bottom trapezoid: bottom > top
    expect(bottomEdgeLen).toBeGreaterThan(topEdgeLen);
  });

  // FC-01b: [\text/] (inv_trapezoid) → wider at top, narrower at bottom
  it("FC-01b: inv_trapezoid shape → polygon top edge longer than bottom edge", () => {
    const parsed = makeParsed({
      nodes: new Map([["B", makeNode("B", "trapezoid_alt")]]),
    });
    const layout = makeLayout({
      nodes: { B: makeNodeLayout({ w: 180, h: 60 }) },
    });
    const scene = generateCanvas(parsed, layout);

    const polyEl = scene.elements.find(
      (e) => e.mermaidId === "B" && e.type === "line",
    );
    expect(polyEl).toBeDefined();
    expect(polyEl!.points).toBeDefined(); // ! safe: confirmed defined above
    const pts = polyEl!.points!; // ! safe: confirmed defined above
    expect(pts.length).toBe(5); // narrows tuple for safe indexed access

    const [tl, tr, br, bl] = pts;
    const topEdgeLen = Math.sqrt(Math.pow(tr[0] - tl[0], 2) + Math.pow(tr[1] - tl[1], 2));
    const bottomEdgeLen = Math.sqrt(Math.pow(br[0] - bl[0], 2) + Math.pow(br[1] - bl[1], 2));

    // For wider-at-top inv_trapezoid: top > bottom
    expect(topEdgeLen).toBeGreaterThan(bottomEdgeLen);
  });

  // FC-01c: Existing tests are unaffected — no regressions
  it("FC-01c: parallelogram still renders (not affected by trapezoid swap)", () => {
    const parsed = makeParsed({
      nodes: new Map([["P", makeNode("P", "parallelogram")]]),
    });
    const layout = makeLayout({
      nodes: { P: makeNodeLayout({ w: 180, h: 60 }) },
    });
    const scene = generateCanvas(parsed, layout);
    const polyEl = scene.elements.find(
      (e) => e.mermaidId === "P" && e.type === "line",
    );
    expect(polyEl).toBeDefined();
    // parallelogram is unaffected — just ensure it still produces a polygon
    expect(polyEl!.points).toHaveLength(5); // ! safe: confirmed defined above; 4 pts + closing pt
  });

  it("FC-01c.2: parallelogram_alt still renders (not affected by trapezoid swap)", () => {
    const parsed = makeParsed({
      nodes: new Map([["Q", makeNode("Q", "parallelogram_alt")]]),
    });
    const layout = makeLayout({
      nodes: { Q: makeNodeLayout({ w: 180, h: 60 }) },
    });
    const scene = generateCanvas(parsed, layout);
    const polyEl = scene.elements.find(
      (e) => e.mermaidId === "Q" && e.type === "line",
    );
    expect(polyEl).toBeDefined();
    expect(polyEl!.points).toHaveLength(5); // ! safe: confirmed defined above
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FC-02: Circle nodes render as true circles
//
// Defect: layout w/h diverge, causing circles to become ovals.
// Fix: enforce width === height using Math.max(nl.w, nl.h) for circle shape.
// ─────────────────────────────────────────────────────────────────────────────

describe("FC-02: Circle → true circle (not oval)", () => {
  // FC-02a: Circle node → ExcalidrawElement has width === height
  it("FC-02a: circle node → element width equals height", () => {
    const parsed = makeParsed({
      nodes: new Map([["C", makeNode("C", "circle")]]),
    });
    const layout = makeLayout({
      nodes: { C: makeNodeLayout({ w: 100, h: 60 }) }, // unequal w/h — layout may differ
    });
    const scene = generateCanvas(parsed, layout);

    const circleEl = scene.elements.find(
      (e) => e.mermaidId === "C" && e.type === "ellipse",
    );
    expect(circleEl).toBeDefined();
    expect(circleEl!.width).toBe(circleEl!.height); // ! safe: confirmed defined above
  });

  // FC-02b: Enforced dimension uses the larger of layout w/h
  // so the circle fully contains the text label
  it("FC-02b: circle with unequal layout w/h → enforced dimension is Math.max(w, h)", () => {
    const parsed = makeParsed({
      nodes: new Map([["D", makeNode("D", "circle")]]),
    });
    // Layout provides 90×60 (width > height)
    const layout = makeLayout({
      nodes: { D: makeNodeLayout({ w: 90, h: 60 }) },
    });
    const scene = generateCanvas(parsed, layout);

    const circleEl = scene.elements.find(
      (e) => e.mermaidId === "D" && e.type === "ellipse",
    );
    expect(circleEl).toBeDefined();
    // Enforced size should be the larger dimension (90)
    expect(circleEl!.width).toBe(90); // ! safe: confirmed defined above
    expect(circleEl!.height).toBe(90); // ! safe: confirmed defined above
  });

  // FC-02c: Other ellipse-mapped shapes (e.g. ellipse, cylinder) are NOT affected
  it("FC-02c: ellipse shape → independent w/h from layout (not clamped to max)", () => {
    const parsed = makeParsed({
      nodes: new Map([["E", makeNode("E", "ellipse")]]),
    });
    const layout = makeLayout({
      nodes: { E: makeNodeLayout({ w: 120, h: 80 }) },
    });
    const scene = generateCanvas(parsed, layout);

    const ellipseEl = scene.elements.find(
      (e) => e.mermaidId === "E" && e.type === "ellipse",
    );
    expect(ellipseEl).toBeDefined();
    // ellipse should retain independent w/h
    expect(ellipseEl!.width).toBe(120); // ! safe: confirmed defined above
    expect(ellipseEl!.height).toBe(80); // ! safe: confirmed defined above
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FC-03: Edge label text preserved through rendering
//
// Defect: edges declared with |label text| appear with no visible label.
// Pipeline: parseFlowchart (label: e.text ?? "") → canvas-generator (label: ... ? normalizeLabel(...) : undefined)
//
// FC-03a: non-empty label survives the pipeline
// FC-03b: empty string label → undefined (no dangling empty text element)
// FC-03c: HTML-encoded labels are decoded before rendering (parse → canvas integration)
// ─────────────────────────────────────────────────────────────────────────────

describe("FC-03: Edge label text preserved", () => {
  // FC-03a: non-empty edge label appears on the arrow element
  it("FC-03a: edge with non-empty label → arrow element has matching label", () => {
    const k = edgeKey("A", "B", 0);
    const parsed = makeParsed({
      nodes: new Map([["A", makeNode("A")], ["B", makeNode("B")]]),
      edges: [makeEdge("A", "B", "yes")],
    });
    const layout = makeLayout({
      nodes: {
        A: makeNodeLayout({ x: 0, y: 0 }),
        B: makeNodeLayout({ x: 300, y: 0 }),
      },
      edges: { [k]: { routing: "auto", waypoints: [], style: {} } },
    });
    const scene = generateCanvas(parsed, layout);

    const arrowEl = scene.elements.find(
      (e) => e.type === "arrow" && e.mermaidId === k,
    );
    expect(arrowEl).toBeDefined();
    expect(arrowEl!.label).toBe("yes"); // ! safe: confirmed defined above
  });

  // FC-03b: empty-string edge label → no label element (undefined, not "")
  it("FC-03b: edge with empty label → arrow label is undefined (not empty string)", () => {
    const k = edgeKey("A", "B", 0);
    const parsed = makeParsed({
      nodes: new Map([["A", makeNode("A")], ["B", makeNode("B")]]),
      edges: [makeEdge("A", "B", "")],
    });
    const layout = makeLayout({
      nodes: {
        A: makeNodeLayout({ x: 0, y: 0 }),
        B: makeNodeLayout({ x: 300, y: 0 }),
      },
      edges: { [k]: { routing: "auto", waypoints: [], style: {} } },
    });
    const scene = generateCanvas(parsed, layout);

    const arrowEl = scene.elements.find(
      (e) => e.type === "arrow" && e.mermaidId === k,
    );
    expect(arrowEl).toBeDefined();
    // Empty label must NOT produce a label field — it should be undefined
    // so Excalidraw does not render an empty text box
    expect(arrowEl!.label).toBeUndefined(); // ! safe: confirmed defined above
  });

  // FC-03c: HTML-encoded edge label is decoded end-to-end (parse → canvas)
  // FC-05f/g cover the parser-level decode; this verifies the rendered arrow.
  it("FC-03c: parse→canvas: encoded edge label appears decoded on rendered arrow", () => {
    const k = edgeKey("A", "B", 0);
    // Simulate Mermaid returning an HTML-encoded edge label (&#38; = &)
    const mockFlowchartDb = {
      getVertices: () => ({
        A: { id: "A", text: "A", type: "square" },
        B: { id: "B", text: "B", type: "square" },
      }),
      getEdges: () => [
        { start: "A", end: "B", text: "A &#38; B", type: "arrow_point", stroke: "normal" },
      ],
      getSubGraphs: () => [],
      getDirection: () => "TD",
    } as unknown as Parameters<typeof parseFlowchart>[0];

    const diagram = parseFlowchart(mockFlowchartDb);
    const layout = makeLayout({
      nodes: {
        A: makeNodeLayout({ x: 0, y: 0 }),
        B: makeNodeLayout({ x: 300, y: 0 }),
      },
      edges: { [k]: { routing: "auto", waypoints: [], style: {} } },
    });
    const scene = generateCanvas(diagram, layout);

    const arrowEl = scene.elements.find(
      (e) => e.type === "arrow" && e.mermaidId === k,
    );
    expect(arrowEl).toBeDefined();
    // The arrow label must be the decoded form "A & B", not "A &#38; B"
    expect(arrowEl!.label).toBe("A & B"); // ! safe: confirmed defined above
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FC-04: Cross (`--x`) arrowhead renders as bar marker
//
// Defect: Mermaid `--x` should produce an X-shaped terminator.
// Excalidraw has no native X; "bar" (perpendicular line) is the closest approximation.
//
// FC-04a: `--x` edges map to arrowheadEnd === "bar" in ParsedEdge
// FC-04b: `x--x` edges map to both arrowheads === "bar"
// FC-04c: "bar" flows through to ExcalidrawElement
// ─────────────────────────────────────────────────────────────────────────────

describe("FC-04: Cross arrowhead mapping", () => {
  // FC-04a: --x → ParsedEdge has arrowheadEnd === "bar"
  it("FC-04a: --x edge → ParsedEdge has arrowheadEnd === 'bar'", () => {
    // We test parseFlowchart directly with a mock db that simulates Mermaid's
    // db.getEdges() output for an --x edge (type: "arrow_cross")
    const mockFlowchartDb = {
      getVertices: () => ({
        A: { id: "A", text: "A", type: "square" },
        B: { id: "B", text: "B", type: "square" },
      }),
      getEdges: () => [
        { start: "A", end: "B", text: "", type: "arrow_cross", stroke: "normal" },
      ],
      getSubGraphs: () => [],
      getDirection: () => "TD",
    } as unknown as Parameters<typeof parseFlowchart>[0];

    const diagram = parseFlowchart(mockFlowchartDb);
    const edge = diagram.edges[0];
    expect(edge).toBeDefined();
    expect(edge!.arrowheadEnd).toBe("bar"); // ! safe: confirmed defined above
    // arrowheadStart should be null for --x (only end has X)
    expect(edge!.arrowheadStart).toBeNull(); // ! safe: confirmed defined above
  });

  // FC-04b: x--x → both arrowheads === "bar"
  it("FC-04b: x--x edge → ParsedEdge has both arrowheads === 'bar'", () => {
    const mockFlowchartDb = {
      getVertices: () => ({
        A: { id: "A", text: "A", type: "square" },
        B: { id: "B", text: "B", type: "square" },
      }),
      getEdges: () => [
        { start: "A", end: "B", text: "", type: "double_arrow_cross", stroke: "normal" },
      ],
      getSubGraphs: () => [],
      getDirection: () => "TD",
    } as unknown as Parameters<typeof parseFlowchart>[0];

    const diagram = parseFlowchart(mockFlowchartDb);
    const edge = diagram.edges[0];
    expect(edge).toBeDefined();
    expect(edge!.arrowheadStart).toBe("bar"); // ! safe: confirmed defined above
    expect(edge!.arrowheadEnd).toBe("bar"); // ! safe: confirmed defined above
  });

  // FC-04c: arrowheadEnd "bar" flows through to ExcalidrawElement
  it("FC-04c: --x edge → arrow element has arrowheadEnd === 'bar' in canvas scene", () => {
    const k = edgeKey("A", "B", 0);
    const parsed = makeParsed({
      nodes: new Map([["A", makeNode("A")], ["B", makeNode("B")]]),
      edges: [
        makeEdge("A", "B", "", null, "bar"),
      ],
    });
    const layout = makeLayout({
      nodes: {
        A: makeNodeLayout({ x: 0, y: 0 }),
        B: makeNodeLayout({ x: 300, y: 0 }),
      },
      edges: { [k]: { routing: "auto", waypoints: [], style: {} } },
    });
    const scene = generateCanvas(parsed, layout);

    const arrowEl = scene.elements.find(
      (e) => e.type === "arrow" && e.mermaidId === k,
    );
    expect(arrowEl).toBeDefined();
    expect(arrowEl!.arrowheadEnd).toBe("bar"); // ! safe: confirmed defined above
  });

  // FC-04c.2: arrowheadStart "bar" also flows through
  it("FC-04c.2: x--x edge → both arrowheadStart and arrowheadEnd are 'bar' in canvas scene", () => {
    const k = edgeKey("A", "B", 0);
    const parsed = makeParsed({
      nodes: new Map([["A", makeNode("A")], ["B", makeNode("B")]]),
      edges: [
        makeEdge("A", "B", "", "bar", "bar"),
      ],
    });
    const layout = makeLayout({
      nodes: {
        A: makeNodeLayout({ x: 0, y: 0 }),
        B: makeNodeLayout({ x: 300, y: 0 }),
      },
      edges: { [k]: { routing: "auto", waypoints: [], style: {} } },
    });
    const scene = generateCanvas(parsed, layout);

    const arrowEl = scene.elements.find(
      (e) => e.type === "arrow" && e.mermaidId === k,
    );
    expect(arrowEl).toBeDefined();
    expect(arrowEl!.arrowheadStart).toBe("bar"); // ! safe: confirmed defined above
    expect(arrowEl!.arrowheadEnd).toBe("bar"); // ! safe: confirmed defined above
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FC-05f,g: Flowchart node/edge labels decoded (end-to-end integration)
//
// FC-05a-e (decodeHtmlEntities unit tests) are in decode-html.test.ts
// These tests verify the integration: decodeHtmlEntities applied to labels
// in the parseFlowchart → ParsedDiagram pipeline.
// ─────────────────────────────────────────────────────────────────────────────

describe("FC-05f,g: Flowchart labels decoded from HTML entities", () => {
  // FC-05f: node labels decoded — input is HTML-encoded, output is decoded plain text
  it("FC-05f: parseFlowchart decodes HTML entities in node label", () => {
    const mockFlowchartDb = {
      getVertices: () => ({
        A: { id: "A", text: "Sales &amp; Marketing", type: "square" },
      }),
      getEdges: () => [],
      getSubGraphs: () => [],
      getDirection: () => "TD",
    } as unknown as Parameters<typeof parseFlowchart>[0];

    const diagram = parseFlowchart(mockFlowchartDb);
    // &amp; should be decoded to &
    expect(diagram.nodes.get("A")?.label).toBe("Sales & Marketing");
  });

  // FC-05g: edge labels decoded
  it("FC-05g: parseFlowchart decodes HTML entities in edge label", () => {
    const mockFlowchartDb = {
      getVertices: () => ({
        A: { id: "A", text: "A", type: "square" },
        B: { id: "B", text: "B", type: "square" },
      }),
      getEdges: () => [
        { start: "A", end: "B", text: "A &#38; B", type: "arrow_point", stroke: "normal" },
      ],
      getSubGraphs: () => [],
      getDirection: () => "TD",
    } as unknown as Parameters<typeof parseFlowchart>[0];

    const diagram = parseFlowchart(mockFlowchartDb);
    // &#38; should be decoded to &
    const edge = diagram.edges[0];
    expect(edge).toBeDefined();
    expect(edge!.label).toBe("A & B"); // ! safe: confirmed defined above
  });
});
