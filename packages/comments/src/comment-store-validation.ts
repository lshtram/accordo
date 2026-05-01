/**
 * comment-store-validation — Load-time and mutation ID validation.
 *
 * Implements M36-CS-12 (load-time) and M36-CS-13 (mutation boundary).
 * Stable error codes: invalid-thread-id, invalid-comment-id, duplicate-thread-id,
 * duplicate-comment-id, thread-not-found, comment-not-found,
 * thread-already-resolved, thread-not-resolved.
 *
 * Source: requirements-comments.md §3.2 Validation contract
 */

import type { CommentStoreFile, CommentThread, AccordoComment } from "@accordo/bridge-types";

// ── Public types ─────────────────────────────────────────────────────────────

export type CommentStoreValidationIssueCode =
  | "empty-thread-id"
  | "duplicate-thread-id"
  | "empty-comment-id"
  | "duplicate-comment-id"
  | "mismatched-comment-thread-id";

export interface CommentStoreValidationIssue {
  readonly code: CommentStoreValidationIssueCode;
  readonly threadId?: string;
  readonly commentId?: string;
  readonly detail: string;
}

export interface CommentStoreValidationResult {
  readonly sanitized: CommentStoreFile;
  readonly issues: readonly CommentStoreValidationIssue[];
}

export interface CommentMutationIdValidationInput {
  readonly threadId?: string;
  readonly commentId?: string;
}

// ── Load-time validation ──────────────────────────────────────────────────────

/**
 * Sanitize a loaded CommentStoreFile before entering runtime state.
 * Drops threads with empty/whitespace thread IDs and deduplicates.
 * Drops comments with empty IDs, mismatched threadId, or duplicate IDs.
 *
 * Precedence rules (from requirements-comments.md M36-CS-12):
 * - First valid occurrence wins; later duplicates dropped
 * - Thread with invalid thread ID dropped before comment-level validation
 * - Comment precedence: empty-comment-id → mismatched-comment-thread-id → duplicate-comment-id
 * - Thread dropped when all its comments are dropped
 *
 * @param file Raw persisted file
 * @returns Sanitized file + validation report
 */
export function sanitizeLoadedCommentStoreFile(
  file: CommentStoreFile,
): CommentStoreValidationResult {
  const issues: CommentStoreValidationIssue[] = [];
  const retainedThreads: CommentThread[] = [];
  const seenThreadIds = new Set<string>();
  const seenCommentIdsPerThread = new Map<string, Set<string>>();

  for (const thread of file.threads) {
    const trimmedThreadId = thread.id.trim();

    // ── Thread-level checks ─────────────────────────────────────────────────
    if (trimmedThreadId.length === 0) {
      issues.push({
        code: "empty-thread-id",
        threadId: thread.id,
        commentId: undefined,
        detail: `Thread with empty/whitespace ID dropped; ${thread.comments.length} comment(s) not retained`,
      });
      continue; // drop entire thread
    }

    if (seenThreadIds.has(trimmedThreadId)) {
      issues.push({
        code: "duplicate-thread-id",
        threadId: thread.id,
        commentId: undefined,
        detail: `Duplicate thread ID '${trimmedThreadId}' — first occurrence retained`,
      });
      continue; // drop duplicate
    }

    // ── Comment-level checks ─────────────────────────────────────────────────
    const retainedComments: AccordoComment[] = [];
    let threadHasIssue = false;

    for (const comment of thread.comments) {
      const trimmedCommentId = comment.id.trim();
      const seenCommentIds = seenCommentIdsPerThread.get(trimmedThreadId) ?? new Set<string>();

      if (trimmedCommentId.length === 0) {
        issues.push({
          code: "empty-comment-id",
          threadId: thread.id,
          commentId: comment.id,
          detail: `Comment with empty ID in thread '${trimmedThreadId}' dropped`,
        });
        threadHasIssue = true;
        continue; // drop this comment
      }

      if (comment.threadId !== trimmedThreadId) {
        issues.push({
          code: "mismatched-comment-thread-id",
          threadId: thread.id,
          commentId: comment.id,
          detail: `Comment '${trimmedCommentId}' has threadId '${comment.threadId}' which does not match parent thread '${trimmedThreadId}'`,
        });
        threadHasIssue = true;
        continue; // drop this comment
      }

      if (seenCommentIds.has(trimmedCommentId)) {
        issues.push({
          code: "duplicate-comment-id",
          threadId: thread.id,
          commentId: comment.id,
          detail: `Duplicate comment ID '${trimmedCommentId}' in thread '${trimmedThreadId}' — first occurrence retained`,
        });
        threadHasIssue = true;
        continue; // drop duplicate
      }

      // Valid comment — retain
      seenCommentIds.add(trimmedCommentId);
      seenCommentIdsPerThread.set(trimmedThreadId, seenCommentIds);
      retainedComments.push(comment);
    }

    // ── Empty-thread-after-sanitization rule ─────────────────────────────────
    if (retainedComments.length === 0) {
      // Report the per-comment issues that caused the drop (already pushed above)
      // Thread is dropped; no new issue needed here
      continue;
    }

    // Retain the thread
    seenThreadIds.add(trimmedThreadId);
    retainedThreads.push({
      ...thread,
      id: trimmedThreadId,
      comments: retainedComments,
    });
  }

  return {
    sanitized: { version: "1.0", threads: retainedThreads },
    issues,
  };
}

// ── Mutation boundary validation ─────────────────────────────────────────────

/**
 * Validate caller-supplied IDs at mutation boundaries.
 * Called before repository mutation so empty/whitespace IDs never enter runtime.
 *
 * Error codes (stable vocabulary from M36-CS-13):
 * - invalid-thread-id: threadId is empty or whitespace
 * - invalid-comment-id: commentId is empty or whitespace
 *
 * @throws Error with stable code as message
 */
export function assertValidMutationIds(input: CommentMutationIdValidationInput): void {
  if (input.threadId !== undefined && input.threadId.trim().length === 0) {
    throw new Error("invalid-thread-id");
  }
  if (input.commentId !== undefined && input.commentId.trim().length === 0) {
    throw new Error("invalid-comment-id");
  }
}

/**
 * Normalize empty/whitespace optional ID to undefined.
 * Used at tool layer where empty optional IDs should be treated as omitted.
 */
export function normalizeOptionalId(id: string | undefined): string | undefined {
  if (id === undefined) return undefined;
  if (id.trim().length === 0) return undefined;
  return id;
}