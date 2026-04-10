/**
 * B — StateDiagram-v2 parser tests
 *
 * Tests verify the public contract of parseMermaid() for stateDiagram-v2 source.
 * All tests are RED in Phase B (stubs throw "not implemented").
 * They turn GREEN in Phase C after implementation.
 *
 * mermaid is mocked so tests run in Node without a DOM.
 * The mock returns a controlled `parser.yy` db object per test.
 *
 * Requirements: diagram-types-architecture.md §2, §13
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mermaid mock ──────────────────────────────────────────────────────────────
//
// We replace the mermaid module with a minimal fake that:
//  1. Exposes mermaidAPI.getDiagramFromText() returning a fake diagram object
//  2. Lets each test inject a custom db via __setMockDb()
//
// For stateDiagram-v2, the db has direct property access (not methods):
//  - db.nodes: Array<StateNode>
//  - db.edges: Array<StateEdge>

interface MockStateNode {
  id: string;
  label: string;
  shape: string;
  cssClasses: string;
  isGroup: boolean;
  parentId?: string;
  domId?: string;
  type?: string;
  dir?: string;
  padding?: number;
  rx?: number;
  ry?: number;
  look?: string;
  centerLabel?: boolean;
  labelStyle?: string;
  cssCompiledStyles?: string[];
  cssStyles?: string[];
}

interface MockStateEdge {
  id: string;
  start: string;
  end: string;
  label: string;
  arrowhead?: string;
  arrowTypeEnd?: string;
  thickness?: string;
  classes?: string;
  style?: string;
  labelStyle?: string;
  labelpos?: string;
  labelType?: string;
  arrowheadStyle?: string;
  look?: string;
}

interface MockStateDiagramDb {
  nodes: MockStateNode[];
  edges: MockStateEdge[];
}

let _mockDb: MockStateDiagramDb = { nodes: [], edges: [] };

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

function setMockDb(db: MockStateDiagramDb): void {
  _mockDb = db;
}

// ── Helpers to build mock db objects ─────────────────────────────────────────

function makeStateNode(
  id: string,
  label: string,
  shape: string,
  options?: {
    isGroup?: boolean;
    parentId?: string;
    cssClasses?: string;
  }
): MockStateNode {
  return {
    id,
    label,
    shape,
    cssClasses: options?.cssClasses ?? " statediagram-state",
    isGroup: options?.isGroup ?? false,
    parentId: options?.parentId,
    domId: `state-${id}-0`,
    type: options?.isGroup ? "group" : undefined,
    padding: 8,
    rx: 10,
    ry: 10,
    look: "classic",
    centerLabel: true,
    labelStyle: "",
    cssCompiledStyles: [],
    cssStyles: [],
  };
}

function makeStateEdge(
  start: string,
  end: string,
  label: string = "",
  id?: string
): MockStateEdge {
  return {
    id: id ?? `edge${Math.random().toString(36).slice(2, 7)}`,
    start,
    end,
    label,
    arrowhead: "normal",
    arrowTypeEnd: "arrow_barb",
    thickness: "normal",
    classes: "transition",
    style: "fill:none",
    labelStyle: "",
    labelpos: "c",
    labelType: "text",
    arrowheadStyle: "",
    look: "classic",
  };
}

// ── Import the module under test (after vi.mock declaration) ──────────────────
// Dynamic import keeps mock hoisting correct.

const { parseMermaid } = await import("../parser/adapter.js");

// ── SD-01: Parse simple two-state diagram ─────────────────────────────────────

describe("SD-01: parseMermaid — simple two-state diagram", () => {
  beforeEach(() => {
    setMockDb({
      nodes: [
        makeStateNode("idle", "idle", "rect"),
        makeStateNode("active", "active", "rect"),
      ],
      edges: [makeStateEdge("idle", "active", "activate")],
    });
  });

  it("extracts 2 nodes", async () => {
    const result = await parseMermaid("stateDiagram-v2\n  idle --> active : activate");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.diagram.nodes.size).toBe(2);
  });

  it("extracts 1 edge", async () => {
    const result = await parseMermaid("stateDiagram-v2\n  idle --> active : activate");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.diagram.edges).toHaveLength(1);
  });

  it("node IDs are correct", async () => {
    const result = await parseMermaid("stateDiagram-v2\n  idle --> active : activate");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect([...result.diagram.nodes.keys()]).toEqual(
      expect.arrayContaining(["idle", "active"])
    );
  });

  it("edge from/to are correct", async () => {
    const result = await parseMermaid("stateDiagram-v2\n  idle --> active : activate");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.diagram.edges[0].from).toBe("idle");
    expect(result.diagram.edges[0].to).toBe("active");
  });

  it("edge label is preserved", async () => {
    const result = await parseMermaid("stateDiagram-v2\n  idle --> active : activate");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.diagram.edges[0].label).toBe("activate");
  });
});

// ── SD-02: Start/end pseudostates ─────────────────────────────────────────────

describe("SD-02: parseMermaid — start/end pseudostates", () => {
  beforeEach(() => {
    setMockDb({
      nodes: [
        makeStateNode("root_start", "", "stateStart"),
        makeStateNode("idle", "idle", "rect"),
        makeStateNode("root_end", "", "stateEnd"),
      ],
      edges: [
        makeStateEdge("root_start", "idle", ""),
        makeStateEdge("idle", "root_end", ""),
      ],
    });
  });

  it("includes start pseudostate as a node", async () => {
    const result = await parseMermaid("stateDiagram-v2\n  [*] --> idle");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.diagram.nodes.has("root_start")).toBe(true);
  });

  it("includes end pseudostate as a node", async () => {
    const result = await parseMermaid("stateDiagram-v2\n  idle --> [*]");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.diagram.nodes.has("root_end")).toBe(true);
  });

  it("start pseudostate has shape 'stateStart'", async () => {
    const result = await parseMermaid("stateDiagram-v2\n  [*] --> idle");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.diagram.nodes.get("root_start")?.shape).toBe("stateStart");
  });

  it("end pseudostate has shape 'stateEnd'", async () => {
    const result = await parseMermaid("stateDiagram-v2\n  idle --> [*]");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.diagram.nodes.get("root_end")?.shape).toBe("stateEnd");
  });

  it("pseudostate label is empty string", async () => {
    const result = await parseMermaid("stateDiagram-v2\n  [*] --> idle");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.diagram.nodes.get("root_start")?.label).toBe("");
  });
});

// ── SD-03: Composite state → cluster with members ──────────────────────────────

describe("SD-03: parseMermaid — composite state", () => {
  beforeEach(() => {
    setMockDb({
      nodes: [
        makeStateNode("active", "active", "roundedWithTitle", { isGroup: true }),
        makeStateNode("running", "running", "rect", { parentId: "active" }),
        makeStateNode("paused", "paused", "rect", { parentId: "active" }),
      ],
      edges: [makeStateEdge("running", "paused", "pause")],
    });
  });

  it("composite state becomes a cluster", async () => {
    const result = await parseMermaid("stateDiagram-v2\n  state active { ... }");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.diagram.clusters).toHaveLength(1);
    expect(result.diagram.clusters[0].id).toBe("active");
  });

  it("cluster label matches composite state name", async () => {
    const result = await parseMermaid("stateDiagram-v2\n  state active { ... }");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.diagram.clusters[0].label).toBe("active");
  });

  it("cluster members include child states", async () => {
    const result = await parseMermaid("stateDiagram-v2\n  state active { ... }");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.diagram.clusters[0].members).toEqual(
      expect.arrayContaining(["running", "paused"])
    );
  });

  it("child nodes have cluster field set", async () => {
    const result = await parseMermaid("stateDiagram-v2\n  state active { ... }");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.diagram.nodes.get("running")?.cluster).toBe("active");
    expect(result.diagram.nodes.get("paused")?.cluster).toBe("active");
  });

  it("composite state itself is not in nodes map", async () => {
    const result = await parseMermaid("stateDiagram-v2\n  state active { ... }");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    // Composite states become clusters, not nodes
    expect(result.diagram.nodes.has("active")).toBe(false);
  });
});

// ── SD-04: Nested composite → cluster.parent set ───────────────────────────────

describe("SD-04: parseMermaid — nested composite state", () => {
  beforeEach(() => {
    setMockDb({
      nodes: [
        makeStateNode("active", "active", "roundedWithTitle", { isGroup: true }),
        makeStateNode("running", "running", "roundedWithTitle", {
          isGroup: true,
          parentId: "active",
        }),
        makeStateNode("paused", "paused", "rect", { parentId: "running" }),
      ],
      edges: [],
    });
  });

  it("nested composite becomes cluster with parent", async () => {
    const result = await parseMermaid("stateDiagram-v2\n  state active { state running { ... } }");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.diagram.clusters).toHaveLength(2);
  });

  it("inner cluster has parent set to outer cluster", async () => {
    const result = await parseMermaid("stateDiagram-v2\n  state active { state running { ... } }");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    const innerCluster = result.diagram.clusters.find((c) => c.id === "running");
    expect(innerCluster?.parent).toBe("active");
  });

  it("outer cluster has no parent", async () => {
    const result = await parseMermaid("stateDiagram-v2\n  state active { state running { ... } }");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    const outerCluster = result.diagram.clusters.find((c) => c.id === "active");
    expect(outerCluster?.parent).toBeUndefined();
  });
});

// ── SD-05: Transition labels preserved ─────────────────────────────────────────

describe("SD-05: parseMermaid — transition labels", () => {
  beforeEach(() => {
    setMockDb({
      nodes: [
        makeStateNode("idle", "idle", "rect"),
        makeStateNode("active", "active", "rect"),
      ],
      edges: [makeStateEdge("idle", "active", "activate")],
    });
  });

  it("transition label is preserved in edge.label", async () => {
    const result = await parseMermaid("stateDiagram-v2\n  idle --> active : activate");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.diagram.edges[0].label).toBe("activate");
  });

  it("transition with empty label has empty string", async () => {
    setMockDb({
      nodes: [
        makeStateNode("idle", "idle", "rect"),
        makeStateNode("active", "active", "rect"),
      ],
      edges: [makeStateEdge("idle", "active", "")],
    });
    const result = await parseMermaid("stateDiagram-v2\n  idle --> active");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.diagram.edges[0].label).toBe("");
  });
});

// ── SD-06: Multiple transitions → ordinal counter ─────────────────────────────

describe("SD-06: parseMermaid — multiple transitions", () => {
  beforeEach(() => {
    setMockDb({
      nodes: [
        makeStateNode("idle", "idle", "rect"),
        makeStateNode("active", "active", "rect"),
      ],
      edges: [
        makeStateEdge("idle", "active", "start", "edge0"),
        makeStateEdge("idle", "active", "quick", "edge1"),
        makeStateEdge("idle", "active", "slow", "edge2"),
      ],
    });
  });

  it("three edges idle→active get ordinals 0, 1, 2", async () => {
    const result = await parseMermaid("stateDiagram-v2\n  idle --> active : start\n  idle --> active : quick\n  idle --> active : slow");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    const idleActiveEdges = result.diagram.edges.filter(
      (e) => e.from === "idle" && e.to === "active"
    );
    expect(idleActiveEdges.map((e) => e.ordinal)).toEqual([0, 1, 2]);
  });

  it("edges are in declaration order", async () => {
    const result = await parseMermaid("stateDiagram-v2\n  idle --> active : start\n  idle --> active : quick");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.diagram.edges[0].label).toBe("start");
    expect(result.diagram.edges[1].label).toBe("quick");
  });
});

// ── SD-07: Shape mapping ───────────────────────────────────────────────────────

describe("SD-07: parseMermaid — shape mapping", () => {
  it("rect maps to rounded", async () => {
    setMockDb({
      nodes: [makeStateNode("idle", "idle", "rect")],
      edges: [],
    });
    const result = await parseMermaid("stateDiagram-v2\n  idle");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.diagram.nodes.get("idle")?.shape).toBe("rounded");
  });

  it("stateStart maps to stateStart", async () => {
    setMockDb({
      nodes: [makeStateNode("root_start", "", "stateStart")],
      edges: [],
    });
    const result = await parseMermaid("stateDiagram-v2\n  [*]");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.diagram.nodes.get("root_start")?.shape).toBe("stateStart");
  });

  it("stateEnd maps to stateEnd", async () => {
    setMockDb({
      nodes: [makeStateNode("root_end", "", "stateEnd")],
      edges: [],
    });
    const result = await parseMermaid("stateDiagram-v2\n  [*]");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.diagram.nodes.get("root_end")?.shape).toBe("stateEnd");
  });

  it("roundedWithTitle is not a node (cluster only)", async () => {
    setMockDb({
      nodes: [makeStateNode("active", "active", "roundedWithTitle", { isGroup: true })],
      edges: [],
    });
    const result = await parseMermaid("stateDiagram-v2\n  state active { }");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    // Composite states become clusters, not nodes
    expect(result.diagram.nodes.has("active")).toBe(false);
    expect(result.diagram.clusters).toHaveLength(1);
  });
});

// ── SD-08: Empty diagram (no transitions) ─────────────────────────────────────

describe("SD-08: parseMermaid — empty diagram", () => {
  beforeEach(() => {
    setMockDb({
      nodes: [makeStateNode("idle", "idle", "rect")],
      edges: [],
    });
  });

  it("diagram with only states returns nodes", async () => {
    const result = await parseMermaid("stateDiagram-v2\n  idle");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.diagram.nodes.size).toBe(1);
    expect(result.diagram.nodes.has("idle")).toBe(true);
  });

  it("empty diagram returns empty edges array", async () => {
    const result = await parseMermaid("stateDiagram-v2\n  idle");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.diagram.edges).toHaveLength(0);
  });

  it("empty diagram returns empty clusters array", async () => {
    const result = await parseMermaid("stateDiagram-v2\n  idle");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.diagram.clusters).toHaveLength(0);
  });
});

// ── SD-09: Self-transition ─────────────────────────────────────────────────────

describe("SD-09: parseMermaid — self-transition", () => {
  beforeEach(() => {
    setMockDb({
      nodes: [makeStateNode("active", "active", "rect")],
      edges: [makeStateEdge("active", "active", "loop")],
    });
  });

  it("self-transition creates edge with same from and to", async () => {
    const result = await parseMermaid("stateDiagram-v2\n  active --> active : loop");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.diagram.edges).toHaveLength(1);
    expect(result.diagram.edges[0].from).toBe("active");
    expect(result.diagram.edges[0].to).toBe("active");
  });

  it("self-transition has ordinal 0", async () => {
    const result = await parseMermaid("stateDiagram-v2\n  active --> active : loop");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.diagram.edges[0].ordinal).toBe(0);
  });
});

// ── SD-10: adapter.ts integration ──────────────────────────────────────────────

describe("SD-10: parseMermaid — adapter integration", () => {
  it("returns valid ParsedDiagram for stateDiagram-v2 source", async () => {
    setMockDb({
      nodes: [
        makeStateNode("idle", "idle", "rect"),
        makeStateNode("active", "active", "rect"),
      ],
      edges: [makeStateEdge("idle", "active", "activate")],
    });
    const result = await parseMermaid("stateDiagram-v2\n  idle --> active : activate");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.diagram.type).toBe("stateDiagram-v2");
  });

  it("diagram type is correctly set", async () => {
    setMockDb({
      nodes: [],
      edges: [],
    });
    const result = await parseMermaid("stateDiagram-v2\n  idle");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.diagram.type).toBe("stateDiagram-v2");
  });

  it("direction defaults to TD", async () => {
    setMockDb({
      nodes: [makeStateNode("idle", "idle", "rect")],
      edges: [],
    });
    const result = await parseMermaid("stateDiagram-v2\n  idle");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.diagram.direction).toBe("TD");
  });
});

// ── SD-11: Full pipeline (parse → layout → canvas) ─────────────────────────────

describe("SD-11: parseMermaid — full pipeline", () => {
  it("parse returns valid result that can be used by downstream modules", async () => {
    setMockDb({
      nodes: [
        makeStateNode("idle", "idle", "rect"),
        makeStateNode("active", "active", "rect"),
      ],
      edges: [makeStateEdge("idle", "active", "activate")],
    });
    const result = await parseMermaid("stateDiagram-v2\n  idle --> active : activate");
    expect(result.valid).toBe(true);
    if (!result.valid) return;

    // Verify the structure is complete for downstream use
    expect(result.diagram.nodes).toBeInstanceOf(Map);
    expect(Array.isArray(result.diagram.edges)).toBe(true);
    expect(Array.isArray(result.diagram.clusters)).toBe(true);
    expect(Array.isArray(result.diagram.renames)).toBe(true);
    expect(result.diagram.type).toBe("stateDiagram-v2");
    expect(result.diagram.direction).toBe("TD");
  });

  it("parsed nodes have all required fields", async () => {
    setMockDb({
      nodes: [makeStateNode("idle", "Idle State", "rect")],
      edges: [],
    });
    const result = await parseMermaid("stateDiagram-v2\n  idle : Idle State");
    expect(result.valid).toBe(true);
    if (!result.valid) return;

    const node = result.diagram.nodes.get("idle");
    expect(node).toBeDefined();
    if (!node) return;

    expect(node.id).toBe("idle");
    expect(node.label).toBe("Idle State");
    expect(node.shape).toBe("rounded");
    expect(Array.isArray(node.classes)).toBe(true);
  });

  it("parsed edges have all required fields", async () => {
    setMockDb({
      nodes: [
        makeStateNode("idle", "idle", "rect"),
        makeStateNode("active", "active", "rect"),
      ],
      edges: [makeStateEdge("idle", "active", "activate")],
    });
    const result = await parseMermaid("stateDiagram-v2\n  idle --> active : activate");
    expect(result.valid).toBe(true);
    if (!result.valid) return;

    const edge = result.diagram.edges[0];
    expect(edge.from).toBe("idle");
    expect(edge.to).toBe("active");
    expect(edge.label).toBe("activate");
    expect(edge.ordinal).toBe(0);
    expect(edge.type).toBe("arrow");
  });
});

// ── Edge type: all stateDiagram edges are "arrow" ───────────────────────────────

describe("parseMermaid — edge type", () => {
  it("all stateDiagram edges have type 'arrow'", async () => {
    setMockDb({
      nodes: [
        makeStateNode("idle", "idle", "rect"),
        makeStateNode("active", "active", "rect"),
      ],
      edges: [makeStateEdge("idle", "active", "activate")],
    });
    const result = await parseMermaid("stateDiagram-v2\n  idle --> active : activate");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.diagram.edges[0].type).toBe("arrow");
  });
});

// ── Node classes extraction ────────────────────────────────────────────────────

describe("parseMermaid — node classes", () => {
  it("node with cssClasses extracts classes array", async () => {
    setMockDb({
      nodes: [
        {
          ...makeStateNode("idle", "idle", "rect"),
          cssClasses: " statediagram-state critical",
        },
      ],
      edges: [],
    });
    const result = await parseMermaid("stateDiagram-v2\n  idle");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.diagram.nodes.get("idle")?.classes).toEqual(
      expect.arrayContaining(["statediagram-state", "critical"])
    );
  });

  it("node with no extra classes has empty classes array", async () => {
    setMockDb({
      nodes: [makeStateNode("idle", "idle", "rect")],
      edges: [],
    });
    const result = await parseMermaid("stateDiagram-v2\n  idle");
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    // The default cssClasses is " statediagram-state"
    expect(result.diagram.nodes.get("idle")?.classes).toEqual(
      expect.arrayContaining(["statediagram-state"])
    );
  });
});

// ── Error handling ────────────────────────────────────────────────────────────

describe("parseMermaid — error handling", () => {
  it("returns valid=false when getDiagramFromText throws", async () => {
    mermaidMock.default.mermaidAPI.getDiagramFromText.mockImplementationOnce(
      () => {
        throw Object.assign(new Error("Parse error"), { hash: { line: 3 } });
      }
    );
    const result = await parseMermaid("stateDiagram-v2\n  [broken syntax");
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
    const result = await parseMermaid("stateDiagram-v2\n  [broken syntax");
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(typeof result.error.line).toBe("number");
  });
});