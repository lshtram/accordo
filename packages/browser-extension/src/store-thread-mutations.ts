import type { BrowserComment, BrowserCommentThread } from "./types.js";
import { findThreadAndStore, getPageStore, savePageStore } from "./store-page-store.js";
import { normalizeUrl } from "./store-keys.js";

export async function createThread(
  url: string,
  anchorKey: string,
  firstComment: Pick<BrowserComment, "body" | "author">,
  anchorContext?: BrowserCommentThread["anchorContext"],
  callerThreadId?: string,
  callerCommentId?: string,
): Promise<BrowserCommentThread> {
  const normalized = normalizeUrl(url);
  const id = callerThreadId ?? crypto.randomUUID();
  const now = new Date().toISOString();

  const comment: BrowserComment = {
    id: callerCommentId ?? id,
    threadId: id,
    createdAt: now,
    author: firstComment.author,
    body: firstComment.body,
    anchorKey,
    pageUrl: normalized,
    status: "open",
  };

  const thread: BrowserCommentThread = {
    id,
    anchorKey,
    pageUrl: normalized,
    status: "open",
    comments: [comment],
    createdAt: now,
    lastActivity: now,
    ...(anchorContext ? { anchorContext } : {}),
  };

  const existing = await getPageStore(normalized);
  const store = existing ?? { version: "1.0", url: normalized, threads: [] };
  store.threads.push(thread);
  await savePageStore(store);
  return thread;
}

export async function getActiveThreads(url: string): Promise<BrowserCommentThread[]> {
  const normalized = normalizeUrl(url);
  const store = await getPageStore(normalized);
  if (!store) return [];
  return store.threads.filter((t) => !t.deletedAt).map((t) => ({ ...t, comments: t.comments.filter((c) => !c.deletedAt) }));
}

export async function getAllThreads(url: string): Promise<BrowserCommentThread[]> {
  const normalized = normalizeUrl(url);
  const store = await getPageStore(normalized);
  if (!store) return [];
  return store.threads;
}

export async function addComment(
  threadId: string,
  comment: Pick<BrowserComment, "body" | "author"> & { commentId?: string },
): Promise<BrowserComment> {
  const found = await findThreadAndStore(threadId);
  if (!found) throw new Error(`Thread not found: ${threadId}`);
  const { store, thread } = found;
  if (comment.commentId) {
    const existing = thread.comments.find((candidate) => candidate.id === comment.commentId);
    if (existing) return existing;
  }
  const now = new Date().toISOString();
  const newComment: BrowserComment = {
    id: comment.commentId ?? crypto.randomUUID(),
    threadId,
    createdAt: now,
    author: comment.author,
    body: comment.body,
    anchorKey: thread.anchorKey,
    pageUrl: thread.pageUrl,
    status: "open",
  };
  thread.comments.push(newComment);
  thread.lastActivity = now;
  await savePageStore(store);
  return newComment;
}

export async function softDeleteThread(threadId: string): Promise<string | null> {
  const found = await findThreadAndStore(threadId);
  if (!found) return null;
  const { store, thread } = found;
  thread.deletedAt = new Date().toISOString();
  await savePageStore(store);
  return thread.pageUrl;
}

export async function softDeleteComment(
  threadId: string,
  commentId: string,
): Promise<string | null> {
  const found = await findThreadAndStore(threadId);
  if (!found) return null;
  const { store, thread } = found;
  const comment = thread.comments.find((c) => c.id === commentId);
  if (comment) comment.deletedAt = new Date().toISOString();
  await savePageStore(store);
  return thread.pageUrl;
}

export async function updateComment(
  threadId: string,
  commentId: string,
  newBody: string,
): Promise<void> {
  const found = await findThreadAndStore(threadId);
  if (!found) return;
  const { store, thread } = found;
  const comment = thread.comments.find((c) => c.id === commentId);
  if (comment) comment.body = newBody;
  await savePageStore(store);
}

export async function resolveThread(
  threadId: string,
  resolutionNote?: string,
): Promise<string | null> {
  const found = await findThreadAndStore(threadId);
  if (!found) return null;
  const { store, thread } = found;
  thread.status = "resolved";
  if (resolutionNote !== undefined) {
    (thread as BrowserCommentThread & { resolutionNote?: string }).resolutionNote = resolutionNote;
  }
  thread.lastActivity = new Date().toISOString();
  await savePageStore(store);
  return thread.pageUrl;
}

export async function reopenThread(threadId: string): Promise<string | null> {
  const found = await findThreadAndStore(threadId);
  if (!found) return null;
  const { store, thread } = found;
  thread.status = "open";
  thread.lastActivity = new Date().toISOString();
  await savePageStore(store);
  return thread.pageUrl;
}
