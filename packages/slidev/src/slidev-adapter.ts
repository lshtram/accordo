/**
 * accordo-slidev — Slidev Runtime Adapter
 *
 * Implements PresentationRuntimeAdapter for the Slidev dev server.
 * Polls `GET http://localhost:{port}/json` for current slide state.
 *
 * Source: requirements-slidev.md §4 M44-RT
 *
 * Requirements:
 *   M44-RT-02  Slidev implementation conforms to PresentationRuntimeAdapter
 *   M44-RT-03  Returns RangeError for invalid slide indices
 *   M44-RT-04  Emits onSlideChanged events via REST polling
 *   M44-RT-05  Validates deck content (non-empty, has at least one --- separator)
 *   M44-RT-06  getCurrent polls GET /json on the Slidev server
 */

import type { PresentationRuntimeAdapter } from "./runtime-adapter.js";
import type { SlideSummary, DeckValidationResult, ParsedDeck } from "./types.js";

/**
 * SlidevAdapter constructor options.
 */
export interface SlidevAdapterOptions {
  /**
   * Port the Slidev dev server is listening on.
   */
  port: number;

  /**
   * Pre-parsed deck for listSlides / validateDeck.
   */
  deck: ParsedDeck;

  /**
   * Polling interval in ms for getCurrent (default: 500).
   */
  pollIntervalMs?: number;
}

/**
 * M44-RT-02 / Slidev-specific implementation of PresentationRuntimeAdapter.
 *
 * Communicates with the Slidev dev server via its REST API.
 * Slide navigation is performed by sending keyboard postMessages to the
 * Slidev WebSocket, but getCurrent uses the authoritative REST poll (M44-RT-06).
 */
export class SlidevAdapter implements PresentationRuntimeAdapter {
  private readonly port: number;
  private readonly deck: ParsedDeck;
  private readonly pollIntervalMs: number;

  private currentIndex = 0;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private readonly slideChangeListeners: Array<(index: number) => void> = [];

  constructor(options: SlidevAdapterOptions) {
    this.port = options.port;
    this.deck = options.deck;
    this.pollIntervalMs = options.pollIntervalMs ?? 500;
  }

  /** M44-TL-04 */
  async listSlides(): Promise<SlideSummary[]> {
    return this.deck.slides.map((slide) => {
      const headingMatch = /^#{1,6}\s+(.+)/m.exec(slide.content);
      const title = headingMatch ? headingMatch[1].trim() : `Slide ${slide.index + 1}`;
      const summary: SlideSummary = { index: slide.index, title };
      if (slide.notes) {
        summary.notesPreview = slide.notes.slice(0, 80);
      }
      return summary;
    });
  }

  /**
   * M44-TL-05 / M44-RT-06
   * Polls GET http://localhost:{port}/json — the authoritative source.
   */
  async getCurrent(): Promise<{ index: number; title: string }> {
    try {
      const res = await fetch(`http://localhost:${this.port}/json`);
      if (res.ok) {
        const json = (await res.json()) as { cursor: number; total: number };
        this.currentIndex = json.cursor;
      }
    } catch {
      // Fallback to internal cursor on network error
    }
    const slide = this.deck.slides[this.currentIndex];
    const headingMatch = slide ? /^#{1,6}\s+(.+)/m.exec(slide.content) : null;
    const title = headingMatch ? headingMatch[1].trim() : `Slide ${this.currentIndex + 1}`;
    return { index: this.currentIndex, title };
  }

  /**
   * M44-TL-06 / M44-RT-03
   * Throws RangeError if index is out of bounds.
   * Calls POST /navigate/{index} on the Slidev server to actually navigate.
   */
  async goto(index: number): Promise<void> {
    if (index < 0 || index >= this.deck.slides.length) {
      throw new RangeError(
        `Slide index ${index} out of bounds (0–${this.deck.slides.length - 1})`,
      );
    }
    // Call Slidev HTTP API to actually navigate the running server (0-based index).
    // Ignore errors — adapter falls back to local cursor if server is unreachable.
    if (this.port > 0) {
      try {
        await fetch(`http://localhost:${this.port}/navigate/${index}`, { method: "POST" });
      } catch {
        // Server not yet ready or unreachable — update local state only
      }
    }
    const prev = this.currentIndex;
    this.currentIndex = index;
    if (prev !== index) {
      this.emitSlideChanged(index);
    }
  }

  /**
   * M44-RT-04
   * Starts polling GET /json every pollIntervalMs and emits onSlideChanged
   * when the server's cursor differs from the local cursor.
   * Safe to call multiple times — subsequent calls are no-ops.
   */
  startPolling(): void {
    if (this.pollTimer !== null || this.port <= 0) return;
    this.pollTimer = setInterval(async () => {
      try {
        const res = await fetch(`http://localhost:${this.port}/json`);
        if (res.ok) {
          const json = (await res.json()) as { cursor: number; total: number };
          const serverIndex = json.cursor;
          if (serverIndex !== this.currentIndex) {
            const prev = this.currentIndex;
            this.currentIndex = serverIndex;
            if (prev !== serverIndex) {
              this.emitSlideChanged(serverIndex);
            }
          }
        }
      } catch {
        // Server not yet ready — keep polling
      }
    }, this.pollIntervalMs);
  }

  /** M44-TL-07 */
  async next(): Promise<void> {
    if (this.currentIndex < this.deck.slides.length - 1) {
      await this.goto(this.currentIndex + 1);
    }
  }

  /** M44-TL-08 */
  async prev(): Promise<void> {
    if (this.currentIndex > 0) {
      await this.goto(this.currentIndex - 1);
    }
  }

  /** M44-RT-04 */
  onSlideChanged(listener: (index: number) => void): { dispose(): void } {
    this.slideChangeListeners.push(listener);
    return {
      dispose: () => {
        const idx = this.slideChangeListeners.indexOf(listener);
        if (idx !== -1) this.slideChangeListeners.splice(idx, 1);
      },
    };
  }

  /**
   * M44-RT-05
   * A valid Slidev deck must:
   *   - Be non-empty
   * Content without a "---" separator is a valid single-slide deck.
   */
  validateDeck(deckFsPath: string, deckContent: string): DeckValidationResult {
    if (!deckContent || !deckContent.trim()) {
      return { valid: false, error: `Deck file is empty: ${deckFsPath}` };
    }
    return { valid: true };
  }

  /** Stop polling, remove all listeners. */
  dispose(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.slideChangeListeners.splice(0, this.slideChangeListeners.length);
  }

  private emitSlideChanged(index: number): void {
    for (const listener of [...this.slideChangeListeners]) {
      listener(index);
    }
  }
}
