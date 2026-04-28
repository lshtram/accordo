/**
 * snapshot-eviction.ts — FIFO eviction helpers for SnapshotStore.
 *
 * Extracted from snapshot-store.ts (≤30 lines per helper).
 *
 * @module
 */

import type { VersionedSnapshot } from "./snapshot-store-types.js";

/**
 * Evicts expired entries from a page-snapshot list.
 * Updates bySnapshotId and capturedAt side maps in-place.
 * Returns the pruned list.
 */
export function evictExpired(
  maxAgeMs: number,
  capturedAt: Map<string, number>,
  bySnapshotId: Map<string, VersionedSnapshot>,
  list: VersionedSnapshot[],
): VersionedSnapshot[] {
  if (maxAgeMs <= 0) return list;
  const now = Date.now();
  const initial = list.length;
  const pruned = list.filter((s) => {
    const captured = capturedAt.get(s.snapshotId);
    if (captured !== undefined && now - captured > maxAgeMs) {
      bySnapshotId.delete(s.snapshotId);
      capturedAt.delete(s.snapshotId);
      return false;
    }
    return true;
  });
  if (pruned.length !== initial) {
    list.length = 0;
    list.push(...pruned);
  }
  return pruned;
}

/**
 * Removes a single snapshot from a page list and its side maps.
 */
export function evictOne(
  snapshotId: string,
  pageId: string,
  pageSnapshots: Map<string, VersionedSnapshot[]>,
  bySnapshotId: Map<string, VersionedSnapshot>,
  capturedAt: Map<string, number>,
): void {
  bySnapshotId.delete(snapshotId);
  capturedAt.delete(snapshotId);
  const list = pageSnapshots.get(pageId);
  if (list !== undefined) {
    const idx = list.findIndex((s) => s.snapshotId === snapshotId);
    if (idx >= 0) list.splice(idx, 1);
  }
}
