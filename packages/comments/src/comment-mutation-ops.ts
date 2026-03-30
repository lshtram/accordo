/**
 * comment-mutation-ops — Mutation operations for CommentRepository.
 *
 * Contains all mutation methods (createThread, reply, resolve, reopen,
 * delete, deleteAllByModality, onDocumentChanged, removeThreadsByUris)
 * and their private helpers (_applyChangesToAnchor).
 *
 * Source: b4a-architecture.md (Wave 3 modularity)
 */

import type {
  CommentAnchorSurface,
  CommentAnchorText,
  AccordoComment,
} from "@accordo/bridge-types";
import {
  COMMENT_MAX_THREADS,
  COMMENT_MAX_COMMENTS_PER_THREAD,
} from "@accordo/bridge-types";
import type {
  CreateCommentParams,
  CreateCommentResult,
  ReplyParams,
  ReplyResult,
  ResolveParams,
  DeleteParams,
  DocumentChangeInfo,
} from "./comment-store-io.js";
import { CommentQueryOps } from "./comment-query-ops.js";

// ── CommentMutationOps mixin ───────────────────────────────────────────────

/**
 * Mixin class that adds all mutation operations to CommentRepositoryOps.
 * Extends CommentQueryOps to share the same storage fields (_threads,
 * _stale, _versionCounter).
 */
export class CommentMutationOps extends CommentQueryOps {
  // ── Mutation methods ───────────────────────────────────────────────────────

  /**
   * Create a new comment, which starts a new thread.
   * Throws if thread cap (500) is reached.
   * Returns threadId, commentId, and affectedUri.
   */
  createThread(params: CreateCommentParams): CreateCommentResult & { affectedUri: string } {
    if (this._threads.size >= COMMENT_MAX_THREADS) {
      throw new Error(`Thread limit reached: max ${COMMENT_MAX_THREADS} threads`);
    }

    const threadId = params.threadId ?? crypto.randomUUID();
    const commentId = params.commentId ?? crypto.randomUUID();
    const now = new Date().toISOString();

    const comment: AccordoComment = {
      id: commentId,
      threadId,
      createdAt: now,
      author: params.author,
      body: params.body,
      anchor: params.anchor,
      intent: params.intent,
      status: "open",
      context: params.context,
    };

    const thread: import("@accordo/bridge-types").CommentThread = {
      id: threadId,
      anchor: params.anchor,
      comments: [comment],
      status: "open",
      retention: params.retention ?? "standard",
      createdAt: now,
      lastActivity: now,
    };

    this._threads.set(threadId, thread);
    this._versionCounter++;

    return { threadId, commentId, affectedUri: params.uri };
  }

  /**
   * Reply to an existing thread.
   * Throws if thread not found or comment-per-thread cap (50) reached.
   * Returns commentId and affectedUri.
   */
  reply(params: ReplyParams): ReplyResult & { affectedUri: string } {
    const thread = this._threads.get(params.threadId);
    if (!thread) throw new Error(`Thread not found: ${params.threadId}`);
    if (thread.comments.length >= COMMENT_MAX_COMMENTS_PER_THREAD) {
      throw new Error(`Comment limit reached: max ${COMMENT_MAX_COMMENTS_PER_THREAD} per thread`);
    }

    const commentId = params.commentId ?? crypto.randomUUID();
    const now = new Date().toISOString();

    const comment: AccordoComment = {
      id: commentId,
      threadId: params.threadId,
      createdAt: now,
      author: params.author,
      body: params.body,
      anchor: thread.anchor,
      status: thread.status,
    };

    thread.comments.push(comment);
    thread.lastActivity = now;
    this._versionCounter++;

    return { commentId, affectedUri: thread.anchor.uri };
  }

  /**
   * Resolve a thread with a resolution note.
   * Throws if thread not found or already resolved.
   * Returns affectedUri.
   */
  resolve(params: ResolveParams): { affectedUri: string } {
    const thread = this._threads.get(params.threadId);
    if (!thread) throw new Error(`Thread not found: ${params.threadId}`);
    if (thread.status === "resolved") throw new Error("Thread already resolved");

    const commentId = crypto.randomUUID();
    const now = new Date().toISOString();

    const resolveComment: AccordoComment = {
      id: commentId,
      threadId: params.threadId,
      createdAt: now,
      author: params.author,
      body: params.resolutionNote,
      anchor: thread.anchor,
      status: "resolved",
      resolutionNote: params.resolutionNote,
    };

    thread.comments.push(resolveComment);
    thread.status = "resolved";
    thread.lastActivity = now;
    this._versionCounter++;

    return { affectedUri: thread.anchor.uri };
  }

  /**
   * Reopen a resolved thread. Both users and agents can reopen.
   * Throws if thread not found or not resolved.
   * Returns affectedUri.
   */
  reopen(threadId: string, author: import("@accordo/bridge-types").CommentAuthor): { affectedUri: string } {
    const thread = this._threads.get(threadId);
    if (!thread) throw new Error(`Thread not found: ${threadId}`);
    if (thread.status !== "resolved") throw new Error("Thread is not resolved");

    thread.status = "open";
    thread.lastActivity = new Date().toISOString();
    this._versionCounter++;

    // author is accepted for API symmetry but not used in domain logic
    void author;

    return { affectedUri: thread.anchor.uri };
  }

  /**
   * Delete a single comment or an entire thread.
   * If commentId is omitted, deletes the entire thread.
   * If the last comment is deleted, the thread is removed.
   * Throws if thread/comment not found.
   * Returns affectedUri.
   */
  delete(params: DeleteParams): { affectedUri: string } {
    const thread = this._threads.get(params.threadId);
    if (!thread) throw new Error(`Thread not found: ${params.threadId}`);

    const affectedUri = thread.anchor.uri;

    if (params.commentId === undefined) {
      this._threads.delete(params.threadId);
      this._stale.delete(params.threadId);
    } else {
      const idx = thread.comments.findIndex(c => c.id === params.commentId);
      if (idx === -1) throw new Error(`Comment not found: ${params.commentId}`);
      thread.comments.splice(idx, 1);
      if (thread.comments.length === 0) {
        this._threads.delete(params.threadId);
        this._stale.delete(params.threadId);
      }
    }

    this._versionCounter++;
    return { affectedUri };
  }

  /**
   * Delete all threads whose anchor is a surface with the given surfaceType.
   * Increments _versionCounter when threads are deleted.
   * Returns { count, affectedUris }.
   */
  deleteAllByModality(surfaceType: string): { count: number; affectedUris: string[] } {
    const toDelete: Array<{ id: string; uri: string }> = [];
    for (const [id, thread] of this._threads) {
      if (
        thread.anchor.kind === "surface" &&
        (thread.anchor as CommentAnchorSurface).surfaceType === surfaceType
      ) {
        toDelete.push({ id, uri: thread.anchor.uri });
      }
    }

    if (toDelete.length === 0) return { count: 0, affectedUris: [] };

    const affectedUrisSet = new Set<string>();
    for (const { id, uri } of toDelete) {
      this._threads.delete(id);
      this._stale.delete(id);
      affectedUrisSet.add(uri);
    }

    this._versionCounter++;
    return { count: toDelete.length, affectedUris: Array.from(affectedUrisSet) };
  }

  // ── Staleness — Document Change Tracking ──────────────────────────────────

  /**
   * Handle a text document change event.
   * For text-anchored threads: adjusts line numbers and marks overlapping
   * threads as visually stale.
   * For surface/file-anchored threads on the same URI: marks them stale
   * (line numbers are not applicable but the visual anchor may be outdated).
   * Returns affectedUri so the adapter can persist + emit.
   */
  onDocumentChanged(change: DocumentChangeInfo): { affectedUri: string } {
    for (const thread of this._threads.values()) {
      if (thread.anchor.uri !== change.uri) continue;

      if (thread.anchor.kind === "text") {
        const anchor = thread.anchor as CommentAnchorText;
        this._applyChangesToAnchor(anchor, change.changes, thread.id);
      } else {
        // Surface/file anchors: mark stale since the document they reference changed
        this._stale.add(thread.id);
      }
    }

    return { affectedUri: change.uri };
  }

  /**
   * Remove all threads anchored to any URI NOT in the given set of alive URIs.
   * Returns the URIs of removed threads (one per removed thread, may contain duplicates).
   * Used by CommentStore.pruneStaleThreads() after I/O-based existence check.
   */
  removeThreadsByUris(aliveUris: Set<string>): string[] {
    const removedUris: string[] = [];
    for (const [id, thread] of this._threads) {
      if (!aliveUris.has(thread.anchor.uri)) {
        removedUris.push(thread.anchor.uri);
        this._threads.delete(id);
        this._stale.delete(id);
      }
    }
    if (removedUris.length > 0) {
      this._versionCounter++;
    }
    return removedUris;
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private _applyChangesToAnchor(
    anchor: CommentAnchorText,
    changes: DocumentChangeInfo["changes"],
    threadId: string,
  ): void {
    for (const c of changes) {
      const anchorStart = anchor.range.startLine;
      const anchorEnd = anchor.range.endLine;
      const delta = c.newLineCount - (c.endLine - c.startLine);

      if (c.endLine <= anchorStart) {
        // Change entirely above — shift lines
        anchor.range = {
          ...anchor.range,
          startLine: anchorStart + delta,
          endLine: anchorEnd + delta,
        };
      } else if (c.startLine > anchorEnd) {
        // Change entirely below — no effect
      } else {
        // Overlap — mark stale
        this._stale.add(threadId);
      }
    }
  }
}
