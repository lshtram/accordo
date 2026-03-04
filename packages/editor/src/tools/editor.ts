/**
 * Editor tool handlers for accordo-editor.
 *
 * Implements the following tools from requirements-editor.md §4:
 *   Module 16: §4.1 open, §4.2 close, §4.3 scroll, §4.6 split,
 *              §4.7 focus (group), §4.8 reveal
 *   Module 17: §4.4 highlight, §4.5 clearHighlights,
 *              §4.17 save, §4.18 saveAll, §4.19 format
 */

import * as vscode from "vscode";
import type { ExtensionToolDefinition } from "@accordo/bridge-types";
import { resolvePath, wrapHandler, errorMessage } from "../util.js";

// ── Arg extraction helpers ────────────────────────────────────────────────────

/** Extract a required string argument; throws if missing/wrong type. */
function argString(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  if (typeof v !== "string") throw new Error(`Argument '${key}' must be a string`);
  return v;
}

/** Extract an optional string argument. */
function argStringOpt(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string") throw new Error(`Argument '${key}' must be a string`);
  return v;
}

/** Extract a required number argument; throws if missing/wrong type. */
function argNumber(args: Record<string, unknown>, key: string): number {
  const v = args[key];
  if (typeof v !== "number") throw new Error(`Argument '${key}' must be a number`);
  return v;
}

/** Extract an optional number argument with a default. */
function argNumberOpt(args: Record<string, unknown>, key: string, defaultValue: number): number {
  const v = args[key];
  if (v === undefined || v === null) return defaultValue;
  if (typeof v !== "number") throw new Error(`Argument '${key}' must be a number`);
  return v;
}

// ── Decoration store (§4.4, §4.5) ────────────────────────────────────────────

let decorationCounter = 0;

/**
 * Map from stable decorationId → { type, editor } so clearHighlights can
 * dispose specific decorations.
 */
const decorationStore = new Map<
  string,
  {
    type: vscode.TextEditorDecorationType;
    editor: vscode.TextEditor;
  }
>();

/** Exposed for test teardown only. */
export function _clearDecorationStore(): void {
  for (const { type } of decorationStore.values()) {
    type.dispose();
  }
  decorationStore.clear();
  decorationCounter = 0;
}

// ── Focus command lookup table (§4.7) ──────────────────────────────────────

const FOCUS_COMMANDS = [
  "workbench.action.focusFirstEditorGroup",
  "workbench.action.focusSecondEditorGroup",
  "workbench.action.focusThirdEditorGroup",
  "workbench.action.focusFourthEditorGroup",
  "workbench.action.focusFifthEditorGroup",
  "workbench.action.focusSixthEditorGroup",
  "workbench.action.focusSeventhEditorGroup",
  "workbench.action.focusEighthEditorGroup",
  "workbench.action.focusNinthEditorGroup",
] as const;

// ── §4.1 accordo.editor.open ─────────────────────────────────────────────────

/**
 * Open a file in the editor, optionally scrolling to a line/column.
 *
 * @param args.path - Required. File path (relative or absolute).
 * @param args.line - Optional. 1-based line number. Default: 1.
 * @param args.column - Optional. 1-based column. Default: 1.
 */
export async function openHandler(
  args: Record<string, unknown>,
): Promise<{ opened: true; path: string } | { error: string }> {
  try {
    const p = argString(args, "path");
    const line = argNumberOpt(args, "line", 1);
    const column = argNumberOpt(args, "column", 1);
    const resolved = resolvePath(p);
    const uri = vscode.Uri.file(resolved);
    const position = new vscode.Position(line - 1, column - 1);
    const range = new vscode.Range(position, position);
    await vscode.window.showTextDocument(uri, { selection: range });
    return { opened: true, path: resolved };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

// ── §4.2 accordo.editor.close ────────────────────────────────────────────────

/**
 * Close a specific editor tab, or the active editor if no path given.
 *
 * @param args.path - Optional. File to close. Omit → close active editor.
 */
export async function closeHandler(
  args: Record<string, unknown>,
): Promise<{ closed: true } | { error: string }> {
  try {
    const p = argStringOpt(args, "path");
    if (!p) {
      if (!vscode.window.activeTextEditor) {
        return { error: "No active editor to close" };
      }
      await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
      return { closed: true };
    }
    const resolved = resolvePath(p);
    const targetFsPath = vscode.Uri.file(resolved).fsPath;
    let foundTab: vscode.Tab | undefined;
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        // tab.input is a discriminated union; TextEditorTabInput has .uri but the base TabInput type does not expose it
        const input = tab.input as { uri?: vscode.Uri };
        if (input?.uri?.fsPath === targetFsPath) {
          foundTab = tab;
          break;
        }
      }
      if (foundTab) break;
    }
    if (!foundTab) {
      return { error: `File is not open: ${resolved}` };
    }
    await vscode.window.tabGroups.close(foundTab, false);
    return { closed: true };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

// ── §4.3 accordo.editor.scroll ───────────────────────────────────────────────

/**
 * Scroll the active editor viewport up or down.
 *
 * @param args.direction - Required. "up" | "down".
 * @param args.by        - Optional. "line" | "page". Default: "page".
 */
export async function scrollHandler(
  args: Record<string, unknown>,
): Promise<{ line: number } | { error: string }> {
  try {
    const direction = argString(args, "direction");
    const by = argStringOpt(args, "by") ?? "page";
    if (!vscode.window.activeTextEditor) {
      return { error: "No active editor" };
    }
    await vscode.commands.executeCommand("editorScroll", { to: direction, by, value: 1 });
    const line = vscode.window.activeTextEditor.visibleRanges[0].start.line + 1;
    return { line };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

// ── §4.4 accordo.editor.highlight ────────────────────────────────────────────

/**
 * Apply a background highlight decoration to a line range.
 *
 * @param args.path      - Required. File path (must be open in an editor).
 * @param args.startLine - Required. First line (1-based, inclusive).
 * @param args.endLine   - Required. Last line (1-based, inclusive).
 * @param args.color     - Optional. CSS color string. Default: "rgba(255,255,0,0.3)".
 */
export async function highlightHandler(
  args: Record<string, unknown>,
): Promise<{ highlighted: true; decorationId: string } | { error: string }> {
  try {
    const p = argString(args, "path");
    const startLine = argNumber(args, "startLine");
    const endLine = argNumber(args, "endLine");
    const color = argStringOpt(args, "color") ?? "rgba(255,255,0,0.3)";
    const resolved = resolvePath(p);
    if (startLine > endLine) {
      return { error: "startLine must be <= endLine" };
    }
    const targetFsPath = vscode.Uri.file(resolved).fsPath;
    const editor = vscode.window.visibleTextEditors.find(
      (e) => e.document.uri.fsPath === targetFsPath,
    );
    if (!editor) {
      return { error: `File is not open: ${resolved}. Open it first.` };
    }
    const lineCount = editor.document.lineCount;
    if (endLine > lineCount) {
      return { error: `Line ${endLine} is out of range (file has ${lineCount} lines)` };
    }
    const decorType = vscode.window.createTextEditorDecorationType({ backgroundColor: color });
    const range = new vscode.Range(
      new vscode.Position(startLine - 1, 0),
      new vscode.Position(endLine - 1, 0),
    );
    editor.setDecorations(decorType, [range]);
    const decorationId = `accordo-decoration-${++decorationCounter}`;
    decorationStore.set(decorationId, { type: decorType, editor });
    return { highlighted: true, decorationId };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

// ── §4.5 accordo.editor.clearHighlights ──────────────────────────────────────

/**
 * Remove highlight decorations created by accordo.editor.highlight.
 *
 * @param args.decorationId - Optional. Clear only this decoration. Omit → clear all.
 */
export async function clearHighlightsHandler(
  args: Record<string, unknown>,
): Promise<{ cleared: true; count: number } | { error: string }> {
  try {
    const decorationId = argStringOpt(args, "decorationId");
    if (decorationId !== undefined) {
      const entry = decorationStore.get(decorationId);
      if (!entry) {
        return { error: `Decoration not found: ${decorationId}` };
      }
      entry.type.dispose();
      decorationStore.delete(decorationId);
      return { cleared: true, count: 1 };
    }
    const count = decorationStore.size;
    for (const { type } of decorationStore.values()) {
      type.dispose();
    }
    decorationStore.clear();
    return { cleared: true, count };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

// ── §4.6 accordo.editor.split ────────────────────────────────────────────────

/**
 * Split the editor in a given direction.
 *
 * @param args.direction - Required. "right" | "down".
 */
export async function splitHandler(
  args: Record<string, unknown>,
): Promise<{ groups: number } | { error: string }> {
  try {
    const direction = argString(args, "direction");
    const command =
      direction === "right"
        ? "workbench.action.splitEditorRight"
        : "workbench.action.splitEditorDown";
    await vscode.commands.executeCommand(command);
    return { groups: vscode.window.tabGroups.all.length };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

// ── §4.7 accordo.editor.focus ────────────────────────────────────────────────

/**
 * Focus a specific editor group by 1-based group number.
 *
 * @param args.group - Required. Group number (1-based, up to 9).
 */
export async function focusGroupHandler(
  args: Record<string, unknown>,
): Promise<{ focused: true; group: number } | { error: string }> {
  try {
    const group = argNumber(args, "group");
    const total = vscode.window.tabGroups.all.length;
    if (group < 1 || group > total) {
      return { error: `Editor group ${group} does not exist (max: ${total})` };
    }
    await vscode.commands.executeCommand(FOCUS_COMMANDS[group - 1]);
    return { focused: true, group };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

// ── §4.8 accordo.editor.reveal ───────────────────────────────────────────────

/**
 * Reveal a file in the Explorer sidebar without opening it in the editor.
 *
 * @param args.path - Required. File path to reveal.
 */
export async function revealHandler(
  args: Record<string, unknown>,
): Promise<{ revealed: true; path: string } | { error: string }> {
  try {
    const p = argString(args, "path");
    const resolved = resolvePath(p);
    const uri = vscode.Uri.file(resolved);
    try {
      await vscode.workspace.fs.stat(uri);
    } catch {
      return { error: `File not found: ${resolved}` };
    }
    await vscode.commands.executeCommand("revealInExplorer", uri);
    return { revealed: true, path: resolved };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

// ── §4.17 accordo.editor.save ────────────────────────────────────────────────

/**
 * Save a specific file, or the active editor if no path given.
 *
 * @param args.path - Optional. File to save. Omit → save active editor.
 */
export async function saveHandler(
  args: Record<string, unknown>,
): Promise<{ saved: true; path: string } | { error: string }> {
  try {
    const p = argStringOpt(args, "path");
    if (!p) {
      if (!vscode.window.activeTextEditor) {
        return { error: "No active editor to save" };
      }
      await vscode.commands.executeCommand("workbench.action.files.save");
      return { saved: true, path: vscode.window.activeTextEditor.document.uri.fsPath };
    }
    const resolved = resolvePath(p);
    const targetFsPath = vscode.Uri.file(resolved).fsPath;
    const doc = vscode.workspace.textDocuments.find(
      (d) => d.uri.fsPath === targetFsPath,
    );
    if (!doc) {
      return { error: `File is not open: ${resolved}` };
    }
    await doc.save();
    return { saved: true, path: resolved };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

// ── §4.18 accordo.editor.saveAll ─────────────────────────────────────────────

/**
 * Save all modified editors. Returns how many were saved.
 */
export async function saveAllHandler(
  _args: Record<string, unknown>,
): Promise<{ saved: true; count: number } | { error: string }> {
  try {
    const count = vscode.workspace.textDocuments.filter((d) => d.isDirty).length;
    await vscode.commands.executeCommand("workbench.action.files.saveAll");
    return { saved: true, count };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

// ── §4.19 accordo.editor.format ──────────────────────────────────────────────

/**
 * Format the active document (or a specific file's open editor).
 *
 * @param args.path - Optional. File whose editor to format. Omit → active editor.
 */
export async function formatHandler(
  args: Record<string, unknown>,
): Promise<{ formatted: true; path: string } | { error: string }> {
  try {
    const p = argStringOpt(args, "path");
    if (!p) {
      if (!vscode.window.activeTextEditor) {
        return { error: "No active editor to format" };
      }
      await vscode.commands.executeCommand("editor.action.formatDocument");
      return { formatted: true, path: vscode.window.activeTextEditor.document.uri.fsPath };
    }
    const resolved = resolvePath(p);
    const targetFsPath = vscode.Uri.file(resolved).fsPath;
    const editor = vscode.window.visibleTextEditors.find(
      (e) => e.document.uri.fsPath === targetFsPath,
    );
    if (!editor) {
      return { error: `File is not open: ${resolved}. Open it first.` };
    }
    // §4.19: focus it, then format
    await vscode.window.showTextDocument(vscode.Uri.file(resolved));
    await vscode.commands.executeCommand("editor.action.formatDocument");
    return { formatted: true, path: resolved };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

// ── Tool definitions (Module 16 + Module 17) ─────────────────────────────────

/** All editor tool definitions for modules 16 and 17. */
export const editorTools: ExtensionToolDefinition[] = [
  // ── Module 16 ──────────────────────────────────────────────────────────────
  {
    name: "accordo.editor.open",
    group: "editor",
    description: "Open a file in the editor, optionally scrolling to a line/column.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path, relative to workspace root or absolute" },
        line: { type: "number", description: "Line number to scroll to (1-based). Default: 1" },
        column: { type: "number", description: "Column number to place cursor (1-based). Default: 1" },
      },
      required: ["path"],
    },
    dangerLevel: "safe",
    idempotent: true,
    handler: wrapHandler("accordo.editor.open", openHandler),
  },
  {
    name: "accordo.editor.close",
    group: "editor",
    description: "Close a specific editor tab, or the active editor if no path given.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path to close. If omitted, closes the active editor." },
      },
      required: [],
    },
    dangerLevel: "safe",
    idempotent: true,
    handler: wrapHandler("accordo.editor.close", closeHandler),
  },
  {
    name: "accordo.editor.scroll",
    group: "editor",
    description: "Scroll the active editor viewport up or down by line or page.",
    inputSchema: {
      type: "object",
      properties: {
        direction: { type: "string", enum: ["up", "down"], description: "Scroll direction" },
        by: { type: "string", enum: ["line", "page"], description: "Scroll unit. Default: page" },
      },
      required: ["direction"],
    },
    dangerLevel: "safe",
    idempotent: false,
    handler: wrapHandler("accordo.editor.scroll", scrollHandler),
  },
  {
    name: "accordo.editor.split",
    group: "editor",
    description: "Split the editor pane right or down.",
    inputSchema: {
      type: "object",
      properties: {
        direction: { type: "string", enum: ["right", "down"], description: "Direction to split" },
      },
      required: ["direction"],
    },
    dangerLevel: "safe",
    idempotent: false,
    handler: wrapHandler("accordo.editor.split", splitHandler),
  },
  {
    name: "accordo.editor.focus",
    group: "editor",
    description: "Focus a specific editor group by 1-based group number.",
    inputSchema: {
      type: "object",
      properties: {
        group: { type: "number", description: "Editor group number (1-based)" },
      },
      required: ["group"],
    },
    dangerLevel: "safe",
    idempotent: true,
    handler: wrapHandler("accordo.editor.focus", focusGroupHandler),
  },
  {
    name: "accordo.editor.reveal",
    group: "editor",
    description: "Reveal a file in the Explorer sidebar without opening it.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path to reveal in Explorer" },
      },
      required: ["path"],
    },
    dangerLevel: "safe",
    idempotent: true,
    handler: wrapHandler("accordo.editor.reveal", revealHandler),
  },
  // ── Module 17 ──────────────────────────────────────────────────────────────
  {
    name: "accordo.editor.highlight",
    group: "editor",
    description: "Apply a colored background highlight to a range of lines.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path containing the lines to highlight" },
        startLine: { type: "number", description: "First line to highlight (1-based, inclusive)" },
        endLine: { type: "number", description: "Last line to highlight (1-based, inclusive)" },
        color: { type: "string", description: "Highlight background color. Default: rgba(255,255,0,0.3)" },
      },
      required: ["path", "startLine", "endLine"],
    },
    dangerLevel: "safe",
    idempotent: true,
    handler: wrapHandler("accordo.editor.highlight", highlightHandler),
  },
  {
    name: "accordo.editor.clearHighlights",
    group: "editor",
    description: "Remove highlight decorations created by accordo.editor.highlight.",
    inputSchema: {
      type: "object",
      properties: {
        decorationId: { type: "string", description: "Clear only this decoration. Omit to clear all." },
      },
      required: [],
    },
    dangerLevel: "safe",
    idempotent: true,
    handler: wrapHandler("accordo.editor.clearHighlights", clearHighlightsHandler),
  },
  {
    name: "accordo.editor.save",
    group: "editor",
    description: "Save a specific file, or the active editor if no path given.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path to save. If omitted, saves the active editor." },
      },
      required: [],
    },
    dangerLevel: "safe",
    idempotent: true,
    handler: wrapHandler("accordo.editor.save", saveHandler),
  },
  {
    name: "accordo.editor.saveAll",
    group: "editor",
    description: "Save all modified (unsaved) editors.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
    dangerLevel: "safe",
    idempotent: true,
    handler: wrapHandler("accordo.editor.saveAll", saveAllHandler),
  },
  {
    name: "accordo.editor.format",
    group: "editor",
    description: "Format the active document or a specific file using the configured formatter.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path to format. If omitted, formats the active editor." },
      },
      required: [],
    },
    dangerLevel: "safe",
    idempotent: true,
    handler: wrapHandler("accordo.editor.format", formatHandler),
  },
  {
    name: "accordo.editor.discover",
    description: "Returns full schemas for all 11 editor tools: open, close, scroll, split, focus, reveal, highlight, clearHighlights, save, saveAll, format.",
    inputSchema: { type: "object", properties: {}, required: [] },
    dangerLevel: "safe",
    idempotent: true,
    handler: async () => ({
      group: "editor",
      tools: editorTools
        .filter(t => t.group === "editor")
        .map(({ name, description, inputSchema, dangerLevel, idempotent, requiresConfirmation }) => ({ name, description, inputSchema, dangerLevel, idempotent, requiresConfirmation })),
    }),
  },
];
