/**
 * Tests for src/tools/layout.ts — Module 20 + M74-LS
 *
 * Phase B — all tests MUST fail RED against "not implemented" stubs.
 *
 * Requirement coverage:
 *   [x] §4.14 panel.toggle      — 5 panel→command mappings, invalid panel error
 *   [x] §4.15 layout.zen        — toggleZenMode command
 *   [x] §4.16 layout.fullscreen — toggleFullScreen command
 *   [x] §4.23 layout.joinGroups — joinAllGroups command, returns { groups: 1 }
 *   [x] §4.24 layout.evenGroups — evenEditorWidths command, returns { equalized: true }
 *   [x] §4.25 layout.state      — M74-LS: createLayoutTools factory, returns IDEState
 *   [x] Registration            — 5+1 tools, schemas, danger levels
 *
 * Exported API checklist (dev-process.md §5 Phase B Coverage Audit):
 *   ✓ panelToggleHandler        — 9 tests (§4.14-PANEL-* × 5 happy + ERR + MISSING + R01 + existing)
 *   ✓ layoutZenHandler          — 2 tests (§4.15-ZEN-01, R01)
 *   ✓ layoutFullscreenHandler   — 2 tests (§4.16-FS-01, R01)
 *   ✓ layoutJoinGroupsHandler   — 2 tests (§4.23-JOIN-01, R01)
 *   ✓ layoutEvenGroupsHandler   — 2 tests (§4.24-EVEN-01, R01)
 *   ✓ layoutStateHandler        — 4 tests (M74-LS-02, M74-LS-05, M74-LS-06, M74-LS-03)
 *   ✓ createLayoutTools()       — 5 tests (M74-LS-01, M74-LS-07, REG count, schemas, handlers)
 *   ✓ layoutTools[]             — 7 registration tests (M20-REG-01..07, now counts 5+1)
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { IDEState } from "@accordo/bridge-types";
import {
  panelToggleHandler,
  layoutZenHandler,
  layoutFullscreenHandler,
  layoutJoinGroupsHandler,
  layoutEvenGroupsHandler,
  layoutTools,
  createLayoutTools,
  layoutStateHandler,
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

// ─────────────────────────────────────────────────────────────────────────────
// §4.25 M74-LS: layoutStateHandler
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tests for M74-LS: accordo_layout_state tool.
 * Requirements: requirements-editor.md §4.25
 */

function makeIDEState(overrides: Partial<IDEState> = {}): IDEState {
  return {
    activeFile: null,
    activeFileLine: 1,
    activeFileColumn: 1,
    openEditors: [],
    openTabs: [],
    visibleEditors: [],
    workspaceFolders: [],
    activeTerminal: null,
    workspaceName: null,
    remoteAuthority: null,
    modalities: {},
    ...overrides,
  };
}

describe("layoutStateHandler — §4.25 M74-LS", () => {
  // M74-LS-02: returns { ok: true, state } from getState()
  it("M74-LS-02: returns { ok: true, state } with full IDEState from getState()", async () => {
    const ideState = makeIDEState({ activeFile: "/workspace/main.ts", activeFileLine: 10 });
    const getState = vi.fn(() => ideState);
    const result = await layoutStateHandler({}, getState);
    expect(result).toEqual({ ok: true, state: ideState });
    expect(getState).toHaveBeenCalledOnce();
  });

  // M74-LS-03: state.openTabs is present (populated by getState)
  it("M74-LS-03: returned state includes openTabs field", async () => {
    const ideState = makeIDEState({
      openTabs: [
        { label: "arch.mmd", type: "webview", viewType: "accordo.diagram", isActive: true, groupIndex: 0 },
      ],
    });
    const getState = vi.fn(() => ideState);
    const result = await layoutStateHandler({}, getState);
    expect(result).toMatchObject({ ok: true });
    const okResult = result as { ok: true; state: IDEState };
    expect(okResult.state.openTabs).toHaveLength(1);
    expect(okResult.state.openTabs[0].viewType).toBe("accordo.diagram");
  });

  // M74-LS-04: state.modalities reflects latest per-extension state
  it("M74-LS-04: returned state.modalities contains latest per-extension state", async () => {
    const modalityData = {
      "accordo-comments": {
        isOpen: true,
        openThreadCount: 3,
        resolvedThreadCount: 1,
        summary: [],
      },
      "accordo-diagram": {
        panelOpen: true,
        diagramCount: 2,
      },
    };
    const ideState = makeIDEState({ modalities: modalityData });
    const getState = vi.fn(() => ideState);
    const result = await layoutStateHandler({}, getState);
    expect(result).toMatchObject({ ok: true });
    const okResult = result as { ok: true; state: IDEState };
    expect(okResult.state.modalities).toEqual(modalityData);
    expect(okResult.state.modalities["accordo-comments"]).toMatchObject({ openThreadCount: 3 });
    expect(okResult.state.modalities["accordo-diagram"]).toMatchObject({ diagramCount: 2 });
  });

  // M74-LS-05: returns { ok: false, error } when getState throws
  it("M74-LS-05: returns { ok: false, error } when getState() throws", async () => {
    const getState = vi.fn(() => { throw new Error("bridge disconnected"); });
    const result = await layoutStateHandler({}, getState);
    expect(result).toMatchObject({ ok: false, error: "bridge disconnected" });
  });

  // M74-LS-06: latency < 50ms (local in-memory read — wall-clock safe for CI)
  it("M74-LS-06: handler completes in under 50ms (local in-memory read)", async () => {
    const ideState = makeIDEState();
    const getState = vi.fn(() => ideState);
    const start = performance.now();
    await layoutStateHandler({}, getState);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(50);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// M74-LS: createLayoutTools() factory
// ─────────────────────────────────────────────────────────────────────────────

describe("createLayoutTools() factory — M74-LS", () => {
  const getState = vi.fn(() => makeIDEState());

  // M74-LS-01: accordo_layout_state is registered via createLayoutTools
  it("M74-LS-01: createLayoutTools returns array containing accordo_layout_state", () => {
    const tools = createLayoutTools(getState);
    const names = tools.map((t) => t.name);
    expect(names).toContain("accordo_layout_state");
  });

  it("M74-LS-01: createLayoutTools returns all 5 existing layout tools plus layoutState (6 total)", () => {
    const tools = createLayoutTools(getState);
    expect(tools).toHaveLength(6);
    const names = tools.map((t) => t.name);
    expect(names).toContain("accordo_panel_toggle");
    expect(names).toContain("accordo_layout_zen");
    expect(names).toContain("accordo_layout_fullscreen");
    expect(names).toContain("accordo_layout_joinGroups");
    expect(names).toContain("accordo_layout_evenGroups");
    expect(names).toContain("accordo_layout_state");
  });

  it("M74-LS-01: accordo_layout_state has safe danger level and empty required schema", () => {
    const tools = createLayoutTools(getState);
    const stateTool = tools.find((t) => t.name === "accordo_layout_state")!;
    expect(stateTool.dangerLevel).toBe("safe");
    expect(stateTool.inputSchema.required).toEqual([]);
    expect(stateTool.inputSchema.type).toBe("object");
  });

  // M74-LS-07: tool description instructs agents to call at start of task
  it("M74-LS-07: accordo_layout_state description mentions calling at start of task", () => {
    const tools = createLayoutTools(getState);
    const stateTool = tools.find((t) => t.name === "accordo_layout_state")!;
    expect(stateTool.description.toLowerCase()).toMatch(/start|beginning|before/);
  });

  it("M74-LS-01: accordo_layout_state handler is a function", () => {
    const tools = createLayoutTools(getState);
    const stateTool = tools.find((t) => t.name === "accordo_layout_state")!;
    expect(typeof stateTool.handler).toBe("function");
  });
});
