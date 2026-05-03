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
import type { BrowserCommentSyncState } from "./comment-store.js";
import { NativeComments } from "./native-comments.js";
import { createCommentTools, ExternalFanoutNotifier } from "./comment-tools.js";
import type { CommentUINotifier } from "./comment-tools.js";
import { startStateContribution } from "./state-contribution.js";
import { wireWebviewPanelAndCommands } from "./panel-bootstrap.js";
import { registerBridgeIntegrationCommands } from "./bridge-integration.js";
import type { BridgeAPI } from "./bridge-integration.js";

// ── Module-level store reference ──────────────────────────────────────────────
// Stored here so the applyBrowserCommentSyncState export can delegate to it.
// Initialised once in activate() and never reassigned.
let _activatedStore: CommentStore | null = null;

// ── Browser sync depth counter ─────────────────────────────────────────────────
// Tracks nested applyBrowserCommentSyncState calls so the central store.onChanged
// hook does NOT fire scheduleWakeup when a browser-origin apply triggers _emit.
// This prevents the ping-pong loop: apply -> _emit -> wakeup -> browser sync ->
// apply again -> _emit -> wakeup ... ad infinitum.
//
// Increment before apply, decrement after (try/finally ensures decrement even
// on error). The hook checks depth === 0 before scheduling wakeup.
let _browserSyncApplyDepth = 0;

/**
 * Wrapper that increments browserSyncApplyDepth before calling
 * store.applyBrowserCommentSyncState and decrements after, using try/finally
 * so the counter is never left elevated on error.
 */
async function applyBrowserSyncState(
  store: CommentStore,
  state: BrowserCommentSyncState,
): Promise<BrowserCommentSyncState> {
  _browserSyncApplyDepth++;
  try {
    await store.applyBrowserCommentSyncState(state);
    return store.exportBrowserCommentSyncState({
      browserRevision: state.browserRevision,
      accordoRevision: state.accordoRevision,
    });
  } finally {
    _browserSyncApplyDepth--;
  }
}

// ── Exports ───────────────────────────────────────────────────────────────────

/** Exports returned by activate() for inter-extension consumption. */
export interface CommentsExtensionExports {
  registerBrowserNotifier: (notifier: CommentUINotifier) => { dispose(): void };
  /** Apply merged browser comment full-state to the VS Code comment store.
   *
   * Called by the browser package after `sync_comment_state` returns the
   * reconciled merged state from Accordo Hub. This is the canonical seam
   * between the browser-extension (which holds Chrome-canonical state) and
   * the comments extension (which projects into VS Code UI).
   *
   * @param state Full-state document from `sync_comment_state` response.
   */
  applyBrowserCommentSyncState(state: BrowserCommentSyncState): Promise<BrowserCommentSyncState>;
}

// Re-export types so extension.ts doesn't need to import them directly
export type { BridgeAPI } from "./bridge-integration.js";
export type { SurfaceCommentAdapter } from "./bridge-integration.js";

export function runStartupNativeProjectionReconcile(
  store: CommentStore,
  nc: NativeComments,
): void {
  // Canonical load/prune → native reconcile path.
  // After store.load() + prune, reconcile so any threads loaded from disk
  // are projected as native widgets with inSync=true.
  const storeThreads = store.getAllThreads();
  if (storeThreads.length > 0) {
    nc.reconcile(storeThreads);
  }
}

export function wireStoreDrivenNativeProjectionReconcile(
  store: CommentStore,
  nc: NativeComments,
): vscode.Disposable {
  // Canonical store.onChanged → native reconcile path.
  // Every store mutation fires onChanged → reconcile(store.getAllThreads()).
  // This is the single convergence point for MCP tools, native commands,
  // panel commands, and any other store mutation source.
  return store.onChanged(() => {
    nc.reconcile(store.getAllThreads());
  });
}

// ── activate ──────────────────────────────────────────────────────────────────

/**
 * Called by VS Code when the extension activates (onStartupFinished).
 */
export async function activate(
  context: vscode.ExtensionContext,
): Promise<CommentsExtensionExports> {
  // ── Store (always created — does not depend on Bridge) ─────────────────────
  const store = new CommentStore();
  _activatedStore = store; // Make available to applyBrowserCommentSyncState export
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
  runStartupNativeProjectionReconcile(store, nc);
  nc.registerCommands(store, context);
  context.subscriptions.push(wireStoreDrivenNativeProjectionReconcile(store, nc));

  // External fanout for browser relay and other external observers.
  // This is ExternalFanoutNotifier only — NativeComments is NEVER here.
  // Native widget mutation happens via store.onChanged -> nc.reconcile() ONLY.
  const externalFanout = new ExternalFanoutNotifier();

  // Central browser sync wakeup — fires on any store mutation for HTTP(S) URIs.
  // This is the single convergence point so panel replies, native commands,
  // MCP tools, and direct store mutations all trigger browser extension sync
  // without waiting for the periodic interval. File URIs are excluded.
  //
  // Ping-pong prevention: _browserSyncApplyDepth is incremented before
  // applyBrowserCommentSyncState and decremented after (try/finally). When
  // browser-origin apply calls _emit(pageUrl), this hook skips scheduleWakeup
  // because _browserSyncApplyDepth > 0 at that point. This breaks the
  // apply -> _emit -> wakeup -> apply loop.
  context.subscriptions.push(
    store.onChanged((uri: string) => {
      if (uri.startsWith("http://") || uri.startsWith("https://")) {
        if (_browserSyncApplyDepth === 0) {
          externalFanout.scheduleWakeup("request_comment_state_sync", { url: uri });
        }
      }
    }),
  );

  // ── Panel wiring + user-facing commands ───────────────────────────────────
  const panelDisposables = wireWebviewPanelAndCommands(context, store, nc);
  context.subscriptions.push(...panelDisposables);

  // ── Internal commands (inter-extension API — no Bridge dependency) ─────────
  const bridgeIntegrationDisposables = registerBridgeIntegrationCommands(store, nc);
  context.subscriptions.push(...bridgeIntegrationDisposables);

  // ── Bridge-dependent features (tools + state) — optional ───────────────────
  const bridgeExt = vscode.extensions.getExtension("accordo.accordo-bridge");
  if (!bridgeExt) {
    console.warn("[accordo-comments] accordo-bridge not installed — MCP tools and state disabled");
    return {
      registerBrowserNotifier: (notifier) => externalFanout.add(notifier),
      applyBrowserCommentSyncState: async (state: BrowserCommentSyncState) => {
        if (_activatedStore) return await applyBrowserSyncState(_activatedStore, state);
        return state;
      },
    };
  }
  if (!bridgeExt.isActive) {
    try { await bridgeExt.activate(); } catch { /* bridge failed — skip tools */ }
  }
  const bridge = bridgeExt.exports as BridgeAPI | undefined;
  if (!bridge || typeof bridge.registerTools !== "function") {
    console.warn("[accordo-comments] Bridge exports unavailable — MCP tools and state disabled");
    return {
      registerBrowserNotifier: (notifier) => externalFanout.add(notifier),
      applyBrowserCommentSyncState: async (state: BrowserCommentSyncState) => {
        if (_activatedStore) return await applyBrowserSyncState(_activatedStore, state);
        return state;
      },
    };
  }

  // ── Tools ─────────────────────────────────────────────────────────────────
  // Pass external fanout (not composite with nc) — external observers only,
  // NOT NativeComments. Native widget mutation via store.onChanged -> nc.reconcile().
  const tools = createCommentTools(store, externalFanout);
  const toolsDisposable = bridge.registerTools("accordo-comments", tools);
  context.subscriptions.push(toolsDisposable);

  // ── State contribution ────────────────────────────────────────────────────
  const stateContrib = startStateContribution(bridge, store);
  context.subscriptions.push(stateContrib);

  return {
    registerBrowserNotifier: (notifier) => externalFanout.add(notifier),
    applyBrowserCommentSyncState: async (state: BrowserCommentSyncState) => {
      return await applyBrowserSyncState(store, state);
    },
  };
}

// ── deactivate ────────────────────────────────────────────────────────────────

/**
 * Called by VS Code when the extension host is being shut down.
 */
export function deactivate(): void {
  // Subscriptions added to context.subscriptions are disposed automatically.
}
