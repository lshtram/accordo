/**
 * M100-SCREEN — Screenshot Retention Store (browser package)
 *
 * Lightweight per-page retention store for screenshot metadata.
 * Holds up to MAX_SLOTS screenshots per pageId using FIFO eviction.
 * When a screenshot file is evicted, the on-disk file is deleted.
 *
 * GAP-G1: Supports list and clear actions — wired into the MCP tool
 * `browser_manage_screenshots`.
 *
 * Architecture:
 * - This store tracks screenshot metadata only (not the data itself)
 * - Screenshot files are written to `~/.accordo/screenshots/` by
 *   `handleCaptureRegion` (page-tool-handlers-impl.ts) in the file-ref branch
 * - The store is consulted when listing or clearing screenshots
 *
 * @module
 */

/** Maximum screenshots retained per pageId (FIFO eviction). */
export const SCREENSHOT_RETENTION_SLOTS = 10;

/**
 * Metadata for a single retained screenshot artifact.
 * Stored in ScreenshotRetentionStore; the actual file is on disk.
 */
export interface ScreenshotRecord {
  /** Stable screenshot identifier — matches auditId used as filename */
  readonly screenshotId: string;
  /** Stable page identifier (from SnapshotEnvelope) */
  readonly pageId: string;
  /** Absolute path to the on-disk screenshot file */
  readonly filePath: string;
  /** Human-readable file URL (file:// URL) */
  readonly fileUri: string;
  /** When the screenshot was captured (ISO 8601) */
  readonly capturedAt: string;
  /** File size in bytes */
  readonly sizeBytes: number;
  /** Image format (jpeg | png | webp) */
  readonly format: string;
  /** Image width in CSS px */
  readonly width: number;
  /** Image height in CSS px */
  readonly height: number;
}

/**
 * B2-SV-004: Per-page FIFO retention store for screenshot artifacts.
 *
 * Manages screenshot metadata and on-disk lifecycle for screenshots
 * written by `handleCaptureRegion` (file-ref transport branch).
 * When a screenshot is evicted or cleared, the on-disk file is deleted.
 */
export class ScreenshotRetentionStore {
  /** pageId → ordered list of screenshot records (oldest first, newest last). */
  private readonly pages = new Map<string, ScreenshotRecord[]>();

  /**
   * Save a screenshot record for a page.
   * If the page already has SCREENSHOT_RETENTION_SLOTS entries the oldest is evicted
   * (including deleting the on-disk file).
   *
   * @param pageId — Stable page identifier.
   * @param record — Screenshot record to save.
   */
  save(pageId: string, record: ScreenshotRecord): void {
    let slots = this.pages.get(pageId) ?? [];
    slots.push(record);
    // FIFO eviction: remove oldest when over the limit
    while (slots.length > SCREENSHOT_RETENTION_SLOTS) {
      const evicted = slots.shift();
      if (evicted !== undefined) this.deleteFile(evicted.filePath);
    }
    this.pages.set(pageId, slots);
  }

  /**
   * Return the most-recently saved screenshot record for a page, or undefined if none.
   *
   * @param pageId — Stable page identifier.
   */
  getLatest(pageId: string): ScreenshotRecord | undefined {
    const slots = this.pages.get(pageId);
    if (!slots || slots.length === 0) return undefined;
    return slots[slots.length - 1];
  }

  /**
   * Return all retained screenshot records for a page, oldest first.
   *
   * @param pageId — Stable page identifier.
   */
  list(pageId: string): ScreenshotRecord[] {
    return [...(this.pages.get(pageId) ?? [])];
  }

  /**
   * Retrieve a specific screenshot record by screenshotId across all pages.
   *
   * @param screenshotId — Matches auditId used as filename (without extension).
   */
  get(screenshotId: string): ScreenshotRecord | undefined {
    for (const slots of this.pages.values()) {
      for (const record of slots) {
        if (record.screenshotId === screenshotId) return record;
      }
    }
    return undefined;
  }

  /**
   * Clear all retained screenshots for a given page.
   * Deletes on-disk files for all evicted screenshots.
   * Call this when a navigation event is detected for the page.
   *
   * @param pageId — Stable page identifier.
   */
  resetOnNavigation(pageId: string): void {
    const slots = this.pages.get(pageId);
    if (slots) {
      for (const record of slots) this.deleteFile(record.filePath);
    }
    this.pages.delete(pageId);
  }

  /**
   * Clear all retained screenshots across all pages.
   * Useful in tests and on extension deactivation.
   */
  clear(): void;
  /**
   * Clear all retained screenshots for a specific page.
   *
   * @param pageId — Stable page identifier.
   */
  clear(pageId: string): void;
  clear(pageId?: string): void {
    if (pageId !== undefined) {
      const slots = this.pages.get(pageId);
      if (slots) {
        for (const record of slots) this.deleteFile(record.filePath);
      }
      this.pages.delete(pageId);
    } else {
      for (const slots of this.pages.values()) {
        for (const record of slots) this.deleteFile(record.filePath);
      }
      this.pages.clear();
    }
  }

  /**
   * Return screenshot metadata for all pages currently in the store.
   *
   * @returns A Map from pageId to its ordered list of ScreenshotRecord (oldest first).
   */
  listAll(): Map<string, ScreenshotRecord[]> {
    return new Map(this.pages);
  }

  // ── File deletion helper ─────────────────────────────────────────────────────

  /**
   * Delete a screenshot file from disk, ignoring errors if the file is already gone.
   * Silently ignores errors (file missing, permission denied) so eviction/clear
   * cannot fail — screenshots are best-effort cleanup.
   */
  private deleteFile(filePath: string): void {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fs = require("fs") as typeof import("fs");
      fs.unlinkSync(filePath);
    } catch {
      // File already gone or permission error — nothing to do
    }
  }
}
