/**
 * spatial-relations-contract-narrow.ts — Per-field narrowing helpers.
 *
 * Extracted from spatial-relations-contract.ts (narrowSpatialArgs ~48 lines).
 * Each helper <= 15 lines.
 *
 * Validation policy (GAP-D1 item 5):
 * - snapshotId: required, must be non-empty string
 * - nodeIds: if present, every entry must be a non-negative integer (reject, don't filter)
 * - uids: if present, every entry must be a non-empty string (reject, don't filter)
 * - Empty array for the unused identity mode is accepted (adapter-emitted field)
 *
 * @module
 */

import type { GetSpatialRelationsArgs } from "./page-tool-meta-types.js";

// ── Validation errors ───────────────────────────────────────────────────────

export const INVALID_SNAPSHOT_ID = "snapshotId must be a non-empty string";
export const INVALID_NODE_IDS_ARRAY = "nodeIds must be an array";
export const INVALID_UIDS_ARRAY = "uids must be an array";
export const INVALID_NODE_IDS_ENTRY = "nodeIds entries must be non-negative integers";
export const INVALID_UIDS_ENTRY = "uids entries must be non-empty strings";

export const MIXED_IDENTITY_MODE_DETAIL =
  "Pass exactly one identity mode: provide nodeIds[] or uids[], not both.";
export const MIXED_IDENTITY_MODE_HINT =
  "If your adapter always emits the unused field, send [] for that field.";

// ── snapshotId ───────────────────────────────────────────────────────────────

/** Returns error message if snapshotId is missing/empty/whitespace, else null. */
export function validateSnapshotId(obj: Record<string, unknown>): string | null {
  const val = obj["snapshotId"];
  if (typeof val !== "string" || val.trim().length === 0) return INVALID_SNAPSHOT_ID;
  return null;
}

/** Extracts snapshotId; returns null if not a non-empty string. */
export function narrowSnapshotId(obj: Record<string, unknown>): string | null {
  const val = obj["snapshotId"];
  return typeof val === "string" && val.trim().length > 0 ? val : null;
}

// ── nodeIds ──────────────────────────────────────────────────────────────────

/** Returns error if nodeIds is present but not an array. */
export function validateNodeIdsArrayType(obj: Record<string, unknown>): string | null {
  if (!Object.prototype.hasOwnProperty.call(obj, "nodeIds")) return null;
  if (!Array.isArray(obj["nodeIds"])) return INVALID_NODE_IDS_ARRAY;
  return null;
}

/**
 * Validates nodeIds array: every entry must be a non-negative integer.
 * Returns null if valid (including empty/undefined), or an error message string
 * if the array is present but contains any invalid entry.
 */
export function validateNodeIds(obj: Record<string, unknown>): string | null {
  if (!Array.isArray(obj["nodeIds"])) return null;
  const arr = obj["nodeIds"] as unknown[];
  for (const entry of arr) {
    if (typeof entry !== "number" || !Number.isInteger(entry) || entry < 0) {
      return INVALID_NODE_IDS_ENTRY;
    }
  }
  return null;
}

/**
 * Extracts nodeIds if the array is non-empty. Empty array is kept as-is
 * (treated as "omitted" by the contract when uids is the active mode).
 */
export function narrowNodeIds(obj: Record<string, unknown>, result: GetSpatialRelationsArgs): void {
  if (Array.isArray(obj["nodeIds"])) {
    const nodeIds = obj["nodeIds"] as unknown[];
    if (nodeIds.length > 0) result.nodeIds = nodeIds as number[];
  }
}

// ── uids ─────────────────────────────────────────────────────────────────────

/** Returns error if uids is present but not an array. */
export function validateUidsArrayType(obj: Record<string, unknown>): string | null {
  if (!Object.prototype.hasOwnProperty.call(obj, "uids")) return null;
  if (!Array.isArray(obj["uids"])) return INVALID_UIDS_ARRAY;
  return null;
}

/**
 * Validates uids array: every entry must be a non-empty string.
 * Returns null if valid (including empty/undefined), or an error message string
 * if the array is present but contains any invalid entry.
 */
export function validateUids(obj: Record<string, unknown>): string | null {
  if (!Array.isArray(obj["uids"])) return null;
  const arr = obj["uids"] as unknown[];
  for (const entry of arr) {
    if (typeof entry !== "string" || entry.trim().length === 0) {
      return INVALID_UIDS_ENTRY;
    }
  }
  return null;
}

/**
 * Extracts uids if the array is non-empty. Empty array is kept as-is
 * (treated as "omitted" by the contract when nodeIds is the active mode).
 */
export function narrowUids(obj: Record<string, unknown>, result: GetSpatialRelationsArgs): void {
  if (Array.isArray(obj["uids"])) {
    const uids = obj["uids"] as unknown[];
    if (uids.length > 0) result.uids = uids as string[];
  }
}

// ── tabId ────────────────────────────────────────────────────────────────────

export function narrowTabId(obj: Record<string, unknown>, result: GetSpatialRelationsArgs): void {
  if (typeof obj["tabId"] === "number") {
    result.tabId = obj["tabId"];
  }
}

// ── origins ──────────────────────────────────────────────────────────────────

export function narrowOrigins(obj: Record<string, unknown>, result: GetSpatialRelationsArgs): void {
  if (Array.isArray(obj["allowedOrigins"])) {
    result.allowedOrigins = obj["allowedOrigins"] as string[];
  }
  if (Array.isArray(obj["deniedOrigins"])) {
    result.deniedOrigins = obj["deniedOrigins"] as string[];
  }
}

// ── Non-empty checks ─────────────────────────────────────────────────────────

export function hasNonEmptyNodeIds(obj: Record<string, unknown>): boolean {
  return Array.isArray(obj["nodeIds"]) && (obj["nodeIds"] as unknown[]).length > 0;
}

export function hasNonEmptyUids(obj: Record<string, unknown>): boolean {
  return Array.isArray(obj["uids"]) && (obj["uids"] as unknown[]).length > 0;
}