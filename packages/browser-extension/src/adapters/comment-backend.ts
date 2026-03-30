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
  createThread(params: CreateThreadParams): Promise<{ threadId: string; commentId: string }>;

  /** Reply to an existing thread */
  reply(params: ReplyParams): Promise<{ commentId: string }>;

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

  /** @stub */
  async listThreads(_url: string): Promise<CommentThreadSummary[]> {
    throw new Error("not implemented — stub for Wave 2 W2-A");
  }

  /** @stub */
  async createThread(_params: CreateThreadParams): Promise<{ threadId: string; commentId: string }> {
    throw new Error("not implemented — stub for Wave 2 W2-A");
  }

  /** @stub */
  async reply(_params: ReplyParams): Promise<{ commentId: string }> {
    throw new Error("not implemented — stub for Wave 2 W2-A");
  }

  /** @stub */
  async resolve(_threadId: string, _resolutionNote?: string): Promise<void> {
    throw new Error("not implemented — stub for Wave 2 W2-A");
  }

  /** @stub */
  async reopen(_threadId: string): Promise<void> {
    throw new Error("not implemented — stub for Wave 2 W2-A");
  }

  /** @stub */
  async delete(_threadId: string, _commentId?: string): Promise<void> {
    throw new Error("not implemented — stub for Wave 2 W2-A");
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
  /** @stub */
  async listThreads(_url: string): Promise<CommentThreadSummary[]> {
    throw new Error("not implemented — stub for Wave 2 W2-A");
  }

  /** @stub */
  async createThread(_params: CreateThreadParams): Promise<{ threadId: string; commentId: string }> {
    throw new Error("not implemented — stub for Wave 2 W2-A");
  }

  /** @stub */
  async reply(_params: ReplyParams): Promise<{ commentId: string }> {
    throw new Error("not implemented — stub for Wave 2 W2-A");
  }

  /** @stub */
  async resolve(_threadId: string, _resolutionNote?: string): Promise<void> {
    throw new Error("not implemented — stub for Wave 2 W2-A");
  }

  /** @stub */
  async reopen(_threadId: string): Promise<void> {
    throw new Error("not implemented — stub for Wave 2 W2-A");
  }

  /** @stub */
  async delete(_threadId: string, _commentId?: string): Promise<void> {
    throw new Error("not implemented — stub for Wave 2 W2-A");
  }

  isConnected(): boolean {
    // Local storage is always available
    return true;
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
  throw new Error("not implemented — stub for Wave 2 W2-A");
}
