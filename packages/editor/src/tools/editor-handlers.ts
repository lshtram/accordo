/**
 * Editor tool handlers — Module 16 (open, close, scroll, split, focus, reveal).
 *
 * Implements tools from requirements-editor.md §4:
 *   Module 16: §4.1 open, §4.2 close, §4.3 scroll, §4.6 split,
 *              §4.7 focus (group), §4.8 reveal
 *
 * Module 17 handlers (highlight, clearHighlights, save, saveAll, format) live
 * in editor-handlers-m17.ts and are re-exported here so consumers only need
 * one import path.
 */

import * as vscode from "vscode";
import { resolvePath, errorMessage } from "../util.js";
import {
  argString,
  argStringOpt,
  argNumber,
  argNumberOpt,
  _clearDecorationStore,
  FOCUS_COMMANDS,
} from "./editor-utils.js";

// Re-export helpers so existing test imports from "editor-handlers.js" keep working.
export {
  argString,
  argStringOpt,
  argNumber,
  argNumberOpt,
  _clearDecorationStore,
};

// Re-export Module 17 handlers — consumers import all handlers from this one file.
export {
  highlightHandler,
  clearHighlightsHandler,
  saveHandler,
  saveAllHandler,
  formatHandler,
} from "./editor-handlers-m17.js";

// ── §4.1 accordo_editor_open ─────────────────────────────────────────────────

/**
 * Open a file in the editor, optionally scrolling to a line/column.
 *
 * .md files are automatically opened in the Accordo markdown preview
 * ("accordo.markdownPreview" custom editor) when the md-viewer extension
 * is installed. Non-.md files open in the standard text editor.
 *
 * @param args.path - Required. File path (relative or absolute).
 * @param args.line - Optional. 1-based line number. Default: 1.
 * @param args.column - Optional. 1-based column. Default: 1.
 */
export async function openHandler(
  args: Record<string, unknown>,
): Promise<{ opened: true; path: string; surface: "editor" | "preview" | "diagram" } | { error: string }> {
  try {
    const p = argString(args, "path");
    const line = argNumberOpt(args, "line", 1);
    const column = argNumberOpt(args, "column", 1);
    const resolved = resolvePath(p);
    const uri = vscode.Uri.file(resolved);
    const position = new vscode.Position(line - 1, column - 1);

    if (resolved.endsWith(".md")) {
      // Open .md files in the Accordo markdown preview (if md-viewer is installed).
      // Falls back to standard text editor if the custom editor is not available.
      await vscode.commands.executeCommand("vscode.openWith", uri, "accordo.markdownPreview");
      return { opened: true, path: resolved, surface: "preview" };
    }

    if (resolved.endsWith(".mmd")) {
      // Open .mmd files in the Accordo diagram viewer.
      await vscode.commands.executeCommand("accordo-diagram.open", uri);
      return { opened: true, path: resolved, surface: "diagram" };
    }

    const range = new vscode.Range(position, position);
    await vscode.window.showTextDocument(uri, { selection: range });
    return { opened: true, path: resolved, surface: "editor" };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

// ── §4.2 accordo_editor_close ────────────────────────────────────────────────

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

// ── §4.3 accordo_editor_scroll ───────────────────────────────────────────────

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

// ── §4.6 accordo_editor_split ────────────────────────────────────────────────

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

// ── §4.7 accordo_editor_focus ────────────────────────────────────────────────

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

// ── §4.8 accordo_editor_reveal ───────────────────────────────────────────────

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
