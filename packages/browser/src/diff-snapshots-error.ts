/**
 * diff-snapshots-error.ts
 *
 * Design point 6 — relay error shaping for snapshot-not-found responses.
 *
 * When the relay returns snapshot-not-found, this module determines whether
 * this is a genuine missing snapshot (list available alternatives) or an
 * extension/runtime lookup mismatch (omit availableSnapshotIds to avoid
 * the contradiction of listing IDs we actually have).
 *
 * @module
 */

import type { DiffToolError } from "./diff-tool-contracts.js";
import { RETENTION_SLOTS } from "./snapshot-retention.js";
import type { SnapshotRetentionStore } from "./snapshot-retention.js";
import { analyzeEviction, findMissingSnapshotId, listAvailableSnapshotIds } from "./diff-tool-analysis.js";

/**
 * Shape the snapshot-not-found error response based on local store state.
 *
 * Design point 6:
 * - If both requested IDs are locally present but relay still failed,
 *   return a mismatch error with availableSnapshotIds: undefined.
 * - Otherwise, return a normal missing-snapshot error with availableSnapshotIds
 *   listing the actual alternatives.
 *
 * @param fromId   — The resolved fromSnapshotId (guaranteed non-undefined)
 * @param toId     — The resolved toSnapshotId (guaranteed non-undefined)
 * @param store    — SnapshotRetentionStore for local lookup
 * @returns DiffToolError shaped according to design point 6
 */
export function shapeSnapshotNotFoundError(
  fromId: string,
  toId: string,
  store: SnapshotRetentionStore,
): DiffToolError {
  const bothIdsLocallyPresent =
    store.get(fromId) !== undefined &&
    store.get(toId) !== undefined;

  const snapshotIdForAnalysis = findMissingSnapshotId(store, fromId, toId);
  const eviction = analyzeEviction(store, snapshotIdForAnalysis);
  const available = listAvailableSnapshotIds(store, snapshotIdForAnalysis);
  const recoveryHints = eviction?.wasEvicted
    ? `The snapshot was evicted because the ${RETENTION_SLOTS}-slot FIFO store is full. Re-capture a fresh snapshot by calling get_page_map (or another read tool) on the target page, then immediately call diff_snapshots with the new snapshotId before capturing more snapshots.`
    : available.length > 0
      ? `Snapshot '${snapshotIdForAnalysis}' does not exist. Available snapshots for this page: [${available.join(", ")}]. Use one of those as fromSnapshotId, or omit fromSnapshotId to auto-derive the previous snapshot.`
      : "The requested snapshot ID does not exist in the retention store. Call get_page_map (or another read tool) to capture a new snapshot, then use the returned snapshotId in diff_snapshots.";

  if (bothIdsLocallyPresent) {
    // Design point 6: IDs are locally present but relay failed — mismatch error.
    // availableSnapshotIds is intentionally omitted because listing IDs that
    // ARE available but relay still failed is contradictory.
    return {
      success: false,
      error: "snapshot-not-found",
      errorCode: "snapshot-not-found",
      retryable: false,
      recoveryHints:
        "Both requested snapshots were found in the local retention store, but the extension/runtime failed to diff them. " +
        "This may indicate a navigation or tab context mismatch. Try capturing a fresh snapshot with get_page_map and use that as the baseline.",
      details: {
        reason:
          `Snapshot '${fromId}' and '${toId}' are both retained locally, ` +
          "but the extension/runtime returned snapshot-not-found. This indicates an extension/runtime lookup mismatch " +
          "or a tab/navigation context problem.",
        recoveryHints:
          "Capture a fresh snapshot with get_page_map (or another read tool) and use its snapshotId as the baseline, " +
          "or verify the target tab is still open and has not navigated.",
        availableSnapshotIds: undefined,
      },
    };
  }

  return {
    success: false,
    error: "snapshot-not-found",
    errorCode: "snapshot-not-found",
    retryable: false,
    recoveryHints,
    details: {
      eviction,
      reason: eviction?.wasEvicted
        ? `Snapshot '${eviction.requestedSnapshotId}' was evicted from the ${RETENTION_SLOTS}-slot FIFO retention store.`
        : `Snapshot '${eviction?.requestedSnapshotId ?? snapshotIdForAnalysis}' was not found in the retention store.`,
      recoveryHints,
      availableSnapshotIds: available.length > 0 ? available : undefined,
    },
  };
}
