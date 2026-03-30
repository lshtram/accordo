/**
 * voice-ui-adapter.ts — VSCode UI abstraction layer.
 *
 * This is the ONLY vscode-importing module in the voice package.
 * All other voice modules depend only on VoiceUiAdapter (dependency injection).
 *
 * M50-EXT (runtime split)
 */

import * as vscode from "vscode";

/**
 * Dependency injection interface for all VSCode UI calls made by voice-runtime.
 * voice-runtime.ts depends only on this interface — never on vscode directly.
 */
export interface VoiceUiAdapter {
  executeCommand(command: string, ...args: unknown[]): Promise<unknown>;
  showWarningMessage(message: string): Promise<string | undefined>;
  showErrorMessage(message: string): Promise<string | undefined>;
  activeTextEditor(): import("vscode").TextEditor | undefined;
  insertAtEditor(editor: import("vscode").TextEditor, text: string): Promise<boolean>;
}

/**
 * Creates a VoiceUiAdapter backed by real vscode APIs.
 * Call this once in extension.ts and pass the result into VoiceRuntimeDeps.
 */
export function createVsCodeUiAdapter(): VoiceUiAdapter {
  return {
    executeCommand: (cmd, ...args) => Promise.resolve(vscode.commands.executeCommand(cmd, ...args)),
    showWarningMessage: (msg) => Promise.resolve(vscode.window.showWarningMessage(msg)),
    showErrorMessage: (msg) => Promise.resolve(vscode.window.showErrorMessage(msg)),
    activeTextEditor: () => vscode.window.activeTextEditor,
    insertAtEditor: async (editor, text) => {
      try {
        await editor.edit((b) => b.insert(editor.selection.active, text));
        return true;
      } catch {
        return false;
      }
    },
  };
}
