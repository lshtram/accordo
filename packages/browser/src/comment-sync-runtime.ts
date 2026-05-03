import * as vscode from "vscode";
import type { CommentThread } from "@accordo/bridge-types";
import type { BrowserBridgeAPI, BrowserRelayLike } from "./types.js";

/**
 * Minimal BrowserCommentSyncState shape used over the relay wire.
 * Defined locally to avoid a dependency on the comments package from the browser package.
 */
export interface BrowserCommentSyncStateWire {
  schemaVersion: string;
  browserRevision: number;
  accordoRevision: number;
  emittedBy: string;
  generatedAt: string;
  pages: Array<{ pageUrl: string; threads: Array<{ id: string; anchorKey: string; pageUrl: string; status: string; deletedAt?: string; comments: Array<{ id: string; threadId: string; createdAt: string; author: { kind: string; name: string }; body: string; anchorKey: string; status: string; deletedAt?: string }>; createdAt: string; lastActivity: string }> }>;
}

export const COMMENT_SYNC_RELAY_TIMEOUT_MS = 5000;

/**
 * Result of a full-state browser comment sync cycle.
 * syncResult is the reconciled BrowserCommentSyncState from Accordo Hub.
 */
export interface SyncBrowserCommentsResult {
  status: "success" | "partial";
  syncResult: BrowserCommentSyncStateWire | null;
}

/**
 * Full-state browser comment sync.
 *
 * Canonical protocol (Accordo-initiated):
 *   1. Accordo calls syncBrowserComments() → sends request_comment_state_sync to browser
 *   2. Browser handler reads canonical store, calls back via sync_comment_state (request())
 *   3. VSCode applies browser's state via applyBrowserCommentSyncStateFromRelay()
 *   4. VSCode returns merged BrowserCommentSyncState in sync_comment_state response
 *   5. Browser handler receives merged state in request() response, persists it
 *   6. syncBrowserComments() returns merged state to caller
 *
 * The key difference from the old per-mutation approach: one round-trip with full JSON,
 * not a back-and-forth with empty payloads. The browser sends its full canonical state
 * in the request_comment_state_sync callback, and VSCode sends merged state back.
 */
export async function syncBrowserComments(
  relay: BrowserRelayLike,
  bridge: BrowserBridgeAPI,
  out: vscode.OutputChannel,
): Promise<SyncBrowserCommentsResult> {
  try {
    // Step 1: Initiate via request_comment_state_sync (NOT sync_comment_state with {}).
    // This tells the browser to gather its full canonical state and call back.
    const syncResult = await relay.request(
      "request_comment_state_sync",
      {},
      COMMENT_SYNC_RELAY_TIMEOUT_MS,
    );
    if (!syncResult.success) {
      out.appendLine(
        `[accordo-browser:comment-sync] request_comment_state_sync failed — skipping sync`,
      );
      return { status: "partial", syncResult: null };
    }

    // Step 2: syncResult.data IS the merged BrowserCommentSyncState returned by the
    // browser's handleRequestCommentStateSync (which receives it from VSCode's
    // sync_comment_state handler response).
    const mergedState = syncResult.data as BrowserCommentSyncStateWire;

    // Step 3: Apply merged full-state to VS Code comment store via accordo-comments extension.
    const applyResult = await applyBrowserCommentSyncStateFromRelay(mergedState, out);
    if (applyResult.status !== "success") {
      out.appendLine(`[accordo-browser:comment-sync] applyBrowserCommentSyncState returned ${applyResult.status}`);
    }

    out.appendLine("[accordo-browser:comment-sync] full-state sync complete");
    return { status: "success", syncResult: (applyResult.status === "success" ? applyResult.state : mergedState) as BrowserCommentSyncStateWire };
  } catch (err) {
    out.appendLine(
      `[accordo-browser:comment-sync] request_comment_state_sync request failed — ${err instanceof Error ? err.message : String(err)}`,
    );
    return { status: "partial", syncResult: null };
  }
}

/**
 * Apply merged browser comment full-state to the VS Code comment store.
 *
 * This is the canonical seam between the browser-extension (which holds
 * Chrome-canonical state) and the comments extension (which projects into
 * VS Code UI). The merged state is received via the `sync_comment_state`
 * relay response and applied through the accordo-comments extension API.
 */
export async function applyBrowserCommentSyncStateFromRelay(
  mergedState: unknown,
  out: vscode.OutputChannel,
): Promise<{ status: "success"; state: unknown } | { status: "partial" }> {
  const commentsExt = vscode.extensions.getExtension("accordo.accordo-comments");
  const exports = commentsExt?.exports as {
    applyBrowserCommentSyncState?(state: unknown): Promise<unknown>;
  } | undefined;
  try {
    if (!commentsExt || !commentsExt.exports) {
      out.appendLine("[accordo-browser:comment-sync] accordo-comments not installed — skipping apply");
      return { status: "partial" };
    }
    const applyBrowserCommentSyncState = exports?.applyBrowserCommentSyncState;
    if (typeof applyBrowserCommentSyncState !== "function") {
      out.appendLine("[accordo-browser:comment-sync] accordo-comments applyBrowserCommentSyncState not available — skipping apply");
      return { status: "partial" };
    }
    const state = await applyBrowserCommentSyncState(mergedState);
    out.appendLine("[accordo-browser:comment-sync] applied merged state to VS Code comment store");
    return { status: "success", state: state ?? mergedState };
  } catch (err) {
    out.appendLine(
      `[accordo-browser:comment-sync] applyBrowserCommentSyncState failed — ${err instanceof Error ? err.message : String(err)}`,
    );
    return { status: "partial" };
  }
}
