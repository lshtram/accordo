/**
 * M80-TYP — Shared TypeScript types for the Accordo browser extension.
 *
 * All types are runtime-free (no functions, no classes, no executable code).
 * Implements requirements BR-F-01 through BR-F-06.
 */

// ── Comment types ────────────────────────────────────────────────────────────

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
    tagName: string;
    textSnippet?: string;
    ariaLabel?: string;
    pageTitle?: string;
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
  lastScreenshot?: ScreenshotRecord;
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

// ── MCP types ────────────────────────────────────────────────────────────────

/** Standard MCP tool call shape */
export interface McpToolRequest<T = Record<string, unknown>> {
  tool: string;
  args: T;
  requestId: string;
}

/** Standard MCP tool response shape */
export interface McpToolResponse<T = unknown> {
  requestId: string;
  success: boolean;
  data?: T;
  error?: string;
}

/** Args for get_screenshot MCP tool */
export interface GetScreenshotArgs {
  /** Page URL to get screenshot for. If omitted, uses active tab. */
  url?: string;
}

/** Result for get_screenshot MCP tool */
export interface GetScreenshotResult {
  dataUrl: string;
  capturedAt: number;
  pageUrl: string;
  viewport: {
    width: number;
    height: number;
  };
}

/** Args for get_comments MCP tool */
export interface GetCommentsArgs {
  /** Page URL. Required. */
  url: string;
  /** Filter by status */
  status?: "open" | "resolved" | "all";
  /** Include soft-deleted */
  includeDeleted?: boolean;
}

/** Result for get_comments MCP tool */
export interface GetCommentsResult {
  url: string;
  threads: BrowserCommentThread[];
  totalThreads: number;
  openThreads: number;
}

// ── Message types ─────────────────────────────────────────────────────────────

// NOTE: MESSAGE_TYPES constant and MessageType are defined in constants.ts
// (not here) to keep this module runtime-free as required by BR-F-06.

export interface ExportPayload {
  url: string;
  exportedAt: string;
  threads: BrowserCommentThread[];
  screenshot?: ScreenshotRecord;
}

/** Result returned from an exporter */
export interface ExportResult {
  success: boolean;
  error?: string;
  /** Human-readable description of what happened */
  summary: string;
}

/** Abstract exporter interface — clipboard is v1, others are additive */
export interface Exporter {
  readonly name: string;
  export(payload: ExportPayload, format?: "markdown" | "json"): Promise<ExportResult>;
}
