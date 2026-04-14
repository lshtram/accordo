/**
 * relay-definitions.ts — Type contracts and shared state for the relay layer.
 *
 * Contains all public type definitions (RelayAction, RelayActionRequest,
 * RelayActionResponse, CapturePayload), the module-level SnapshotStore
 * singleton, and the isVersionedSnapshot type guard.
 *
 * Split from relay-actions.ts (B5a modularity).
 *
 * Shared relay contract types (BrowserRelayAction, BrowserRelayRequest,
 * BrowserRelayResponse, CapturePayload) are imported from @accordo/bridge-types.
 * Local extensions (auditId, redactionWarning, index signature on Response)
 * and runtime helpers stay local.
 *
 * @module
 */

import type { VersionedSnapshot } from "./snapshot-versioning.js";
import type {
  BrowserRelayAction as BrowserRelayActionType,
  BrowserRelayRequest,
  BrowserRelayResponse,
  CapturePayload as CapturePayloadBase,
} from "@accordo/bridge-types";

// Re-export BrowserRelayAction from bridge-types so existing imports continue to work.
// browser-extension's full action surface is the same as BrowserRelayAction.
// Exported as RelayAction for backward compatibility with existing imports.
export type { BrowserRelayActionType as RelayAction };

// Re-export CapturePayload from bridge-types for convenience.
export type { CapturePayloadBase as CapturePayload };

// ── Relay Action Request (browser-extension) ────────────────────────────────────

/**
 * Relay action request — the browser-extension's request envelope.
 * The base shape is the same as BrowserRelayRequest from bridge-types.
 */
export type RelayActionRequest = BrowserRelayRequest;

// ── Relay Action Response (browser-extension extended) ─────────────────────────

/**
 * Relay action response — the browser-extension's response envelope.
 *
 * Extends BrowserRelayResponse with:
 *   - auditId: MCP-SEC-004 UUIDv4 audit identifier
 *   - redactionWarning: MCP-SEC-005 warning when PII may be present
 *   - error override: allows all string error codes (not just BrowserRelayError)
 *   - index signature: allows RelayActionResponse to satisfy Record<string, unknown>
 *
 * The base fields (requestId, success, snapshotId, data) are shared
 * with the browser package via @accordo/bridge-types.
 * The error field is overridden to string since browser-extension uses
 * error codes beyond BrowserRelayError.
 */
export interface RelayActionResponse extends Omit<BrowserRelayResponse, "error"> {
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
  /**
   * Error code string. Override allows all browser-extension error codes,
   * not just the shared BrowserRelayError subset.
   */
  error?: string;
  /** Index signature — allows RelayActionResponse to satisfy Record<string, unknown> */
  [key: string]: unknown;
}

// ── Module-level Singleton ───────────────────────────────────────────────────

import { SnapshotStore } from "./snapshot-versioning.js";

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

// ── Shared Response Helpers ─────────────────────────────────────────────────

/**
 * MCP-ER-002: Retry metadata for structured error responses.
 * Maps error codes to retryable flag and optional retryAfterMs.
 * Codes not listed default to retryable: true with no retryAfterMs.
 *
 * This helper CANNOT live in @accordo/bridge-types because it encodes
 * the browser-extension's local error policy.
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
 *
 * This helper CANNOT live in @accordo/bridge-types because it encodes
 * the browser-extension's local error policy.
 */
export function getErrorMeta(code: string): { retryable: boolean; retryAfterMs?: number } {
  return ERROR_META[code] ?? { retryable: true };
}

/**
 * Build a standardized action-failed response with structured retry metadata (MCP-ER-001/002).
 * Use this instead of inline `{ success: false, error: "action-failed" }` spread
 * across individual handlers.
 *
 * This helper CANNOT live in @accordo/bridge-types because it returns
 * a RelayActionResponse (which has browser-extension-specific fields).
 */
export function actionFailed(
  request: { requestId: string },
  code: string = "action-failed",
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

// ── Type Guard ─────────────────────────────────────────────────────────────

/**
 * Runtime type guard for VersionedSnapshot.
 * Replaces unsafe `as unknown as VersionedSnapshot` casts — validates all
 * required fields are present with the correct types before narrowing.
 *
 * This helper CANNOT live in @accordo/bridge-types because it requires
 * the VersionedSnapshot type from snapshot-versioning.ts (Chrome runtime).
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
