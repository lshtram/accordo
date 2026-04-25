/**
 * accordo-editor — VSCode Extension Entry Point
 *
 * Activates by acquiring the BridgeAPI from accordo-bridge and registering
 * all 23 editor/terminal/layout tools.
 *
 * If accordo-bridge is not installed, the extension is silently inert.
 *
 * Requirements: requirements-editor.md §2, §3
 */

import * as vscode from "vscode";
import type { ExtensionToolDefinition, IDEState } from "@accordo/bridge-types";
import type * as EditorHandlers from "./tools/editor-handlers.js";
import type * as TerminalHandlers from "./tools/terminal.js";
import type * as LayoutHandlers from "./tools/layout.js";
import type * as BarHandlers from "./tools/bar.js";
import { editorTools } from "./tools/editor.js";
import {
  terminalTools,
  registerTerminalLifecycle,
} from "./tools/terminal.js";
import { createLayoutTools } from "./tools/layout.js";
import {
  registerEditorCommandShims,
  registerTerminalCommandShims,
  registerLayoutCommandShims,
  registerVscodeCommandShims,
} from "./tools/command-shims.js";
import { vscodeCommandTools } from "./tools/vscode-command-tools.js";
import { initVscodeCommandGateway } from "./tools/vscode-command-stubs.js";
import { createVsCodeCommandGatewayDeps } from "./tools/vscode-command-vscode-deps.js";

// ── BridgeAPI ─────────────────────────────────────────────────────────────

interface BridgeAPI {
  registerTools(
    extensionId: string,
    tools: ExtensionToolDefinition[],
  ): vscode.Disposable;
  getState(): IDEState;
}

async function getBridgeApi(): Promise<BridgeAPI | undefined> {
  return vscode.extensions.getExtension<BridgeAPI>("accordo.accordo-bridge")?.exports;
}

function buildToolList(getState: () => IDEState): ExtensionToolDefinition[] {
  return [...editorTools, ...terminalTools, ...vscodeCommandTools, ...createLayoutTools(getState)];
}

async function registerAllCommandShims(
  context: vscode.ExtensionContext,
  getState: () => IDEState,
): Promise<void> {
  const editorHandlers = await import("./tools/editor-handlers.js");
  const terminalHandlers = await import("./tools/terminal.js");
  const layoutHandlers = await import("./tools/layout.js");
  const barHandlers = await import("./tools/bar.js");
  const gatewayHandlers = await import("./tools/vscode-command-stubs.js");
  registerEditorShims(context, editorHandlers);
  registerTerminalShims(context, terminalHandlers);
  registerLayoutShims(context, getState, layoutHandlers, barHandlers);
  registerVscodeCommandShims(
    context,
    gatewayHandlers.vscodeCommandListHandler,
    gatewayHandlers.vscodeCommandExecuteHandler,
  );
}

function registerEditorShims(
  context: vscode.ExtensionContext,
  handlers: typeof EditorHandlers,
): void {
  registerEditorCommandShims(context, {
    openHandler: handlers.openHandler,
    closeHandler: handlers.closeHandler,
    scrollHandler: handlers.scrollHandler,
    focusGroupHandler: handlers.focusGroupHandler,
    highlightHandler: handlers.highlightHandler,
    clearHighlightsHandler: handlers.clearHighlightsHandler,
  });
}

function registerTerminalShims(
  context: vscode.ExtensionContext,
  handlers: typeof TerminalHandlers,
): void {
  registerTerminalCommandShims(context, {
    terminalOpenHandler: handlers.terminalOpenHandler,
    terminalRunHandler: handlers.terminalRunHandler,
    terminalFocusHandler: handlers.terminalFocusHandler,
    terminalListHandler: handlers.terminalListHandler,
    terminalCloseHandler: handlers.terminalCloseHandler,
  });
}

function registerLayoutShims(
  context: vscode.ExtensionContext,
  getState: () => IDEState,
  layoutHandlers: typeof LayoutHandlers,
  barHandlers: typeof BarHandlers,
): void {
  registerLayoutCommandShims(context, {
    panelToggleHandler: layoutHandlers.panelToggleHandler,
    layoutStateHandler: layoutHandlers.layoutStateHandler,
    layoutPanelHandler: barHandlers.layoutPanelHandler,
  }, getState);
}

// ── activate ──────────────────────────────────────────────────────────────

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  registerTerminalLifecycle(context);
  const bridge = await getBridgeApi();
  if (!bridge) return;

  const getState = (): IDEState => bridge.getState();
  initVscodeCommandGateway(createVsCodeCommandGatewayDeps());
  const allTools = buildToolList(getState);
  context.subscriptions.push(bridge.registerTools("accordo.accordo-editor", allTools));
  await registerAllCommandShims(context, getState);
}

// ── deactivate ────────────────────────────────────────────────────────────

export function deactivate(): void { /* subscriptions auto-disposed */ }
