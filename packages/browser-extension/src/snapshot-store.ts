/**
 * SnapshotStore — in-memory FIFO store with 5-slot retention per page.
 * Implements B2-SV-004, B2-SV-005, B2-DE-004, B2-DE-007.
 *
 * GAP-I1: TTL eviction via `maxAgeMs`. When set, entries older than maxAgeMs
 * are evicted on every access (get, getLatest, list, getPrevious) and before
 * every save. A value of 0 disables TTL eviction.
 */

import type { VersionedSnapshot } from "./snapshot-versioning.js";

/** Sentinel returned when a snapshotId is not found or has been evicted. */
export type SnapshotNotFound = { error: "snapshot-not-found" };

/**
 * In-memory snapshot store with configurable retention (default 5 slots per page).
 *
 * B2-SV-004: oldest snapshots are evicted when the limit is exceeded.
 * B2-SV-005: resetOnNavigation clears all stored snapshots.
 * GAP-I1: TTL eviction when `maxAgeMs > 0`.
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
  /**
   * GAP-I1: Capture timestamps (snapshotId → Unix ms) for TTL eviction.
   * Parallel to `bySnapshotId` to avoid modifying the shared VersionedSnapshot type.
   */
  private capturedAt: Map<string, number> = new Map();
  /**
   * GAP-I1: Maximum age in milliseconds before a snapshot is considered stale.
   * 0 (default) disables TTL eviction.
   */
  private maxAgeMs: number = 0;

  constructor(retentionSize: number = 5) {
    this.retentionSize = retentionSize;
    this.pageSnapshots = new Map();
    this.bySnapshotId = new Map();
    this.staleSnapshotIds = new Set();
  }

  /**
   * GAP-I1: Set the maximum age for snapshot TTL eviction.
   * Call this during extension activation with the configured maxAgeMs.
   * @param ms Max age in milliseconds. 0 disables TTL eviction.
   */
  setMaxAgeMs(ms: number): void {
    this.maxAgeMs = ms;
  }

  /**
   * Save a snapshot for the given pageId.
   *
   * GAP-I1: Before saving, runs TTL eviction on the page's list to remove
   * entries older than `maxAgeMs` (if configured).
   * If the store already holds `retentionSize` snapshots for this page after
   * TTL eviction, the oldest is evicted (FIFO).
   */
  async save(pageId: string, snapshot: VersionedSnapshot): Promise<void> {
    let list = this.pageSnapshots.get(pageId) ?? [];
    // GAP-I1: TTL eviction before save
    if (this.maxAgeMs > 0) list = this.evictExpired(list);
    list.push(snapshot);
    this.bySnapshotId.set(snapshot.snapshotId, snapshot);
    this.capturedAt.set(snapshot.snapshotId, Date.now());
    while (list.length > this.retentionSize) {
      const evicted = list.shift();
      if (evicted !== undefined) {
        this.bySnapshotId.delete(evicted.snapshotId);
        this.capturedAt.delete(evicted.snapshotId);
      }
    }
    this.pageSnapshots.set(pageId, list);
  }

  /**
   * Retrieve a specific snapshot by snapshotId.
   *
   * Returns `{ error: "snapshot-not-found" }` when the snapshotId is unknown,
   * has been evicted (B2-SV-004, B2-SV-005), or has expired (GAP-I1 TTL).
   */
  async get(snapshotId: string): Promise<VersionedSnapshot | SnapshotNotFound> {
    const snapshot = this.bySnapshotId.get(snapshotId);
    if (snapshot === undefined) return { error: "snapshot-not-found" };
    // GAP-I1: Check TTL expiry
    if (this.maxAgeMs > 0 && this.isExpired(snapshotId)) {
      this.evictOne(snapshotId, snapshot.pageId);
      return { error: "snapshot-not-found" };
    }
    return snapshot;
  }

  /**
   * Get the most recent snapshot for the given pageId.
   *
   * GAP-I1: Runs TTL eviction before returning. Expired snapshots are removed.
   * Returns `undefined` if no snapshots exist for that page.
   */
  async getLatest(pageId: string): Promise<VersionedSnapshot | undefined> {
    let list = this.pageSnapshots.get(pageId);
    if (list === undefined || list.length === 0) return undefined;
    // GAP-I1: TTL eviction
    if (this.maxAgeMs > 0) list = this.evictExpired(list);
    if (list.length === 0) return undefined;
    return list[list.length - 1];
  }

  /**
   * List all snapshots for the given pageId, newest first (B2-SV-004).
   *
   * GAP-I1: Expired snapshots are removed before returning.
   * Returns at most `retentionSize` items.
   */
  async list(pageId: string): Promise<VersionedSnapshot[]> {
    let list = this.pageSnapshots.get(pageId) ?? [];
    if (this.maxAgeMs > 0) list = this.evictExpired(list);
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
    this.capturedAt = new Map();
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
   * GAP-I1: Runs TTL eviction before searching.
   */
  async getPrevious(snapshotId: string): Promise<VersionedSnapshot | undefined> {
    const target = this.bySnapshotId.get(snapshotId);
    if (target === undefined) return undefined;
    let list = this.pageSnapshots.get(target.pageId);
    if (list === undefined) return undefined;
    if (this.maxAgeMs > 0) list = this.evictExpired(list);
    const idx = list.findIndex((s) => s.snapshotId === snapshotId);
    if (idx <= 0) return undefined;
    return list[idx - 1];
  }

  // ── GAP-I1: TTL eviction helpers ────────────────────────────────────────────

  /**
   * Returns true if the given snapshotId has expired based on maxAgeMs.
   */
  private isExpired(snapshotId: string): boolean {
    const captured = this.capturedAt.get(snapshotId);
    if (captured === undefined) return false;
    return Date.now() - captured > this.maxAgeMs;
  }

  /**
   * Remove all expired snapshots from a page's list and clean up the lookup maps.
   * Returns the pruned list.
   */
  private evictExpired(list: VersionedSnapshot[]): VersionedSnapshot[] {
    if (this.maxAgeMs <= 0) return list;
    const now = Date.now();
    const initial = list.length;
    const pruned = list.filter((s) => {
      const captured = this.capturedAt.get(s.snapshotId);
      if (captured !== undefined && now - captured > this.maxAgeMs) {
        this.bySnapshotId.delete(s.snapshotId);
        this.capturedAt.delete(s.snapshotId);
        return false;
      }
      return true;
    });
    if (pruned.length !== initial) {
      // Update the page list in-place to preserve order
      list.length = 0;
      list.push(...pruned);
    }
    return pruned;
  }

  /**
   * Evict a single snapshot by snapshotId from a specific page.
   */
  private evictOne(snapshotId: string, pageId: string): void {
    this.bySnapshotId.delete(snapshotId);
    this.capturedAt.delete(snapshotId);
    const list = this.pageSnapshots.get(pageId);
    if (list !== undefined) {
      const idx = list.findIndex((s) => s.snapshotId === snapshotId);
      if (idx >= 0) list.splice(idx, 1);
    }
  }
}
