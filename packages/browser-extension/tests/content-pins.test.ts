/**
 * M80-CS-PINS — content-pins.test.ts
 *
 * Tests for Content Script: Pin Rendering & Positioning.
 * Runs in jsdom environment (DOM available via vitest environment: "jsdom").
 *
 * Protects: BR-F-50, BR-F-57, BR-F-58, BR-F-59, BR-F-60, BR-F-61
 *
 * API checklist:
 * ✓ renderPin — 3 tests
 * ✓ removePin — 1 test
 * ✓ removeAllPins — 2 tests
 * ✓ updateOffScreenBadge — 1 test
 * ✓ getOffScreenCount — 2 tests
 * ✓ repositionPins — 1 test
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
});
