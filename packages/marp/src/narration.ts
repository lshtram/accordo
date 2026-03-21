/**
 * accordo-marp — Narration Text Generator
 *
 * Source: requirements-marp.md §4 M50-NAR
 *
 * Requirements:
 *   M50-NAR-01  generateNarration accepts slide index (or "all") and deck content
 *   M50-NAR-02  Returns { slideIndex, narrationText }[] per slide
 *   M50-NAR-03  Narration derived from headings, bullet points, speaker notes
 *   M50-NAR-04  Marp uses <!-- notes --> or <!-- speaker_notes --> syntax
 *   M50-NAR-05  Output is plain text — no markdown, suitable for TTS
 */

import type { SlideNarration, ParsedDeck, ParsedSlide } from "./types.js";

export function parseDeck(raw: string): ParsedDeck {
  if (!raw) return { slides: [], raw };

  // Strip leading YAML front matter (--- ... ---) before splitting.
  const frontmatterMatch = raw.match(/^---[\s\S]*?---\n?/);
  const body = frontmatterMatch ? raw.slice(frontmatterMatch[0].length) : raw;

  // Split on --- separator (surrounded by newlines, as Marp requires)
  const slideRaws = body.split(/\n---\n/).filter((p) => p.trim() !== "");
  if (slideRaws.length === 0) return { slides: [], raw };

  const notesSep = /<!--\s*(?:notes|speaker_notes)\s*-->/i;

  const slides: ParsedSlide[] = slideRaws.map((rawSlide, i) => {
    const noteIdx = rawSlide.search(notesSep);
    if (noteIdx !== -1) {
      const content = rawSlide.slice(0, noteIdx).trim();
      const afterSep = rawSlide.slice(noteIdx).replace(notesSep, "").trim();
      return { index: i, content, notes: afterSep || null };
    }
    return { index: i, content: rawSlide.trim(), notes: null };
  });

  return { slides, raw };
}

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

  if (slide.notes && slide.notes.trim()) {
    return stripMarkdown(slide.notes);
  }

  const content = slide.content.trim();
  if (!content) {
    return `Slide ${slide.index + 1}.`;
  }

  return stripMarkdown(content) || `Slide ${slide.index + 1}.`;
}
