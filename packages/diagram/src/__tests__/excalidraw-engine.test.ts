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

import { describe, it, expect } from "vitest";
import { layoutWithExcalidraw } from "../layout/excalidraw-engine.js";
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

describe("layoutWithExcalidraw — EXC-01/EXC-02/EXC-03/EXC-04/EXC-05: contract tests", () => {
  // These tests are RED in Phase B and GREEN in Phase C.
  // All assertions are at the await level so unhandled rejections are impossible.

  it("EXC-04: resolved layout has version='1.0'", async () => {
    const parsed = makeDiagram("flowchart", [makeNode("A")], []);
    await expect(layoutWithExcalidraw("graph TD; A;", parsed)).resolves.toMatchObject({
      version: "1.0",
    });
  });

  it("EXC-05: resolved layout has diagram_type='flowchart'", async () => {
    const parsed = makeDiagram("flowchart", [makeNode("A")], []);
    await expect(layoutWithExcalidraw("graph TD; A;", parsed)).resolves.toMatchObject({
      diagram_type: "flowchart",
    });
  });

  it("EXC-04/EXC-05: resolved layout has nodes, edges, clusters, aesthetics fields", async () => {
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

  it("EXC-03: throws Error when type is stateDiagram-v2", async () => {
    const parsed = makeDiagram("stateDiagram-v2", []);
    await expect(layoutWithExcalidraw("stateDiagram-v2; Idle-->Active;", parsed)).rejects.toThrow();
  });
});
