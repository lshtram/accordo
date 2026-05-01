/**
 * diff-snapshots-retained-pair.ts
 *
 * Design point 4 — both-omitted snapshot resolution.
 *
 * When both fromSnapshotId and toSnapshotId are omitted, this module provides
 * the resolve-retained-pair logic: find the two most-recently retained snapshots
 * across all pages and return them as a { fromId, toId } pair.
 *
 * Returns a clear error if fewer than two snapshots are retained anywhere,
 * WITHOUT calling get_page_map or inventing a nonexistent next snapshot ID.
 *
 * @module
 */

import type { DiffToolError } from "./diff-tool-contracts.js";
import type { SnapshotEnvelopeFields } from "./types.js";
import type { SnapshotRetentionStore } from "./snapshot-retention.js";

/**
 * Result when both IDs are omitted and >= 2 snapshots are available.
 */
export interface RetainedPairResult {
  fromSnapshotId: string;
  toSnapshotId: string;
}

/**
 * Resolve both omitted IDs from retained snapshots only — no fresh capture.
 *
 * Design point 4:
 * - Do NOT perform two hidden fresh captures.
 * - Collect ALL retained snapshots across ALL pages.
 * - Select the two most-recently captured (by capturedAt timestamp) as the pair.
 * - If fewer than 2 total snapshots exist, return a clear structured error
 *   without requiring both snapshots to be on the same page.
 * - Never invent a nonexistent snapshot ID.
 *
 * @param store — SnapshotRetentionStore with locally retained snapshots.
 * @returns RetainedPairResult on success, DiffToolError on failure.
 */
export function resolveBothOmittedFromStore(
  store: SnapshotRetentionStore,
): RetainedPairResult | DiffToolError {
  // Collect every retained snapshot across all pages with its capturedAt timestamp
  const all: Array<{ snapshotId: string; capturedAt: number }> = [];
  for (const [pageId, slots] of store.listAll()) {
    for (const envelope of slots) {
      // capturedAt is stored as ISO string in the envelope
      const capturedAt = new Date(envelope.capturedAt).getTime();
      all.push({ snapshotId: envelope.snapshotId, capturedAt });
    }
  }

  if (all.length < 2) {
    return {
      success: false,
      error: "snapshot-not-found",
      errorCode: "snapshot-not-found",
      retryable: false,
      recoveryHints:
        "diff_snapshots was called with both IDs omitted but fewer than two snapshots are retained. " +
        "Capture at least two snapshots using get_page_map (or another read tool) on the target page, then call diff_snapshots again.",
      details: {
        reason:
          "Both fromSnapshotId and toSnapshotId were omitted, but fewer than two snapshots are retained in the local store. Cannot determine a diff pair.",
        recoveryHints:
          "Capture at least two snapshots using get_page_map (or another read tool) on the target page, then call diff_snapshots again. " +
          "Alternatively, provide explicit fromSnapshotId and toSnapshotId arguments.",
        availableSnapshotIds: undefined,
      },
    };
  }

  // Sort by capturedAt descending — most recent first
  all.sort((a, b) => b.capturedAt - a.capturedAt);

  // Top two are the pair; snapshots may be from different pages (design point 4)
  return {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- safe: all.length >= 2 after sort
    fromSnapshotId: all[1]!.snapshotId,
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- safe: all.length >= 2 after sort
    toSnapshotId: all[0]!.snapshotId,
  };
}
