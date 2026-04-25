/**
 * Message handlers — chrome.runtime.onMessage dispatcher and message wrappers.
 * Consumed by content-entry.ts (IIFE bootstrap).
 */

import type { BrowserCommentThread } from "../types.js";
import {
  dbg, dbgErr, assertMessageSuccess,
  getSdk, wireSdkCallbacks, loadAndRenderPins,
} from "./comment-ui.js";
import {
  handleCaptureSnapshotEnvelopeMessage,
  handleFocusElementMessage,
  handlePageUnderstandingActionMessage,
  handleResolveAnchorBoundsMessage,
  handleResolveElementCoordsMessage,
  handleScrollElementIntoViewMessage,
  handleTypeInElementMessage,
} from "./message-page-actions.js";
import { openSdkComposerAtAnchor } from "./sdk-convergence.js";

const STORAGE_KEY = "commentsMode";

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

wireSdkCallbacks({ onCreate: submitNewComment, onReply: addReply, onResolve: resolveThread, onReopen: reopenThread, onDelete: deleteCommentOrThread });

async function syncFromStorage(): Promise<void> {
  try {
    const response = await chrome.runtime.sendMessage({ type: "GET_TAB_COMMENTS_MODE" });
    const isOn = (response?.isOn as boolean | undefined) ?? false;
    if (isOn) { await activateCommentsModeFromHandlers(); } else { await deactivateCommentsModeFromHandlers(); }
  } catch (err) { dbgErr(`syncFromStorage: ${(err as Error)?.message ?? err}`); }
}

async function activateCommentsModeFromHandlers(): Promise<void> { const { activateCommentsMode } = await import("./comment-ui.js"); await activateCommentsMode(); }
async function deactivateCommentsModeFromHandlers(): Promise<void> { const { deactivateCommentsMode } = await import("./comment-ui.js"); deactivateCommentsMode(); }

chrome.runtime.onMessage.addListener((message: { type: string; payload?: unknown }, _sender, sendResponse: (response: unknown) => void) => {
  switch (message.type) {
    case "PAGE_UNDERSTANDING_ACTION": {
      const { action, payload } = message as { type: string; action: string; payload: Record<string, unknown> };
      void handlePageUnderstandingActionMessage(action, payload, sendResponse);
      return true;
    }
    case "CAPTURE_SNAPSHOT_ENVELOPE": {
      const { source } = (message as { type: string; source?: "dom" | "visual" });
      void handleCaptureSnapshotEnvelopeMessage(source, sendResponse);
      return true;
    }
    case "RESOLVE_ANCHOR_BOUNDS": {
      const { anchorKey, nodeRef, padding = 8 } = (message as { anchorKey?: string; nodeRef?: string; padding?: number });
      void handleResolveAnchorBoundsMessage(anchorKey, nodeRef, padding, sendResponse);
      return true;
    }
    case "RESOLVE_ELEMENT_COORDS": {
      const { uid, selector } = (message as { uid?: string; selector?: string });
      void handleResolveElementCoordsMessage(uid, selector, sendResponse);
      return true;
    }
    case "FOCUS_ELEMENT": {
      const { uid, selector, clearFirst } = (message as { uid?: string; selector?: string; clearFirst?: boolean });
      void handleFocusElementMessage(uid, selector, clearFirst, sendResponse);
      return true;
    }
    case "TYPE_IN_ELEMENT": {
      const { uid, selector, text, clearFirst } = (message as { uid?: string; selector?: string; text?: string; clearFirst?: boolean });
      void handleTypeInElementMessage(uid, selector, text, clearFirst, sendResponse);
      return true;
    }
    case "SCROLL_ELEMENT_INTO_VIEW": {
      const { uid, selector } = (message as { uid?: string; selector?: string });
      void handleScrollElementIntoViewMessage(uid, selector, sendResponse);
      return true;
    }
    case "comments-mode-on": void activateCommentsModeFromHandlers(); break;
    case "comments-mode-off": void deactivateCommentsModeFromHandlers(); break;
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
