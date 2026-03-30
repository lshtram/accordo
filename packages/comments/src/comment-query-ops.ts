/**
 * comment-query-ops — Read operations for CommentRepository.
 *
 * Contains all read methods (getAllThreads, getVersionInfo, getThread,
 * getThreadsForUri, listThreads, getCounts, isThreadStale) and their
 * private helpers (_applyFilters, _toThreadSummary).
 *
 * Source: b4a-architecture.md (Wave 3 modularity)
 */

import type {
  CommentThread,
  AccordoComment,
  CommentAnchorText,
  CommentAnchorSurface,
} from "@accordo/bridge-types";
import {
  COMMENT_LIST_DEFAULT_LIMIT,
  COMMENT_LIST_MAX_LIMIT,
  COMMENT_LIST_BODY_PREVIEW_LENGTH,
} from "@accordo/bridge-types";
import type {
  ListThreadsOptions,
  ListThreadsResult,
  ThreadSummary,
} from "./comment-store-io.js";

// ── CommentQueryOps base class ──────────────────────────────────────────────

/**
 * Base class that owns all read operations for CommentRepository.
 */
export class CommentQueryOps {
  protected readonly _threads = new Map<string, CommentThread>();
  protected readonly _stale = new Set<string>();
  protected _versionCounter = 0;

  // ── Read methods ───────────────────────────────────────────────────────────

  /** Get all threads as an array. */
  getAllThreads(): CommentThread[] {
    return Array.from(this._threads.values());
  }

  /** Lightweight snapshot of store state for sync drift detection. */
  getVersionInfo(): { version: number; threadCount: number; lastActivity: string | null } {
    const threads = Array.from(this._threads.values());
    let lastActivity: string | null = null;
    for (const t of threads) {
      if (!lastActivity || t.lastActivity > lastActivity) lastActivity = t.lastActivity;
    }
    return { version: this._versionCounter, threadCount: threads.length, lastActivity };
  }

  /** Get a single thread by ID. Returns undefined if not found. */
  getThread(threadId: string): CommentThread | undefined {
    return this._threads.get(threadId);
  }

  /** Get all threads anchored to a specific URI. */
  getThreadsForUri(uri: string): CommentThread[] {
    return Array.from(this._threads.values()).filter(t => t.anchor.uri === uri);
  }

  /** List threads with optional filtering, pagination, and summary projection. */
  listThreads(options: ListThreadsOptions = {}): ListThreadsResult {
    let threads = Array.from(this._threads.values());

    threads = this._applyFilters(threads, options);

    // Sort most-recently-active first so the top results are always the freshest.
    threads.sort((a, b) => (a.lastActivity > b.lastActivity ? -1 : a.lastActivity < b.lastActivity ? 1 : 0));

    const total = threads.length;
    const offset = options.offset ?? 0;
    // When no uri filter is given the result spans all files — use a smaller
    // default (20) to avoid flooding the agent context window with unrelated
    // threads.  A uri-scoped query keeps the full COMMENT_LIST_DEFAULT_LIMIT.
    const defaultLimit = options.uri !== undefined ? COMMENT_LIST_DEFAULT_LIMIT : 20;
    const limit = Math.min(options.limit ?? defaultLimit, COMMENT_LIST_MAX_LIMIT);
    const page = threads.slice(offset, offset + limit);
    const hasMore = total > offset + limit;

    const summaries = page.map(t => this._toThreadSummary(t));

    return { threads: summaries, total, hasMore };
  }

  /** Get counts for open and resolved threads. */
  getCounts(): { open: number; resolved: number } {
    let open = 0;
    let resolved = 0;
    for (const t of this._threads.values()) {
      if (t.status === "open") open++;
      else resolved++;
    }
    return { open, resolved };
  }

  /** Check whether a thread has been marked visually stale. */
  isThreadStale(threadId: string): boolean {
    return this._stale.has(threadId);
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private _applyFilters(
    threads: CommentThread[],
    options: ListThreadsOptions,
  ): CommentThread[] {
    let result = threads;

    if (options.uri !== undefined) {
      result = result.filter(t => t.anchor.uri === options.uri);
    }
    if (options.status !== undefined) {
      result = result.filter(t => t.status === options.status);
    }
    if (options.intent !== undefined) {
      result = result.filter(t =>
        t.comments.length > 0 && t.comments[0].intent === options.intent,
      );
    }
    if (options.anchorKind !== undefined) {
      result = result.filter(t => t.anchor.kind === options.anchorKind);
    }
    if (options.surfaceType !== undefined) {
      result = result.filter(t =>
        t.anchor.kind === "surface" &&
        (t.anchor as CommentAnchorSurface).surfaceType === options.surfaceType,
      );
    }
    if (options.updatedSince !== undefined) {
      result = result.filter(t => t.lastActivity > (options.updatedSince as string));
    }
    if (options.lastAuthor !== undefined) {
      result = result.filter(t => {
        const last = t.comments[t.comments.length - 1];
        return last !== undefined && last.author.kind === options.lastAuthor;
      });
    }

    return result;
  }

  private _toThreadSummary(t: CommentThread): ThreadSummary {
    const first = t.comments[0];
    const last = t.comments[t.comments.length - 1];
    return {
      id: t.id,
      anchor: t.anchor,
      status: t.status,
      commentCount: t.comments.length,
      lastActivity: t.lastActivity,
      lastAuthor: last?.author.kind === "agent" ? "agent" : "user",
      firstComment: {
        author: first.author,
        body: first.body.slice(0, COMMENT_LIST_BODY_PREVIEW_LENGTH),
        intent: first.intent,
      },
    };
  }
}
