/**
 * Spatial Relations — Validation utilities
 *
 * Implements the validation rules for request shape, grammar, and frame constraints.
 * Imports grammar parsing from `spatial-relations-grammar` for canonical parsing.
 *
 * @module
 */

import { parseUid, parseSnapshotId } from "./spatial-relations-grammar.js";

// ── Grammar validators (with reason strings) ───────────────────────────────────

/**
 * Validate snapshotId format: non-empty string with exactly one ':',
 * non-empty pageId, non-negative integer version, no whitespace.
 */
export function validateSnapshotId(
  raw: unknown,
): { valid: true; snapshotId: string } | { valid: false; reason: string } {
  if (typeof raw !== "string") {
    return { valid: false, reason: "snapshotId must be a string" };
  }
  const result = parseSnapshotId(raw);
  if (result === null) {
    return { valid: false, reason: "snapshotId format is invalid" };
  }
  return { valid: true, snapshotId: raw as string };
}

/**
 * Validate a single UID string format: "{frameId}:{nodeId}".
 */
export function validateUid(
  raw: unknown,
): { valid: true; uid: string } | { valid: false; reason: string } {
  if (typeof raw !== "string") {
    return { valid: false, reason: "uid must be a string" };
  }
  const result = parseUid(raw);
  if (result === null) {
    return { valid: false, reason: "uid format is invalid" };
  }
  return { valid: true, uid: raw as string };
}

/**
 * Validate an array of UIDs — all must be valid UIDs and from the same frame.
 */
export function validateUidsArray(
  raw: unknown,
): { valid: true; frameId: string; uids: string[] } | { valid: false; reason: string } {
  if (!Array.isArray(raw)) {
    return { valid: false, reason: "uids must be an array" };
  }
  if ((raw as unknown[]).length === 0) {
    return { valid: false, reason: "uids must be a non-empty array" };
  }
  const uids: string[] = [];
  let firstFrameId: string | undefined;
  for (const item of raw as unknown[]) {
    if (typeof item !== "string") {
      return { valid: false, reason: "uid entries must be strings" };
    }
    const result = parseUid(item);
    if (result === null) {
      return { valid: false, reason: "uid format is invalid" };
    }
    if (firstFrameId === undefined) {
      firstFrameId = result.frameId;
    } else if (result.frameId !== firstFrameId) {
      return { valid: false, reason: "all uids must be from the same frame" };
    }
    uids.push(item);
  }
  return { valid: true, frameId: firstFrameId as string, uids };
}

/**
 * Validate an array of numeric nodeIds.
 * Each member must be a JSON number, finite, integer, >= 0.
 */
export function validateNodeIdsArray(
  raw: unknown,
): { valid: true; nodeIds: number[] } | { valid: false; reason: string } {
  if (!Array.isArray(raw)) {
    return { valid: false, reason: "nodeIds must be an array" };
  }
  if ((raw as unknown[]).length === 0) {
    return { valid: false, reason: "nodeIds must be a non-empty array" };
  }
  const nodeIds: number[] = [];
  for (const item of raw as unknown[]) {
    if (typeof item !== "number" || !Number.isFinite(item) || !Number.isInteger(item) || item < 0) {
      return { valid: false, reason: "nodeIds entries must be non-negative integers" };
    }
    nodeIds.push(item);
  }
  return { valid: true, nodeIds };
}
