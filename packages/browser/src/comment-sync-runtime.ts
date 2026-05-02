import * as vscode from "vscode";
import type { CommentThread } from "@accordo/bridge-types";
import type { BrowserBridgeAPI, BrowserRelayLike } from "./types.js";

export const COMMENT_SYNC_RELAY_TIMEOUT_MS = 5000;

/**
 * Full-state browser comment sync.
 *
 * Replaces the old per-mutation/notify approach with a single sync_comment_state
 * call: browser extension sends complete JSON state, Accordo merges by IDs/timestamps
 * and returns merged JSON, which is then applied to the VS Code comment store.
 */
export async function syncBrowserComments(
  relay: BrowserRelayLike,
  bridge: BrowserBridgeAPI,
  out: vscode.OutputChannel,
): Promise<"success" | "partial"> {
  try {
    const syncResult = await relay.request(
      "sync_comment_state",
      {},
      COMMENT_SYNC_RELAY_TIMEOUT_MS,
    );
    if (!syncResult.success) {
      out.appendLine(
        `[accordo-browser:comment-sync] sync_comment_state failed — skipping sync`,
      );
      return "partial";
    }

    // Apply merged full-state to VS Code comment store via accordo-comments extension.
    // The response data is the reconciled BrowserCommentSyncState from Accordo Hub.
    await applyBrowserCommentSyncState(syncResult.data, out);

    out.appendLine("[accordo-browser:comment-sync] full-state sync complete");
    return "success";
  } catch (err) {
    out.appendLine(
      `[accordo-browser:comment-sync] sync_comment_state request failed — ${err instanceof Error ? err.message : String(err)}`,
    );
    return "partial";
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
): Promise<"success" | "partial"> {
  try {
    const commentsExt = vscode.extensions.getExtension("accordo.accordo-comments");
    if (!commentsExt || !commentsExt.exports) {
      out.appendLine("[accordo-browser:comment-sync] accordo-comments not installed — skipping apply");
      return;
    }
    const exports = commentsExt.exports as {
      applyBrowserCommentSyncState?(state: unknown): Promise<void>;
    };
    if (typeof exports.applyBrowserCommentSyncState !== "function") {
      out.appendLine("[accordo-browser:comment-sync] accordo-comments applyBrowserCommentSyncState not available — skipping apply");
      return;
    }
    await exports.applyBrowserCommentSyncState(mergedState);
    out.appendLine("[accordo-browser:comment-sync] applied merged state to VS Code comment store");
  } catch (err) {
    out.appendLine(
      `[accordo-browser:comment-sync] applyBrowserCommentSyncState failed — ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
