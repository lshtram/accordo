/**
 * CommentStore — In-memory comment database with JSON file persistence.
 *
 * Owns all comment data. Every create/reply/resolve/delete goes through here.
 * Persists to .accordo/comments.json on every mutation.
 * Emits change events for native-comments and state-contribution to react to.
 *
 * Source: comments-architecture.md §3, §5
 */

import * as vscode from "vscode";
import { rename as fsRename } from "node:fs/promises";
import type {
  CommentThread,
  CommentAnchor,
  AccordoComment,
  CommentAuthor,
  CommentIntent,
  CommentStatus,
  CommentStoreFile,
  CommentContext,
  CommentAnchorText,
  CommentAnchorSurface,
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

// ── CommentStore class ───────────────────────────────────────────────────────

export class CommentStore {
  private readonly _threads = new Map<string, CommentThread>();
  private readonly _stale = new Set<string>();
  private readonly _listeners: ChangeListener[] = [];
  private _workspaceRoot = "";
  private _versionCounter = 0;

  /** Return the workspace root path passed to `load()`. */
  getWorkspaceRoot(): string {
    return this._workspaceRoot;
  }

  // ── Persistence ────────────────────────────────────────────────────────────

  /**
   * Load persisted comments from .accordo/comments.json.
   * If the file is missing, start with an empty store.
   * If the file is corrupt, log a warning and start fresh.
   */
  async load(workspaceRoot: string): Promise<void> {
    this._workspaceRoot = workspaceRoot;
    const filePath = `${workspaceRoot}/.accordo/comments.json`;
    const uri = vscode.Uri.file(filePath);

    let raw: Uint8Array;
    try {
      raw = await vscode.workspace.fs.readFile(uri);
    } catch {
      // File missing — start fresh
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder().decode(raw));
    } catch {
      console.error("[accordo-comments] Failed to parse comments.json — starting fresh");
      return;
    }

    const file = parsed as CommentStoreFile;
    if (!file || file.version !== "1.0") {
      console.error("[accordo-comments] Unknown comments.json version — starting fresh");
      return;
    }

    for (const thread of file.threads) {
      this._threads.set(thread.id, thread);
    }
  }

  private async _persist(): Promise<void> {
    if (!this._workspaceRoot) return;
    const dirPath = `${this._workspaceRoot}/.accordo`;
    const filePath = `${dirPath}/comments.json`;
    const tmpPath = `${filePath}.tmp`;
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(dirPath));
    const encoded = new TextEncoder().encode(
      JSON.stringify(this.toStoreFile(), null, 2),
    );
    // Atomic write: write to .tmp first, then rename into place.
    // rename(2) is atomic on POSIX — the original file is never partially written.
    await vscode.workspace.fs.writeFile(vscode.Uri.file(tmpPath), encoded);
    await fsRename(tmpPath, filePath);
  }

  private _emit(uri: string): void {
    for (const l of this._listeners) l(uri);
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

    if (options.uri !== undefined) {
      threads = threads.filter(t => t.anchor.uri === options.uri);
    }
    if (options.status !== undefined) {
      threads = threads.filter(t => t.status === options.status);
    }
    if (options.intent !== undefined) {
      threads = threads.filter(t =>
        t.comments.length > 0 && t.comments[0].intent === options.intent,
      );
    }
    if (options.anchorKind !== undefined) {
      threads = threads.filter(t => t.anchor.kind === options.anchorKind);
    }
    if (options.surfaceType !== undefined) {
      threads = threads.filter(t =>
        t.anchor.kind === "surface" &&
        (t.anchor as CommentAnchorSurface).surfaceType === options.surfaceType,
      );
    }
    if (options.updatedSince !== undefined) {
      threads = threads.filter(t => t.lastActivity > options.updatedSince!);
    }
    if (options.lastAuthor !== undefined) {
      threads = threads.filter(t => {
        const last = t.comments[t.comments.length - 1];
        return last !== undefined && last.author.kind === options.lastAuthor;
      });
    }

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

    const summaries: ThreadSummary[] = page.map(t => {
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
    });

    return { threads: summaries, total, hasMore };
  }

  // ── Mutation methods ───────────────────────────────────────────────────────

  /**
   * Create a new comment, which starts a new thread.
   * Throws if thread cap (500) is reached.
   */
  async createThread(params: CreateCommentParams): Promise<CreateCommentResult> {
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
    await this._persist();
    this._emit(params.uri);
    this._versionCounter++;

    return { threadId, commentId };
  }

  /**
   * Reply to an existing thread.
   * Throws if thread not found or comment-per-thread cap (50) reached.
   */
  async reply(params: ReplyParams): Promise<ReplyResult> {
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

    await this._persist();
    this._emit(thread.anchor.uri);
    this._versionCounter++;

    return { commentId };
  }

  /**
   * Resolve a thread with a resolution note.
   * Throws if thread not found or already resolved.
   */
  async resolve(params: ResolveParams): Promise<void> {
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

    await this._persist();
    this._emit(thread.anchor.uri);
    this._versionCounter++;
  }

  /**
   * Reopen a resolved thread. Both users and agents can reopen.
   * Throws if thread not found or not resolved.
   *
   * Source: comments-architecture.md §4 state machine — "user or agent" can reopen.
   */
  async reopen(threadId: string, author: CommentAuthor): Promise<void> {
    const thread = this._threads.get(threadId);
    if (!thread) throw new Error(`Thread not found: ${threadId}`);
    if (thread.status !== "resolved") throw new Error("Thread is not resolved");

    thread.status = "open";
    thread.lastActivity = new Date().toISOString();

    await this._persist();
    this._emit(thread.anchor.uri);
    this._versionCounter++;
  }

  /**
   * Delete a single comment or an entire thread.
   * If commentId is omitted, deletes the entire thread.
   * If the last comment is deleted, the thread is removed.
   * Throws if thread/comment not found.
   */
  async delete(params: DeleteParams): Promise<void> {
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

    await this._persist();
    this._emit(affectedUri);
    this._versionCounter++;
  }

  /**
   * Delete all threads whose anchor is a surface with the given surfaceType.
   * Used for bulk browser comment cleanup (M38-CT-07 deleteScope).
   * Returns the number of deleted threads.
   *
   * Source: comments-architecture.md §10.5, requirements-comments.md M38-CT-07
   */
  async deleteAllByModality(surfaceType: string): Promise<number> {
    const toDelete: Array<{ id: string; uri: string }> = [];
    for (const [id, thread] of this._threads) {
      if (
        thread.anchor.kind === "surface" &&
        (thread.anchor as CommentAnchorSurface).surfaceType === surfaceType
      ) {
        toDelete.push({ id, uri: thread.anchor.uri });
      }
    }

    if (toDelete.length === 0) return 0;

    const affectedUris = new Set<string>();
    for (const { id, uri } of toDelete) {
      this._threads.delete(id);
      this._stale.delete(id);
      affectedUris.add(uri);
    }

    await this._persist();
    for (const uri of affectedUris) {
      this._emit(uri);
    }

    return toDelete.length;
  }

  // ── Staleness ──────────────────────────────────────────────────────────────

  /**
   * Handle a text document change event.
   * Adjusts line numbers for text-anchored threads and marks overlapping
   * threads as visually stale.
   */
  onDocumentChanged(change: DocumentChangeInfo): void {
    for (const thread of this._threads.values()) {
      if (thread.anchor.kind !== "text") continue;
      if (thread.anchor.uri !== change.uri) continue;

      const textAnchor = thread.anchor as CommentAnchorText;

      for (const c of change.changes) {
        const anchorStart = textAnchor.range.startLine;
        const anchorEnd = textAnchor.range.endLine;
        const delta = c.newLineCount - (c.endLine - c.startLine);

        if (c.endLine <= anchorStart) {
          // Change entirely above — shift lines
          textAnchor.range = {
            ...textAnchor.range,
            startLine: anchorStart + delta,
            endLine: anchorEnd + delta,
          };
        } else if (c.startLine > anchorEnd) {
          // Change entirely below — no effect
        } else {
          // Overlap — mark stale
          this._stale.add(thread.id);
        }
      }
    }
    // Persist shifted anchors so they survive reload (architecture §9.1 step 4)
    void this._persist();
    // Notify listeners so state contribution re-publishes with updated line numbers
    this._emit(change.uri);
  }

  /** Check whether a thread has been marked visually stale. */
  isThreadStale(threadId: string): boolean {
    return this._stale.has(threadId);
  }

  // ── Change listener ────────────────────────────────────────────────────────

  /** Register a callback that fires after any mutation. */
  onChanged(listener: ChangeListener): { dispose(): void } {
    this._listeners.push(listener);
    return {
      dispose: () => {
        const i = this._listeners.indexOf(listener);
        if (i >= 0) this._listeners.splice(i, 1);
      },
    };
  }

  // ── Aggregates ─────────────────────────────────────────────────────────────

  /** Get counts for modality state. */
  getCounts(): { open: number; resolved: number } {
    let open = 0;
    let resolved = 0;
    for (const t of this._threads.values()) {
      if (t.status === "open") open++;
      else resolved++;
    }
    return { open, resolved };
  }

  /**
   * Remove threads whose file URIs no longer resolve to an existing resource.
   * Persists the trimmed store and emits onChanged for each affected URI.
   * Returns the IDs of removed threads.
   *
   * @param exists  Async predicate — resolve `true` if the URI is accessible.
   */
  async pruneStaleThreads(
    exists: (uri: string) => Promise<boolean>,
  ): Promise<string[]> {
    // Collect distinct URIs across all threads
    const uriSet = new Set<string>();
    for (const thread of this._threads.values()) {
      uriSet.add(thread.anchor.uri);
    }

    // Identify URIs that no longer exist
    const staleUris = new Set<string>();
    for (const uri of uriSet) {
      const alive = await exists(uri);
      if (!alive) staleUris.add(uri);
    }

    if (staleUris.size === 0) return [];

    // Remove stale threads from in-memory store
    const removed: string[] = [];
    for (const [id, thread] of this._threads) {
      if (staleUris.has(thread.anchor.uri)) {
        removed.push(id);
        this._threads.delete(id);
      }
    }

    if (removed.length > 0) {
      await this._persist();
      for (const uri of staleUris) {
        this._emit(uri);
      }
      this._versionCounter++;
    }

    return removed;
  }

  /** Serialize current state. Used by persistence layer. */
  toStoreFile(): CommentStoreFile {
    return {
      version: "1.0",
      threads: Array.from(this._threads.values()),
    };
  }
}
