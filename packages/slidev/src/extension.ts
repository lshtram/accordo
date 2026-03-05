/**
 * accordo-slidev — VS Code Extension Entry Point
 *
 * Activates by acquiring BridgeAPI from accordo-bridge and wiring:
 * - PresentationStateContribution (modality state → Hub)
 * - PresentationProvider (WebviewPanel + Slidev process)
 * - SurfaceCommentAdapter (from accordo-comments getSurfaceAdapter)
 * - PresentationTools (9 MCP tools registered via BridgeAPI)
 *
 * If accordo-bridge is not installed, the extension is inert.
 * If accordo-comments is unavailable, presentation works without comments (M44-EXT-06).
 *
 * Source: requirements-slidev.md §4 M44-EXT
 *
 * Requirements:
 *   M44-EXT-01  Activates Bridge dependency and acquires BridgeAPI exports
 *   M44-EXT-02  Registers all presentation tools
 *   M44-EXT-03  Creates WebviewPanel on demand (via open tool), not via custom editor provider
 *   M44-EXT-04  Acquires comments surface adapter via getSurfaceAdapter when available
 *   M44-EXT-05  Publishes initial modality state via bridge.publishState
 *   M44-EXT-06  If comments extension unavailable, presentation works without comments
 *   M44-EXT-07  Only one presentation session at a time
 */

import * as vscode from "vscode";
import type { SurfaceAdapterLike } from "./types.js";
import { parseDeck, generateNarration } from "./narration.js";
import { SlidevAdapter } from "./slidev-adapter.js";
import { PresentationProvider, PORT_RANGE_START, PORT_RANGE_END, findFreePort } from "./presentation-provider.js";
import { PresentationCommentsBridge } from "./presentation-comments-bridge.js";
import { PresentationStateContribution } from "./presentation-state.js";
import { createPresentationTools } from "./presentation-tools.js";
import type { BridgeAPI } from "./types.js";
import type { ParsedDeck } from "./types.js";

/**
 * Called by VS Code when the extension activates (onStartupFinished).
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  throw new Error("not implemented");
}

/**
 * Called by VS Code on deactivation — close any open session.
 */
export function deactivate(): void {
  // Session cleanup handled by context.subscriptions / PresentationProvider.dispose()
}
