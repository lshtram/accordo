/**
 * M80-TYP — Shared TypeScript types for the Accordo browser extension.
 *
 * All types are runtime-free (no functions, no classes, no executable code).
 * Implements requirements BR-F-01 through BR-F-06.
 */

export type {
  BrowserComment,
  BrowserCommentThread,
  PageCommentStore,
  ScreenshotRecord,
} from "./comment-types.js";
export type {
  GetCommentsArgs,
  GetCommentsResult,
  GetScreenshotArgs,
  GetScreenshotResult,
  McpToolRequest,
  McpToolResponse,
} from "./mcp-types.js";

// ── Message types ─────────────────────────────────────────────────────────────

// NOTE: MESSAGE_TYPES constant and MessageType are defined in constants.ts
// (not here) to keep this module runtime-free as required by BR-F-06.

export type {
  CaptureRegionArgs,
  CaptureRegionResult,
  ExportPayload,
  ExportResult,
  Exporter,
} from "./export-types.js";
