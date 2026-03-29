/**
 * relay-definitions.ts — Type contracts and shared state for the relay layer.
 *
 * Contains all public type definitions (RelayAction, RelayActionRequest,
 * RelayActionResponse, CapturePayload), the module-level SnapshotStore
 * singleton, and the isVersionedSnapshot type guard.
 *
 * Split from relay-actions.ts (B5a modularity).
 *
 * @module
 */

import { SnapshotStore } from "./snapshot-versioning.js";
import type { VersionedSnapshot } from "./snapshot-versioning.js";

// ── Type Definitions ─────────────────────────────────────────────────────────

export type RelayAction =
  | "get_all_comments"
  | "get_comments"
  | "create_comment"
  | "reply_comment"
  | "resolve_thread"
  | "reopen_thread"
  | "delete_comment"
  | "delete_thread"
  | "notify_comments_updated"
  | "get_page_map"
  | "inspect_element"
  | "get_dom_excerpt"
  | "capture_region"
  | "diff_snapshots"
  | "wait_for"
  | "get_text_map"
  | "get_semantic_graph"
  | "list_pages"
  | "select_page";

export interface RelayActionRequest {
  requestId: string;
  action: RelayAction;
  payload: Record<string, unknown>;
}

export interface RelayActionResponse {
  requestId: string;
  success: boolean;
  /**
   * B2-SV-003: For data-producing tool responses, the full SnapshotEnvelope
   * is included inside `data`. The relay forwards the envelope created by
   * the content script without modification. This top-level `snapshotId`
   * is retained for backward compatibility on error responses only.
   */
  snapshotId?: string;
  data?: unknown;
  error?:
    | "action-failed"
    | "unsupported-action"
    | "invalid-request"
    | "no-target"
    | "capture-failed"
    | "image-too-large"
    | "snapshot-not-found"
    | "snapshot-stale"
    | "navigation-interrupted"
    | "page-closed";
}

export interface CapturePayload {
  anchorKey?: string;
  nodeRef?: string;
  rect?: { x: number; y: number; width: number; height: number };
  padding?: number;
  quality?: number;
}

// ── Module-level Singleton ───────────────────────────────────────────────────

/**
 * B2-SV-004: Module-level SnapshotStore singleton for runtime snapshot retention.
 * Persists capture_region results (5-slot FIFO per page).
 * B2-SV-005: Cleared on navigation via handleNavigationReset().
 *
 * Exported for direct use in tests (diff_snapshots boundary tests).
 */
export const defaultStore: SnapshotStore = new SnapshotStore();

// ── Type Guard ───────────────────────────────────────────────────────────────

/**
 * Runtime type guard for VersionedSnapshot.
 * Replaces unsafe `as unknown as VersionedSnapshot` casts — validates all
 * required fields are present with the correct types before narrowing.
 */
export function isVersionedSnapshot(val: unknown): val is VersionedSnapshot {
  if (val === null || typeof val !== "object") return false;
  const v = val as Record<string, unknown>;
  return (
    typeof v.pageId === "string" &&
    typeof v.frameId === "string" &&
    typeof v.snapshotId === "string" &&
    typeof v.capturedAt === "string" &&
    typeof v.source === "string" &&
    v.viewport !== null &&
    typeof v.viewport === "object" &&
    Array.isArray(v.nodes)
  );
}
