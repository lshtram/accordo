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
import {
  persistMergedBrowserCommentSyncState,
  loadBrowserCommentSyncDocumentFromStorage,
  type BrowserCommentSyncPage,
  type BrowserCommentSyncThread,
  type BrowserCommentSyncComment,
} from "./browser-comment-sync-store.js";
import { getAllThreads, getCommentPageSummaries } from "./store.js";
import type { BrowserComment, BrowserCommentThread } from "./types.js";
import { getStorageKey, normalizeUrl } from "./store-keys.js";
import { MESSAGE_TYPES } from "./constants.js";

function countSyncStatePages(pages: BrowserCommentSyncPage[]): { pageCount: number; threadCount: number; commentCount: number } {
  const threadCount = pages.reduce((sum, page) => sum + page.threads.length, 0);
  const commentCount = pages.reduce(
    (sum, page) => sum + page.threads.reduce((threadSum, thread) => threadSum + thread.comments.length, 0),
    0,
  );
  return { pageCount: pages.length, threadCount, commentCount };
}

function toSyncComment(comment: BrowserComment): BrowserCommentSyncComment {
  return {
    id: comment.id,
    threadId: comment.threadId,
    createdAt: comment.createdAt,
    author: {
      kind: comment.author.kind,
      name: comment.author.name,
    },
    body: comment.body,
    anchorKey: comment.anchorKey,
    status: comment.status,
    ...(comment.deletedAt ? { deletedAt: comment.deletedAt } : {}),
  };
}

function toSyncThread(thread: BrowserCommentThread): BrowserCommentSyncThread {
  return {
    id: thread.id,
    anchorKey: thread.anchorKey,
    pageUrl: thread.pageUrl,
    status: thread.status,
    ...(thread.deletedAt ? { deletedAt: thread.deletedAt } : {}),
    comments: thread.comments.map(toSyncComment),
    createdAt: thread.createdAt,
    lastActivity: thread.lastActivity,
  };
}

async function loadFullBrowserCommentSyncPages(): Promise<BrowserCommentSyncPage[]> {
  const summaries = await getCommentPageSummaries();
  const pages: BrowserCommentSyncPage[] = [];

  for (const summary of summaries) {
    const threads = await getAllThreads(summary.url);
    pages.push({
      pageUrl: summary.url,
      threads: threads.map(toSyncThread),
    });
  }

  return pages;
}

function toLegacyThread(thread: BrowserCommentSyncThread): BrowserCommentThread {
  return {
    id: thread.id,
    anchorKey: thread.anchorKey,
    pageUrl: normalizeUrl(thread.pageUrl),
    status: thread.status,
    comments: thread.comments.map((comment) => ({
      id: comment.id,
      threadId: comment.threadId,
      createdAt: comment.createdAt,
      author: comment.author,
      body: comment.body,
      anchorKey: comment.anchorKey,
      pageUrl: normalizeUrl(thread.pageUrl),
      status: comment.status,
      ...(comment.deletedAt ? { deletedAt: comment.deletedAt } : {}),
    })),
    createdAt: thread.createdAt,
    lastActivity: thread.lastActivity,
    ...(thread.deletedAt ? { deletedAt: thread.deletedAt } : {}),
  };
}

async function replaceLegacyPageStoresFromSyncPages(pages: BrowserCommentSyncPage[]): Promise<void> {
  const all = await chrome.storage.local.get(null);
  const incomingKeys = new Set(pages.map((page) => getStorageKey(normalizeUrl(page.pageUrl))));
  const staleKeys = Object.keys(all).filter((key) => key.startsWith("comments:") && !incomingKeys.has(key));
  if (staleKeys.length > 0) await chrome.storage.local.remove(staleKeys);

  const nextStores: Record<string, unknown> = {};
  for (const page of pages) {
    const normalized = normalizeUrl(page.pageUrl);
    nextStores[getStorageKey(normalized)] = {
      version: "1.0",
      url: normalized,
      threads: page.threads.map(toLegacyThread),
    };
  }
  if (Object.keys(nextStores).length > 0) await chrome.storage.local.set(nextStores);
}

async function broadcastSyncPagesUpdated(pages: BrowserCommentSyncPage[]): Promise<void> {
  const pageUrls = new Set(pages.map((page) => normalizeUrl(page.pageUrl)));
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.map(async (tab) => {
    if (!tab.id || !tab.url) return;
    let normalized: string;
    try {
      normalized = normalizeUrl(tab.url);
    } catch {
      return;
    }
    if (!pageUrls.has(normalized)) return;
    await chrome.tabs.sendMessage(tab.id, { type: MESSAGE_TYPES.COMMENTS_UPDATED, payload: { url: normalized } }).catch(() => {});
  }));
  await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.COMMENTS_UPDATED }).catch(() => {});
}

async function persistMergedStateForRuntimeReaders(mergedState: {
  schemaVersion: string;
  browserRevision: number;
  accordoRevision: number;
  emittedBy: string;
  generatedAt: string;
  pages: BrowserCommentSyncPage[];
}): Promise<void> {
  await persistMergedBrowserCommentSyncState(mergedState);
  await replaceLegacyPageStoresFromSyncPages(mergedState.pages);
  await broadcastSyncPagesUpdated(mergedState.pages);
}

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

    await persistMergedStateForRuntimeReaders(mergedState);
    const counts = countSyncStatePages(mergedState.pages);
    console.warn("[Accordo Sync] persisted merged browser comment state", {
      browserRevision: mergedState.browserRevision,
      accordoRevision: mergedState.accordoRevision,
      ...counts,
      firstThreadId: mergedState.pages[0]?.threads[0]?.id ?? null,
    });

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
 * The browser extension reads its canonical store, calls back to VSCode via
 * sync_comment_state (using request() to wait for the merged response), persists
 * the merged result, and returns the merged state as the response data.
 *
 * Canonical protocol (Accordo-initiated):
 *   1. VSCode calls syncBrowserComments() → sends request_comment_state_sync to browser
 *   2. This handler reads canonical store, calls back via sync_comment_state (request())
 *   3. VSCode applies browser state and returns merged state in sync_comment_state response
 *   4. This handler receives merged state in request() response, persists it
 *   5. Returns merged state as response data so syncBrowserComments() receives it
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
    // Read canonical store for the current full browser state to send to VSCode.
    // This is the state accumulated since the last sync response was received.
    const doc = await loadBrowserCommentSyncDocumentFromStorage();
    const livePages = await loadFullBrowserCommentSyncPages();
    const pages = livePages.length > 0 ? livePages : (doc.pages as BrowserCommentSyncPage[]);
    const fullState = {
      schemaVersion: "2.0" as const,
      browserRevision: doc.meta.lastSentBrowserRevision,
      accordoRevision: doc.meta.lastPersistedAccordoRevision,
      emittedBy: "browser-extension" as const,
      generatedAt: new Date().toISOString(),
      pages,
    };
    console.warn("[Accordo Sync] sending browser full comment state", {
      browserRevision: fullState.browserRevision,
      accordoRevision: fullState.accordoRevision,
      ...countSyncStatePages(fullState.pages),
      firstThreadId: fullState.pages[0]?.threads[0]?.id ?? null,
    });

    // Call back to VSCode via sync_comment_state to receive the merged response.
    // VSCode's handler applies the browser state and returns merged state in response data.
    // relay.send() is already a request-response call (waits for response), so we use it here.
    const response = await relay.send("sync_comment_state", fullState, 10000);

    if (!response.success) {
      return {
        requestId: request.requestId,
        success: false,
        error: "action-failed",
        ...getErrorMeta("action-failed"),
      };
    }

    // Persist the merged state returned by VSCode (in response.data)
    const mergedState = response.data as {
      schemaVersion: string;
      browserRevision: number;
      accordoRevision: number;
      emittedBy: string;
      generatedAt: string;
      pages: BrowserCommentSyncPage[];
    };

    await persistMergedStateForRuntimeReaders(mergedState);
    console.warn("[Accordo Sync] persisted merged response after full-state roundtrip", {
      browserRevision: mergedState.browserRevision,
      accordoRevision: mergedState.accordoRevision,
      ...countSyncStatePages(mergedState.pages),
      firstThreadId: mergedState.pages[0]?.threads[0]?.id ?? null,
    });

    // Note: UI refresh is handled via chrome messaging / storage listeners in production.
    // The canonical storage is now updated; any UI component can read from it.

    // Return the merged state as response data so syncBrowserComments() receives it.
    return {
      requestId: request.requestId,
      success: true,
      data: mergedState,
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
