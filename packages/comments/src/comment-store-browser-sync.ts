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

import type { CommentAnchor, CommentAuthor } from "@accordo/bridge-types";
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
  for (const id of repo.getDeletedThreadIds()) {
    if (!incomingThreadIds.has(id)) repo.unmarkDeletedThread(id);
  }
  for (const id of repo.getDeletedCommentIds()) {
    if (!incomingCommentIds.has(id)) repo.unmarkDeletedComment(id);
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
      coordinates: { type: "normalized", x: 0.5, y: 0.5 },
    };
  }
  return {
    kind: "text",
    uri: pageUrl,
    range: { startLine: 0, startChar: 0, endLine: 0, endChar: 0 },
    docVersion: 0,
  };
}

/**
 * Apply all threads from all browser-sync pages to the repository.
 * Handles tombstone marking and thread/comment upsert for each page.
 */
export function applyBrowserStatePages(repo: CommentRepository, pages: BrowserCommentSyncPage[]): void {
  for (const page of pages) {
    for (const remoteThread of page.threads) {
      // Mark tombstones for deleted threads and comments
      if (remoteThread.deletedAt) {
        repo.markDeletedThread(remoteThread.id);
      }
      for (const remoteComment of remoteThread.comments) {
        if (remoteComment.deletedAt) {
          repo.markDeletedComment(remoteComment.id);
        }
      }

      // Upsert thread — skip entirely-removed threads (tombstones already marked above)
      if (remoteThread.deletedAt) continue;

      const existingThread = repo.getThread(remoteThread.id);
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
  const commentAnchor = buildBrowserCommentAnchor(pageUrl, firstComment?.anchorKey);
  const threadId = remoteThread.id;
  const now = remoteThread.createdAt || new Date().toISOString();

  const comments: import("@accordo/bridge-types").AccordoComment[] = remoteThread.comments
    .filter((c) => !c.deletedAt)
    .map((remoteComment) => ({
      id: remoteComment.id,
      threadId,
      createdAt: remoteComment.createdAt || now,
      author: remoteComment.author,
      body: remoteComment.body,
      anchor: commentAnchor,
      status: "open" as const,
    }));

  const thread: import("@accordo/bridge-types").CommentThread = {
    id: threadId,
    anchor: commentAnchor,
    comments,
    status: "open",
    retention: "volatile-browser",
    createdAt: now,
    lastActivity: now,
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
  // Sync resolution status
  if (existingThread.status !== remoteThread.status && remoteThread.status === "resolved") {
    repo.resolve({
      threadId: remoteThread.id,
      resolutionNote: "Synced from browser",
      author: { kind: "agent", name: "browser-sync" },
    });
  }

  // Upsert new comments (skip tombstones)
  const localCommentIds = new Set(existingThread.comments.map((c) => c.id));
  for (const remoteComment of remoteThread.comments) {
    if (remoteComment.deletedAt) continue;
    if (!localCommentIds.has(remoteComment.id)) {
      const now = remoteComment.createdAt || new Date().toISOString();
      const comment: import("@accordo/bridge-types").AccordoComment = {
        id: remoteComment.id,
        threadId: remoteThread.id,
        createdAt: now,
        author: remoteComment.author,
        body: remoteComment.body,
        anchor: existingThread.anchor,
        status: "open",
      };
      repo.addCommentToThread(remoteThread.id, comment);
      repo.incrementVersion();
    }
  }
}
