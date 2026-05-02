/**
 * relay-sync-handlers.ts — Full-state sync action handlers.
 *
 * Handles:
 *   - sync_comment_state: Receives merged full-state from Accordo, persists to canonical storage
 *   - request_comment_state_sync: Wakeup action that triggers a full-state sync cycle
 *
 * @module
 */

import type { RelayActionRequest, RelayActionResponse } from "./relay-definitions.js";
import { getErrorMeta } from "./relay-definitions.js";
import { getRelayClient } from "./relay-comment-runtime.js";
import { persistMergedBrowserCommentSyncState, type BrowserCommentSyncPage } from "./browser-comment-sync-store.js";

/**
 * Handle sync_comment_state from Accordo.
 *
 * The browser extension receives this action in TWO scenarios:
 *
 *   Scenario A — Accordo-initiated cycle (canonical):
 *     Accordo calls syncBrowserComments() → sends sync_comment_state request to browser
 *     → handleSyncCommentState receives it with browser's own previously-sent state (echoed
 *     back by the relay server in per-window mode) or the merged result.
 *     In practice, VSCode's handle of sync_comment_state applies the state and returns the
 *     merged result; this function persists that merged state and returns.
 *
 *   Scenario B — Accordo responds to browser's request_comment_state_sync:
 *     Browser sent request_comment_state_sync → Accordo called syncBrowserComments() →
 *     Accordo sent sync_comment_state back to browser with merged state →
 *     handleSyncCommentState receives it with the merged state in request.payload.
 *
 * In both cases, request.payload IS the state to persist. We do NOT call
 * relay.send("sync_comment_state", ...) here — that would create a recursion loop
 * where handling sync_comment_state triggers another sync_comment_state to VSCode,
 * which calls syncBrowserComments() again.
 *
 * This function just persists and returns. The sync cycle ends here.
 */
export async function handleSyncCommentState(
  request: RelayActionRequest,
): Promise<RelayActionResponse> {
  const relay = getRelayClient();
  if (!relay || !relay.isConnected()) {
    return {
      requestId: request.requestId,
      success: false,
      error: "action-failed",
      ...getErrorMeta("action-failed"),
    };
  }

  try {
    // request.payload IS the merged state from Accordo (or browser's own state in
    // per-window echo case). Persist it directly — do NOT relay.send another
    // sync_comment_state, which would cause recursion: VSCode would handle it by
    // calling syncBrowserComments() again → infinite loop.
    const mergedState = request.payload as {
      schemaVersion: string;
      browserRevision: number;
      accordoRevision: number;
      emittedBy: string;
      generatedAt: string;
      pages: BrowserCommentSyncPage[];
    };

    await persistMergedBrowserCommentSyncState(mergedState);

    return {
      requestId: request.requestId,
      success: true,
      data: { synced: true },
    };
  } catch (err) {
    return {
      requestId: request.requestId,
      success: false,
      error: "action-failed",
      ...getErrorMeta("action-failed"),
    };
  }
}

/**
 * Handle request_comment_state_sync wakeup action.
 *
 * This is a control action that triggers a full-state sync cycle.
 * The browser extension should send sync_comment_state to Accordo and persist the result.
 */
export async function handleRequestCommentStateSync(
  request: RelayActionRequest,
): Promise<RelayActionResponse> {
  const relay = getRelayClient();
  if (!relay || !relay.isConnected()) {
    return {
      requestId: request.requestId,
      success: false,
      error: "action-failed",
      ...getErrorMeta("action-failed"),
    };
  }

  try {
    // Trigger sync_comment_state to get merged state from Accordo
    const response = await relay.send("sync_comment_state", {}, 10000);

    if (!response.success) {
      return {
        requestId: request.requestId,
        success: false,
        error: "action-failed",
        ...getErrorMeta("action-failed"),
      };
    }

    // Persist the merged state
    const mergedState = response.data as {
      schemaVersion: string;
      browserRevision: number;
      accordoRevision: number;
      emittedBy: string;
      generatedAt: string;
      pages: BrowserCommentSyncPage[];
    };

    await persistMergedBrowserCommentSyncState(mergedState);

    // Note: UI refresh is handled via chrome messaging / storage listeners in production.
    // The canonical storage is now updated; any UI component can read from it.

    return {
      requestId: request.requestId,
      success: true,
      data: { synced: true },
    };
  } catch (err) {
    return {
      requestId: request.requestId,
      success: false,
      error: "action-failed",
      ...getErrorMeta("action-failed"),
    };
  }
}
