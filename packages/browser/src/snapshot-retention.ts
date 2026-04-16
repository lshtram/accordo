/**
 * M100-SNAP — Snapshot Retention Store (browser package)
 *
 * Lightweight per-page retention store for SnapshotEnvelopeFields.
 * Holds up to MAX_SLOTS snapshots per pageId using FIFO eviction.
 *
 * Mirrors the semantics of SnapshotStore in packages/browser-extension
 * but operates only on SnapshotEnvelopeFields — the shared contract
 * between the browser-extension (which mints envelopes) and the browser
 * MCP tool layer (which consumes them). This avoids a cross-package import.
 *
 * GAP-I1: TTL eviction via `maxAgeMs`. When set, entries older than maxAgeMs
 * are evicted on every access (save, get, getLatest, list) and before
 * every save. A value of 0 disables TTL eviction.
 *
 * @module
 */

import type { SnapshotEnvelopeFields } from "./types.js";

/** Maximum snapshots retained per pageId (FIFO eviction). GAP-G1: increased from 5 to 10. */
export const RETENTION_SLOTS = 10;

/**
 * B2-SV-004: Per-page 5-slot FIFO retention store for snapshot envelopes.
 *
 * All four data-producing tool handlers save their envelope here on
 * success so agents can access recent snapshots without re-requesting.
 * GAP-I1: Supports optional TTL eviction via `maxAgeMs`.
 */
export class SnapshotRetentionStore {
  /** pageId → ordered list of envelopes (oldest first, newest last). */
  private readonly pages = new Map<string, SnapshotEnvelopeFields[]>();
  /**
   * GAP-I1: Capture timestamps (snapshotId → Unix ms) for TTL eviction.
   * Parallel to `pages` to avoid modifying the shared SnapshotEnvelopeFields type.
   */
  private capturedAt: Map<string, number> = new Map();
  /**
   * GAP-I1: Maximum age in milliseconds. 0 (default) disables TTL eviction.
   */
  private maxAgeMs: number = 0;

  constructor(maxAgeMs: number = 0) {
    this.maxAgeMs = maxAgeMs;
  }

  /**
   * GAP-I1: Set the maximum age for TTL eviction.
   * @param ms Max age in milliseconds. 0 disables TTL.
   */
  setMaxAgeMs(ms: number): void {
    this.maxAgeMs = ms;
  }

  /**
   * Save an envelope for a page.
   * GAP-I1: Records capture timestamp and runs TTL eviction before saving.
   * If the page already has RETENTION_SLOTS entries the oldest is evicted.
   *
   * @param pageId — Stable page identifier from the envelope.
   * @param envelope — The full SnapshotEnvelopeFields from the relay response.
   */
  save(pageId: string, envelope: SnapshotEnvelopeFields): void {
    let slots = this.pages.get(pageId) ?? [];
    // GAP-I1: TTL eviction before save
    if (this.maxAgeMs > 0) slots = this.evictExpired(slots);
    slots.push(envelope);
    this.capturedAt.set(envelope.snapshotId, Date.now());
    // FIFO eviction: remove oldest when over the limit
    while (slots.length > RETENTION_SLOTS) {
      const evicted = slots.shift();
      if (evicted !== undefined) this.capturedAt.delete(evicted.snapshotId);
    }
    this.pages.set(pageId, slots);
  }

  /**
   * GAP-G1: Convenience overload — save an envelope when only the envelope
   * is available (pageId is derived from envelope.pageId).
   */
  add(envelope: SnapshotEnvelopeFields): void {
    this.save(envelope.pageId, envelope);
  }

  /**
   * Return the most-recently saved envelope for a page, or undefined if none.
   * GAP-I1: Runs TTL eviction before returning.
   *
   * @param pageId — Stable page identifier.
   */
  getLatest(pageId: string): SnapshotEnvelopeFields | undefined {
    let slots = this.pages.get(pageId);
    if (!slots || slots.length === 0) return undefined;
    if (this.maxAgeMs > 0) slots = this.evictExpired(slots);
    return slots[slots.length - 1];
  }

  /**
   * Return all retained envelopes for a page, oldest first.
   * GAP-I1: Expired entries are removed before returning.
   *
   * @param pageId — Stable page identifier.
   */
  list(pageId: string): SnapshotEnvelopeFields[] {
    let slots = this.pages.get(pageId) ?? [];
    if (this.maxAgeMs > 0) slots = this.evictExpired(slots);
    return slots;
  }

  /**
   * Retrieve a specific envelope by its snapshotId across all pages.
   * GAP-I1: Returns undefined if the snapshot has expired (TTL).
   *
   * @param snapshotId — Format: `{pageId}:{version}`.
   */
  get(snapshotId: string): SnapshotEnvelopeFields | undefined {
    for (const slots of this.pages.values()) {
      for (const envelope of slots) {
        if (envelope.snapshotId === snapshotId) {
          // GAP-I1: Check TTL expiry
          if (this.maxAgeMs > 0 && this.isExpired(snapshotId)) return undefined;
          return envelope;
        }
      }
    }
    return undefined;
  }

  /**
   * Clear all retained snapshots for a given page.
   * Call this when a navigation event is detected for the page.
   *
   * @param pageId — Stable page identifier.
   */
  resetOnNavigation(pageId: string): void {
    const slots = this.pages.get(pageId);
    if (slots) for (const e of slots) this.capturedAt.delete(e.snapshotId);
    this.pages.delete(pageId);
  }

  /**
   * Clear all retained snapshots across all pages.
   * Useful in tests and on extension deactivation.
   */
  clear(): void;
  /**
   * GAP-G1: Clear all retained snapshots for a specific page.
   *
   * @param pageId — Stable page identifier.
   */
  clear(pageId: string): void;
  /**
   * GAP-G1: Clear all retained snapshots for a specific page, or all pages if pageId is omitted.
   *
   * @param pageId — Optional stable page identifier. If omitted, clears all pages.
   */
  clear(pageId?: string): void {
    if (pageId !== undefined) {
      const slots = this.pages.get(pageId);
      if (slots) for (const e of slots) this.capturedAt.delete(e.snapshotId);
      this.pages.delete(pageId);
    } else {
      this.pages.clear();
      this.capturedAt.clear();
    }
  }

  /**
   * GAP-G1: Return snapshot metadata for all pages currently in the store.
   *
   * @returns A Map from pageId to its ordered list of SnapshotEnvelopeFields (oldest first).
   */
  listAll(): Map<string, SnapshotEnvelopeFields[]> {
    return new Map(this.pages);
  }

  // ── GAP-I1: TTL eviction helpers ─────────────────────────────────────────────

  private isExpired(snapshotId: string): boolean {
    const captured = this.capturedAt.get(snapshotId);
    if (captured === undefined) return false;
    return Date.now() - captured > this.maxAgeMs;
  }

  private evictExpired(slots: SnapshotEnvelopeFields[]): SnapshotEnvelopeFields[] {
    if (this.maxAgeMs <= 0) return slots;
    const now = Date.now();
    return slots.filter((e) => {
      const captured = this.capturedAt.get(e.snapshotId);
      if (captured !== undefined && now - captured > this.maxAgeMs) {
        this.capturedAt.delete(e.snapshotId);
        return false;
      }
      return true;
    });
  }
}
