/**
 * Excalidraw Engine — tests for layoutWithExcalidraw() adapter.
 *
 * Validates the approved design in:
 *   docs/30-development/diagram-update-plan.md §7.3
 *
 * Requirements:
 *   EXC-01: layoutWithExcalidraw() is an async function
 *   EXC-02: rejects empty/undefined source with Error
 *   EXC-03: rejects non-flowchart type with Error
 *   EXC-04: returns a valid LayoutStore on success (version="1.0")
 *   EXC-05: LayoutStore has correct diagram_type="flowchart"
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { layoutWithExcalidraw } from "../layout/excalidraw-engine.js";
import type { ParsedDiagram, ParsedNode, ParsedEdge, ParsedCluster } from "../types.js";

const compositeStateSkeletons = [
  { id: "g-first", type: "rectangle", x: 20, y: 20, width: 140, height: 120, label: "First", groupId: "first" },
  { id: "g-second", type: "rectangle", x: 260, y: 20, width: 150, height: 120, label: "Second", groupId: "second" },
  { id: "e-1", type: "arrow", x: 120, y: 85, points: [[0, 0], [60, 35], [140, 35]] },
];

const compositeTransitionsState04Skeletons = [
  { id: "root", type: "ellipse", x: 128, y: 8, width: 14, height: 14 },
  { id: "first", type: "rectangle", x: 84, y: 72, width: 86, height: 269, label: "First", groupId: "first" },
  { id: "second", type: "rectangle", x: 8, y: 407, width: 86, height: 269, label: "Second", groupId: "second" },
  { id: "third", type: "rectangle", x: 160, y: 407, width: 86, height: 269, label: "Third", groupId: "third" },
  { id: "first-start", type: "ellipse", x: 120, y: 109.5, width: 14, height: 14 },
  { id: "fir", type: "rectangle", x: 119, y: 198.5, width: 16, height: 16, label: "fir" },
  { id: "first-end", type: "ellipse", x: 120, y: 289.5, width: 14.017724288152426, height: 14 },
  { id: "first-end-inner", type: "ellipse", x: 124.48, y: 293.98, width: 5.057724288152425, height: 5.039999999999999 },
  { id: "second-start", type: "ellipse", x: 44, y: 444.5, width: 14, height: 14 },
  { id: "sec", type: "rectangle", x: 43, y: 533.5, width: 16, height: 16, label: "sec" },
  { id: "second-end", type: "ellipse", x: 44, y: 624.5, width: 14.017724288152426, height: 14 },
  { id: "second-end-inner", type: "ellipse", x: 48.480000000000004, y: 628.98, width: 5.057724288152425, height: 5.039999999999999 },
  { id: "third-start", type: "ellipse", x: 196, y: 444.5, width: 14, height: 14 },
  { id: "thi", type: "rectangle", x: 195, y: 533.5, width: 16, height: 16, label: "thi" },
  { id: "third-end", type: "ellipse", x: 196, y: 624.5, width: 14.017724288152426, height: 14 },
  { id: "third-end-inner", type: "ellipse", x: 200.48, y: 628.98, width: 5.057724288152425, height: 5.039999999999999 },
  { id: "root-arrow", type: "arrow", x: 135, y: 22, points: [[0, 0], [0, 4.167000000000002], [0, 25], [0, 50]] },
  { id: "first-second", type: "arrow", x: 84, y: 326.901, points: [[0, 0], [-4.167000000000002, 9.182999999999993], [-20.833, 50.08299999999997], [-25, 80.09899999999999]] },
  { id: "first-third", type: "arrow", x: 186, y: 326.901, points: [[0, 0], [4.167000000000002, 9.182999999999993], [20.833, 50.08299999999997], [25, 80.09899999999999]] },
  { id: "first-start-fir", type: "arrow", x: 127, y: 123.5, points: [[0, 0], [0, 6.25], [0.08299999999999841, 37.583], [0.5, 75.5]] },
  { id: "fir-first-end", type: "arrow", x: 127.5, y: 215, points: [[0, 0], [-0.08299999999999841, 6.167000000000002], [-0.4170000000000016, 37.083], [-0.5, 74.5]] },
  { id: "second-start-sec", type: "arrow", x: 51, y: 458.5, points: [[0, 0], [0, 6.25], [0.08299999999999841, 37.58299999999997], [0.5, 75.5]] },
  { id: "sec-second-end", type: "arrow", x: 51.5, y: 550, points: [[0, 0], [-0.08299999999999841, 6.16700000000003], [-0.4170000000000016, 37.08299999999997], [-0.5, 74.5]] },
  { id: "third-start-thi", type: "arrow", x: 203, y: 458.5, points: [[0, 0], [0, 6.25], [0.08299999999999841, 37.58299999999997], [0.5, 75.5]] },
  { id: "thi-third-end", type: "arrow", x: 203.5, y: 550, points: [[0, 0], [-0.08299999999999841, 6.16700000000003], [-0.4170000000000016, 37.08299999999997], [-0.5, 74.5]] },
];

const defaultSkeletons = [
  { id: "A", type: "rectangle", x: 10, y: 20, width: 120, height: 60, text: "A" },
  { id: "B", type: "rectangle", x: 220, y: 20, width: 120, height: 60, text: "B" },
  { id: "e", type: "arrow", x: 130, y: 50, points: [[0, 0], [90, 0]] },
];

vi.mock("@excalidraw/mermaid-to-excalidraw", () => ({
  parseMermaidToExcalidraw: vi.fn(),
}));

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

describe("layoutWithExcalidraw — EXC-01/EXC-02/EXC-03/EXC-04/EXC-05: contract tests", () => {
  // All assertions are at the await level so unhandled rejections are impossible.

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("EXC-04: resolved layout has version='1.0'", async () => {
    const parsed = makeDiagram("flowchart", [makeNode("A")], []);
    const { parseMermaidToExcalidraw } = await import("@excalidraw/mermaid-to-excalidraw");
    vi.mocked(parseMermaidToExcalidraw).mockResolvedValueOnce({ elements: defaultSkeletons });
    await expect(layoutWithExcalidraw("graph TD; A;", parsed)).resolves.toMatchObject({
      version: "1.0",
    });
  });

  it("EXC-05: resolved layout has diagram_type='flowchart'", async () => {
    const parsed = makeDiagram("flowchart", [makeNode("A")], []);
    const { parseMermaidToExcalidraw } = await import("@excalidraw/mermaid-to-excalidraw");
    vi.mocked(parseMermaidToExcalidraw).mockResolvedValueOnce({ elements: defaultSkeletons });
    await expect(layoutWithExcalidraw("graph TD; A;", parsed)).resolves.toMatchObject({
      diagram_type: "flowchart",
    });
  });

  it("EXC-04/EXC-05: resolved layout has nodes, edges, clusters, aesthetics fields", async () => {
    const { parseMermaidToExcalidraw } = await import("@excalidraw/mermaid-to-excalidraw");
    vi.mocked(parseMermaidToExcalidraw).mockResolvedValueOnce({ elements: defaultSkeletons });
    const parsed = makeDiagram(
      "flowchart",
      [makeNode("A"), makeNode("B")],
      [makeEdge("A", "B", 0)],
    );
    const layout = await layoutWithExcalidraw("graph TD; A-->B;", parsed);

    expect(typeof layout.nodes).toBe("object");
    expect(typeof layout.edges).toBe("object");
    expect(typeof layout.clusters).toBe("object");
    expect(typeof layout.aesthetics).toBe("object");
    expect(layout.version).toBe("1.0");
    expect(layout.diagram_type).toBe("flowchart");
  });

  it("EXC-04/EXC-05: resolved layout places all nodes with finite coordinates", async () => {
    const { parseMermaidToExcalidraw } = await import("@excalidraw/mermaid-to-excalidraw");
    vi.mocked(parseMermaidToExcalidraw).mockResolvedValueOnce({ elements: defaultSkeletons });
    const parsed = makeDiagram(
      "flowchart",
      [makeNode("A"), makeNode("B")],
      [makeEdge("A", "B", 0)],
    );
    const layout = await layoutWithExcalidraw("graph TD; A-->B;", parsed);

    expect(layout.nodes["A"]).toBeDefined();
    expect(layout.nodes["B"]).toBeDefined();
    expect(Number.isFinite(layout.nodes["A"].x)).toBe(true);
    expect(Number.isFinite(layout.nodes["A"].y)).toBe(true);
    expect(Number.isFinite(layout.nodes["B"].x)).toBe(true);
    expect(Number.isFinite(layout.nodes["B"].y)).toBe(true);
  });

  // ── EXC-02/EXC-03: error-path contract ──────────────────────────────────────

  it("EXC-02: throws Error when source is empty string", async () => {
    const parsed = makeDiagram("flowchart", []);
    await expect(layoutWithExcalidraw("", parsed)).rejects.toThrow();
  });

  it("EXC-02: throws Error when source is only whitespace", async () => {
    const parsed = makeDiagram("flowchart", []);
    await expect(layoutWithExcalidraw("   \n  ", parsed)).rejects.toThrow();
  });

  it("EXC-02: throws Error when source is undefined", async () => {
    // @ts-expect-error — deliberately pass wrong type to exercise the undefined path
    await expect(layoutWithExcalidraw(undefined, makeDiagram("flowchart", []))).rejects.toThrow();
  });

  it("EXC-03: throws Error when type is classDiagram", async () => {
    const parsed = makeDiagram("classDiagram", []);
    await expect(layoutWithExcalidraw("class A {}", parsed)).rejects.toThrow();
  });

  it("EXC-06: matched state composite edges keep upstream waypoints", async () => {
    const parsed = makeDiagram(
      "stateDiagram-v2",
      [],
      [makeEdge("First", "Second", 0)],
      [
        { id: "First", label: "First", members: [] },
        { id: "Second", label: "Second", members: [] },
      ],
    );

    const { parseMermaidToExcalidraw } = await import("@excalidraw/mermaid-to-excalidraw");
    vi.mocked(parseMermaidToExcalidraw).mockResolvedValueOnce({ elements: compositeStateSkeletons });

    const layout = await layoutWithExcalidraw(
      "stateDiagram-v2\n  state First\n  state Second\n  First --> Second",
      parsed,
    );

    expect(layout.edges["First->Second:0"]).toMatchObject({
      routing: "direct",
      waypoints: [{ x: 270, y: 180 }],
    });
  });

  it("EXC-07: stateDiagram-v2 returns canonical scaled geometry", async () => {
    const parsed = makeDiagram(
      "stateDiagram-v2",
      [makeNode("Ready"), makeNode("Busy")],
      [makeEdge("Ready", "Busy", 0)],
      [{ id: "Session", label: "Session", members: ["Ready", "Busy"] }],
    );

    const { parseMermaidToExcalidraw } = await import("@excalidraw/mermaid-to-excalidraw");
    vi.mocked(parseMermaidToExcalidraw).mockResolvedValueOnce({
      elements: [
        { id: "group", type: "rectangle", x: 100, y: 20, width: 400, height: 200, label: "Session", groupId: "session" },
        { id: "ready", type: "rectangle", x: 180, y: 40, width: 100, height: 50, label: "Ready" },
        { id: "busy", type: "rectangle", x: 180, y: 120, width: 100, height: 50, label: "Busy" },
        { id: "edge", type: "arrow", x: 230, y: 90, points: [[0, 0], [5, 15], [10, 30]] },
      ],
    });

    const layout = await layoutWithExcalidraw(
      "stateDiagram-v2\n  state Session { Ready --> Busy }",
      parsed,
    );

    expect(layout.nodes["Ready"]).toMatchObject({ x: 270, y: 60, w: 150, h: 75 });
    expect(layout.nodes["Busy"]).toMatchObject({ x: 270, y: 180, w: 150, h: 75 });
    expect(layout.edges["Ready->Busy:0"]).toMatchObject({
      routing: "direct",
      waypoints: [{ x: 352.5, y: 157.5 }],
    });
    expect(layout.clusters["Session"]).toMatchObject({ x: 150, y: 30, w: 600, h: 300 });
  });

  it("EXC-09: stateDiagram-v2 pairs composite internal edges with the correct upstream arrows", async () => {
    const parsed = makeDiagram(
      "stateDiagram-v2",
      [
        makeNode("root_start", "", "stateStart"),
        { ...makeNode("First_start", "", "stateStart"), cluster: "First" },
        { ...makeNode("fir", "fir", "rounded"), cluster: "First" },
        { ...makeNode("First_end", "", "stateEnd"), cluster: "First" },
        { ...makeNode("Second_start", "", "stateStart"), cluster: "Second" },
        { ...makeNode("sec", "sec", "rounded"), cluster: "Second" },
        { ...makeNode("Second_end", "", "stateEnd"), cluster: "Second" },
        { ...makeNode("Third_start", "", "stateStart"), cluster: "Third" },
        { ...makeNode("thi", "thi", "rounded"), cluster: "Third" },
        { ...makeNode("Third_end", "", "stateEnd"), cluster: "Third" },
      ],
      [
        makeEdge("root_start", "First", 0),
        makeEdge("First", "Second", 0),
        makeEdge("First", "Third", 0),
        makeEdge("First_start", "fir", 0),
        makeEdge("fir", "First_end", 0),
        makeEdge("Second_start", "sec", 0),
        makeEdge("sec", "Second_end", 0),
        makeEdge("Third_start", "thi", 0),
        makeEdge("thi", "Third_end", 0),
      ],
      [
        { id: "First", label: "First", members: ["First_start", "fir", "First_end"] },
        { id: "Second", label: "Second", members: ["Second_start", "sec", "Second_end"] },
        { id: "Third", label: "Third", members: ["Third_start", "thi", "Third_end"] },
      ],
    );

    const { parseMermaidToExcalidraw } = await import("@excalidraw/mermaid-to-excalidraw");
    vi.mocked(parseMermaidToExcalidraw).mockResolvedValueOnce({ elements: compositeTransitionsState04Skeletons });

    const layout = await layoutWithExcalidraw(
      "stateDiagram-v2\n  [*] --> First\n  First --> Second\n  First --> Third\n  state First { [*] --> fir\n    fir --> [*] }\n  state Second { [*] --> sec\n    sec --> [*] }\n  state Third { [*] --> thi\n    thi --> [*] }",
      parsed,
    );

    expect(layout.edges["root_start->First:0"]).toMatchObject({
      routing: "direct",
      waypoints: [{ x: 202.5, y: 39.2505 }, { x: 202.5, y: 70.5 }],
    });
    expect(layout.edges["First_start->fir:0"]).toMatchObject({
      routing: "direct",
      waypoints: [{ x: 190.5, y: 194.625 }, { x: 190.6245, y: 241.6245 }],
    });
    expect(layout.edges["fir->First_end:0"]).toMatchObject({
      routing: "direct",
      waypoints: [{ x: 191.1255, y: 331.7505 }, { x: 190.6245, y: 378.1245 }],
    });
  });

  it("EXC-08: flowchart geometry is not scaled", async () => {
    const parsed = makeDiagram(
      "flowchart",
      [makeNode("A"), makeNode("B")],
      [makeEdge("A", "B", 0)],
    );

    const { parseMermaidToExcalidraw } = await import("@excalidraw/mermaid-to-excalidraw");
    vi.mocked(parseMermaidToExcalidraw).mockResolvedValueOnce({ elements: defaultSkeletons });

    const layout = await layoutWithExcalidraw("graph TD; A-->B;", parsed);

    expect(layout.nodes["A"]).toMatchObject({ x: 10, y: 20, w: 120, h: 60 });
    expect(layout.nodes["B"]).toMatchObject({ x: 220, y: 20, w: 120, h: 60 });
  });
});
