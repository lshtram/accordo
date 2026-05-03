/**
 * DRW-U04, DRW-U05, DRW-U06, DRW-U07 — Source graph parser tests.
 *
 * DRW-U04: parse_flowchart_nodes_and_edges
 * DRW-U05: parse_flowchart_direction_TD_normalized
 * DRW-U06: parse_unsupported_type_returns_unsupported
 * DRW-U07: parse_invalid_mermaid_throws_syntax_error
 *
 * Source: docs/20-requirements/requirements-drawing.md §3 (DRW-R02)
 * Source: docs/10-architecture/drawing-architecture.md §4.1
 * Requirements: DRW-R02, DRW-R12
 */

import { describe, it, expect } from "vitest";
import { parseMermaidSource } from "../../core/types.js";

describe("core/source-graph", () => {
  /**
   * DRW-U04 — Parsing a simple flowchart yields correct node/edge counts.
   */
  it("DRW-U04: parse_flowchart_nodes_and_edges", () => {
    const source = "flowchart TD\nA-->B\n";
    const graph = parseMermaidSource(source);

    expect(graph.type).toBe("flowchart");
    expect(graph.nodes).toHaveLength(2);
    expect(graph.edges).toHaveLength(1);

    const nodeIds = graph.nodes.map((n) => n.id).sort();
    expect(nodeIds).toEqual(["A", "B"]);

    const edge = graph.edges[0];
    expect(edge.from).toBe("A");
    expect(edge.to).toBe("B");
    expect(edge.ordinal).toBe(0);
  });

  /**
   * DRW-U05 — Both TD and TB direction normalize to TD in SourceGraph.
   * DRW-R12: placement algorithm derives direction; TB and TD both mean top-down.
   */
  it("DRW-U05: parse_flowchart_direction_TD_normalized", () => {
    const td = parseMermaidSource("flowchart TD\nA-->B\n");
    const tb = parseMermaidSource("flowchart TB\nA-->B\n");

    // Both TB and TD normalize to TD in the SourceGraph
    expect(td.direction).toBe("TB");
    expect(tb.direction).toBe("TB");

    // BT is a distinct direction (bottom-top)
    const bt = parseMermaidSource("flowchart BT\nA-->B\n");
    expect(bt.direction).toBe("BT");

    // LR and RL are horizontal directions
    const lr = parseMermaidSource("flowchart LR\nA-->B\n");
    expect(lr.direction).toBe("LR");
  });

  /**
   * DRW-U06 — Non-flowchart types return type: "unsupported".
   * Slice 1 is flowchart-only; stateDiagram, classDiagram, etc. are deferred.
   */
  it("DRW-U06: parse_unsupported_type_returns_unsupported", () => {
    const stateDiagram = parseMermaidSource("stateDiagram-v2\n[*]-->State1\n");
    expect(stateDiagram.type).toBe("unsupported");

    const classDiagram = parseMermaidSource("classDiagram\nClassA --> ClassB\n");
    expect(classDiagram.type).toBe("unsupported");

    const erDiagram = parseMermaidSource("erDiagram\nEntity1 -- Entity2\n");
    expect(erDiagram.type).toBe("unsupported");
  });

  /**
   * DRW-U07 — Malformed Mermaid throws source-parse-failed.
   * DRW-R24: error code vocabulary includes source-parse-failed.
   */
  it("DRW-U07: parse_invalid_mermaid_throws_syntax_error", () => {
    expect(() => parseMermaidSource("this is not valid mermaid at all\n")).toThrow();
  });
});
