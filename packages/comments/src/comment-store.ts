/**
 * CommentStore — VSCode adapter. Thin wrapper around CommentRepository.
 *
 * Owns persistence (vscode.workspace.fs), event emission, write queue,
 * and listener management. All domain logic lives in CommentRepository.
 *
 * Source: b4a-architecture.md §3
 */

import * as vscode from "vscode";
import { rename as fsRename } from "node:fs/promises";
import type { CommentAuthor, CommentStoreFile } from "@accordo/bridge-types";
import { CommentRepository } from "./comment-repository.js";

// ── Re-export all domain types ───────────────────────────────────────────────
// Preserves backward-compat: `import { type CreateCommentParams } from "./comment-store.js"`
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
} from "./comment-repository.js";

// Re-import the types we need locally (for parameter signatures below)
import type {
  CreateCommentParams,
  CreateCommentResult,
  ReplyParams,
  ReplyResult,
  ResolveParams,
  DeleteParams,
  DocumentChangeInfo,
  ChangeListener,
  ListThreadsOptions,
  ListThreadsResult,
} from "./comment-repository.js";

import type { CommentThread } from "@accordo/bridge-types";

// ── CommentStore class ───────────────────────────────────────────────────────

export class CommentStore {
  private readonly _repo = new CommentRepository();
  private readonly _listeners: ChangeListener[] = [];
  private _workspaceRoot = "";
  /** Serializes concurrent _persist() calls to prevent file-rename races. */
  private _writeQueue: Promise<void> = Promise.resolve();

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

    this._repo.loadFromStoreFile(file);
  }

  private async _persist(): Promise<void> {
    // Chain onto the write queue to serialize all concurrent writes.
    // Each call appends its work to the queue and waits for it to complete,
    // preventing concurrent rename() calls on comments.json.tmp.
    this._writeQueue = this._writeQueue.then(async () => {
      if (!this._workspaceRoot) return;
      const dirPath = `${this._workspaceRoot}/.accordo`;
      const filePath = `${dirPath}/comments.json`;
      const tmpPath = `${filePath}.tmp`;
      await vscode.workspace.fs.createDirectory(vscode.Uri.file(dirPath));
      const encoded = new TextEncoder().encode(
        JSON.stringify(this._repo.toStoreFile(), null, 2),
      );
      // Atomic write: write to .tmp first, then rename into place.
      // rename(2) is atomic on POSIX — the original file is never partially written.
      await vscode.workspace.fs.writeFile(vscode.Uri.file(tmpPath), encoded);
      await fsRename(tmpPath, filePath);
    });
    await this._writeQueue;
  }

  private _emit(uri: string): void {
    for (const l of this._listeners) l(uri);
  }

  // ── Delegated read methods (pass-through) ──────────────────────────────────

  /** Get all threads as an array. */
  getAllThreads(): CommentThread[] {
    return this._repo.getAllThreads();
  }

  /** Lightweight snapshot of store state for sync drift detection. */
  getVersionInfo(): { version: number; threadCount: number; lastActivity: string | null } {
    return this._repo.getVersionInfo();
  }

  /** Get a single thread by ID. Returns undefined if not found. */
  getThread(threadId: string): CommentThread | undefined {
    return this._repo.getThread(threadId);
  }

  /** Get all threads anchored to a specific URI. */
  getThreadsForUri(uri: string): CommentThread[] {
    return this._repo.getThreadsForUri(uri);
  }

  /** List threads with optional filtering, pagination, and summary projection. */
  listThreads(options: ListThreadsOptions = {}): ListThreadsResult {
    return this._repo.listThreads(options);
  }

  /** Get counts for modality state. */
  getCounts(): { open: number; resolved: number } {
    return this._repo.getCounts();
  }

  /** Check whether a thread has been marked visually stale. */
  isThreadStale(threadId: string): boolean {
    return this._repo.isThreadStale(threadId);
  }

  /** Serialize current state. Used by persistence layer. */
  toStoreFile(): CommentStoreFile {
    return this._repo.toStoreFile();
  }

  // ── Delegated mutation methods (delegate → persist → emit) ─────────────────

  /**
   * Create a new comment, which starts a new thread.
   * Throws if thread cap (500) is reached.
   */
  async createThread(params: CreateCommentParams): Promise<CreateCommentResult> {
    const result = this._repo.createThread(params);
    await this._persist();
    this._emit(result.affectedUri);
    return { threadId: result.threadId, commentId: result.commentId };
  }

  /**
   * Reply to an existing thread.
   * Throws if thread not found or comment-per-thread cap (50) reached.
   */
  async reply(params: ReplyParams): Promise<ReplyResult> {
    const result = this._repo.reply(params);
    await this._persist();
    this._emit(result.affectedUri);
    return { commentId: result.commentId };
  }

  /**
   * Resolve a thread with a resolution note.
   * Throws if thread not found or already resolved.
   */
  async resolve(params: ResolveParams): Promise<void> {
    const result = this._repo.resolve(params);
    await this._persist();
    this._emit(result.affectedUri);
  }

  /**
   * Reopen a resolved thread. Both users and agents can reopen.
   * Throws if thread not found or not resolved.
   *
   * Source: comments-architecture.md §4 state machine — "user or agent" can reopen.
   */
  async reopen(threadId: string, author: CommentAuthor): Promise<void> {
    const result = this._repo.reopen(threadId, author);
    await this._persist();
    this._emit(result.affectedUri);
  }

  /**
   * Delete a single comment or an entire thread.
   * If commentId is omitted, deletes the entire thread.
   * If the last comment is deleted, the thread is removed.
   * Throws if thread/comment not found.
   */
  async delete(params: DeleteParams): Promise<void> {
    const result = this._repo.delete(params);
    await this._persist();
    this._emit(result.affectedUri);
  }

  /**
   * Delete all threads whose anchor is a surface with the given surfaceType.
   * Used for bulk browser comment cleanup (M38-CT-07 deleteScope).
   * Returns the number of deleted threads.
   *
   * Source: comments-architecture.md §10.5, requirements-comments.md M38-CT-07
   */
  async deleteAllByModality(surfaceType: string): Promise<number> {
    const result = this._repo.deleteAllByModality(surfaceType);
    if (result.count > 0) {
      await this._persist();
      for (const uri of result.affectedUris) {
        this._emit(uri);
      }
    }
    return result.count;
  }

  // ── Staleness ──────────────────────────────────────────────────────────────

  /**
   * Handle a text document change event.
   * Adjusts line numbers for text-anchored threads and marks overlapping
   * threads as visually stale.
   */
  onDocumentChanged(change: DocumentChangeInfo): void {
    const result = this._repo.onDocumentChanged(change);
    void this._persist();
    this._emit(result.affectedUri);
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
    // Collect distinct URIs across all threads and track thread IDs per URI
    const threadsByUri = new Map<string, string[]>();
    for (const thread of this._repo.getAllThreads()) {
      const uri = thread.anchor.uri;
      const ids = threadsByUri.get(uri) ?? [];
      ids.push(thread.id);
      threadsByUri.set(uri, ids);
    }

    if (threadsByUri.size === 0) return [];

    // Identify URIs that still exist
    const aliveUris = new Set<string>();
    for (const uri of threadsByUri.keys()) {
      const alive = await exists(uri);
      if (alive) aliveUris.add(uri);
    }

    // Collect thread IDs for stale URIs (before deletion)
    const removedIds: string[] = [];
    for (const [uri, ids] of threadsByUri) {
      if (!aliveUris.has(uri)) {
        for (const id of ids) removedIds.push(id);
      }
    }

    if (removedIds.length === 0) return [];

    // Remove stale threads via repository (passes alive URIs — repo removes everything NOT in set)
    this._repo.removeThreadsByUris(aliveUris);

    await this._persist();
    for (const [uri] of threadsByUri) {
      if (!aliveUris.has(uri)) {
        this._emit(uri);
      }
    }

    return removedIds;
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
}
