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
    out.appendLine("[SYNC-B] request_comment_state_sync sent"); // DEBUG:
    const syncResult = await relay.request(
      "request_comment_state_sync",
      {},
      COMMENT_SYNC_RELAY_TIMEOUT_MS,
    );
    // DEBUG: instrument response
    const s = syncResult.success;
    const hasData = !!syncResult.data && typeof syncResult.data === "object" && Object.keys(syncResult.data).length > 0;
    let respPageCount = 0;
    let respThreadCount = 0;
    let respCommentCount = 0;
    if (hasData) {
      const data = syncResult.data as BrowserCommentSyncStateWire;
      const respPages = data.pages;
      respPageCount = respPages?.length ?? 0;
      for (const page of respPages ?? []) {
        for (const thread of page.threads ?? []) {
          respThreadCount++;
          respCommentCount += thread.comments?.length ?? 0;
        }
      }
    }
    out.appendLine(
      `[SYNC-B2] request_comment_state_sync response received success=${s} hasData=${hasData} respPageCount=${respPageCount} respThreadCount=${respThreadCount} respCommentCount=${respCommentCount}`,
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
    out.appendLine("[SYNC-B3] returned state apply result"); // DEBUG:
    const applyResult = await applyBrowserCommentSyncStateFromRelay(mergedState, out);
    if (applyResult !== "success") {
      out.appendLine(`[accordo-browser:comment-sync] applyBrowserCommentSyncState returned ${applyResult}`);
    }

    out.appendLine("[accordo-browser:comment-sync] full-state sync complete");
    return { status: "success", syncResult: mergedState };
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
): Promise<"success" | "partial"> {
  // DEBUG: instrument extension lookup
  const commentsExt = vscode.extensions.getExtension("accordo.accordo-comments");
  const exports = commentsExt?.exports as {
    applyBrowserCommentSyncState?(state: unknown): Promise<void>;
  } | undefined;
  out.appendLine(
    `[SYNC-G] comments extension lookup commentsExt=${!!commentsExt} exports=${!!commentsExt?.exports} applyFn=${typeof exports?.applyBrowserCommentSyncState}`,
  );
  try {
    if (!commentsExt || !commentsExt.exports) {
      out.appendLine("[accordo-browser:comment-sync] accordo-comments not installed — skipping apply");
      return "partial";
    }
    if (typeof exports!.applyBrowserCommentSyncState !== "function") {
      out.appendLine("[accordo-browser:comment-sync] accordo-comments applyBrowserCommentSyncState not available — skipping apply");
      return "partial";
    }
    // DEBUG: instrument apply call
    let pageCount = 0;
    let threadCount = 0;
    let commentCount = 0;
    if (mergedState && typeof mergedState === "object" && "pages" in mergedState) {
      const state = mergedState as { pages: Array<{ threads?: Array<{ comments?: Array<unknown> }> }> };
      pageCount = state.pages?.length ?? 0;
      for (const page of state.pages ?? []) {
        for (const thread of page.threads ?? []) {
          threadCount++;
          commentCount += thread.comments?.length ?? 0;
        }
      }
    }
    out.appendLine(`[SYNC-G2] applyBrowserCommentSyncState called pageCount=${pageCount} threadCount=${threadCount} commentCount=${commentCount}`);
    await exports!.applyBrowserCommentSyncState!(mergedState);
    out.appendLine("[accordo-browser:comment-sync] applied merged state to VS Code comment store");
    out.appendLine(`[SYNC-G3] applyBrowserCommentSyncState returned result=success`); // DEBUG:
    return "success";
  } catch (err) {
    out.appendLine(
      `[accordo-browser:comment-sync] applyBrowserCommentSyncState failed — ${err instanceof Error ? err.message : String(err)}`,
    );
    out.appendLine(`[SYNC-G3] applyBrowserCommentSyncState returned result=partial`); // DEBUG:
    return "partial";
  }
}
