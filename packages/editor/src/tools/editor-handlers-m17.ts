/**
 * Editor tool handlers — Module 17 (highlight, save, format).
 *
 * Implements tools from requirements-editor.md §4:
 *   Module 17: §4.4 highlight, §4.5 clearHighlights,
 *              §4.17 save, §4.18 saveAll, §4.19 format
 *
 * Kept separate from editor-handlers.ts to stay within the 300 LOC limit.
 */

import * as vscode from "vscode";
import { resolvePath, errorMessage } from "../util.js";
import {
  argString,
  argStringOpt,
  argNumber,
  decorationStore,
  nextDecorationId,
} from "./editor-utils.js";

// ── §4.4 accordo_editor_highlight ────────────────────────────────────────────

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
    const decorationId = nextDecorationId();
    decorationStore.set(decorationId, { type: decorType, editor });
    return { highlighted: true, decorationId };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

// ── §4.5 accordo_editor_clearHighlights ──────────────────────────────────────

/**
 * Remove highlight decorations created by accordo_editor_highlight.
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

// ── §4.17 accordo_editor_save ────────────────────────────────────────────────

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

// ── §4.18 accordo_editor_saveAll ─────────────────────────────────────────────

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

// ── §4.19 accordo_editor_format ──────────────────────────────────────────────

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
