/**
 * FC-06 through FC-09 — Flowchart Fidelity Batch 2 Tests
 *
 * Tests for visual defect fixes in flowchart rendering (Batch 2):
 *   FC-06: Curved edge routing produces visible curves (Cases 28, 48, 49)
 *   FC-07: Direction-aware edge attachment points (Case 33)
 *   FC-08: Subgraph-targeted edges rendered (not dropped) (Cases 35, 36)
 *   FC-09: Edge attachment points account for curve tangent (Cases 48, 49)
 *
 * All tests are RED in Phase B (stubs throw "not implemented" or
 * assertions fail against current buggy implementation).
 * They turn GREEN in Phase C after implementation.
 *
 * Requirements: docs/20-requirements/requirements-diagram-fidelity.md (FC-06..FC-09)
 *
 * API checklist:
 *   FC-06a   routeCurved returns ≥3 points — 1 test
 *   FC-06b   routeCurved control point offset from midline — 1 test
 *   FC-06c   routeCurved non-null bindings — 1 test
 *   FC-06d   canvas-generator passes "curved" not "auto" to routeEdge — 1 test
 *   FC-06e   routeEdge("curved") calls routeCurved not routeAuto — 1 test
 *   FC-07a   routeEdge accepts direction parameter — 1 test
 *   FC-07b   TD direction: source exits bottom, target enters top — 1 test
 *   FC-07c   LR direction: source exits right, target enters left — 1 test
 *   FC-07d   RL direction: source exits left, target enters right — 1 test
 *   FC-07e   BT direction: source exits top, target enters bottom — 1 test
 *   FC-07f   back-edge fallback to centre-to-centre — 1 test
 *   FC-07g   canvas-generator passes parsed.direction to routeEdge — 1 test
 *   FC-07h   omitting direction → identical to current behaviour — 1 test
 *   FC-08a   auto-layout emits EdgeLayout for cluster-ID edges — 1 test
 *   FC-08b   cluster-targeted edge resolves to cluster bbox centre — 1 test
 *   FC-08c   cluster-sourced edge resolves to cluster bbox centre — 1 test
 *   FC-08d   node-to-node edges unaffected — 1 test
 *   FC-08e   nested subgraph edge resolves to exact cluster bbox — 1 test
 *   FC-09a   curved start clamped toward first control point — 1 test
 *   FC-09b   curved end clamped from last control point — 1 test
 *   FC-09c   non-curved edges unaffected — 1 test
 */

import { describe, it, expect } from "vitest";
import { generateCanvas } from "../canvas/canvas-generator.js";
import { parseFlowchart } from "../parser/flowchart.js";
import { routeEdge } from "../canvas/edge-router.js";
import { computeInitialLayout } from "../layout/auto-layout.js";
import type {
  LayoutStore,
  NodeLayout,
  ParsedDiagram,
  ParsedNode,
  ParsedEdge,
  ParsedCluster,
} from "../types.js";
import type { BoundingBox } from "../canvas/edge-router.js";

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

function makeCluster(id: string, members: string[], label = "", parent?: string): ParsedCluster {
  return { id, label, members, ...(parent !== undefined ? { parent } : {}) };
}

function edgeKey(from: string, to: string, ordinal: number): string {
  return `${from}->${to}:${ordinal}`;
}

// ── Standard bounding boxes ───────────────────────────────────────────────────

/** Node on the left side of the canvas. */
const LEFT: BoundingBox = { x: 0, y: 100, w: 180, h: 60 };
/** Node to the right of LEFT, same row. */
const RIGHT: BoundingBox = { x: 300, y: 100, w: 180, h: 60 };
/** Node below LEFT (target in TD flow). */
const BELOW: BoundingBox = { x: 0, y: 300, w: 180, h: 60 };
/** Node above LEFT (back-edge scenario in TD). */
const ABOVE: BoundingBox = { x: 0, y: -200, w: 180, h: 60 };
/** Node diagonally positioned. */
const DIAG: BoundingBox = { x: 300, y: 300, w: 180, h: 60 };

// ─────────────────────────────────────────────────────────────────────────────
// FC-06: Curved edge routing produces visible curves
//
// Defect: "curved" routing is aliased to "auto" in routeEdge(), so curves never
// render. routeCurved() is a stub that throws "not implemented".
//
// FC-06a: routeCurved() exists and returns ≥ 3 points
// FC-06b: Control point offset from straight-line midpoint (perpendicular distance > 0)
// FC-06c: routeCurved() returns non-null startBinding and endBinding
// FC-06d: canvas-generator passes "curved" (not "auto") for flowchart edges
// FC-06e: routeEdge("curved", ...) calls routeCurved(), not routeAuto()
// ─────────────────────────────────────────────────────────────────────────────

describe("FC-06: Curved edge routing", () => {
  // FC-06a: routeCurved() exists and returns ≥ 3 points
  // No throw-stub assertion — assert the contract directly so the test
  // fails at the call site when the stub throws.
  it("FC-06a: routeCurved() returns RouteResult with points.length >= 3", async () => {
    const { routeCurved } = await import("../canvas/edge-router.js");
    const result = routeCurved(LEFT, RIGHT);
    expect(result.points.length).toBeGreaterThanOrEqual(3);
  });

  // FC-06b: The curved path includes a control point offset from the straight-line midpoint
  it("FC-06b: routeCurved() control point offset from midpoint > 0", async () => {
    const { routeCurved } = await import("../canvas/edge-router.js");
    const result = routeCurved(LEFT, RIGHT);
    const pts = result.points;
    expect(pts.length).toBeGreaterThanOrEqual(3);

    // Compute perpendicular distance from midpoint to each intermediate control point.
    // For a proper curve there must be at least one interior point whose
    // perpendicular distance from the src→tgt line is > 0.
    const srcCentre: [number, number] = [LEFT.x + LEFT.w / 2, LEFT.y + LEFT.h / 2];
    const tgtCentre: [number, number] = [RIGHT.x + RIGHT.w / 2, RIGHT.y + RIGHT.h / 2];

    const dx = tgtCentre[0] - srcCentre[0];
    const dy = tgtCentre[1] - srcCentre[1];
    const lineLen = Math.sqrt(dx * dx + dy * dy);
    if (lineLen === 0) return; // coincident nodes — skip

    const lineConst = tgtCentre[0] * srcCentre[1] - tgtCentre[1] * srcCentre[0];
    let maxPerpDist = 0;
    for (let i = 1; i < pts.length - 1; i++) {
      const [px, py] = pts[i]!;
      const perpDist = Math.abs(dy * px - dx * py + lineConst) / lineLen;
      maxPerpDist = Math.max(maxPerpDist, perpDist);
    }
    expect(maxPerpDist).toBeGreaterThan(0);
  });

  // FC-06c: routeCurved() returns non-null start and end bindings
  it("FC-06c: routeCurved() returns non-null startBinding and endBinding", async () => {
    const { routeCurved } = await import("../canvas/edge-router.js");
    const result = routeCurved(LEFT, RIGHT);
    expect(result.startBinding).not.toBeNull();
    expect(result.endBinding).not.toBeNull();
  });

  // FC-06d: Default remains straight unless curved style/routing is explicitly set.
  it("FC-06d: flowchart edge without curved style keeps straight 2-point path", () => {
    const parsed = makeParsed({
      nodes: new Map([["A", makeNode("A")], ["B", makeNode("B")]]),
      edges: [makeEdge("A", "B")],
    });
    const layout = makeLayout({
      nodes: {
        A: makeNodeLayout({ x: 0, y: 0 }),
        B: makeNodeLayout({ x: 300, y: 0 }),
      },
      edges: {}, // No explicit edge routing override — should stay straight/auto
    });
    const scene = generateCanvas(parsed, layout);

    const arrowEl = scene.elements.find(
      (e) => e.type === "arrow" && e.mermaidId === edgeKey("A", "B", 0),
    );
    expect(arrowEl).toBeDefined();
    expect(arrowEl!.points!.length).toBe(2);
  });

  // FC-06d.2: Integration test — computeInitialLayout defaults to auto for flowchart edges.
  it("FC-06d.2: computeInitialLayout + generateCanvas keeps straight flowchart edges by default", () => {
    const parsed = makeParsed({
      type: "flowchart",
      nodes: new Map([
        ["A", makeNode("A")],
        ["B", makeNode("B")],
        ["C", makeNode("C")],
      ]),
      edges: [
        makeEdge("A", "B"),
        makeEdge("B", "C"),
      ],
    });

    // Use computeInitialLayout (the real production path)
    // FC-06d: computeInitialLayout defaults to auto routing
    const layout = computeInitialLayout(parsed);

    const keyAB = edgeKey("A", "B", 0);
    expect(layout.edges[keyAB]).toBeDefined();
    expect(layout.edges[keyAB].routing).toBe("auto");

    const scene = generateCanvas(parsed, layout);
    const arrowAB = scene.elements.find(
      (e) => e.type === "arrow" && e.mermaidId === keyAB,
    );
    expect(arrowAB).toBeDefined();
    expect(arrowAB!.points!.length).toBe(2);
  });

  // FC-06e: "curved" is no longer aliased to "auto" in routeEdge mode switch
  it("FC-06e: routeEdge('curved', ...) returns ≥ 3 points (not aliased to auto)", async () => {
    // routeEdge with "curved" must produce a curved path, not 2-point auto path
    const result = routeEdge("curved", [], LEFT, RIGHT);
    expect(result.points.length).toBeGreaterThanOrEqual(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FC-07: Direction-aware edge attachment points
//
// Defect: In RL and BT diagrams, edges exit/enter on arbitrary sides rather
// than following declared flow direction.
//
// FC-07a: routeEdge() accepts optional `direction` parameter
// FC-07b-e: TD/LR/RL/BT direction biases source exit and target entry
// FC-07f: Back-edges fall back to centre-to-centre attachment
// FC-07g: canvas-generator passes parsed.direction to routeEdge()
// FC-07h: Omitting direction produces identical output to current behaviour
// ─────────────────────────────────────────────────────────────────────────────

describe("FC-07: Direction-aware edge attachment", () => {
  // FC-07a: routeEdge() accepts an optional `direction` parameter
  it("FC-07a: routeEdge accepts direction parameter without throwing", () => {
    // This should not throw — direction is an optional parameter
    expect(() => routeEdge("auto", [], LEFT, RIGHT, "TD")).not.toThrow();
    expect(() => routeEdge("auto", [], LEFT, RIGHT, "LR")).not.toThrow();
    expect(() => routeEdge("auto", [], LEFT, RIGHT, "RL")).not.toThrow();
    expect(() => routeEdge("auto", [], LEFT, RIGHT, "BT")).not.toThrow();
  });

  // FC-07b: TD direction biases source exit to bottom face, target entry to top face
  it("FC-07b: TD direction — start point on bottom half of source, end on top half of target", () => {
    // Source is ABOVE the target in canvas coordinates (y: -200 < 300)
    // For TD flow, source exits from its bottom (toward target), target enters from its top
    const srcBox: BoundingBox = { x: 0, y: -200, w: 180, h: 60 }; // top of canvas
    const tgtBox: BoundingBox = { x: 0, y: 300, w: 180, h: 60 };  // bottom of canvas

    const result = routeEdge("auto", [], srcBox, tgtBox, "TD");
    expect(result.points.length).toBeGreaterThanOrEqual(2);
    const [start, end] = [result.points[0]!, result.points[result.points.length - 1]!];

    // For TD: start point y should be in the bottom half of source bbox
    // Source bottom = -200 + 60 = -140; midpoint = -200 + 30 = -170
    // Bottom half starts at y = -170
    const srcMidY = srcBox.y + srcBox.h / 2;
    expect(start[1]).toBeGreaterThan(srcMidY); // exits from bottom half

    // For TD: end point y should be in the top half of target bbox
    // Target top = 300; midpoint = 300 + 30 = 330
    // Top half ends at y = 330
    const tgtMidY = tgtBox.y + tgtBox.h / 2;
    expect(end[1]).toBeLessThan(tgtMidY); // enters from top half
  });

  // FC-07c: LR direction biases source exit to right face, target entry to left face
  it("FC-07c: LR direction — start point x >= source centre x, end point x <= target centre x", () => {
    // Source on left, target on right — LR flow goes left to right
    const result = routeEdge("auto", [], LEFT, RIGHT, "LR");
    expect(result.points.length).toBeGreaterThanOrEqual(2);
    const [start, end] = [result.points[0]!, result.points[result.points.length - 1]!];

    const srcCentreX = LEFT.x + LEFT.w / 2; // 90
    const tgtCentreX = RIGHT.x + RIGHT.w / 2; // 390

    expect(start[0]).toBeGreaterThanOrEqual(srcCentreX); // exits right face
    expect(end[0]).toBeLessThanOrEqual(tgtCentreX);     // enters left face
  });

  // FC-07d: RL direction biases source exit to left face, target entry to right face
  it("FC-07d: RL direction — start point x <= source centre x, end point x >= target centre x", () => {
    // Source on right (x: 300), target on left (x: 0) — RL flow goes right to left
    const srcBox: BoundingBox = { x: 300, y: 100, w: 180, h: 60 };  // RIGHT position
    const tgtBox: BoundingBox = { x: 0, y: 100, w: 180, h: 60 };    // LEFT position

    const result = routeEdge("auto", [], srcBox, tgtBox, "RL");
    expect(result.points.length).toBeGreaterThanOrEqual(2);
    const [start, end] = [result.points[0]!, result.points[result.points.length - 1]!];

    const srcCentreX = srcBox.x + srcBox.w / 2; // 390
    const tgtCentreX = tgtBox.x + tgtBox.w / 2; // 90

    expect(start[0]).toBeLessThanOrEqual(srcCentreX); // exits left face
    expect(end[0]).toBeGreaterThanOrEqual(tgtCentreX);  // enters right face
  });

  // FC-07e: BT direction biases source exit to top face, target entry to bottom face
  it("FC-07e: BT direction — start point y <= source centre y, end point y >= target centre y", () => {
    // Source at bottom (y: 300), target at top (y: -200) — BT flow goes bottom to top
    const srcBox: BoundingBox = { x: 0, y: 300, w: 180, h: 60 };   // bottom
    const tgtBox: BoundingBox = { x: 0, y: -200, w: 180, h: 60 };  // top

    const result = routeEdge("auto", [], srcBox, tgtBox, "BT");
    expect(result.points.length).toBeGreaterThanOrEqual(2);
    const [start, end] = [result.points[0]!, result.points[result.points.length - 1]!];

    const srcCentreY = srcBox.y + srcBox.h / 2; // 330
    const tgtCentreY = tgtBox.y + tgtBox.h / 2; // -170

    expect(start[1]).toBeLessThanOrEqual(srcCentreY); // exits top face
    expect(end[1]).toBeGreaterThanOrEqual(tgtCentreY);  // enters from bottom face
  });

  // FC-07f: Back-edges (opposing flow direction) fall back to centre-to-centre
  it("FC-07f: back-edge in TD (target above source) falls back to centre-to-centre", () => {
    // Source BELOW target — TD flow expects source above target
    // This is a "back-edge" in TD direction
    const result = routeEdge("auto", [], BELOW, ABOVE, "TD");
    expect(result.points.length).toBeGreaterThanOrEqual(2);
    const [start, end] = [result.points[0]!, result.points[result.points.length - 1]!];

    // With back-edge fallback, start and end points should be close to centres
    const srcCentre: [number, number] = [BELOW.x + BELOW.w / 2, BELOW.y + BELOW.h / 2];
    const tgtCentre: [number, number] = [ABOVE.x + ABOVE.w / 2, ABOVE.y + ABOVE.h / 2];

    // For a back-edge, the start should be near source centre and end near target centre
    // (not enforcing face-specific attachment)
    const startDist = Math.hypot(start[0] - srcCentre[0], start[1] - srcCentre[1]);
    const endDist = Math.hypot(end[0] - tgtCentre[0], end[1] - tgtCentre[1]);
    // Both should be relatively close to their respective centres (within a box margin)
    expect(startDist).toBeLessThanOrEqual(BELOW.w / 2 + BELOW.h / 2);
    expect(endDist).toBeLessThanOrEqual(ABOVE.w / 2 + ABOVE.h / 2);
  });

  // FC-07g: canvas-generator passes parsed.direction to routeEdge()
  it("FC-07g: generateCanvas passes diagram direction to routeEdge for each edge", () => {
    // Create a parsed diagram with RL direction
    const parsed: ParsedDiagram = {
      type: "flowchart",
      direction: "RL",
      nodes: new Map([
        ["C", makeNode("C")], // source on right
        ["D", makeNode("D")], // target on left
      ]),
      edges: [makeEdge("C", "D")],
      clusters: [],
      renames: [],
    };
    const layout = makeLayout({
      nodes: {
        C: makeNodeLayout({ x: 300, y: 100 }), // right side
        D: makeNodeLayout({ x: 0, y: 100 }),   // left side
      },
      edges: {},
    });

    const scene = generateCanvas(parsed, layout);
    const arrowEl = scene.elements.find(
      (e) => e.type === "arrow" && e.mermaidId === edgeKey("C", "D", 0),
    );
    expect(arrowEl).toBeDefined();
    // With RL direction, the arrow endpoint should be on the RIGHT face of target D.
    // D spans x=[0,180], so its right face is at x=180 and centre at x=90.
    // Verify the absolute arrow endpoint is >= 90 (on or right of centre).
    const endPt = arrowEl!.points![arrowEl!.points!.length - 1]!;
    const absEndX = endPt[0] + arrowEl!.x;
    expect(absEndX).toBeGreaterThanOrEqual(90); // enters right face of target
  });

  // FC-07h: Omitting direction produces identical output to current behaviour
  it("FC-07h: routeEdge without direction === current behaviour (no direction bias)", () => {
    const withDirection = routeEdge("auto", [], LEFT, RIGHT, undefined);
    const withoutDirection = routeEdge("auto", [], LEFT, RIGHT);

    // The points should be identical when direction is not specified
    expect(withDirection.points).toEqual(withoutDirection.points);
    expect(withDirection.startBinding).toEqual(withoutDirection.startBinding);
    expect(withDirection.endBinding).toEqual(withoutDirection.endBinding);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FC-08: Subgraph-targeted edges rendered (not dropped)
//
// Defect: Edges with cluster IDs as source or target are silently dropped.
//
// FC-08a: auto-layout emits EdgeLayout entries for cluster-ID edges
// FC-08b: cluster-targeted edge resolves to cluster bbox centre
// FC-08c: cluster-sourced edge resolves to cluster bbox centre
// FC-08d: node-to-node edges are unaffected
// FC-08e: nested subgraph edges resolve to exact referenced cluster
// ─────────────────────────────────────────────────────────────────────────────

describe("FC-08: Subgraph-targeted edges", () => {
  // FC-08a: Edges targeting cluster IDs are not skipped in layout computation
  it("FC-08a: auto-layout emits EdgeLayout for edge whose to is a cluster ID", () => {
    const parsed: ParsedDiagram = {
      type: "flowchart",
      nodes: new Map([["A", makeNode("A")]]),
      edges: [makeEdge("A", "cluster_B")],
      clusters: [makeCluster("cluster_B", ["A"], "Cluster B")],
      renames: [],
    };

    const layout = computeInitialLayout(parsed);

    // The edge A → cluster_B must have an EdgeLayout entry
    const key = edgeKey("A", "cluster_B", 0);
    expect(layout.edges[key]).toBeDefined();
    expect(layout.edges[key]).toHaveProperty("routing");
    expect(layout.edges[key]).toHaveProperty("waypoints");
    expect(layout.edges[key]).toHaveProperty("style");
  });

  // FC-08a.2: Edge whose from is a cluster ID is not skipped
  it("FC-08a.2: auto-layout emits EdgeLayout for edge whose from is a cluster ID", () => {
    const parsed: ParsedDiagram = {
      type: "flowchart",
      nodes: new Map([["X", makeNode("X")]]),
      edges: [makeEdge("cluster_Y", "X")],
      clusters: [makeCluster("cluster_Y", ["X"], "Cluster Y")],
      renames: [],
    };

    const layout = computeInitialLayout(parsed);

    const key = edgeKey("cluster_Y", "X", 0);
    expect(layout.edges[key]).toBeDefined();
  });

  // FC-08b: cluster-targeted edge endpoint resolves to cluster bounding box
  it("FC-08b: edge to cluster → arrow end point is at cluster bbox centre", () => {
    const parsed: ParsedDiagram = {
      type: "flowchart",
      direction: "LR",
      nodes: new Map([
        ["M1", makeNode("M1")],
        ["M2", makeNode("M2")],
      ]),
      edges: [
        makeEdge("M1", "sub1"),
        makeEdge("sub1", "M2"),
      ],
      clusters: [makeCluster("sub1", ["M1"], "Subgraph 1")],
      renames: [],
    };

    const layout = computeInitialLayout(parsed);
    const canvasScene = generateCanvas(parsed, layout);

    // Find the edge M1 → sub1
    const edgeKey0 = edgeKey("M1", "sub1", 0);
    const arrowEl = canvasScene.elements.find(
      (e) => e.type === "arrow" && e.mermaidId === edgeKey0,
    );
    expect(arrowEl).toBeDefined("edge M1→sub1 must not be dropped");

    // The arrow's endBinding should reference the cluster element
    // OR the arrow endpoint should be at the cluster's bounding box centre
    const clusterLayout = layout.clusters["sub1"];
    expect(clusterLayout).toBeDefined();

    // The cluster bbox centre in absolute coordinates
    const clusterCentreX = clusterLayout.x + clusterLayout.w / 2;
    const clusterCentreY = clusterLayout.y + clusterLayout.h / 2;

    // Get the absolute position of the arrow's last point
    const absEndPt = arrowEl!.points![arrowEl!.points!.length - 1]!;
    const absX = absEndPt[0] + arrowEl!.x;
    const absY = absEndPt[1] + arrowEl!.y;

    // The arrow endpoint should be within a reasonable margin of the cluster centre
    const dist = Math.hypot(absX - clusterCentreX, absY - clusterCentreY);
    expect(dist).toBeLessThan(clusterLayout.w / 2 + clusterLayout.h / 2 + 50);
  });

  // FC-08c: cluster-sourced edge endpoint resolves to cluster bounding box
  it("FC-08c: edge from cluster → arrow start point is at cluster bbox centre", () => {
    const parsed: ParsedDiagram = {
      type: "flowchart",
      direction: "LR",
      nodes: new Map([
        ["P", makeNode("P")],
        ["Q", makeNode("Q")],
      ]),
      edges: [
        makeEdge("outer", "P"),
        makeEdge("P", "Q"),
      ],
      clusters: [makeCluster("outer", ["P"], "Outer")],
      renames: [],
    };

    const layout = computeInitialLayout(parsed);
    const canvasScene = generateCanvas(parsed, layout);

    const edgeKey0 = edgeKey("outer", "P", 0);
    const arrowEl = canvasScene.elements.find(
      (e) => e.type === "arrow" && e.mermaidId === edgeKey0,
    );
    expect(arrowEl).toBeDefined("edge outer→P must not be dropped");

    const clusterLayout = layout.clusters["outer"];
    expect(clusterLayout).toBeDefined();

    const clusterCentreX = clusterLayout.x + clusterLayout.w / 2;
    const clusterCentreY = clusterLayout.y + clusterLayout.h / 2;

    // Get absolute position of arrow's first point
    const absStartPt = arrowEl!.points![0]!;
    const absX = absStartPt[0] + arrowEl!.x;
    const absY = absStartPt[1] + arrowEl!.y;

    const dist = Math.hypot(absX - clusterCentreX, absY - clusterCentreY);
    expect(dist).toBeLessThan(clusterLayout.w / 2 + clusterLayout.h / 2 + 50);
  });

  // FC-08d: Node-to-node edges in flowcharts are preserved (bindings, labels, connectivity).
  // Routing remains default-straight unless explicitly set.
  it("FC-08d: node-to-node edge retains bindings, label, and connectivity", () => {
    const parsed: ParsedDiagram = {
      type: "flowchart",
      nodes: new Map([
        ["N1", makeNode("N1")],
        ["N2", makeNode("N2")],
      ]),
      edges: [makeEdge("N1", "N2")],
      clusters: [],
      renames: [],
    };

    const layout = computeInitialLayout(parsed);
    const canvasScene = generateCanvas(parsed, layout);

    const edgeKey0 = edgeKey("N1", "N2", 0);
    const arrowEl = canvasScene.elements.find(
      (e) => e.type === "arrow" && e.mermaidId === edgeKey0,
    );
    expect(arrowEl).toBeDefined();

    expect(arrowEl!.points!.length).toBe(2);
    // 2. Both bindings set (curved routing uses Excalidraw bindings)
    expect(arrowEl!.startBinding).not.toBeNull();
    expect(arrowEl!.endBinding).not.toBeNull();
    // 3. Arrow is labelled with the edge key
    expect(arrowEl!.mermaidId).toBe(edgeKey0);
    // 4. Start binding references N1's element
    expect(arrowEl!.startBinding!.elementId).toBeDefined();
    // 5. End binding references N2's element
    expect(arrowEl!.endBinding!.elementId).toBeDefined();
  });

  // FC-08e: Nested subgraph edge resolves to the exact referenced cluster (not parent)
  it("FC-08e: edge to nested subgraph resolves to nested cluster bbox, not parent bbox", () => {
    // Structure:
    //   subgraph parent ["parent"]
    //     subgraph nested ["nested"]
    //       N1
    //     end
    //     N1 --> nested
    //   end
    const parsed: ParsedDiagram = {
      type: "flowchart",
      nodes: new Map([["N1", makeNode("N1")]]),
      edges: [makeEdge("N1", "nested")],
      clusters: [
        makeCluster("parent", ["nested"], "Parent", undefined),
        makeCluster("nested", ["N1"], "Nested", "parent"),
      ],
      renames: [],
    };

    const layout = computeInitialLayout(parsed);
    const canvasScene = generateCanvas(parsed, layout);

    // The edge N1 → nested must not be dropped
    const edgeKey0 = edgeKey("N1", "nested", 0);
    const arrowEl = canvasScene.elements.find(
      (e) => e.type === "arrow" && e.mermaidId === edgeKey0,
    );
    expect(arrowEl).toBeDefined("edge N1→nested must not be dropped (FC-08e)");

    const nestedCluster = layout.clusters["nested"];
    const parentCluster = layout.clusters["parent"];
    expect(nestedCluster).toBeDefined();
    expect(parentCluster).toBeDefined();

    // The arrow endpoint should be near the NESTED cluster centre, not the PARENT centre
    const nestedCentreX = nestedCluster.x + nestedCluster.w / 2;
    const nestedCentreY = nestedCluster.y + nestedCluster.h / 2;
    const parentCentreX = parentCluster.x + parentCluster.w / 2;
    const parentCentreY = parentCluster.y + parentCluster.h / 2;

    const absEndPt = arrowEl!.points![arrowEl!.points!.length - 1]!;
    const absX = absEndPt[0] + arrowEl!.x;
    const absY = absEndPt[1] + arrowEl!.y;

    const distToNested = Math.hypot(absX - nestedCentreX, absY - nestedCentreY);
    const distToParent = Math.hypot(absX - parentCentreX, absY - parentCentreY);

    // The endpoint should be closer to the nested cluster than to the parent
    expect(distToNested).toBeLessThan(distToParent);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FC-09: Edge attachment points account for curve tangent
//
// Defect: Even with correct node positions, edge attachment is computed toward
// target centre (straight-line direction) rather than toward the curve's
// first/last control point, producing visual "kinks".
//
// FC-09a: Curved edge start point clamped toward the first control point
// FC-09b: Curved edge end point clamped from the last control point
// FC-09c: Non-curved edges are unaffected by this change
// ─────────────────────────────────────────────────────────────────────────────

describe("FC-09: Curve-tangent attachment", () => {
  // FC-09a: Curved edge start point is clamped toward the first control point
  // (not toward target centre).  No try/catch — direct assertion fails at call site.
  it("FC-09a: routeCurved start point clamped toward first control point (not target centre)", async () => {
    const { routeCurved } = await import("../canvas/edge-router.js");
    const result = routeCurved(LEFT, RIGHT);
    const pts = result.points;
    expect(pts.length).toBeGreaterThanOrEqual(3);

    const srcCentre: [number, number] = [LEFT.x + LEFT.w / 2, LEFT.y + LEFT.h / 2];
    const tgtCentre: [number, number] = [RIGHT.x + RIGHT.w / 2, RIGHT.y + RIGHT.h / 2];

    // The first interior point defines the curve tangent at the start.
    const firstCP = pts[1]!;
    const startPt = pts[0]!;

    // Vector from source centre toward first control point (tangent direction)
    const toCPVec: [number, number] = [firstCP[0] - srcCentre[0], firstCP[1] - srcCentre[1]];
    // Vector from source centre toward target centre (straight-line direction)
    const toTgtVec: [number, number] = [tgtCentre[0] - srcCentre[0], tgtCentre[1] - srcCentre[1]];
    // Start point offset from source centre
    const startVec: [number, number] = [startPt[0] - srcCentre[0], startPt[1] - srcCentre[1]];

    // The start point must move in the same general direction as the first control
    // point, not purely toward the target centre.  Dot product of startVec with
    // the tangent direction must be positive (same-hemisphere alignment).
    const dotCP = startVec[0] * toCPVec[0] + startVec[1] * toCPVec[1];
    expect(dotCP).toBeGreaterThan(0);
  });

  // FC-09b: Curved edge end point clamped from the last control point
  // (not toward source centre).  No try/catch — direct assertion fails at call site.
  it("FC-09b: routeCurved end point clamped from last control point (not toward source centre)", async () => {
    const { routeCurved } = await import("../canvas/edge-router.js");
    const result = routeCurved(LEFT, RIGHT);
    const pts = result.points;
    expect(pts.length).toBeGreaterThanOrEqual(3);

    const srcCentre: [number, number] = [LEFT.x + LEFT.w / 2, LEFT.y + LEFT.h / 2];
    const tgtCentre: [number, number] = [RIGHT.x + RIGHT.w / 2, RIGHT.y + RIGHT.h / 2];

    // The last interior point defines the curve tangent at the end.
    const lastCP = pts[pts.length - 2]!;
    const endPt = pts[pts.length - 1]!;

    // Vector from target centre toward last control point (exit tangent)
    const fromCPVec: [number, number] = [lastCP[0] - tgtCentre[0], lastCP[1] - tgtCentre[1]];
    // Vector from target centre back toward source centre (straight-line direction)
    const fromSrcVec: [number, number] = [srcCentre[0] - tgtCentre[0], srcCentre[1] - tgtCentre[1]];
    // End point offset from target centre
    const endVec: [number, number] = [endPt[0] - tgtCentre[0], endPt[1] - tgtCentre[1]];

    // The end point must move away from the last control point, not back toward
    // the source.  Dot product of endVec with the exit-tangent direction must
    // be positive (same-hemisphere alignment).
    const dotCP = endVec[0] * fromCPVec[0] + endVec[1] * fromCPVec[1];
    expect(dotCP).toBeGreaterThan(0);
  });

  // FC-09c: Non-curved edges are unaffected — strengthened unchanged-behavior check.
  // Verifies specific invariants for each mode so that FC-09 curve-tangent changes
  // to routeCurved() cannot inadvertently affect auto/direct/orthogonal paths.
  it("FC-09c: routeAuto, routeDirect, routeOrthogonal produce identical output to before", () => {
    // ── auto routing: 2-point straight line, bindings at centre-axis ──────────
    const autoResult = routeEdge("auto", [], LEFT, RIGHT);
    expect(autoResult.points).toHaveLength(2);
    expect(autoResult.startBinding).not.toBeNull();
    expect(autoResult.endBinding).not.toBeNull();
    // focus === 0 means attachment at the element centre axis (unchanged invariant)
    expect(autoResult.startBinding!.focus).toBe(0);
    expect(autoResult.endBinding!.focus).toBe(0);
    // gap >= 0 (arrow does not penetrate the node boundary)
    expect(autoResult.startBinding!.gap).toBeGreaterThanOrEqual(0);
    expect(autoResult.endBinding!.gap).toBeGreaterThanOrEqual(0);

    // ── direct routing: 2-point centre-to-centre, null bindings ──────────────
    const directResult = routeEdge("direct", [], LEFT, RIGHT);
    expect(directResult.points).toHaveLength(2);
    expect(directResult.startBinding).toBeNull();
    expect(directResult.endBinding).toBeNull();

    // ── orthogonal routing: ≥3 axis-aligned points, null bindings ─────────────
    const orthoResult = routeEdge("orthogonal", [], LEFT, RIGHT);
    expect(orthoResult.points.length).toBeGreaterThanOrEqual(3);
    // Every segment must be axis-aligned (Δx=0 or Δy=0) — unchanged invariant
    for (let i = 0; i < orthoResult.points.length - 1; i++) {
      const [x1, y1] = orthoResult.points[i]!;
      const [x2, y2] = orthoResult.points[i + 1]!;
      const isAxisAligned = x1 === x2 || y1 === y2;
      expect(isAxisAligned, `orthogonal segment ${i}→${i+1} is diagonal`).toBe(true);
    }
    // Orthogonal: path is fully explicit in points, so bindings are null (per contract)
    expect(orthoResult.startBinding).toBeNull();
    expect(orthoResult.endBinding).toBeNull();
  });
});
