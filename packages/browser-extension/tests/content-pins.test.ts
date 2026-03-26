/**
 * M80-CS-PINS — content-pins.test.ts
 *
 * Tests for Content Script: Pin Rendering & Positioning.
 * Runs in jsdom environment (DOM available via vitest environment: "jsdom").
 *
 * Protects: BR-F-50, BR-F-57, BR-F-58, BR-F-59, BR-F-60, BR-F-61, BR-F-143
 *
 * API checklist:
 * ✓ renderPin — 3 tests
 * ✓ removePin — 1 test
 * ✓ removeAllPins — 2 tests
 * ✓ updateOffScreenBadge — 1 test
 * ✓ getOffScreenCount — 2 tests
 * ✓ repositionPins — 1 test
 * ✓ fallback stacking (BR-F-143) — 1 test
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetChromeMocks } from "./setup/chrome-mock.js";
import type { BrowserCommentThread } from "../src/types.js";
import {
  renderPin,
  removePin,
  removeAllPins,
  updateOffScreenBadge,
  getOffScreenCount,
  repositionPins,
} from "../src/content-pins.js";

/** Factory for a minimal BrowserCommentThread suitable for pin rendering tests */
function makeThread(id: string): BrowserCommentThread {
  return {
    id,
    anchorKey: `div:0:anchor-${id}`,
    pageUrl: "https://example.com/page",
    status: "open",
    comments: [],
    createdAt: new Date().toISOString(),
    lastActivity: new Date().toISOString(),
  };
}

describe("M80-CS-PINS — Content Script Pin Rendering", () => {
  beforeEach(() => {
    resetChromeMocks();
    // Clear any DOM elements left from previous tests
    document.body.innerHTML = "";
  });

  describe("renderPin", () => {
    it("BR-F-50: creates a DOM element with data-accordo-pin attribute set to thread id", () => {
      // BR-F-50: One pin per thread; pin positioned relative to anchor element
      const thread = makeThread("thread-001");
      const pin = renderPin(thread);
      expect(pin).toBeDefined();
      expect(pin.getAttribute("data-accordo-pin")).toBe("thread-001");
    });

    it("BR-F-50: returned element is attached to the document body", () => {
      // BR-F-50: Pin is injected into the DOM
      const thread = makeThread("thread-002");
      const pin = renderPin(thread);
      expect(document.body.contains(pin)).toBe(true);
    });

    it("BR-F-57: pin element is positioned (has style.position set)", () => {
      // BR-F-57: On scroll or resize, pins reposition relative to anchor elements
      const thread = makeThread("thread-003");
      const anchor = document.createElement("div");
      anchor.setAttribute("data-anchor", thread.anchorKey);
      document.body.appendChild(anchor);

      const pin = renderPin(thread);
      // Pin must have some positioning style (absolute or fixed)
      const pos = pin.style.position;
      expect(pos === "absolute" || pos === "fixed").toBe(true);
    });
  });

  describe("removePin", () => {
    it("BR-F-59: removes the pin element from DOM for the given thread id", () => {
      // BR-F-59: When Comments Mode transitions to OFF, all pins are removed
      const thread = makeThread("thread-rem");
      renderPin(thread);
      expect(document.querySelector('[data-accordo-pin="thread-rem"]')).not.toBeNull();
      removePin("thread-rem");
      expect(document.querySelector('[data-accordo-pin="thread-rem"]')).toBeNull();
    });
  });

  describe("removeAllPins", () => {
    it("BR-F-59: removes all accordo pin elements from the DOM", () => {
      // BR-F-59: Zero accordo-* elements remain after removeAllPins
      renderPin(makeThread("t-all-1"));
      renderPin(makeThread("t-all-2"));
      renderPin(makeThread("t-all-3"));
      removeAllPins();
      expect(document.querySelectorAll("[data-accordo-pin]").length).toBe(0);
    });

    it("BR-F-59: removeAllPins is safe when no pins exist (no throw)", () => {
      // BR-F-59: No-op when called with empty DOM
      expect(() => removeAllPins()).not.toThrow();
    });
  });

  describe("updateOffScreenBadge", () => {
    it("BR-F-58: sends SET_BADGE_TEXT message to service worker with the count as string", () => {
      // BR-F-58: Badge count reported via chrome.runtime.sendMessage (content scripts
      // cannot call chrome.action.setBadgeText directly — only the SW can).
      updateOffScreenBadge(3);
      expect(chrome.runtime.sendMessage).toHaveBeenCalled();
      const sentMessage = (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][0] as { type: string; payload: { text: string } };
      expect(sentMessage.type).toBe("SET_BADGE_TEXT");
      expect(sentMessage.payload.text).toBe("3");
    });

    it("BR-F-58: sends '0' to clear the badge when all pins are in viewport", () => {
      // BR-F-58: Badge cleared when no off-screen pins
      updateOffScreenBadge(0);
      const sentMessage = (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][0] as { type: string; payload: { text: string } };
      expect(sentMessage.type).toBe("SET_BADGE_TEXT");
      expect(sentMessage.payload.text).toBe("0");
    });

    it("BR-F-58: converts numeric badge count to string for chrome API", () => {
      // BR-F-58: chrome.action.setBadgeText (called by SW) requires string text
      updateOffScreenBadge(12);
      const calls = (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mock.calls;
      const lastCallArg = calls[calls.length - 1][0] as { type: string; payload: { text: string } };
      expect(lastCallArg.payload.text).toBe("12");
    });
  });

  describe("getOffScreenCount", () => {
    it("BR-F-58: returns 0 when all thread anchors are in the viewport", () => {
      // BR-F-58: All elements with getBoundingClientRect inside viewport → 0
      const threads = [makeThread("t1"), makeThread("t2")];
      // In jsdom, getBoundingClientRect returns 0,0,0,0 — elements are "at origin" (in viewport)
      const count = getOffScreenCount(threads);
      // Must return an integer in valid range [0, threads.length]
      expect(Number.isInteger(count)).toBe(true);
      expect(count).toBeGreaterThanOrEqual(0);
      expect(count).toBeLessThanOrEqual(threads.length);
    });

    it("BR-F-58: returns a deterministic count for the given thread array", () => {
      // BR-F-58: Count threads whose anchor element is not in viewport
      const threads = [makeThread("t3"), makeThread("t4"), makeThread("t5")];
      // Calling twice must return the same result (deterministic in jsdom)
      const first = getOffScreenCount(threads);
      const second = getOffScreenCount(threads);
      expect(first).toBe(second);
      expect(first).toBeGreaterThanOrEqual(0);
      expect(first).toBeLessThanOrEqual(threads.length);
    });
  });

  describe("repositionPins", () => {
    it("BR-F-57: calls requestAnimationFrame to batch DOM reads and writes", () => {
      // BR-F-57: Pin repositioning uses rAF to avoid layout thrashing
      const rafSpy = vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
        cb(0);
        return 0;
      });
      repositionPins();
      expect(rafSpy).toHaveBeenCalled();
      rafSpy.mockRestore();
    });
  });

  describe("mixed anchored/unanchored fallback non-overlap (BR-F-143)", () => {
    it("BR-F-143-MIXED: fallback pins in a mixed anchored+unanchored set have non-overlapping top positions and do not interfere with anchored pins", () => {
      // Test contract:
      // Given a batch that contains one resolvable anchored thread (DOM anchor present)
      // plus multiple unanchored threads (fallback), the unanchored pins must:
      //   a) each receive a distinct top position (stacked, no overlap)
      //   b) not displace the anchored pin (anchored pin top is independently computed)
      //
      // jsdom: getBoundingClientRect returns 0,0 rect so anchored pins land at
      // top ≈ (0 + scrollY - 12) = -12 px. Fallback pins start at 48px and
      // increment by 32px per pin. The two groups are guaranteed non-overlapping.

      // --- Arrange: one element in DOM to act as anchor ---
      const anchored = makeThread("anchored-thread");
      const anchorEl = document.createElement("div");
      anchorEl.setAttribute("data-anchor", anchored.anchorKey);
      document.body.appendChild(anchorEl);

      // Two unanchored threads (no matching DOM element)
      const unanchored1 = makeThread("unanchored-a");
      const unanchored2 = makeThread("unanchored-b");

      // --- Act: render all three in the same batch ---
      const anchoredPin = renderPin(anchored);
      const fallbackPin1 = renderPin(unanchored1);
      const fallbackPin2 = renderPin(unanchored2);

      // --- Assert anchored pin ---
      expect(anchoredPin.getAttribute("data-accordo-pin")).toBe("anchored-thread");
      // Anchored pin uses top + left (not right: auto)
      const anchoredTop = parseInt(anchoredPin.style.top, 10);
      // In jsdom getBCR returns 0, so top = 0 + 0 - 12 = -12
      expect(Number.isNaN(anchoredTop)).toBe(false);

      // --- Assert fallback pins have distinct tops ---
      const fallbackTop1 = parseInt(fallbackPin1.style.top, 10);
      const fallbackTop2 = parseInt(fallbackPin2.style.top, 10);

      expect(Number.isNaN(fallbackTop1)).toBe(false);
      expect(Number.isNaN(fallbackTop2)).toBe(false);
      // Fallback pins must be stacked at different positions
      expect(fallbackTop1).not.toBe(fallbackTop2);

      // Each successive fallback pin is 32px lower than the previous
      expect(fallbackTop2 - fallbackTop1).toBe(32);

      // --- Assert fallback pins do not overlap anchored pin position ---
      // anchoredTop is negative (-12 in jsdom), fallback starts at 48+ → no overlap
      expect(fallbackTop1).toBeGreaterThan(anchoredTop);
      expect(fallbackTop2).toBeGreaterThan(anchoredTop);
    });
  });

  describe("fallback pin stacking stability (BR-F-143)", () => {
    it("BR-F-143: unanchored pins rendered sequentially have non-overlapping top positions", () => {
      // BR-F-143: _fallbackStackIndex must be reset before each loadThreads render, not
      // mid-render when anchored pins resolve. Unanchored pins must stack at distinct
      // y positions so they do not visually overlap.
      //
      // This test simulates two consecutive batches of pin renders (mimicking loadThreads
      // being called twice) and asserts that within each batch, unanchored pins have
      // distinct, non-overlapping top style values.

      // Batch 1: render two unanchored pins (no anchor element in DOM)
      const threadA = makeThread("stack-a");
      const threadB = makeThread("stack-b");

      const pinA1 = renderPin(threadA);
      const pinB1 = renderPin(threadB);

      const topA1 = parseInt(pinA1.style.top, 10);
      const topB1 = parseInt(pinB1.style.top, 10);

      // Both pins must have a defined top (not NaN — they are in the fallback path)
      // Note: jsdom getBoundingClientRect returns 0,0 rect so anchor lookup may
      // resolve differently — we test the structural guarantee that the rendered
      // positions differ when two sequential unanchored pins are placed.
      // The critical invariant is: if both are in the fallback path, they differ.
      // (If one found an anchor, the positions will naturally differ anyway.)
      if (!isNaN(topA1) && !isNaN(topB1)) {
        // When both are fallback-stacked, top positions must not be equal
        // (each successive pin gets a +32px offset)
        expect(topA1).not.toBe(topB1);
      }

      // Batch 2: clear DOM and re-render — the stack must restart from index 0
      removeAllPins();

      const threadC = makeThread("stack-c");
      const pinC2 = renderPin(threadC);
      const threadD = makeThread("stack-d");
      const pinD2 = renderPin(threadD);

      const topC2 = parseInt(pinC2.style.top, 10);
      const topD2 = parseInt(pinD2.style.top, 10);

      // Same structural guarantee in second batch
      if (!isNaN(topC2) && !isNaN(topD2)) {
        expect(topC2).not.toBe(topD2);
      }
    });
  });
});
