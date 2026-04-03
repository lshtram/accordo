/**
 * relay-actions.ts — Thin barrel: dispatch switch + re-exports.
 *
 * This is the public API surface for the relay layer. All consumers
 * (service-worker.ts, relay-bridge.ts, tests) import from this file.
 * The actual logic lives in:
 *   - relay-definitions.ts  — types, defaultStore, isVersionedSnapshot
 *   - relay-handlers.ts     — handler implementations per action
 *   - relay-forwarder.ts    — cross-context messaging utilities
 *
 * Split from 868-line monolith (B5a modularity).
 *
 * @module
 */

import { resetDefaultManager } from "./snapshot-versioning.js";
import { defaultStore } from "./relay-definitions.js";
import type { RelayActionRequest, RelayActionResponse } from "./relay-definitions.js";
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
  handleListPages,
  handleSelectPage,
} from "./relay-handlers.js";

import {
  handleNavigate,
  handleClick,
  handleType,
  handlePressKey,
} from "./relay-control-handlers.js";

// ── Re-exports (preserve public API surface) ─────────────────────────────────

export { defaultStore };
export type { RelayAction, RelayActionRequest, RelayActionResponse } from "./relay-definitions.js";

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
 * Main dispatch switch — routes each RelayAction to its handler.
 *
 * This function is the single entry point for all relay actions. It delegates
 * to focused handler functions in relay-handlers.ts.
 */
export async function handleRelayAction(request: RelayActionRequest): Promise<RelayActionResponse> {
  try {
    switch (request.action) {
      // ── Comment actions ──
      case "get_all_comments":
        return await handleGetAllComments(request);
      case "get_comments":
        return await handleGetComments(request);
      case "create_comment":
        return await handleCreateComment(request);
      case "reply_comment":
        return await handleReplyComment(request);
      case "delete_comment":
        return await handleDeleteComment(request);
      case "resolve_thread":
        return await handleResolveThread(request);
      case "reopen_thread":
        return await handleReopenThread(request);
      case "delete_thread":
        return await handleDeleteThread(request);
      case "notify_comments_updated":
        return await handleNotifyCommentsUpdated(request);

      // ── Page understanding actions ──
      case "get_page_map":
        return await handleGetPageMap(request);
      case "inspect_element":
        return await handleInspectElement(request);
      case "get_dom_excerpt":
        return await handleGetDomExcerpt(request);
      case "get_text_map":
        return await handleGetTextMap(request);
      case "get_semantic_graph":
        return await handleGetSemanticGraph(request);

      // ── Capture and diff ──
      case "capture_region":
        return await handleCaptureRegion(request);
      case "diff_snapshots":
        return await handleDiffSnapshots(request);

      // ── Wait ──
      case "wait_for":
        return await handleWaitFor(request);

      // ── Multi-tab ──
      case "list_pages":
        return await handleListPages(request);
      case "select_page":
        return await handleSelectPage(request);

      // ── Browser control ──
      case "navigate":
        return await handleNavigate(request);
      case "click":
        return await handleClick(request);
      case "type":
        return await handleType(request);
      case "press_key":
        return await handlePressKey(request);

      default:
        return { requestId: request.requestId, success: false, error: "unsupported-action" };
    }
  } catch (error: unknown) {
    return { requestId: request.requestId, success: false, error: "action-failed" };
  }
}
