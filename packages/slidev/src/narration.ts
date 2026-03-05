/**
 * accordo-slidev — Narration Text Generator
 *
 * Pure functions for generating plain-text narration from slide content.
 * Has NO VS Code dependency — safe to test without mocks.
 *
 * Source: requirements-slidev.md §4 M44-NAR
 *
 * Requirements:
 *   M44-NAR-01  generateNarration accepts slide index (or "all") and deck content
 *   M44-NAR-02  Returns { slideIndex, narrationText }[] per slide
 *   M44-NAR-03  Narration derived from headings, bullet points, speaker notes
 *   M44-NAR-04  If no speaker notes, generates summary from slide content
 *   M44-NAR-05  Output is plain text — no markdown, suitable for TTS
 */

import type { SlideNarration, ParsedDeck, ParsedSlide } from "./types.js";

// ── Deck Parser ───────────────────────────────────────────────────────────────

/**
 * Splits raw Slidev markdown into individual ParsedSlide objects.
 *
 * Slidev decks use `---` as the primary slide separator.
 * Speaker notes are delimited by a `<!--` comment block containing `notes:`,
 * or by the `---` separator in the notes section.
 *
 * @param raw  Raw deck content as a string.
 */
export function parseDeck(raw: string): ParsedDeck {
  throw new Error("not implemented");
}

// ── Narration Generator ───────────────────────────────────────────────────────

/**
 * M44-NAR-01 / M44-NAR-02
 * Generates narration text for a specific slide or all slides.
 *
 * @param deck   Pre-parsed deck (from parseDeck()).
 * @param target Slide index (0-based) or "all".
 * @returns      Array of SlideNarration objects, one per requested slide.
 */
export function generateNarration(
  deck: ParsedDeck,
  target: number | "all",
): SlideNarration[] {
  throw new Error("not implemented");
}

/**
 * M44-NAR-03 / M44-NAR-04 / M44-NAR-05
 * Derives narration text from a single slide.
 *
 * Order of precedence:
 *   1. Speaker notes (if present) — returned as-is after stripping markdown.
 *   2. Heading(s) + bullet points condensed into plain sentences.
 *
 * @param slide  A parsed slide.
 * @returns      Plain text suitable for TTS (no markdown syntax).
 */
export function slideToNarrationText(slide: ParsedSlide): string {
  throw new Error("not implemented");
}
