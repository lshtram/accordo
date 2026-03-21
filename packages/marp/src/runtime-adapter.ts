/**
 * accordo-marp — Presentation Runtime Adapter Interface
 *
 * A runtime-neutral abstraction over any slide presentation engine.
 * The Marp-specific implementation lives in marp-adapter.ts.
 * This is the same interface used by accordo-slidev.
 *
 * Source: requirements-marp.md §4 M50-RT
 *
 * Requirements:
 *   M50-RT-01  Implements PresentationRuntimeAdapter interface
 *   M50-RT-04  Emits slide-change events consumed by state publisher
 *   M50-RT-07  Adapter emits slide-change events consumed by state publisher
 */

import type { SlideSummary, DeckValidationResult } from "./types.js";

// ── PresentationRuntimeAdapter ────────────────────────────────────────────────

/**
 * M50-RT-01
 * Runtime-neutral interface all presentation engines must implement.
 */
export interface PresentationRuntimeAdapter {
  /**
   * Returns ordered slide metadata for the open deck.
   * Source: M50-TL-04
   */
  listSlides(): Promise<SlideSummary[]>;

  /**
   * Returns current slide index (0-based) and title.
   * Source: M50-TL-05
   */
  getCurrent(): Promise<{ index: number; title: string }>;

  /**
   * Navigates to the exact slide index (0-based).
   * Throws `RangeError` for out-of-bounds indices (M50-RT-04).
   * Source: M50-TL-06
   */
  goto(index: number): Promise<void>;

  /**
   * Advances to the next slide.
   * No-ops if already on the last slide.
   * Source: M50-TL-07
   */
  next(): Promise<void>;

  /**
   * Goes back one slide.
   * No-ops if already on the first slide.
   * Source: M50-TL-08
   */
  prev(): Promise<void>;

  /**
   * M50-RT-06
   * Subscribes to slide-change events emitted by the runtime.
   * Each event carries the new slide index (0-based).
   * Returns a disposable subscription.
   */
  onSlideChanged(listener: (index: number) => void): { dispose(): void };

  /**
   * M50-RT-02
   * Validates deck content before opening.
   * Returns `{ valid: true }` for a recognisable deck,
   * or `{ valid: false, error: "..." }` for missing/unrecognisable files.
   */
  validateDeck(deckFsPath: string, deckContent: string): DeckValidationResult;

  /**
   * Tears down the adapter (removes listeners, resets state).
   */
  dispose(): void;
}
