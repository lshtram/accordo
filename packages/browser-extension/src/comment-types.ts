/** A single comment on a web page element. */
export interface BrowserComment {
  /** UUID v4 */
  id: string;
  /** Groups replies together. First comment's id === threadId. */
  threadId: string;
  /** ISO 8601 creation timestamp */
  createdAt: string;
  /** Comment author */
  author: {
    kind: "user";
    name: string;
  };
  /** Comment text (plain text in v1) */
  body: string;
  /** The anchor key identifying the DOM element */
  anchorKey: string;
  /** Page URL (origin + pathname, query stripped) */
  pageUrl: string;
  /** Status of this comment */
  status: "open" | "resolved";
  /** Resolution note (set when status → "resolved") */
  resolutionNote?: string;
  /** ISO 8601 timestamp when soft-deleted. Undefined = not deleted. */
  deletedAt?: string;
  /** Who deleted it */
  deletedBy?: string;
}

/** A thread is a group of comments sharing the same threadId. */
export interface BrowserCommentThread {
  id: string;
  anchorKey: string;
  anchorContext?: {
    tagName?: string;
    frameId?: string;
    textSnippet?: string;
    ariaLabel?: string;
    pageTitle?: string;
    snapshotId?: string;
    confidence?: "high" | "medium" | "low" | "none";
    resolvedTier?: 1 | 2 | 3 | 4 | 5 | 6;
    snapshotDrift?: boolean;
  };
  pageUrl: string;
  status: "open" | "resolved";
  comments: BrowserComment[];
  createdAt: string;
  lastActivity: string;
  /** If set, the entire thread is soft-deleted */
  deletedAt?: string;
  deletedBy?: string;
}

/** Per-URL storage record */
export interface PageCommentStore {
  version: "1.0";
  url: string;
  threads: BrowserCommentThread[];
}

/** Per-URL screenshot record (stored separately, key: "screenshot:{normalizedUrl}") */
export interface ScreenshotRecord {
  /** Base64-encoded JPEG data URL */
  dataUrl: string;
  /** Unix timestamp (ms) when captured */
  capturedAt: number;
  /** Viewport width at capture time */
  width: number;
  /** Viewport height at capture time */
  height: number;
}
