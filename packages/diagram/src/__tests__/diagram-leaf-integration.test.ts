import { describe, expect, it } from "vitest";

import { computeInitialLayout } from "../layout/auto-layout.js";
import { matchEdges } from "../reconciler/edge-identity.js";
import { placeNodes } from "../reconciler/placement.js";
import { getShapeProps } from "../canvas/shape-map.js";
import { routeEdge } from "../canvas/edge-router.js";
import { parseMermaid } from "../parser/adapter.js";
import type { HostToWebviewMessage, WebviewToHostMessage } from "../webview/protocol.js";
import type { ParsedDiagram, ParsedEdge, ParsedNode, LayoutStore, SpatialDiagramType } from "../types.js";

function node(id: string, shape: ParsedNode["shape"] = "rectangle"): ParsedNode {
  return { id, label: id, shape, classes: [] };
}

function edge(from: string, to: string, ordinal: number, label = ""): ParsedEdge {
  return { from, to, ordinal, label, type: "arrow" };
}

function diagram(
  type: ParsedDiagram["type"],
  nodes: ParsedNode[],
  edges: ParsedEdge[],
  direction?: "TD" | "LR" | "RL" | "BT"
): ParsedDiagram {
  return {
    type,
    nodes: new Map(nodes.map((n) => [n.id, n])),
    edges,
    clusters: [],
    renames: [],
    direction,
  };
}

function layoutStore(diagram_type: SpatialDiagramType, nodes: LayoutStore["nodes"]): LayoutStore {
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

describe("diagram leaf integration", () => {
  it("keeps dimension contracts aligned between A6 placement and A8 shape-map", () => {
    const shapes: Array<ParsedNode["shape"]> = [
      "rectangle",
      "rounded",
      "diamond",
      "circle",
      "cylinder",
      "stadium",
      "hexagon",
      "parallelogram",
    ];

    for (const s of shapes) {
      const id = `n_${s}`;
      const parsed = diagram("flowchart", [node(id, s)], []);
      const placed = placeNodes([id], parsed, layoutStore("flowchart", {})).get(id);
      const shapeProps = getShapeProps(s);
      expect(placed).toBeDefined();
      expect(placed!.w).toBe(shapeProps.width);
      expect(placed!.h).toBe(shapeProps.height);
    }
  });

  it("migrates edge identity after labeled reorder over A4 edge keys", () => {
    const oldParsed = diagram(
      "flowchart",
      [node("A"), node("B")],
      [edge("A", "B", 0, "data"), edge("A", "B", 1, "ctrl")]
    );
    const newParsed = diagram(
      "flowchart",
      [node("A"), node("B")],
      [edge("A", "B", 0, "ctrl"), edge("A", "B", 1, "data")]
    );

    const oldLayout = computeInitialLayout(oldParsed);
    oldLayout.edges["A->B:0"]!.routing = "orthogonal";
    oldLayout.edges["A->B:1"]!.routing = "direct";

    const result = matchEdges(oldParsed.edges, newParsed.edges, oldLayout.edges);

    expect(result.preserved.get("A->B:0")).toEqual({ oldKey: "A->B:1", newKey: "A->B:0" });
    expect(result.preserved.get("A->B:1")).toEqual({ oldKey: "A->B:0", newKey: "A->B:1" });
    expect(result.added).toEqual([]);
    expect(result.removed).toEqual([]);
  });

  it("routes from an A6-placed node to existing node with valid geometry", () => {
    const parsed = diagram(
      "flowchart",
      [node("anchor"), node("newNode", "diamond")],
      [edge("anchor", "newNode", 0)]
    );

    const existing = layoutStore("flowchart", {
      anchor: { x: 0, y: 0, w: 180, h: 60, style: {} },
    });

    const placed = placeNodes(["newNode"], parsed, existing).get("newNode");
    expect(placed).toBeDefined();

    const routed = routeEdge(
      "auto",
      [],
      existing.nodes.anchor!,
      { x: placed!.x, y: placed!.y, w: placed!.w, h: placed!.h }
    );

    expect(routed.points).toHaveLength(2);
    expect(routed.startBinding).not.toBeNull();
    expect(routed.endBinding).not.toBeNull();
    for (const [x, y] of routed.points) {
      expect(Number.isFinite(x)).toBe(true);
      expect(Number.isFinite(y)).toBe(true);
    }
  });

  it("normalizes 'curved' routing alias to auto behavior", () => {
    // FC-06: "curved" was previously aliased to "auto" (bug). Now curved produces
    // a proper curved path (≥3 points) distinct from auto (2 points).
    const source = { x: 0, y: 0, w: 180, h: 60 };
    const target = { x: 300, y: 0, w: 180, h: 60 };
    const auto = routeEdge("auto", [], source, target);
    const curved = routeEdge("curved", [], source, target);
    // auto: 2-point straight line; curved: ≥3 point curved path
    expect(auto.points).toHaveLength(2);
    expect(curved.points.length).toBeGreaterThanOrEqual(3);
    // Curved must not equal auto (FC-06e: not aliased)
    expect(curved).not.toEqual(auto);
  });

  it("A11 protocol unions remain assignable for both directions", () => {
    const toHost: WebviewToHostMessage = {
      type: "canvas:edge-routed",
      edgeKey: "A->B:0",
      waypoints: [{ x: 10, y: 20 }],
    };
    const toWebview: HostToWebviewMessage = {
      type: "host:parse-error",
      line: 3,
      message: "Unexpected token",
    };

    expect(toHost.type).toBe("canvas:edge-routed");
    expect(toWebview.type).toBe("host:parse-error");
  });

  // ── Real-parser contract test (no mocks) ──────────────────────────────────
  // Verifies that parseMermaid() correctly awaits the Mermaid 11.x async API
  // and returns a structured ParsedDiagram — catching any sync/async regression
  // at the boundary between adapter.ts and the mermaid library.
  it("real parseMermaid('flowchart TD\\nA-->B') resolves valid diagram with correct shape", async () => {
    const result = await parseMermaid("flowchart TD\nA-->B");
    expect(result.valid).toBe(true);
    if (!result.valid) return; // narrow type
    expect(result.diagram.type).toBe("flowchart");
    // In Node.js, Mermaid 11.x populates edges for bare A-->B syntax.
    // Vertices only populate with explicit labels (A[label]), which requires
    // DOMPurify sanitization and a DOM environment — so nodes.size may be 0.
    expect(result.diagram.edges).toHaveLength(1);
    expect(result.diagram.edges[0]?.from).toBe("A");
    expect(result.diagram.edges[0]?.to).toBe("B");
  });
});
