/**
 * Element Mapper — tests for label→NodeId matching, geometry extraction,
 * and deterministic fallback behavior.
 *
 * These tests validate the approved design in:
 *   docs/30-development/diagram-update-plan.md §7.2
 *
 * Tests are RED on stubs (each function throws "not implemented").
 * They turn GREEN after Phase C implementation.
 *
 * Requirements:
 *   ELM-01: extractGeometry() accepts unknown[] and returns UpstreamGeometry[]
 *   ELM-02: extractGeometry() filters to supported shape types
 *   ELM-03: mapGeometryToLayout() builds label→NodeId[] reverse index
 *   ELM-04: duplicate labels match in declaration order (deterministic)
 *   ELM-05: unmatched nodes appear in unmatchedNodeIds
 *   ELM-06: ambiguous geometry produces a warning
 *   ELM-07: cluster geometry matched by subgraph label
 */

import { describe, it, expect } from "vitest";
import {
  extractGeometry,
  mapGeometryToLayout,
  type UpstreamGeometry,
} from "../layout/element-mapper.js";
import type { ParsedDiagram, ParsedNode, ParsedEdge, ParsedCluster } from "../types.js";

// ── Fixture helpers ─────────────────────────────────────────────────────────────

function makeDiagram(
  type: ParsedDiagram["type"] = "flowchart",
  nodes: ParsedNode[] = [],
  edges: ParsedEdge[] = [],
  clusters: ParsedCluster[] = [],
): ParsedDiagram {
  return {
    type,
    nodes: new Map(nodes.map((n) => [n.id, n])),
    edges,
    clusters,
    renames: [],
  };
}

function makeNode(id: string, label: string = id, shape: ParsedNode["shape"] = "rectangle"): ParsedNode {
  return { id, label, shape, classes: [] };
}

function makeEdge(from: string, to: string, ordinal = 0): ParsedEdge {
  return { from, to, ordinal, label: "", type: "arrow" };
}

function makeCluster(id: string, label: string, members: string[]): ParsedCluster {
  return { id, label, members };
}

// ── ELM-01: extractGeometry accepts unknown[] ───────────────────────────────────

describe("extractGeometry — ELM-01: accepts unknown[] boundary", () => {
  it("ELM-01: returns UpstreamGeometry[] for empty input", () => {
    // The function signature accepts readonly unknown[] — passing []
    // validates the empty-array path.
    const result = extractGeometry([]);
    expect(Array.isArray(result)).toBe(true);
  });

  it("ELM-01: returns UpstreamGeometry[] for mixed unknown[] input", () => {
    const skeletons: readonly unknown[] = [
      { type: "rectangle", x: 10, y: 20, width: 100, height: 60, label: "A" },
      null,
      { type: "text", x: 0, y: 0, width: 0, height: 0, label: "B" },
      { type: "rectangle", x: 30, y: 40, width: 80, height: 40, label: "C" },
    ];
    const result = extractGeometry(skeletons);
    expect(Array.isArray(result)).toBe(true);
  });

  it("ELM-01: filters to supported shape types only", () => {
    // Mock ExcalidrawElementSkeleton[] with shape-like and non-shape elements
    const skeletons: readonly unknown[] = [
      // Supported shape — should appear
      { type: "rectangle", x: 10, y: 20, width: 100, height: 60, label: "Node1" },
      // Unsupported — should not appear
      { type: "text", x: 0, y: 0, width: 0, height: 0, label: "just text" },
      { type: "arrow", x: 0, y: 0, width: 0, height: 0, label: "an arrow" },
      // Supported — diamond
      { type: "diamond", x: 50, y: 50, width: 80, height: 80, label: "Decision" },
      // Unsupported — line
      { type: "line", x: 0, y: 0, width: 0, height: 0, label: "" },
      // Supported — ellipse
      { type: "ellipse", x: 200, y: 200, width: 90, height: 50, label: "End" },
    ];
    const result = extractGeometry(skeletons);
    // Only rectangle, diamond, ellipse should be included
    expect(result.length).toBe(3);
    const labels = result.map((g) => g.label);
    expect(labels).toContain("Node1");
    expect(labels).toContain("Decision");
    expect(labels).toContain("End");
  });

  it("ELM-01: extracts x, y, width, height, label, type, groupId from each entry", () => {
    const skeletons: readonly unknown[] = [
      {
        type: "rectangle",
        x: 100,
        y: 200,
        width: 180,
        height: 60,
        label: "auth_svc",
        groupId: "g1",
      },
    ];
    const [geo] = extractGeometry(skeletons);
    expect(geo.label).toBe("auth_svc");
    expect(geo.x).toBe(100);
    expect(geo.y).toBe(200);
    expect(geo.width).toBe(180);
    expect(geo.height).toBe(60);
    expect(geo.type).toBe("rectangle");
    expect(geo.groupId).toBe("g1");
  });

  it("ELM-01: elements without a label text property are excluded", () => {
    // Shape element without a label text — no label property at all
    const skeletons: readonly unknown[] = [
      { type: "rectangle", x: 10, y: 10, width: 100, height: 50 }, // no label
      { type: "rectangle", x: 20, y: 20, width: 80, height: 40, label: "HasLabel" },
    ];
    const result = extractGeometry(skeletons);
    // Entry without label is excluded
    expect(result.find((g) => g.label === "HasLabel")).toBeDefined();
    expect(result.find((g) => !g.label || g.label === "")).toBeUndefined();
  });
});

// ── ELM-03 / ELM-04: mapGeometryToLayout label→NodeId matching ────────────────

describe("mapGeometryToLayout — ELM-03: label→NodeId reverse index", () => {
  it("ELM-03: single label matches the unique node by ID", () => {
    const parsed = makeDiagram("flowchart", [
      makeNode("nodeA", "Start"),
      makeNode("nodeB", "End"),
    ]);
    const geometries: UpstreamGeometry[] = [
      { label: "Start", x: 10, y: 20, width: 100, height: 60 },
      { label: "End",   x: 200, y: 20, width: 100, height: 60 },
    ];
    const result = mapGeometryToLayout(geometries, parsed);

    expect(result.nodes["nodeA"]).toBeDefined();
    expect(result.nodes["nodeA"]!.x).toBe(10);
    expect(result.nodes["nodeA"]!.y).toBe(20);
    expect(result.nodes["nodeB"]!.x).toBe(200);
    expect(result.nodes["nodeB"]!.y).toBe(20);
  });

  it("ELM-03: label text not in parsed.nodes is not matched", () => {
    const parsed = makeDiagram("flowchart", [makeNode("nodeA", "Alpha")]);
    const geometries: UpstreamGeometry[] = [
      { label: "Alpha",   x: 10, y: 20, width: 100, height: 60 },
      { label: "Unknown", x: 50, y: 60, width: 80,  height: 40 },
    ];
    const result = mapGeometryToLayout(geometries, parsed);

    // "Alpha" matches nodeA; "Unknown" has no corresponding node in parsed.nodes
    expect(result.nodes["nodeA"]).toBeDefined();
    // "Unknown" is a geometry label, not a NodeId — it must NOT appear in unmatchedNodeIds
    // (unmatchedNodeIds only contains Node IDs from the parsed diagram)
    expect(result.unmatchedNodeIds).not.toContain("Unknown");
  });

  it("ELM-04: duplicate labels match in declaration order", () => {
    // Two nodes share the same label "Service"
    const parsed = makeDiagram("flowchart", [
      makeNode("svc1", "Service"),
      makeNode("svc2", "Service"),
      makeNode("svc3", "Service"),
    ]);
    // Upstream returns three geometries all with label "Service"
    const geometries: UpstreamGeometry[] = [
      { label: "Service", x: 10,  y: 10, width: 80, height: 40 },
      { label: "Service", x: 100, y: 10, width: 80, height: 40 },
      { label: "Service", x: 190, y: 10, width: 80, height: 40 },
    ];
    const result = mapGeometryToLayout(geometries, parsed);

    // Declaration order: svc1→svc2→svc3 should map to the geometry order
    expect(result.nodes["svc1"]!.x).toBe(10);
    expect(result.nodes["svc2"]!.x).toBe(100);
    expect(result.nodes["svc3"]!.x).toBe(190);
  });

  it("ELM-04: more geometries than nodes — extra geometries produce no matched entry", () => {
    const parsed = makeDiagram("flowchart", [
      makeNode("n1", "Dup"),
      makeNode("n2", "Dup"),
    ]);
    const geometries: UpstreamGeometry[] = [
      { label: "Dup", x: 10, y: 10, width: 50, height: 30 },
      { label: "Dup", x: 70, y: 10, width: 50, height: 30 },
      { label: "Dup", x: 130, y: 10, width: 50, height: 30 }, // extra geometry
    ];
    const result = mapGeometryToLayout(geometries, parsed);

    // First two geometries matched to n1 and n2; third has no node to match
    expect(Object.keys(result.nodes)).toHaveLength(2);
    // "Dup" is a geometry label, not a NodeId — it must NOT appear in unmatchedNodeIds
    expect(result.unmatchedNodeIds).not.toContain("Dup");
  });

  it("ELM-04: more nodes than geometries — remaining nodes unmatched", () => {
    const parsed = makeDiagram("flowchart", [
      makeNode("n1", "Label"),
      makeNode("n2", "Label"),
      makeNode("n3", "Label"),
    ]);
    const geometries: UpstreamGeometry[] = [
      { label: "Label", x: 10, y: 10, width: 80, height: 40 },
    ];
    const result = mapGeometryToLayout(geometries, parsed);

    // Only n1 is matched; n2 and n3 have no upstream geometry
    expect(result.nodes["n1"]).toBeDefined();
    // n2 and n3 are Node IDs without geometry — they must be in unmatchedNodeIds
    expect(result.unmatchedNodeIds).toContain("n2");
    expect(result.unmatchedNodeIds).toContain("n3");
  });
});

// ── ELM-05: unmatched nodes ─────────────────────────────────────────────────────

describe("mapGeometryToLayout — ELM-05: unmatched nodes reported", () => {
  it("ELM-05: node with no upstream geometry appears in unmatchedNodeIds", () => {
    const parsed = makeDiagram("flowchart", [
      makeNode("placed_one", "Alpha"),
      makeNode("orphan",     "Beta"),
    ]);
    const geometries: UpstreamGeometry[] = [
      // Only Alpha is provided by upstream; Beta has no geometry
      { label: "Alpha", x: 10, y: 10, width: 80, height: 40 },
    ];
    const result = mapGeometryToLayout(geometries, parsed);

    expect(result.nodes["placed_one"]).toBeDefined();
    // "orphan" is a Node ID — it must appear in unmatchedNodeIds
    expect(result.unmatchedNodeIds).toContain("orphan");
  });

  it("ELM-05: completely empty geometries array — all nodes unmatched", () => {
    const parsed = makeDiagram("flowchart", [
      makeNode("nodeA", "A"),
      makeNode("nodeB", "B"),
    ]);
    const result = mapGeometryToLayout([], parsed);

    expect(Object.keys(result.nodes)).toHaveLength(0);
    expect(result.unmatchedNodeIds).toContain("nodeA");
    expect(result.unmatchedNodeIds).toContain("nodeB");
  });
});

// ── ELM-06: warnings ────────────────────────────────────────────────────────────

describe("mapGeometryToLayout — ELM-06: warnings for ambiguous/unmatched geometry", () => {
  it("ELM-06: unknown upstream label (no matching node) emits a warning", () => {
    const parsed = makeDiagram("flowchart", [
      makeNode("realNode", "Real"),
    ]);
    const geometries: UpstreamGeometry[] = [
      { label: "Real",    x: 10, y: 10, width: 80, height: 40 },
      { label: "Unknown",  x: 50, y: 50, width: 40, height: 20 },
    ];
    const result = mapGeometryToLayout(geometries, parsed);

    expect(result.warnings.some((w) => w.includes("Unknown"))).toBe(true);
  });
});

// ── ELM-07: cluster geometry ────────────────────────────────────────────────────

describe("mapGeometryToLayout — ELM-07: cluster geometry matched by subgraph label", () => {
  it("ELM-07: upstream element with groupId matches a cluster by label", () => {
    const parsed = makeDiagram("flowchart", [
      makeNode("n1", "Node1"),
      makeNode("n2", "Node2"),
    ], [], [
      makeCluster("clusterX", "Backend Services", ["n1", "n2"]),
    ]);

    const geometries: UpstreamGeometry[] = [
      { label: "Node1", x: 10, y: 10, width: 80, height: 40 },
      { label: "Node2", x: 100, y: 10, width: 80, height: 40 },
      // A groupId element represents a cluster/group boundary
      { label: "Backend Services", x: 0, y: 0, width: 300, height: 200, groupId: "g1" },
    ];
    const result = mapGeometryToLayout(geometries, parsed);

    // Bounds are normalized to Accordo conventions (CLUSTER_MARGIN=20,
    // CLUSTER_LABEL_HEIGHT=28) — same formula as recomputeClusterBox in
    // auto-layout.ts, so excalidraw and dagre cluster bounds are consistent.
    // Member nodes: n1 at (10,10) 80x40 → right=90 bottom=50
    //               n2 at (100,10) 80x40 → right=180 bottom=50
    // lefts=[10,100], tops=[10,10], rights=[90,180], bottoms=[50,50]
    // normalized: x=10-20=-10, y=10-20-28=-38, w=170+40=210, h=40+40+28=108
    expect(result.clusters["clusterX"]).toBeDefined();
    expect(result.clusters["clusterX"]!.x).toBe(-10);
    expect(result.clusters["clusterX"]!.y).toBe(-38);
    expect(result.clusters["clusterX"]!.w).toBe(210);
    expect(result.clusters["clusterX"]!.h).toBe(108);
  });

  it("ELM-07: cluster geometry requires groupId to be matched (label alone not sufficient)", () => {
    const parsed = makeDiagram("flowchart", [
      makeNode("n1", "Inside"),
    ], [], [
      makeCluster("c1", "MyCluster", ["n1"]),
    ]);

    // Upstream geometry with matching label but NO groupId
    // should not create a cluster layout entry (since we can't distinguish
    // a cluster label from a regular node label without groupId)
    const geometries: UpstreamGeometry[] = [
      { label: "Inside",    x: 50, y: 50, width: 80, height: 40 },
      { label: "MyCluster", x: 0,  y: 0,  width: 200, height: 150 }, // no groupId
    ];
    const result = mapGeometryToLayout(geometries, parsed);

    // Without groupId, the label should not create a cluster entry
    // (it could be a node with the same label as the cluster)
    expect(result.clusters["c1"]).toBeUndefined();
  });

  it("ELM-07: nested clusters matched by groupId hierarchy", () => {
    const parsed = makeDiagram("flowchart", [
      makeNode("innerNode", "Inner"),
    ], [], [
      makeCluster("outer", "OuterCluster", ["inner"]),
      makeCluster("inner", "InnerCluster", ["innerNode"]),
    ]);

    const geometries: UpstreamGeometry[] = [
      { label: "Inner", x: 100, y: 100, width: 60, height: 40 },
      { label: "InnerCluster", x: 50, y: 50, width: 160, height: 120, groupId: "gid_inner" },
      { label: "OuterCluster", x: 0, y: 0, width: 260, height: 220, groupId: "gid_outer" },
    ];
    const result = mapGeometryToLayout(geometries, parsed);

    // inner cluster (members: innerNode at (100,100) 60x40):
    //   x=100-20=80, y=100-20-28=52, w=60+40=100, h=40+40+28=108
    expect(result.clusters["inner"]).toBeDefined();
    expect(result.clusters["inner"]!.x).toBe(80);
    expect(result.clusters["inner"]!.y).toBe(52);
    expect(result.clusters["inner"]!.w).toBe(100);
    expect(result.clusters["inner"]!.h).toBe(108);

    // outer cluster (members: inner cluster at (80,52) 100x108):
    //   lefts=[80], rights=[180], tops=[52], bottoms=[160]
    //   x=80-20=60, y=52-20-28=4, w=100+40=140, h=108+40+28=176
    expect(result.clusters["outer"]).toBeDefined();
    expect(result.clusters["outer"]!.x).toBe(60);
    expect(result.clusters["outer"]!.y).toBe(4);
    expect(result.clusters["outer"]!.w).toBe(140);
    expect(result.clusters["outer"]!.h).toBe(176);
  });
});

// ── ELM-02: extractGeometry filters supported types ─────────────────────────────

describe("extractGeometry — ELM-02: filters to supported shape types", () => {
  it("ELM-02: supported types are rectangle, diamond, ellipse, circle", () => {
    const supported = [
      { type: "rectangle", x: 0, y: 0, width: 10, height: 10, label: "r" },
      { type: "diamond",    x: 0, y: 0, width: 10, height: 10, label: "d" },
      { type: "ellipse",    x: 0, y: 0, width: 10, height: 10, label: "e" },
      { type: "circle",    x: 0, y: 0, width: 10, height: 10, label: "c" },
    ];
    const result = extractGeometry(supported as readonly unknown[]);
    expect(result).toHaveLength(4);
  });

  it("ELM-02: text, arrow, line, freedraw are excluded", () => {
    const excluded = [
      { type: "text",     x: 0, y: 0, width: 10, height: 10, label: "t" },
      { type: "arrow",    x: 0, y: 0, width: 10, height: 10, label: "a" },
      { type: "line",     x: 0, y: 0, width: 10, height: 10, label: "l" },
      { type: "freedraw", x: 0, y: 0, width: 10, height: 10, label: "f" },
      { type: "rectangle", x: 0, y: 0, width: 10, height: 10, label: "r" }, // included
    ];
    const result = extractGeometry(excluded as readonly unknown[]);
    expect(result).toHaveLength(1);
    expect(result[0]!.label).toBe("r");
  });

  it("ELM-02: unknown type is excluded (not passed through as-is)", () => {
    const unknown: readonly unknown[] = [
      { type: "hexagon", x: 0, y: 0, width: 10, height: 10, label: "h" },
      { type: "rectangle", x: 0, y: 0, width: 10, height: 10, label: "r" },
    ];
    const result = extractGeometry(unknown);
    // Only rectangle is known supported; hexagon should be filtered out
    expect(result).toHaveLength(1);
    expect(result[0]!.label).toBe("r");
  });
});

// ── MappingResult shape ────────────────────────────────────────────────────────

describe("mapGeometryToLayout — returns correct MappingResult shape", () => {
  it("returns nodes, clusters, unmatchedNodeIds, warnings fields", () => {
    const parsed = makeDiagram("flowchart", []);
    const result = mapGeometryToLayout([], parsed);

    expect(typeof result.nodes).toBe("object");
    expect(typeof result.clusters).toBe("object");
    expect(Array.isArray(result.unmatchedNodeIds)).toBe(true);
    expect(Array.isArray(result.warnings)).toBe(true);
  });

  it("nodes and clusters values have x, y, w, h, style fields", () => {
    const parsed = makeDiagram("flowchart", [makeNode("n1", "NodeOne")]);
    const geometries: UpstreamGeometry[] = [
      { label: "NodeOne", x: 10, y: 20, width: 100, height: 60 },
    ];
    const result = mapGeometryToLayout(geometries, parsed);

    const node = result.nodes["n1"];
    expect(node).toBeDefined();
    expect(typeof node.x).toBe("number");
    expect(typeof node.y).toBe("number");
    expect(typeof node.w).toBe("number");
    expect(typeof node.h).toBe("number");
    expect(typeof node.style).toBe("object");
  });
});
