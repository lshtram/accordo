/**
 * marp-adapter.test.ts — Tests for MarpAdapter
 *
 * MarpAdapter implements PresentationRuntimeAdapter with Marp-specific behaviour:
 * - No HTTP polling (static HTML, no server)
 * - Local cursor tracking
 * - Webview postMessage relay for slide-change events
 *
 * Requirements covered:
 *   M50-RT-01  MarpAdapter implements PresentationRuntimeAdapter
 *   M50-RT-02  validateDeck: empty → invalid; no --- → invalid; valid → valid
 *   M50-RT-03  listSlides: parses markdown, extracts first # heading, notesPreview
 *   M50-RT-04  goto(index) throws RangeError for out-of-bounds
 *   M50-RT-05  Navigation state tracked locally (no server)
 *   M50-RT-06  onSlideChanged fires when webview reports a slide change
 *   M50-RT-07  Adapter emits slide-change events consumed by state publisher
 *
 * Test state: ALL tests expected to FAIL with "not implemented" until implementation lands.
 */

import { describe, it, expect, vi } from "vitest";
import { MarpAdapter } from "../marp-adapter.js";
import type { ParsedDeck } from "../types.js";

// ── Test helpers ───────────────────────────────────────────────────────────────

function makeDeck(overrides?: Partial<ParsedDeck>): ParsedDeck {
  return {
    raw: "# Slide One\n\nFirst content\n\n---\n\n# Slide Two\n\nSecond content\n\n<!-- notes -->Speak this.\n\n---\n\n# Slide Three",
    slides: [
      { index: 0, content: "# Slide One\n\nFirst content", notes: null },
      { index: 1, content: "# Slide Two\n\nSecond content", notes: "Speak this." },
      { index: 2, content: "# Slide Three", notes: null },
    ],
    ...overrides,
  };
}

function makeAdapter(deck?: ParsedDeck): MarpAdapter {
  // MarpAdapter takes raw markdown string.
  // When a custom deck is provided, join slide contents with --- separators.
  if (deck) {
    const raw = deck.slides.map((s) => s.content).join("\n\n---\n\n");
    return new MarpAdapter(raw);
  }
  return new MarpAdapter(makeDeck().raw);
}

// ── validateDeck ───────────────────────────────────────────────────────────────

describe("MarpAdapter.validateDeck", () => {
  it("M50-RT-02: empty string is invalid", () => {
    // Protects against opening empty files accidentally.
    const adapter = makeAdapter();
    const result = adapter.validateDeck("/deck.md", "");
    expect(result.valid).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("M50-RT-02: whitespace-only content is invalid", () => {
    // Whitespace-only files are equivalent to empty — must reject.
    const adapter = makeAdapter();
    const result = adapter.validateDeck("/deck.md", "   \n\n  ");
    expect(result.valid).toBe(false);
  });

  it("M50-RT-02: content without --- separator is invalid (Marp requires slide separators)", () => {
    // Marp decks must contain at least one --- separator to be valid.
    const adapter = makeAdapter();
    const result = adapter.validateDeck("/deck.md", "# My Single Slide\n\nSome content");
    expect(result.valid).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("M50-RT-02: content with --- separator is valid", () => {
    // The minimal valid deck: two slides separated by ---.
    const adapter = makeAdapter();
    const result = adapter.validateDeck("/deck.md", "# Slide 1\n\n---\n\n# Slide 2");
    expect(result.valid).toBe(true);
  });

  it("M50-RT-02: valid deck has no error field", () => {
    // When valid, the error field must be absent (undefined), not empty string.
    const adapter = makeAdapter();
    const result = adapter.validateDeck("/deck.md", "# Slide 1\n\n---\n\n# Slide 2");
    expect(result.error).toBeUndefined();
  });

  it("M50-RT-02: marp frontmatter with --- separators is valid", () => {
    // Standard Marp deck with frontmatter + content slides.
    const adapter = makeAdapter();
    const result = adapter.validateDeck(
      "/deck.md",
      "---\nmarp: true\n---\n\n# Slide 1\n\n---\n\n# Slide 2",
    );
    expect(result.valid).toBe(true);
  });
});

// ── listSlides ─────────────────────────────────────────────────────────────────

describe("MarpAdapter.listSlides", () => {
  it("M50-RT-03: returns SlideSummary for each slide in the deck", async () => {
    // Core contract — one SlideSummary per parsed slide.
    const adapter = makeAdapter();
    const slides = await adapter.listSlides();
    expect(slides).toHaveLength(3);
  });

  it("M50-RT-03: indices are 0-based and ordered", async () => {
    // Slide indices must be sequential from 0.
    const adapter = makeAdapter();
    const slides = await adapter.listSlides();
    expect(slides.map((s) => s.index)).toEqual([0, 1, 2]);
  });

  it("M50-RT-03: title extracted from first # heading", async () => {
    // The first level-1 heading in each slide becomes the title.
    const adapter = makeAdapter();
    const slides = await adapter.listSlides();
    expect(slides[0].title).toBe("Slide One");
    expect(slides[1].title).toBe("Slide Two");
  });

  it("M50-RT-03: title falls back to 'Slide {n}' when no heading present", async () => {
    // When a slide has no # heading, use a numeric fallback label.
    const deck = makeDeck({
      slides: [{ index: 0, content: "Just plain text, no heading", notes: null }],
    });
    const adapter = makeAdapter(deck);
    const slides = await adapter.listSlides();
    expect(slides[0].title).toMatch(/slide 1/i);
  });

  it("M50-RT-03: notesPreview is included when notes exist", async () => {
    // Slides that have speaker notes must expose a notesPreview.
    const adapter = makeAdapter();
    const slides = await adapter.listSlides();
    expect(slides[1].notesPreview).toBeTruthy();
  });

  it("M50-RT-03: notesPreview is absent when no notes", async () => {
    // Slides without notes must not have the notesPreview field.
    const adapter = makeAdapter();
    const slides = await adapter.listSlides();
    expect(slides[0].notesPreview).toBeUndefined();
  });
});

// ── getCurrent ─────────────────────────────────────────────────────────────────

describe("MarpAdapter.getCurrent", () => {
  it("M50-RT-05: returns index 0 and matching title on construction", async () => {
    // Adapter starts at slide 0 (local cursor, no server poll needed).
    const adapter = makeAdapter();
    const current = await adapter.getCurrent();
    expect(current.index).toBe(0);
    expect(typeof current.title).toBe("string");
  });

  it("M50-RT-05: returns updated index after goto()", async () => {
    // Local cursor must reflect what goto() set — no HTTP needed.
    const adapter = makeAdapter();
    await adapter.goto(2);
    const current = await adapter.getCurrent();
    expect(current.index).toBe(2);
  });

  it("M50-RT-05: title returned by getCurrent matches listSlides title for same index", async () => {
    // Consistency check between getCurrent and listSlides.
    const adapter = makeAdapter();
    await adapter.goto(1);
    const current = await adapter.getCurrent();
    const slides = await adapter.listSlides();
    expect(current.title).toBe(slides[1].title);
  });
});

// ── goto / next / prev ────────────────────────────────────────────────────────

describe("MarpAdapter navigation", () => {
  it("M50-RT-04 / M50-RT-05: goto(0) succeeds — first slide", async () => {
    // Navigating to the first slide must succeed without error.
    const adapter = makeAdapter();
    await expect(adapter.goto(0)).resolves.toBeUndefined();
  });

  it("M50-RT-04 / M50-RT-05: goto(2) succeeds — last slide in 3-slide deck", async () => {
    // Navigating to the last slide must succeed without error.
    const adapter = makeAdapter();
    await expect(adapter.goto(2)).resolves.toBeUndefined();
  });

  it("M50-RT-04: goto(-1) throws RangeError", async () => {
    // Negative indices are always out-of-bounds.
    const adapter = makeAdapter();
    await expect(adapter.goto(-1)).rejects.toThrow(RangeError);
  });

  it("M50-RT-04: goto(3) throws RangeError in a 3-slide deck", async () => {
    // Index equal to slideCount is out-of-bounds (0-based).
    const adapter = makeAdapter();
    await expect(adapter.goto(3)).rejects.toThrow(RangeError);
  });

  it("M50-RT-04: goto(99) throws RangeError", async () => {
    // Large out-of-bounds index must also throw RangeError.
    const adapter = makeAdapter();
    await expect(adapter.goto(99)).rejects.toThrow(RangeError);
  });

  it("M50-RT-05: next() advances current slide by one", async () => {
    // next() increments the local cursor by one.
    const adapter = makeAdapter();
    await adapter.goto(0);
    await adapter.next();
    const current = await adapter.getCurrent();
    expect(current.index).toBe(1);
  });

  it("M50-RT-05: next() on last slide is a no-op (clamps at boundary)", async () => {
    // next() must not advance past the last slide.
    const adapter = makeAdapter();
    await adapter.goto(2);
    await adapter.next();
    const current = await adapter.getCurrent();
    expect(current.index).toBe(2);
  });

  it("M50-RT-05: prev() goes back one slide", async () => {
    // prev() decrements the local cursor by one.
    const adapter = makeAdapter();
    await adapter.goto(2);
    await adapter.prev();
    const current = await adapter.getCurrent();
    expect(current.index).toBe(1);
  });

  it("M50-RT-05: prev() on first slide is a no-op (clamps at boundary)", async () => {
    // prev() must not go before the first slide.
    const adapter = makeAdapter();
    await adapter.goto(0);
    await adapter.prev();
    const current = await adapter.getCurrent();
    expect(current.index).toBe(0);
  });
});

// ── onSlideChanged ────────────────────────────────────────────────────────────

describe("MarpAdapter.onSlideChanged", () => {
  it("M50-RT-06 / M50-RT-07: registers a listener and returns a disposable", () => {
    // The returned subscription must have a dispose() method.
    const adapter = makeAdapter();
    const listener = vi.fn();
    const sub = adapter.onSlideChanged(listener);
    expect(sub).toHaveProperty("dispose");
    expect(typeof sub.dispose).toBe("function");
    adapter.dispose();
  });

  it("M50-RT-07: listener is called when slide changes after goto()", async () => {
    // goto() must emit a slide-change event to all registered listeners.
    const adapter = makeAdapter();
    const listener = vi.fn();
    adapter.onSlideChanged(listener);
    await adapter.goto(2);
    expect(listener).toHaveBeenCalledWith(2);
    adapter.dispose();
  });

  it("M50-RT-07: listener is called with correct index after next()", async () => {
    // next() must also emit the slide-change event.
    const adapter = makeAdapter();
    const listener = vi.fn();
    adapter.onSlideChanged(listener);
    await adapter.goto(0);
    listener.mockClear();
    await adapter.next();
    expect(listener).toHaveBeenCalledWith(1);
    adapter.dispose();
  });

  it("M50-RT-07: listener is called with correct index after prev()", async () => {
    // prev() must also emit the slide-change event.
    const adapter = makeAdapter();
    const listener = vi.fn();
    adapter.onSlideChanged(listener);
    await adapter.goto(2);
    listener.mockClear();
    await adapter.prev();
    expect(listener).toHaveBeenCalledWith(1);
    adapter.dispose();
  });

  it("M50-RT-06: dispose() on subscription removes the listener", async () => {
    // Disposing the subscription must prevent future listener calls.
    const adapter = makeAdapter();
    const listener = vi.fn();
    const sub = adapter.onSlideChanged(listener);
    sub.dispose();
    await adapter.goto(1);
    expect(listener).not.toHaveBeenCalled();
    adapter.dispose();
  });

  it("M50-RT-06: multiple listeners can be registered independently", async () => {
    // Multiple subscribers must all receive the same event.
    const adapter = makeAdapter();
    const listenerA = vi.fn();
    const listenerB = vi.fn();
    adapter.onSlideChanged(listenerA);
    adapter.onSlideChanged(listenerB);
    await adapter.goto(1);
    expect(listenerA).toHaveBeenCalledWith(1);
    expect(listenerB).toHaveBeenCalledWith(1);
    adapter.dispose();
  });
});

// ── handleWebviewSlideChanged ─────────────────────────────────────────────────

describe("MarpAdapter.handleWebviewSlideChanged", () => {
  it("M50-RT-06: updates local cursor when webview reports a slide change", async () => {
    // When the webview posts presentation:slideChanged, the adapter updates cursor.
    const adapter = makeAdapter();
    adapter.handleWebviewSlideChanged(2);
    const current = await adapter.getCurrent();
    expect(current.index).toBe(2);
  });

  it("M50-RT-06: fires registered listeners when webview reports a change", () => {
    // Webview-initiated changes must also notify subscribers.
    const adapter = makeAdapter();
    const listener = vi.fn();
    adapter.onSlideChanged(listener);
    adapter.handleWebviewSlideChanged(1);
    expect(listener).toHaveBeenCalledWith(1);
  });

  it("M50-RT-06: ignores webview-reported index if out-of-bounds (no throw, no update)", () => {
    // Protect against malformed webview messages with invalid indices.
    const adapter = makeAdapter();
    // Should not throw for out-of-bounds webview message
    expect(() => adapter.handleWebviewSlideChanged(999)).not.toThrow();
  });
});

// ── dispose ───────────────────────────────────────────────────────────────────

describe("MarpAdapter.dispose", () => {
  it("M50-RT-01: dispose() does not throw", () => {
    // Disposal must always succeed regardless of state.
    const adapter = makeAdapter();
    expect(() => adapter.dispose()).not.toThrow();
  });

  it("M50-RT-07: after dispose(), listeners are cleared", async () => {
    // Listeners registered before dispose must not be called after.
    const adapter = makeAdapter();
    const listener = vi.fn();
    adapter.onSlideChanged(listener);
    adapter.dispose();
    // post-dispose goto may throw — that's acceptable; what matters is listener silence
    await adapter.goto(1).catch(() => {
      /* acceptable */
    });
    expect(listener).not.toHaveBeenCalled();
  });
});
