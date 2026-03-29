/**
 * accordo-comments — VSCode Extension Entry Point
 *
 * Thin shell that delegates to comments-bootstrap.ts.
 * VS Code requires this module to export `activate` and `deactivate`.
 *
 * Source: comments-architecture.md §10
 */

import type * as vscode from "vscode";
import { activate as bootstrapActivate, deactivate as bootstrapDeactivate } from "./comments-bootstrap.js";

// Re-export types consumed by tests and inter-extension callers
export type { BridgeAPI, SurfaceCommentAdapter, CommentsExtensionExports } from "./comments-bootstrap.js";

/**
 * Called by VS Code when the extension activates (onStartupFinished).
 */
export async function activate(
  context: vscode.ExtensionContext,
): ReturnType<typeof bootstrapActivate> {
  return bootstrapActivate(context);
}

/**
 * Called by VS Code when the extension host is being shut down.
 */
export function deactivate(): void {
  bootstrapDeactivate();
}
