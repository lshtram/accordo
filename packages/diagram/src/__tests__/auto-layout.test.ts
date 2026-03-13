/**
 * A4 — Auto-layout tests
 *
 * Tests cover the public contract of computeInitialLayout() in
 * layout/auto-layout.ts.
 *
 * Tests are RED in Phase B (stub throws "not implemented").
 * They turn GREEN in Phase C after implementation.
 *
 * No filesystem access required — computeInitialLayout is a pure CPU function.
 *
 * Requirements: diag_arch_v4.2.md §15.1, diag_workplan.md §5 A4
 * Requirement IDs: AL-01 through AL-12
 */

import { describe, it, expect } from "vitest";
import {
  computeInitialLayout,
  UnsupportedDiagramTypeError,
  type LayoutOptions,
} from "../layout/auto-layout.js";
import type { ParsedDiagram, ParsedNode, ParsedEdge, ParsedCluster, SpatialDiagramType } from "../types.js";

// ── Test fixture helpers ──────────────────────────────────────────────────────

/**
 * Build a ParsedDiagram from minimal ingredients.
 * Mirrors the output of parseMermaid() without requiring the parser to run.
 */
function makeDiagram(
  type: ParsedDiagram["type"] = "flowchart",
  nodes: ParsedNode[] = [],
  edges: ParsedEdge[] = [],
  clusters: ParsedCluster[] = [],
  direction?: "TD" | "LR" | "RL" | "BT"
): ParsedDiagram {
  return {
    type,
    nodes: new Map(nodes.map((n) => [n.id, n])),
    edges,
    clusters,
    renames: [],
    direction,
  };
}

function makeNode(id: string, shape: ParsedNode["shape"] = "rectangle"): ParsedNode {
  return { id, label: id, shape, classes: [] };
}

function makeNodeInCluster(id: string, cluster: string, shape: ParsedNode["shape"] = "rectangle"): ParsedNode {
  return { id, label: id, shape, classes: [], cluster };
}

function makeEdge(from: string, to: string, ordinal = 0): ParsedEdge {
  return { from, to, ordinal, label: "", type: "arrow" };
}

function makeCluster(id: string, members: string[]): ParsedCluster {
  return { id, label: id, members };
}

// ── Realistic fixtures ────────────────────────────────────────────────────────

/**
 * A six-node auth-flow flowchart — same topology as the layout-store rich
 * fixture, but expressed as ParsedDiagram input (before layout).
 *
 * Topology:
 *   gateway → auth_svc (login)
 *   gateway → auth_svc (token-refresh, parallel edge)
 *   auth_svc → user_db
 *   auth_svc → token_store
 *   auth_svc → audit_log (success)
 *   auth_svc → audit_log (failure, parallel edge)
 *
 * Clusters:
 *   frontend_zone: [gateway]
 *   backend_zone:  [auth_svc, user_db, token_store, audit_log, session_cache]
 */
function makeAuthFlowDiagram(): ParsedDiagram {
  const nodes: ParsedNode[] = [
    makeNodeInCluster("gateway",       "frontend_zone", "rectangle"),
    makeNodeInCluster("auth_svc",      "backend_zone",  "rounded"),
    makeNodeInCluster("user_db",       "backend_zone",  "cylinder"),
    makeNodeInCluster("token_store",   "backend_zone",  "cylinder"),
    makeNodeInCluster("audit_log",     "backend_zone",  "rectangle"),
    makeNodeInCluster("session_cache", "backend_zone",  "rectangle"),
  ];
  const edges: ParsedEdge[] = [
    makeEdge("gateway",  "auth_svc",   0),
    makeEdge("gateway",  "auth_svc",   1),  // parallel
    makeEdge("auth_svc", "user_db",    0),
    makeEdge("auth_svc", "token_store",0),
    makeEdge("auth_svc", "audit_log",  0),
    makeEdge("auth_svc", "audit_log",  1),  // parallel
  ];
  const clusters: ParsedCluster[] = [
    makeCluster("frontend_zone", ["gateway"]),
    makeCluster("backend_zone",  ["auth_svc", "user_db", "token_store", "audit_log", "session_cache"]),
  ];
  return makeDiagram("flowchart", nodes, edges, clusters, "TB");
}

/**
 * A class diagram with an inheritance and a composition relationship.
 * Tests that dagre dispatch works for classDiagram type.
 */
function makeClassDiagram(): ParsedDiagram {
  const nodes: ParsedNode[] = [
    makeNode("Animal",    "rectangle"),
    makeNode("Dog",       "rectangle"),
    makeNode("Collar",    "rectangle"),
  ];
  const edges: ParsedEdge[] = [
    { from: "Dog",    to: "Animal", ordinal: 0, label: "extends",    type: "inheritance" },
    { from: "Dog",    to: "Collar", ordinal: 0, label: "has",        type: "composition" },
  ];
  return makeDiagram("classDiagram", nodes, edges, [], "TB");
}

/**
 * A state diagram with a diamond decision node.
 */
function makeStateDiagram(): ParsedDiagram {
  const nodes: ParsedNode[] = [
    makeNode("Idle",       "rounded"),
    makeNode("Processing", "rounded"),
    makeNode("Done",       "rounded"),
    makeNode("Error",      "diamond"),
  ];
  const edges: ParsedEdge[] = [
    makeEdge("Idle",       "Processing", 0),
    makeEdge("Processing", "Error",      0),
    makeEdge("Processing", "Done",       0),
    makeEdge("Error",      "Idle",       0),
  ];
  return makeDiagram("stateDiagram-v2", nodes, edges, [], "TB");
}

// ── 1. Unsupported type dispatch ──────────────────────────────────────────────
// AL-01: block-beta and mindmap throw UnsupportedDiagramTypeError

describe("computeInitialLayout — unsupported types (AL-01)", () => {
  it("AL-01: throws UnsupportedDiagramTypeError for block-beta", () => {
    const parsed = makeDiagram("block-beta", [makeNode("A")]);
    expect(() => computeInitialLayout(parsed)).toThrowError(UnsupportedDiagramTypeError);
  });

  it("AL-01: throws UnsupportedDiagramTypeError for mindmap", () => {
    const parsed = makeDiagram("mindmap", [makeNode("root")]);
    expect(() => computeInitialLayout(parsed)).toThrowError(UnsupportedDiagramTypeError);
  });

  it("AL-01: error message names the diagram type", () => {
    const parsed = makeDiagram("block-beta", [makeNode("A")]);
    expect(() => computeInitialLayout(parsed)).toThrowError(/block-beta/);
  });

  it("AL-01: sequential type (sequenceDiagram) also throws UnsupportedDiagramTypeError", () => {
    const parsed = makeDiagram("sequenceDiagram" as ParsedDiagram["type"], [makeNode("Alice")]);
    expect(() => computeInitialLayout(parsed)).toThrowError(UnsupportedDiagramTypeError);
  });

  it("AL-01: sequential type error message names the type", () => {
    const parsed = makeDiagram("sequenceDiagram" as ParsedDiagram["type"], [makeNode("Alice")]);
    expect(() => computeInitialLayout(parsed)).toThrowError(/sequenceDiagram/);
  });
});

// ── 2. LayoutStore schema — all four dagre-backed types ───────────────────────
// AL-02: version="1.0" and diagram_type matches input

describe("computeInitialLayout — LayoutStore schema (AL-02)", () => {
  const cases = [
    { type: "flowchart"       as const, parsed: makeAuthFlowDiagram() },
    { type: "classDiagram"    as const, parsed: makeClassDiagram()    },
    { type: "stateDiagram-v2" as const, parsed: makeStateDiagram()    },
    { type: "erDiagram"       as const, parsed: makeDiagram("erDiagram", [makeNode("User"), makeNode("Order")], [makeEdge("User","Order",0)]) },
  ];

  for (const { type, parsed } of cases) {
    it(`AL-02: ${type} — version is "1.0"`, () => {
      expect(computeInitialLayout(parsed).version).toBe("1.0");
    });

    it(`AL-02: ${type} — diagram_type matches`, () => {
      expect(computeInitialLayout(parsed).diagram_type).toBe(type as SpatialDiagramType);
    });
  }
});

// ── 3. Node coverage ──────────────────────────────────────────────────────────
// AL-03: every node in parsed.nodes appears in layout.nodes with finite coords

describe("computeInitialLayout — node coverage (AL-03)", () => {
  it("AL-03: every node in the auth-flow diagram gets a layout entry", () => {
    const parsed = makeAuthFlowDiagram();
    const layout = computeInitialLayout(parsed);

    for (const id of parsed.nodes.keys()) {
      const node = layout.nodes[id];
      expect(node, `node "${id}" must appear in layout`).toBeDefined();
      expect(Number.isFinite(node.x), `node "${id}".x must be finite`).toBe(true);
      expect(Number.isFinite(node.y), `node "${id}".y must be finite`).toBe(true);
      expect(node.w).toBeGreaterThan(0);
      expect(node.h).toBeGreaterThan(0);
    }
  });

  it("AL-03: every node in the state diagram gets a layout entry with finite coords", () => {
    const parsed = makeStateDiagram();
    const layout = computeInitialLayout(parsed);

    for (const id of parsed.nodes.keys()) {
      const node = layout.nodes[id];
      expect(node).toBeDefined();
      expect(Number.isFinite(node.x)).toBe(true);
      expect(Number.isFinite(node.y)).toBe(true);
    }
  });
});

// ── 4. Edge coverage ──────────────────────────────────────────────────────────
// AL-04: every edge appears in layout.edges with routing="auto", empty waypoints

describe("computeInitialLayout — edge coverage (AL-04)", () => {
  it("AL-04: all six auth-flow edges appear in layout.edges", () => {
    const parsed = makeAuthFlowDiagram();
    const layout = computeInitialLayout(parsed);

    const expectedKeys = [
      "gateway->auth_svc:0",
      "gateway->auth_svc:1",
      "auth_svc->user_db:0",
      "auth_svc->token_store:0",
      "auth_svc->audit_log:0",
      "auth_svc->audit_log:1",
    ];

    for (const key of expectedKeys) {
      const edge = layout.edges[key];
      expect(edge, `edge "${key}" must appear in layout`).toBeDefined();
      expect(edge.routing).toBe("auto");
      expect(edge.waypoints).toEqual([]);
    }
  });

  it("AL-04: layout.edges count equals parsed.edges.length", () => {
    const parsed = makeAuthFlowDiagram();
    const layout = computeInitialLayout(parsed);
    expect(Object.keys(layout.edges)).toHaveLength(parsed.edges.length);
  });
});

// ── 5. Default node dimensions per shape ─────────────────────────────────────
// AL-05: rectangle 180×60, diamond 140×80, circle 80×80, cylinder 120×80

describe("computeInitialLayout — default node dimensions (AL-05)", () => {
  it("AL-05: rectangle defaults to 180×60", () => {
    const parsed = makeDiagram("flowchart", [makeNode("A", "rectangle")]);
    const layout = computeInitialLayout(parsed);
    expect(layout.nodes["A"].w).toBe(180);
    expect(layout.nodes["A"].h).toBe(60);
  });

  it("AL-05: diamond defaults to 140×80", () => {
    const parsed = makeDiagram("flowchart", [makeNode("D", "diamond")]);
    const layout = computeInitialLayout(parsed);
    expect(layout.nodes["D"].w).toBe(140);
    expect(layout.nodes["D"].h).toBe(80);
  });

  it("AL-05: circle defaults to 80×80", () => {
    const parsed = makeDiagram("flowchart", [makeNode("C", "circle")]);
    const layout = computeInitialLayout(parsed);
    expect(layout.nodes["C"].w).toBe(80);
    expect(layout.nodes["C"].h).toBe(80);
  });

  it("AL-05: cylinder defaults to 120×80", () => {
    const parsed = makeDiagram("flowchart", [makeNode("DB", "cylinder")]);
    const layout = computeInitialLayout(parsed);
    expect(layout.nodes["DB"].w).toBe(120);
    expect(layout.nodes["DB"].h).toBe(80);
  });

  it("AL-05: unknown shape falls back to rectangle (180×60)", () => {
    const parsed = makeDiagram("flowchart", [makeNode("X", "hexagon")]);
    const layout = computeInitialLayout(parsed);
    expect(layout.nodes["X"].w).toBe(180);
    expect(layout.nodes["X"].h).toBe(60);
  });
});

// ── 6. rankdir option ─────────────────────────────────────────────────────────
// AL-06: LR and TB produce detectably different coordinate distributions
// for a vertical chain A→B→C: TB → nodes differ in y; LR → nodes differ in x

describe("computeInitialLayout — rankdir option (AL-06)", () => {
  function makeChain(): ParsedDiagram {
    return makeDiagram(
      "flowchart",
      [makeNode("A"), makeNode("B"), makeNode("C")],
      [makeEdge("A", "B", 0), makeEdge("B", "C", 0)]
    );
  }

  it("AL-06: TB layout has nodes at different y values (layered downward)", () => {
    const layout = computeInitialLayout(makeChain(), { rankdir: "TB" });
    const ys = ["A", "B", "C"].map((id) => layout.nodes[id].y);
    // All three at distinct y values — not all the same row
    const unique = new Set(ys);
    expect(unique.size).toBeGreaterThan(1);
  });

  it("AL-06: LR layout has nodes at different x values (layered rightward)", () => {
    const layout = computeInitialLayout(makeChain(), { rankdir: "LR" });
    const xs = ["A", "B", "C"].map((id) => layout.nodes[id].x);
    const unique = new Set(xs);
    expect(unique.size).toBeGreaterThan(1);
  });

  it("AL-06: LR layout — A, B, C are ordered left to right (x increases along the chain)", () => {
    const layout = computeInitialLayout(makeChain(), { rankdir: "LR" });
    const xA = layout.nodes["A"].x;
    const xB = layout.nodes["B"].x;
    const xC = layout.nodes["C"].x;
    expect(xA).toBeLessThan(xB);
    expect(xB).toBeLessThan(xC);
  });

  it("AL-06: erDiagram defaults to LR without explicit options (diag_arch_v4.2.md §15.1)", () => {
    // Three-entity ER chain: User -|--|- Order -|--|- Product
    const parsed = makeDiagram(
      "erDiagram",
      [makeNode("User"), makeNode("Order"), makeNode("Product")],
      [makeEdge("User", "Order", 0), makeEdge("Order", "Product", 0)]
    );
    // No options — erDiagram's default rankdir is LR, so x values must spread
    const layout = computeInitialLayout(parsed);
    const xs = ["User", "Order", "Product"].map((id) => layout.nodes[id].x);
    expect(new Set(xs).size).toBeGreaterThan(1);
  });
});

// ── 7. nodeSpacing and rankSpacing ────────────────────────────────────────────
// AL-07: larger spacing values produce larger coordinate differences between nodes

describe("computeInitialLayout — spacing options (AL-07)", () => {
  function makeTwoNodes(): ParsedDiagram {
    return makeDiagram(
      "flowchart",
      [makeNode("A"), makeNode("B")],
      [makeEdge("A", "B", 0)]
    );
  }

  it("AL-07: larger rankSpacing produces larger y gap in TB layout", () => {
    const tight  = computeInitialLayout(makeTwoNodes(), { rankdir: "TB", rankSpacing:  40 });
    const spread = computeInitialLayout(makeTwoNodes(), { rankdir: "TB", rankSpacing: 200 });

    const gapTight  = Math.abs(tight.nodes["B"].y  - tight.nodes["A"].y);
    const gapSpread = Math.abs(spread.nodes["B"].y - spread.nodes["A"].y);
    expect(gapSpread).toBeGreaterThan(gapTight);
  });
});

// ── 8. Cluster bounding boxes ─────────────────────────────────────────────────
// AL-08: cluster layout entry exists and encloses all member node centres

describe("computeInitialLayout — cluster bounding boxes (AL-08)", () => {
  it("AL-08: both clusters in the auth-flow diagram have layout entries", () => {
    const parsed = makeAuthFlowDiagram();
    const layout = computeInitialLayout(parsed);

    expect(layout.clusters["frontend_zone"]).toBeDefined();
    expect(layout.clusters["backend_zone"]).toBeDefined();
  });

  it("AL-08: cluster has positive dimensions", () => {
    const parsed = makeAuthFlowDiagram();
    const layout = computeInitialLayout(parsed);

    const fe = layout.clusters["frontend_zone"];
    expect(fe.w).toBeGreaterThan(0);
    expect(fe.h).toBeGreaterThan(0);
  });

  it("AL-08: cluster bounding box encloses all member node centres", () => {
    const parsed = makeAuthFlowDiagram();
    const layout = computeInitialLayout(parsed);

    // backend_zone has 5 members — verify each is within the cluster bounds
    const c = layout.clusters["backend_zone"];
    const members = ["auth_svc", "user_db", "token_store", "audit_log", "session_cache"];
    for (const id of members) {
      const n = layout.nodes[id];
      expect(n.x, `${id}.x within cluster x-range`).toBeGreaterThanOrEqual(c.x);
      expect(n.x, `${id}.x within cluster x-range`).toBeLessThanOrEqual(c.x + c.w);
      expect(n.y, `${id}.y within cluster y-range`).toBeGreaterThanOrEqual(c.y);
      expect(n.y, `${id}.y within cluster y-range`).toBeLessThanOrEqual(c.y + c.h);
    }
  });
});

// ── 9. Empty diagram ──────────────────────────────────────────────────────────
// AL-09: zero nodes → empty LayoutStore, not an error

describe("computeInitialLayout — empty diagram (AL-09)", () => {
  it("AL-09: empty flowchart returns a valid empty LayoutStore", () => {
    const parsed = makeDiagram("flowchart");
    const layout = computeInitialLayout(parsed);

    expect(layout.version).toBe("1.0");
    expect(layout.diagram_type).toBe("flowchart");
    expect(Object.keys(layout.nodes)).toHaveLength(0);
    expect(Object.keys(layout.edges)).toHaveLength(0);
  });
});

// ── 10. Nodes with no edges ───────────────────────────────────────────────────
// AL-10: disconnected nodes still get placed

describe("computeInitialLayout — disconnected nodes (AL-10)", () => {
  it("AL-10: three unconnected nodes all receive finite positions", () => {
    const parsed = makeDiagram("flowchart", [makeNode("X"), makeNode("Y"), makeNode("Z")]);
    const layout = computeInitialLayout(parsed);

    for (const id of ["X", "Y", "Z"]) {
      expect(layout.nodes[id]).toBeDefined();
      expect(Number.isFinite(layout.nodes[id].x)).toBe(true);
      expect(Number.isFinite(layout.nodes[id].y)).toBe(true);
    }
  });
});

// ── 11. Parallel edges ────────────────────────────────────────────────────────
// AL-11: both ordinals of a parallel edge pair appear in layout

describe("computeInitialLayout — parallel edges (AL-11)", () => {
  it("AL-11: both gateway->auth_svc ordinals (0 and 1) appear in layout", () => {
    const parsed = makeAuthFlowDiagram();
    const layout = computeInitialLayout(parsed);

    expect(layout.edges["gateway->auth_svc:0"]).toBeDefined();
    expect(layout.edges["gateway->auth_svc:1"]).toBeDefined();
  });

  it("AL-11: both auth_svc->audit_log ordinals appear in layout", () => {
    const parsed = makeAuthFlowDiagram();
    const layout = computeInitialLayout(parsed);

    expect(layout.edges["auth_svc->audit_log:0"]).toBeDefined();
    expect(layout.edges["auth_svc->audit_log:1"]).toBeDefined();
  });
});

// ── 12. Aesthetics defaults ───────────────────────────────────────────────────
// AL-12: returned LayoutStore has hand-drawn aesthetic defaults

describe("computeInitialLayout — aesthetics defaults (AL-12)", () => {
  it("AL-12: roughness defaults to 1 (hand-drawn)", () => {
    expect(computeInitialLayout(makeAuthFlowDiagram()).aesthetics.roughness).toBe(1);
  });

  it("AL-12: animationMode defaults to 'static' (draw-on deferred to diag.2)", () => {
    expect(computeInitialLayout(makeAuthFlowDiagram()).aesthetics.animationMode).toBe("static");
  });
});
