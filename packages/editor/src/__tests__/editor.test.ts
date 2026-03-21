/**
 * Tests for src/tools/editor.ts — Modules 16 + 17
 *
 * Module 16 (§4.1–§4.3, §4.6–§4.8):
 *   accordo_editor_open, close, scroll, split, focus, reveal
 *
 * Module 17 (§4.4–§4.5, §4.17–§4.19):
 *   accordo_editor_highlight, clearHighlights, save, saveAll, format
 *
 * Phase B — all tests fail RED against "not implemented" stubs.
 *
 * Exported API checklist (Phase B requirement, dev-process.md §Phase B):
 *   [x] openHandler           — §4.1 (open + scroll to position)
 *   [x] closeHandler          — §4.2 (active or by path)
 *   [x] scrollHandler         — §4.3 (up/down, line/page)
 *   [x] highlightHandler      — §4.4 (decoration create + store)
 *   [x] clearHighlightsHandler — §4.5 (by id or all)
 *   [x] splitHandler          — §4.6 (right/down)
 *   [x] focusGroupHandler     — §4.7 (groups 1–9)
 *   [x] revealHandler         — §4.8 (explorer reveal)
 *   [x] saveHandler           — §4.17 (active or by path)
 *   [x] saveAllHandler        — §4.18 (count dirty docs)
 *   [x] formatHandler         — §4.19 (focus then format)
 *   [x] _clearDecorationStore — test helper (internal)
 *   [x] editorTools[]         — all 11 tool definitions exported
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import path from "path";
import { normaliseSlashes } from "../util.js";
import {
  openHandler,
  closeHandler,
  scrollHandler,
  highlightHandler,
  clearHighlightsHandler,
  splitHandler,
  focusGroupHandler,
  revealHandler,
  saveHandler,
  saveAllHandler,
  formatHandler,
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
    ).resolves.toEqual({ opened: true, path: "/workspace/src/foo.ts" });
    expect(window.showTextDocument).toHaveBeenCalled();
  });

  it("§4.1-OPEN-02: resolves relative path against workspace root", async () => {
    makeWorkspace("/workspace");
    const result = await openHandler({ path: "src/foo.ts" });
    expect(result).toEqual({
      opened: true,
      path: expect.any(String),
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

  it("§4.2-CLOSE-02: returns error when no active editor and no path given", async () => {
    mockState.activeTextEditor = null;
    const result = await closeHandler({});
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toBe("No active editor to close");
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

  it("§4.2-CLOSE-04: returns error when specified file is not open", async () => {
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

// ── §4.6 accordo_editor_split ────────────────────────────────────────────────

describe("splitHandler — §4.6", () => {
  it("§4.6-SPLIT-01: splits right and returns group count", async () => {
    mockState.tabGroups.all = [{ tabs: [] }, { tabs: [] }];
    await expect(splitHandler({ direction: "right" })).resolves.toEqual({
      groups: 2,
    });
    expect(commands.executeCommand).toHaveBeenCalledWith(
      "workbench.action.splitEditorRight",
    );
  });

  it("§4.6-SPLIT-02: splits down", async () => {
    mockState.tabGroups.all = [{ tabs: [] }, { tabs: [] }];
    await splitHandler({ direction: "down" });
    expect(commands.executeCommand).toHaveBeenCalledWith(
      "workbench.action.splitEditorDown",
    );
  });

  it("§4.6-SPLIT-R01: wraps command rejection as error object", async () => {
    mockState.tabGroups.all = [{ tabs: [] }];
    vi.mocked(commands.executeCommand).mockRejectedValueOnce(
      new Error("split failed"),
    );
    const result = await splitHandler({ direction: "right" });
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toBe("split failed");
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

// ── §4.8 accordo_editor_reveal ───────────────────────────────────────────────

describe("revealHandler — §4.8", () => {
  it("§4.8-REVEAL-01: reveals file in Explorer and returns absolute path", async () => {
    makeWorkspace();
    vi.mocked(workspace.fs.stat).mockResolvedValueOnce({
      type: vscodeMock.FileType.File,
      size: 100,
      mtime: 0,
      ctime: 0,
    });
    await expect(
      revealHandler({ path: "/workspace/src/foo.ts" }),
    ).resolves.toEqual({ revealed: true, path: "/workspace/src/foo.ts" });
    expect(commands.executeCommand).toHaveBeenCalledWith(
      "revealInExplorer",
      expect.objectContaining({ fsPath: "/workspace/src/foo.ts" }),
    );
  });

  it("§4.8-REVEAL-02: returns error when file does not exist", async () => {
    makeWorkspace();
    vi.mocked(workspace.fs.stat).mockRejectedValueOnce(
      new Error("ENOENT: file not found"),
    );
    const result = await revealHandler({ path: "/workspace/missing.ts" });
    expect(result).toHaveProperty("error");
    // §4.8 exact requirement string: "File not found: <resolved path>"
    expect((result as { error: string }).error).toBe("File not found: /workspace/missing.ts");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Module 17 — Editor decoration + save tools
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

// ── §4.17 accordo_editor_save ────────────────────────────────────────────────

describe("saveHandler — §4.17", () => {
  it("§4.17-SAVE-01: saves active editor when no path given", async () => {
    const editor = makeVisibleEditor("/workspace/foo.ts");
    mockState.activeTextEditor = editor;
    await expect(saveHandler({})).resolves.toEqual({
      saved: true,
      path: "/workspace/foo.ts",
    });
    expect(commands.executeCommand).toHaveBeenCalledWith(
      "workbench.action.files.save",
    );
  });

  it("§4.17-SAVE-02: saves specific document by path", async () => {
    makeWorkspace();
    const doc = makeOpenDocument("/workspace/bar.ts");
    mockState.textDocuments = [doc];
    await expect(saveHandler({ path: "/workspace/bar.ts" })).resolves.toEqual({
      saved: true,
      path: "/workspace/bar.ts",
    });
    expect(doc.save).toHaveBeenCalled();
  });

  it("§4.17-SAVE-03: resolves relative path for document save", async () => {
    makeWorkspace("/workspace");
    // Resolve the path that the handler will compute so we can set up the mock document with the correct path
    const resolvedPath = path.resolve("/workspace", "src/index.ts");
    const normalizedPath = normaliseSlashes(resolvedPath);
    const doc = makeOpenDocument(normalizedPath);
    mockState.textDocuments = [doc];
    const result = await saveHandler({ path: "src/index.ts" });
    expect(result).toHaveProperty("saved", true);
    expect(normalizePathForComparison((result as Record<string, unknown>).path as string)).toBe("/workspace/src/index.ts");
  });

  it("§4.17-SAVE-04: returns error when no active editor and no path given", async () => {
    mockState.activeTextEditor = null;
    const result = await saveHandler({});
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toBe("No active editor to save");
  });

  it("§4.17-SAVE-05: returns error when specified file is not open", async () => {
    makeWorkspace();
    mockState.textDocuments = [];
    const result = await saveHandler({ path: "/workspace/notopen.ts" });
    expect(result).toHaveProperty("error");
    // §4.17 exact requirement string: "File is not open: <path>"
    expect((result as { error: string }).error).toBe("File is not open: /workspace/notopen.ts");
  });
});

// ── §4.18 accordo_editor_saveAll ─────────────────────────────────────────────

describe("saveAllHandler — §4.18", () => {
  it("§4.18-SAVEALL-01: saves all dirty documents and returns the count", async () => {
    mockState.textDocuments = [
      makeOpenDocument("/workspace/a.ts", true),
      makeOpenDocument("/workspace/b.ts", true),
      makeOpenDocument("/workspace/c.ts", false),
    ];
    await expect(saveAllHandler({})).resolves.toEqual({ saved: true, count: 2 });
    expect(commands.executeCommand).toHaveBeenCalledWith(
      "workbench.action.files.saveAll",
    );
  });

  it("§4.18-SAVEALL-02: returns count 0 when no documents are dirty", async () => {
    mockState.textDocuments = [
      makeOpenDocument("/workspace/clean.ts", false),
    ];
    await expect(saveAllHandler({})).resolves.toEqual({ saved: true, count: 0 });
  });

  it("§4.18-SAVEALL-03: returns count 0 when no documents are open", async () => {
    mockState.textDocuments = [];
    await expect(saveAllHandler({})).resolves.toEqual({ saved: true, count: 0 });
  });
});

describe("saveHandler rejection — §4.17", () => {
  it("§4.17-SAVE-R01: wraps executeCommand rejection as error (no-path case)", async () => {
    const editor = makeVisibleEditor("/workspace/foo.ts");
    mockState.activeTextEditor = editor;
    vi.mocked(commands.executeCommand).mockRejectedValueOnce(
      new Error("save failed"),
    );
    const result = await saveHandler({});
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toBe("save failed");
  });

  it("§4.17-SAVE-R02: wraps document.save() rejection as error (path case)", async () => {
    makeWorkspace();
    const doc = makeOpenDocument("/workspace/bar.ts");
    vi.mocked(doc.save).mockRejectedValueOnce(new Error("disk full"));
    mockState.textDocuments = [doc];
    const result = await saveHandler({ path: "/workspace/bar.ts" });
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toBe("disk full");
  });
});

describe("saveAllHandler rejection — §4.18", () => {
  it("§4.18-SAVEALL-R01: wraps executeCommand rejection as error", async () => {
    vi.mocked(commands.executeCommand).mockRejectedValueOnce(
      new Error("saveAll failed"),
    );
    const result = await saveAllHandler({});
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toBe("saveAll failed");
  });
});

// ── §4.19 accordo_editor_format ──────────────────────────────────────────────

describe("formatHandler — §4.19", () => {
  it("§4.19-FMT-01: formats active editor when no path given", async () => {
    const editor = makeVisibleEditor("/workspace/foo.ts");
    mockState.activeTextEditor = editor;
    await expect(formatHandler({})).resolves.toEqual({
      formatted: true,
      path: "/workspace/foo.ts",
    });
    expect(commands.executeCommand).toHaveBeenCalledWith(
      "editor.action.formatDocument",
    );
  });

  it("§4.19-FMT-02: formats specific file when already open in a visible editor", async () => {
    makeWorkspace();
    const editor = makeVisibleEditor("/workspace/bar.ts");
    mockState.visibleTextEditors = [editor];
    await expect(formatHandler({ path: "/workspace/bar.ts" })).resolves.toEqual({
      formatted: true,
      path: "/workspace/bar.ts",
    });
    // §4.19 requirement: "Focus it, then executeCommand('editor.action.formatDocument')"
    expect(window.showTextDocument).toHaveBeenCalledWith(
      expect.objectContaining({ fsPath: "/workspace/bar.ts" }),
    );
    // showTextDocument (focus) must be called before format
    const focusOrder = vi.mocked(window.showTextDocument).mock.invocationCallOrder[0];
    const formatOrder = vi.mocked(commands.executeCommand).mock.calls.findIndex(
      (c) => c[0] === "editor.action.formatDocument",
    );
    expect(focusOrder).toBeDefined();
    expect(formatOrder).toBeGreaterThanOrEqual(0);
    expect(commands.executeCommand).toHaveBeenCalledWith("editor.action.formatDocument");
  });

  it("§4.19-FMT-03: returns error when no active editor and no path given", async () => {
    mockState.activeTextEditor = null;
    const result = await formatHandler({});
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toBe("No active editor to format");
  });

  it("§4.19-FMT-04: returns error when specified file is not open in any visible editor", async () => {
    makeWorkspace();
    mockState.visibleTextEditors = [];
    const result = await formatHandler({ path: "/workspace/notopen.ts" });
    expect(result).toHaveProperty("error");
    // §4.19 exact requirement string: "File is not open: <path>. Open it first."
    expect((result as { error: string }).error).toBe("File is not open: /workspace/notopen.ts. Open it first.");
  });
});

describe("formatHandler rejection — §4.19", () => {
  it("§4.19-FMT-R01: wraps executeCommand rejection as error", async () => {
    const editor = makeVisibleEditor("/workspace/foo.ts");
    mockState.activeTextEditor = editor;
    vi.mocked(commands.executeCommand).mockRejectedValueOnce(
      new Error("format failed"),
    );
    const result = await formatHandler({});
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toBe("format failed");
  });
});

// ── Tool definitions registration ─────────────────────────────────────────────

describe("editorTools registration", () => {
  const toolNames = editorTools.map((t) => t.name);

  it("REG-01: exports exactly 11 tool definitions for modules 16+17", () => {
    expect(editorTools).toHaveLength(11);
  });

  it("REG-02: all module 16 tools are present", () => {
    expect(toolNames).toContain("accordo_editor_open");
    expect(toolNames).toContain("accordo_editor_close");
    expect(toolNames).toContain("accordo_editor_scroll");
    expect(toolNames).toContain("accordo_editor_split");
    expect(toolNames).toContain("accordo_editor_focus");
    expect(toolNames).toContain("accordo_editor_reveal");
  });

  it("REG-03: all module 17 tools are present", () => {
    expect(toolNames).toContain("accordo_editor_highlight");
    expect(toolNames).toContain("accordo_editor_clearHighlights");
    expect(toolNames).toContain("accordo_editor_save");
    expect(toolNames).toContain("accordo_editor_saveAll");
    expect(toolNames).toContain("accordo_editor_format");
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

  it("REG-06: reveal, open, highlight, save, saveAll, format, clearHighlights are idempotent", () => {
    const idempotentNames = [
      "accordo_editor_open",
      "accordo_editor_reveal",
      "accordo_editor_highlight",
      "accordo_editor_clearHighlights",
      "accordo_editor_save",
      "accordo_editor_saveAll",
      "accordo_editor_format",
      "accordo_editor_focus",
    ];
    for (const name of idempotentNames) {
      const tool = editorTools.find((t) => t.name === name);
      expect(tool?.idempotent, `${name} should be idempotent`).toBe(true);
    }
  });

  it("REG-07: scroll and split are NOT idempotent", () => {
    const notIdempotent = ["accordo_editor_scroll", "accordo_editor_split"];
    for (const name of notIdempotent) {
      const tool = editorTools.find((t) => t.name === name);
      expect(tool?.idempotent ?? false, `${name} should not be idempotent`).toBe(false);
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

  it("REG-10: scroll required includes direction", () => {
    expect(tool("accordo_editor_scroll").inputSchema.required).toContain("direction");
  });

  it("REG-11: scroll.direction enum is ['up','down']", () => {
    const props = tool("accordo_editor_scroll").inputSchema.properties as Record<string, { enum?: string[] }>;
    expect(props["direction"].enum).toEqual(["up", "down"]);
  });

  it("REG-12: scroll.by enum is ['line','page'] when present", () => {
    const props = tool("accordo_editor_scroll").inputSchema.properties as Record<string, { enum?: string[] }>;
    expect(props["by"].enum).toEqual(["line", "page"]);
  });

  it("REG-13: highlight requires [path, startLine, endLine]", () => {
    expect(tool("accordo_editor_highlight").inputSchema.required).toEqual(
      expect.arrayContaining(["path", "startLine", "endLine"]),
    );
  });

  it("REG-14: split requires [direction]", () => {
    expect(tool("accordo_editor_split").inputSchema.required).toContain("direction");
  });

  it("REG-15: split.direction enum is ['right','down']", () => {
    const props = tool("accordo_editor_split").inputSchema.properties as Record<string, { enum?: string[] }>;
    expect(props["direction"].enum).toEqual(["right", "down"]);
  });

  it("REG-16: focus requires [group]", () => {
    expect(tool("accordo_editor_focus").inputSchema.required).toContain("group");
  });

  it("REG-17: reveal requires [path]", () => {
    expect(tool("accordo_editor_reveal").inputSchema.required).toEqual(["path"]);
  });

  it("REG-18: clearHighlights has empty required array", () => {
    expect(tool("accordo_editor_clearHighlights").inputSchema.required).toEqual([]);
  });

  it("REG-19: saveAll has empty required array", () => {
    expect(tool("accordo_editor_saveAll").inputSchema.required).toEqual([]);
  });
});


