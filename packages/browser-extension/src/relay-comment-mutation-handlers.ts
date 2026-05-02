import type { RelayActionRequest, RelayActionResponse } from "./relay-definitions.js";
import { actionFailed, getErrorMeta } from "./relay-definitions.js";
import { readAnchorContext, readOptionalString, readString } from "./relay-type-guards.js";
import { resolveRequestedUrl } from "./relay-forwarder.js";
import { softDeleteThread } from "./store.js";
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
