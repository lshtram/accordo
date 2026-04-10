/**
 * Message handlers — chrome.runtime.onMessage dispatcher and message wrappers.
 * Consumed by content-entry.ts (IIFE bootstrap).
 */

import type { BrowserCommentThread } from "../types.js";
import {
  dbg, dbgErr, assertMessageSuccess,
  getSdk, wireSdkCallbacks, loadAndRenderPins,
} from "./comment-ui.js";
import { openSdkComposerAtAnchor } from "./sdk-convergence.js";

const STORAGE_KEY = "commentsMode";

// ── Message wrappers ──────────────────────────────────────────────────────────────

async function submitNewComment(anchorKey: string, body: string, anchorContext?: BrowserCommentThread["anchorContext"]): Promise<void> {
  try {
    const response = await chrome.runtime.sendMessage({ type: "CREATE_THREAD", payload: { url: window.location.href, anchorKey, body, author: { kind: "user", name: "Guest" }, anchorContext } });
    assertMessageSuccess("create thread", response);
    await loadAndRenderPins();
  } catch (err) { dbgErr(`submitNewComment: ${(err as Error)?.message ?? err}`); }
}

async function addReply(threadId: string, body: string): Promise<void> {
  try {
    const response = await chrome.runtime.sendMessage({ type: "ADD_COMMENT", payload: { threadId, body, author: { kind: "user", name: "Guest" } } });
    assertMessageSuccess("add reply", response);
    await loadAndRenderPins();
  } catch (err) { dbgErr(`addReply: ${(err as Error)?.message ?? err}`); }
}

async function resolveThread(threadId: string): Promise<void> {
  try {
    const response = await chrome.runtime.sendMessage({ type: "RESOLVE_THREAD", payload: { threadId, resolutionNote: "Resolved via browser UI" } });
    assertMessageSuccess("resolve thread", response);
    await loadAndRenderPins();
  } catch (err) { dbgErr(`resolveThread: ${(err as Error)?.message ?? err}`); }
}

async function reopenThread(threadId: string): Promise<void> {
  try {
    const response = await chrome.runtime.sendMessage({ type: "REOPEN_THREAD", payload: { threadId } });
    assertMessageSuccess("reopen thread", response);
    await loadAndRenderPins();
  } catch (err) { dbgErr(`reopenThread: ${(err as Error)?.message ?? err}`); }
}

async function deleteCommentOrThread(threadId: string, commentId?: string): Promise<void> {
  try {
    const response = await chrome.runtime.sendMessage({ type: commentId ? "SOFT_DELETE_COMMENT" : "SOFT_DELETE_THREAD", payload: commentId ? { threadId, commentId, deletedBy: "Guest" } : { threadId, deletedBy: "Guest" } });
    assertMessageSuccess(commentId ? "delete comment" : "delete thread", response);
    await loadAndRenderPins();
  } catch (err) { dbgErr(`deleteCommentOrThread: ${(err as Error)?.message ?? err}`); }
}

// ── SDK callback wiring ───────────────────────────────────────────────────────────

wireSdkCallbacks({ onCreate: submitNewComment, onReply: addReply, onResolve: resolveThread, onReopen: reopenThread, onDelete: deleteCommentOrThread });

// ── State sync ───────────────────────────────────────────────────────────────────

async function syncFromStorage(): Promise<void> {
  try {
    const response = await chrome.runtime.sendMessage({ type: "GET_TAB_COMMENTS_MODE" });
    const isOn = (response?.isOn as boolean | undefined) ?? false;
    if (isOn) { await activateCommentsModeFromHandlers(); } else { deactivateCommentsModeFromHandlers(); }
  } catch (err) { dbgErr(`syncFromStorage: ${(err as Error)?.message ?? err}`); }
}

async function activateCommentsModeFromHandlers(): Promise<void> { const { activateCommentsMode } = await import("./comment-ui.js"); await activateCommentsMode(); }
function deactivateCommentsModeFromHandlers(): void { const { deactivateCommentsMode } = require("./comment-ui.js"); deactivateCommentsMode(); }

// ── Message listener ──────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message: { type: string; payload?: unknown }, _sender, _sendResponse: (response: unknown) => void) => {
  switch (message.type) {
    case "PAGE_UNDERSTANDING_ACTION": {
      const { action, payload } = message as { type: string; action: string; payload: Record<string, unknown> };
      void (async (): Promise<void> => {
        try {
          let data: unknown;
          if (action === "get_page_map") {
            const { collectPageMap } = await import("./page-map-collector.js");
            data = collectPageMap(payload as Parameters<typeof collectPageMap>[0]);
            // Save to CS-local store so diff_snapshots fallback can access snapshots
            // even after a service worker restart wipes the SW's in-memory store.
            const { defaultStore, isVersionedSnapshot } = await import("../relay-definitions.js");
            if (isVersionedSnapshot(data)) { await defaultStore.save((data as { pageId: string }).pageId, data as Parameters<typeof defaultStore.save>[1]); }
          }
          else if (action === "inspect_element") { const { inspectElement } = await import("./element-inspector.js"); data = inspectElement(payload as Parameters<typeof inspectElement>[0]); }
          else if (action === "get_dom_excerpt") { const { getDomExcerpt } = await import("./element-inspector.js"); const { selector = "body", maxDepth, maxLength } = payload as { selector?: string; maxDepth?: number; maxLength?: number }; data = getDomExcerpt(selector, maxDepth, maxLength); }
          else if (action === "wait_for") { const { handleWaitForAction } = await import("./wait-provider.js"); data = await handleWaitForAction(payload); }
          else if (action === "get_text_map") { const { collectTextMap } = await import("./text-map-collector.js"); data = collectTextMap(payload as Parameters<typeof collectTextMap>[0]); }
          else if (action === "get_semantic_graph") { const { collectSemanticGraph } = await import("./semantic-graph-collector.js"); data = collectSemanticGraph(payload as Parameters<typeof collectSemanticGraph>[0]); }
          else if (action === "get_spatial_relations") { const { handleGetSpatialRelationsAction } = await import("./spatial-relations-handler.js"); const result = handleGetSpatialRelationsAction(payload); if ("error" in result) { _sendResponse({ error: result["error"] }); return; } data = result["data"]; }
          else if (action === "diff_snapshots") {
            const { defaultStore } = await import("../relay-definitions.js");
            const { computeDiff } = await import("../diff-engine.js");
            const fromId = typeof payload.fromSnapshotId === "string" ? payload.fromSnapshotId : undefined;
            const toId = typeof payload.toSnapshotId === "string" ? payload.toSnapshotId : undefined;
            if (!fromId || !toId) { _sendResponse({ error: "invalid-request" }); return; }
            const fromResult = await defaultStore.get(fromId);
            if ("error" in fromResult) {
              const errCode = defaultStore.isStale(fromId) ? "snapshot-stale" : "snapshot-not-found";
              _sendResponse({ error: errCode }); return;
            }
            const toResult = await defaultStore.get(toId);
            if ("error" in toResult) {
              const errCode = defaultStore.isStale(toId) ? "snapshot-stale" : "snapshot-not-found";
              _sendResponse({ error: errCode }); return;
            }
            data = computeDiff(fromResult, toResult);
          }
          else { _sendResponse({ error: "unsupported-action" }); return; }
          _sendResponse({ data });
        } catch { _sendResponse({ error: "action-failed" }); }
      })();
      return true;
    }
    case "CAPTURE_SNAPSHOT_ENVELOPE": {
      const { source } = (message as { type: string; source?: "dom" | "visual" });
      void (async (): Promise<void> => { try { const { captureSnapshotEnvelope } = await import("../snapshot-versioning.js"); _sendResponse(captureSnapshotEnvelope(source ?? "dom")); } catch { _sendResponse({ error: "envelope-failed" }); } })();
      return true;
    }
    case "RESOLVE_ANCHOR_BOUNDS": {
      const { anchorKey, nodeRef, padding = 8 } = (message as { anchorKey?: string; nodeRef?: string; padding?: number });
      void (async (): Promise<void> => {
        try {
          const { resolveAnchorKey } = await import("./enhanced-anchor.js");
          const { getElementByRef } = await import("./page-map-traversal.js");
          if (!anchorKey && !nodeRef) { _sendResponse({ error: "no-ref" }); return; }
          const element = nodeRef
            ? getElementByRef(nodeRef)
            : anchorKey
              ? resolveAnchorKey(anchorKey)
              : null;
          if (!element) { _sendResponse({ error: "not-found" }); return; }
          const rect = element.getBoundingClientRect();
          // CR-F-12: Detect element-off-screen — bounding box is entirely outside viewport
          if (rect.right < 0 || rect.bottom < 0 || rect.left > window.innerWidth || rect.top > window.innerHeight) {
            _sendResponse({ error: "element-off-screen" }); return;
          }
          const pad = typeof padding === "number" ? padding : 8;
          _sendResponse({ bounds: { x: Math.max(0, rect.left - pad), y: Math.max(0, rect.top + window.scrollY - pad), width: rect.width + pad * 2, height: rect.height + pad * 2 } });
        } catch { _sendResponse({ error: "action-failed" }); }
      })();
      return true;
    }
    case "RESOLVE_ELEMENT_COORDS": {
      void (async (): Promise<void> => {
        const { uid, selector } = (message as { uid?: string; selector?: string });
        if (!uid && !selector) {
          _sendResponse({ error: "no-identifier" }); return;
        }
        let element: Element | null = null;
        if (uid) {
          const { getElementByRef } = await import("./page-map-traversal.js");
          element = getElementByRef(uid) ?? null;
          if (!element) {
            const { resolveAnchorKey } = await import("./enhanced-anchor.js");
            element = resolveAnchorKey(uid);
          }
        }
        if (!element && selector) {
          element = document.querySelector(selector);
        }
        if (!element) {
          _sendResponse({ error: "not-found" }); return;
        }
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) {
          _sendResponse({ error: "zero-size" }); return;
        }
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        const inViewport = x >= 0 && y >= 0 && x <= window.innerWidth && y <= window.innerHeight;
        _sendResponse({ x, y, bounds: { x: rect.left, y: rect.top, width: rect.width, height: rect.height }, inViewport });
      })();
      return true;
    }
    case "comments-mode-on": void activateCommentsModeFromHandlers(); break;
    case "comments-mode-off": deactivateCommentsModeFromHandlers(); break;
    case "COMMENTS_UPDATED": void loadAndRenderPins(); break;
    case "show-comment-form-at-cursor": openSdkComposerAtAnchor(document.body, "body:0:center", window.innerWidth / 2, 60); break;
    case "scroll-to-thread": { const { threadId } = (message.payload as { threadId: string }) ?? {}; if (threadId) { const sdk = getSdk(); if (sdk) sdk.openPopover(threadId); } break; }
    default: break;
  }
  return false;
});

chrome.storage.onChanged.addListener((changes, area) => { if (area === "local" && changes[STORAGE_KEY]) void syncFromStorage(); });

export function runBootstrap(): void {
  dbg("Bootstrap: calling syncFromStorage()");
  void syncFromStorage();
  dbg("Bootstrap: complete");
}
