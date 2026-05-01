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
import { CAPABILITY_COMMANDS } from "@accordo/capabilities";
import { normaliseSlashes } from "../util.js";
import {
  argString,
  argStringOpt,
  argNumber,
  argNumberOpt,
  openHandler,
  markdownSetSurfaceHandler,
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
  mockState.registeredCommands.clear();
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
// accordo_markdown_setSurface
// ─────────────────────────────────────────────────────────────────────────────

describe("markdownSetSurfaceHandler", () => {
  it("MD-SURFACE-01: opens a Markdown file in preview surface", async () => {
    makeWorkspace();
    const result = await markdownSetSurfaceHandler({ path: "/workspace/src/readme.md", surface: "preview" });

    expect(result).toEqual({ opened: true, path: "/workspace/src/readme.md", surface: "preview" });
    expect(vi.mocked(commands.executeCommand)).toHaveBeenCalledWith(
      "vscode.openWith",
      expect.any(vscodeMock.Uri),
      "accordo.markdownPreview",
    );
  });

  it("MD-SURFACE-02: opens a Markdown file in text surface", async () => {
    makeWorkspace();
    const result = await markdownSetSurfaceHandler({ path: "/workspace/src/readme.md", surface: "text", line: 7, column: 3 });

    expect(result).toEqual({ opened: true, path: "/workspace/src/readme.md", surface: "text" });
    const callArgs = vi.mocked(window.showTextDocument).mock.calls[0];
    expect(callArgs[0]).toEqual(expect.any(vscodeMock.Uri));
    const options = callArgs[1] as { selection: vscodeMock.Range; preview: boolean };
    expect(options.preview).toBe(false);
    expect(options.selection.start.line).toBe(6);
    expect(options.selection.start.character).toBe(2);
  });

  it("MD-SURFACE-03: preview surface with line requests preview reveal", async () => {
    makeWorkspace();
    await markdownSetSurfaceHandler({ path: "/workspace/src/readme.md", surface: "preview", line: 12 });

    expect(vi.mocked(commands.executeCommand)).toHaveBeenCalledWith(
      "accordo_preview_internal_revealLine",
      "file:///workspace/src/readme.md",
      11,
    );
  });

  it("MD-SURFACE-04: rejects non-Markdown files", async () => {
    makeWorkspace();
    const result = await markdownSetSurfaceHandler({ path: "/workspace/src/file.txt", surface: "preview" });

    expect(result).toEqual({ error: "Path must be a Markdown .md file" });
  });

  it("MD-SURFACE-05: rejects unknown surfaces", async () => {
    makeWorkspace();
    const result = await markdownSetSurfaceHandler({ path: "/workspace/src/readme.md", surface: "toggle" });

    expect(result).toEqual({ error: "Argument 'surface' must be 'text' or 'preview'" });
  });

  it("MD-SURFACE-06: replays existing Markdown preview highlights when switching to text", async () => {
    makeWorkspace();
    const applyHighlightHandler = vi.fn().mockReturnValue(true);
    mockState.registeredCommands.set(CAPABILITY_COMMANDS.PREVIEW_APPLY_HIGHLIGHT, applyHighlightHandler);
    mockState.visibleTextEditors = [];

    await highlightHandler({
      path: "/workspace/src/readme.md",
      startLine: 270,
      endLine: 270,
      color: "rgba(255, 214, 10, 0.45)",
    });

    const editor = makeVisibleEditor("/workspace/src/readme.md");
    vi.mocked(window.showTextDocument).mockResolvedValueOnce(editor as never);

    const result = await markdownSetSurfaceHandler({ path: "/workspace/src/readme.md", surface: "text", line: 270 });

    expect(result).toEqual({ opened: true, path: "/workspace/src/readme.md", surface: "text" });
    expect(editor.setDecorations).toHaveBeenCalledOnce();
    expect(vi.mocked(window.createTextEditorDecorationType)).toHaveBeenCalledWith({
      backgroundColor: "rgba(255, 214, 10, 0.45)",
    });
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

  it("HL-01b: single-line highlights cover the full line", async () => {
    makeWorkspace();
    const editor = makeVisibleEditor("/workspace/foo.ts");
    mockState.visibleTextEditors = [editor];

    await highlightHandler({ path: "/workspace/foo.ts", startLine: 5, endLine: 5 });

    const ranges = vi.mocked(editor.setDecorations).mock.calls[0][1] as vscodeMock.Range[];
    expect(ranges[0].start.line).toBe(4);
    expect(ranges[0].start.character).toBe(0);
    expect(ranges[0].end.line).toBe(4);
    expect(ranges[0].end.character).toBe(Number.MAX_SAFE_INTEGER);
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
// §4.4 accordo_editor_highlight — markdown preview routing
// Requirements: requirements-editor.md §4.4; requirements-md-viewer.md M41b-HLT-01/02/03
// ─────────────────────────────────────────────────────────────────────────────

describe("highlightHandler — §4.4 preview routing (M41b-HLT-01, M41b-HLT-02, M41b-HLT-03)", () => {
  it("M41b-HLT-01: .md file with open Accordo Markdown Preview → calls PREVIEW_APPLY_HIGHLIGHT command and returns success", async () => {
    makeWorkspace();
    const applyHighlightHandler = vi.fn().mockReturnValue(true);
    mockState.registeredCommands.set(CAPABILITY_COMMANDS.PREVIEW_APPLY_HIGHLIGHT, applyHighlightHandler);

    // No visible text editor (preview is a webview, not a text editor)
    mockState.visibleTextEditors = [];

    const result = await highlightHandler({
      path: "/workspace/README.md",
      startLine: 5,
      endLine: 10,
    });

    // The handler must route to the preview command and return success
    expect(result).toEqual(
      expect.objectContaining({ highlighted: true, decorationId: expect.any(String) }),
    );
    expect(applyHighlightHandler).toHaveBeenCalledOnce();
    const callArgs = applyHighlightHandler.mock.calls[0][0] as Record<string, unknown>;
    expect(callArgs.uri).toBe("file:///workspace/README.md");
    expect(callArgs.decorationId).toBeDefined();
    expect(callArgs.startLine).toBe(4);   // 0-based: 5 - 1
    expect(callArgs.endLine).toBe(9);     // 0-based: 10 - 1
    expect(callArgs.color).toBe("rgba(255,255,0,0.3)");
  });

  it("M41b-HLT-01: .md file with open Accordo Markdown Preview uses custom color", async () => {
    makeWorkspace();
    const applyHighlightHandler = vi.fn().mockReturnValue(true);
    mockState.registeredCommands.set(CAPABILITY_COMMANDS.PREVIEW_APPLY_HIGHLIGHT, applyHighlightHandler);
    mockState.visibleTextEditors = [];

    await highlightHandler({
      path: "/workspace/README.md",
      startLine: 1,
      endLine: 3,
      color: "rgba(255,0,0,0.5)",
    });

    expect(applyHighlightHandler).toHaveBeenCalledOnce();
    const callArgs = applyHighlightHandler.mock.calls[0][0] as Record<string, unknown>;
    expect(callArgs.color).toBe("rgba(255,0,0,0.5)");
  });

  it("M41b-HLT-01: PREVIEW_APPLY_HIGHLIGHT receives 0-based line numbers (source line - 1)", async () => {
    makeWorkspace();
    const applyHighlightHandler = vi.fn().mockReturnValue(true);
    mockState.registeredCommands.set(CAPABILITY_COMMANDS.PREVIEW_APPLY_HIGHLIGHT, applyHighlightHandler);
    mockState.visibleTextEditors = [];

    await highlightHandler({
      path: "/workspace/doc.md",
      startLine: 10,
      endLine: 15,
    });

    expect(applyHighlightHandler).toHaveBeenCalledOnce();
    const callArgs = applyHighlightHandler.mock.calls[0][0] as Record<string, unknown>;
    // 1-based input → 0-based for the command
    expect(callArgs.startLine).toBe(9);   // 10 - 1
    expect(callArgs.endLine).toBe(14);    // 15 - 1
  });

  it("M41b-HLT-01: each preview highlight call gets a unique decorationId stored in decorationStore", async () => {
    makeWorkspace();
    const applyHighlightHandler = vi.fn().mockReturnValue(true);
    mockState.registeredCommands.set(CAPABILITY_COMMANDS.PREVIEW_APPLY_HIGHLIGHT, applyHighlightHandler);
    mockState.visibleTextEditors = [];

    const r1 = await highlightHandler({ path: "/workspace/a.md", startLine: 1, endLine: 1 }) as { decorationId: string };
    const r2 = await highlightHandler({ path: "/workspace/b.md", startLine: 2, endLine: 2 }) as { decorationId: string };

    expect(r1.decorationId).not.toBe(r2.decorationId);
    // Both IDs must be retrievable from the store for later clearAll
    const { decorationStore } = await import("../tools/editor-utils.js");
    expect(decorationStore.has(r1.decorationId)).toBe(true);
    expect(decorationStore.has(r2.decorationId)).toBe(true);
  });

  it("M41b-HLT-01: PREVIEW_APPLY_HIGHLIGHT returns false (no live preview) → returns error 'File is not open'", async () => {
    makeWorkspace();
    const applyHighlightHandler = vi.fn().mockReturnValue(false);
    mockState.registeredCommands.set(CAPABILITY_COMMANDS.PREVIEW_APPLY_HIGHLIGHT, applyHighlightHandler);
    mockState.visibleTextEditors = [];

    const result = await highlightHandler({
      path: "/workspace/README.md",
      startLine: 1,
      endLine: 3,
    });

    // When the preview command returns false, the handler must fall through to the error path
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toBe("File is not open: /workspace/README.md. Open it first.");
  });

  it("M41b-HLT-01: .md with no registered PREVIEW_APPLY_HIGHLIGHT command → returns error 'File is not open'", async () => {
    makeWorkspace();
    mockState.visibleTextEditors = [];

    const result = await highlightHandler({
      path: "/workspace/README.md",
      startLine: 1,
      endLine: 3,
    });

    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toBe("File is not open: /workspace/README.md. Open it first.");
  });

  it("M41b-HLT-01: preview-routed .md validates endLine against the open document line count", async () => {
    makeWorkspace();
    const applyHighlightHandler = vi.fn().mockReturnValue(true);
    mockState.registeredCommands.set(CAPABILITY_COMMANDS.PREVIEW_APPLY_HIGHLIGHT, applyHighlightHandler);
    mockState.textDocuments = [makeOpenDocument("/workspace/README.md")];
    mockState.textDocuments[0].lineCount = 3;

    const result = await highlightHandler({
      path: "/workspace/README.md",
      startLine: 1,
      endLine: 4,
    });

    expect(result).toEqual({ error: "Line 4 is out of range (file has 3 lines)" });
    expect(applyHighlightHandler).not.toHaveBeenCalled();
  });

  it("M41b-HLT-01: visible .md text editor remains authoritative and does not route to preview", async () => {
    makeWorkspace();
    const applyHighlightHandler = vi.fn().mockReturnValue(true);
    mockState.registeredCommands.set(CAPABILITY_COMMANDS.PREVIEW_APPLY_HIGHLIGHT, applyHighlightHandler);
    const editor = makeVisibleEditor("/workspace/README.md");
    mockState.visibleTextEditors = [editor];

    const result = await highlightHandler({
      path: "/workspace/README.md",
      startLine: 1,
      endLine: 2,
    });

    expect(result).toEqual(
      expect.objectContaining({ highlighted: true, decorationId: expect.any(String) }),
    );
    expect(editor.setDecorations).toHaveBeenCalledOnce();
    expect(applyHighlightHandler).not.toHaveBeenCalled();
  });

  it("M41b-HLT-02: decorationId stored with surface=markdown-preview for preview highlights", async () => {
    makeWorkspace();
    const applyHighlightHandler = vi.fn().mockReturnValue(true);
    mockState.registeredCommands.set(CAPABILITY_COMMANDS.PREVIEW_APPLY_HIGHLIGHT, applyHighlightHandler);
    mockState.visibleTextEditors = [];

    const result = await highlightHandler({ path: "/workspace/doc.md", startLine: 1, endLine: 1 }) as { decorationId: string };
    const { decorationStore } = await import("../tools/editor-utils.js");
    const entry = decorationStore.get(result.decorationId);
    expect(entry).toBeDefined();
    expect((entry as { surface: string }).surface).toBe("markdown-preview");
  });

  it("M41b-HLT-03: clearHighlightsHandler with decorationId calls PREVIEW_CLEAR_HIGHLIGHT for preview entries", async () => {
    makeWorkspace();
    const applyHighlightHandler = vi.fn().mockReturnValue(true);
    const clearHighlightHandler = vi.fn().mockReturnValue(true);
    mockState.registeredCommands.set(CAPABILITY_COMMANDS.PREVIEW_APPLY_HIGHLIGHT, applyHighlightHandler);
    mockState.registeredCommands.set(CAPABILITY_COMMANDS.PREVIEW_CLEAR_HIGHLIGHT, clearHighlightHandler);
    mockState.visibleTextEditors = [];

    // Create a preview highlight
    const r = await highlightHandler({ path: "/workspace/doc.md", startLine: 1, endLine: 1 }) as { decorationId: string };

    // Clear by decorationId
    const clearResult = await clearHighlightsHandler({ decorationId: r.decorationId });

    expect(clearResult).toEqual({ cleared: true, count: 1 });
    expect(clearHighlightHandler).toHaveBeenCalledOnce();
    const clearArgs = clearHighlightHandler.mock.calls[0][0] as Record<string, unknown>;
    expect(clearArgs.uri).toBe("file:///workspace/doc.md");
    expect(clearArgs.decorationId).toBe(r.decorationId);
  });

  it("M41b-HLT-03: clearHighlightsHandler clear-all iterates preview entries and calls PREVIEW_CLEAR_HIGHLIGHT per URI", async () => {
    makeWorkspace();
    const applyHighlightHandler = vi.fn().mockReturnValue(true);
    const clearHighlightHandler = vi.fn().mockReturnValue(true);
    mockState.registeredCommands.set(CAPABILITY_COMMANDS.PREVIEW_APPLY_HIGHLIGHT, applyHighlightHandler);
    mockState.registeredCommands.set(CAPABILITY_COMMANDS.PREVIEW_CLEAR_HIGHLIGHT, clearHighlightHandler);
    mockState.visibleTextEditors = [];

    // Create 2 preview highlights on different files
    await highlightHandler({ path: "/workspace/a.md", startLine: 1, endLine: 1 });
    await highlightHandler({ path: "/workspace/b.md", startLine: 2, endLine: 2 });

    const clearResult = await clearHighlightsHandler({});

    expect(clearResult).toEqual({ cleared: true, count: 2 });
    // clearAll calls PREVIEW_CLEAR_HIGHLIGHT with no decorationId (clear all for that URI)
    // The command is called twice — once per unique URI in the store
    expect(clearHighlightHandler).toHaveBeenCalledTimes(2);
    const uris = clearHighlightHandler.mock.calls.map(c => (c[0] as Record<string, unknown>).uri).sort();
    expect(uris).toEqual(["file:///workspace/a.md", "file:///workspace/b.md"]);
  });

  it("M41b-HLT-03: clearHighlightsHandler clear-all clears mixed text-editor and markdown-preview highlights", async () => {
    makeWorkspace();
    const textEditor = makeVisibleEditor("/workspace/foo.ts");
    mockState.visibleTextEditors = [textEditor];
    const clearHighlightHandler = vi.fn().mockReturnValue(true);
    mockState.registeredCommands.set(CAPABILITY_COMMANDS.PREVIEW_APPLY_HIGHLIGHT, vi.fn().mockReturnValue(true));
    mockState.registeredCommands.set(CAPABILITY_COMMANDS.PREVIEW_CLEAR_HIGHLIGHT, clearHighlightHandler);

    await highlightHandler({ path: "/workspace/foo.ts", startLine: 1, endLine: 1 });
    mockState.visibleTextEditors = [];
    await highlightHandler({ path: "/workspace/doc.md", startLine: 2, endLine: 2 });

    const clearResult = await clearHighlightsHandler({});

    expect(clearResult).toEqual({ cleared: true, count: 2 });
    expect(clearHighlightHandler).toHaveBeenCalledWith(
      expect.objectContaining({ uri: "file:///workspace/doc.md" }),
    );
  });
});

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
