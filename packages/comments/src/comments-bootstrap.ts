/**
 * accordo-comments — Extension Bootstrap
 *
 * Implements the VSCode activate/deactivate lifecycle:
 *   1. Creates CommentStore and loads persisted data
 *   2. Auto-prunes stale threads
 *   3. Initialises NativeComments (gutter, panel, inline threads)
 *   4. Wires the custom Comments Panel and user-facing commands
 *   5. Registers inter-extension internal commands
 *   6. Acquires BridgeAPI and registers MCP tools + state contribution
 *      (if accordo-bridge is present; otherwise extension is inert for tools)
 *
 * Source: comments-architecture.md §10
 */

import * as vscode from "vscode";
import { CommentStore } from "./comment-store.js";
import { NativeComments } from "./native-comments.js";
import { createCommentTools, CompositeCommentUINotifier } from "./comment-tools.js";
import type { CommentUINotifier } from "./comment-tools.js";
import { startStateContribution } from "./state-contribution.js";
import { wirePanelAndCommands } from "./panel-bootstrap.js";
import { registerBridgeIntegrationCommands } from "./bridge-integration.js";
import type { BridgeAPI } from "./bridge-integration.js";

// ── Exports ───────────────────────────────────────────────────────────────────

/** Exports returned by activate() for inter-extension consumption. */
export interface CommentsExtensionExports {
  registerBrowserNotifier: (notifier: CommentUINotifier) => { dispose(): void };
}

// Re-export types so extension.ts doesn't need to import them directly
export type { BridgeAPI } from "./bridge-integration.js";
export type { SurfaceCommentAdapter } from "./bridge-integration.js";

// ── activate ──────────────────────────────────────────────────────────────────

/**
 * Called by VS Code when the extension activates (onStartupFinished).
 */
export async function activate(
  context: vscode.ExtensionContext,
): Promise<CommentsExtensionExports> {
  // ── Store (always created — does not depend on Bridge) ─────────────────────
  const store = new CommentStore();
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
  await store.load(workspaceRoot);

  // ── Auto-prune threads whose files no longer exist on disk ─────────────────
  {
    const pruned = await store.pruneStaleThreads(async (uri) => {
      try { await vscode.workspace.fs.stat(vscode.Uri.parse(uri)); return true; }
      catch { return false; }
    });
    if (pruned.length > 0) {
      console.info(`[accordo-comments] Pruned ${pruned.length} stale thread(s) on activation`);
    }
  }

  // ── NativeComments (always created — gutter, panel, inline threads) ────────
  const nc = new NativeComments();
  nc.init(store, context);
  nc.restoreThreads(store.getAllThreads());
  nc.registerCommands(store, context);

  const composite = new CompositeCommentUINotifier(nc);

  // ── Panel wiring + user-facing commands ───────────────────────────────────
  const panelDisposables = wirePanelAndCommands(context, store, nc);
  context.subscriptions.push(...panelDisposables);

  // ── Internal commands (inter-extension API — no Bridge dependency) ─────────
  const bridgeIntegrationDisposables = registerBridgeIntegrationCommands(store, nc);
  context.subscriptions.push(...bridgeIntegrationDisposables);

  // ── Bridge-dependent features (tools + state) — optional ───────────────────
  const bridgeExt = vscode.extensions.getExtension("accordo.accordo-bridge");
  if (!bridgeExt) {
    console.warn("[accordo-comments] accordo-bridge not installed — MCP tools and state disabled");
    return { registerBrowserNotifier: (notifier) => composite.add(notifier) };
  }
  if (!bridgeExt.isActive) {
    try { await bridgeExt.activate(); } catch { /* bridge failed — skip tools */ }
  }
  const bridge = bridgeExt.exports as BridgeAPI | undefined;
  if (!bridge || typeof bridge.registerTools !== "function") {
    console.warn("[accordo-comments] Bridge exports unavailable — MCP tools and state disabled");
    return { registerBrowserNotifier: (notifier) => composite.add(notifier) };
  }

  // ── Tools ─────────────────────────────────────────────────────────────────
  const tools = createCommentTools(store, composite);
  const toolsDisposable = bridge.registerTools("accordo-comments", tools);
  context.subscriptions.push(toolsDisposable);

  // ── State contribution ────────────────────────────────────────────────────
  const stateContrib = startStateContribution(bridge, store);
  context.subscriptions.push(stateContrib);

  return { registerBrowserNotifier: (notifier) => composite.add(notifier) };
}

// ── deactivate ────────────────────────────────────────────────────────────────

/**
 * Called by VS Code when the extension host is being shut down.
 */
export function deactivate(): void {
  // Subscriptions added to context.subscriptions are disposed automatically.
}
