/**
 * GAP-G1 — Manage Snapshots MCP Tool
 *
 * Provides retention control for the browser package snapshot store:
 *   - browser_manage_snapshots action: "list" — returns snapshot metadata per page
 *   - browser_manage_snapshots action: "clear" — empties the store or a specific page
 *
 * @module
 */

import type { ExtensionToolDefinition } from "@accordo/bridge-types";
import type { BrowserRelayLike } from "./types.js";
import type { SnapshotRetentionStore } from "./snapshot-retention.js";

// ── Tool Input/Output Types ─────────────────────────────────────────────────

/** Input for `browser_manage_snapshots`. */
export interface ManageSnapshotsArgs {
  /** Action to perform: "list" returns snapshot metadata, "clear" empties the store */
  action: "list" | "clear";
  /** Optional pageId to target for "clear" action. If omitted, clears all pages. */
  pageId?: string;
}

/** Response from `browser_manage_snapshots` — "list" action. */
export interface ManageSnapshotsListResponse {
  pages: {
    pageId: string;
    snapshotCount: number;
    snapshots: {
      snapshotId: string;
      capturedAt: string;
      source: string;
    }[];
  }[];
}

/** Response from `browser_manage_snapshots` — "clear" action. */
export interface ManageSnapshotsClearResponse {
  success: boolean;
  clearedPageId?: string;
  /** Total snapshots cleared across all pages */
  clearedCount: number;
}

/**
 * Union response type for both list and clear actions.
 */
export type ManageSnapshotsResponse = ManageSnapshotsListResponse | ManageSnapshotsClearResponse;

// ── Tool Definition ────────────────────────────────────────────────────────

/**
 * Build the `browser_manage_snapshots` MCP tool.
 *
 * GAP-G1: Provides retention control — list all snapshot metadata or clear
 * the store (optionally for a specific page only).
 *
 * @param relay — The relay connection (unused for this local-only tool)
 * @param store — Shared snapshot retention store
 * @returns A single tool definition for `browser_manage_snapshots`
 */
export function buildManageSnapshotsTool(
  _relay: BrowserRelayLike,
  store: SnapshotRetentionStore,
): ExtensionToolDefinition {
  const handler = async (args: ManageSnapshotsArgs): Promise<ManageSnapshotsResponse> => {
    if (args.action === "list") {
      const allPages = store.listAll();
      const pages: ManageSnapshotsListResponse["pages"] = [];

      for (const [pageId, envelopes] of allPages) {
        pages.push({
          pageId,
          snapshotCount: envelopes.length,
          snapshots: envelopes.map((env) => ({
            snapshotId: env.snapshotId,
            capturedAt: env.capturedAt,
            source: env.source,
          })),
        });
      }

      return { pages };
    }

    if (args.action === "clear") {
      const allPages = store.listAll();

      if (args.pageId !== undefined) {
        // Clear specific page
        const pageEnvelopes = allPages.get(args.pageId) ?? [];
        store.clear(args.pageId);
        return {
          success: true,
          clearedPageId: args.pageId,
          clearedCount: pageEnvelopes.length,
        };
      } else {
        // Clear all pages
        const totalCount = Array.from(allPages.values()).reduce((sum, envs) => sum + envs.length, 0);
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
    name: "accordo_browser_manage_snapshots",
    description:
      "GAP-G1: List all retained snapshot metadata per page, or clear the snapshot store (all pages or a specific page). " +
      "Use 'list' to see what snapshots are currently retained. Use 'clear' to empty the store.",
    inputSchema: {
      type: "object",
      required: ["action"],
      properties: {
        action: {
          type: "string",
          enum: ["list", "clear"],
          description: "Action to perform: 'list' returns snapshot metadata per page, 'clear' empties the store",
        },
        pageId: {
          type: "string",
          description: "Optional page ID to target for 'clear'. If omitted, clears all pages.",
        },
      },
    },
    dangerLevel: "safe",
    idempotent: false,
    handler: (args) => handler(args as unknown as ManageSnapshotsArgs),
  };
}
