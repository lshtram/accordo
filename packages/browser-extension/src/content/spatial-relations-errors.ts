/**
 * GAP-D1 — Spatial Relations Error Mapping (browser-extension)
 *
 * Translates internal validation errors to relay error codes with correct
 * retry metadata. Implements the fixed validation/error precedence:
 * 1. request shape/raw-count validation -> invalid-request
 * 2. snapshotId type/shape validation -> invalid-request
 * 3. UID validation and same-frame validation -> invalid-request
 * 4. nodeIds[] main-frame rule / iframe-with-nodeIds-only rule -> invalid-request
 * 5. snapshot classification: current owner -> continue, known-but-not-current -> stale, not-in-set -> not-found
 * 6. live DOM resolution for current-owner requests only
 *
 * @module
 */

import { getErrorMeta } from "../relay-error-meta.js";

/**
 * Map a spatial relations validation error to a RelayActionResponse error.
 * Returns the error code string to embed in the relay response.
 */
export function mapSpatialValidationError(
  reason: string,
): { error: "invalid-request" | "snapshot-not-found" | "snapshot-stale"; retryable: boolean } {
  // Snapshot classification errors
  if (reason.startsWith("snapshot-not-found")) {
    const meta = getErrorMeta("snapshot-not-found");
    return { error: "snapshot-not-found", retryable: meta.retryable };
  }
  if (reason.startsWith("snapshot-stale")) {
    const meta = getErrorMeta("snapshot-stale");
    return { error: "snapshot-stale", retryable: meta.retryable };
  }
  // All shape/grammar validation errors -> invalid-request
  const meta = getErrorMeta("invalid-request");
  return { error: "invalid-request", retryable: meta.retryable };
}
