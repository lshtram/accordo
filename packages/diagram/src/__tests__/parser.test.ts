/**
 * A2 — Parser adapter tests
 *
 * Tests verify the public contract of parseMermaid(), detectDiagramType(),
 * and isSpatialType() from parser/adapter.ts.
 *
 * All tests are RED in Phase B (stubs throw "not implemented").
 * They turn GREEN in Phase C after implementation.
 *
 * mermaid is mocked so tests run in Node without a DOM.
 * The mock returns a controlled `parser.yy` db object per test.
 *
 * Requirements: diag_arch_v4.2.md §6, diag_workplan.md §5 A2 test table
 *
 * API checklist:
 *   detectDiagramType — 14 tests
 *   isSpatialType — 2 tests
 *   parseMermaid — node extraction 3 tests
 *   parseMermaid — edge extraction 7 tests
 *   parseMermaid — edge ordinals 1 test
 *   parseMermaid — cluster extraction 4 tests
 *   parseMermaid — direction 5 tests
 *   parseMermaid — rename annotations 3 tests
 *   parseMermaid — error handling 5 tests
 *   parseMermaid — unsupported diagram types 5 tests
 *   parseMermaid — vertex text fallback 2 tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DiagramType } from "../types.js";

// ── Mermaid mock ──────────────────────────────────────────────────────────────
//
// We replace the mermaid module with a minimal fake that:
//  1. Exposes mermaidAPI.getDiagramFromText() returning a fake diagram object
//  2. Lets each test inject a custom db via __setMockDb()
//
// The mock lives in this file (not a separate __mocks__ file) so the db
// factory can be controlled per-test with vi.mocked().

interface MockDb {
  getVertices?: () => Record<string, unknown>;
  getEdges?: () => unknown[];
  getSubGraphs?: () => unknown[];
  getDirection?: () => string;
  getClasses?: () => Map<string, unknown> | Record<string, unknown>;
}

let _mockDb: MockDb = {};

const mermaidMock = {
  default: {
    initialize: vi.fn(),
    mermaidAPI: {
      getDiagramFromText: vi.fn((_source: string) => ({
        db: _mockDb,
      })),
      initialize: vi.fn(),
    },
  },
};

vi.mock("mermaid", () => mermaidMock);

function setMockDb(db: MockDb): void {
  _mockDb = db;
}

// ── Helpers to build mock db objects ─────────────────────────────────────────

function makeVertex(
  id: string,
  label: string,
  type: string,
  classes: string[] = [],
  domId?: string
) {
  return { id, labelType: "string", label, type, domId: domId ?? id, classes };
}

function makeVertexWithStyles(
  id: string,
  label: string,
  type: string,
  classes: string[] = [],
  styles: string[] = []
) {
  return { id, labelType: "string", label, type, domId: id, classes, styles };
}

function makeEdge(
  start: string,
  end: string,
  text: string,
  type: string = "arrow_point", // Mermaid 11.x string type
  stroke: string = "normal"
) {
  return { start, end, text, type, stroke };
}

function makeSubgraph(id: string, title: string, nodes: string[]) {
  return { id, title, nodes };
}

// ── Import the module under test (after vi.mock declaration) ──────────────────
// Dynamic import keeps mock hoisting correct.

const { parseMermaid, detectDiagramType, isSpatialType } =
  await import("../parser/adapter.js");

// ── 1. Type detection ─────────────────────────────────────────────────────────

describe("detectDiagramType", () => {
  it("detects 'flowchart' from 'flowchart TD'", () => {
    expect(detectDiagramType("flowchart TD\n  A-->B")).toBe("flowchart");
  });

  it("detects 'flowchart' from 'graph TD'", () => {
    expect(detectDiagramType("graph TD\n  A-->B")).toBe("flowchart");
  });

  it("returns null for unsupported type 'sequenceDiagram'", () => {
    expect(detectDiagramType("sequenceDiagram\n  A->>B: hi")).toBeNull();
  });

  it("detects 'classDiagram'", () => {
    expect(detectDiagramType("classDiagram\n  class Foo")).toBe("classDiagram");
  });

  it("detects 'stateDiagram-v2'", () => {
    expect(detectDiagramType("stateDiagram-v2\n  [*]-->A")).toBe(
      "stateDiagram-v2"
    );
  });

  it("detects 'erDiagram'", () => {
    expect(detectDiagramType("erDiagram\n  FOO {")).toBe("erDiagram");
  });

  it("returns null for unsupported type 'gantt'", () => {
    expect(detectDiagramType("gantt\n  title G")).toBeNull();
  });

  it("returns null for unsupported type 'gitGraph'", () => {
    expect(detectDiagramType("gitGraph\n  commit")).toBeNull();
  });

  it("detects 'mindmap'", () => {
    expect(detectDiagramType("mindmap\n  root((M))")).toBe("mindmap");
  });

  it("returns null for unsupported type 'timeline'", () => {
    expect(detectDiagramType("timeline\n  title T")).toBeNull();
  });

  it("returns null for unsupported type 'quadrantChart'", () => {
    expect(detectDiagramType("quadrantChart\n  title Q")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(detectDiagramType("")).toBeNull();
  });

  it("returns null for unrecognised content", () => {
    expect(detectDiagramType("hello world")).toBeNull();
  });

  it("ignores leading blank lines and %% comments before the type keyword", () => {
    expect(
      detectDiagramType("%% a comment\n\nflowchart LR\n  A-->B")
    ).toBe("flowchart");
  });
});

// ── 2. isSpatialType ─────────────────────────────────────────────────────────

describe("isSpatialType", () => {
  const spatialTypes: DiagramType[] = [
    "flowchart",
    "block-beta",
    "classDiagram",
    "stateDiagram-v2",
    "erDiagram",
    "mindmap",
  ];

  it.each(spatialTypes)("returns true for %s", (t) => {
    expect(isSpatialType(t)).toBe(true);
  });

  it("returns false for unrecognised string", () => {
    expect(isSpatialType("sequenceDiagram")).toBe(false);
    expect(isSpatialType("gantt")).toBe(false);
    expect(isSpatialType("unknown")).toBe(false);
  });
});

// ── 3. Node extraction ────────────────────────────────────────────────────────

describe("parseMermaid — node extraction", () => {
  beforeEach(() => {
    setMockDb({
      getVertices: () => ({
        A: makeVertex("A", "Rectangle", "square"),
        B: makeVertex("B", "Rounded", "round"),
        C: makeVertex("C", "Diamond", "diamond"),
        D: makeVertex("D", "Circle", "circle"),
        E: makeVertex("E", "Stadium", "stadium"),
        F: makeVertex("F", "Cylinder", "cylinder"),
        G: makeVertex("G", "Hex", "hexagon"),
      }),
      getEdges: () => [],
      getSubGraphs: () => [],
      getDirection: () => "TD",
    });
  });

  it("extracts all nodes with correct IDs", async () => {
    const result = await parseMermaid("flowchart TD\n  A[Rectangle]");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect([...result.diagram.nodes.keys()]).toEqual(
      expect.arrayContaining(["A", "B", "C", "D", "E", "F", "G"])
    );
  });

  it.each([
    ["A", "rectangle"],
    ["B", "rounded"],
    ["C", "diamond"],
    ["D", "circle"],
    ["E", "stadium"],
    ["F", "cylinder"],
    ["G", "hexagon"],
  ] as const)("node %s maps to shape %s", async (id, shape) => {
    const result = await parseMermaid("flowchart TD");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.diagram.nodes.get(id)?.shape).toBe(shape);
  });

  it("node label is extracted correctly", async () => {
    const result = await parseMermaid("flowchart TD\n  A[Rectangle]");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.diagram.nodes.get("A")?.label).toBe("Rectangle");
  });
});

// ── 4. Edge extraction ────────────────────────────────────────────────────────

describe("parseMermaid — edge extraction", () => {
  beforeEach(() => {
    setMockDb({
      getVertices: () => ({
        A: makeVertex("A", "A", "square"),
        B: makeVertex("B", "B", "square"),
        C: makeVertex("C", "C", "square"),
      }),
      getEdges: () => [
        makeEdge("A", "B", "", "arrow_point", "normal"),       // arrow, no label
        makeEdge("A", "B", "second", "arrow_point", "normal"), // arrow, label — second edge A→B
        makeEdge("B", "C", "link", "arrow_point", "dotted"),   // dotted, label
        makeEdge("A", "C", "", "arrow_point", "thick"),         // thick
      ],
      getSubGraphs: () => [],
      getDirection: () => "LR",
    });
  });

  it("extracts 4 edges total", async () => {
    const result = await parseMermaid("flowchart LR");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.diagram.edges).toHaveLength(4);
  });

  it("correctly identifies from/to for each edge", async () => {
    const result = await parseMermaid("flowchart LR");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    const { edges } = result.diagram;
    expect(edges[0].from).toBe("A");
    expect(edges[0].to).toBe("B");
    expect(edges[2].from).toBe("B");
    expect(edges[2].to).toBe("C");
  });

  it("edge label is extracted", async () => {
    const result = await parseMermaid("flowchart LR");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.diagram.edges[2].label).toBe("link");
  });

  it("edges with no label have empty string label", async () => {
    const result = await parseMermaid("flowchart LR");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.diagram.edges[0].label).toBe("");
  });

  it("edge type: type=1 maps to 'arrow'", async () => {
    const result = await parseMermaid("flowchart LR");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.diagram.edges[0].type).toBe("arrow");
  });

  it("edge type: dotted stroke maps to strokeStyle='dashed'", async () => {
    const result = await parseMermaid("flowchart LR");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.diagram.edges[2].strokeStyle).toBe("dashed");
  });

  it("edge type: thick stroke maps to strokeWidth=4", async () => {
    const result = await parseMermaid("flowchart LR");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.diagram.edges[3].strokeWidth).toBe(4);
  });
});

// ── 5. Edge ordinals ──────────────────────────────────────────────────────────

describe("parseMermaid — edge ordinals", () => {
  beforeEach(() => {
    setMockDb({
      getVertices: () => ({
        A: makeVertex("A", "A", "square"),
        B: makeVertex("B", "B", "square"),
      }),
      getEdges: () => [
        makeEdge("A", "B", "first"),
        makeEdge("A", "B", "second"),
        makeEdge("A", "B", "third"),
      ],
      getSubGraphs: () => [],
      getDirection: () => "TD",
    });
  });

  it("three edges A→B get ordinals 0, 1, 2", async () => {
    const result = await parseMermaid("flowchart TD");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    const abEdges = result.diagram.edges.filter(
      (e) => e.from === "A" && e.to === "B"
    );
    expect(abEdges.map((e) => e.ordinal)).toEqual([0, 1, 2]);
  });
});

// ── 6. Cluster / subgraph extraction ─────────────────────────────────────────

describe("parseMermaid — cluster extraction", () => {
  beforeEach(() => {
    setMockDb({
      getVertices: () => ({
        A: makeVertex("A", "A", "square"),
        B: makeVertex("B", "B", "square"),
        C: makeVertex("C", "C", "square"),
      }),
      getEdges: () => [],
      getSubGraphs: () => [
        makeSubgraph("grp1", "Group One", ["A", "B"]),
        makeSubgraph("grp2", "Group Two", ["C"]),
      ],
      getDirection: () => "TD",
    });
  });

  it("extracts 2 clusters", async () => {
    const result = await parseMermaid("flowchart TD");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.diagram.clusters).toHaveLength(2);
  });

  it("cluster id and label are correct", async () => {
    const result = await parseMermaid("flowchart TD");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    const grp = result.diagram.clusters.find((c) => c.id === "grp1");
    expect(grp?.label).toBe("Group One");
  });

  it("cluster members include correct node IDs", async () => {
    const result = await parseMermaid("flowchart TD");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    const grp = result.diagram.clusters.find((c) => c.id === "grp1");
    expect(grp?.members).toEqual(expect.arrayContaining(["A", "B"]));
  });

  it("nodes inside a cluster carry the cluster field", async () => {
    const result = await parseMermaid("flowchart TD");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.diagram.nodes.get("A")?.cluster).toBe("grp1");
    expect(result.diagram.nodes.get("C")?.cluster).toBe("grp2");
  });
});

// ── 7. Direction detection ────────────────────────────────────────────────────

describe("parseMermaid — direction", () => {
  it.each(["TD", "LR", "RL", "BT"] as const)("detects direction %s", async (dir) => {
    setMockDb({
      getVertices: () => ({}),
      getEdges: () => [],
      getSubGraphs: () => [],
      getDirection: () => dir,
    });
    const result = await parseMermaid(`flowchart ${dir}`);
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.diagram.direction).toBe(dir);
  });

  it("normalizes 'TB' from mermaid to 'TD'", async () => {
    setMockDb({
      getVertices: () => ({}),
      getEdges: () => [],
      getSubGraphs: () => [],
      getDirection: () => "TB",
    });
    const result = await parseMermaid("flowchart TD");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.diagram.direction).toBe("TD");
  });
});

// ── 8. Empty diagram ──────────────────────────────────────────────────────────

describe("parseMermaid — empty diagram", () => {
  beforeEach(() => {
    setMockDb({
      getVertices: () => ({}),
      getEdges: () => [],
      getSubGraphs: () => [],
      getDirection: () => "TD",
    });
  });

  it("'flowchart TD' with no nodes returns empty node map", async () => {
    const result = await parseMermaid("flowchart TD");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.diagram.nodes.size).toBe(0);
  });

  it("empty diagram returns empty edges array", async () => {
    const result = await parseMermaid("flowchart TD");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.diagram.edges).toHaveLength(0);
  });

  it("empty diagram returns empty clusters array", async () => {
    const result = await parseMermaid("flowchart TD");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.diagram.clusters).toHaveLength(0);
  });
});

// ── 9. classDef / class annotations ──────────────────────────────────────────

describe("parseMermaid — classDef / class annotations", () => {
  beforeEach(() => {
    setMockDb({
      getVertices: () => ({
        A: makeVertex("A", "A", "square", ["service", "critical"]),
        B: makeVertex("B", "B", "square", []),
      }),
      getEdges: () => [],
      getSubGraphs: () => [],
      getDirection: () => "TD",
    });
  });

  it("node with classes carries classes array", async () => {
    const result = await parseMermaid("flowchart TD");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.diagram.nodes.get("A")?.classes).toEqual(
      expect.arrayContaining(["service", "critical"])
    );
  });

  it("node with no classes has empty classes array", async () => {
    const result = await parseMermaid("flowchart TD");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.diagram.nodes.get("B")?.classes).toHaveLength(0);
  });
});

// ── 10. Rename annotations ────────────────────────────────────────────────────

describe("parseMermaid — rename annotations", () => {
  it("detects a single @rename annotation in source", async () => {
    setMockDb({
      getVertices: () => ({
        new_auth: makeVertex("new_auth", "Auth", "square"),
      }),
      getEdges: () => [],
      getSubGraphs: () => [],
      getDirection: () => "TD",
    });
    const source = [
      "flowchart TD",
      "%% @rename: auth -> new_auth",
      "  new_auth[Auth]",
    ].join("\n");
    const result = await parseMermaid(source);
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.diagram.renames).toHaveLength(1);
    expect(result.diagram.renames[0]).toEqual({
      oldId: "auth",
      newId: "new_auth",
    });
  });

  it("detects multiple @rename annotations", async () => {
    setMockDb({
      getVertices: () => ({}),
      getEdges: () => [],
      getSubGraphs: () => [],
      getDirection: () => "TD",
    });
    const source = [
      "flowchart TD",
      "%% @rename: a -> a2",
      "%% @rename: b -> b2",
    ].join("\n");
    const result = await parseMermaid(source);
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.diagram.renames).toHaveLength(2);
  });

  it("returns empty renames array when no annotations present", async () => {
    setMockDb({
      getVertices: () => ({}),
      getEdges: () => [],
      getSubGraphs: () => [],
      getDirection: () => "TD",
    });
    const result = await parseMermaid("flowchart TD\n  A-->B");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.diagram.renames).toHaveLength(0);
  });
});

// ── 11. %% comments ignored ───────────────────────────────────────────────────

describe("parseMermaid — %% comments", () => {
  it("source with only %% comments before first node still parses", async () => {
    setMockDb({
      getVertices: () => ({ A: makeVertex("A", "A", "square") }),
      getEdges: () => [],
      getSubGraphs: () => [],
      getDirection: () => "TD",
    });
    const result = await parseMermaid(
      "%% title: arch\nflowchart TD\n  A[A]"
    );
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.diagram.nodes.get("A")).toBeDefined();
  });
});

// ── 12. Invalid / error input ─────────────────────────────────────────────────

describe("parseMermaid — error handling", () => {
  it("returns valid=false when getDiagramFromText throws", async () => {
    mermaidMock.default.mermaidAPI.getDiagramFromText.mockImplementationOnce(
      () => {
        throw Object.assign(new Error("Parse error"), { hash: { line: 3 } });
      }
    );
    const result = await parseMermaid("flowchart TD\n  A--[broken");
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.error.message).toBeTruthy();
  });

  it("error result has a line number", async () => {
    mermaidMock.default.mermaidAPI.getDiagramFromText.mockImplementationOnce(
      () => {
        throw Object.assign(new Error("bad syntax"), { hash: { line: 5 } });
      }
    );
    // Use flowchart source so detectDiagramType succeeds and getDiagramFromText
    // is actually called (consuming the mockImplementationOnce above).
    const result = await parseMermaid("flowchart TD\n  A --[broken syntax");
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(typeof result.error.line).toBe("number");
  });
});

// ── 13. Unsupported diagram types ─────────────────────────────────────────────

describe("parseMermaid — unsupported diagram types", () => {
  it("returns valid=false for sequenceDiagram", async () => {
    const result = await parseMermaid("sequenceDiagram\nA->>B: hi");
    expect(result.valid).toBe(false);
    if (result.valid) return;
    // sequenceDiagram is a known-but-unsupported sequential type — gets a specific error
    expect(result.error.message).toContain("not supported by this extension");
    expect(result.error.message).toContain("sequenceDiagram");
  });

  it("returns valid=false for gantt", async () => {
    const result = await parseMermaid("gantt\n  title T");
    expect(result.valid).toBe(false);
  });

  it("does not call getDiagramFromText for unsupported types", async () => {
    mermaidMock.default.mermaidAPI.getDiagramFromText.mockClear();
    await parseMermaid("sequenceDiagram\nA->>B: hi");
    expect(mermaidMock.default.mermaidAPI.getDiagramFromText).not.toHaveBeenCalled();
  });

  it("REQ-R5: classDiagram is now supported and returns valid:true", async () => {
    // Provide a classDiagram-style mock db (classes Map, relations, notes, direction)
    setMockDb({
      classes: new Map([["User", { id: "User", type: "", label: "User", text: "User", shape: "classBox", cssClasses: "", members: [], methods: [], annotations: [], domId: "User" }]]),
      relations: [],
      notes: new Map(),
      direction: "TD",
    } as unknown as MockDb);

    const result = await parseMermaid("classDiagram\n  class User");

    expect(result.valid).toBe(true);
    if (!result.valid) return;

    expect(result.diagram.type).toBe("classDiagram");
    expect(result.diagram.nodes.has("User")).toBe(true);
  });

  it("REQ-R6: sequenceDiagram remains unsupported without advertising non-registered parser support", async () => {
    const result = await parseMermaid("sequenceDiagram\n  Alice->>Bob: hi");

    expect(result.valid).toBe(false);
    if (result.valid) return;

    expect(result.error.message).toContain("sequenceDiagram");
    expect(result.error.message).toContain("not supported");
    expect(result.error.message).not.toContain("erDiagram, mindmap, block-beta");
  });
});

// ── 14. Vertex text-field fallback ────────────────────────────────────────────

describe("parseMermaid — vertex text-field fallback", () => {
  it("extracts label from vertex.text when vertex.label is absent", async () => {
    setMockDb({
      getVertices: () => ({
        X: { id: "X", text: "TextLabel", type: "square", domId: "X", classes: [] },
      }),
      getEdges: () => [],
      getSubGraphs: () => [],
      getDirection: () => "TD",
    });
    const result = await parseMermaid("flowchart TD\n  X[TextLabel]");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.diagram.nodes.get("X")?.label).toBe("TextLabel");
  });

  it("prefers vertex.text over vertex.label when both are present", async () => {
    setMockDb({
      getVertices: () => ({
        Y: { id: "Y", text: "TextValue", label: "LabelValue", type: "square", classes: [] },
      }),
      getEdges: () => [],
      getSubGraphs: () => [],
      getDirection: () => "TD",
    });
    const result = await parseMermaid("flowchart TD\n  Y[TextValue]");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.diagram.nodes.get("Y")?.label).toBe("TextValue");
  });
});

// ── 15. Inline `style` directive parsing ─────────────────────────────────────
// Verifies that vertex.styles (CSS strings) are parsed into ParsedNode.style.

describe("parseMermaid — inline style directive → ParsedNode.style", () => {
  it("fill:#f9f sets node.style.backgroundColor", async () => {
    setMockDb({
      getVertices: () => ({
        A: makeVertexWithStyles("A", "Start", "round", [], ["fill:#f9f"]),
      }),
      getEdges: () => [],
      getSubGraphs: () => [],
      getDirection: () => "TD",
    });
    const result = await parseMermaid("flowchart TD");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.diagram.nodes.get("A")?.style?.backgroundColor).toBe("#f9f");
  });

  it("stroke:#333 sets node.style.strokeColor", async () => {
    setMockDb({
      getVertices: () => ({
        A: makeVertexWithStyles("A", "A", "square", [], ["stroke:#333"]),
      }),
      getEdges: () => [],
      getSubGraphs: () => [],
      getDirection: () => "TD",
    });
    const result = await parseMermaid("flowchart TD");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.diagram.nodes.get("A")?.style?.strokeColor).toBe("#333");
  });

  it("stroke-width:4px sets node.style.strokeWidth to 4", async () => {
    setMockDb({
      getVertices: () => ({
        A: makeVertexWithStyles("A", "A", "square", [], ["stroke-width:4px"]),
      }),
      getEdges: () => [],
      getSubGraphs: () => [],
      getDirection: () => "TD",
    });
    const result = await parseMermaid("flowchart TD");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.diagram.nodes.get("A")?.style?.strokeWidth).toBe(4);
  });

  it("color:#fff sets node.style.fontColor", async () => {
    setMockDb({
      getVertices: () => ({
        A: makeVertexWithStyles("A", "A", "square", [], ["color:#fff"]),
      }),
      getEdges: () => [],
      getSubGraphs: () => [],
      getDirection: () => "TD",
    });
    const result = await parseMermaid("flowchart TD");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.diagram.nodes.get("A")?.style?.fontColor).toBe("#fff");
  });

  it("stroke-dasharray sets node.style.strokeStyle to 'dashed'", async () => {
    setMockDb({
      getVertices: () => ({
        A: makeVertexWithStyles("A", "A", "square", [], ["stroke-dasharray: 5 5"]),
      }),
      getEdges: () => [],
      getSubGraphs: () => [],
      getDirection: () => "TD",
    });
    const result = await parseMermaid("flowchart TD");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.diagram.nodes.get("A")?.style?.strokeStyle).toBe("dashed");
  });

  it("multiple CSS properties all parsed correctly", async () => {
    setMockDb({
      getVertices: () => ({
        A: makeVertexWithStyles("A", "Start", "round", [], ["fill:#f9f", "stroke:#333", "stroke-width:4px"]),
      }),
      getEdges: () => [],
      getSubGraphs: () => [],
      getDirection: () => "TD",
    });
    const result = await parseMermaid("flowchart TD");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    const style = result.diagram.nodes.get("A")?.style;
    expect(style?.backgroundColor).toBe("#f9f");
    expect(style?.strokeColor).toBe("#333");
    expect(style?.strokeWidth).toBe(4);
  });

  it("node with no styles has no style field", async () => {
    setMockDb({
      getVertices: () => ({
        A: makeVertex("A", "A", "square"),
      }),
      getEdges: () => [],
      getSubGraphs: () => [],
      getDirection: () => "TD",
    });
    const result = await parseMermaid("flowchart TD");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.diagram.nodes.get("A")?.style).toBeUndefined();
  });
});

// ── 16. classDef resolution → ParsedNode.style ────────────────────────────────
// Verifies that db.getClasses() classDef styles are resolved onto nodes.

describe("parseMermaid — classDef → ParsedNode.style", () => {
  it("classDef fill color is applied to matching nodes", async () => {
    setMockDb({
      getVertices: () => ({
        A: makeVertex("A", "A", "square", ["highlight"]),
      }),
      getEdges: () => [],
      getSubGraphs: () => [],
      getDirection: () => "TD",
      getClasses: () => new Map([
        ["highlight", { id: "highlight", styles: ["fill:#4dabf7"], textStyles: [] }],
      ]),
    });
    const result = await parseMermaid("flowchart TD");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.diagram.nodes.get("A")?.style?.backgroundColor).toBe("#4dabf7");
  });

  it("classDef stroke color is applied to matching nodes", async () => {
    setMockDb({
      getVertices: () => ({
        A: makeVertex("A", "A", "square", ["service"]),
      }),
      getEdges: () => [],
      getSubGraphs: () => [],
      getDirection: () => "TD",
      getClasses: () => new Map([
        ["service", { id: "service", styles: ["stroke:#1971c2"], textStyles: [] }],
      ]),
    });
    const result = await parseMermaid("flowchart TD");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.diagram.nodes.get("A")?.style?.strokeColor).toBe("#1971c2");
  });

  it("inline style overrides classDef fill for same node", async () => {
    // classDef sets fill:#aaa; inline style overrides with fill:#f00
    setMockDb({
      getVertices: () => ({
        A: makeVertexWithStyles("A", "A", "square", ["base"], ["fill:#f00"]),
      }),
      getEdges: () => [],
      getSubGraphs: () => [],
      getDirection: () => "TD",
      getClasses: () => new Map([
        ["base", { id: "base", styles: ["fill:#aaa"], textStyles: [] }],
      ]),
    });
    const result = await parseMermaid("flowchart TD");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    // inline style wins
    expect(result.diagram.nodes.get("A")?.style?.backgroundColor).toBe("#f00");
  });

  it("node with no class assignment gets no classDef style", async () => {
    setMockDb({
      getVertices: () => ({
        A: makeVertex("A", "A", "square", []),
      }),
      getEdges: () => [],
      getSubGraphs: () => [],
      getDirection: () => "TD",
      getClasses: () => new Map([
        ["myClass", { id: "myClass", styles: ["fill:#aaa"], textStyles: [] }],
      ]),
    });
    const result = await parseMermaid("flowchart TD");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    // A has no class "myClass" → no style
    expect(result.diagram.nodes.get("A")?.style).toBeUndefined();
  });

  it("db without getClasses() still works gracefully (no crash)", async () => {
    setMockDb({
      getVertices: () => ({
        A: makeVertex("A", "A", "square", ["myClass"]),
      }),
      getEdges: () => [],
      getSubGraphs: () => [],
      getDirection: () => "TD",
      // No getClasses — simulates older Mermaid version
    });
    const result = await parseMermaid("flowchart TD");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    // Should not crash; node has no resolved style
    expect(result.diagram.nodes.get("A")?.style).toBeUndefined();
  });

  it("space-separated classDef styles (no comma) are parsed correctly", async () => {
    // classDef foobar stroke:#00f stroke-width:2px (space, no comma)
    setMockDb({
      getVertices: () => ({
        C: makeVertex("C", "C", "square", ["foobar"]),
      }),
      getEdges: () => [],
      getSubGraphs: () => [],
      getDirection: () => "TD",
      getClasses: () => new Map([
        ["foobar", { id: "foobar", styles: ["stroke:#00f stroke-width:2px"], textStyles: [] }],
      ]),
    });
    const result = await parseMermaid("flowchart TD");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    const style = result.diagram.nodes.get("C")?.style;
    expect(style?.strokeColor).toBe("#00f");
    expect(style?.strokeWidth).toBe(2);
  });
});
// Verifies that flowchart.ts SHAPE_MAP correctly maps each Mermaid vertex type
// string (as seen in the parsed db) to the expected internal NodeShape value.

describe("parseMermaid — extended vertex type → NodeShape mapping (PR-12)", () => {
  it.each([
    ["subroutine",    "subroutine"],
    ["doublecircle",  "double_circle"],
    ["odd",           "asymmetric"],
    ["lean_right",    "parallelogram"],
    ["lean_left",     "parallelogram_alt"],
    ["trapezoid",     "trapezoid"],
    ["inv_trapezoid", "trapezoid_alt"],
  ] as const)("PR-12: Mermaid type '%s' maps to NodeShape '%s'", async (vertexType, expectedShape) => {
    setMockDb({
      getVertices: () => ({
        N: makeVertex("N", "Label", vertexType),
      }),
      getEdges: () => [],
      getSubGraphs: () => [],
      getDirection: () => "TD",
    });
    const result = await parseMermaid("flowchart TD");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.diagram.nodes.get("N")?.shape).toBe(expectedShape);
  });
});
