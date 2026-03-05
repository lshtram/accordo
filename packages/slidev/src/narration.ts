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
  if (!raw) return { slides: [], raw };

  // Split on `---` line separators
  const parts = raw.split(/^---$/m);

  // Detect and skip YAML front-matter: first block is all non-content
  let start = 0;
  if (parts.length >= 3 && /^\s*\w+\s*:/.test(parts[0].trim() === "" ? parts[1] : parts[0])) {
    // The pattern `--- front-matter ---` means parts[0] is empty (before first ---)
    // and parts[1] is the front-matter block
    if (parts[0].trim() === "") {
      start = 2; // skip empty + front-matter
    }
  }

  const slideRaws = parts.slice(start).filter((p) => p.trim() !== "");
  if (slideRaws.length === 0) return { slides: [], raw };

  const slides: ParsedSlide[] = slideRaws.map((raw, i) => {
    const notesSep = /<!--\s*notes\s*-->/i;
    const noteIdx = raw.search(notesSep);
    if (noteIdx !== -1) {
      // Split at the notes separator
      const content = raw.slice(0, noteIdx).trim();
      const afterSep = raw.slice(noteIdx).replace(notesSep, "").trim();
      return { index: i + start, content, notes: afterSep || null };
    }
    return { index: i + start, content: raw.trim(), notes: null };
  });

  // Re-index sequentially from 0
  slides.forEach((s, i) => { s.index = i; });

  return { slides, raw };
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
  if (target === "all") {
    return deck.slides.map((slide) => ({
      slideIndex: slide.index,
      narrationText: slideToNarrationText(slide),
    }));
  }
  if (target < 0 || target >= deck.slides.length) {
    return [];
  }
  const slide = deck.slides[target];
  return [{ slideIndex: slide.index, narrationText: slideToNarrationText(slide) }];
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
  const stripMarkdown = (text: string): string =>
    text
      .replace(/^#{1,6}\s+/gm, "")        // headings
      .replace(/\*\*(.*?)\*\*/g, "$1")    // bold
      .replace(/\*(.*?)\*/g, "$1")        // italic
      .replace(/_(.*?)_/g, "$1")          // italic _
      .replace(/`(.*?)`/g, "$1")          // inline code
      .replace(/^\s*[-*+]\s+/gm, "")     // bullets
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // links
      .replace(/\n{2,}/g, " ")            // multiple newlines → space
      .replace(/\n/g, " ")
      .trim();

  // Prefer speaker notes
  if (slide.notes && slide.notes.trim()) {
    return stripMarkdown(slide.notes);
  }

  const content = slide.content.trim();
  if (!content) {
    return `Slide ${slide.index + 1}.`;
  }

  return stripMarkdown(content) || `Slide ${slide.index + 1}.`;
}
