/**
 * M80-STORE — Comment Storage Manager
 *
 * CRUD operations on comments and threads in chrome.storage.local.
 * Enforces soft-delete semantics. URL normalization. Filtered queries.
 */

import type { BrowserComment, BrowserCommentThread, PageCommentStore } from "./types.js";

export interface CommentPageSummary {
  url: string;
  lastActivity: string;
  totalThreads: number;
  openThreads: number;
  totalComments: number;
}

/**
 * Normalizes a URL to origin + pathname only (strips query params and hash).
 */
export function normalizeUrl(url: string): string {
  const parsed = new URL(url);
  return parsed.origin + parsed.pathname;
}

/**
 * Returns the storage key for a normalized URL.
 * Format: "comments:{normalizedUrl}"
 */
export function getStorageKey(normalizedUrl: string): string {
  return `comments:${normalizedUrl}`;
}

/**
 * Reads the full PageCommentStore for a URL from storage.
 * Returns null if no store exists for that URL.
 */
export async function getPageStore(
  normalizedUrl: string
): Promise<PageCommentStore | null> {
  const key = getStorageKey(normalizedUrl);
  const result = await chrome.storage.local.get(key);
  const store = result[key] as PageCommentStore | undefined;
  return store ?? null;
}

/** Saves a PageCommentStore to storage */
async function savePageStore(store: PageCommentStore): Promise<void> {
  const key = getStorageKey(store.url);
  await chrome.storage.local.set({ [key]: store });
}

/** Finds the thread and its store for a given threadId by scanning storage */
async function findThreadAndStore(
  threadId: string
): Promise<{ store: PageCommentStore; thread: BrowserCommentThread } | null> {
  const all = await chrome.storage.local.get(null);
  for (const [key, value] of Object.entries(all)) {
    if (!key.startsWith("comments:")) continue;
    const store = value as PageCommentStore;
    const thread = store.threads?.find((t) => t.id === threadId);
    if (thread) return { store, thread };
  }
  return null;
}

/**
 * Creates a new comment thread with a generated UUID.
 * The first comment's ID becomes the thread ID.
 */
export async function createThread(
  url: string,
  anchorKey: string,
  firstComment: Pick<BrowserComment, "body" | "author">,
  anchorContext?: BrowserCommentThread["anchorContext"]
): Promise<BrowserCommentThread> {
  const normalized = normalizeUrl(url);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  const comment: BrowserComment = {
    id,
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
  const store: PageCommentStore = existing ?? {
    version: "1.0",
    url: normalized,
    threads: [],
  };
  store.threads.push(thread);
  await savePageStore(store);
  return thread;
}

/**
 * Returns only non-deleted threads for a URL.
 * Filters out soft-deleted comments within active threads.
 */
export async function getActiveThreads(
  url: string
): Promise<BrowserCommentThread[]> {
  const normalized = normalizeUrl(url);
  const store = await getPageStore(normalized);
  if (!store) return [];

  return store.threads
    .filter((t) => !t.deletedAt)
    .map((t) => ({
      ...t,
      comments: t.comments.filter((c) => !c.deletedAt),
    }));
}

/**
 * Returns ALL threads for a URL, including soft-deleted.
 */
export async function getAllThreads(
  url: string
): Promise<BrowserCommentThread[]> {
  const normalized = normalizeUrl(url);
  const store = await getPageStore(normalized);
  if (!store) return [];
  return store.threads;
}

/**
 * Appends a comment to an existing thread.
 * Accepts an optional `commentId` for cross-origin ID parity.
 */
export async function addComment(
  threadId: string,
  comment: Pick<BrowserComment, "body" | "author"> & { commentId?: string }
): Promise<BrowserComment> {
  const found = await findThreadAndStore(threadId);
  if (!found) throw new Error(`Thread not found: ${threadId}`);
  const { store, thread } = found;

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

/**
 * Soft-deletes a thread by setting deletedAt. Does NOT remove from storage.
 */
export async function softDeleteThread(threadId: string): Promise<string | null> {
  const found = await findThreadAndStore(threadId);
  if (!found) return null;
  const { store, thread } = found;
  thread.deletedAt = new Date().toISOString();
  await savePageStore(store);
  return thread.pageUrl;
}

/**
 * Soft-deletes a single comment by setting deletedAt.
 */
export async function softDeleteComment(
  threadId: string,
  commentId: string
): Promise<string | null> {
  const found = await findThreadAndStore(threadId);
  if (!found) return null;
  const { store, thread } = found;
  const comment = thread.comments.find((c) => c.id === commentId);
  if (comment) {
    comment.deletedAt = new Date().toISOString();
  }
  await savePageStore(store);
  return thread.pageUrl;
}

/**
 * Updates the body of an existing comment.
 */
export async function updateComment(
  threadId: string,
  commentId: string,
  newBody: string
): Promise<void> {
  const found = await findThreadAndStore(threadId);
  if (!found) return;
  const { store, thread } = found;
  const comment = thread.comments.find((c) => c.id === commentId);
  if (comment) {
    comment.body = newBody;
  }
  await savePageStore(store);
}

/**
 * Resolves a thread: sets thread.status to "resolved" and optionally sets resolutionNote.
 */
export async function resolveThread(
  threadId: string,
  resolutionNote?: string
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

/**
 * Reopens a resolved thread: sets thread.status back to "open".
 */
export async function reopenThread(threadId: string): Promise<string | null> {
  const found = await findThreadAndStore(threadId);
  if (!found) return null;
  const { store, thread } = found;
  thread.status = "open";
  thread.lastActivity = new Date().toISOString();
  await savePageStore(store);
  return thread.pageUrl;
}

/**
 * Returns all pages that have comment data, sorted by most recent activity first.
 */
export async function getCommentPageSummaries(): Promise<CommentPageSummary[]> {
  const all = await chrome.storage.local.get(null);
  const summaries: CommentPageSummary[] = [];

  for (const [key, value] of Object.entries(all)) {
    if (!key.startsWith("comments:")) continue;
    const store = value as PageCommentStore | undefined;
    if (!store || !Array.isArray(store.threads)) continue;

    const threads = store.threads;
    if (threads.length === 0) continue;

    const sortedByActivity = [...threads].sort((a, b) => {
      return new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime();
    });
    const lastActivity = sortedByActivity[0]?.lastActivity ?? new Date(0).toISOString();

    const activeThreads = threads.filter((t) => !t.deletedAt);
    const openThreads = activeThreads.filter((t) => t.status === "open").length;
    const totalComments = activeThreads.reduce((sum, t) => {
      const activeComments = t.comments.filter((c) => !c.deletedAt).length;
      return sum + activeComments;
    }, 0);

    summaries.push({
      url: store.url,
      lastActivity,
      totalThreads: activeThreads.length,
      openThreads,
      totalComments,
    });
  }

  summaries.sort((a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime());
  return summaries;
}
