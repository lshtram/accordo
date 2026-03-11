/**
 * A1 — type compilation tests
 *
 * These tests verify that the exported types satisfy the structural
 * contracts defined in diag_arch_v4.2.md §4, §5, §6, §7.
 * They cannot fail at runtime (no assertions on runtime values) — if
 * the types are wrong the file will not compile.
 *
 * Requirements:
 *   §4  Identity model
 *   §5  Layout store schema
 *   §6  Parser adapter types
 *   §7  Reconciler result
 */

import { describe, it, expectTypeOf } from "vitest";
import type {
  DiagramType,
  SpatialDiagramType,
  SequentialDiagramType,
  NodeId,
  EdgeKey,
  ClusterId,
  RenameAnnotation,
  LayoutStore,
  NodeLayout,
  EdgeLayout,
  ClusterLayout,
  NodeStyle,
  EdgeStyle,
  ClusterStyle,
  AestheticsConfig,
  NodeSizing,
  NodeShape,
  EdgeType,
  ParsedDiagram,
  ParsedNode,
  ParsedEdge,
  ParsedCluster,
  ParseResult,
  ReconcileResult,
} from "../types.js";

// ── §4 Identity ───────────────────────────────────────────────────────────────

describe("DiagramType", () => {
  it("SpatialDiagramType is a subtype of DiagramType", () => {
    expectTypeOf<SpatialDiagramType>().toMatchTypeOf<DiagramType>();
  });

  it("SequentialDiagramType is a subtype of DiagramType", () => {
    expectTypeOf<SequentialDiagramType>().toMatchTypeOf<DiagramType>();
  });

  it("SpatialDiagramType includes all 6 spatial types", () => {
    const types: SpatialDiagramType[] = [
      "flowchart",
      "block-beta",
      "classDiagram",
      "stateDiagram-v2",
      "erDiagram",
      "mindmap",
    ];
    expectTypeOf(types).toMatchTypeOf<SpatialDiagramType[]>();
  });

  it("SequentialDiagramType includes all 5 sequential types", () => {
    const types: SequentialDiagramType[] = [
      "sequenceDiagram",
      "gantt",
      "gitGraph",
      "timeline",
      "quadrantChart",
    ];
    expectTypeOf(types).toMatchTypeOf<SequentialDiagramType[]>();
  });

  it("NodeId, EdgeKey, ClusterId are all string-assignable", () => {
    expectTypeOf<NodeId>().toMatchTypeOf<string>();
    expectTypeOf<EdgeKey>().toMatchTypeOf<string>();
    expectTypeOf<ClusterId>().toMatchTypeOf<string>();
  });

  it("RenameAnnotation has oldId and newId fields", () => {
    const r: RenameAnnotation = { oldId: "a", newId: "b" };
    expectTypeOf(r.oldId).toMatchTypeOf<NodeId>();
    expectTypeOf(r.newId).toMatchTypeOf<NodeId>();
  });
});

// ── §5 Layout store ───────────────────────────────────────────────────────────

describe("LayoutStore", () => {
  it("version field is the literal string '1.0'", () => {
    type V = LayoutStore["version"];
    expectTypeOf<V>().toEqualTypeOf<"1.0">();
  });

  it("nodes is a Record keyed by NodeId", () => {
    expectTypeOf<LayoutStore["nodes"]>().toMatchTypeOf<
      Record<NodeId, NodeLayout>
    >();
  });

  it("edges is a Record keyed by EdgeKey", () => {
    expectTypeOf<LayoutStore["edges"]>().toMatchTypeOf<
      Record<EdgeKey, EdgeLayout>
    >();
  });

  it("clusters is a Record keyed by ClusterId", () => {
    expectTypeOf<LayoutStore["clusters"]>().toMatchTypeOf<
      Record<ClusterId, ClusterLayout>
    >();
  });

  it("unplaced is an array of NodeId", () => {
    expectTypeOf<LayoutStore["unplaced"]>().toMatchTypeOf<NodeId[]>();
  });

  it("aesthetics is AestheticsConfig", () => {
    expectTypeOf<LayoutStore["aesthetics"]>().toMatchTypeOf<AestheticsConfig>();
  });
});

describe("NodeLayout", () => {
  it("has required numeric position and size fields", () => {
    expectTypeOf<NodeLayout["x"]>().toEqualTypeOf<number>();
    expectTypeOf<NodeLayout["y"]>().toEqualTypeOf<number>();
    expectTypeOf<NodeLayout["w"]>().toEqualTypeOf<number>();
    expectTypeOf<NodeLayout["h"]>().toEqualTypeOf<number>();
  });

  it("seed is optional number", () => {
    expectTypeOf<NodeLayout["seed"]>().toEqualTypeOf<number | undefined>();
  });

  it("style is NodeStyle", () => {
    expectTypeOf<NodeLayout["style"]>().toMatchTypeOf<NodeStyle>();
  });
});

describe("EdgeLayout", () => {
  it("routing accepts 'auto'", () => {
    const e: EdgeLayout = { routing: "auto", waypoints: [], style: {} };
    expectTypeOf(e.routing).toMatchTypeOf<string>();
  });

  it("waypoints is a readonly array of {x,y}", () => {
    type WP = EdgeLayout["waypoints"];
    expectTypeOf<WP[number]>().toMatchTypeOf<{ x: number; y: number }>();
  });
});

describe("AestheticsConfig", () => {
  it("roughness is optional number", () => {
    expectTypeOf<AestheticsConfig["roughness"]>().toEqualTypeOf<
      number | undefined
    >();
  });

  it("animationMode is optional union", () => {
    expectTypeOf<AestheticsConfig["animationMode"]>().toEqualTypeOf<
      "draw-on" | "static" | undefined
    >();
  });
});

describe("NodeSizing", () => {
  it("has four required number fields", () => {
    const s: NodeSizing = { w: 160, h: 60, hSpacing: 40, vSpacing: 30 };
    expectTypeOf(s.w).toEqualTypeOf<number>();
    expectTypeOf(s.h).toEqualTypeOf<number>();
    expectTypeOf(s.hSpacing).toEqualTypeOf<number>();
    expectTypeOf(s.vSpacing).toEqualTypeOf<number>();
  });
});

// ── §6 Parser types ───────────────────────────────────────────────────────────

describe("ParsedDiagram", () => {
  it("nodes is a Map from NodeId to ParsedNode", () => {
    expectTypeOf<ParsedDiagram["nodes"]>().toMatchTypeOf<
      Map<NodeId, ParsedNode>
    >();
  });

  it("edges is readonly array of ParsedEdge", () => {
    expectTypeOf<ParsedDiagram["edges"]>().toMatchTypeOf<
      readonly ParsedEdge[]
    >();
  });

  it("clusters is readonly array of ParsedCluster", () => {
    expectTypeOf<ParsedDiagram["clusters"]>().toMatchTypeOf<
      readonly ParsedCluster[]
    >();
  });

  it("renames is readonly array of RenameAnnotation", () => {
    expectTypeOf<ParsedDiagram["renames"]>().toMatchTypeOf<
      readonly RenameAnnotation[]
    >();
  });

  it("direction is optional direction union", () => {
    expectTypeOf<ParsedDiagram["direction"]>().toEqualTypeOf<
      "TD" | "LR" | "RL" | "BT" | undefined
    >();
  });
});

describe("ParsedNode", () => {
  it("has id, label, shape, classes fields", () => {
    expectTypeOf<ParsedNode["id"]>().toMatchTypeOf<NodeId>();
    expectTypeOf<ParsedNode["label"]>().toEqualTypeOf<string>();
    expectTypeOf<ParsedNode["shape"]>().toMatchTypeOf<NodeShape>();
    expectTypeOf<ParsedNode["classes"]>().toMatchTypeOf<readonly string[]>();
  });

  it("cluster is optional ClusterId", () => {
    expectTypeOf<ParsedNode["cluster"]>().toEqualTypeOf<ClusterId | undefined>();
  });
});

describe("ParsedEdge", () => {
  it("has from, to, label, ordinal, type fields", () => {
    expectTypeOf<ParsedEdge["from"]>().toMatchTypeOf<NodeId>();
    expectTypeOf<ParsedEdge["to"]>().toMatchTypeOf<NodeId>();
    expectTypeOf<ParsedEdge["label"]>().toEqualTypeOf<string>();
    expectTypeOf<ParsedEdge["ordinal"]>().toEqualTypeOf<number>();
    expectTypeOf<ParsedEdge["type"]>().toMatchTypeOf<EdgeType>();
  });
});

describe("ParsedCluster", () => {
  it("has id, label, members fields", () => {
    expectTypeOf<ParsedCluster["id"]>().toMatchTypeOf<ClusterId>();
    expectTypeOf<ParsedCluster["label"]>().toEqualTypeOf<string>();
    expectTypeOf<ParsedCluster["members"]>().toMatchTypeOf<
      readonly NodeId[]
    >();
  });

  it("parent is optional ClusterId", () => {
    expectTypeOf<ParsedCluster["parent"]>().toEqualTypeOf<
      ClusterId | undefined
    >();
  });
});

describe("ParseResult", () => {
  it("valid=true branch has diagram field", () => {
    type T = Extract<ParseResult, { valid: true }>;
    expectTypeOf<T["diagram"]>().toMatchTypeOf<ParsedDiagram>();
  });

  it("valid=false branch has error with line and message", () => {
    type E = Extract<ParseResult, { valid: false }>["error"];
    expectTypeOf<E["line"]>().toEqualTypeOf<number>();
    expectTypeOf<E["message"]>().toEqualTypeOf<string>();
  });
});

// ── §7 Reconciler ─────────────────────────────────────────────────────────────

describe("ReconcileResult", () => {
  it("layout is LayoutStore", () => {
    expectTypeOf<ReconcileResult["layout"]>().toMatchTypeOf<LayoutStore>();
  });

  it("mermaidCleaned is optional string", () => {
    expectTypeOf<ReconcileResult["mermaidCleaned"]>().toEqualTypeOf<
      string | undefined
    >();
  });

  it("changes has correct shape", () => {
    type C = ReconcileResult["changes"];
    expectTypeOf<C["nodesAdded"]>().toMatchTypeOf<readonly NodeId[]>();
    expectTypeOf<C["nodesRemoved"]>().toMatchTypeOf<readonly NodeId[]>();
    expectTypeOf<C["edgesAdded"]>().toEqualTypeOf<number>();
    expectTypeOf<C["edgesRemoved"]>().toEqualTypeOf<number>();
    expectTypeOf<C["clustersChanged"]>().toEqualTypeOf<number>();
    expectTypeOf<C["renamesApplied"]>().toMatchTypeOf<readonly string[]>();
  });
});

// ── Style interfaces completeness ──────────────────────────────────────────────

describe("Style interfaces", () => {
  it("NodeStyle, EdgeStyle, ClusterStyle are all assignable from empty object", () => {
    const ns: NodeStyle = {};
    const es: EdgeStyle = {};
    const cs: ClusterStyle = {};
    expectTypeOf(ns).toMatchTypeOf<NodeStyle>();
    expectTypeOf(es).toMatchTypeOf<EdgeStyle>();
    expectTypeOf(cs).toMatchTypeOf<ClusterStyle>();
  });
});
