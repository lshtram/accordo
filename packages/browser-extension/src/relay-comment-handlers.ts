/**
 * relay-comment-handlers.ts — Handler implementations for comment relay actions.
 *
 * Handlers: get_all_comments, get_comments, create_comment, reply_comment,
 * delete_comment, resolve_thread, reopen_thread, delete_thread,
 * notify_comments_updated.
 *
 * @module
 */

import {
  addComment,
  createThread,
  getActiveThreads,
  getCommentPageSummaries,
  reopenThread,
  resolveThread,
  softDeleteComment,
  softDeleteThread,
} from "./store.js";
import type { RelayActionRequest, RelayActionResponse } from "./relay-definitions.js";
import { actionFailed } from "./relay-definitions.js";
import {
  readString,
  readOptionalString,
  readAnchorContext,
} from "./relay-type-guards.js";
import {
  getActiveTabUrl,
  resolveRequestedUrl,
} from "./relay-forwarder.js";

// ── Comment Handlers ─────────────────────────────────────────────────────────

export async function handleGetAllComments(
  request: RelayActionRequest,
): Promise<RelayActionResponse> {
  const pages = await getCommentPageSummaries();
  return {
    requestId: request.requestId,
    success: true,
    data: { pages, totalPages: pages.length },
  };
}

export async function handleGetComments(
  request: RelayActionRequest,
): Promise<RelayActionResponse> {
  const url = await resolveRequestedUrl(request.payload);
  if (!url) {
    return { requestId: request.requestId, success: false, error: "invalid-request" };
  }
  const threads = await getActiveThreads(url);
  return {
    requestId: request.requestId,
    success: true,
    data: {
      url,
      activeTabUrl: await getActiveTabUrl(),
      threads,
      threadSummaries: threads.map((t) => {
        const latest = t.comments[t.comments.length - 1];
        return {
          threadId: t.id,
          status: t.status,
          anchorKey: t.anchorKey,
          anchorContext: t.anchorContext,
          lastComment: latest?.body ?? "",
          lastAuthor: latest?.author?.name ?? "",
          lastActivity: t.lastActivity,
          commentCount: t.comments.length,
        };
      }),
      totalThreads: threads.length,
      openThreads: threads.filter((t) => t.status === "open").length,
    },
  };
}

export async function handleCreateComment(
  request: RelayActionRequest,
): Promise<RelayActionResponse> {
  const body = readString(request.payload, "body");
  if (!body || !body.trim()) {
    return { requestId: request.requestId, success: false, error: "invalid-request" };
  }
  const url = await resolveRequestedUrl(request.payload);
  if (!url) {
    return { requestId: request.requestId, success: false, error: "invalid-request" };
  }
  const anchorKey = readOptionalString(request.payload, "anchorKey") ?? "body:0:center";
  const authorName = readOptionalString(request.payload, "authorName") ?? "Agent";
  const anchorContext = readAnchorContext(request.payload);

  const thread = await createThread(
    url,
    anchorKey,
    { body, author: { kind: "user", name: authorName } },
    anchorContext,
  );
  return { requestId: request.requestId, success: true, data: { ...thread, pageUrl: thread.pageUrl } };
}

export async function handleReplyComment(
  request: RelayActionRequest,
): Promise<RelayActionResponse> {
  const threadId = readString(request.payload, "threadId");
  const body = readString(request.payload, "body");
  const authorName = readOptionalString(request.payload, "authorName") ?? "Agent";
  const commentId = readOptionalString(request.payload, "commentId");
  const comment = await addComment(threadId, {
    body,
    author: { kind: "user", name: authorName },
    commentId,
  });
  return { requestId: request.requestId, success: true, data: { ...comment, pageUrl: comment.pageUrl } };
}

export async function handleDeleteComment(
  request: RelayActionRequest,
): Promise<RelayActionResponse> {
  const threadId = readString(request.payload, "threadId");
  const commentId = readString(request.payload, "commentId");
  const pageUrl = await softDeleteComment(threadId, commentId);
  if (!pageUrl) {
    return actionFailed(request);
  }
  return { requestId: request.requestId, success: true, data: { pageUrl } };
}

export async function handleResolveThread(
  request: RelayActionRequest,
): Promise<RelayActionResponse> {
  const threadId = readString(request.payload, "threadId");
  const resolutionNote = readOptionalString(request.payload, "resolutionNote");
  const pageUrl = await resolveThread(threadId, resolutionNote);
  if (!pageUrl) {
    return actionFailed(request);
  }
  return { requestId: request.requestId, success: true, data: { pageUrl } };
}

export async function handleReopenThread(
  request: RelayActionRequest,
): Promise<RelayActionResponse> {
  const threadId = readString(request.payload, "threadId");
  const pageUrl = await reopenThread(threadId);
  if (!pageUrl) {
    return actionFailed(request);
  }
  return { requestId: request.requestId, success: true, data: { pageUrl } };
}

export async function handleDeleteThread(
  request: RelayActionRequest,
): Promise<RelayActionResponse> {
  const threadId = readString(request.payload, "threadId");
  const pageUrl = await softDeleteThread(threadId);
  if (!pageUrl) {
    return actionFailed(request);
  }
  return { requestId: request.requestId, success: true, data: { pageUrl } };
}

export async function handleNotifyCommentsUpdated(
  request: RelayActionRequest,
): Promise<RelayActionResponse> {
  const url = readOptionalString(request.payload, "url");
  const threadId = readOptionalString(request.payload, "threadId");

  // Optional local-delete sync path for VS Code-originated removals where
  // only threadId is known (no URL available at notifier call site).
  let pageUrl: string | null = null;
  if (threadId) {
    pageUrl = await softDeleteThread(threadId);
  }

  // Returns immediately — broadcastCommentsUpdated is triggered by
  // handleRelayActionWithBroadcast in service-worker.ts
  return {
    requestId: request.requestId,
    success: true,
    data: { url: pageUrl ?? url, pageUrl: pageUrl ?? url },
  };
}
