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

import type {
  CommentThread,
  CommentAnchor,
  AccordoComment,
  CommentAuthor,
  CommentIntent,
  CommentStatus,
  CommentStoreFile,
  CommentContext,
  CommentAnchorSurface,
  CommentAnchorText,
  CommentRetention,
} from "@accordo/bridge-types";
import {
  COMMENT_MAX_THREADS,
  COMMENT_MAX_COMMENTS_PER_THREAD,
  COMMENT_LIST_DEFAULT_LIMIT,
  COMMENT_LIST_MAX_LIMIT,
  COMMENT_LIST_BODY_PREVIEW_LENGTH,
} from "@accordo/bridge-types";

// ── Public types ─────────────────────────────────────────────────────────────

/** Options for listing threads. */
export interface ListThreadsOptions {
  uri?: string;
  status?: CommentStatus;
  intent?: CommentIntent;
  anchorKind?: "text" | "surface" | "file";
  /** Filter by surface type (e.g. "browser", "diagram"). Only matches surface anchors. */
  surfaceType?: string;
  /** ISO 8601 — return only threads with lastActivity after this timestamp */
  updatedSince?: string;
  /** Return only threads whose most recent comment was written by this author kind */
  lastAuthor?: "user" | "agent";
  limit?: number;
  offset?: number;
}

/** Result of listing threads. */
export interface ListThreadsResult {
  threads: ThreadSummary[];
  total: number;
  hasMore: boolean;
}

/** Summary of a thread returned by listThreads(). */
export interface ThreadSummary {
  id: string;
  anchor: CommentAnchor;
  status: CommentStatus;
  commentCount: number;
  lastActivity: string;
  /** Author kind of the most recent comment — useful for finding threads awaiting agent response */
  lastAuthor: "user" | "agent";
  firstComment: {
    author: CommentAuthor;
    body: string;
    intent?: CommentIntent;
  };
}

/** Parameters for creating a new comment / thread. */
export interface CreateCommentParams {
  uri: string;
  anchor: CommentAnchor;
  body: string;
  author: CommentAuthor;
  intent?: CommentIntent;
  context?: CommentContext;
  /** Retention policy — defaults to "standard" if omitted. */
  retention?: CommentRetention;
  /** Optional: caller-supplied thread ID. If omitted, a UUID is generated. */
  threadId?: string;
  /** Optional: caller-supplied first-comment ID. If omitted, a UUID is generated. */
  commentId?: string;
}

/** Result of creating a comment. */
export interface CreateCommentResult {
  threadId: string;
  commentId: string;
}

/** Parameters for replying to a thread. */
export interface ReplyParams {
  threadId: string;
  body: string;
  author: CommentAuthor;
  /** Optional caller-supplied comment ID for cross-origin ID parity. */
  commentId?: string;
}

/** Result of replying. */
export interface ReplyResult {
  commentId: string;
}

/** Parameters for resolving a thread. */
export interface ResolveParams {
  threadId: string;
  resolutionNote: string;
  author: CommentAuthor;
}

/** Parameters for deleting a comment or thread. */
export interface DeleteParams {
  threadId: string;
  commentId?: string;
}

/** Text document change info for staleness tracking. */
export interface DocumentChangeInfo {
  uri: string;
  changes: Array<{
    /** 0-based line where the change starts */
    startLine: number;
    /** 0-based line where the change ends (exclusive) */
    endLine: number;
    /** Number of new lines inserted */
    newLineCount: number;
  }>;
}

/** Callback type for change listener — receives the URI of the affected file. */
export type ChangeListener = (uri: string) => void;

// ── CommentRepository class ──────────────────────────────────────────────────

export class CommentRepository {
  private readonly _threads = new Map<string, CommentThread>();
  private readonly _stale = new Set<string>();
  private _versionCounter = 0;

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

    const thread: CommentThread = {
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
  reopen(threadId: string, author: CommentAuthor): { affectedUri: string } {
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
      result = result.filter(t => t.lastActivity > options.updatedSince!);
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
