/**
 * spatial-relations-invalid-request.ts — Invalid-request error builders for spatial tool.
 *
 * GAP-D1 item 5: Specific invalid-request errors for contract validation failures.
 * Canonical validators live in spatial-relations-contract-narrow.ts; this file
 * imports and composes them into structured PageToolError responses.
 *
 * @module
 */

import {
  buildStructuredError,
  type PageToolError,
} from "./page-tool-meta-types.js";
import {
  INVALID_SNAPSHOT_ID,
  INVALID_NODE_IDS_ARRAY,
  INVALID_UIDS_ARRAY,
  INVALID_NODE_IDS_ENTRY,
  INVALID_UIDS_ENTRY,
  MIXED_IDENTITY_MODE_DETAIL,
  MIXED_IDENTITY_MODE_HINT,
  validateSnapshotId,
  validateNodeIdsArrayType,
  validateUidsArrayType,
  validateNodeIds,
  validateUids,
  hasNonEmptyNodeIds,
  hasNonEmptyUids,
} from "./spatial-relations-contract-narrow.js";

// ── Error builders ─────────────────────────────────────────────────────────

/** Build a rich invalid-request error for mixed identity mode. */
export function buildMixedIdentityError(): PageToolError {
  return {
    success: false,
    error: "invalid-request",
    retryable: false,
    details: MIXED_IDENTITY_MODE_DETAIL,
    recoveryHints: MIXED_IDENTITY_MODE_HINT,
    pageUrl: null,
    found: false,
  };
}

/** Build a rich invalid-request error for malformed nodeIds entries. */
export function buildMalformedNodeIdsError(): PageToolError {
  return {
    success: false,
    error: "invalid-request",
    retryable: false,
    details: INVALID_NODE_IDS_ENTRY,
    recoveryHints: "Check that each nodeIds entry is an integer >= 0. Malformed entries are rejected — they do not silently disappear.",
    pageUrl: null,
    found: false,
  };
}

/** Build a rich invalid-request error for malformed uids entries. */
export function buildMalformedUidsError(): PageToolError {
  return {
    success: false,
    error: "invalid-request",
    retryable: false,
    details: INVALID_UIDS_ENTRY,
    recoveryHints: "Check that each uids entry is a non-empty string (e.g. 'main:3'). Malformed entries are rejected — they do not silently disappear.",
    pageUrl: null,
    found: false,
  };
}

/** Build a rich invalid-request error for non-array nodeIds field. */
export function buildNonArrayNodeIdsError(): PageToolError {
  return buildStructuredError("invalid-request", INVALID_NODE_IDS_ARRAY) as PageToolError;
}

/** Build a rich invalid-request error for non-array uids field. */
export function buildNonArrayUidsError(): PageToolError {
  return buildStructuredError("invalid-request", INVALID_UIDS_ARRAY) as PageToolError;
}

// ── Precedence-step validators (each <= 20 lines) ───────────────────────

function checkSnapshotId(raw: unknown): PageToolError | null {
  if (typeof raw !== "object" || raw === null) return null;
  const err = validateSnapshotId(raw as Record<string, unknown>);
  if (err === null) return null;
  return buildStructuredError("invalid-request", INVALID_SNAPSHOT_ID) as PageToolError;
}

function checkNodeIdsArrayType(raw: unknown): PageToolError | null {
  if (typeof raw !== "object" || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  const err = validateNodeIdsArrayType(obj);
  if (err === null) return null;
  return buildNonArrayNodeIdsError();
}

function checkUidsArrayType(raw: unknown): PageToolError | null {
  if (typeof raw !== "object" || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  const err = validateUidsArrayType(obj);
  if (err === null) return null;
  return buildNonArrayUidsError();
}

function checkNodeIdsEntries(raw: unknown): PageToolError | null {
  if (typeof raw !== "object" || raw === null) return null;
  if (!validateNodeIds(raw as Record<string, unknown>)) return null;
  return buildMalformedNodeIdsError();
}

function checkUidsEntries(raw: unknown): PageToolError | null {
  if (typeof raw !== "object" || raw === null) return null;
  if (!validateUids(raw as Record<string, unknown>)) return null;
  return buildMalformedUidsError();
}

function checkMutualExclusivity(raw: unknown): PageToolError | null {
  if (typeof raw !== "object" || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  const hasNodes = hasNonEmptyNodeIds(obj);
  const hasUids = hasNonEmptyUids(obj);
  if (hasNodes && hasUids) return buildMixedIdentityError();
  if (!hasNodes && !hasUids) {
    return buildStructuredError(
      "invalid-request",
      "nodeIds or uids must be a non-empty array",
    ) as PageToolError;
  }
  return null;
}

// ── Main dispatcher (each step helper <= 30 lines) ────────────────────────────────────

/**
 * Determine which invalid-request error to return based on raw args.
 * Validates in precedence order: snapshotId → array type validity → entry validity → mutual exclusivity.
 */
export function getInvalidRequestError(raw: unknown): PageToolError | null {
  return checkSnapshotId(raw)
    ?? checkNodeIdsArrayType(raw)
    ?? checkUidsArrayType(raw)
    ?? checkNodeIdsEntries(raw)
    ?? checkUidsEntries(raw)
    ?? checkMutualExclusivity(raw);
}
