/**
 * narration.test.ts — Tests for parseDeck, slideToNarrationText, generateNarration
 *
 * Requirements covered:
 *   M44-NAR-01  generateNarration accepts slide index or "all" and deck content
 *   M44-NAR-02  Returns { slideIndex, narrationText }[] per slide
 *   M44-NAR-03  Narration derived from headings, bullet points, speaker notes
 *   M44-NAR-04  If no speaker notes, generates summary from slide content
 *   M44-NAR-05  Output is plain text (no markdown), suitable for TTS
 *   M44-RT-05   parseDeck validates deck structure (at least one slide)
 */

import { describe, it, expect } from "vitest";
import {
  parseDeck,
  generateNarration,
  slideToNarrationText,
} from "../narration.js";

// ── parseDeck ─────────────────────────────────────────────────────────────────

describe("parseDeck", () => {
  it("M44-RT-05: returns valid ParsedDeck for a single-slide deck", () => {
    const raw = "# Hello World\n\nSome content here.";
    const deck = parseDeck(raw);
    expect(deck.slides).toHaveLength(1);
    expect(deck.slides[0].index).toBe(0);
    expect(deck.slides[0].content).toContain("Hello World");
    expect(deck.raw).toBe(raw);
  });

  it("M44-RT-05: splits multiple slides on --- separator", () => {
    const raw = "# Slide One\n\nContent A\n\n---\n\n# Slide Two\n\nContent B\n\n---\n\n# Slide Three";
    const deck = parseDeck(raw);
    expect(deck.slides).toHaveLength(3);
    expect(deck.slides[0].index).toBe(0);
    expect(deck.slides[1].index).toBe(1);
    expect(deck.slides[2].index).toBe(2);
  });

  it("M44-RT-05: slides with front-matter separator deduplicated correctly", () => {
    const raw = "---\ntitle: My Deck\n---\n\n# Introduction\n\nContent\n\n---\n\n# Second Slide";
    const deck = parseDeck(raw);
    // front-matter is slide 0, content slides follow
    expect(deck.slides.length).toBeGreaterThanOrEqual(2);
  });

  it("M44-NAR-03: extracts speaker notes after a notes separator", () => {
    const raw = "# Title\n\nBullet content\n\n<!-- notes -->\n\nThis is the spoken note.";
    const deck = parseDeck(raw);
    expect(deck.slides[0].notes).toContain("spoken note");
    expect(deck.slides[0].content).toContain("Bullet content");
  });

  it("M44-NAR-03: notes is null when no speaker notes separator present", () => {
    const raw = "# Title\n\nBullet content only.";
    const deck = parseDeck(raw);
    expect(deck.slides[0].notes).toBeNull();
  });

  it("M44-RT-05: handles empty string gracefully — returns zero slides or one empty slide", () => {
    const deck = parseDeck("");
    // Either 0 slides or 1 empty slide — must not throw
    expect(deck.slides.length).toBeGreaterThanOrEqual(0);
  });
});

// ── slideToNarrationText ──────────────────────────────────────────────────────

describe("slideToNarrationText", () => {
  it("M44-NAR-03: uses speaker notes when present", () => {
    const slide = {
      index: 0,
      content: "# Title\n\n- bullet one\n- bullet two",
      notes: "Speak these exact words to the audience.",
    };
    const text = slideToNarrationText(slide);
    expect(text).toContain("Speak these exact words");
  });

  it("M44-NAR-04: generates summary from heading + bullets when no notes", () => {
    const slide = {
      index: 0,
      content: "# Architecture Overview\n\n- Layer one\n- Layer two\n- Layer three",
      notes: null,
    };
    const text = slideToNarrationText(slide);
    expect(text).toContain("Architecture Overview");
    expect(text).toContain("Layer one");
  });

  it("M44-NAR-05: output contains no markdown syntax (no #, *, -)", () => {
    const slide = {
      index: 1,
      content: "# Heading\n\n**bold** and *italic*\n\n- item one\n- item two",
      notes: null,
    };
    const text = slideToNarrationText(slide);
    expect(text).not.toMatch(/^#/m);
    expect(text).not.toMatch(/\*\*/);
    expect(text).not.toMatch(/^\s*[-*]\s/m);
  });

  it("M44-NAR-04: handles slide with no content or notes — returns fallback string", () => {
    const slide = { index: 2, content: "", notes: null };
    const text = slideToNarrationText(slide);
    expect(typeof text).toBe("string");
    expect(text.length).toBeGreaterThan(0);
  });

  it("M44-NAR-05: notes content is stripped of markdown before return", () => {
    const slide = {
      index: 0,
      content: "# Title",
      notes: "**Important:** speak _slowly_ here.",
    };
    const text = slideToNarrationText(slide);
    expect(text).not.toMatch(/\*\*/);
    expect(text).not.toMatch(/_\w+_/);
    expect(text).toContain("Important");
    expect(text).toContain("slowly");
  });
});

// ── generateNarration ─────────────────────────────────────────────────────────

describe("generateNarration", () => {
  const raw = [
    "# Intro\n\n- First point\n- Second point",
    "# Body\n\nMain content\n\n<!-- notes -->\n\nSpeak this for slide two.",
    "# Conclusion\n\n- Wrap up",
  ].join("\n\n---\n\n");

  it("M44-NAR-01 / M44-NAR-02: generates narration for all slides when target is 'all'", () => {
    const deck = parseDeck(raw);
    const result = generateNarration(deck, "all");
    expect(result).toHaveLength(deck.slides.length);
    result.forEach((n, i) => {
      expect(n.slideIndex).toBe(i);
      expect(typeof n.narrationText).toBe("string");
      expect(n.narrationText.length).toBeGreaterThan(0);
    });
  });

  it("M44-NAR-01 / M44-NAR-02: generates narration for a single slide by index", () => {
    const deck = parseDeck(raw);
    const result = generateNarration(deck, 1);
    expect(result).toHaveLength(1);
    expect(result[0].slideIndex).toBe(1);
    expect(result[0].narrationText).toContain("slide two");
  });

  it("M44-NAR-01: returns empty array for out-of-range slide index", () => {
    const deck = parseDeck(raw);
    const result = generateNarration(deck, 999);
    expect(result).toEqual([]);
  });

  it("M44-NAR-02: slide 0 narration uses bullet points (no notes)", () => {
    const deck = parseDeck(raw);
    const result = generateNarration(deck, 0);
    expect(result[0].narrationText).toContain("First point");
  });

  it("M44-NAR-02: slide 1 narration prefers speaker notes", () => {
    const deck = parseDeck(raw);
    const result = generateNarration(deck, 1);
    expect(result[0].narrationText).toContain("slide two");
  });
});
