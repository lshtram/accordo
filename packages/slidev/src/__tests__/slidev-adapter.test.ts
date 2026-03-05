/**
 * slidev-adapter.test.ts — Tests for SlidevAdapter
 *
 * Requirements covered:
 *   M44-RT-02  SlidevAdapter implements PresentationRuntimeAdapter
 *   M44-RT-03  Returns RangeError for invalid slide indices
 *   M44-RT-04  Emits onSlideChanged events
 *   M44-RT-05  Validates deck content (non-empty, has --- separator)
 *   M44-RT-06  getCurrent polls GET /json endpoint
 *   M44-TL-04  listSlides returns ordered SlideSummary[]
 *   M44-TL-06  goto moves to exact slide index
 *   M44-TL-07  next advances one slide
 *   M44-TL-08  prev goes back one slide
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SlidevAdapter } from "../slidev-adapter.js";
import type { ParsedDeck } from "../types.js";

// ── Test helpers ──────────────────────────────────────────────────────────────

function makeDeck(overrides?: Partial<ParsedDeck>): ParsedDeck {
  return {
    raw: "# Slide One\n\n---\n\n# Slide Two\n\n---\n\n# Slide Three",
    slides: [
      { index: 0, content: "# Slide One\n\nFirst content", notes: null },
      { index: 1, content: "# Slide Two\n\nSecond content", notes: "Speak this." },
      { index: 2, content: "# Slide Three", notes: null },
    ],
    ...overrides,
  };
}

function makeAdapter(deck?: ParsedDeck, port = 7788): SlidevAdapter {
  return new SlidevAdapter({ port, deck: deck ?? makeDeck(), pollIntervalMs: 50 });
}

// ── validateDeck ──────────────────────────────────────────────────────────────

describe("SlidevAdapter.validateDeck", () => {
  it("M44-RT-05: empty string is invalid", () => {
    const adapter = makeAdapter();
    const result = adapter.validateDeck("/deck.md", "");
    expect(result.valid).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("M44-RT-05: whitespace-only content is invalid", () => {
    const adapter = makeAdapter();
    const result = adapter.validateDeck("/deck.md", "   \n\n  ");
    expect(result.valid).toBe(false);
  });

  it("M44-RT-05: content without --- separator is treated as a single slide (still valid)", () => {
    const adapter = makeAdapter();
    const result = adapter.validateDeck("/deck.md", "# My Single Slide\n\nSome content");
    expect(result.valid).toBe(true);
  });

  it("M44-RT-05: content with --- separator is valid", () => {
    const adapter = makeAdapter();
    const result = adapter.validateDeck("/deck.md", "# Slide 1\n\n---\n\n# Slide 2");
    expect(result.valid).toBe(true);
  });

  it("M44-RT-05: valid deck has no error field", () => {
    const adapter = makeAdapter();
    const result = adapter.validateDeck("/deck.md", "# My Slide\n\nContent");
    expect(result.error).toBeUndefined();
  });
});

// ── listSlides ────────────────────────────────────────────────────────────────

describe("SlidevAdapter.listSlides", () => {
  it("M44-TL-04: returns SlideSummary for each slide", async () => {
    const adapter = makeAdapter();
    const slides = await adapter.listSlides();
    expect(slides).toHaveLength(3);
  });

  it("M44-TL-04: index is 0-based and ordered", async () => {
    const adapter = makeAdapter();
    const slides = await adapter.listSlides();
    expect(slides.map((s) => s.index)).toEqual([0, 1, 2]);
  });

  it("M44-TL-04: title extracted from first # heading", async () => {
    const adapter = makeAdapter();
    const slides = await adapter.listSlides();
    expect(slides[0].title).toBe("Slide One");
    expect(slides[1].title).toBe("Slide Two");
  });

  it("M44-TL-04: title falls back to 'Slide {n}' when no heading", async () => {
    const deck = makeDeck({
      slides: [
        { index: 0, content: "Just plain text, no heading", notes: null },
      ],
    });
    const adapter = makeAdapter(deck);
    const slides = await adapter.listSlides();
    expect(slides[0].title).toMatch(/slide 1/i);
  });

  it("M44-TL-04: notesPreview is included when notes exist", async () => {
    const adapter = makeAdapter();
    const slides = await adapter.listSlides();
    expect(slides[1].notesPreview).toBeTruthy();
  });

  it("M44-TL-04: notesPreview is absent when no notes", async () => {
    const adapter = makeAdapter();
    const slides = await adapter.listSlides();
    expect(slides[0].notesPreview).toBeUndefined();
  });
});

// ── goto / next / prev ────────────────────────────────────────────────────────

describe("SlidevAdapter navigation", () => {
  it("M44-TL-06 / M44-RT-03: goto(0) succeeds — first slide", async () => {
    const adapter = makeAdapter();
    await expect(adapter.goto(0)).resolves.toBeUndefined();
  });

  it("M44-TL-06 / M44-RT-03: goto(2) succeeds — last slide in 3-slide deck", async () => {
    const adapter = makeAdapter();
    await expect(adapter.goto(2)).resolves.toBeUndefined();
  });

  it("M44-RT-03: goto(-1) throws RangeError", async () => {
    const adapter = makeAdapter();
    await expect(adapter.goto(-1)).rejects.toThrow(RangeError);
  });

  it("M44-RT-03: goto(3) throws RangeError in a 3-slide deck", async () => {
    const adapter = makeAdapter();
    await expect(adapter.goto(3)).rejects.toThrow(RangeError);
  });

  it("M44-TL-07: next() advances current slide by one", async () => {
    const adapter = makeAdapter();
    await adapter.goto(0);
    await adapter.next();
    const current = await adapter.getCurrent();
    expect(current.index).toBe(1);
  });

  it("M44-TL-07: next() on last slide is a no-op", async () => {
    const adapter = makeAdapter();
    await adapter.goto(2);
    await adapter.next();
    const current = await adapter.getCurrent();
    expect(current.index).toBe(2);
  });

  it("M44-TL-08: prev() goes back one slide", async () => {
    const adapter = makeAdapter();
    await adapter.goto(2);
    await adapter.prev();
    const current = await adapter.getCurrent();
    expect(current.index).toBe(1);
  });

  it("M44-TL-08: prev() on first slide is a no-op", async () => {
    const adapter = makeAdapter();
    await adapter.goto(0);
    await adapter.prev();
    const current = await adapter.getCurrent();
    expect(current.index).toBe(0);
  });
});

// ── getCurrent ────────────────────────────────────────────────────────────────

describe("SlidevAdapter.getCurrent", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("M44-RT-06 / M44-TL-05: polls GET /json and returns index and title", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ cursor: 1, total: 3 }),
    } as Response);
    const adapter = makeAdapter();
    await adapter.goto(0); // set slides first
    const result = await adapter.getCurrent();
    expect(result.index).toBe(1);
    expect(typeof result.title).toBe("string");
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/json"));
  });

  it("M44-RT-06: falls back to internal cursor when /json fetch fails", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const adapter = makeAdapter();
    await adapter.goto(1);
    const result = await adapter.getCurrent();
    // Should return the internal cursor position (1) without throwing
    expect(result.index).toBe(1);
  });

  it("M44-RT-06: uses port from constructor options in the fetch URL", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ cursor: 0, total: 3 }),
    } as Response);
    const adapter = makeAdapter(makeDeck(), 7900);
    await adapter.getCurrent();
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("7900"));
  });
});

// ── onSlideChanged ────────────────────────────────────────────────────────────

describe("SlidevAdapter.onSlideChanged", () => {
  it("M44-RT-04: registers a listener and returns a disposable", () => {
    const adapter = makeAdapter();
    const listener = vi.fn();
    const sub = adapter.onSlideChanged(listener);
    expect(sub).toHaveProperty("dispose");
    expect(typeof sub.dispose).toBe("function");
    adapter.dispose();
  });

  it("M44-RT-04: listener is called when slide changes after goto()", async () => {
    const adapter = makeAdapter();
    const listener = vi.fn();
    adapter.onSlideChanged(listener);
    await adapter.goto(2);
    expect(listener).toHaveBeenCalledWith(2);
    adapter.dispose();
  });

  it("M44-RT-04: dispose() on subscription removes the listener", async () => {
    const adapter = makeAdapter();
    const listener = vi.fn();
    const sub = adapter.onSlideChanged(listener);
    sub.dispose();
    await adapter.goto(1);
    expect(listener).not.toHaveBeenCalled();
    adapter.dispose();
  });
});

// ── dispose ───────────────────────────────────────────────────────────────────

describe("SlidevAdapter.dispose", () => {
  it("M44-RT-04: dispose clears the polling timer without throwing", async () => {
    const adapter = makeAdapter();
    expect(() => adapter.dispose()).not.toThrow();
  });

  it("M44-RT-04: after dispose, onSlideChanged listeners are cleared", async () => {
    const adapter = makeAdapter();
    const listener = vi.fn();
    adapter.onSlideChanged(listener);
    adapter.dispose();
    // A goto after dispose should not call listeners (no active subscription)
    await adapter.goto(1).catch(() => { /* may throw post-dispose — acceptable */ });
    expect(listener).not.toHaveBeenCalled();
  });
});
