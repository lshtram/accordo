/**
 * M80-STORE — Comment Storage Manager
 *
 * CRUD operations on comments and threads in chrome.storage.local.
 * Enforces soft-delete semantics. URL normalization. Filtered queries.
 */

import type { BrowserComment, BrowserCommentThread, PageCommentStore } from "./types.js";

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
  firstComment: Pick<BrowserComment, "body" | "author">
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
 */
export async function addComment(
  threadId: string,
  comment: Pick<BrowserComment, "body" | "author">
): Promise<BrowserComment> {
  const found = await findThreadAndStore(threadId);
  if (!found) throw new Error(`Thread not found: ${threadId}`);
  const { store, thread } = found;

  const now = new Date().toISOString();
  const newComment: BrowserComment = {
    id: crypto.randomUUID(),
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
export async function softDeleteThread(threadId: string): Promise<void> {
  const found = await findThreadAndStore(threadId);
  if (!found) return;
  const { store, thread } = found;
  thread.deletedAt = new Date().toISOString();
  await savePageStore(store);
}

/**
 * Soft-deletes a single comment by setting deletedAt.
 */
export async function softDeleteComment(
  threadId: string,
  commentId: string
): Promise<void> {
  const found = await findThreadAndStore(threadId);
  if (!found) return;
  const { store, thread } = found;
  const comment = thread.comments.find((c) => c.id === commentId);
  if (comment) {
    comment.deletedAt = new Date().toISOString();
  }
  await savePageStore(store);
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
): Promise<void> {
  const found = await findThreadAndStore(threadId);
  if (!found) return;
  const { store, thread } = found;
  thread.status = "resolved";
  if (resolutionNote !== undefined) {
    (thread as BrowserCommentThread & { resolutionNote?: string }).resolutionNote = resolutionNote;
  }
  await savePageStore(store);
}

/**
 * Reopens a resolved thread: sets thread.status back to "open".
 */
export async function reopenThread(threadId: string): Promise<void> {
  const found = await findThreadAndStore(threadId);
  if (!found) return;
  const { store, thread } = found;
  thread.status = "open";
  await savePageStore(store);
}
