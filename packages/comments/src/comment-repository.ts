/**
 * CommentRepository — Pure in-memory domain logic.
 *
 * Owns all comment data, CRUD, filtering, staleness tracking, and serialization.
 * Zero I/O, zero vscode imports. Synchronous mutations.
 *
 * CommentStore wraps this class, delegating all domain logic here.
 * CommentStore remains responsible for persistence, event emission, and listeners.
 *
 * Source: b4a-architecture.md
 */

import type { CommentStoreFile } from "@accordo/bridge-types";
import { CommentRepositoryOps } from "./comment-store-ops.js";
import { sanitizeLoadedCommentStoreFile } from "./comment-store-validation.js";

// ── Re-export all public types ────────────────────────────────────────────────
export type {
  ListThreadsOptions,
  ListThreadsResult,
  ThreadSummary,
  CreateCommentParams,
  CreateCommentResult,
  ReplyParams,
  ReplyResult,
  ResolveParams,
  DeleteParams,
  DocumentChangeInfo,
  ChangeListener,
} from "./comment-store-io.js";

// ── CommentRepository class ──────────────────────────────────────────────────

export class CommentRepository extends CommentRepositoryOps {
  // ── Serialization ──────────────────────────────────────────────────────────

  /**
   * Populate in-memory state from a parsed CommentStoreFile.
   * Called by CommentStore.load() after reading + parsing the JSON file.
   * Clears any existing state before loading.
   *
   * Load-time validation: threads/comments with empty IDs, duplicate IDs,
   * or mismatched comment.threadId are dropped via sanitizeLoadedCommentStoreFile.
   * The validation result is returned so callers can inspect the report.
   */
  loadFromStoreFile(file: CommentStoreFile): import("./comment-store-validation.js").CommentStoreValidationResult {
    const result = sanitizeLoadedCommentStoreFile(file);
    this._threads.clear();
    this._stale.clear();
    for (const thread of result.sanitized.threads) {
      this._threads.set(thread.id, thread);
    }
    return result;
  }

  /**
   * Serialize current state to a CommentStoreFile.
   * Called by CommentStore._persist() to get the JSON payload.
   */
  toStoreFile(): CommentStoreFile {
    return {
      version: "1.0",
      threads: Array.from(this._threads.values()),
    };
  }

  // ── Browser sync tombstone tracking ───────────────────────────────────────

  /** Mark a thread as tombstoned (soft-deleted from browser sync) */
  markDeletedThread(threadId: string): void {
    this._deletedThreadIds.add(threadId);
  }

  /** Unmark a thread as tombstoned */
  unmarkDeletedThread(threadId: string): void {
    this._deletedThreadIds.delete(threadId);
  }

  /** Mark a comment as tombstoned (soft-deleted from browser sync) */
  markDeletedComment(commentId: string): void {
    this._deletedCommentIds.add(commentId);
  }

  /** Unmark a comment as tombstoned */
  unmarkDeletedComment(commentId: string): void {
    this._deletedCommentIds.delete(commentId);
  }

  /** Get all tombstoned thread IDs */
  getDeletedThreadIds(): Set<string> {
    return this._deletedThreadIds;
  }

  /** Get all tombstoned comment IDs */
  getDeletedCommentIds(): Set<string> {
    return this._deletedCommentIds;
  }

  /**
   * Add a thread directly to the repository (for browser sync merge).
   * Does NOT persist — caller (CommentStore) is responsible for that.
   */
  addThread(thread: import("@accordo/bridge-types").CommentThread): void {
    this._threads.set(thread.id, thread);
  }

  /**
   * Add a comment to an existing thread (for browser sync merge).
   * Does NOT persist — caller (CommentStore) is responsible for that.
   */
  addCommentToThread(
    threadId: string,
    comment: import("@accordo/bridge-types").AccordoComment,
  ): void {
    const thread = this._threads.get(threadId);
    if (!thread) return;
    thread.comments.push(comment);
    thread.lastActivity = comment.createdAt;
  }

  /**
   * Increment the version counter.
   * Called after direct repo mutations to keep version info current.
   */
  incrementVersion(): void {
    this._versionCounter++;
  }

  /**
   * Remove a thread directly from the repository by ID.
   * Used for browser sync replace behavior — removes browser threads whose IDs
   * are no longer in the incoming state.
   */
  removeThreadById(threadId: string): void {
    this._threads.delete(threadId);
    this._stale.delete(threadId);
  }
}
