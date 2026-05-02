/**
 * relay-dispatch-table.ts — Dispatch map and error-meta re-export.
 *
 * Extracted from relay-actions.ts to satisfy file-size limit.
 * The switch dispatch lives here; handleRelayAction in relay-actions.ts
 * delegates to this map.
 *
 * @module
 */

import type { RelayActionRequest, RelayActionResponse } from "./relay-definitions.js";
import { getErrorMeta } from "./relay-definitions.js";
import {
  handleGetAllComments,
  handleGetComments,
  handleCreateComment,
  handleReplyComment,
  handleDeleteComment,
  handleResolveThread,
  handleReopenThread,
  handleDeleteThread,
  handleNotifyCommentsUpdated,
  handleGetPageMap,
  handleInspectElement,
  handleGetDomExcerpt,
  handleCaptureRegion,
  handleDiffSnapshots,
  handleWaitFor,
  handleGetTextMap,
  handleGetSemanticGraph,
  handleGetSpatialRelations,
  handleListPages,
  handleManageSnapshots,
  handleSelectPage,
  handleSyncCommentState,
  handleRequestCommentStateSync,
} from "./relay-handlers.js";
import {
  handleNavigate,
  handleClick,
  handleType,
  handlePressKey,
} from "./relay-control-handlers.js";

export { getErrorMeta };

type Handler = (request: RelayActionRequest) => Promise<RelayActionResponse>;
type DispatchMap = Record<string, Handler | undefined>;

/**
 * Maps each RelayAction to its handler function.
 * Single source of truth used by handleRelayAction.
 */
export const dispatchMap: DispatchMap = {
  // Comment actions
  get_all_comments: handleGetAllComments,
  get_comments: handleGetComments,
  create_comment: handleCreateComment,
  reply_comment: handleReplyComment,
  delete_comment: handleDeleteComment,
  resolve_thread: handleResolveThread,
  reopen_thread: handleReopenThread,
  delete_thread: handleDeleteThread,
  notify_comments_updated: handleNotifyCommentsUpdated,

  // Page understanding actions
  get_page_map: handleGetPageMap,
  inspect_element: handleInspectElement,
  get_dom_excerpt: handleGetDomExcerpt,
  get_text_map: handleGetTextMap,
  get_semantic_graph: handleGetSemanticGraph,
  get_spatial_relations: handleGetSpatialRelations,

  // Capture and diff
  capture_region: handleCaptureRegion,
  diff_snapshots: handleDiffSnapshots,

  // Wait
  wait_for: handleWaitFor,

  // Multi-tab
  manage_snapshots: handleManageSnapshots,
  list_pages: handleListPages,
  select_page: handleSelectPage,

  // Browser control
  navigate: handleNavigate,
  click: handleClick,
  type: handleType,
  press_key: handlePressKey,

  // Full-state sync
  sync_comment_state: handleSyncCommentState,
  request_comment_state_sync: handleRequestCommentStateSync,
};

/**
 * Returns a blocked/unsupported response for unknown actions.
 * Exported for use in relay-actions.ts default branch.
 */
export function unsupportedResponse(request: RelayActionRequest): RelayActionResponse {
  return {
    requestId: request.requestId,
    success: false,
    error: "unsupported-action",
    ...getErrorMeta("unsupported-action"),
  };
}

/**
 * Returns a generic action-failed response.
 * Exported for use in relay-actions.ts catch block.
 */
export function failedResponse(request: RelayActionRequest): RelayActionResponse {
  return {
    requestId: request.requestId,
    success: false,
    error: "action-failed",
    ...getErrorMeta("action-failed"),
  };
}
