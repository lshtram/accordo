/**
 * Priority P Batch — Canvas Interaction Tests
 *
 * Tests for:
 *   P-A: classDiagram composite node elements share deterministic groupIds
 *   P-B: canvas:edge-routed persistence + curved waypoint consumption
 *
 * Source: diagram-update-plan.md §12
 *
 * All P-A and P-B tests are GREEN (implementation complete).
 *
 * Note: panel-core.js has vscode imports and is mocked via vi.mock() in the
 * existing panel-core.test.ts. This file tests public entry points that do not
 * require vscode mocking: classNodeGroupId, generateCanvas (class nodes),
 * toExcalidrawPayload (groupIds passthrough), and routeEdge/routeCurved
 * (curved waypoint semantics).
 */

import { describe, it, expect, vi } from "vitest";
import type {
  LayoutStore,
  NodeLayout,
  ParsedDiagram,
  ParsedNode,
  ParsedEdge,
  ExcalidrawElement,
} from "../types.js";
import { generateCanvas } from "../canvas/canvas-generator.js";
import { classNodeGroupId } from "../canvas/canvas-generator.js";
import { routeEdge } from "../canvas/edge-router.js";
import { routeCurved } from "../canvas/edge-router.js";
import type { BoundingBox } from "../canvas/edge-router.js";
import { toExcalidrawPayload } from "../webview/scene-adapter.js";

// ── Test fixtures ───────────────────────────────────────────────────────────────

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

function makeNode(id: string, shape: ParsedNode["shape"] = "rectangle", members?: readonly string[]): ParsedNode {
  return { id, label: id, shape, classes: [], members };
}

function makeEdge(from: string, to: string, label = "", ordinal = 0): ParsedEdge {
  return { from, to, label, ordinal, type: "arrow" };
}

function makeNodeLayout(overrides?: Partial<NodeLayout>): NodeLayout {
  return { x: 100, y: 100, w: 180, h: 60, style: {}, ...overrides };
}

function edgeKey(from: string, to: string, ordinal: number): string {
  return `${from}->${to}:${ordinal}`;
}

// ── P-A: Class node grouping ────────────────────────────────────────────────────
// diagram-update-plan.md §12.2 (P-A)

describe("P-A: classNodeGroupId — deterministic shared groupId", () => {
  it("P-A-01: classNodeGroupId('User') is stable across calls (deterministic)", () => {
    const id1 = classNodeGroupId("User");
    const id2 = classNodeGroupId("User");
    expect(id1).toBe(id2);
  });

  it("P-A-02: classNodeGroupId('A') !== classNodeGroupId('B') (unique per node)", () => {
    expect(classNodeGroupId("A")).not.toBe(classNodeGroupId("B"));
  });

  it("P-A-03: classNodeGroupId result is a non-empty string", () => {
    const id = classNodeGroupId("AnyClass");
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
  });
});

describe("P-A: generateCanvas — class diagram nodes share groupIds", () => {
  it("P-A-04: class node with members → box element has groupIds", () => {
    // A class node: has members array → triggers the class compartment path
    const parsed = makeParsed({
      type: "classDiagram",
      nodes: new Map([["User", makeNode("User", "rectangle", ["+String name", "+bark()"])]]),
    });
    const layout = makeLayout({ nodes: { User: makeNodeLayout() } });
    const scene = generateCanvas(parsed, layout);

    // Find the box (main container) element — has type rectangle and kind node
    const boxEl = scene.elements.find(
      (e) => e.mermaidId === "User" && e.kind === "node" && e.type === "rectangle",
    );
    expect(boxEl).toBeDefined();
    // groupIds is assigned by generateCanvas for class-node composite elements
    expect(boxEl!.groupIds).toBeDefined();
    expect(boxEl!.groupIds!.length).toBeGreaterThan(0);
  });

  it("P-A-05: class node with members → title text element has the SAME groupId as box", () => {
    const parsed = makeParsed({
      type: "classDiagram",
      nodes: new Map([["Order", makeNode("Order", "rectangle", ["+Date date"])]]),
    });
    const layout = makeLayout({ nodes: { Order: makeNodeLayout() } });
    const scene = generateCanvas(parsed, layout);

    const boxEl = scene.elements.find(
      (e) => e.mermaidId === "Order" && e.kind === "node" && e.type === "rectangle",
    );
    const titleEl = scene.elements.find(
      (e) => e.mermaidId === "Order:text" && e.kind === "label",
    );

    expect(boxEl).toBeDefined();
    expect(titleEl).toBeDefined();
    // titleEl is the class-title label element; find() returned it so it is defined
    expect(titleEl!.groupIds).toEqual(boxEl!.groupIds);
  });

  it("P-A-06: class node with members → divider line element has the SAME groupId as box", () => {
    const parsed = makeParsed({
      type: "classDiagram",
      nodes: new Map([["Product", makeNode("Product", "rectangle", ["+String sku"])]]),
    });
    const layout = makeLayout({ nodes: { Product: makeNodeLayout() } });
    const scene = generateCanvas(parsed, layout);

    const boxEl = scene.elements.find(
      (e) => e.mermaidId === "Product" && e.kind === "node" && e.type === "rectangle",
    );
    const dividerEl = scene.elements.find(
      (e) => e.mermaidId === "Product:divider" && e.kind === "label",
    );

    expect(boxEl).toBeDefined();
    expect(dividerEl).toBeDefined();
    // dividerEl is the class-divider label element; find() returned it so it is defined
    expect(dividerEl!.groupIds).toEqual(boxEl!.groupIds);
  });

  it("P-A-07: class node with members → members text element has the SAME groupId as box", () => {
    const parsed = makeParsed({
      type: "classDiagram",
      nodes: new Map([["Service", makeNode("Service", "rectangle", ["+process()"])]]),
    });
    const layout = makeLayout({ nodes: { Service: makeNodeLayout() } });
    const scene = generateCanvas(parsed, layout);

    const boxEl = scene.elements.find(
      (e) => e.mermaidId === "Service" && e.kind === "node" && e.type === "rectangle",
    );
    const membersEl = scene.elements.find(
      (e) => e.mermaidId === "Service:members" && e.kind === "label",
    );

    expect(boxEl).toBeDefined();
    expect(membersEl).toBeDefined();
    // membersEl is the class-members label element; find() returned it so it is defined
    expect(membersEl!.groupIds).toEqual(boxEl!.groupIds);
  });

  it("P-A-08: multiple class nodes → each class has its own distinct groupId", () => {
    const parsed = makeParsed({
      type: "classDiagram",
      nodes: new Map([
        ["User", makeNode("User", "rectangle", ["+String name"])],
        ["Order", makeNode("Order", "rectangle", ["+Date date"])],
      ]),
    });
    const layout = makeLayout({
      nodes: {
        User: makeNodeLayout({ x: 0, y: 0 }),
        Order: makeNodeLayout({ x: 200, y: 0 }),
      },
    });
    const scene = generateCanvas(parsed, layout);

    const userBox = scene.elements.find(
      (e) => e.mermaidId === "User" && e.kind === "node" && e.type === "rectangle",
    );
    const orderBox = scene.elements.find(
      (e) => e.mermaidId === "Order" && e.kind === "node" && e.type === "rectangle",
    );

    expect(userBox).toBeDefined();
    expect(orderBox).toBeDefined();
    // userBox/orderBox exist in scene.elements after generateCanvas for class nodes
    expect(userBox!.groupIds).not.toEqual(orderBox!.groupIds);
  });

  it("P-A-09: non-class standard node → should NOT have unexpected groupId grouping", () => {
    // A regular flowchart node (no members) should not be grouped
    const parsed = makeParsed({
      type: "flowchart",
      nodes: new Map([["A", makeNode("A", "rectangle")]]),
    });
    const layout = makeLayout({ nodes: { A: makeNodeLayout() } });
    const scene = generateCanvas(parsed, layout);

    const shapeEls = scene.elements.filter(
      (e) => e.mermaidId === "A" && e.kind === "node" && e.type === "rectangle",
    );
    expect(shapeEls.length).toBeGreaterThan(0);
    for (const el of shapeEls) {
      // Non-class nodes should either have no groupIds or an empty array
      expect(el.groupIds == null || el.groupIds.length === 0).toBe(true);
    }
  });

  it("P-A-10: class node members text element has groupIds matching box (3+ members)", () => {
    // With 3+ members, verify all member-related elements share the same groupId
    const parsed = makeParsed({
      type: "classDiagram",
      nodes: new Map([["Animal", makeNode("Animal", "rectangle", [
        "+String name",
        "+int age",
        "+bark() void",
      ])]]),
    });
    const layout = makeLayout({ nodes: { Animal: makeNodeLayout() } });
    const scene = generateCanvas(parsed, layout);

    const boxEl = scene.elements.find(
      (e) => e.mermaidId === "Animal" && e.kind === "node" && e.type === "rectangle",
    );
    const membersEl = scene.elements.find(
      (e) => e.mermaidId === "Animal:members" && e.kind === "label",
    );

    expect(boxEl).toBeDefined();
    expect(membersEl).toBeDefined();
    // membersEl is the class-members label element; find() returned it so it is defined
    expect(membersEl!.groupIds).toEqual(boxEl!.groupIds);
  });
});

// ── P-B-1: scene-adapter groupIds passthrough ─────────────────────────────────
// diagram-update-plan.md §12.2 (P-A → SA pass-through)

describe("P-B-1: toExcalidrawPayload — groupIds passthrough", () => {
  it("P-B-01: element with groupIds → groupIds appear in Excalidraw output", () => {
    const el: ExcalidrawElement = {
      id: "exc-class-box",
      mermaidId: "User",
      kind: "node",
      type: "rectangle",
      x: 10,
      y: 20,
      width: 100,
      height: 50,
      roughness: 1,
      fontFamily: "Excalifont",
      groupIds: ["class-group:User"],
    };
    const [out] = toExcalidrawPayload([el]);
    expect(out.groupIds).toContain("class-group:User");
  });

  it("P-B-02: element without groupIds → groupIds defaults to empty array (not undefined)", () => {
    const el: ExcalidrawElement = {
      id: "exc-standard",
      mermaidId: "A",
      kind: "node",
      type: "rectangle",
      x: 10,
      y: 20,
      width: 100,
      height: 50,
      roughness: 1,
      fontFamily: "Excalifont",
      // groupIds is absent
    };
    const [out] = toExcalidrawPayload([el]);
    expect(Array.isArray(out.groupIds)).toBe(true);
    expect(out.groupIds.length).toBe(0);
  });

  it("P-B-03: multiple groupIds → all preserved in output", () => {
    const el: ExcalidrawElement = {
      id: "exc-multi-group",
      mermaidId: "A",
      kind: "node",
      type: "rectangle",
      x: 10,
      y: 20,
      width: 100,
      height: 50,
      roughness: 1,
      fontFamily: "Excalidraw",
      groupIds: ["group-1", "group-2", "group-3"],
    };
    const [out] = toExcalidrawPayload([el]);
    expect(out.groupIds).toEqual(["group-1", "group-2", "group-3"]);
  });
});

// ── P-B-2: edge waypoint persistence — canvas:edge-routed handler ───────────
// diagram-update-plan.md §12.3 / §12.4 (P-B)
//
// Note: persistEdgeWaypoints is tested in panel-core.test.ts (PCore-11..16).
// The P-B curved waypoint consumption tests (P-B-07..P-B-12) test the geometry
// layer directly without requiring vscode mocks.

// ── P-B-3: routeEdge forwards waypoints to routeCurved ─────────────────────────
// diagram-update-plan.md §12.3 (P-B curved waypoint semantics)
//
// Curved waypoint semantics (§12.3):
//   Empty waypoints → existing auto-curve behavior (midpoint-based control point)
//   One waypoint    → that waypoint is the explicit control point
//   Two+ waypoints → all waypoints are explicit control points (in order)

describe("P-B-3: routeEdge forwards waypoints to routeCurved", () => {
  const SOURCE_BOX: BoundingBox = { x: 0, y: 100, w: 180, h: 60 };
  const TARGET_BOX: BoundingBox = { x: 300, y: 100, w: 180, h: 60 };

  it("P-B-07: routeEdge('curved', waypoints, ...) passes waypoints to routeCurved", () => {
    const waypoints = [{ x: 200, y: 50 }];
    const result = routeEdge("curved", waypoints, SOURCE_BOX, TARGET_BOX);

    // Stored waypoints should appear in the output points array.
    expect(result.points.length).toBeGreaterThanOrEqual(2);
    // waypoints is const [{ x: 200, y: 50 }]; waypoints[0] is always defined
    const foundWp = result.points.some(([px, py]) => px === waypoints[0]!.x && py === waypoints[0]!.y);
    expect(foundWp).toBe(true);
  });

  it("P-B-08: routeCurved with one waypoint → uses that waypoint as explicit control point", () => {
    const waypoints = [{ x: 200, y: 50 }];
    const result = routeCurved(SOURCE_BOX, TARGET_BOX, "LR", waypoints);

    // With one waypoint, it becomes the explicit single control point.
    // The waypoint should appear verbatim in the points array.
    expect(result.points.length).toBeGreaterThanOrEqual(3);
    // waypoints is const [{ x: 200, y: 50 }]; waypoints[0] is always defined
    const foundWp = result.points.some(([px, py]) => px === waypoints[0]!.x && py === waypoints[0]!.y);
    expect(foundWp).toBe(true);
  });

  it("P-B-09: routeCurved with 2+ waypoints → uses them as explicit control points", () => {
    const waypoints = [
      { x: 200, y: 50 },
      { x: 250, y: 150 },
    ];
    const result = routeCurved(SOURCE_BOX, TARGET_BOX, "LR", waypoints);

    // With 2+ waypoints, all appear in the path as explicit control points.
    // Minimum: clampedStart, W1, W2, clampedEnd = 4 points.
    expect(result.points.length).toBeGreaterThanOrEqual(4);
    for (const wp of waypoints) {
      const found = result.points.some(([px, py]) => px === wp.x && py === wp.y);
      expect(found, `waypoint (${wp.x},${wp.y}) not found in path`).toBe(true);
    }
  });

  it("P-B-10: routeCurved with empty waypoints → preserves auto-curve behavior", () => {
    const resultWithEmpty = routeCurved(SOURCE_BOX, TARGET_BOX, "LR", []);

    // Empty waypoints: auto-curve behavior unchanged — same as current routeCurved.
    // The auto curve produces 3 points (start, midpoint_cp, end).
    // Strengthened: check geometric correctness (control point is perpendicular-offset,
    // not collinear with the baseline). For LR direction with equal Y centres,
    // the perpendicular is vertical, so cp.Y must differ from start.Y/end.Y.
    expect(resultWithEmpty.points.length).toBeGreaterThanOrEqual(3);
    const start = resultWithEmpty.points[0];
    const cp = resultWithEmpty.points[1];
    const end = resultWithEmpty.points[resultWithEmpty.points.length - 1];
    expect(start).toBeDefined();
    expect(cp).toBeDefined();
    expect(end).toBeDefined();

    // Geometric sanity: for LR (horizontal baseline), the control point
    // MUST be offset perpendicular to the baseline — its Y must differ from
    // the baseline Y. A collinear cp would indicate the auto-curve was bypassed.
    // start/cp are defined above via direct expectations on the 3-point auto-curve output.
    const baselineY = start![1];
    // cp is the middle control point in the auto-curve output and is defined by the same guard above.
    const cpY = cp![1];
    expect(cpY).not.toBe(baselineY); // perpendicular offset must produce different Y
  });

  it("P-B-11: stored waypoints survive a render cycle — waypoints from layout.edges are passed to routeEdge", () => {
    // Simulate: layout.json stores waypoints for edge "A->B:0"
    // generateCanvas reads layout.edges[key].waypoints → routeEdge("curved", waypoints, ...)
    // → routeCurved → stored waypoints appear in output arrow points.
    //
    // arrowEl.points are RELATIVE to arrowEl.x/y (canvas-generator normalises them).
    // storedWaypoints are ABSOLUTE canvas coordinates.
    // To compare: add arrowEl.x/y back to each relative point to reconstruct absolute.
    const k = edgeKey("A", "B", 0);
    const storedWaypoints = [{ x: 150, y: 75 }, { x: 225, y: 120 }];

    const parsed = makeParsed({
      nodes: new Map([["A", makeNode("A")], ["B", makeNode("B")]]),
      edges: [makeEdge("A", "B")],
    });
    const layout = makeLayout({
      nodes: {
        A: makeNodeLayout({ x: 0, y: 100 }),
        B: makeNodeLayout({ x: 300, y: 100 }),
      },
      edges: {
        [k]: { routing: "curved", waypoints: storedWaypoints, style: {} },
      },
    });

    const scene = generateCanvas(parsed, layout);
    const arrowEl = scene.elements.find(
      (e) => e.type === "arrow" && e.mermaidId === k,
    );

    expect(arrowEl).toBeDefined();
    // arrowEl is defined (find() returned it); reconstruct absolute coordinates
    // from relative points: arrowEl.points are relative to arrowEl.{x,y}
    const absPts = (arrowEl!.points ?? []).map(
      ([px, py]) => [px + arrowEl!.x, py + arrowEl!.y] as [number, number],
    );
    for (const wp of storedWaypoints) {
      const found = absPts.some(([px, py]) => px === wp.x && py === wp.y);
      expect(found, `stored waypoint (${wp.x},${wp.y}) not found in arrow absolute points`).toBe(true);
    }
  });
});
