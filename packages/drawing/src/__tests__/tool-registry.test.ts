/**
 * DRW-B04, DRW-B05, DRW-B06 — MCP tool namespace isolation.
 *
 * Proves accordo-drawing registers its own "accordo_drawing_*" tool names
 * and does NOT inherit or re-export any accordo_diagram_* tools.
 *
 * DRW-B04: drawing_tools_are_new_namespace
 * DRW-B05: no_accordo_diagram_tool_names_present
 * DRW-B06: five_drawing_tools_registered
 *
 * Source: docs/20-requirements/requirements-drawing.md §6, AGENTS.md §3 rule 3
 * Requirements: DRW-R17, DRW-R18, DRW-R19, DRW-R20, DRW-R21
 */

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

// Attempt to import the tool registry factory.
// If the package has no entry point yet, this import will throw and all tests fail.
// We gate on a conditional import so the tests produce a clear failure message.
let createDrawingTools: (ctx: unknown) => { name: string }[];

try {
  // Dynamic import of the (stub) entry point
  const module = await import("../../tools/drawing-tools.js");
  createDrawingTools = module.createDrawingTools;
} catch {
  // Stub entry — tests will fail with a clear message below
  createDrawingTools = () => {
    throw new Error("not implemented");
  };
}

const DIAGRAM_TOOL_NAMES = [
  "accordo_diagram_create",
  "accordo_diagram_merge",
  "accordo_diagram_patch",
  "accordo_diagram_query",
  "accordo_diagram_render",
  "accordo_diagram_list",
  "accordo_diagram_get",
  "accordo_diagram_style_guide",
];

const EXPECTED_DRAWING_TOOL_NAMES = [
  "accordo_drawing_create",
  "accordo_drawing_merge",
  "accordo_drawing_query",
  "accordo_drawing_patch",
  "accordo_drawing_render",
];

describe("tool-registry", () => {
  /**
   * DRW-B04 — drawing tool names start with "accordo_drawing_" prefix.
   * Fails if: any tool name does not start with "accordo_drawing_"
   */
  it("DRW-B04: drawing_tools_are_new_namespace", () => {
    const tools = createDrawingTools({ workspaceRoot: "/test", getPanel: () => undefined });
    const names = tools.map((t) => t.name);

    for (const name of names) {
      expect(name).toMatch(/^accordo_drawing_/);
    }
  });

  /**
   * DRW-B05 — no accordo_diagram tool names appear in the drawing tool set.
   * Fails if: any of the diagram tool names are present
   */
  it("DRW-B05: no_accordo_diagram_tool_names_present", () => {
    const tools = createDrawingTools({ workspaceRoot: "/test", getPanel: () => undefined });
    const names = tools.map((t) => t.name);

    for (const diagramName of DIAGRAM_TOOL_NAMES) {
      expect(names).not.toContain(diagramName);
    }
  });

  /**
   * DRW-B06 — exactly 5 drawing tools are registered.
   * Fails if: the count is not 5 (too few = missing tools, too many = extra tools)
   */
  it("DRW-B06: five_drawing_tools_registered", () => {
    const tools = createDrawingTools({ workspaceRoot: "/test", getPanel: () => undefined });
    expect(tools).toHaveLength(5);

    const names = tools.map((t) => t.name).sort();
    const expectedSorted = [...EXPECTED_DRAWING_TOOL_NAMES].sort();
    expect(names).toEqual(expectedSorted);
  });
});
