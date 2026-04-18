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
  // These tests are RED in Phase B and GREEN in Phase C.
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
    expect(layout.clusters["Session"]).toMatchObject({ x: 120, y: -42, w: 660, h: 402 });
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
