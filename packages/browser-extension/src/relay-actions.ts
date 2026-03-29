/**
 * relay-actions.ts — Thin barrel: dispatch map + re-exports.
 *
 * This is the public API surface for the relay layer. All consumers
 * (service-worker.ts, relay-bridge.ts, tests) import from this file.
 * The actual logic lives in:
 *   - relay-definitions.ts       — types, defaultStore, isVersionedSnapshot
 *   - relay-comment-handlers.ts  — comment CRUD handler implementations
 *   - relay-page-handlers.ts     — page understanding handler implementations
 *   - relay-capture-handler.ts   — capture_region + diff_snapshots implementations
 *   - relay-tab-handlers.ts      — list_pages + select_page implementations
 *   - relay-forwarder.ts         — cross-context messaging utilities
 *
 * Split from 868-line monolith (B5a modularity).
 *
 * @module
 */

import { resetDefaultManager } from "./snapshot-versioning.js";
import { defaultStore } from "./relay-definitions.js";
import type { RelayAction, RelayActionRequest, RelayActionResponse } from "./relay-definitions.js";
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
} from "./relay-comment-handlers.js";
import {
  handleGetPageMap,
  handleInspectElement,
  handleGetDomExcerpt,
  handleGetTextMap,
  handleGetSemanticGraph,
  handleWaitFor,
} from "./relay-page-handlers.js";
import {
  handleCaptureRegion,
  handleDiffSnapshots,
} from "./relay-capture-handler.js";
import {
  handleListPages,
  handleSelectPage,
} from "./relay-tab-handlers.js";

// ── Re-exports (preserve public API surface) ─────────────────────────────────

export { defaultStore };
export type { RelayAction, RelayActionRequest, RelayActionResponse } from "./relay-definitions.js";

// ── Action → Handler map ─────────────────────────────────────────────────────

type ActionHandler = (request: RelayActionRequest) => Promise<RelayActionResponse>;

const ACTION_HANDLERS: Record<RelayAction, ActionHandler> = {
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

  // Capture and diff
  capture_region: handleCaptureRegion,
  diff_snapshots: handleDiffSnapshots,

  // Wait
  wait_for: handleWaitFor,

  // Multi-tab
  list_pages: handleListPages,
  select_page: handleSelectPage,
};

// ── Navigation Reset ─────────────────────────────────────────────────────────

/**
 * Navigation reset lifecycle contract (B2-SV-005).
 *
 * **Ownership:** The service worker (relay layer) is responsible for observing
 * navigation events via `chrome.webNavigation.onCommitted` or `chrome.tabs.onUpdated`.
 * When a top-level navigation is detected for a tab, the service worker MUST:
 *
 * 1. Call `resetDefaultManager()` to reset the snapshot version counter.
 * 2. The content script's `SnapshotStore` is inherently reset because the
 *    content script is destroyed and re-injected on navigation.
 *
 * The relay layer does NOT own snapshot ID minting for data-producing tools.
 * It forwards the SnapshotEnvelope produced by the content script's
 * `captureSnapshotEnvelope()` function without modification.
 *
 * For capture_region (which runs in the service worker context), the relay
 * uses `captureSnapshotEnvelope("visual")` from snapshot-versioning.ts.
 */
export function handleNavigationReset(): void {
  resetDefaultManager();
  defaultStore.resetOnNavigation();
}

// ── Dispatch ─────────────────────────────────────────────────────────────────

/**
 * Main dispatch — routes each RelayAction to its handler via the action map.
 *
 * This function is the single entry point for all relay actions. It delegates
 * to focused handler functions via ACTION_HANDLERS.
 */
export async function handleRelayAction(
  request: RelayActionRequest,
): Promise<RelayActionResponse> {
  try {
    const handler = ACTION_HANDLERS[request.action];
    if (!handler) {
      return { requestId: request.requestId, success: false, error: "unsupported-action" };
    }
    return await handler(request);
  } catch {
    return { requestId: request.requestId, success: false, error: "action-failed" };
  }
}
