/**
 * GAP-G1 — Manage Screenshots MCP Tool
 *
 * Provides retention control for the browser package screenshot store:
 *   - browser_manage_screenshots action: "list" — returns screenshot metadata per page
 *   - browser_manage_screenshots action: "clear" — empties the store (and deletes files)
 *
 * @module
 */

import type { ExtensionToolDefinition } from "@accordo/bridge-types";
import type { BrowserRelayLike } from "./types.js";
import type { ScreenshotRetentionStore } from "./screenshot-retention.js";

// ── Tool Input/Output Types ─────────────────────────────────────────────────

/** Input for `browser_manage_screenshots`. */
export interface ManageScreenshotsArgs {
  /** Action to perform: "list" returns screenshot metadata, "clear" empties the store */
  action: "list" | "clear";
  /** Optional pageId to target for "clear" action. If omitted, clears all pages. */
  pageId?: string;
}

/** Response from `browser_manage_screenshots` — "list" action. */
export interface ManageScreenshotsListResponse {
  pages: {
    pageId: string;
    screenshotCount: number;
    screenshots: {
      screenshotId: string;
      capturedAt: string;
      filePath: string;
      sizeBytes: number;
      format: string;
      width: number;
      height: number;
    }[];
  }[];
}

/** Response from `browser_manage_screenshots` — "clear" action. */
export interface ManageScreenshotsClearResponse {
  success: boolean;
  clearedPageId?: string;
  /** Total screenshots cleared across all pages */
  clearedCount: number;
}

/**
 * Union response type for both list and clear actions.
 */
export type ManageScreenshotsResponse = ManageScreenshotsListResponse | ManageScreenshotsClearResponse;

// ── Tool Definition ─────────────────────────────────────────────────────────

/**
 * Build the `browser_manage_screenshots` MCP tool.
 *
 * GAP-G1: Provides screenshot retention control — list all screenshot metadata
 * or clear the store (optionally for a specific page only). Clearing also
 * deletes the on-disk screenshot files.
 *
 * @param _relay — The relay connection (unused for this local-only tool)
 * @param store — Shared screenshot retention store
 * @returns A single tool definition for `browser_manage_screenshots`
 */
export function buildManageScreenshotsTool(
  _relay: BrowserRelayLike,
  store: ScreenshotRetentionStore,
): ExtensionToolDefinition {
  const handler = async (args: ManageScreenshotsArgs): Promise<ManageScreenshotsResponse> => {
    if (args.action === "list") {
      const allPages = store.listAll();
      const pages: ManageScreenshotsListResponse["pages"] = [];

      for (const [pageId, records] of allPages) {
        pages.push({
          pageId,
          screenshotCount: records.length,
          screenshots: records.map((rec) => ({
            screenshotId: rec.screenshotId,
            capturedAt: rec.capturedAt,
            filePath: rec.filePath,
            sizeBytes: rec.sizeBytes,
            format: rec.format,
            width: rec.width,
            height: rec.height,
          })),
        });
      }

      return { pages };
    }

    if (args.action === "clear") {
      const allPages = store.listAll();

      if (args.pageId !== undefined) {
        // Clear specific page
        const pageRecords = allPages.get(args.pageId) ?? [];
        store.clear(args.pageId);
        return {
          success: true,
          clearedPageId: args.pageId,
          clearedCount: pageRecords.length,
        };
      } else {
        // Clear all pages
        const totalCount = Array.from(allPages.values()).reduce((sum, recs) => sum + recs.length, 0);
        store.clear();
        return {
          success: true,
          clearedCount: totalCount,
        };
      }
    }

    // Should not reach here due to type narrowing
    return { success: false, clearedCount: 0 };
  };

  return {
    name: "accordo_browser_manage_screenshots",
    description:
      "GAP-G1: List all retained screenshot metadata per page, or clear the screenshot store (all pages or a specific page). " +
      "Use 'list' to see what screenshots are currently retained. Use 'clear' to empty the store and delete on-disk files.",
    inputSchema: {
      type: "object",
      required: ["action"],
      properties: {
        action: {
          type: "string",
          enum: ["list", "clear"],
          description: "Action to perform: 'list' returns screenshot metadata per page, 'clear' empties the store",
        },
        pageId: {
          type: "string",
          description: "Optional page ID to target for 'clear'. If omitted, clears all pages.",
        },
      },
    },
    dangerLevel: "safe",
    idempotent: false,
    handler: (args) => handler(args as unknown as ManageScreenshotsArgs),
  };
}
