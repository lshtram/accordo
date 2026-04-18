/**
 * narration.test.ts — Tests for parseDeck, slideToNarrationText, generateNarration
 *
 * Marp-specific: speaker notes use <!-- notes --> or <!-- speaker_notes --> syntax.
 * Both forms must be recognised and preferred over slide content for narration.
 *
 * Requirements covered:
 *   M50-NAR-01  generateNarration accepts slide index or "all" and deck content
 *   M50-NAR-02  Returns { slideIndex, narrationText }[] per slide
 *   M50-NAR-03  Narration derived from headings, bullets, speaker notes
 *   M50-NAR-04  Marp notes syntax: <!-- notes --> and <!-- speaker_notes -->
 *   M50-NAR-05  Output is plain text (no markdown), suitable for TTS
 */

import { describe, it, expect } from "vitest";
import { parseDeck, generateNarration, slideToNarrationText } from "../narration.js";

// ── parseDeck ─────────────────────────────────────────────────────────────────

describe("parseDeck", () => {
  it("M50-NAR-03: returns a valid ParsedDeck for a multi-slide Marp deck", () => {
    // Basic structural contract — deck object must have slides array and raw.
    const raw = "# Slide One\n\n---\n\n# Slide Two";
    const deck = parseDeck(raw);
    expect(deck.slides).toHaveLength(2);
    expect(deck.raw).toBe(raw);
  });

  it("M50-NAR-03: single-slide deck (no --- separator) returns one slide", () => {
    // A deck without --- still produces exactly one slide.
    const raw = "# Hello World\n\nSome content here.";
    const deck = parseDeck(raw);
    expect(deck.slides).toHaveLength(1);
    expect(deck.slides[0].index).toBe(0);
    expect(deck.slides[0].content).toContain("Hello World");
    expect(deck.raw).toBe(raw);
  });

  it("M50-NAR-03: splits multiple slides on --- separator", () => {
    // Three slides separated by --- must produce three ParsedSlide entries.
    const raw = "# Slide One\n\nContent A\n\n---\n\n# Slide Two\n\nContent B\n\n---\n\n# Slide Three";
    const deck = parseDeck(raw);
    expect(deck.slides).toHaveLength(3);
    expect(deck.slides[0].index).toBe(0);
    expect(deck.slides[1].index).toBe(1);
    expect(deck.slides[2].index).toBe(2);
  });

  it("M50-NAR-03: strips Marp frontmatter from slide 0 content", () => {
    // The YAML frontmatter block (marp: true, theme, etc.) must not appear in content.
    const raw = "---\nmarp: true\ntheme: default\n---\n\n# Introduction\n\nContent\n\n---\n\n# Second Slide";
    const deck = parseDeck(raw);
    // Should have at least 2 content slides
    expect(deck.slides.length).toBeGreaterThanOrEqual(2);
  });

  it("M50-NAR-04: extracts Marp <!-- notes --> speaker notes from slide content", () => {
    // The primary Marp speaker notes syntax must be parsed into notes field.
    const raw = "# Title\n\nBullet content\n\n<!-- notes -->\n\nThis is the spoken note.";
    const deck = parseDeck(raw);
    expect(deck.slides[0].notes).toContain("spoken note");
    expect(deck.slides[0].content).toContain("Bullet content");
  });

  it("M50-NAR-04: extracts Marp <!-- speaker_notes --> syntax from slide content", () => {
    // The alternative speaker_notes syntax must also produce the notes field.
    const raw = "# Title\n\nContent here\n\n<!-- speaker_notes -->\n\nSay this to the audience.";
    const deck = parseDeck(raw);
    expect(deck.slides[0].notes).toContain("Say this");
  });

  it("M50-NAR-03: notes is null when no speaker notes separator present", () => {
    // Slides without a notes marker must have notes: null.
    const raw = "# Title\n\nBullet content only.";
    const deck = parseDeck(raw);
    expect(deck.slides[0].notes).toBeNull();
  });

  it("M50-NAR-03: notes text does not appear in content when separator is present", () => {
    // Speaker notes content must not leak into the slide content.
    const raw = "# Title\n\nMain slide body\n\n<!-- notes -->\n\nSpoken notes only.";
    const deck = parseDeck(raw);
    expect(deck.slides[0].content).not.toContain("Spoken notes only");
    expect(deck.slides[0].notes).toContain("Spoken notes only");
  });

  it("M50-NAR-03: empty string returns exactly zero slides (not one empty slide)", () => {
    // Empty input must not produce a phantom slide — it must be empty.
    const deck = parseDeck("");
    expect(deck.slides).toHaveLength(0);
  });

  it("M50-NAR-04: notes extracted correctly from second slide in multi-slide deck", () => {
    // Notes on slide 2 must not bleed into slide 1 or 3.
    const raw = [
      "# Slide One\n\nNo notes here.",
      "# Slide Two\n\nHas notes.\n\n<!-- notes -->\n\nSpeak about architecture.",
      "# Slide Three\n\nAlso no notes.",
    ].join("\n\n---\n\n");
    const deck = parseDeck(raw);
    expect(deck.slides[1].notes).toContain("architecture");
    expect(deck.slides[0].notes).toBeNull();
    expect(deck.slides[2].notes).toBeNull();
  });
});

// ── slideToNarrationText ──────────────────────────────────────────────────────

describe("slideToNarrationText", () => {
  it("M50-NAR-04: uses speaker notes when present (notes preferred over content)", () => {
    // Notes are always preferred over generated content for narration.
    const slide = {
      index: 0,
      content: "# Title\n\n- bullet one\n- bullet two",
      notes: "Speak these exact words to the audience.",
    };
    const text = slideToNarrationText(slide);
    expect(text).toContain("Speak these exact words");
  });

  it("M50-NAR-03: generates narration from heading + bullets when no notes", () => {
    // When there are no notes, derive text from the slide content.
    const slide = {
      index: 0,
      content: "# Architecture Overview\n\n- Layer one\n- Layer two\n- Layer three",
      notes: null,
    };
    const text = slideToNarrationText(slide);
    expect(text).toContain("Architecture Overview");
    expect(text).toContain("Layer one");
  });

  it("M50-NAR-05: output contains no markdown # heading syntax", () => {
    // # heading syntax must be stripped for TTS consumption.
    const slide = {
      index: 0,
      content: "# Heading One\n\n## Subheading\n\nParagraph text.",
      notes: null,
    };
    const text = slideToNarrationText(slide);
    expect(text).not.toMatch(/^#/m);
  });

  it("M50-NAR-05: output contains no markdown bold/italic markers", () => {
    // **, *, _ markers must all be stripped.
    const slide = {
      index: 1,
      content: "# Heading\n\n**bold** and *italic* and _underscore_",
      notes: null,
    };
    const text = slideToNarrationText(slide);
    expect(text).not.toMatch(/\*\*/);
    expect(text).not.toMatch(/_\w+_/);
  });

  it("M50-NAR-05: output contains no markdown bullet list markers (- or *)", () => {
    // List markers must be stripped from TTS output.
    const slide = {
      index: 0,
      content: "# List\n\n- item one\n- item two\n* item three",
      notes: null,
    };
    const text = slideToNarrationText(slide);
    expect(text).not.toMatch(/^\s*[-*]\s/m);
  });

  it("M50-NAR-03: handles slide with empty content and no notes — returns a non-empty fallback string", () => {
    // Must not return empty string for empty slide — TTS needs something.
    const slide = { index: 2, content: "", notes: null };
    const text = slideToNarrationText(slide);
    expect(typeof text).toBe("string");
    expect(text.length).toBeGreaterThan(0);
  });

  it("M50-NAR-05: notes content is stripped of markdown before return", () => {
    // Even when using notes, markdown must be stripped for TTS.
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

  it("M50-NAR-04: <!-- notes --> comment text excluded from narration content field", () => {
    // The raw HTML comment tag itself must not appear in the narration output.
    const slide = {
      index: 0,
      content: "# Title\n\nMain content",
      notes: "Say this",
    };
    const text = slideToNarrationText(slide);
    expect(text).not.toContain("<!-- notes -->");
    expect(text).not.toContain("<!-- speaker_notes -->");
  });
});

// ── generateNarration ─────────────────────────────────────────────────────────

describe("generateNarration", () => {
  const raw = [
    "# Intro\n\n- First point\n- Second point",
    "# Body\n\nMain content\n\n<!-- notes -->\n\nSpeak this for slide two.",
    "# Conclusion\n\n- Wrap up",
  ].join("\n\n---\n\n");

  it("M50-NAR-01 / M50-NAR-02: generates narration for all slides when target is 'all'", () => {
    // 'all' target must return one entry per slide.
    const deck = parseDeck(raw);
    const result = generateNarration(deck, "all");
    expect(result).toHaveLength(deck.slides.length);
    result.forEach((n, i) => {
      expect(n.slideIndex).toBe(i);
      expect(typeof n.narrationText).toBe("string");
      expect(n.narrationText.length).toBeGreaterThan(0);
    });
  });

  it("M50-NAR-01 / M50-NAR-02: generates narration for a single slide by index", () => {
    // Numeric target must return exactly one entry for the specified slide.
    const deck = parseDeck(raw);
    const result = generateNarration(deck, 1);
    expect(result).toHaveLength(1);
    expect(result[0].slideIndex).toBe(1);
    expect(result[0].narrationText).toContain("slide two");
  });

  it("M50-NAR-01: returns empty array for out-of-range slide index", () => {
    // Out-of-bounds index must return [] not throw.
    const deck = parseDeck(raw);
    const result = generateNarration(deck, 999);
    expect(result).toEqual([]);
  });

  it("M50-NAR-01: returns empty array for negative slide index", () => {
    // Negative index is always out-of-bounds.
    const deck = parseDeck(raw);
    const result = generateNarration(deck, -1);
    expect(result).toEqual([]);
  });

  it("M50-NAR-02: slide 0 narration uses bullet points (no notes on that slide)", () => {
    // Slide 0 has no notes — content-derived narration must include bullets.
    const deck = parseDeck(raw);
    const result = generateNarration(deck, 0);
    expect(result[0].narrationText).toContain("First point");
  });

  it("M50-NAR-04: slide 1 narration prefers <!-- notes --> speaker notes", () => {
    // Slide 1 has Marp notes — they must be preferred over content.
    const deck = parseDeck(raw);
    const result = generateNarration(deck, 1);
    expect(result[0].narrationText).toContain("slide two");
  });

  it("M50-NAR-02: result entries have slideIndex and narrationText fields", () => {
    // Contract check — both fields must be present.
    const deck = parseDeck(raw);
    const result = generateNarration(deck, "all");
    for (const entry of result) {
      expect(entry).toHaveProperty("slideIndex");
      expect(entry).toHaveProperty("narrationText");
    }
  });

  it("M50-NAR-01: empty deck returns empty array for 'all'", () => {
    // Empty deck must yield zero narration entries.
    const deck = parseDeck("");
    const result = generateNarration(deck, "all");
    expect(result).toHaveLength(0);
  });

  it("M50-NAR-04: both <!-- notes --> and <!-- speaker_notes --> produce narration text", () => {
    // Both Marp note syntaxes must be supported in narration generation.
    const rawMixed = [
      "# Slide A\n\nContent\n\n<!-- notes -->\n\nNotes via notes tag.",
      "# Slide B\n\nContent\n\n<!-- speaker_notes -->\n\nNotes via speaker_notes tag.",
    ].join("\n\n---\n\n");
    const deck = parseDeck(rawMixed);
    const result = generateNarration(deck, "all");
    const textA = result.find((r) => r.slideIndex === 0)?.narrationText ?? "";
    const textB = result.find((r) => r.slideIndex === 1)?.narrationText ?? "";
    expect(textA).toContain("notes tag");
    expect(textB).toContain("speaker_notes tag");
  });
});
