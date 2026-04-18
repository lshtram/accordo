/**
 * M90-ADP — Comment Backend Adapter
 *
 * Abstracts the comment storage/sync backend so the browser extension's
 * content scripts and popup can operate identically regardless of whether
 * comments are routed through the VS Code relay, a standalone MCP server,
 * or local chrome.storage.local.
 *
 * Implements requirements PU-F-40 through PU-F-45.
 *
 * @module
 */

import type { RelayBridgeClient } from "../relay-bridge.js";

import {
  normalizeUrl,
  createThread as storeCreateThread,
  addComment as storeAddComment,
  resolveThread as storeResolveThread,
  reopenThread as storeReopenThread,
  softDeleteThread as storeSoftDeleteThread,
  softDeleteComment as storeSoftDeleteComment,
  getActiveThreads,
} from "../store.js";

import type { BrowserCommentThread } from "../types.js";

// ── Types ────────────────────────────────────────────────────────────────────

/** Summary of a comment thread returned by the adapter */
export interface CommentThreadSummary {
  threadId: string;
  status: "open" | "resolved";
  anchorKey: string;
  anchorContext?: {
    tagName: string;
    textSnippet?: string;
    ariaLabel?: string;
    pageTitle?: string;
  };
  lastComment: string;
  lastAuthor: string;
  lastActivity: string;
  commentCount: number;
}

/** Parameters for creating a new comment thread */
export interface CreateThreadParams {
  url: string;
  anchorKey: string;
  body: string;
  authorName?: string;
  commentId?: string;
  threadId?: string;
}

/** Parameters for replying to a thread */
export interface ReplyParams {
  threadId: string;
  body: string;
  commentId?: string;
  authorName?: string;
}

// ── CommentBackendAdapter Interface ──────────────────────────────────────────

/**
 * Abstracts the comment storage/sync backend.
 *
 * Today: VS Code relay → unified comment_* tools.
 * Future: standalone MCP client → Hub or local IndexedDB.
 *
 * @see PU-F-40
 */
export interface CommentBackendAdapter {
  /** List comment threads for a URL */
  listThreads(url: string): Promise<CommentThreadSummary[]>;

  /** Create a new comment thread */
  createThread(params: CreateThreadParams): Promise<{ threadId: string; commentId: string; pageUrl: string }>;

  /** Reply to an existing thread */
  reply(params: ReplyParams): Promise<{ commentId: string; body: string; pageUrl: string }>;

  /** Resolve a thread */
  resolve(threadId: string, resolutionNote?: string): Promise<void>;

  /** Reopen a resolved thread */
  reopen(threadId: string): Promise<void>;

  /** Delete a thread or comment */
  delete(threadId: string, commentId?: string): Promise<void>;

  /** Check backend connectivity */
  isConnected(): boolean;
}

// ── VscodeRelayAdapter ───────────────────────────────────────────────────────

/**
 * @stub Not yet implemented — planned for Wave 2 (W2-A).
 * Provides comment CRUD operations via a VS Code relay tunnel.
 * See: docs/00-workplan/workplan-modularity-waves.md §W2-A
 *
 * Routes comment operations through the VS Code relay WebSocket.
 * Used when the browser extension is connected to accordo-browser.
 *
 * @see PU-F-41
 */
export class VscodeRelayAdapter implements CommentBackendAdapter {
  constructor(private readonly _relay: RelayBridgeClient) {}

  async listThreads(url: string): Promise<CommentThreadSummary[]> {
    const res = await this._relay.send("get_comments", { url });
    if (!res.success || !Array.isArray(res.data)) {
      return [];
    }
    const threads = res.data as Array<{
      id: string;
      anchorKey: string;
      anchorContext?: { tagName: string; textSnippet?: string; ariaLabel: string; pageTitle: string };
      status: "open" | "resolved";
      comments: Array<{ id: string; body: string; author: { kind: string; name: string }; createdAt: string }>;
      lastActivity: string;
    }>;
    return threads.map((t) => {
      const activeComments = t.comments.filter((c) => c.body.length > 0);
      const last = activeComments[activeComments.length - 1];
      return {
        threadId: t.id,
        status: t.status,
        anchorKey: t.anchorKey,
        anchorContext: t.anchorContext,
        lastComment: last?.body ?? "",
        lastAuthor: last?.author.name ?? "anonymous",
        lastActivity: t.lastActivity,
        commentCount: activeComments.length,
      };
    });
  }

  async createThread(params: CreateThreadParams): Promise<{ threadId: string; commentId: string; pageUrl: string }> {
    const res = await this._relay.send("create_comment", {
      body: params.body,
      url: params.url,
      anchorKey: params.anchorKey,
      authorName: params.authorName,
      threadId: params.threadId,
      commentId: params.commentId,
    });
    if (!res.success || !res.data) {
      throw new Error(res.error ?? "Create thread failed");
    }
    return res.data as { threadId: string; commentId: string; pageUrl: string };
  }

  async reply(params: ReplyParams): Promise<{ commentId: string; body: string; pageUrl: string }> {
    const res = await this._relay.send("reply_comment", {
      threadId: params.threadId,
      body: params.body,
      commentId: params.commentId,
      authorName: params.authorName,
    });
    if (!res.success || !res.data) {
      throw new Error(res.error ?? "Reply failed");
    }
    return res.data as { commentId: string; body: string; pageUrl: string };
  }

  async resolve(threadId: string, resolutionNote?: string): Promise<void> {
    const res = await this._relay.send("resolve_thread", { threadId, resolutionNote });
    if (!res.success) throw new Error(res.error ?? "Resolve failed");
  }

  async reopen(threadId: string): Promise<void> {
    const res = await this._relay.send("reopen_thread", { threadId });
    if (!res.success) throw new Error(res.error ?? "Reopen failed");
  }

  async delete(threadId: string, commentId?: string): Promise<void> {
    const action = commentId ? "delete_comment" : "delete_thread";
    const payload = commentId ? { threadId, commentId } : { threadId };
    const res = await this._relay.send(action, payload);
    if (!res.success) throw new Error(res.error ?? "Delete failed");
  }

  isConnected(): boolean {
    return this._relay.isConnected();
  }
}

// ── LocalStorageAdapter ──────────────────────────────────────────────────────

/**
 * @stub Not yet implemented — planned for Wave 2 (W2-A).
 * Provides local comment storage via chrome.storage.local.
 * See: docs/00-workplan/workplan-modularity-waves.md §W2-A
 *
 * Fallback: stores comments in chrome.storage.local only.
 * Used when no backend is connected (offline mode).
 *
 * @see PU-F-42
 */
export class LocalStorageAdapter implements CommentBackendAdapter {
  async listThreads(url: string): Promise<CommentThreadSummary[]> {
    const normalized = normalizeUrl(url);
    const threads = await getActiveThreads(normalized);
    return threads.map((thread) => this._toSummary(thread));
  }

  async createThread(params: CreateThreadParams): Promise<{ threadId: string; commentId: string; pageUrl: string }> {
    const normalized = normalizeUrl(params.url);
    const thread = await storeCreateThread(normalized, params.anchorKey, {
      body: params.body,
      author: { kind: "user", name: params.authorName ?? "anonymous" },
    });
    const firstComment = thread.comments[0];
    return { threadId: thread.id, commentId: firstComment.id, pageUrl: thread.pageUrl };
  }

  async reply(params: ReplyParams): Promise<{ commentId: string; body: string; pageUrl: string }> {
    const newComment = await storeAddComment(params.threadId, {
      body: params.body,
      author: { kind: "user", name: params.authorName ?? "anonymous" },
      commentId: params.commentId,
    });
    return { commentId: newComment.id, body: newComment.body, pageUrl: newComment.pageUrl };
  }

  async resolve(threadId: string, resolutionNote?: string): Promise<void> {
    await storeResolveThread(threadId, resolutionNote);
  }

  async reopen(threadId: string): Promise<void> {
    await storeReopenThread(threadId);
  }

  async delete(threadId: string, commentId?: string): Promise<void> {
    if (commentId) {
      await storeSoftDeleteComment(threadId, commentId);
    } else {
      await storeSoftDeleteThread(threadId);
    }
  }

  isConnected(): boolean {
    return true;
  }

  private _toSummary(thread: BrowserCommentThread): CommentThreadSummary {
    const activeComments = thread.comments.filter((c) => !c.deletedAt);
    const lastComment = activeComments[activeComments.length - 1];
    return {
      threadId: thread.id,
      status: thread.status,
      anchorKey: thread.anchorKey,
      anchorContext: thread.anchorContext,
      lastComment: lastComment?.body ?? "",
      lastAuthor: lastComment?.author.name ?? "anonymous",
      lastActivity: thread.lastActivity,
      commentCount: activeComments.length,
    };
  }
}

// ── StandaloneMcpAdapter (future — type only) ───────────────────────────────

/**
 * Future: Routes comment operations directly to an MCP server.
 * Used in standalone mode (no VS Code, browser extension only).
 *
 * This is a type-only slot — no implementation in this session.
 *
 * @see PU-F-45
 */
export interface StandaloneMcpAdapterConfig {
  /** MCP server URL (e.g. http://localhost:3000) */
  serverUrl: string;
  /** Authentication token for the MCP server */
  authToken?: string;
}

// ── Adapter Factory ──────────────────────────────────────────────────────────

/**
 * @stub Not yet implemented — planned for Wave 2 (W2-A).
 * Factory to select the appropriate CommentBackendAdapter at runtime.
 * See: docs/00-workplan/workplan-modularity-waves.md §W2-A
 *
 * Select the best available adapter based on connectivity.
 *
 * Priority:
 * 1. VscodeRelayAdapter — if relay WebSocket is connected
 * 2. LocalStorageAdapter — always available as fallback
 *
 * Future: StandaloneMcpAdapter between 1 and 2.
 *
 * @see PU-F-43
 */
export function selectAdapter(relay: RelayBridgeClient): CommentBackendAdapter {
  // Priority 1: VscodeRelayAdapter — if the relay WebSocket is connected
  if (relay.isConnected()) {
    return new VscodeRelayAdapter(relay);
  }
  // Priority 2: LocalStorageAdapter — always available as offline fallback
  return new LocalStorageAdapter();
}
