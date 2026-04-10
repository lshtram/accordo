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
  | "get_comments_version"
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
  | "capture_full_page_screenshot"
  | "diff_snapshots"
  | "wait_for"
  | "get_text_map"
  | "get_semantic_graph"
  | "list_pages"
  | "select_page"
  | "get_spatial_relations"
  | "navigate"
  | "click"
  | "type"
  | "press_key";

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
  /**
   * MCP-SEC-004: UUIDv4 audit identifier for this tool invocation.
   * Present on all responses (success and failure) for traceability.
   */
  auditId?: string;
  /**
   * MCP-SEC-005: Present when redactPII is false/omitted on text-producing
   * read tools. Warns callers that PII may be present in the response.
   */
  redactionWarning?: string;
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
    | "page-closed"
    | "control-not-granted"
    | "unsupported-page"
    | "element-not-found"
    | "element-off-screen"
    | "iframe-cross-origin"
    | "no-content-script"
    | "origin-blocked"
    | "redaction-failed";
  /**
   * MCP-ER-002: Whether the error is retryable.
   * Present on error responses only.
   */
  retryable?: boolean;
  /** Index signature — allows RelayActionResponse to satisfy Record<string, unknown> */
  [key: string]: unknown;
}

export interface CapturePayload {
  /** B2-CTX-001: Optional tab ID to target; omit for active tab */
  tabId?: number;
  anchorKey?: string;
  nodeRef?: string;
  rect?: { x: number; y: number; width: number; height: number };
  padding?: number;
  quality?: number;
  /** P4-CR: "viewport" (default) or "fullPage" */
  mode?: "viewport" | "fullPage";
  /** GAP-E1 / E4: Output image format — "jpeg" (default), "png", or "webp" */
  format?: "jpeg" | "png" | "webp";
  /** GAP-I1: Redaction regex patterns to apply to screenshot (bbox-based). */
  redactPatterns?: string[];
}

// ── Module-level Singleton ───────────────────────────────────────────────────

/**
 * B2-SV-004: Module-level SnapshotStore singleton for runtime snapshot retention.
 * Persists capture_region results (5-slot FIFO per page).
 * B2-SV-005: Cleared on navigation via handleNavigationReset().
 * GAP-I1: Default TTL of 1 hour — setMaxAgeMs() can be called to adjust.
 *
 * Exported for direct use in tests (diff_snapshots boundary tests).
 */
export const defaultStore: SnapshotStore = new SnapshotStore();
defaultStore.setMaxAgeMs(3600000); // 1 hour default TTL

// ── Shared Response Helpers ──────────────────────────────────────────────────

/**
 * MCP-ER-002: Retry metadata for structured error responses.
 * Maps error codes to retryable flag and optional retryAfterMs.
 * Codes not listed default to retryable: true with no retryAfterMs.
 */
const ERROR_META: Record<string, { retryable: boolean; retryAfterMs?: number }> = {
  "browser-not-connected": { retryable: true, retryAfterMs: 2000 },
  "timeout": { retryable: true, retryAfterMs: 1000 },
  "element-not-found": { retryable: false },
  "element-off-screen": { retryable: false },
  "image-too-large": { retryable: false },
  "capture-failed": { retryable: false },
  "origin-blocked": { retryable: false },
  "snapshot-not-found": { retryable: false },
  "snapshot-stale": { retryable: false },
  "redaction-failed": { retryable: false },
};

/**
 * Get standardized retry metadata for an error code.
 */
export function getErrorMeta(code: string): { retryable: boolean; retryAfterMs?: number } {
  return ERROR_META[code] ?? { retryable: true };
}

/**
 * Build a standardized action-failed response with structured retry metadata (MCP-ER-001/002).
 * Use this instead of inline `{ success: false, error: "action-failed" }` spread
 * across individual handlers.
 */
export function actionFailed(
  request: { requestId: string },
  code: RelayActionResponse["error"] = "action-failed",
): RelayActionResponse {
  const meta = getErrorMeta(code);
  return {
    requestId: request.requestId,
    success: false,
    error: code,
    retryable: meta.retryable,
    ...(meta.retryAfterMs !== undefined ? { retryAfterMs: meta.retryAfterMs } : {}),
  };
}

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
