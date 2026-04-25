/**
 * SnapshotStore — in-memory FIFO store with 5-slot retention per page.
 */

import type { SnapshotNotFound, VersionedSnapshot } from "./snapshot-store-types.js";

export type { SnapshotNotFound, VersionedSnapshot } from "./snapshot-store-types.js";

export class SnapshotStore {
  private readonly retentionSize: number;
  private pageSnapshots: Map<string, VersionedSnapshot[]>;
  private bySnapshotId: Map<string, VersionedSnapshot>;
  private staleSnapshotIds: Set<string>;
  private capturedAt: Map<string, number> = new Map();
  private maxAgeMs: number = 0;

  constructor(retentionSize: number = 5) {
    this.retentionSize = retentionSize;
    this.pageSnapshots = new Map();
    this.bySnapshotId = new Map();
    this.staleSnapshotIds = new Set();
  }

  setMaxAgeMs(ms: number): void {
    this.maxAgeMs = ms;
  }

  async save(pageId: string, snapshot: VersionedSnapshot): Promise<void> {
    let list = this.pageSnapshots.get(pageId) ?? [];
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

  async get(snapshotId: string): Promise<VersionedSnapshot | SnapshotNotFound> {
    const snapshot = this.bySnapshotId.get(snapshotId);
    if (snapshot === undefined) return { error: "snapshot-not-found" };
    if (this.maxAgeMs > 0 && this.isExpired(snapshotId)) {
      this.evictOne(snapshotId, snapshot.pageId);
      return { error: "snapshot-not-found" };
    }
    return snapshot;
  }

  async getLatest(pageId: string): Promise<VersionedSnapshot | undefined> {
    let list = this.pageSnapshots.get(pageId);
    if (list === undefined || list.length === 0) return undefined;
    if (this.maxAgeMs > 0) list = this.evictExpired(list);
    if (list.length === 0) return undefined;
    return list[list.length - 1];
  }

  async list(pageId: string): Promise<VersionedSnapshot[]> {
    let list = this.pageSnapshots.get(pageId) ?? [];
    if (this.maxAgeMs > 0) list = this.evictExpired(list);
    return list.slice().reverse();
  }

  listAll(): Map<string, VersionedSnapshot[]> {
    if (this.maxAgeMs > 0) {
      for (const [pageId, list] of this.pageSnapshots.entries()) {
        const pruned = this.evictExpired(list);
        if (pruned.length === 0) {
          this.pageSnapshots.delete(pageId);
        } else {
          this.pageSnapshots.set(pageId, pruned);
        }
      }
    }
    return new Map(Array.from(this.pageSnapshots.entries(), ([pageId, list]) => [pageId, list.slice()]));
  }

  clear(): void;
  clear(pageId: string): void;
  clear(pageId?: string): void {
    if (pageId !== undefined) {
      const list = this.pageSnapshots.get(pageId) ?? [];
      for (const snapshot of list) {
        this.bySnapshotId.delete(snapshot.snapshotId);
        this.capturedAt.delete(snapshot.snapshotId);
        this.staleSnapshotIds.delete(snapshot.snapshotId);
      }
      this.pageSnapshots.delete(pageId);
      return;
    }

    this.pageSnapshots.clear();
    this.bySnapshotId.clear();
    this.capturedAt.clear();
    this.staleSnapshotIds.clear();
  }

  resetOnNavigation(): void {
    this.staleSnapshotIds = new Set(this.bySnapshotId.keys());
    this.pageSnapshots = new Map();
    this.bySnapshotId = new Map();
    this.capturedAt = new Map();
  }

  isStale(snapshotId: string): boolean {
    return this.staleSnapshotIds.has(snapshotId);
  }

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

  private isExpired(snapshotId: string): boolean {
    const captured = this.capturedAt.get(snapshotId);
    if (captured === undefined) return false;
    return Date.now() - captured > this.maxAgeMs;
  }

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
      list.length = 0;
      list.push(...pruned);
    }
    return pruned;
  }

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
