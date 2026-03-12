import { describe, expect, it } from "vitest";

import { computeInitialLayout } from "../layout/auto-layout.js";
import { matchEdges } from "../reconciler/edge-identity.js";
import { placeNodes } from "../reconciler/placement.js";
import { getShapeProps } from "../canvas/shape-map.js";
import { routeEdge } from "../canvas/edge-router.js";
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
    const source = { x: 0, y: 0, w: 180, h: 60 };
    const target = { x: 300, y: 0, w: 180, h: 60 };
    const auto = routeEdge("auto", [], source, target);
    const curved = routeEdge("curved", [], source, target);
    expect(curved).toEqual(auto);
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
});
