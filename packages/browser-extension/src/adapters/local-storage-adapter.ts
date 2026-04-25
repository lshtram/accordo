import type { BrowserCommentThread } from "../types.js";
import {
  addComment as storeAddComment,
  createThread as storeCreateThread,
  getActiveThreads,
  normalizeUrl,
  reopenThread as storeReopenThread,
  resolveThread as storeResolveThread,
  softDeleteComment as storeSoftDeleteComment,
  softDeleteThread as storeSoftDeleteThread,
} from "../store.js";
import type { CommentBackendAdapter, CommentThreadSummary, CreateThreadParams, ReplyParams } from "./comment-backend-types.js";
import { toSummary } from "./comment-backend-types.js";

export class LocalStorageAdapter implements CommentBackendAdapter {
  async listThreads(url: string): Promise<CommentThreadSummary[]> {
    const normalized = normalizeUrl(url);
    const threads = await getActiveThreads(normalized);
    return threads.map((thread) => toSummary(thread));
  }

  async createThread(params: CreateThreadParams): Promise<{ threadId: string; commentId: string; pageUrl: string }> {
    const normalized = normalizeUrl(params.url);
    const thread = await storeCreateThread(normalized, params.anchorKey, {
      body: params.body,
      author: { kind: "user", name: params.authorName ?? "anonymous" },
    }, params.anchorContext);
    const firstComment = thread.comments[0];
    return { threadId: thread.id, commentId: firstComment.id, pageUrl: thread.pageUrl };
  }

  async reply(params: ReplyParams): Promise<{ commentId: string; body: string; pageUrl: string }> {
    const newComment = await storeAddComment(params.threadId, {
      body: params.body,
      author: { kind: "user", name: params.authorName ?? "anonymous" },
      commentId: params.commentId,
    });
    return { commentId: newComment.id, body: newComment.body, pageUrl: newComment.pageUrl };
  }

  async resolve(threadId: string, resolutionNote?: string): Promise<void> {
    await storeResolveThread(threadId, resolutionNote);
  }

  async reopen(threadId: string): Promise<void> {
    await storeReopenThread(threadId);
  }

  async delete(threadId: string, commentId?: string): Promise<void> {
    if (commentId) await storeSoftDeleteComment(threadId, commentId);
    else await storeSoftDeleteThread(threadId);
  }

  isConnected(): boolean {
    return true;
  }
}
