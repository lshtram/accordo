/**
 * Comment system types — anchors, threads, storage, and scale constants.
 *
 * Sources:
 *   - comments-architecture.md §3.1 (CommentAnchor, SurfaceCoordinates)
 *   - comments-architecture.md §3.2 (AccordoComment, CommentContext)
 *   - comments-architecture.md §3.3 (CommentThread, CommentRetention)
 *   - comments-architecture.md §5.2 (CommentStoreFile)
 *   - comments-architecture.md §7 (CommentStateSummary)
 */

// ─── Comment Anchors ────────────────────────────────────────────────────────

/**
 * Where a comment points — a line range in a text file, a point on a visual
 * surface, or an entire file.
 *
 * Source: comments-architecture.md §3.1
 */
export type CommentAnchor =
  | CommentAnchorText
  | CommentAnchorSurface
  | CommentAnchorFile;

/** Text-file anchor — line range in a code/config/markdown source file. */
export interface CommentAnchorText {
  kind: "text";
  /** File URI (e.g. "file:///project/src/auth.ts") */
  uri: string;
  /** Line/char range the comment is attached to */
  range: CommentRange;
  /** TextDocument.version at creation time */
  docVersion: number;
}

/** Visual-surface anchor — a point on a diagram, image, PDF, etc. */
export interface CommentAnchorSurface {
  kind: "surface";
  /** File URI of the underlying resource */
  uri: string;
  surfaceType: SurfaceType;
  coordinates: SurfaceCoordinates;
}

/** File-level anchor — comment on an entire file, no specific location. */
export interface CommentAnchorFile {
  kind: "file";
  /** File URI */
  uri: string;
}

/**
 * Line/character range for text anchors.
 * All values are 0-based.
 */
export interface CommentRange {
  startLine: number;
  startChar: number;
  endLine: number;
  endChar: number;
}

// ─── Surface Types & Coordinates ────────────────────────────────────────────

/** Visual surface types supported by the Comment SDK. */
export type SurfaceType =
  | "diagram"
  | "image"
  | "pdf"
  | "markdown-preview"
  | "slide"
  | "browser";

/**
 * Coordinates on a visual surface. Each type is specific to its surface.
 *
 * Source: comments-architecture.md §3.1
 */
export type SurfaceCoordinates =
  | NormalizedCoordinates
  | DiagramNodeCoordinates
  | PdfPageCoordinates
  | SlideCoordinates
  | HeadingCoordinates
  | BlockCoordinates;

export interface NormalizedCoordinates {
  type: "normalized";
  /** 0..1 range */
  x: number;
  /** 0..1 range */
  y: number;
}

export interface DiagramNodeCoordinates {
  type: "diagram-node";
  /** Mermaid/Excalidraw node ID */
  nodeId: string;
}

export interface PdfPageCoordinates {
  type: "pdf-page";
  page: number;
  /** 0..1 range within page */
  x: number;
  /** 0..1 range within page */
  y: number;
}

export interface SlideCoordinates {
  type: "slide";
  slideIndex: number;
  /** 0..1 range within slide */
  x: number;
  /** 0..1 range within slide */
  y: number;
}

export interface HeadingCoordinates {
  type: "heading";
  headingText: string;
  headingLevel: number;
}

/**
 * Block-level coordinate for rendered document surfaces (markdown-preview, etc.).
 * BlockId format: "heading:{level}:{slug}" | "p:{index}" | "li:{listIdx}:{itemIdx}" | "pre:{index}"
 *
 * Source: comments-architecture.md §8.4 (M41b variant)
 */
export interface BlockCoordinates {
  type: "block";
  /** Stable content-addressable ID for the block element — see BlockIdPlugin */
  blockId: string;
  blockType: "heading" | "paragraph" | "list-item" | "code-block";
}

// ─── Comment Entities ───────────────────────────────────────────────────────

/**
 * A single comment in a thread.
 *
 * Source: comments-architecture.md §3.2
 */
export interface AccordoComment {
  /** UUID */
  id: string;
  /** Groups replies together — same as the thread's ID */
  threadId: string;
  /** ISO 8601 */
  createdAt: string;
  author: CommentAuthor;
  /** Markdown body */
  body: string;
  /** Where this comment points (copied from thread on creation) */
  anchor: CommentAnchor;
  intent?: CommentIntent;
  status: CommentStatus;
  /** Set when status → "resolved" */
  resolutionNote?: string;
  /** Captured at creation time */
  context?: CommentContext;
}

/** Who wrote the comment. */
export interface CommentAuthor {
  kind: "user" | "agent";
  name: string;
  /** MCP session or agent identifier */
  agentId?: string;
}

/** Intent tag — what the commenter wants done. */
export type CommentIntent =
  | "fix"
  | "explain"
  | "refactor"
  | "review"
  | "design"
  | "question";

/** Thread/comment lifecycle. */
export type CommentStatus = "open" | "resolved";

/**
 * Retention policy for comment threads.
 *
 * - "standard"          — default; persists until explicitly deleted or resolved.
 * - "volatile-browser"  — browser pages change frequently; these threads are
 *                          marked for easy bulk cleanup via the Comments Panel.
 *
 * Source: comments-architecture.md §3.3
 */
export type CommentRetention = "standard" | "volatile-browser";

/**
 * Context captured automatically when a comment is created.
 *
 * Source: comments-architecture.md §3.2
 */
export interface CommentContext {
  viewportSnap?: {
    /** ~20 lines above, capped at 1KB */
    before: string;
    /** Selected text at creation */
    selected?: string;
    /** ~20 lines below, capped at 1KB */
    after: string;
  };
  diagnostics?: CommentDiagnostic[];
  git?: {
    branch?: string;
    commit?: string;
  };
  languageId?: string;
  /** Surface-specific context */
  surfaceMetadata?: Record<string, string>;
}

/** Diagnostic captured in comment context. */
export interface CommentDiagnostic {
  range: { startLine: number; endLine: number };
  message: string;
  severity: "error" | "warning" | "info" | "hint";
  source?: string;
}

// ─── Comment Threads & Storage ──────────────────────────────────────────────

/**
 * A thread is a group of comments sharing the same threadId and anchor.
 *
 * Source: comments-architecture.md §3.3
 */
export interface CommentThread {
  /** Same as threadId on contained comments */
  id: string;
  anchor: CommentAnchor;
  comments: AccordoComment[];
  /** Derived: "resolved" if last resolve action set it */
  status: CommentStatus;
  /**
   * Retention policy. Browser-origin threads default to "volatile-browser";
   * all others default to "standard". Optional for backwards compatibility
   * with existing persisted data (missing → treated as "standard").
   *
   * Source: comments-architecture.md §3.3
   */
  retention?: CommentRetention;
  /** First comment's timestamp */
  createdAt: string;
  /** Most recent comment's timestamp */
  lastActivity: string;
}

/**
 * On-disk format of .accordo/comments.json.
 *
 * Source: comments-architecture.md §5.2
 */
export interface CommentStoreFile {
  version: "1.0";
  threads: CommentThread[];
}

/**
 * Modality state published via bridge.publishState('accordo-comments', ...).
 *
 * Source: comments-architecture.md §7
 */
export interface CommentStateSummary {
  isOpen: true;
  openThreadCount: number;
  resolvedThreadCount: number;
  /** At most 10 open threads, most recent first, body truncated to 80 chars */
  summary: CommentThreadSummary[];
  /** Pipe-separated list of available MCP tool names for agent guidance */
  tools?: string;
  /**
   * Full list of all threads (open + resolved), un-truncated.
   * Published by state-contribution for the /state debug endpoint (M43).
   * Not used by the prompt engine — prompt uses `summary` (capped/truncated).
   */
  threads?: CommentThread[];
}

/** Single entry in the modality state summary. */
export interface CommentThreadSummary {
  threadId: string;
  uri: string;
  /** Line number for text anchors */
  line?: number;
  /** Surface type for surface anchors */
  surfaceType?: SurfaceType;
  /** Node ID for diagram-node anchors */
  nodeId?: string;
  intent?: CommentIntent;
  /** First 80 chars of the body */
  preview: string;
}

// ─── Comment Scale Constants ─────────────────────────────────────────────────

/** Maximum number of comment threads per workspace */
export const COMMENT_MAX_THREADS = 500;

/** Warning threshold for thread count (warn at this, refuse at COMMENT_MAX_THREADS) */
export const COMMENT_WARN_THREADS = 400;

/** Maximum number of comments per thread */
export const COMMENT_MAX_COMMENTS_PER_THREAD = 50;

/** Maximum size of .accordo/comments.json in bytes (2 MB) */
export const COMMENT_MAX_STORE_SIZE = 2 * 1024 * 1024;

/** Maximum viewport snap size per comment in bytes (2 KB) */
export const COMMENT_MAX_VIEWPORT_SNAP_SIZE = 2 * 1024;

/** Maximum open threads shown in modality state summary */
export const COMMENT_MAX_SUMMARY_THREADS = 10;

/** Maximum body preview length in summary (chars) */
export const COMMENT_SUMMARY_PREVIEW_LENGTH = 80;

/** Default limit for comment.list results */
export const COMMENT_LIST_DEFAULT_LIMIT = 50;

/** Maximum limit for comment.list results */
export const COMMENT_LIST_MAX_LIMIT = 200;

/** Maximum body preview length in comment.list firstComment (chars) */
export const COMMENT_LIST_BODY_PREVIEW_LENGTH = 200;

/** Rate limit: max comment.create calls per minute per agent */
export const COMMENT_CREATE_RATE_LIMIT = 10;

/** Rate limit window in milliseconds (1 minute) */
export const COMMENT_CREATE_RATE_WINDOW_MS = 60_000;
