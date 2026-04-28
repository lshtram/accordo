/**
 * GAP-G1 — Manage Snapshots MCP Tool
 *
 * Provides retention control for the browser package snapshot store:
 *   - browser_manage_snapshots action: "list" — returns snapshot metadata per page
 *   - browser_manage_snapshots action: "clear" — empties the store or a specific page
 *
 * This is a browser-package local tool. It never delegates to the relay —
 * uses the local SnapshotRetentionStore directly, mirroring manage-screenshots-tool.
 *
 * @module
 */

import type { ExtensionToolDefinition } from "@accordo/bridge-types";
import type { BrowserRelayLike } from "./types.js";
import type { SnapshotRetentionStore } from "./snapshot-retention.js";

// ── Input / Output Types ────────────────────────────────────────────────────

/** Input for `browser_manage_snapshots`. */
export interface ManageSnapshotsArgs {
  action: "list" | "clear";
  /** If omitted or empty/whitespace, treated as "all pages". */
  pageId?: string;
}

/** Metadata for a single snapshot within a list response. */
interface SnapshotMetadata {
  snapshotId: string;
  capturedAt: string;
  source: string;
  frameId?: string;
}

/** "list" response — one entry per page (only pages that exist). */
export interface ManageSnapshotsListResponse {
  pages: { pageId: string; snapshotCount: number; snapshots: SnapshotMetadata[] }[];
}

/** "clear" response. */
export interface ManageSnapshotsClearResponse {
  success: true;
  clearedPageId?: string;
  clearedCount: number;
}

export type ManageSnapshotsResponse = ManageSnapshotsListResponse | ManageSnapshotsClearResponse;

export interface ManageSnapshotsErrorResponse {
  success: false;
  error: "invalid-request";
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Empty / whitespace-only pageId is treated as "no filter". */
function normalizePageId(pageId?: string): string | undefined {
  return pageId?.trim().length ? pageId.trim() : undefined;
}

/** Extract the serializable metadata fields from an envelope — no heavy payloads. */
function toMetadata(env: { snapshotId: string; capturedAt: string; source: string; frameId?: string }): SnapshotMetadata {
  return { snapshotId: env.snapshotId, capturedAt: env.capturedAt, source: env.source, frameId: env.frameId };
}

// ── Handler ─────────────────────────────────────────────────────────────────

async function handleList(
  store: SnapshotRetentionStore,
  pageId?: string,
): Promise<ManageSnapshotsListResponse> {
  const pid = normalizePageId(pageId);
  const all = store.listAll();
  if (pid !== undefined) {
    const envelopes = all.get(pid);
    if (!envelopes) return { pages: [] };
    return { pages: [{ pageId: pid, snapshotCount: envelopes.length, snapshots: envelopes.map(toMetadata) }] };
  }
  return {
    pages: Array.from(all.entries()).map(([id, envs]) => ({
      pageId: id,
      snapshotCount: envs.length,
      snapshots: envs.map(toMetadata),
    })),
  };
}

async function handleClear(
  store: SnapshotRetentionStore,
  pageId?: string,
): Promise<ManageSnapshotsClearResponse> {
  const pid = normalizePageId(pageId);
  const all = store.listAll();
  if (pid !== undefined) {
    const count = all.get(pid)?.length ?? 0;
    store.clear(pid);
    return { success: true, clearedPageId: pid, clearedCount: count };
  }
  const total = Array.from(all.values()).reduce((s, e) => s + e.length, 0);
  store.clear();
  return { success: true, clearedCount: total };
}

// ── Tool Definition ─────────────────────────────────────────────────────────

export function buildManageSnapshotsTool(
  _relay: BrowserRelayLike,
  store: SnapshotRetentionStore,
): ExtensionToolDefinition {
  const handler = async (args: ManageSnapshotsArgs): Promise<ManageSnapshotsResponse | ManageSnapshotsErrorResponse> => {
    if (args.action === "list") return handleList(store, args.pageId);
    if (args.action === "clear") return handleClear(store, args.pageId);
    return { success: false, error: "invalid-request" };
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
        action: { type: "string", enum: ["list", "clear"], description: "'list' returns snapshot metadata per page; 'clear' empties the store" },
        pageId: { type: "string", description: "Optional page ID. If omitted, targets all pages." },
      },
    },
    dangerLevel: "safe",
    idempotent: false,
    handler: (args) => handler(args as unknown as ManageSnapshotsArgs),
  };
}
