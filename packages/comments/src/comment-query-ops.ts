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
  /** Tracks thread IDs that have been tombstoned (soft-deleted) from browser sync */
  protected readonly _deletedThreadIds = new Set<string>();
  /** Tracks comment IDs that have been tombstoned from browser sync */
  protected readonly _deletedCommentIds = new Set<string>();

  // ── Read methods ───────────────────────────────────────────────────────────

  /** Get all non-tombstoned threads as an array. Tombstoned threads are filtered out. */
  getAllThreads(): CommentThread[] {
    return Array.from(this._threads.values())
      .filter((t) => !this._deletedThreadIds.has(t.id))
      .map((t) => ({
        ...t,
        comments: t.comments
          .filter((c) => !this._deletedCommentIds.has(c.id))
          .map((c) => ({ ...c })),
      }));
  }

  /** Lightweight snapshot of store state for sync drift detection. */
  getVersionInfo(): { version: number; threadCount: number; lastActivity: string | null } {
    const threads = this.getAllThreads();
    let lastActivity: string | null = null;
    for (const t of threads) {
      if (!lastActivity || t.lastActivity > lastActivity) lastActivity = t.lastActivity;
    }
    return { version: this._versionCounter, threadCount: threads.length, lastActivity };
  }

  /** Get a single thread by ID. Returns undefined if not found. */
  getThread(threadId: string): CommentThread | undefined {
    if (this._deletedThreadIds.has(threadId)) return undefined;
    const thread = this._threads.get(threadId);
    if (!thread) return undefined;
    const comments = thread.comments.filter((comment) => !this._deletedCommentIds.has(comment.id));
    if (comments.length === 0) return undefined;
    return { ...thread, comments: comments.map((comment) => ({ ...comment })) };
  }

  /** Get all threads anchored to a specific URI. */
  getThreadsForUri(uri: string): CommentThread[] {
    return this.getAllThreads().filter(t => t.anchor.uri === uri);
  }

  /** List threads with optional filtering, pagination, and summary projection. */
  listThreads(options: ListThreadsOptions = {}): ListThreadsResult {
    let threads = this.getAllThreads();

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
    for (const t of this.getAllThreads()) {
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
      result = result.filter(t => this._urisMatch(t.anchor.uri, options.uri as string));
    }
    if (options.status !== undefined && options.status !== "all") {
      result = result.filter(t => t.status === options.status);
    }
    if (options.intent !== undefined) {
      result = result.filter(t =>
        t.comments.length > 0 &&
        (
          t.comments[0].intent === options.intent ||
          t.comments[0].intent === undefined
        ),
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

  /**
   * URI match with file-path equivalence fallback.
   *
   * Handles live mixed forms observed in comment anchors:
   * - file:///abs/path/to/file.ts
   * - /abs/path/to/file.ts
   * - C:\\abs\\path\\to\\file.ts (Windows)
   *
   * For non-file URIs (e.g. https:// browser anchors), match remains exact.
   */
  private _urisMatch(left: string, right: string): boolean {
    if (left === right) return true;
    const leftFile = this._toComparableFilePath(left);
    const rightFile = this._toComparableFilePath(right);
    if (leftFile !== undefined && rightFile !== undefined) {
      return leftFile === rightFile;
    }
    return false;
  }

  private _toComparableFilePath(uri: string): string | undefined {
    const trimmed = uri.trim();
    if (trimmed.length === 0) return undefined;

    const normalizePath = (p: string): string =>
      p
        .replace(/\\/g, "/")
        .replace(/^\/([a-zA-Z]:)/, "$1")
        .replace(/\/+$/, "");

    if (trimmed.startsWith("file://")) {
      try {
        const pathname = decodeURIComponent(new URL(trimmed).pathname);
        return normalizePath(pathname);
      } catch {
        return undefined;
      }
    }

    if (trimmed.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(trimmed)) {
      return normalizePath(trimmed);
    }

    return undefined;
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
