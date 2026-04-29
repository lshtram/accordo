/**
 * Tests for src/tools/editor.ts — Modules 16 + 17
 *
 * Remaining tools:
 *   Module 16 (§4.1–§4.3, §4.7):
 *     accordo_editor_open, close, scroll, focus
 *   Module 17 (§4.4–§4.5):
 *     accordo_editor_highlight, clearHighlights
 *
 * Removed exports (migrated to generic gateway):
 *   split (§4.6), reveal (§4.8), save (§4.17), saveAll (§4.18), format (§4.19)
 *
 * Exported API checklist:
 *   [x] openHandler           — §4.1 (open + scroll to position)
 *   [x] closeHandler          — §4.2 (active or by path)
 *   [x] scrollHandler         — §4.3 (up/down, line/page)
 *   [x] highlightHandler      — §4.4 (decoration create + store)
 *   [x] clearHighlightsHandler — §4.5 (by id or all)
 *   [x] focusGroupHandler     — §4.7 (groups 1–9)
 *   [x] _clearDecorationStore — test helper (internal)
 *   [x] editorTools[]         — 6 tool definitions (5 removed)
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import path from "path";
import { CAPABILITY_COMMANDS } from "@accordo/capabilities";
import { normaliseSlashes } from "../util.js";
import {
  openHandler,
  closeHandler,
  scrollHandler,
  highlightHandler,
  clearHighlightsHandler,
  focusGroupHandler,
  _clearDecorationStore,
  editorTools,
} from "../tools/editor.js";

// Import the mock instance so we can inspect calls
import * as vscodeMock from "./mocks/vscode.js";
const { mockState, window, commands, workspace } = vscodeMock;

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Platform-aware path comparison for test assertions.
 * Strips drive letters on Windows for consistent assertions.
 */
function normalizePathForComparison(p: string): string {
  const normalized = normaliseSlashes(p);
  return normalized.replace(/^[a-zA-Z]:/, "");
}

function makeWorkspace(root = "/workspace"): void {
  mockState.workspaceFolders = [
    { uri: vscodeMock.Uri.file(root), name: "ws", index: 0 },
  ];
}

function makeOpenDocument(fsPath: string, dirty = false) {
  return {
    uri: vscodeMock.Uri.file(fsPath),
    isDirty: dirty,
    fileName: fsPath,
    save: vi.fn().mockResolvedValue(true),
    lineCount: 100,
  };
}

function makeVisibleEditor(fsPath: string, startLine = 5) {
  return {
    document: {
      uri: vscodeMock.Uri.file(fsPath),
      lineCount: 100,
      isDirty: false,
      fileName: fsPath,
    },
    visibleRanges: [{ start: { line: startLine } }],
    setDecorations: vi.fn(),
  };
}

// ── Global beforeEach: reset all mock state ───────────────────────────────────

beforeEach(() => {
  mockState.activeTextEditor = null;
  mockState.visibleTextEditors = [];
  mockState.tabGroups = { all: [], close: vi.fn().mockResolvedValue(true) };
  mockState.terminals = [];
  mockState.activeTerminal = null;
  mockState.workspaceFolders = [];
  mockState.textDocuments = [];
  mockState.diagnostics = [];
  mockState.registeredCommands.clear();
  vi.clearAllMocks();
  _clearDecorationStore();
});

// ─────────────────────────────────────────────────────────────────────────────
// Module 16 — Editor view tools
// ─────────────────────────────────────────────────────────────────────────────

// ── §4.1 accordo_editor_open ─────────────────────────────────────────────────

describe("openHandler — §4.1", () => {
  it("§4.1-OPEN-01: opens file by absolute path and returns opened path", async () => {
    makeWorkspace();
    await expect(
      openHandler({ path: "/workspace/src/foo.ts" }),
    ).resolves.toEqual({ opened: true, path: "/workspace/src/foo.ts", surface: "editor" });
    expect(window.showTextDocument).toHaveBeenCalled();
  });

  it("§4.1-OPEN-02: resolves relative path against workspace root", async () => {
    makeWorkspace("/workspace");
    const result = await openHandler({ path: "src/foo.ts" });
    expect(result).toEqual({
      opened: true,
      path: expect.any(String),
      surface: "editor",
    });
    expect(normalizePathForComparison((result as Record<string, unknown>).path as string)).toBe("/workspace/src/foo.ts");
  });

  it("§4.1-OPEN-03: default line=1 and column=1 when not specified", async () => {
    makeWorkspace();
    await openHandler({ path: "/workspace/foo.ts" });
    const callArgs = vi.mocked(window.showTextDocument).mock.calls[0];
    // The second argument should include a selection Range starting at line 0, char 0 (0-based)
    const options = callArgs[1] as { selection: vscodeMock.Range };
    expect(options?.selection?.start?.line).toBe(0);
    expect(options?.selection?.start?.character).toBe(0);
  });

  it("§4.1-OPEN-04: scrolls to specified line and column (1-based input → 0-based Range)", async () => {
    makeWorkspace();
    await openHandler({ path: "/workspace/foo.ts", line: 10, column: 5 });
    const callArgs = vi.mocked(window.showTextDocument).mock.calls[0];
    const options = callArgs[1] as { selection: vscodeMock.Range };
    expect(options?.selection?.start?.line).toBe(9);
    expect(options?.selection?.start?.character).toBe(4);
  });

  it("§4.1-OPEN-05: returns error when path is outside workspace", async () => {
    makeWorkspace("/workspace");
    const result = await openHandler({ path: "/etc/passwd" });
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toBe("Path is outside workspace: /etc/passwd");
  });

  it("§4.1-OPEN-06: returns error when showTextDocument throws (file not found)", async () => {
    makeWorkspace();
    vi.mocked(window.showTextDocument).mockRejectedValueOnce(
      new Error("File not found: /workspace/missing.ts"),
    );
    const result = await openHandler({ path: "/workspace/missing.ts" });
    expect(result).toHaveProperty("error");
  });
});

// ── rejection tests for openHandler ────────────────────────────────────────

describe("openHandler rejection — §4.1", () => {
  it("§4.1-OPEN-R01: wraps showTextDocument rejection as error", async () => {
    makeWorkspace();
    vi.mocked(window.showTextDocument).mockRejectedValueOnce(
      new Error("permission denied"),
    );
    const result = await openHandler({ path: "/workspace/foo.ts" });
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toBe("permission denied");
  });
});

// ── §4.2 accordo_editor_close ────────────────────────────────────────────────

describe("closeHandler — §4.2", () => {
  it("§4.2-CLOSE-01: closes active editor when no path given", async () => {
    mockState.activeTextEditor = makeVisibleEditor("/workspace/foo.ts");
    await expect(closeHandler({})).resolves.toEqual({ closed: true });
    expect(commands.executeCommand).toHaveBeenCalledWith(
      "workbench.action.closeActiveEditor",
    );
  });

  it("§4.2-CLOSE-02: returns { closed: true } when no active editor and no path given (closes active tab)", async () => {
    mockState.activeTextEditor = null;
    const result = await closeHandler({});
    expect(result).toEqual({ closed: true });
  });

  it("§4.2-CLOSE-03: closes tab by path when path is provided and tab is open", async () => {
    makeWorkspace();
    mockState.tabGroups.all = [
      {
        tabs: [
          { input: { uri: vscodeMock.Uri.file("/workspace/foo.ts") } },
        ],
      },
    ];
    await expect(
      closeHandler({ path: "/workspace/foo.ts" }),
    ).resolves.toEqual({ closed: true });
    expect(mockState.tabGroups.close).toHaveBeenCalled();
  });

  it("§4.2-CLOSE-04: returns { closed: true } when .mmd file not in any tab (falls back to active editor)", async () => {
    makeWorkspace();
    mockState.tabGroups.all = [];
    const result = await closeHandler({ path: "/workspace/notopen.mmd" });
    // .mmd files fall back to closing active editor
    expect(result).toEqual({ closed: true });
  });

  it("§4.2-CLOSE-05: returns { error } when non-.mmd file not in any tab (no fallback)", async () => {
    makeWorkspace();
    mockState.tabGroups.all = [];
    const result = await closeHandler({ path: "/workspace/notopen.ts" });
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toBe("File is not open: /workspace/notopen.ts");
  });
});

describe("closeHandler rejection — §4.2", () => {
  it("§4.2-CLOSE-R01: wraps executeCommand rejection as error", async () => {
    mockState.activeTextEditor = makeVisibleEditor("/workspace/foo.ts");
    vi.mocked(commands.executeCommand).mockRejectedValueOnce(
      new Error("close failed"),
    );
    const result = await closeHandler({});
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toBe("close failed");
  });
});

// ── §4.3 accordo_editor_scroll ───────────────────────────────────────────────

describe("scrollHandler — §4.3", () => {
  it("§4.3-SCROLL-01: scrolls down by page and returns new visible start line (1-based)", async () => {
    mockState.activeTextEditor = makeVisibleEditor("/workspace/foo.ts", 19);
    await expect(
      scrollHandler({ direction: "down" }),
    ).resolves.toEqual({ line: 20 });
    expect(commands.executeCommand).toHaveBeenCalledWith("editorScroll", {
      to: "down",
      by: "page",
      value: 1,
    });
  });

  it("§4.3-SCROLL-02: scrolls up by page", async () => {
    mockState.activeTextEditor = makeVisibleEditor("/workspace/foo.ts", 9);
    await scrollHandler({ direction: "up" });
    expect(commands.executeCommand).toHaveBeenCalledWith("editorScroll", {
      to: "up",
      by: "page",
      value: 1,
    });
  });

  it("§4.3-SCROLL-03: scrolls by line when by='line'", async () => {
    mockState.activeTextEditor = makeVisibleEditor("/workspace/foo.ts", 4);
    await scrollHandler({ direction: "down", by: "line" });
    expect(commands.executeCommand).toHaveBeenCalledWith("editorScroll", {
      to: "down",
      by: "line",
      value: 1,
    });
  });

  it("§4.3-SCROLL-04: returns error when no active editor", async () => {
    mockState.activeTextEditor = null;
    const result = await scrollHandler({ direction: "down" });
    expect(result).toHaveProperty("error");
    // §4.3 exact requirement string
    expect((result as { error: string }).error).toBe("No active editor");
  });
});

describe("scrollHandler rejection — §4.3", () => {
  it("§4.3-SCROLL-R01: wraps executeCommand rejection as error", async () => {
    mockState.activeTextEditor = makeVisibleEditor("/workspace/foo.ts");
    vi.mocked(commands.executeCommand).mockRejectedValueOnce(
      new Error("scroll failed"),
    );
    const result = await scrollHandler({ direction: "down" });
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toBe("scroll failed");
  });
});

describe("focusGroupHandler rejection — §4.7", () => {
  it("§4.7-FOCUS-R01: wraps executeCommand rejection as error", async () => {
    mockState.tabGroups.all = [{ tabs: [] }, { tabs: [] }];
    vi.mocked(commands.executeCommand).mockRejectedValueOnce(
      new Error("focus failed"),
    );
    const result = await focusGroupHandler({ group: 1 });
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toBe("focus failed");
  });
});

// ── §4.7 accordo_editor_focus ────────────────────────────────────────────────

describe("focusGroupHandler — §4.7", () => {
  beforeEach(() => {
    mockState.tabGroups.all = [{ tabs: [] }, { tabs: [] }, { tabs: [] }];
  });

  it("§4.7-FOCUS-01: focuses group 1 via workbench.action.focusFirstEditorGroup", async () => {
    await expect(focusGroupHandler({ group: 1 })).resolves.toEqual({
      focused: true,
      group: 1,
    });
    expect(commands.executeCommand).toHaveBeenCalledWith(
      "workbench.action.focusFirstEditorGroup",
    );
  });

  it("§4.7-FOCUS-02: focuses group 2 via focusSecondEditorGroup", async () => {
    await focusGroupHandler({ group: 2 });
    expect(commands.executeCommand).toHaveBeenCalledWith(
      "workbench.action.focusSecondEditorGroup",
    );
  });

  it("§4.7-FOCUS-03: focuses group 3 via focusThirdEditorGroup", async () => {
    await focusGroupHandler({ group: 3 });
    expect(commands.executeCommand).toHaveBeenCalledWith(
      "workbench.action.focusThirdEditorGroup",
    );
  });

  it("§4.7-FOCUS-04: returns error when group number exceeds total groups", async () => {
    const result = await focusGroupHandler({ group: 5 });
    expect(result).toHaveProperty("error");
    // §4.7 exact requirement string: "Editor group <n> does not exist (max: <total>)"
    expect((result as { error: string }).error).toBe("Editor group 5 does not exist (max: 3)");
  });

  it("§4.7-FOCUS-05: returns error when group is 0 or negative", async () => {
    const result = await focusGroupHandler({ group: 0 });
    expect(result).toHaveProperty("error");
    // §4.7 exact requirement string (max: 3 groups in this context)
    expect((result as { error: string }).error).toBe("Editor group 0 does not exist (max: 3)");
  });

  // ── Full command mapping 1–9 ───────────────────────────────────────────────
  // Requirements specify mapping through focusNinthEditorGroup (§4.7)
  describe("§4.7 group→command mapping (all 9 slots)", () => {
    const nineGroups = Array.from({ length: 9 }, () => ({ tabs: [] }));
    const commandMap = [
      "workbench.action.focusFirstEditorGroup",
      "workbench.action.focusSecondEditorGroup",
      "workbench.action.focusThirdEditorGroup",
      "workbench.action.focusFourthEditorGroup",
      "workbench.action.focusFifthEditorGroup",
      "workbench.action.focusSixthEditorGroup",
      "workbench.action.focusSeventhEditorGroup",
      "workbench.action.focusEighthEditorGroup",
      "workbench.action.focusNinthEditorGroup",
    ];

    beforeEach(() => {
      mockState.tabGroups.all = nineGroups;
    });

    for (let g = 1; g <= 9; g++) {
      const expectedCmd = commandMap[g - 1];
      it(`§4.7-MAP-0${g}: group ${g} dispatches ${expectedCmd}`, async () => {
        await expect(focusGroupHandler({ group: g })).resolves.toEqual({
          focused: true,
          group: g,
        });
        expect(commands.executeCommand).toHaveBeenCalledWith(expectedCmd);
      });
    }

    it("§4.7-MAP-10: group 10 returns error when only 9 groups exist", async () => {
      const result = await focusGroupHandler({ group: 10 });
      expect(result).toHaveProperty("error");
      expect((result as { error: string }).error).toBe(
        "Editor group 10 does not exist (max: 9)",
      );
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Module 17 — Editor decoration tools
// ─────────────────────────────────────────────────────────────────────────────

// ── §4.4 accordo_editor_highlight ────────────────────────────────────────────

describe("highlightHandler — §4.4", () => {
  it("§4.4-HL-01: creates decoration and returns decorationId", async () => {
    makeWorkspace();
    const editor = makeVisibleEditor("/workspace/foo.ts");
    mockState.visibleTextEditors = [editor];

    const result = await highlightHandler({
      path: "/workspace/foo.ts",
      startLine: 5,
      endLine: 10,
    });
    expect(result).toEqual(
      expect.objectContaining({ highlighted: true, decorationId: expect.any(String) }),
    );
    expect(window.createTextEditorDecorationType).toHaveBeenCalled();
    expect(editor.setDecorations).toHaveBeenCalled();
  });

  it("§4.4-HL-02: uses default color when not specified", async () => {
    makeWorkspace();
    mockState.visibleTextEditors = [makeVisibleEditor("/workspace/foo.ts")];
    await highlightHandler({ path: "/workspace/foo.ts", startLine: 1, endLine: 1 });
    expect(window.createTextEditorDecorationType).toHaveBeenCalledWith(
      expect.objectContaining({ backgroundColor: "rgba(255,255,0,0.3)" }),
    );
  });

  it("§4.4-HL-03: uses custom color when provided", async () => {
    makeWorkspace();
    mockState.visibleTextEditors = [makeVisibleEditor("/workspace/foo.ts")];
    await highlightHandler({
      path: "/workspace/foo.ts",
      startLine: 1,
      endLine: 1,
      color: "rgba(255,0,0,0.5)",
    });
    expect(window.createTextEditorDecorationType).toHaveBeenCalledWith(
      expect.objectContaining({ backgroundColor: "rgba(255,0,0,0.5)" }),
    );
  });

  it("§4.4-HL-04: each call returns a unique decorationId", async () => {
    makeWorkspace();
    mockState.visibleTextEditors = [makeVisibleEditor("/workspace/foo.ts")];
    const r1 = await highlightHandler({
      path: "/workspace/foo.ts",
      startLine: 1,
      endLine: 1,
    }) as { decorationId: string };
    const r2 = await highlightHandler({
      path: "/workspace/foo.ts",
      startLine: 2,
      endLine: 2,
    }) as { decorationId: string };
    expect(r1.decorationId).not.toBe(r2.decorationId);
  });

  it("§4.4-HL-05: returns error when file is not open in any visible editor", async () => {
    makeWorkspace();
    mockState.visibleTextEditors = [];
    const result = await highlightHandler({
      path: "/workspace/foo.ts",
      startLine: 1,
      endLine: 3,
    });
    expect(result).toHaveProperty("error");
    // §4.4 exact requirement string: "File is not open: <path>. Open it first."
    expect((result as { error: string }).error).toBe("File is not open: /workspace/foo.ts. Open it first.");
  });

  it("§4.4-HL-06: returns error when startLine > endLine", async () => {
    makeWorkspace();
    mockState.visibleTextEditors = [makeVisibleEditor("/workspace/foo.ts")];
    const result = await highlightHandler({
      path: "/workspace/foo.ts",
      startLine: 5,
      endLine: 3,
    });
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toBe("startLine must be <= endLine");
  });

  it("§4.4-HL-07: returns error when line is out of range", async () => {
    makeWorkspace();
    const editor = makeVisibleEditor("/workspace/foo.ts");
    editor.document.lineCount = 10;
    mockState.visibleTextEditors = [editor];
    const result = await highlightHandler({
      path: "/workspace/foo.ts",
      startLine: 1,
      endLine: 999,
    });
    expect(result).toHaveProperty("error");
    // §4.4 exact requirement string: "Line <n> is out of range (file has <total> lines)"
    expect((result as { error: string }).error).toBe("Line 999 is out of range (file has 10 lines)");
  });

  it("§4.4-HL-08: range passed to setDecorations uses 0-based lines (VSCode convention)", async () => {
    makeWorkspace();
    const editor = makeVisibleEditor("/workspace/foo.ts");
    mockState.visibleTextEditors = [editor];
    await highlightHandler({
      path: "/workspace/foo.ts",
      startLine: 3,
      endLine: 5,
    });
    const setDecCallArgs = vi.mocked(editor.setDecorations).mock.calls[0];
    const range = setDecCallArgs[1] as vscodeMock.Range[];
    expect(range[0].start.line).toBe(2); // 3 - 1 = 2
    expect(range[0].end.line).toBe(4);   // 5 - 1 = 4
  });
});

// ── §4.5 accordo_editor_clearHighlights ──────────────────────────────────────

describe("clearHighlightsHandler — §4.5", () => {
  it("§4.5-CLR-01: returns { cleared: true, count: 0 } when no decorations exist", async () => {
    await expect(clearHighlightsHandler({})).resolves.toEqual({
      cleared: true,
      count: 0,
    });
  });

  it("§4.5-CLR-02: clears all decorations and returns correct count", async () => {
    makeWorkspace();
    mockState.visibleTextEditors = [makeVisibleEditor("/workspace/foo.ts")];
    // Create 2 decorations via highlightHandler
    await highlightHandler({ path: "/workspace/foo.ts", startLine: 1, endLine: 1 });
    await highlightHandler({ path: "/workspace/foo.ts", startLine: 5, endLine: 5 });
    const result = await clearHighlightsHandler({});
    expect(result).toEqual({ cleared: true, count: 2 });
  });

  it("§4.5-CLR-03: clears a specific decoration by decorationId", async () => {
    makeWorkspace();
    mockState.visibleTextEditors = [makeVisibleEditor("/workspace/foo.ts")];
    await highlightHandler({ path: "/workspace/foo.ts", startLine: 1, endLine: 1 });
    const r2 = await highlightHandler({
      path: "/workspace/foo.ts",
      startLine: 5,
      endLine: 5,
    }) as { decorationId: string };
    // Clear only the second
    const result = await clearHighlightsHandler({ decorationId: r2.decorationId });
    expect(result).toEqual({ cleared: true, count: 1 });
    // First decoration should still exist — clear all gets count 1
    await expect(clearHighlightsHandler({})).resolves.toEqual({
      cleared: true,
      count: 1,
    });
  });

  it("§4.5-CLR-04: returns error when specified decorationId is not found", async () => {
    const result = await clearHighlightsHandler({ decorationId: "nonexistent-id" });
    expect(result).toHaveProperty("error");
    // §4.5 exact requirement string: "Decoration not found: <id>"
    expect((result as { error: string }).error).toBe("Decoration not found: nonexistent-id");
  });

  it("§4.5-CLR-05: calling dispose() on decoration type after clear", async () => {
    makeWorkspace();
    const editor = makeVisibleEditor("/workspace/foo.ts");
    mockState.visibleTextEditors = [editor];
    await highlightHandler({ path: "/workspace/foo.ts", startLine: 1, endLine: 1 });
    // Spy on the decoration type's dispose
    const decorType = vi.mocked(window.createTextEditorDecorationType).mock.results[0].value;
    await clearHighlightsHandler({});
    expect(decorType.dispose).toHaveBeenCalled();
  });
});

// ── Tool definitions registration ─────────────────────────────────────────────

describe("editorTools registration", () => {
  const toolNames = editorTools.map((t) => t.name);

  // M76-VCGM-01/PU-01: exactly 5 tools remain (scroll, split, reveal, save, saveAll, format removed)
  it("REG-01: exports exactly 5 tool definitions for modules 16+17", () => {
    expect(editorTools).toHaveLength(5);
  });

  it("REG-02: all remaining module 16 tools are present", () => {
    expect(toolNames).toContain("accordo_editor_open");
    expect(toolNames).toContain("accordo_editor_close");
    expect(toolNames).toContain("accordo_editor_focus");
  });

  it("REG-03: all remaining module 17 tools are present", () => {
    expect(toolNames).toContain("accordo_editor_highlight");
    expect(toolNames).toContain("accordo_editor_clearHighlights");
  });

  // M76-VCGM-01: removed tools are absent
  it("REG-03b: removed tools (scroll, split, reveal, save, saveAll, format) are absent", () => {
    expect(toolNames).not.toContain("accordo_editor_scroll");
    expect(toolNames).not.toContain("accordo_editor_split");
    expect(toolNames).not.toContain("accordo_editor_reveal");
    expect(toolNames).not.toContain("accordo_editor_save");
    expect(toolNames).not.toContain("accordo_editor_saveAll");
    expect(toolNames).not.toContain("accordo_editor_format");
  });

  it("REG-04: all tool inputSchemas have type: 'object'", () => {
    for (const tool of editorTools) {
      expect(tool.inputSchema.type).toBe("object");
    }
  });

  it("REG-05: safe tools do not require confirmation", () => {
    for (const tool of editorTools) {
      if (tool.dangerLevel === "safe") {
        expect(tool.requiresConfirmation).toBeFalsy();
      }
    }
  });

  it("REG-06: open, highlight, clearHighlights, focus are idempotent", () => {
    const idempotentNames = [
      "accordo_editor_open",
      "accordo_editor_highlight",
      "accordo_editor_clearHighlights",
      "accordo_editor_focus",
    ];
    for (const name of idempotentNames) {
      const tool = editorTools.find((t) => t.name === name);
      expect(tool?.idempotent, `${name} should be idempotent`).toBe(true);
    }
  });

  it("REG-08: all handlers are functions", () => {
    for (const tool of editorTools) {
      expect(typeof tool.handler).toBe("function");
    }
  });

  // ── Per-tool required fields contract ─────────────────────────────────────────
  // Prevents silent drift between requirement tables and exported inputSchema.

  const tool = (name: string) => editorTools.find((t) => t.name === name)!;

  it("REG-09: open requires [path]", () => {
    expect(tool("accordo_editor_open").inputSchema.required).toEqual(["path"]);
  });

  it("REG-13: highlight requires [path, startLine, endLine]", () => {
    expect(tool("accordo_editor_highlight").inputSchema.required).toEqual(
      expect.arrayContaining(["path", "startLine", "endLine"]),
    );
  });

  it("M41b-HLT-01: registered accordo_editor_highlight routes .md preview highlights through PREVIEW_APPLY_HIGHLIGHT", async () => {
    makeWorkspace();
    const applyHighlightHandler = vi.fn().mockReturnValue(true);
    mockState.registeredCommands.set(CAPABILITY_COMMANDS.PREVIEW_APPLY_HIGHLIGHT, applyHighlightHandler);

    const result = await tool("accordo_editor_highlight").handler({
      path: "/workspace/README.md",
      startLine: 2,
      endLine: 4,
    });

    expect(result).toEqual(
      expect.objectContaining({ highlighted: true, decorationId: expect.any(String) }),
    );
    expect(applyHighlightHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        uri: "file:///workspace/README.md",
        startLine: 1,
        endLine: 3,
      }),
    );
  });

  it("REG-14: focus requires [group]", () => {
    expect(tool("accordo_editor_focus").inputSchema.required).toContain("group");
  });

  it("REG-15: clearHighlights has empty required array", () => {
    expect(tool("accordo_editor_clearHighlights").inputSchema.required).toEqual([]);
  });
});
