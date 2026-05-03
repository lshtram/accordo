/**
 * comment-store-browser-sync.ts
 *
 * Browser full-state sync orchestration for CommentStore.
 *
 * Handles the applyBrowserCommentSyncState workflow:
 *   1. collectBrowserStateIds  — collect incoming thread/comment IDs
 *   2. pruneVolatileBrowserThreads — remove volatile-browser threads no longer in incoming state
 *   3. resetStaleTombstones — clear tombstones for IDs absent from incoming state
 *   4. applyBrowserStatePages — upsert threads/comments per page from sync state
 *
 * Source: comments-architecture.md §10, requirements-comments.md M38-CT-12
 */

import type { AccordoComment, CommentAnchor, CommentThread } from "@accordo/bridge-types";
import type { CommentRepository } from "./comment-repository.js";

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Canonical browser comment sync state document.
 * This is the full-state JSON sent/received via the sync_comment_state relay action.
 */
export interface BrowserCommentSyncState {
  schemaVersion: "2.0";
  browserRevision: number;
  accordoRevision: number;
  emittedBy: "browser-extension" | "vscode-accordo";
  generatedAt: string;
  pages: BrowserCommentSyncPage[];
}

export interface BrowserCommentSyncPage {
  pageUrl: string;
  threads: BrowserCommentSyncThread[];
}

export interface BrowserCommentSyncThread {
  id: string;
  anchorKey: string;
  pageUrl: string;
  status: "open" | "resolved";
  comments: BrowserCommentSyncComment[];
  createdAt: string;
  lastActivity: string;
  deletedAt?: string;
}

export interface BrowserCommentSyncComment {
  id: string;
  threadId: string;
  createdAt: string;
  author: { kind: "user" | "agent"; name: string };
  body: string;
  anchorKey: string;
  status: "open" | "resolved";
  deletedAt?: string;
}

interface LocalBrowserCommentDeleteTombstone {
  pageUrl: string;
  threadId: string;
  comment: BrowserCommentSyncComment;
}

interface LocalBrowserDeleteTombstones {
  threads: Map<string, BrowserCommentSyncThread>;
  comments: Map<string, LocalBrowserCommentDeleteTombstone>;
}

export interface BrowserSyncTombstoneStoreFile {
  threads?: BrowserCommentSyncThread[];
  comments?: LocalBrowserCommentDeleteTombstone[];
}

const localBrowserDeleteTombstones = new WeakMap<CommentRepository, LocalBrowserDeleteTombstones>();

function tombstonesFor(repo: CommentRepository): LocalBrowserDeleteTombstones {
  let tombstones = localBrowserDeleteTombstones.get(repo);
  if (!tombstones) {
    tombstones = { threads: new Map(), comments: new Map() };
    localBrowserDeleteTombstones.set(repo, tombstones);
  }
  return tombstones;
}

export function loadBrowserSyncTombstones(
  repo: CommentRepository,
  persisted: BrowserSyncTombstoneStoreFile | undefined,
): void {
  const tombstones = tombstonesFor(repo);
  tombstones.threads.clear();
  tombstones.comments.clear();
  for (const thread of persisted?.threads ?? []) {
    if (!thread.deletedAt) continue;
    tombstones.threads.set(thread.id, thread);
    repo.markDeletedThread(thread.id);
  }
  for (const comment of persisted?.comments ?? []) {
    if (!comment.comment.deletedAt) continue;
    tombstones.comments.set(comment.comment.id, comment);
    repo.markDeletedComment(comment.comment.id);
  }
}

export function exportBrowserSyncTombstones(repo: CommentRepository): BrowserSyncTombstoneStoreFile {
  const tombstones = tombstonesFor(repo);
  return {
    threads: Array.from(tombstones.threads.values()),
    comments: Array.from(tombstones.comments.values()),
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Collect all thread/comment IDs from an incoming browser sync state.
 * Used by applyBrowserCommentSyncState to determine what to keep and what to prune.
 */
export function collectBrowserStateIds(state: BrowserCommentSyncState): {
  incomingThreadIds: Set<string>;
  incomingCommentIds: Set<string>;
} {
  const incomingThreadIds = new Set<string>();
  const incomingCommentIds = new Set<string>();

  for (const page of state.pages) {
    for (const thread of page.threads) {
      incomingThreadIds.add(thread.id);
      for (const comment of thread.comments) {
        incomingCommentIds.add(comment.id);
      }
    }
  }

  return { incomingThreadIds, incomingCommentIds };
}

/**
 * Remove any existing volatile-browser threads whose IDs are NOT present in the
 * incoming state. This implements the M38-CT-12-04 replace/override contract:
 * a thread not mentioned in the latest sync state is gone from the browser.
 */
export function pruneVolatileBrowserThreads(repo: CommentRepository, incomingThreadIds: Set<string>): void {
  for (const thread of repo.getAllThreads()) {
    if (thread.retention === "volatile-browser" && !incomingThreadIds.has(thread.id)) {
      repo.removeThreadById(thread.id);
    }
  }
}

/**
 * Reset tombstone tracking for IDs that no longer appear in the incoming state.
 * If a deleted thread/comment ID is absent from the latest sync, we clear its
 * tombstone so it doesn't persist indefinitely.
 */
export function resetStaleTombstones(
  repo: CommentRepository,
  incomingThreadIds: Set<string>,
  incomingCommentIds: Set<string>,
): void {
  const localTombstones = tombstonesFor(repo);
  for (const id of repo.getDeletedThreadIds()) {
    if (!incomingThreadIds.has(id)) {
      repo.removeThreadById(id);
      repo.unmarkDeletedThread(id);
      localTombstones.threads.delete(id);
    }
  }
  for (const id of repo.getDeletedCommentIds()) {
    if (!incomingCommentIds.has(id)) {
      repo.removeCommentById(id);
      repo.unmarkDeletedComment(id);
      localTombstones.comments.delete(id);
    }
  }
}

/**
 * Build a comment anchor for a new browser-originated thread.
 * Uses a surface anchor when an anchorKey is available; otherwise falls back
 * to a text anchor with a zero-length range.
 */
export function buildBrowserCommentAnchor(pageUrl: string, anchorKey: string | undefined): CommentAnchor {
  if (anchorKey !== undefined) {
    return {
      kind: "surface",
      uri: pageUrl,
      surfaceType: "browser",
      coordinates: { type: "block", blockId: anchorKey, blockType: "paragraph" },
    };
  }
  return {
    kind: "text",
    uri: pageUrl,
    range: { startLine: 0, startChar: 0, endLine: 0, endChar: 0 },
    docVersion: 0,
  };
}

function browserSurfaceContext(anchorKey: string | undefined): import("@accordo/bridge-types").CommentContext | undefined {
  if (!anchorKey) return undefined;
  return { surfaceMetadata: { anchorKey } };
}

/**
 * Apply all threads from all browser-sync pages to the repository.
 * Handles tombstone marking and thread/comment upsert for each page.
 */
export function applyBrowserStatePages(repo: CommentRepository, pages: BrowserCommentSyncPage[]): void {
  const localTombstones = tombstonesFor(repo);
  for (const page of pages) {
    for (const remoteThread of page.threads) {
      // Mark tombstones for deleted threads and comments
      if (remoteThread.deletedAt) {
        repo.markDeletedThread(remoteThread.id);
        localTombstones.threads.set(remoteThread.id, remoteThread);
      }
      for (const remoteComment of remoteThread.comments) {
        if (remoteComment.deletedAt) {
          repo.markDeletedComment(remoteComment.id);
          localTombstones.comments.set(remoteComment.id, {
            pageUrl: page.pageUrl,
            threadId: remoteThread.id,
            comment: remoteComment,
          });
        }
      }

      // Upsert thread — skip entirely-removed threads (tombstones already marked above)
      if (remoteThread.deletedAt) continue;
      if (repo.getDeletedThreadIds().has(remoteThread.id)) continue;

      const existingThread = repo.getRawThread(remoteThread.id);
      if (!existingThread) {
        upsertNewBrowserThread(repo, page.pageUrl, remoteThread);
      } else {
        syncExistingBrowserThread(repo, existingThread, remoteThread);
      }
    }
  }
}

/**
 * Insert a brand-new browser-originated thread into the repository.
 * All non-tombstoned comments from the remote thread are inserted.
 */
export function upsertNewBrowserThread(
  repo: CommentRepository,
  pageUrl: string,
  remoteThread: BrowserCommentSyncThread,
): void {
  const firstComment = remoteThread.comments[0];
  const commentAnchor = buildBrowserCommentAnchor(pageUrl, firstComment?.anchorKey ?? remoteThread.anchorKey);
  const threadId = remoteThread.id;
  const now = remoteThread.createdAt || new Date().toISOString();

  const comments: import("@accordo/bridge-types").AccordoComment[] = remoteThread.comments
    .filter((c) => !c.deletedAt && !repo.getDeletedCommentIds().has(c.id))
    .map((remoteComment) => ({
      id: remoteComment.id,
      threadId,
      createdAt: remoteComment.createdAt || now,
      author: remoteComment.author,
      body: remoteComment.body,
      anchor: commentAnchor,
      context: browserSurfaceContext(remoteComment.anchorKey ?? remoteThread.anchorKey),
      status: remoteComment.status,
    }));

  const thread: import("@accordo/bridge-types").CommentThread = {
    id: threadId,
    anchor: commentAnchor,
    comments,
    status: remoteThread.status,
    retention: "volatile-browser",
    createdAt: now,
    lastActivity: remoteThread.lastActivity || now,
  };

  repo.addThread(thread);
  repo.incrementVersion();
}

/**
 * Sync an already-existing browser-originated thread with incoming remote state.
 * Handles resolution status changes and new comment upserts.
 */
export function syncExistingBrowserThread(
  repo: CommentRepository,
  existingThread: import("@accordo/bridge-types").CommentThread,
  remoteThread: BrowserCommentSyncThread,
): void {
  if (existingThread.status !== remoteThread.status) {
    existingThread.status = remoteThread.status;
    repo.incrementVersion();
  }
  if (remoteThread.lastActivity && existingThread.lastActivity !== remoteThread.lastActivity) {
    existingThread.lastActivity = remoteThread.lastActivity;
    repo.incrementVersion();
  }

  // Upsert new comments (skip tombstones)
  const localCommentIds = new Set(existingThread.comments.map((c) => c.id));
  for (const remoteComment of remoteThread.comments) {
    if (remoteComment.deletedAt) continue;
    if (repo.getDeletedCommentIds().has(remoteComment.id)) continue;
    if (!localCommentIds.has(remoteComment.id)) {
      const now = remoteComment.createdAt || new Date().toISOString();
      const comment: import("@accordo/bridge-types").AccordoComment = {
        id: remoteComment.id,
        threadId: remoteThread.id,
        createdAt: now,
        author: remoteComment.author,
        body: remoteComment.body,
        anchor: existingThread.anchor,
        context: browserSurfaceContext(remoteComment.anchorKey ?? remoteThread.anchorKey),
        status: remoteComment.status,
      };
      repo.addCommentToThread(remoteThread.id, comment);
      repo.incrementVersion();
    } else {
      const existingComment = existingThread.comments.find((comment) => comment.id === remoteComment.id);
      if (existingComment) {
        let changed = false;
        if (!existingComment.context?.surfaceMetadata?.["anchorKey"]) {
          existingComment.context = browserSurfaceContext(remoteComment.anchorKey ?? remoteThread.anchorKey);
          changed = true;
        }
        if (existingComment.status !== remoteComment.status) {
          existingComment.status = remoteComment.status;
          changed = true;
        }
        if (changed) repo.incrementVersion();
      }
    }
  }
}

function normalizeBrowserPageUrl(uri: string): string {
  try {
    const parsed = new URL(uri);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.origin + parsed.pathname;
    }
  } catch {
    // fall through to original URI
  }
  return uri;
}

function anchorKeyFromThread(thread: CommentThread): string {
  const firstContext = thread.comments[0]?.context?.surfaceMetadata;
  const metadataAnchorKey = firstContext?.["anchorKey"];
  if (metadataAnchorKey) return metadataAnchorKey;
  if (thread.anchor.kind === "surface" && thread.anchor.coordinates.type === "block") {
    return thread.anchor.coordinates.blockId;
  }
  return "body:0:center";
}

function toBrowserSyncComment(
  comment: AccordoComment,
  thread: CommentThread,
  anchorKey: string,
  pageUrl: string,
): BrowserCommentSyncComment {
  return {
    id: comment.id,
    threadId: thread.id,
    createdAt: comment.createdAt,
    author: {
      kind: comment.author.kind,
      name: comment.author.name,
    },
    body: comment.body,
    anchorKey,
    status: comment.status,
  };
}

function toBrowserSyncThread(thread: CommentThread): BrowserCommentSyncThread | null {
  if (thread.anchor.kind !== "surface" || thread.anchor.surfaceType !== "browser") return null;
  const pageUrl = normalizeBrowserPageUrl(thread.anchor.uri);
  if (!pageUrl.startsWith("http://") && !pageUrl.startsWith("https://")) return null;
  const anchorKey = anchorKeyFromThread(thread);
  return {
    id: thread.id,
    anchorKey,
    pageUrl,
    status: thread.status,
    comments: thread.comments.map((comment) => toBrowserSyncComment(comment, thread, anchorKey, pageUrl)),
    createdAt: thread.createdAt,
    lastActivity: thread.lastActivity,
  };
}

export function recordLocalBrowserDelete(
  repo: CommentRepository,
  thread: CommentThread | undefined,
  commentId?: string,
): void {
  if (!thread) return;
  const syncThread = toBrowserSyncThread(thread);
  if (!syncThread) return;

  const deletedAt = new Date().toISOString();
  const localTombstones = tombstonesFor(repo);
  const shouldDeleteThread = commentId === undefined || thread.comments.length <= 1;

  if (shouldDeleteThread) {
    repo.markDeletedThread(thread.id);
    localTombstones.threads.set(thread.id, {
      ...syncThread,
      deletedAt,
      comments: syncThread.comments.map((comment) => ({ ...comment, deletedAt })),
    });
    for (const comment of syncThread.comments) {
      localTombstones.comments.delete(comment.id);
    }
    return;
  }

  const syncComment = syncThread.comments.find((comment) => comment.id === commentId);
  if (!syncComment) return;
  repo.markDeletedComment(commentId);
  localTombstones.comments.set(commentId, {
    pageUrl: syncThread.pageUrl,
    threadId: syncThread.id,
    comment: { ...syncComment, deletedAt },
  });
}

function addThreadToPages(pagesByUrl: Map<string, BrowserCommentSyncThread[]>, thread: BrowserCommentSyncThread): void {
  const threads = pagesByUrl.get(thread.pageUrl) ?? [];
  if (!threads.some((candidate) => candidate.id === thread.id)) threads.push(thread);
  pagesByUrl.set(thread.pageUrl, threads);
}

function applyLocalDeleteTombstones(
  repo: CommentRepository,
  pagesByUrl: Map<string, BrowserCommentSyncThread[]>,
): void {
  const localTombstones = tombstonesFor(repo);
  for (const tombstone of localTombstones.threads.values()) {
    addThreadToPages(pagesByUrl, tombstone);
  }

  for (const tombstone of localTombstones.comments.values()) {
    const pageThreads = pagesByUrl.get(tombstone.pageUrl) ?? [];
    const syncThread = pageThreads.find((thread) => thread.id === tombstone.threadId);
    if (syncThread) {
      if (!syncThread.comments.some((comment) => comment.id === tombstone.comment.id)) {
        syncThread.comments.push(tombstone.comment);
      }
      pagesByUrl.set(tombstone.pageUrl, pageThreads);
    }
  }
}

export function exportBrowserCommentSyncState(
  repo: CommentRepository,
  base?: Pick<BrowserCommentSyncState, "browserRevision" | "accordoRevision">,
): BrowserCommentSyncState {
  const pagesByUrl = new Map<string, BrowserCommentSyncThread[]>();
  for (const thread of repo.getAllThreads()) {
    const syncThread = toBrowserSyncThread(thread);
    if (!syncThread) continue;
    addThreadToPages(pagesByUrl, syncThread);
  }

  applyLocalDeleteTombstones(repo, pagesByUrl);

  const pages: BrowserCommentSyncPage[] = Array.from(pagesByUrl.entries()).map(([pageUrl, threads]) => ({
    pageUrl,
    threads,
  }));

  return {
    schemaVersion: "2.0",
    browserRevision: base?.browserRevision ?? 0,
    accordoRevision: (base?.accordoRevision ?? 0) + 1,
    emittedBy: "vscode-accordo",
    generatedAt: new Date().toISOString(),
    pages,
  };
}
