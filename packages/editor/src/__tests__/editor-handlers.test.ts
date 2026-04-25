/**
 * Tests for src/tools/editor-handlers.ts — extracted handler functions
 *
 * Tests the remaining handler functions exported from editor-handlers.ts.
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
 *   [ ] focusGroupHandler  — §4.7 (groups 1–9)
 *   [ ] _clearDecorationStore — test utility (internal)
 *
 * Removed exports (migrated to generic gateway):
 *   splitHandler (§4.6), revealHandler (§4.8)
 *   saveHandler (§4.17), saveAllHandler (§4.18), formatHandler (§4.19)
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
  focusGroupHandler,
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

  it("OPEN-04b: .md file with line scroll requests preview reveal for the 0-based line", async () => {
    makeWorkspace();
    await openHandler({ path: "/workspace/src/readme.md", line: 121, column: 1 });

    expect(vi.mocked(commands.executeCommand)).toHaveBeenCalledWith(
      "accordo_preview_internal_revealLine",
      "file:///workspace/src/readme.md",
      120,
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
