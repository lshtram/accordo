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
  getActiveThreads,
  getAllThreads,
  getCommentPageSummaries,
} from "./store.js";
import type { RelayActionRequest, RelayActionResponse } from "./relay-definitions.js";
import { actionFailed, getErrorMeta } from "./relay-definitions.js";
import {
  readOptionalBoolean,
  readString,
} from "./relay-type-guards.js";
import {
  getActiveTabUrl,
  resolveRequestedUrl,
} from "./relay-forwarder.js";
export { setRelayClient } from "./relay-comment-runtime.js";
import { getAdapter, toThreadSummary } from "./relay-comment-runtime.js";
export {
  handleCreateComment,
  handleDeleteComment,
  handleDeleteThread,
  handleFocusThread,
  handleNotifyCommentsUpdated,
  handleReopenThread,
  handleReplyComment,
  handleResolveThread,
} from "./relay-comment-mutation-handlers.js";

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
  const includeDeleted = readOptionalBoolean(request.payload, "includeDeleted") === true;
  const rawThreads = includeDeleted ? await getAllThreads(url) : await getActiveThreads(url);
  const threads = rawThreads.filter((thread) => includeDeleted || !thread.deletedAt);
  return {
    requestId: request.requestId,
    success: true,
    data: {
      url,
      activeTabUrl: await getActiveTabUrl(),
      includesDeleted: includeDeleted,
      threads,
      threadSummaries: threads.map(toThreadSummary),
      totalThreads: threads.length,
      openThreads: threads.filter((t) => t.status === "open").length,
    },
  };
}
