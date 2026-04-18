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
import { selectAdapter, LocalStorageAdapter, type CommentBackendAdapter } from "./adapters/comment-backend.js";
import type { RelayBridgeClient } from "./relay-bridge.js";
import { actionFailed, getErrorMeta } from "./relay-definitions.js";
import {
  readString,
  readOptionalString,
  readAnchorContext,
} from "./relay-type-guards.js";
import {
  getActiveTabUrl,
  resolveRequestedUrl,
} from "./relay-forwarder.js";

// Cached relay client reference — set once on module load
let _relay: RelayBridgeClient | null = null;

export function setRelayClient(relay: RelayBridgeClient): void {
  _relay = relay;
}

function getAdapter(): CommentBackendAdapter {
  if (!_relay) {
    // Not yet initialized (test environment or startup race) — use offline adapter
    return new LocalStorageAdapter();
  }
  return selectAdapter(_relay);
}

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
    return { requestId: request.requestId, success: false, error: "invalid-request", ...getErrorMeta("invalid-request") };
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
    return { requestId: request.requestId, success: false, error: "invalid-request", ...getErrorMeta("invalid-request") };
  }
  const url = await resolveRequestedUrl(request.payload);
  if (!url) {
    return { requestId: request.requestId, success: false, error: "invalid-request", ...getErrorMeta("invalid-request") };
  }
  const anchorKey = readOptionalString(request.payload, "anchorKey") ?? "body:0:center";
  const authorName = readOptionalString(request.payload, "authorName") ?? "Agent";
  const anchorContext = readAnchorContext(request.payload);

  const thread = await getAdapter().createThread({ url, anchorKey, body, authorName });
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
  const comment = await getAdapter().reply({ threadId, body, authorName, commentId });
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
