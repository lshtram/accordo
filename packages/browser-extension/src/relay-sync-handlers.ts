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
 * Accordo sends the merged full-state browser comment document.
 * We persist it to canonical Chrome storage and broadcast to refresh UI.
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
    // Send sync_comment_state to Accordo with outbound state
    // The response contains the merged full-state
    const response = await relay.send("sync_comment_state", request.payload ?? {}, 10000);

    if (!response.success) {
      return {
        requestId: request.requestId,
        success: false,
        error: "action-failed",
        ...getErrorMeta("action-failed"),
      };
    }

    // Persist the merged state to canonical storage
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
