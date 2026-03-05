/**
 * accordo-slidev — Presentation Runtime Adapter Interface
 *
 * A runtime-neutral abstraction over any slide presentation engine.
 * The Slidev-specific implementation lives in slidev-adapter.ts.
 *
 * Source: requirements-slidev.md §4 M44-RT
 *
 * Requirements:
 *   M44-RT-01  Defines runtime-neutral interface for listSlides/getCurrent/goto/next/prev
 *   M44-RT-02  Slidev implementation conforms to this interface
 *   M44-RT-03  Returns deterministic errors for invalid slide indices
 *   M44-RT-04  Emits slide-change events consumed by state publisher
 *   M44-RT-05  Validates deck content on open; returns structured error for bad deck
 *   M44-RT-06  getCurrent polls GET /json REST endpoint on Slidev server
 */

import type { SlideSummary, DeckValidationResult } from "./types.js";

// ── PresentationRuntimeAdapter ────────────────────────────────────────────────

/**
 * M44-RT-01
 * Runtime-neutral interface all presentation engines must implement.
 */
export interface PresentationRuntimeAdapter {
  /**
   * Returns ordered slide metadata for the open deck.
   * Source: M44-TL-04
   */
  listSlides(): Promise<SlideSummary[]>;

  /**
   * Returns current slide index (0-based) and title.
   * Implementation polls the runtime's REST endpoint.
   * Source: M44-TL-05, M44-RT-06
   */
  getCurrent(): Promise<{ index: number; title: string }>;

  /**
   * Navigates to the exact slide index (0-based).
   * Throws `RangeError` for out-of-bounds indices (M44-RT-03).
   * Source: M44-TL-06
   */
  goto(index: number): Promise<void>;

  /**
   * Advances to the next slide.
   * No-ops if already on the last slide.
   * Source: M44-TL-07
   */
  next(): Promise<void>;

  /**
   * Goes back one slide.
   * No-ops if already on the first slide.
   * Source: M44-TL-08
   */
  prev(): Promise<void>;

  /**
   * M44-RT-04
   * Subscribes to slide-change events emitted by the runtime.
   * Each event carries the new slide index (0-based).
   * Returns a disposable subscription.
   */
  onSlideChanged(listener: (index: number) => void): { dispose(): void };

  /**
   * M44-RT-05
   * Validates deck content before opening.
   * Returns `{ valid: true }` for a recognisable Slidev deck,
   * or `{ valid: false, error: "..." }` for missing/unrecognisable files.
   */
  validateDeck(deckFsPath: string, deckContent: string): DeckValidationResult;

  /**
   * Tears down the adapter (stops polling, removes listeners).
   */
  dispose(): void;
}
