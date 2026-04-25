/**
 * Editor tool handlers — Module 17 (highlight, clearHighlights).
 *
 * Implements tools from requirements-editor.md §4:
 *   Module 17: §4.4 highlight, §4.5 clearHighlights
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
