/**
 * Accordo Bridge — VSCode Adapter
 *
 * Thin adapter that wraps the raw `vscode` module API into the
 * editor-agnostic HostEnvironment interface consumed by StatePublisher.
 *
 * This module is the ONLY place in accordo-bridge that imports `vscode`
 * at runtime (vscode-api.ts is the mockable counterpart for tests).
 *
 * Requirements: requirements-bridge.md §2, §4
 */

import * as vscode from "vscode";
import type {
  HostEnvironment,
  TextEditor,
  Terminal,
  TabGroup,
  WorkspaceFolder,
} from "./state-collector.js";

/**
 * Build the HostEnvironment object that bridges the real VSCode API
 * to the editor-agnostic interface expected by StatePublisher.
 *
 * Exported for reuse in tests (extension-bootstrap.test.ts).
 */
export function createVsCodeApi(): HostEnvironment {
  return {
    window: {
      get activeTextEditor(): TextEditor | undefined {
        return vscode.window.activeTextEditor as TextEditor | undefined;
      },
      get visibleTextEditors(): readonly TextEditor[] {
        return vscode.window.visibleTextEditors as readonly TextEditor[];
      },
      get activeTerminal(): Terminal | undefined {
        return vscode.window.activeTerminal as Terminal | undefined;
      },
      onDidChangeActiveTextEditor: (l) =>
        vscode.window.onDidChangeActiveTextEditor(
          l as (e: vscode.TextEditor | undefined) => void,
        ),
      onDidChangeVisibleTextEditors: (l) =>
        vscode.window.onDidChangeVisibleTextEditors(
          l as (e: readonly vscode.TextEditor[]) => void,
        ),
      onDidChangeTextEditorSelection: (l) =>
        vscode.window.onDidChangeTextEditorSelection(
          l as (e: vscode.TextEditorSelectionChangeEvent) => void,
        ),
      onDidChangeActiveTerminal: (l) =>
        vscode.window.onDidChangeActiveTerminal(
          l as (e: vscode.Terminal | undefined) => void,
        ),
      tabGroups: {
        get all(): readonly TabGroup[] {
          return vscode.window.tabGroups.all as readonly TabGroup[];
        },
        onDidChangeTabGroups: (l) =>
          vscode.window.tabGroups.onDidChangeTabGroups(
            l as (e: vscode.TabGroupChangeEvent) => void,
          ),
        onDidChangeTabs: (l) =>
          vscode.window.tabGroups.onDidChangeTabs(
            l as (e: vscode.TabChangeEvent) => void,
          ),
      },
    },
    workspace: {
      get workspaceFolders(): readonly WorkspaceFolder[] | undefined {
        return vscode.workspace.workspaceFolders as
          | readonly WorkspaceFolder[]
          | undefined;
      },
      get name(): string | undefined {
        return vscode.workspace.name;
      },
      onDidChangeWorkspaceFolders: (l) =>
        vscode.workspace.onDidChangeWorkspaceFolders(
          l as (e: vscode.WorkspaceFoldersChangeEvent) => void,
        ),
    },
    env: {
      get remoteName(): string | undefined {
        return vscode.env.remoteName;
      },
    },
  };
}

/**
 * Creates the tool-confirmation dialog function shown before running
 * tools that request user approval.
 *
 * Exported for reuse in tests (extension-bootstrap.test.ts).
 */
export function createConfirmationFn(): (
  toolName: string,
  args: Record<string, unknown>,
) => Promise<boolean> {
  return async (
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<boolean> => {
    const answer = await vscode.window.showWarningMessage(
      `Allow tool "${toolName}" to run?`,
      { modal: true, detail: JSON.stringify(args, null, 2) },
      "Allow",
    );
    return answer === "Allow";
  };
}
