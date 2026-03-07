/**
 * Tests for src/tools/layout.ts — Module 20
 *
 * Phase B — all tests MUST fail RED against "not implemented" stubs.
 *
 * Requirement coverage:
 *   [x] §4.14 panel.toggle      — 5 panel→command mappings, invalid panel error
 *   [x] §4.15 layout.zen        — toggleZenMode command
 *   [x] §4.16 layout.fullscreen — toggleFullScreen command
 *   [x] §4.23 layout.joinGroups — joinAllGroups command, returns { groups: 1 }
 *   [x] §4.24 layout.evenGroups — evenEditorWidths command, returns { equalized: true }
 *   [x] Registration            — 5 tools, schemas, danger levels
 *
 * Exported API checklist (dev-process.md §5 Phase B Coverage Audit):
 *   ✓ panelToggleHandler        — 9 tests (§4.14-PANEL-* × 5 happy + ERR + MISSING + R01 + existing)
 *   ✓ layoutZenHandler          — 2 tests (§4.15-ZEN-01, R01)
 *   ✓ layoutFullscreenHandler   — 2 tests (§4.16-FS-01, R01)
 *   ✓ layoutJoinGroupsHandler   — 2 tests (§4.23-JOIN-01, R01)
 *   ✓ layoutEvenGroupsHandler   — 2 tests (§4.24-EVEN-01, R01)
 *   ✓ layoutTools[]             — 7 registration tests (M20-REG-01..07)
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  panelToggleHandler,
  layoutZenHandler,
  layoutFullscreenHandler,
  layoutJoinGroupsHandler,
  layoutEvenGroupsHandler,
  layoutTools,
} from "../tools/layout.js";

import * as vscodeMock from "./mocks/vscode.js";
const { commands } = vscodeMock;

beforeEach(() => {
  vi.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// §4.14 accordo_panel_toggle
// ─────────────────────────────────────────────────────────────────────────────

describe("panelToggleHandler — §4.14", () => {
  const panelCases: Array<[string, string]> = [
    ["explorer",   "workbench.view.explorer"],
    ["search",     "workbench.view.search"],
    ["git",        "workbench.view.scm"],
    ["debug",      "workbench.view.debug"],
    ["extensions", "workbench.view.extensions"],
  ];

  for (const [panel, vsCommand] of panelCases) {
    it(`§4.14-PANEL-${panel.toUpperCase()}: '${panel}' executes '${vsCommand}'`, async () => {
      const result = await panelToggleHandler({ panel });
      expect(result).toEqual({ visible: true, panel });
      expect(commands.executeCommand).toHaveBeenCalledWith(vsCommand);
    });
  }

  it("§4.14-PANEL-ERR: returns error with message for unknown panel name", async () => {
    const result = await panelToggleHandler({ panel: "unknownpanel" });
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toMatch(/panel/i);
  });

  it("§4.14-PANEL-MISSING: returns error with message when panel argument is missing", async () => {
    const result = await panelToggleHandler({});
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toMatch(/panel/i);
  });

  it("§4.14-PANEL-R01: wraps command rejection as { error } (via wrapHandler)", async () => {
    vi.mocked(commands.executeCommand).mockRejectedValueOnce(new Error("panel failed"));
    const result = await panelToggleHandler({ panel: "explorer" });
    // wrapHandler catches and returns error — or handler may rethrow
    // Either way, result.error should exist
    expect(result).toHaveProperty("error");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4.15 accordo_layout_zen
// ─────────────────────────────────────────────────────────────────────────────

describe("layoutZenHandler — §4.15", () => {
  it("§4.15-ZEN-01: executes toggleZenMode and returns { active: true }", async () => {
    await expect(layoutZenHandler({})).resolves.toEqual({ active: true });
    expect(commands.executeCommand).toHaveBeenCalledWith(
      "workbench.action.toggleZenMode",
    );
  });

  it("§4.15-ZEN-R01: wraps command rejection as { error: string }", async () => {
    vi.mocked(commands.executeCommand).mockRejectedValueOnce(new Error("zen fail"));
    const result = await layoutZenHandler({});
    expect(result).toMatchObject({ error: "zen fail" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4.16 accordo_layout_fullscreen
// ─────────────────────────────────────────────────────────────────────────────

describe("layoutFullscreenHandler — §4.16", () => {
  it("§4.16-FS-01: executes toggleFullScreen and returns { active: true }", async () => {
    await expect(layoutFullscreenHandler({})).resolves.toEqual({ active: true });
    expect(commands.executeCommand).toHaveBeenCalledWith(
      "workbench.action.toggleFullScreen",
    );
  });

  it("§4.16-FS-R01: wraps command rejection as { error: string }", async () => {
    vi.mocked(commands.executeCommand).mockRejectedValueOnce(new Error("fs fail"));
    const result = await layoutFullscreenHandler({});
    expect(result).toMatchObject({ error: "fs fail" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4.23 accordo_layout_joinGroups
// ─────────────────────────────────────────────────────────────────────────────

describe("layoutJoinGroupsHandler — §4.23", () => {
  it("§4.23-JOIN-01: executes joinAllGroups and returns { groups: 1 }", async () => {
    await expect(layoutJoinGroupsHandler({})).resolves.toEqual({ groups: 1 });
    expect(commands.executeCommand).toHaveBeenCalledWith(
      "workbench.action.joinAllGroups",
    );
  });

  it("§4.23-JOIN-R01: wraps command rejection as { error: string }", async () => {
    vi.mocked(commands.executeCommand).mockRejectedValueOnce(new Error("join fail"));
    const result = await layoutJoinGroupsHandler({});
    expect(result).toMatchObject({ error: "join fail" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4.24 accordo_layout_evenGroups
// ─────────────────────────────────────────────────────────────────────────────

describe("layoutEvenGroupsHandler — §4.24", () => {
  it("§4.24-EVEN-01: executes evenEditorWidths and returns { equalized: true }", async () => {
    await expect(layoutEvenGroupsHandler({})).resolves.toEqual({ equalized: true });
    expect(commands.executeCommand).toHaveBeenCalledWith(
      "workbench.action.evenEditorWidths",
    );
  });

  it("§4.24-EVEN-R01: wraps command rejection as { error: string }", async () => {
    vi.mocked(commands.executeCommand).mockRejectedValueOnce(new Error("even fail"));
    const result = await layoutEvenGroupsHandler({});
    expect(result).toMatchObject({ error: "even fail" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Registration — Module 20
// ─────────────────────────────────────────────────────────────────────────────

describe("layoutTools registration — Module 20", () => {
  const byName = (name: string) => layoutTools.find((t) => t.name === name)!;

  it("M20-REG-01: exports exactly 5 tool definitions", () => {
    expect(layoutTools).toHaveLength(5);
  });

  it("M20-REG-02: all tool names are present", () => {
    const names = layoutTools.map((t) => t.name);
    expect(names).toContain("accordo_panel_toggle");
    expect(names).toContain("accordo_layout_zen");
    expect(names).toContain("accordo_layout_fullscreen");
    expect(names).toContain("accordo_layout_joinGroups");
    expect(names).toContain("accordo_layout_evenGroups");
  });

  it("M20-REG-03: all tools are safe", () => {
    for (const t of layoutTools) {
      expect(t.dangerLevel).toBe("safe");
    }
  });

  it("M20-REG-04: panel.toggle requires [panel]", () => {
    expect(byName("accordo_panel_toggle").inputSchema.required).toContain("panel");
  });

  it("M20-REG-05: panel enum contains all 5 panels", () => {
    const props = byName("accordo_panel_toggle").inputSchema.properties as Record<
      string,
      { enum?: string[] }
    >;
    expect(props["panel"].enum).toEqual(
      expect.arrayContaining(["explorer", "search", "git", "debug", "extensions"]),
    );
  });

  it("M20-REG-06: zen, fullscreen, joinGroups, evenGroups have empty required", () => {
    const noArgTools = [
      "accordo_layout_zen",
      "accordo_layout_fullscreen",
      "accordo_layout_joinGroups",
      "accordo_layout_evenGroups",
    ];
    for (const name of noArgTools) {
      expect(byName(name).inputSchema.required).toEqual([]);
    }
  });

  it("M20-REG-07: all handlers are functions", () => {
    for (const tool of layoutTools) {
      expect(typeof tool.handler).toBe("function");
    }
  });
});


