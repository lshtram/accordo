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
 * @module
 */

import type { SnapshotEnvelopeFields } from "./types.js";

/** Maximum snapshots retained per pageId (FIFO eviction). */
export const RETENTION_SLOTS = 5;

/**
 * B2-SV-004: Per-page 5-slot FIFO retention store for snapshot envelopes.
 *
 * All four data-producing tool handlers save their envelope here on
 * success so agents can access recent snapshots without re-requesting.
 */
export class SnapshotRetentionStore {
  /** pageId → ordered list of envelopes (oldest first, newest last). */
  private readonly pages = new Map<string, SnapshotEnvelopeFields[]>();

  /**
   * Save an envelope for a page.
   * If the page already has RETENTION_SLOTS entries the oldest is evicted.
   *
   * @param pageId — Stable page identifier from the envelope.
   * @param envelope — The full SnapshotEnvelopeFields from the relay response.
   */
  save(pageId: string, envelope: SnapshotEnvelopeFields): void {
    let slots = this.pages.get(pageId);
    if (slots === undefined) {
      slots = [];
      this.pages.set(pageId, slots);
    }
    slots.push(envelope);
    // FIFO eviction: remove oldest when over the limit
    if (slots.length > RETENTION_SLOTS) {
      slots.shift();
    }
  }

  /**
   * Return the most-recently saved envelope for a page, or undefined if none.
   *
   * @param pageId — Stable page identifier.
   */
  getLatest(pageId: string): SnapshotEnvelopeFields | undefined {
    const slots = this.pages.get(pageId);
    if (!slots || slots.length === 0) return undefined;
    return slots[slots.length - 1];
  }

  /**
   * Return all retained envelopes for a page, oldest first.
   *
   * @param pageId — Stable page identifier.
   */
  list(pageId: string): SnapshotEnvelopeFields[] {
    return this.pages.get(pageId) ?? [];
  }

  /**
   * Retrieve a specific envelope by its snapshotId across all pages.
   * Returns undefined if not found.
   *
   * @param snapshotId — Format: `{pageId}:{version}`.
   */
  get(snapshotId: string): SnapshotEnvelopeFields | undefined {
    for (const slots of this.pages.values()) {
      for (const envelope of slots) {
        if (envelope.snapshotId === snapshotId) return envelope;
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
    this.pages.delete(pageId);
  }

  /**
   * Clear all retained snapshots across all pages.
   * Useful in tests and on extension deactivation.
   */
  clear(): void {
    this.pages.clear();
  }
}
