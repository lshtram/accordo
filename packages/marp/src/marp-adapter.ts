/**
 * accordo-marp — Marp Runtime Adapter
 *
 * Source: requirements-marp.md §4 M50-RT
 *
 * Requirements:
 *   M50-RT-01  Implements PresentationRuntimeAdapter interface
 *   M50-RT-02  validateDeck checks non-empty and --- separators
 *   M50-RT-03  listSlides parses markdown, extracts first # heading as title
 *   M50-RT-04  goto() throws RangeError for out-of-bounds indices
 *   M50-RT-05  Navigation state tracked locally (no server polling)
 *   M50-RT-06  onSlideChanged fires when webview reports slide change (postMessage)
 *   M50-RT-07  Adapter emits slide-change events consumed by state publisher
 */

import type { PresentationRuntimeAdapter } from "./runtime-adapter.js";
import type { SlideSummary, DeckValidationResult, ParsedDeck } from "./types.js";
import { parseDeck } from "./narration.js";

export class MarpAdapter implements PresentationRuntimeAdapter {
  private currentIndex = 0;
  private readonly slideChangeListeners: Array<(index: number) => void> = [];
  private readonly deck: ParsedDeck;

  constructor(deckContent: string) {
    this.deck = parseDeck(deckContent);
    this.currentIndex = 0;
  }

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

  async getCurrent(): Promise<{ index: number; title: string }> {
    const slides = await this.listSlides();
    const slide = slides[this.currentIndex];
    return {
      index: this.currentIndex,
      title: slide?.title ?? `Slide ${this.currentIndex + 1}`,
    };
  }

  async goto(index: number): Promise<void> {
    if (index < 0 || index >= this.deck.slides.length) {
      throw new RangeError(`Slide index ${index} is out of bounds (have ${this.deck.slides.length} slides)`);
    }
    this.currentIndex = index;
    this.emitSlideChanged(index);
  }

  async next(): Promise<void> {
    const nextIndex = this.currentIndex + 1;
    if (nextIndex < this.deck.slides.length) {
      await this.goto(nextIndex);
    }
  }

  async prev(): Promise<void> {
    const prevIndex = this.currentIndex - 1;
    if (prevIndex >= 0) {
      await this.goto(prevIndex);
    }
  }

  onSlideChanged(listener: (index: number) => void): { dispose(): void } {
    this.slideChangeListeners.push(listener);
    return {
      dispose: () => {
        const idx = this.slideChangeListeners.indexOf(listener);
        if (idx !== -1) this.slideChangeListeners.splice(idx, 1);
      },
    };
  }

  validateDeck(_deckFsPath: string, deckContent: string): DeckValidationResult {
    if (!deckContent || !deckContent.trim()) {
      return { valid: false, error: "Deck content is empty" };
    }
    if (!deckContent.includes("---")) {
      return { valid: false, error: "No slide separators (---) found in deck" };
    }
    return { valid: true };
  }

  dispose(): void {
    this.slideChangeListeners.splice(0);
  }

  handleWebviewSlideChanged(index: number): void {
    if (index >= 0 && index < this.deck.slides.length && index !== this.currentIndex) {
      this.currentIndex = index;
      this.emitSlideChanged(index);
    }
  }

  private emitSlideChanged(index: number): void {
    for (const listener of this.slideChangeListeners) {
      listener(index);
    }
  }
}
