/**
 * M80-MCP — MCP Handler Layer
 *
 * Fully typed MCP handler functions. Real handlers reading from
 * chrome.storage.local. Transport layer is stubbed (no WebSocket relay in v1).
 */

import type {
  GetCommentsArgs,
  GetCommentsResult,
  GetScreenshotArgs,
  GetScreenshotResult,
  McpToolRequest,
  McpToolResponse,
} from "./types.js";
import { getActiveThreads, getAllThreads } from "./store.js";
import { getScreenshot } from "./screenshot.js";
import { normalizeUrl } from "./store.js";

/**
 * Handles the get_comments MCP tool call.
 * Reads real comment data from chrome.storage.local.
 * Applies status filter if specified (BR-F-94).
 */
export async function handleGetComments(
  request: McpToolRequest<GetCommentsArgs>
): Promise<McpToolResponse<GetCommentsResult>> {
  const { url, status, includeDeleted } = request.args;

  const allThreads = includeDeleted
    ? await getAllThreads(url)
    : await getActiveThreads(url);

  // Apply status filter (BR-F-94)
  const threads = status && status !== "all"
    ? allThreads.filter((t) => t.status === status)
    : allThreads;

  // Only return "no-comments-found" when we explicitly filtered and got nothing.
  // With includeDeleted: true, an empty result is valid (there genuinely are no comments).
  // With status filter, an empty result is also valid (no threads match the status).
  const hasExplicitFilter = !includeDeleted || (status !== undefined && status !== "all");
  if (threads.length === 0 && hasExplicitFilter) {
    return {
      requestId: request.requestId,
      success: false,
      error: "no-comments-found",
    };
  }

  // openThreads counts non-deleted, open threads for the summary stats
  const openThreads = threads.filter((t) => t.status === "open" && !t.deletedAt).length;

  return {
    requestId: request.requestId,
    success: true,
    data: {
      url: normalizeUrl(url),
      threads,
      totalThreads: threads.length,
      openThreads,
    },
  };
}

/**
 * Handles the get_screenshot MCP tool call.
 * Reads real screenshot data from chrome.storage.local.
 */
export async function handleGetScreenshot(
  request: McpToolRequest<GetScreenshotArgs>
): Promise<McpToolResponse<GetScreenshotResult>> {
  const url = request.args.url;

  if (!url) {
    return {
      requestId: request.requestId,
      success: false,
      error: "no-screenshot-available",
    };
  }

  const record = await getScreenshot(url);

  if (!record) {
    return {
      requestId: request.requestId,
      success: false,
      error: "no-screenshot-available",
    };
  }

  return {
    requestId: request.requestId,
    success: true,
    data: {
      dataUrl: record.dataUrl,
      capturedAt: record.capturedAt,
      pageUrl: normalizeUrl(url),
      viewport: {
        width: record.width,
        height: record.height,
      },
    },
  };
}
