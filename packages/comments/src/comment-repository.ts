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
   */
  loadFromStoreFile(file: CommentStoreFile): void {
    this._threads.clear();
    this._stale.clear();
    for (const thread of file.threads) {
      this._threads.set(thread.id, thread);
    }
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
