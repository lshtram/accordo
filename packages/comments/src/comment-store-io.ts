/**
 * comment-store-io — Public types for CommentRepository.
 *
 * All parameter/result interfaces for the repository API, plus
 * the serialization helpers (loadFromStoreFile / toStoreFile concepts).
 *
 * Source: b4a-architecture.md
 */

import type {
  CommentAnchor,
  CommentAuthor,
  CommentIntent,
  CommentStatus,
  CommentContext,
  CommentRetention,
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
