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
}
