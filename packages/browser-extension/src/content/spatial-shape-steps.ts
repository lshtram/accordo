/**
 * GAP-D1 — Spatial Relations Shape Validation Helpers
 *
 * Step-by-step shape validation helpers for get_spatial_relations.
 * Each helper is <= 30 lines.
 *
 * @module
 */

import {
  validateSnapshotId,
  validateUidsArray,
  validateNodeIdsArray,
} from "./spatial-relations-validate.js";
import { mapSpatialValidationError } from "./spatial-relations-errors.js";

/**
 * Step 1: Require at least one non-empty array (nodeIds or uids).
 */
export function requireNonEmptyArray(
  rawNodeIds: unknown[],
  rawUids: unknown[],
): { ok: false; error: string } | null {
  if (!Array.isArray(rawNodeIds) && !Array.isArray(rawUids)) {
    return { ok: false, error: "nodeIds-required" };
  }
  if (rawNodeIds.length === 0 && rawUids.length === 0) {
    return { ok: false, error: "nodeIds-required" };
  }
  return null;
}

/**
 * Step 1b: Enforce raw count cap of 50 total identities.
 */
export function requireCountCap(
  rawNodeIds: unknown[],
  rawUids: unknown[],
): { ok: false; error: string } | null {
  if (rawNodeIds.length + rawUids.length > 50) {
    return { ok: false, error: "too-many-nodes" };
  }
  return null;
}

/**
 * Step 2: Validate snapshotId grammar.
 */
export function validateSnapshotIdShape(
  snapshotId: unknown,
): { ok: false; error: string } | { ok: true; snapshotId: string } {
  const result = validateSnapshotId(snapshotId);
  if (!result.valid) {
    return { ok: false, error: mapSpatialValidationError(result.reason).error };
  }
  return { ok: true, snapshotId: result.snapshotId };
}
