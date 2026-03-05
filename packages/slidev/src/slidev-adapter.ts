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
    throw new Error("not implemented");
  }

  /**
   * M44-TL-05 / M44-RT-06
   * Polls GET http://localhost:{port}/json — the authoritative source.
   */
  async getCurrent(): Promise<{ index: number; title: string }> {
    throw new Error("not implemented");
  }

  /**
   * M44-TL-06 / M44-RT-03
   * Throws RangeError if index is out of bounds.
   */
  async goto(index: number): Promise<void> {
    throw new Error("not implemented");
  }

  /** M44-TL-07 */
  async next(): Promise<void> {
    throw new Error("not implemented");
  }

  /** M44-TL-08 */
  async prev(): Promise<void> {
    throw new Error("not implemented");
  }

  /** M44-RT-04 */
  onSlideChanged(listener: (index: number) => void): { dispose(): void } {
    throw new Error("not implemented");
  }

  /**
   * M44-RT-05
   * A valid Slidev deck must:
   *   - Be non-empty
   *   - Contain at least one `---` separator (more than one slide, or a front-matter block)
   */
  validateDeck(deckFsPath: string, deckContent: string): DeckValidationResult {
    throw new Error("not implemented");
  }

  /** Stop polling, remove all listeners. */
  dispose(): void {
    throw new Error("not implemented");
  }
}
