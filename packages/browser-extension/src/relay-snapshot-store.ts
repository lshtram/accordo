import { SnapshotStore } from "./snapshot-versioning.js";
import type { VersionedSnapshot } from "./snapshot-versioning.js";

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
