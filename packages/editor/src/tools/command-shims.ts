/**
 * Command shim registration helpers for extension.ts.
 * Extracted to keep activate() focused.
 *
 * Requirements: requirements-editor.md §2, §3
 */

import * as vscode from "vscode";
import type { IDEState } from "@accordo/bridge-types";
import type { ExtensionToolDefinition } from "@accordo/bridge-types";

// ── command shim helpers ───────────────────────────────────────────────────────

export function makeCommandShim(
  id: string,
  fn: (args: Record<string, unknown>) => unknown,
): vscode.Disposable {
  return vscode.commands.registerCommand(id, (args: unknown) =>
    fn((args as Record<string, unknown> | undefined) ?? {}),
  );
}

// ── Editor tool shims ─────────────────────────────────────────────────────────

export function registerEditorCommandShims(
  context: vscode.ExtensionContext,
  handlers: {
    openHandler: (args: Record<string, unknown>) => unknown;
    closeHandler: (args: Record<string, unknown>) => unknown;
    focusGroupHandler: (args: Record<string, unknown>) => unknown;
    highlightHandler: (args: Record<string, unknown>) => unknown;
    clearHighlightsHandler: (args: Record<string, unknown>) => unknown;
  },
): void {
  context.subscriptions.push(
    makeCommandShim("accordo_editor_open",           handlers.openHandler),
    makeCommandShim("accordo_editor_close",           handlers.closeHandler),
    makeCommandShim("accordo_editor_focus",          handlers.focusGroupHandler),
    makeCommandShim("accordo_editor_highlight",      handlers.highlightHandler),
    makeCommandShim("accordo_editor_clearHighlights", handlers.clearHighlightsHandler),
  );
}

// ── VSCode command gateway shims ─────────────────────────────────────────────

export function registerVscodeCommandShims(
  context: vscode.ExtensionContext,
  vscodeCommandListHandler: (args: Record<string, unknown>) => Promise<unknown>,
  vscodeCommandExecuteHandler: (args: Record<string, unknown>) => Promise<unknown>,
): void {
  context.subscriptions.push(
    makeCommandShim("accordo_vscode_command_list",   vscodeCommandListHandler as (args: Record<string, unknown>) => unknown),
    makeCommandShim("accordo_vscode_command_execute", vscodeCommandExecuteHandler as (args: Record<string, unknown>) => unknown),
  );
}

// ── Terminal tool shims ──────────────────────────────────────────────────────

// Re-export terminal handlers so command-shims can import them directly
export {
  terminalOpenHandler,
  terminalRunHandler,
  terminalFocusHandler,
  terminalListHandler,
  terminalCloseHandler,
} from "./terminal.js";

export function registerTerminalCommandShims(
  context: vscode.ExtensionContext,
  handlers: {
    terminalOpenHandler: (args: Record<string, unknown>) => unknown;
    terminalRunHandler: (args: Record<string, unknown>) => unknown;
    terminalFocusHandler: (args: Record<string, unknown>) => unknown;
    terminalListHandler: (args: Record<string, unknown>) => unknown;
    terminalCloseHandler: (args: Record<string, unknown>) => unknown;
    terminalReadHandler: (args: Record<string, unknown>) => unknown;
  },
): void {
  context.subscriptions.push(
    makeCommandShim("accordo_terminal_open",   handlers.terminalOpenHandler),
    makeCommandShim("accordo_terminal_run",    handlers.terminalRunHandler),
    makeCommandShim("accordo_terminal_focus", handlers.terminalFocusHandler),
    makeCommandShim("accordo_terminal_list",   handlers.terminalListHandler),
    makeCommandShim("accordo_terminal_close",  handlers.terminalCloseHandler),
    makeCommandShim("accordo_terminal_read",   handlers.terminalReadHandler),
  );
}

// ── Layout tool shims ─────────────────────────────────────────────────────────

// Re-export layout handlers so command-shims can import them directly
export {
  layoutStateHandler,
} from "./layout.js";
export { layoutPanelHandler } from "./bar.js";

export function registerLayoutCommandShims(
  context: vscode.ExtensionContext,
  handlers: {
    layoutStateHandler: (args: Record<string, unknown>, getState: () => IDEState) => unknown;
    layoutPanelHandler: (args: Record<string, unknown>) => unknown;
  },
  getState: () => IDEState,
): void {
  context.subscriptions.push(
    makeCommandShim("accordo_layout_state",          (args) => handlers.layoutStateHandler(args, getState)),
    makeCommandShim("accordo_layout_panel",         handlers.layoutPanelHandler),
  );
}
