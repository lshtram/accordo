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
  getCommentPageSummaries,
} from "./store.js";
import type { RelayActionRequest, RelayActionResponse } from "./relay-definitions.js";
import { actionFailed, getErrorMeta } from "./relay-definitions.js";
import {
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
  const threads = await getActiveThreads(url);
  return {
    requestId: request.requestId,
    success: true,
    data: {
      url,
      activeTabUrl: await getActiveTabUrl(),
      threads,
      threadSummaries: threads.map(toThreadSummary),
      totalThreads: threads.length,
      openThreads: threads.filter((t) => t.status === "open").length,
    },
  };
}
