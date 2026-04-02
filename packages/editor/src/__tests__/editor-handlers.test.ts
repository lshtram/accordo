/**
 * Tests for src/tools/editor-handlers.ts — extracted handler functions
 *
 * Phase B — all tests fail RED against "not implemented" stubs.
 * This file tests the handler functions that will be exported from editor-handlers.ts.
 *
 * Exported API checklist (Phase B requirement):
 *   [ ] argString           — required string arg extractor
 *   [ ] argStringOpt        — optional string arg extractor
 *   [ ] argNumber           — required number arg extractor
 *   [ ] argNumberOpt        — optional number arg extractor with default
 *   [ ] openHandler         — §4.1 (open + scroll to position)
 *   [ ] closeHandler       — §4.2 (active or by path)
 *   [ ] scrollHandler      — §4.3 (up/down, line/page)
 *   [ ] highlightHandler   — §4.4 (decoration create + store)
 *   [ ] clearHighlightsHandler — §4.5 (by id or all)
 *   [ ] splitHandler       — §4.6 (right/down)
 *   [ ] focusGroupHandler  — §4.7 (groups 1–9)
 *   [ ] revealHandler      — §4.8 (explorer reveal)
 *   [ ] saveHandler       — §4.17 (active or by path)
 *   [ ] saveAllHandler    — §4.18 (count dirty docs)
 *   [ ] formatHandler      — §4.19 (focus then format)
 *   [ ] _clearDecorationStore — test utility (internal)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { normaliseSlashes } from "../util.js";
import {
  argString,
  argStringOpt,
  argNumber,
  argNumberOpt,
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
} from "../tools/editor-handlers.js";

import * as vscodeMock from "./mocks/vscode.js";
const { mockState, window, commands, workspace } = vscodeMock;

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalizePathForComparison(p: string): string {
  const normalized = normaliseSlashes(p);
  return normalized.replace(/^[a-zA-Z]:/, "");
}

function makeWorkspace(root = "/workspace"): void {
  mockState.workspaceFolders = [
    { uri: vscodeMock.Uri.file(root), name: "ws", index: 0 },
  ];
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

function makeOpenDocument(fsPath: string, dirty = false) {
  return {
    uri: vscodeMock.Uri.file(fsPath),
    isDirty: dirty,
    fileName: fsPath,
    save: vi.fn().mockResolvedValue(true),
    lineCount: 100,
  };
}

// ── Global beforeEach ─────────────────────────────────────────────────────────

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
// Arg extraction helpers
// ─────────────────────────────────────────────────────────────────────────────

describe("argString", () => {
  it("ARG-01: returns value when key exists and is a string", () => {
    const args = { path: "/workspace/foo.ts" };
    expect(argString(args, "path")).toBe("/workspace/foo.ts");
  });

  it("ARG-02: throws when key is missing", () => {
    const args: Record<string, unknown> = {};
    expect(() => argString(args, "path")).toThrow("Argument 'path' must be a string");
  });

  it("ARG-03: throws when key is wrong type (number)", () => {
    const args = { path: 42 };
    expect(() => argString(args, "path")).toThrow("Argument 'path' must be a string");
  });

  it("ARG-04: throws when key is wrong type (object)", () => {
    const args = { path: { foo: "bar" } };
    expect(() => argString(args, "path")).toThrow("Argument 'path' must be a string");
  });
});

describe("argStringOpt", () => {
  it("ARG-05: returns value when key exists and is a string", () => {
    const args = { path: "/workspace/foo.ts" };
    expect(argStringOpt(args, "path")).toBe("/workspace/foo.ts");
  });

  it("ARG-06: returns undefined when key is missing", () => {
    const args: Record<string, unknown> = {};
    expect(argStringOpt(args, "path")).toBeUndefined();
  });

  it("ARG-07: returns undefined when key is null", () => {
    const args = { path: null };
    expect(argStringOpt(args, "path")).toBeUndefined();
  });

  it("ARG-08: throws when key is wrong type (number)", () => {
    const args = { path: 42 };
    expect(() => argStringOpt(args, "path")).toThrow("Argument 'path' must be a string");
  });
});

describe("argNumber", () => {
  it("ARG-09: returns value when key exists and is a number", () => {
    const args = { line: 10 };
    expect(argNumber(args, "line")).toBe(10);
  });

  it("ARG-10: throws when key is missing", () => {
    const args: Record<string, unknown> = {};
    expect(() => argNumber(args, "line")).toThrow("Argument 'line' must be a number");
  });

  it("ARG-11: throws when key is wrong type (string)", () => {
    const args = { line: "10" };
    expect(() => argNumber(args, "line")).toThrow("Argument 'line' must be a number");
  });

  it("ARG-12: throws when key is wrong type (boolean)", () => {
    const args = { line: true };
    expect(() => argNumber(args, "line")).toThrow("Argument 'line' must be a number");
  });
});

describe("argNumberOpt", () => {
  it("ARG-13: returns value when key exists and is a number", () => {
    const args = { line: 10 };
    expect(argNumberOpt(args, "line", 1)).toBe(10);
  });

  it("ARG-14: returns defaultValue when key is missing", () => {
    const args: Record<string, unknown> = {};
    expect(argNumberOpt(args, "line", 5)).toBe(5);
  });

  it("ARG-15: returns defaultValue when key is null", () => {
    const args = { line: null };
    expect(argNumberOpt(args, "line", 5)).toBe(5);
  });

  it("ARG-16: throws when key is wrong type (string)", () => {
    const args = { line: "10" };
    expect(() => argNumberOpt(args, "line", 1)).toThrow("Argument 'line' must be a number");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4.1 accordo_editor_open
// ─────────────────────────────────────────────────────────────────────────────

describe("openHandler — §4.1", () => {
  it("OPEN-01: returns { opened: true, path } when file opens successfully", async () => {
    makeWorkspace();
    const result = await openHandler({ path: "/workspace/src/foo.ts" });
    expect(result).toEqual({ opened: true, path: "/workspace/src/foo.ts", surface: "editor" });
  });

  it("OPEN-02: returns { error: string } when file not found", async () => {
    makeWorkspace();
    vi.mocked(window.showTextDocument).mockRejectedValueOnce(
      new Error("File not found: /workspace/missing.ts"),
    );
    const result = await openHandler({ path: "/workspace/missing.ts" });
    expect(result).toHaveProperty("error");
    expect(typeof (result as { error: string }).error).toBe("string");
  });

  it("OPEN-03: scrolls to specified line and column (1-based input)", async () => {
    makeWorkspace();
    await openHandler({ path: "/workspace/foo.ts", line: 10, column: 5 });
    const callArgs = vi.mocked(window.showTextDocument).mock.calls[0];
    const options = callArgs[1] as { selection: vscodeMock.Range };
    expect(options?.selection?.start?.line).toBe(9);   // 10 - 1 = 9 (0-based)
    expect(options?.selection?.start?.character).toBe(4); // 5 - 1 = 4 (0-based)
  });

  it("OPEN-04: .md file opens in accordo.markdownPreview, returns surface: 'preview'", async () => {
    makeWorkspace();
    const result = await openHandler({ path: "/workspace/src/readme.md" });
    expect(result).toEqual({ opened: true, path: "/workspace/src/readme.md", surface: "preview" });
    expect(vi.mocked(commands.executeCommand)).toHaveBeenCalledWith(
      "vscode.openWith",
      expect.any(vscodeMock.Uri),
      "accordo.markdownPreview",
    );
  });

  it("OPEN-05: .mmd file opens in accordo-diagram, returns surface: 'diagram'", async () => {
    makeWorkspace();
    const result = await openHandler({ path: "/workspace/src/diagram.mmd" });
    expect(result).toEqual({ opened: true, path: "/workspace/src/diagram.mmd", surface: "diagram" });
    expect(vi.mocked(commands.executeCommand)).toHaveBeenCalledWith(
      "accordo-diagram.open",
      expect.any(vscodeMock.Uri),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4.2 accordo_editor_close
// ─────────────────────────────────────────────────────────────────────────────

describe("closeHandler — §4.2", () => {
  it("CLOSE-01: returns { closed: true } when closing active editor", async () => {
    mockState.activeTextEditor = makeVisibleEditor("/workspace/foo.ts");
    const result = await closeHandler({});
    expect(result).toEqual({ closed: true });
  });

  it("CLOSE-02: returns { closed: true } when no active editor and no path (closes active tab)", async () => {
    mockState.activeTextEditor = null;
    const result = await closeHandler({});
    expect(result).toEqual({ closed: true });
  });

  it("CLOSE-03: returns { closed: true } when closing specific file tab", async () => {
    makeWorkspace();
    mockState.tabGroups.all = [
      {
        tabs: [
          { input: { uri: vscodeMock.Uri.file("/workspace/foo.ts") } },
        ],
      },
    ];
    const result = await closeHandler({ path: "/workspace/foo.ts" });
    expect(result).toEqual({ closed: true });
  });

  it("CLOSE-04: returns { closed: true } when .mmd file not in any tab (falls back to active editor)", async () => {
    makeWorkspace();
    mockState.tabGroups.all = [];
    const result = await closeHandler({ path: "/workspace/notopen.mmd" });
    // .mmd files fall back to closing active editor
    expect(result).toEqual({ closed: true });
  });

  it("CLOSE-05: returns { error } when non-.mmd file not in any tab (no fallback)", async () => {
    makeWorkspace();
    mockState.tabGroups.all = [];
    const result = await closeHandler({ path: "/workspace/notopen.ts" });
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toBe("File is not open: /workspace/notopen.ts");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4.3 accordo_editor_scroll
// ─────────────────────────────────────────────────────────────────────────────

describe("scrollHandler — §4.3", () => {
  it("SCROLL-01: returns { line: number } on success", async () => {
    mockState.activeTextEditor = makeVisibleEditor("/workspace/foo.ts", 19);
    const result = await scrollHandler({ direction: "down" });
    expect(result).toEqual({ line: 20 });
  });

  it("SCROLL-02: returns { error: string } when no active editor", async () => {
    mockState.activeTextEditor = null;
    const result = await scrollHandler({ direction: "down" });
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toBe("No active editor");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4.4 accordo_editor_highlight
// ─────────────────────────────────────────────────────────────────────────────

describe("highlightHandler — §4.4", () => {
  it("HL-01: returns { highlighted: true, decorationId } on success", async () => {
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
  });

  it("HL-02: returns { error: string } when startLine > endLine", async () => {
    makeWorkspace();
    mockState.visibleTextEditors = [makeVisibleEditor("/workspace/foo.ts")];
    const result = await highlightHandler({
      path: "/workspace/foo.ts",
      startLine: 10,
      endLine: 5,
    });
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toBe("startLine must be <= endLine");
  });

  it("HL-03: returns { error: string } when file not open", async () => {
    makeWorkspace();
    mockState.visibleTextEditors = [];
    const result = await highlightHandler({
      path: "/workspace/foo.ts",
      startLine: 1,
      endLine: 3,
    });
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toBe("File is not open: /workspace/foo.ts. Open it first.");
  });

  it("HL-04: returns { error: string } when endLine out of range", async () => {
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
    expect((result as { error: string }).error).toBe("Line 999 is out of range (file has 10 lines)");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4.5 accordo_editor_clearHighlights
// ─────────────────────────────────────────────────────────────────────────────

describe("clearHighlightsHandler — §4.5", () => {
  it("CLR-01: clears all decorations when no decorationId given", async () => {
    makeWorkspace();
    mockState.visibleTextEditors = [makeVisibleEditor("/workspace/foo.ts")];
    // Create two decorations
    await highlightHandler({ path: "/workspace/foo.ts", startLine: 1, endLine: 1 });
    await highlightHandler({ path: "/workspace/foo.ts", startLine: 5, endLine: 5 });
    const result = await clearHighlightsHandler({});
    expect(result).toEqual({ cleared: true, count: 2 });
  });

  it("CLR-02: clears specific decoration when decorationId given", async () => {
    makeWorkspace();
    mockState.visibleTextEditors = [makeVisibleEditor("/workspace/foo.ts")];
    const r1 = await highlightHandler({ path: "/workspace/foo.ts", startLine: 1, endLine: 1 }) as { decorationId: string };
    await highlightHandler({ path: "/workspace/foo.ts", startLine: 5, endLine: 5 });
    // Clear only the first
    const result = await clearHighlightsHandler({ decorationId: r1.decorationId });
    expect(result).toEqual({ cleared: true, count: 1 });
  });

  it("CLR-03: returns { cleared: true, count: number }", async () => {
    makeWorkspace();
    mockState.visibleTextEditors = [makeVisibleEditor("/workspace/foo.ts")];
    await highlightHandler({ path: "/workspace/foo.ts", startLine: 1, endLine: 1 });
    const result = await clearHighlightsHandler({});
    expect(result).toHaveProperty("cleared", true);
    expect(result).toHaveProperty("count", expect.any(Number));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4.6 accordo_editor_split
// ─────────────────────────────────────────────────────────────────────────────

describe("splitHandler — §4.6", () => {
  it("SPLIT-01: returns { groups: number } on success", async () => {
    mockState.tabGroups.all = [{ tabs: [] }, { tabs: [] }];
    const result = await splitHandler({ direction: "right" });
    expect(result).toEqual({ groups: 2 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4.7 accordo_editor_focus
// ─────────────────────────────────────────────────────────────────────────────

describe("focusGroupHandler — §4.7", () => {
  beforeEach(() => {
    mockState.tabGroups.all = [{ tabs: [] }, { tabs: [] }, { tabs: [] }];
  });

  it("FOCUS-01: returns { focused: true, group } on success", async () => {
    const result = await focusGroupHandler({ group: 1 });
    expect(result).toEqual({ focused: true, group: 1 });
  });

  it("FOCUS-02: returns { error: string } when group out of range", async () => {
    const result = await focusGroupHandler({ group: 10 });
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toBe("Editor group 10 does not exist (max: 3)");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4.8 accordo_editor_reveal
// ─────────────────────────────────────────────────────────────────────────────

describe("revealHandler — §4.8", () => {
  it("REVEAL-01: returns { revealed: true, path } on success", async () => {
    makeWorkspace();
    vi.mocked(workspace.fs.stat).mockResolvedValueOnce({
      type: vscodeMock.FileType.File,
      size: 100,
      mtime: 0,
      ctime: 0,
    });
    const result = await revealHandler({ path: "/workspace/src/foo.ts" });
    expect(result).toEqual({ revealed: true, path: "/workspace/src/foo.ts" });
  });

  it("REVEAL-02: returns { error: string } when file not found", async () => {
    makeWorkspace();
    vi.mocked(workspace.fs.stat).mockRejectedValueOnce(
      new Error("ENOENT: file not found"),
    );
    const result = await revealHandler({ path: "/workspace/missing.ts" });
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toBe("File not found: /workspace/missing.ts");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4.17 accordo_editor_save
// ─────────────────────────────────────────────────────────────────────────────

describe("saveHandler — §4.17", () => {
  it("SAVE-01: returns { saved: true, path } on success (active editor)", async () => {
    const editor = makeVisibleEditor("/workspace/foo.ts");
    mockState.activeTextEditor = editor;
    const result = await saveHandler({});
    expect(result).toEqual({ saved: true, path: "/workspace/foo.ts" });
  });

  it("SAVE-02: returns { saved: true, path } on success (specific file)", async () => {
    makeWorkspace();
    const doc = makeOpenDocument("/workspace/bar.ts");
    mockState.textDocuments = [doc];
    const result = await saveHandler({ path: "/workspace/bar.ts" });
    expect(result).toEqual({ saved: true, path: "/workspace/bar.ts" });
  });

  it("SAVE-03: returns { error: string } when no active editor and no path", async () => {
    mockState.activeTextEditor = null;
    const result = await saveHandler({});
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toBe("No active editor to save");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4.18 accordo_editor_saveAll
// ─────────────────────────────────────────────────────────────────────────────

describe("saveAllHandler — §4.18", () => {
  it("SAVEALL-01: returns { saved: true, count: number } on success", async () => {
    mockState.textDocuments = [
      makeOpenDocument("/workspace/a.ts", true),
      makeOpenDocument("/workspace/b.ts", true),
      makeOpenDocument("/workspace/c.ts", false),
    ];
    const result = await saveAllHandler({});
    expect(result).toEqual({ saved: true, count: 2 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4.19 accordo_editor_format
// ─────────────────────────────────────────────────────────────────────────────

describe("formatHandler — §4.19", () => {
  it("FMT-01: returns { formatted: true, path } on success (active editor)", async () => {
    const editor = makeVisibleEditor("/workspace/foo.ts");
    mockState.activeTextEditor = editor;
    const result = await formatHandler({});
    expect(result).toEqual({ formatted: true, path: "/workspace/foo.ts" });
  });

  it("FMT-02: returns { formatted: true, path } on success (specific file)", async () => {
    makeWorkspace();
    const editor = makeVisibleEditor("/workspace/bar.ts");
    mockState.visibleTextEditors = [editor];
    const result = await formatHandler({ path: "/workspace/bar.ts" });
    expect(result).toEqual({ formatted: true, path: "/workspace/bar.ts" });
  });

  it("FMT-03: returns { error: string } when no active editor and no path", async () => {
    mockState.activeTextEditor = null;
    const result = await formatHandler({});
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toBe("No active editor to format");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// _clearDecorationStore
// ─────────────────────────────────────────────────────────────────────────────

describe("_clearDecorationStore", () => {
  it("DECOR-01: clears all decorations from the store", async () => {
    makeWorkspace();
    mockState.visibleTextEditors = [makeVisibleEditor("/workspace/foo.ts")];
    await highlightHandler({ path: "/workspace/foo.ts", startLine: 1, endLine: 1 });
    await highlightHandler({ path: "/workspace/foo.ts", startLine: 5, endLine: 5 });
    expect(await clearHighlightsHandler({})).toEqual({ cleared: true, count: 2 });
    _clearDecorationStore();
    expect(await clearHighlightsHandler({})).toEqual({ cleared: true, count: 0 });
  });
});
