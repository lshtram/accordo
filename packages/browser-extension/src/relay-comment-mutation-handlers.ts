import type { RelayActionRequest, RelayActionResponse } from "./relay-definitions.js";
import { actionFailed, getErrorMeta } from "./relay-definitions.js";
import { readAnchorContext, readOptionalString, readString } from "./relay-type-guards.js";
import { resolveRequestedUrl } from "./relay-forwarder.js";
import { softDeleteThread, normalizeUrl, findThreadAndStore } from "./store.js";
import { getAdapter } from "./relay-comment-runtime.js";
import { LocalStorageAdapter, type CommentBackendAdapter } from "./adapters/comment-backend.js";

const ACCORDO_BROWSER_NOTIFIER_SOURCE = "accordo-browser-notifier";

function getMutationAdapter(payload: Record<string, unknown>): CommentBackendAdapter {
  if (payload["source"] === ACCORDO_BROWSER_NOTIFIER_SOURCE) {
    return new LocalStorageAdapter();
  }
  return getAdapter();
}

export async function handleCreateComment(
  request: RelayActionRequest,
): Promise<RelayActionResponse> {
  const body = readString(request.payload, "body");
  if (!body || !body.trim()) {
    return { requestId: request.requestId, success: false, error: "invalid-request", ...getErrorMeta("invalid-request") };
  }
  const url = await resolveRequestedUrl(request.payload);
  if (!url) {
    return { requestId: request.requestId, success: false, error: "invalid-request", ...getErrorMeta("invalid-request") };
  }
  const anchorKey = readOptionalString(request.payload, "anchorKey") ?? "body:0:center";
  const authorName = readOptionalString(request.payload, "authorName") ?? "Agent";
  const anchorContext = readAnchorContext(request.payload);

  const threadId = readOptionalString(request.payload, "threadId");
  const commentId = readOptionalString(request.payload, "commentId");
  const thread = await getMutationAdapter(request.payload).createThread({ url, anchorKey, body, authorName, threadId, commentId, anchorContext });
  return {
    requestId: request.requestId,
    success: true,
    data: { pageUrl: thread.pageUrl, comments: [{ body, id: thread.commentId }] },
  };
}

export async function handleReplyComment(
  request: RelayActionRequest,
): Promise<RelayActionResponse> {
  const threadId = readString(request.payload, "threadId");
  const body = readString(request.payload, "body");
  const authorName = readOptionalString(request.payload, "authorName") ?? "Agent";
  const commentId = readOptionalString(request.payload, "commentId");
  const comment = await getMutationAdapter(request.payload).reply({ threadId, body, authorName, commentId });
  return { requestId: request.requestId, success: true, data: { ...comment, pageUrl: comment.pageUrl } };
}

export async function handleDeleteComment(
  request: RelayActionRequest,
): Promise<RelayActionResponse> {
  const threadId = readString(request.payload, "threadId");
  const commentId = readString(request.payload, "commentId");
  try {
    await getAdapter().delete(threadId, commentId);
    return { requestId: request.requestId, success: true, data: {} };
  } catch {
    return actionFailed(request);
  }
}

export async function handleResolveThread(
  request: RelayActionRequest,
): Promise<RelayActionResponse> {
  const threadId = readString(request.payload, "threadId");
  const resolutionNote = readOptionalString(request.payload, "resolutionNote");
  try {
    await getAdapter().resolve(threadId, resolutionNote);
    return { requestId: request.requestId, success: true, data: {} };
  } catch {
    return actionFailed(request);
  }
}

export async function handleReopenThread(
  request: RelayActionRequest,
): Promise<RelayActionResponse> {
  const threadId = readString(request.payload, "threadId");
  try {
    await getAdapter().reopen(threadId);
    return { requestId: request.requestId, success: true, data: {} };
  } catch {
    return actionFailed(request);
  }
}

export async function handleDeleteThread(
  request: RelayActionRequest,
): Promise<RelayActionResponse> {
  const threadId = readString(request.payload, "threadId");
  try {
    await getAdapter().delete(threadId);
    return { requestId: request.requestId, success: true, data: {} };
  } catch {
    return actionFailed(request);
  }
}

export async function handleNotifyCommentsUpdated(
  request: RelayActionRequest,
): Promise<RelayActionResponse> {
  const url = readOptionalString(request.payload, "url");
  const threadId = readOptionalString(request.payload, "threadId");
  let pageUrl: string | null = null;
  if (threadId) {
    pageUrl = await softDeleteThread(threadId);
  }
  return {
    requestId: request.requestId,
    success: true,
    data: { url: pageUrl ?? url, pageUrl: pageUrl ?? url },
  };
}

/**
 * BR-F-102: handle focus_thread relay action.
 *
 * Finds the tab whose normalized URL (origin + pathname) matches the thread's
 * stored page URL, activates that tab, focuses its window, and sends a
 * scroll-to-thread message to the content script so the popover opens.
 */
export async function handleFocusThread(
  request: RelayActionRequest,
): Promise<RelayActionResponse> {
  const threadId = readString(request.payload, "threadId");

  const found = await findThreadAndStore(threadId);
  if (!found) {
    return { requestId: request.requestId, success: false, error: "action-failed", ...getErrorMeta("action-failed") };
  }

  const storeUrl = found.store.url;
  const normalizedTarget = normalizeUrl(storeUrl);

  // Find the tab whose normalized URL (origin + pathname) matches the stored page URL.
  const tabs = await chrome.tabs.query({});
  const matchingTab = tabs.find((tab) => {
    if (!tab.id || !tab.url) return false;
    try {
      return normalizeUrl(tab.url) === normalizedTarget;
    } catch {
      return false;
    }
  });

  if (!matchingTab?.id) {
    return { requestId: request.requestId, success: false, error: "action-failed", ...getErrorMeta("action-failed") };
  }

  // Focus the window that contains the matching tab.
  if (matchingTab.windowId !== undefined) {
    await chrome.windows.update(matchingTab.windowId, { focused: true }).catch(() => {});
  }

  // Activate the tab.
  await chrome.tabs.update(matchingTab.id, { active: true });

  // Send scroll-to-thread to content script in that tab.
  await chrome.tabs.sendMessage(matchingTab.id, {
    type: "scroll-to-thread",
    payload: { threadId },
  }).catch(() => {});

  return { requestId: request.requestId, success: true, data: {} };
}
