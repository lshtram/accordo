/**
 * SnapshotStore — in-memory FIFO store with 5-slot retention per page.
 * Implements B2-SV-004, B2-SV-005, B2-DE-004, B2-DE-007.
 */

import type { VersionedSnapshot } from "./snapshot-versioning.js";

/** Sentinel returned when a snapshotId is not found or has been evicted. */
export type SnapshotNotFound = { error: "snapshot-not-found" };

/**
 * In-memory snapshot store with configurable retention (default 5 slots per page).
 *
 * B2-SV-004: oldest snapshots are evicted when the limit is exceeded.
 * B2-SV-005: resetOnNavigation clears all stored snapshots.
 */
export class SnapshotStore {
  private readonly retentionSize: number;
  /** Stores snapshots per pageId, ordered oldest→newest. */
  private pageSnapshots: Map<string, VersionedSnapshot[]>;
  /** Fast lookup by snapshotId. */
  private bySnapshotId: Map<string, VersionedSnapshot>;
  /**
   * B2-DE-007: Snapshot IDs that were cleared by navigation reset.
   * Used to distinguish "snapshot-stale" (existed before navigation)
   * from "snapshot-not-found" (never existed or FIFO-evicted).
   * Cleared on the *next* navigation reset to avoid unbounded growth.
   */
  private staleSnapshotIds: Set<string>;

  constructor(retentionSize: number = 5) {
    this.retentionSize = retentionSize;
    this.pageSnapshots = new Map();
    this.bySnapshotId = new Map();
    this.staleSnapshotIds = new Set();
  }

  /**
   * Save a snapshot for the given pageId.
   *
   * If the store already holds `retentionSize` snapshots for this page,
   * the oldest is evicted (FIFO).
   */
  async save(pageId: string, snapshot: VersionedSnapshot): Promise<void> {
    const list = this.pageSnapshots.get(pageId) ?? [];
    list.push(snapshot);
    this.bySnapshotId.set(snapshot.snapshotId, snapshot);
    while (list.length > this.retentionSize) {
      const evicted = list.shift();
      if (evicted !== undefined) this.bySnapshotId.delete(evicted.snapshotId);
    }
    this.pageSnapshots.set(pageId, list);
  }

  /**
   * Retrieve a specific snapshot by snapshotId.
   *
   * Returns `{ error: "snapshot-not-found" }` when the snapshotId is unknown
   * or has been evicted (B2-SV-004, B2-SV-005).
   */
  async get(snapshotId: string): Promise<VersionedSnapshot | SnapshotNotFound> {
    const snapshot = this.bySnapshotId.get(snapshotId);
    if (snapshot === undefined) return { error: "snapshot-not-found" };
    return snapshot;
  }

  /**
   * Get the most recent snapshot for the given pageId.
   *
   * Returns `undefined` if no snapshots exist for that page.
   */
  async getLatest(pageId: string): Promise<VersionedSnapshot | undefined> {
    const list = this.pageSnapshots.get(pageId);
    if (list === undefined || list.length === 0) return undefined;
    return list[list.length - 1];
  }

  /**
   * List all snapshots for the given pageId, newest first (B2-SV-004).
   *
   * Returns at most `retentionSize` items.
   */
  async list(pageId: string): Promise<VersionedSnapshot[]> {
    const list = this.pageSnapshots.get(pageId) ?? [];
    return list.slice().reverse();
  }

  /**
   * Clear all stored snapshots on navigation (B2-SV-005).
   *
   * B2-DE-007: Moves current snapshot IDs to `staleSnapshotIds` so that
   * subsequent `get()` calls for pre-navigation IDs can distinguish
   * "snapshot-stale" from "snapshot-not-found".
   */
  resetOnNavigation(): void {
    this.staleSnapshotIds = new Set(this.bySnapshotId.keys());
    this.pageSnapshots = new Map();
    this.bySnapshotId = new Map();
  }

  /**
   * Check whether a snapshot ID is from a previous navigation session.
   *
   * B2-DE-007: Returns `true` if the snapshot existed before the last
   * `resetOnNavigation()` call, enabling callers to return a
   * `"snapshot-stale"` error instead of `"snapshot-not-found"`.
   */
  isStale(snapshotId: string): boolean {
    return this.staleSnapshotIds.has(snapshotId);
  }

  /**
   * Get the snapshot immediately before the given snapshotId in the same page.
   *
   * B2-DE-004: Used to resolve the implicit `from` when only `toSnapshotId`
   * is provided. Returns `undefined` if there is no prior snapshot (i.e.,
   * the given snapshot is the first one for its page).
   */
  async getPrevious(snapshotId: string): Promise<VersionedSnapshot | undefined> {
    const target = this.bySnapshotId.get(snapshotId);
    if (target === undefined) return undefined;
    const list = this.pageSnapshots.get(target.pageId);
    if (list === undefined) return undefined;
    const idx = list.findIndex((s) => s.snapshotId === snapshotId);
    if (idx <= 0) return undefined;
    return list[idx - 1];
  }
}
