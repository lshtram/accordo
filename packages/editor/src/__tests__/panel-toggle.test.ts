/**
 * Tests for panelToggleHandler — E-4 bottom panel extension
 *
 * Phase B — all tests MUST fail RED against "not implemented" stubs.
 * These tests validate §4.14 panel.toggle with bottom panel support:
 *   terminal, output, problems, debug-console  (§4.14-E4-*)
 *
 * Requirement coverage:
 *   [x] §4.14-E4-BOTTOM: 4 bottom panels → area:"panel", correct command
 *   [x] §4.14-E4-SIDEBAR: 5 sidebar panels → area:"sidebar", correct command
 *   [x] §4.14-E4-INVALID: unknown panel → { error } with valid panel names
 *   [x] §4.14-E4-MISSING: missing panel arg → { error }
 *   [x] §4.14-E4-EMPTY: empty string panel → { error }
 *   [x] §4.14-E4-REJECT: command rejection → { error }
 *
 * Exported API checklist:
 *   ✓ panelToggleHandler — 14 tests total
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { panelToggleHandler } from "../tools/layout.js";

import * as vscodeMock from "./mocks/vscode.js";
const { commands } = vscodeMock;

beforeEach(() => {
  vi.clearAllMocks();
  // Default: executeCommand resolves successfully
  vi.mocked(commands.executeCommand).mockResolvedValue(undefined);
});

// ─────────────────────────────────────────────────────────────────────────────
// §4.14-E4-BOTTOM: 4 new bottom panels
// ─────────────────────────────────────────────────────────────────────────────

describe("panelToggleHandler — §4.14-E4 bottom panels", () => {
  const bottomPanelCases: Array<[string, string]> = [
    ["terminal",      "workbench.action.terminal.toggleTerminal"],
    ["output",        "workbench.action.output.toggleOutput"],
    ["problems",      "workbench.actions.view.problems"],
    ["debug-console", "workbench.debug.action.toggleRepl"],
  ];

  for (const [panel, vsCommand] of bottomPanelCases) {
    it(`§4.14-E4-BOTTOM-${panel.toUpperCase()}: '${panel}' → area:"panel", calls '${vsCommand}'`, async () => {
      const result = await panelToggleHandler({ panel });
      expect(result).toEqual({ panel, area: "panel" });
      expect(commands.executeCommand).toHaveBeenCalledWith(vsCommand);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// §4.14-E4-SIDEBAR: 5 existing sidebar panels (regression)
// ─────────────────────────────────────────────────────────────────────────────

describe("panelToggleHandler — §4.14-E4 sidebar regression", () => {
  const sidebarPanelCases: Array<[string, string]> = [
    ["explorer",   "workbench.view.explorer"],
    ["search",     "workbench.view.search"],
    ["git",        "workbench.view.scm"],
    ["debug",      "workbench.view.debug"],
    ["extensions", "workbench.view.extensions"],
  ];

  for (const [panel, vsCommand] of sidebarPanelCases) {
    it(`§4.14-E4-SIDEBAR-${panel.toUpperCase()}: '${panel}' → area:"sidebar", calls '${vsCommand}'`, async () => {
      const result = await panelToggleHandler({ panel });
      expect(result).toEqual({ panel, area: "sidebar" });
      expect(commands.executeCommand).toHaveBeenCalledWith(vsCommand);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// §4.14-E4-INVALID: unknown panel name
// ─────────────────────────────────────────────────────────────────────────────

describe("panelToggleHandler — §4.14-E4 invalid panel", () => {
  it("§4.14-E4-INVALID: unknown panel returns { error } that lists all valid panels", async () => {
    const result = await panelToggleHandler({ panel: "not_a_panel" });
    expect(result).toHaveProperty("error");
    const error = (result as { error: string }).error;
    // Error message must include all 9 valid panel names
    expect(error).toMatch(/explorer/);
    expect(error).toMatch(/search/);
    expect(error).toMatch(/git/);
    expect(error).toMatch(/debug/);
    expect(error).toMatch(/extensions/);
    expect(error).toMatch(/terminal/);
    expect(error).toMatch(/output/);
    expect(error).toMatch(/problems/);
    expect(error).toMatch(/debug-console/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4.14-E4-MISSING: missing panel argument
// ─────────────────────────────────────────────────────────────────────────────

describe("panelToggleHandler — §4.14-E4 missing panel argument", () => {
  it("§4.14-E4-MISSING: no panel argument returns { error }", async () => {
    const result = await panelToggleHandler({});
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toMatch(/panel/i);
  });

  it("§4.14-E4-EMPTY: empty string panel returns { error }", async () => {
    const result = await panelToggleHandler({ panel: "" });
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toMatch(/panel/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4.14-E4-REJECT: command execution failure
// ─────────────────────────────────────────────────────────────────────────────

describe("panelToggleHandler — §4.14-E4 command rejection", () => {
  it("§4.14-E4-REJECT: executeCommand rejection returns { error }", async () => {
    vi.mocked(commands.executeCommand).mockRejectedValue(new Error("command failed"));
    const result = await panelToggleHandler({ panel: "terminal" });
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toMatch(/command failed/i);
  });
});
