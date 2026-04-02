/**
 * accordo-editor — VSCode Extension Entry Point
 *
 * Activates by acquiring the BridgeAPI from accordo-bridge and registering
 * all 21 editor/terminal/layout tools.
 *
 * If accordo-bridge is not installed, the extension is silently inert.
 *
 * Requirements: requirements-editor.md §2, §3
 */

import * as vscode from "vscode";
import type { ExtensionToolDefinition, IDEState } from "@accordo/bridge-types";
import { editorTools } from "./tools/editor.js";
import {
  terminalTools,
  registerTerminalLifecycle,
  terminalOpenHandler,
  terminalRunHandler,
  terminalFocusHandler,
  terminalListHandler,
  terminalCloseHandler,
} from "./tools/terminal.js";
import {
  createLayoutTools,
  panelToggleHandler,
  layoutZenHandler,
  layoutFullscreenHandler,
  layoutJoinGroupsHandler,
  layoutEvenGroupsHandler,
  layoutStateHandler,
} from "./tools/layout.js";
import { layoutPanelHandler } from "./tools/bar.js";
import {
  openHandler,
  closeHandler,
  scrollHandler,
  splitHandler,
  focusGroupHandler,
  revealHandler,
  highlightHandler,
  clearHighlightsHandler,
  saveHandler,
  saveAllHandler,
  formatHandler,
} from "./tools/editor-handlers.js";

// ── BridgeAPI (minimal interface — full type lives in accordo-bridge) ─────────

/** Subset of accordo-bridge BridgeAPI used by this extension. */
interface BridgeAPI {
  registerTools(
    extensionId: string,
    tools: ExtensionToolDefinition[],
  ): vscode.Disposable;
  getState(): IDEState;
}

// ── All tools ────────────────────────────────────────────────────────────

// Static tools (no Bridge state dependency)
const staticTools: ExtensionToolDefinition[] = [
  ...editorTools,
  ...terminalTools,
];

// ── activate ──────────────────────────────────────────────────────────────────

/**
 * Called by VS Code when the extension activates (onStartupFinished).
 *
 * REQ §3: If Bridge is absent, return silently — do not throw.
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  // Register terminal lifecycle listener regardless of Bridge presence (§5.3)
  registerTerminalLifecycle(context);

  const bridge = vscode.extensions.getExtension<BridgeAPI>(
    "accordo.accordo-bridge",
  )?.exports;

  if (!bridge) {
    // Bridge not installed or not yet exported — extension is inert.
    return;
  }

  const allTools: ExtensionToolDefinition[] = [
    ...staticTools,
    ...createLayoutTools(() => bridge.getState()),
  ];

  const disposable = bridge.registerTools("accordo.accordo-editor", allTools);
  context.subscriptions.push(disposable);

  // Register all editor/terminal/layout tools as VS Code commands so the
  // NarrationScript runner (accordo_script_run "command" steps) can invoke
  // them via vscode.commands.executeCommand, even when the MCP Hub is not
  // connected. Each command passes its args directly to the tool handler.
  const cmd = (id: string, fn: (args: Record<string, unknown>) => unknown): vscode.Disposable =>
    vscode.commands.registerCommand(id, (args: unknown) =>
      fn((args as Record<string, unknown> | undefined) ?? {}),
    );

  const getState = (): IDEState => bridge.getState();

  context.subscriptions.push(
    // ── Editor tools ──
    cmd("accordo_editor_open",           openHandler),
    cmd("accordo_editor_close",          closeHandler),
    cmd("accordo_editor_scroll",         scrollHandler),
    cmd("accordo_editor_split",          splitHandler),
    cmd("accordo_editor_focus",          focusGroupHandler),
    cmd("accordo_editor_reveal",         revealHandler),
    cmd("accordo_editor_highlight",      highlightHandler),
    cmd("accordo_editor_clearHighlights", clearHighlightsHandler),
    cmd("accordo_editor_save",           saveHandler),
    cmd("accordo_editor_saveAll",        saveAllHandler),
    cmd("accordo_editor_format",         formatHandler),
    // ── Terminal tools ──
    cmd("accordo_terminal_open",         terminalOpenHandler),
    cmd("accordo_terminal_run",          terminalRunHandler),
    cmd("accordo_terminal_focus",        terminalFocusHandler),
    cmd("accordo_terminal_list",         terminalListHandler),
    cmd("accordo_terminal_close",        terminalCloseHandler),
    // ── Layout tools ──
    cmd("accordo_panel_toggle",          panelToggleHandler),
    cmd("accordo_layout_zen",            layoutZenHandler),
    cmd("accordo_layout_fullscreen",     layoutFullscreenHandler),
    cmd("accordo_layout_joinGroups",     layoutJoinGroupsHandler),
    cmd("accordo_layout_evenGroups",     layoutEvenGroupsHandler),
    cmd("accordo_layout_state",          (args) => layoutStateHandler(args, getState)),
    cmd("accordo_layout_panel",          layoutPanelHandler),
  );
}

// ── deactivate ────────────────────────────────────────────────────────────────

/** Called by VS Code when the extension host is being shut down. */
export function deactivate(): void {
  // Subscriptions added to context.subscriptions are disposed automatically.
  // Nothing extra needed here.
}
