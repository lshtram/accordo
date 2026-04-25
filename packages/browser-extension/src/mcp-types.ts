import type { BrowserCommentThread } from "./comment-types.js";

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
