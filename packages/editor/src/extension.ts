/**
 * accordo-editor — VSCode Extension Entry Point
 *
 * Activates by acquiring the BridgeAPI from accordo-bridge and registering
 * all 22 editor/terminal/workspace/layout tools.
 *
 * If accordo-bridge is not installed, the extension is silently inert.
 *
 * Requirements: requirements-editor.md §2, §3
 */

import * as vscode from "vscode";
import type { ExtensionToolDefinition } from "@accordo/bridge-types";
import { editorTools } from "./tools/editor.js";
import { terminalTools } from "./tools/terminal.js";
import { workspaceTools } from "./tools/workspace.js";
import { layoutTools } from "./tools/layout.js";

// ── BridgeAPI (minimal interface — full type lives in accordo-bridge) ─────────

/** Subset of accordo-bridge BridgeAPI used by this extension. */
interface BridgeAPI {
  registerTools(
    extensionId: string,
    tools: ExtensionToolDefinition[],
  ): vscode.Disposable;
}

// ── All 22 tools ──────────────────────────────────────────────────────────────

const allTools: ExtensionToolDefinition[] = [
  ...editorTools,
  ...terminalTools,
  ...workspaceTools,
  ...layoutTools,
];

// ── activate ──────────────────────────────────────────────────────────────────

/**
 * Called by VS Code when the extension activates (onStartupFinished).
 *
 * REQ §3: If Bridge is absent, return silently — do not throw.
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const bridge = vscode.extensions.getExtension<BridgeAPI>(
    "accordo.accordo-bridge",
  )?.exports;

  if (!bridge) {
    // Bridge not installed or not yet exported — extension is inert.
    return;
  }

  const disposable = bridge.registerTools("accordo.accordo-editor", allTools);
  context.subscriptions.push(disposable);
}

// ── deactivate ────────────────────────────────────────────────────────────────

/** Called by VS Code when the extension host is being shut down. */
export function deactivate(): void {
  // Subscriptions added to context.subscriptions are disposed automatically.
  // Nothing extra needed here.
}
