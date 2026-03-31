/**
 * Tests for layoutPanelHandler — E-6 Bar Tools
 *
 * Phase B — all tests MUST fail RED against "not implemented" stub.
 * These tests validate §4.27 accordo_layout_panel with all requirements
 * E-6-01 through E-6-10.
 *
 * Requirement coverage:
 *   [x] E-6-01: accordo_layout_panel registered as single MCP tool
 *   [x] E-6-02: BarState tracker with sidebar, panel, rightBar
 *   [x] E-6-03: State starts as "unknown", resets to "unknown"
 *   [x] E-6-04: unknown → close uses focus* then close*
 *   [x] E-6-05: open → open and closed → closed are idempotent no-ops
 *   [x] E-6-06: view parameter opens specific view, updates area state
 *   [x] E-6-07: view + action: "close" returns error
 *   [x] E-6-08: view-area mismatch returns error
 *   [x] E-6-09: Unknown views attempt heuristic, graceful error on failure
 *   [x] E-6-10: rightBar has no views; area-level only
 *
 * Exported API checklist:
 *   ✓ layoutPanelHandler  — 36 tests
 *   ✓ _resetBarState      — used in beforeEach + 2 tests
 *   ✓ _getBarState        — 6 tests
 *   ✓ barTools            — 9 registration tests
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  layoutPanelHandler,
  _resetBarState,
  _getBarState,
  barTools,
} from "../tools/bar.js";

import * as vscodeMock from "./mocks/vscode.js";
const { commands } = vscodeMock;

beforeEach(() => {
  vi.clearAllMocks();
  _resetBarState();
});

// ─────────────────────────────────────────────────────────────────────────────
// Test Utility — ensures Phase B tests fail at assertion level, not crash
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calls layoutPanelHandler and returns a discriminated union.
 * This ensures Phase B tests fail with a proper RED (assertion failure),
 * not a crash from an unhandled "not implemented" throw.
 */
async function callHandler(
  args: Record<string, unknown>,
): Promise<{ ok: true; result: any } | { ok: false; reason: "not implemented"; error: Error }> {
  try {
    const result = await layoutPanelHandler(args);
    return { ok: true, result };
  } catch (err) {
    if (err instanceof Error && err.message === "not implemented") {
      return { ok: false, reason: "not implemented", error: err };
    }
    throw err; // re-throw unexpected errors
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// §1 Input Validation — E-6-01, E-6-07, E-6-10
// ─────────────────────────────────────────────────────────────────────────────

describe("input validation — E-6-01, E-6-07, E-6-10", () => {
  // E-6-01: area must be valid
  it("E-6-01-MISSING-AREA: missing area → { error: ... }", async () => {
    const { ok, result } = await callHandler({ action: "open" });
    expect(ok).toBe(true);
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toMatch(/area/i);
  });

  it("E-6-01-INVALID-AREA: invalid area (e.g., 'footer') → { error: ... }", async () => {
    const { ok, result } = await callHandler({ area: "footer", action: "open" });
    expect(ok).toBe(true);
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toMatch(/area/i);
  });

  // E-6-01: action must be valid
  it("E-6-01-MISSING-ACTION: missing action → { error: ... }", async () => {
    const { ok, result } = await callHandler({ area: "sidebar" });
    expect(ok).toBe(true);
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toMatch(/action/i);
  });

  it("E-6-01-INVALID-ACTION: invalid action (e.g., 'toggle') → { error: ... }", async () => {
    const { ok, result } = await callHandler({ area: "sidebar", action: "toggle" });
    expect(ok).toBe(true);
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toMatch(/action/i);
  });

  // E-6-07: view + action: "close" is an error
  it("E-6-07-VIEW-CLOSE: view + action: 'close' → { error: ... }", async () => {
    const { ok, result } = await callHandler({ area: "sidebar", view: "explorer", action: "close" });
    expect(ok).toBe(true);
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toMatch(/view/i);
  });

  // E-6-10: rightBar doesn't support view
  it("E-6-10-RIGHTBAR-VIEW: area: 'rightBar' + view → { error: ... }", async () => {
    const { ok, result } = await callHandler({ area: "rightBar", view: "anything", action: "open" });
    expect(ok).toBe(true);
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toMatch(/rightBar/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 Area-Level State Transitions — E-6-02, E-6-03, E-6-04, E-6-05
//
// The transition table tests use setupInitialState() to reach the desired
// initial state. For Phase B, the "open" and "closed" initial states cannot
// be set (the handler throws). The try/catch wrapper ensures we get a RED
// at the assertion level when the handler is not implemented.
// ─────────────────────────────────────────────────────────────────────────────

describe("area-level state transitions — E-6-02, E-6-03, E-6-04, E-6-05", () => {
  const areas: Array<["sidebar" | "panel" | "rightBar", string, string]> = [
    ["sidebar", "workbench.action.focusSideBar", "workbench.action.closeSidebar"],
    ["panel",   "workbench.action.focusPanel",   "workbench.action.closePanel"],
    ["rightBar","workbench.action.focusAuxiliaryBar", "workbench.action.closeAuxiliaryBar"],
  ];

  // Each entry: [initialState, action, expectedCmdNames, finalState, wasNoOp]
  const transitionCases: Array<["unknown" | "open" | "closed", "open" | "close", string[], "unknown" | "open" | "closed", boolean]> = [
    ["unknown",  "open",  ["focus"],             "open",   false],
    ["unknown",  "close", ["focus","close"],    "closed", false],
    ["open",     "open",  [],                    "open",   true ],
    ["open",     "close", ["close"],             "closed", false],
    ["closed",   "open",  ["focus"],             "open",   false],
    ["closed",   "close", [],                    "closed", true ],
  ];

  for (const [area, focusCmd, closeCmd] of areas) {
    describe(`area: ${area}`, () => {
      for (const [initialState, action, expectedCmdNames, finalState, wasNoOp] of transitionCases) {
        const expectedCmds = expectedCmdNames.map((name) => (name === "focus" ? focusCmd : closeCmd));

        it(`E-6-0x-${area.toUpperCase()}-${initialState.toUpperCase()}-${action.toUpperCase()}: ${initialState} + ${action} → ${finalState}, wasNoOp=${wasNoOp}, cmds=${JSON.stringify(expectedCmds)}`, async () => {
          // Reset to unknown first
          _resetBarState();

          // Set up initial state: for "open" and "closed" we need handler calls
          if (initialState === "open") {
            const { ok } = await callHandler({ area, action: "open" });
            expect(ok).toBe(true); // must succeed to set state
          } else if (initialState === "closed") {
            const { ok: ok1 } = await callHandler({ area, action: "open" });
            expect(ok1).toBe(true); // must succeed to reach "open"
            const { ok: ok2 } = await callHandler({ area, action: "close" });
            expect(ok2).toBe(true); // must succeed to reach "closed"
          }

          const previousState = _getBarState()[area];
          expect(previousState).toBe(initialState);

          // Capture call count after setup (setup may have called executeCommand)
          const callsBefore = commands.executeCommand.mock.calls.length;

          // Now test the actual transition
          const { ok, result } = await callHandler({ area, action });
          expect(ok).toBe(true);

          expect(result).not.toHaveProperty("error");
          const okResult = result as { area: string; action: string; previousState: string; wasNoOp: boolean };
          expect(okResult.area).toBe(area);
          expect(okResult.action).toBe(action === "open" ? "opened" : "closed");
          expect(okResult.previousState).toBe(initialState);
          expect(okResult.wasNoOp).toBe(wasNoOp);

          // Verify commands called — only the NEW calls since the action under test
          const newCalls = commands.executeCommand.mock.calls.slice(callsBefore).map(([cmd]) => cmd);
          expect(newCalls).toEqual(expectedCmds);

          // Verify final state
          expect(_getBarState()[area]).toBe(finalState);
        });
      }
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 View-Level Open — E-6-06, E-6-08, E-6-09
// ─────────────────────────────────────────────────────────────────────────────

describe("view-level open — E-6-06, E-6-08, E-6-09", () => {
  // E-6-06: sidebar views open with correct command
  describe("sidebar views — E-6-06", () => {
    const sidebarViewCases: Array<[string, string]> = [
      ["explorer",   "workbench.view.explorer"],
      ["search",     "workbench.view.search"],
      ["git",        "workbench.view.scm"],
      ["debug",      "workbench.view.debug"],
      ["extensions", "workbench.view.extensions"],
    ];

    for (const [view, vsCommand] of sidebarViewCases) {
      it(`E-6-06-SIDEBAR-${view.toUpperCase()}: open '${view}' → calls '${vsCommand}', state=open`, async () => {
        const { ok, result } = await callHandler({ area: "sidebar", view, action: "open" });
        expect(ok).toBe(true);

        expect(result).not.toHaveProperty("error");
        const okResult = result as { area: string; action: string; view: string; previousState: string; wasNoOp: boolean };
        expect(okResult.area).toBe("sidebar");
        expect(okResult.action).toBe("opened");
        expect(okResult.view).toBe(view);
        expect(okResult.previousState).toBe("unknown");
        expect(okResult.wasNoOp).toBe(false);

        expect(commands.executeCommand).toHaveBeenCalledWith(vsCommand);
        expect(_getBarState().sidebar).toBe("open");
      });
    }
  });

  // E-6-06: panel views — focus-first pattern
  describe("panel views (focus-first) — E-6-06", () => {
    const panelViewCases: Array<[string, string, string]> = [
      ["terminal",     "workbench.action.focusPanel", "workbench.action.terminal.toggleTerminal"],
      ["output",       "workbench.action.focusPanel", "workbench.action.output.toggleOutput"],
      ["debug-console","workbench.action.focusPanel", "workbench.debug.action.toggleRepl"],
      ["problems",     "workbench.action.focusPanel", "workbench.actions.view.problems"],
    ];

    for (const [view, focusCmd, viewCmd] of panelViewCases) {
      it(`E-6-06-PANEL-${view.toUpperCase()}: open '${view}' → calls focusPanel first, then '${viewCmd}'`, async () => {
        const { ok, result } = await callHandler({ area: "panel", view, action: "open" });
        expect(ok).toBe(true);

        expect(result).not.toHaveProperty("error");
        const okResult = result as { area: string; action: string; view: string; previousState: string; wasNoOp: boolean };
        expect(okResult.area).toBe("panel");
        expect(okResult.action).toBe("opened");
        expect(okResult.view).toBe(view);
        expect(okResult.wasNoOp).toBe(false);

        // focusPanel must be called FIRST (toggle safety)
        const calls = vi.mocked(commands.executeCommand).mock.calls.map(([cmd]) => cmd);
        expect(calls[0]).toBe(focusCmd);
        expect(calls[1]).toBe(viewCmd);
        expect(calls).toHaveLength(2);

        expect(_getBarState().panel).toBe("open");
      });
    }
  });

  // E-6-08: view-area mismatch is an error
  describe("view-area mismatch — E-6-08", () => {
    it("E-6-08-PANEL-VIEW-EXPLORER: area: 'panel' + view: 'explorer' → { error: ... }", async () => {
      const { ok, result } = await callHandler({ area: "panel", view: "explorer", action: "open" });
      expect(ok).toBe(true);
      expect(result).toHaveProperty("error");
      expect((result as { error: string }).error).toMatch(/explorer/i);
    });

    it("E-6-08-SIDEBAR-VIEW-TERMINAL: area: 'sidebar' + view: 'terminal' → { error: ... }", async () => {
      const { ok, result } = await callHandler({ area: "sidebar", view: "terminal", action: "open" });
      expect(ok).toBe(true);
      expect(result).toHaveProperty("error");
      expect((result as { error: string }).error).toMatch(/terminal/i);
    });
  });

  // E-6-09: unknown view — heuristic attempt, graceful error
  describe("unknown view — E-6-09", () => {
    it("E-6-09-UNKNOWN-VIEW-SIDEBAR: unknown sidebar view → tries workbench.view.<view>, fails → { error: ... }", async () => {
      // The heuristic command workbench.view.<unknown> is not a real VS Code command,
      // so execute it and let it reject (VS Code will throw for unknown commands)
      vi.mocked(commands.executeCommand).mockRejectedValueOnce(new Error("command not found"));
      const { ok, result } = await callHandler({ area: "sidebar", view: "some-extension-view", action: "open" });
      expect(ok).toBe(true);
      expect(result).toHaveProperty("error");
      expect((result as { error: string }).error).toMatch(/some-extension-view/i);
    });

    it("E-6-09-UNKNOWN-VIEW-SIDEBAR-REJECT: unknown sidebar view, heuristic command rejects → { error: ... }", async () => {
      // Set up: first call (view command) fails
      vi.mocked(commands.executeCommand).mockRejectedValueOnce(new Error("command not found"));
      const { ok, result } = await callHandler({ area: "sidebar", view: "some-extension-view", action: "open" });
      expect(ok).toBe(true);
      expect(result).toHaveProperty("error");
      expect((result as { error: string }).error).toMatch(/some-extension-view/i);
    });

    it("E-6-09-UNKNOWN-VIEW-SIDEBAR-SUCCESS: unknown sidebar view, heuristic succeeds → success + state=open", async () => {
      vi.mocked(commands.executeCommand).mockResolvedValueOnce(undefined);
      const { ok, result } = await callHandler({ area: "sidebar", view: "gitlens", action: "open" });
      expect(ok).toBe(true);
      expect(result).not.toHaveProperty("error");
      const okResult = result as { area: string; action: string; view: string };
      expect(okResult.area).toBe("sidebar");
      expect(okResult.view).toBe("gitlens");
    });

    it("E-6-09-UNKNOWN-VIEW-PANEL-REJECT: unknown panel view → { error: ... }", async () => {
      vi.mocked(commands.executeCommand)
        .mockResolvedValueOnce(undefined) // focusPanel succeeds
        .mockRejectedValueOnce(new Error("command not found")); // heuristic fails
      const { ok, result } = await callHandler({ area: "panel", view: "unknown-panel-view", action: "open" });
      expect(ok).toBe(true);
      expect(result).toHaveProperty("error");
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 Error Handling — executeCommand rejects
// ─────────────────────────────────────────────────────────────────────────────

describe("error handling — command rejection", () => {
  it("E-6-0x-OPEN-REJECT: executeCommand rejects on area-level open → { error: ... }, state unchanged", async () => {
    _resetBarState();
    vi.mocked(commands.executeCommand).mockRejectedValueOnce(new Error("focus failed"));

    const { ok, result } = await callHandler({ area: "sidebar", action: "open" });
    expect(ok).toBe(true);
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toMatch(/focus failed/i);
    expect(_getBarState().sidebar).toBe("unknown"); // state unchanged
  });

  it("E-6-0x-CLOSE-REJECT: executeCommand rejects on area-level close → { error: ... }, state unchanged", async () => {
    _resetBarState();
    vi.mocked(commands.executeCommand).mockRejectedValueOnce(new Error("close failed"));

    const { ok, result } = await callHandler({ area: "sidebar", action: "close" });
    expect(ok).toBe(true);
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toMatch(/close failed/i);
    expect(_getBarState().sidebar).toBe("unknown");
  });

  it("E-6-0x-UNKNOWN-CLOSE-REJECT: unknown→close, focus* fails first → { error: ... }, state=unknown", async () => {
    _resetBarState();
    vi.mocked(commands.executeCommand).mockRejectedValueOnce(new Error("focus failed"));

    const { ok, result } = await callHandler({ area: "sidebar", action: "close" });
    expect(ok).toBe(true);
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toMatch(/focus failed/i);
    expect(_getBarState().sidebar).toBe("unknown"); // state unchanged
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 Cross-Area Independence — E-6-02
// ─────────────────────────────────────────────────────────────────────────────

describe("cross-area independence — E-6-02", () => {
  it("E-6-02-INDEPENDENCE-1: sidebar state changes don't affect panel or rightBar", async () => {
    _resetBarState(); // explicit reset to ensure known initial state

    // Open sidebar
    const { ok, result } = await callHandler({ area: "sidebar", action: "open" });
    expect(ok).toBe(true);
    expect(result).not.toHaveProperty("error");

    // All other areas should remain unknown
    expect(_getBarState().panel).toBe("unknown");
    expect(_getBarState().rightBar).toBe("unknown");
  });

  it("E-6-03-RESET: _resetBarState() → all areas return to 'unknown'", () => {
    _resetBarState();
    expect(_getBarState().sidebar).toBe("unknown");
    expect(_getBarState().panel).toBe("unknown");
    expect(_getBarState().rightBar).toBe("unknown");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §6 Response Shape — E-6-01
// ─────────────────────────────────────────────────────────────────────────────

describe("response shape — E-6-01", () => {
  it("E-6-01-AREA-RESPONSE: area-level success has correct shape with all required fields", async () => {
    const { ok, result } = await callHandler({ area: "sidebar", action: "open" });
    // RED if handler not implemented
    expect(ok).toBe(true);
    // When implemented, success shape has these fields
    expect(result).not.toHaveProperty("error");
    const okResult = result as { area: string; action: string; previousState: string; wasNoOp: boolean };
    expect(okResult).toHaveProperty("area");
    expect(okResult).toHaveProperty("action");
    expect(okResult).toHaveProperty("previousState");
    expect(okResult).toHaveProperty("wasNoOp");
  });

  it("E-6-01-VIEW-RESPONSE: view-level success has correct shape with view field", async () => {
    const { ok, result } = await callHandler({ area: "sidebar", view: "explorer", action: "open" });
    // RED if handler not implemented
    expect(ok).toBe(true);
    // When implemented, success shape has these fields
    expect(result).not.toHaveProperty("error");
    const okResult = result as { area: string; action: string; view: string; previousState: string; wasNoOp: boolean };
    expect(okResult).toHaveProperty("view");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// barTools registration — E-6-01
// ─────────────────────────────────────────────────────────────────────────────

describe("barTools registration — E-6-01", () => {
  it("E-6-01-REG: barTools exports exactly 1 tool definition", () => {
    expect(barTools).toHaveLength(1);
  });

  it("E-6-01-REG-NAME: tool is named 'accordo_layout_panel'", () => {
    expect(barTools[0].name).toBe("accordo_layout_panel");
  });

  it("E-6-01-REG-GROUP: tool group is 'layout'", () => {
    expect(barTools[0].group).toBe("layout");
  });

  it("E-6-01-REG-DANGER: tool danger level is 'safe'", () => {
    expect(barTools[0].dangerLevel).toBe("safe");
  });

  it("E-6-01-REG-IDEMPOTENT: tool is idempotent", () => {
    expect(barTools[0].idempotent).toBe(true);
  });

  it("E-6-01-REG-SCHEMA: input schema has area and action as required", () => {
    const required = barTools[0].inputSchema.required as string[];
    expect(required).toContain("area");
    expect(required).toContain("action");
    expect(required).not.toContain("view"); // view is optional
  });

  it("E-6-01-REG-SCHEMA-AREA: area enum contains sidebar, panel, rightBar", () => {
    const props = barTools[0].inputSchema.properties as Record<string, { enum?: string[] }>;
    expect(props["area"].enum).toEqual(["sidebar", "panel", "rightBar"]);
  });

  it("E-6-01-REG-SCHEMA-ACTION: action enum contains open, close", () => {
    const props = barTools[0].inputSchema.properties as Record<string, { enum?: string[] }>;
    expect(props["action"].enum).toEqual(["open", "close"]);
  });

  it("E-6-01-REG-HANDLER: handler is a function", () => {
    expect(typeof barTools[0].handler).toBe("function");
  });
});
