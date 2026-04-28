/**
 * relay-get-page-map-forward.ts — Remote tab forwarding and snapshot saving.
 *
 * Handles the remote (tab) path logic for handleGetPageMap:
 * - forwardToMainFrame with reinjectAndForwardToFrame retry
 * - frame stitching
 * - snapshot store save
 * - owner registration
 *
 * @module
 */

import type { RelayActionRequest, RelayActionResponse } from "./relay-definitions.js";
import { defaultStore, isVersionedSnapshot, actionFailed } from "./relay-definitions.js";
import { forwardToMainFrame, reinjectAndForwardToFrame, NO_CONTENT_SCRIPT } from "./relay-forwarder.js";
import { stitchFrameNodesIntoPageMap } from "./relay-page-frame-tree.js";

/**
 * Forwards get_page_map to the main frame with content-script reinjection retry.
 * Returns null on NO_CONTENT_SCRIPT or null data.
 */
export async function forwardGetPageMap(
  request: RelayActionRequest,
  tabId: number,
): Promise<Record<string, unknown> | null> {
  let data = await forwardToMainFrame(tabId, request.action, request.payload);
  if (data === NO_CONTENT_SCRIPT) {
    try {
      data = await reinjectAndForwardToFrame(tabId, 0, request.action, request.payload);
    } catch {
      return null;
    }
    if (data === NO_CONTENT_SCRIPT || data === null) return null;
  } else if (data === null) {
    return null;
  }
  return data as Record<string, unknown>;
}

/**
 * Saves a versioned snapshot to the store and registers its owner.
 */
export async function savePageMapSnapshot(result: Record<string, unknown>): Promise<void> {
  if (!isVersionedSnapshot(result)) return;
  await defaultStore.save((result as { pageId: string }).pageId, result as Parameters<typeof defaultStore.save>[1]);
  const { registerPageMapOwner } = await import("./content/spatial-snapshot-registry.js");
  registerPageMapOwner(
    (result as { snapshotId: string }).snapshotId,
    (result as { frameId?: string }).frameId ?? "main",
  );
}
