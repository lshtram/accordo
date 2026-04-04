/**
 * element-actionability.test.ts
 *
 * Tests for GAP-F1 — Actionability + eventability fields on ElementDetail
 *
 * Tests validate:
 * - F2-ACTION-001: ElementDetail includes states when element has states
 * - F2-ACTION-001: ElementDetail omits states when none apply
 * - F4-EVENT-001: hasPointerEvents is true when pointerEvents is not 'none'
 * - F4-EVENT-001: hasPointerEvents is false when pointerEvents is 'none'
 * - F4-EVENT-002: isObstructed is false when element is topmost at its center point
 * - F4-EVENT-002: isObstructed is true when another element is on top
 * - F4-EVENT-003: clickTargetSize returns bounding box dimensions
 *
 * API checklist (buildDetail → ElementDetail):
 * - states?: string[] (GAP-F1 / MCP-A11Y-002)
 * - hasPointerEvents?: boolean (GAP-F1 / MCP-INT-001)
 * - isObstructed?: boolean (GAP-F1 / MCP-INT-001)
 * - clickTargetSize?: { width: number; height: number } (GAP-F1 / MCP-INT-001)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { inspectElement } from "../src/content/element-inspector.js";
import type { ElementDetail } from "../src/content/element-inspector.js";

// ── Test fixtures ──────────────────────────────────────────────────────────────

function makeElementWithRect(
  id: string,
  rect: { x: number; y: number; width: number; height: number },
): HTMLElement {
  const el = document.createElement("div");
  el.id = id;
  document.body.appendChild(el);

  // Mock getBoundingClientRect
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    top: rect.y,
    right: rect.x + rect.width,
    bottom: rect.y + rect.height,
    left: rect.x,
    toJSON: () => ({}),
  } as DOMRect);

  return el;
}

// ── ElementDetail actionability fields ────────────────────────────────────────

describe("ElementDetail actionability fields", () => {
  describe("states field", () => {
    it("F2-ACTION-001: ElementDetail includes states when element has states", async () => {
      // Create an input element with disabled=true
      const input = document.createElement("input") as HTMLInputElement;
      input.id = "disabled-input";
      input.disabled = true;
      document.body.appendChild(input);

      try {
        const result = inspectElement({ selector: "#disabled-input" });
        expect(result.found).toBe(true);
        expect(result.element).toBeDefined();
        expect(result.element?.states).toBeDefined();
        expect(result.element?.states?.length).toBeGreaterThan(0);
        expect(result.element?.states).toContain("disabled");
      } finally {
        document.body.removeChild(input);
      }
    });

    it("F2-ACTION-001: ElementDetail omits states when none apply", async () => {
      // Create a plain div with no states
      const div = document.createElement("div");
      div.id = "plain-action-div";
      document.body.appendChild(div);

      try {
        const result = inspectElement({ selector: "#plain-action-div" });
        expect(result.found).toBe(true);
        expect(result.element).toBeDefined();
        // states should be absent (not empty array)
        expect("states" in result.element!).toBe(false);
      } finally {
        document.body.removeChild(div);
      }
    });
  });

  describe("hasPointerEvents", () => {
    it("F4-EVENT-001: returns true when pointerEvents is not 'none'", async () => {
      const el = makeElementWithRect("pointer-auto", { x: 0, y: 0, width: 100, height: 50 });

      // Mock getComputedStyle to return pointer-events: auto
      vi.spyOn(window, "getComputedStyle").mockReturnValue({
        pointerEvents: "auto",
      } as CSSStyleDeclaration);

      try {
        const result = inspectElement({ selector: "#pointer-auto" });
        expect(result.found).toBe(true);
        expect(result.element?.hasPointerEvents).toBe(true);
      } finally {
        document.body.removeChild(el);
      }
    });

    it("F4-EVENT-001: returns false when pointerEvents is 'none'", async () => {
      const el = makeElementWithRect("pointer-none", { x: 0, y: 0, width: 100, height: 50 });

      // Mock getComputedStyle to return pointer-events: none
      vi.spyOn(window, "getComputedStyle").mockReturnValue({
        pointerEvents: "none",
      } as CSSStyleDeclaration);

      try {
        const result = inspectElement({ selector: "#pointer-none" });
        expect(result.found).toBe(true);
        expect(result.element?.hasPointerEvents).toBe(false);
      } finally {
        document.body.removeChild(el);
      }
    });
  });

  describe("isObstructed", () => {
    beforeEach(() => {
      // Skip tests if elementFromPoint is not available (jsdom limitation)
      if (typeof document.elementFromPoint !== "function") {
        return;
      }
    });

    it("F4-EVENT-002: returns false when element is topmost at its center point", async () => {
      // Skip if elementFromPoint is not available (jsdom limitation)
      if (typeof document.elementFromPoint !== "function") {
        return;
      }

      const el = makeElementWithRect("topmost-el", { x: 10, y: 10, width: 100, height: 50 });

      // Mock elementFromPoint to return the element itself
      const originalElementFromPoint = document.elementFromPoint;
      vi.spyOn(document, "elementFromPoint").mockImplementation((x: number, y: number) => {
        if (x === 60 && y === 35) { // center of the element
          return el;
        }
        return originalElementFromPoint.call(document, x, y);
      });

      try {
        const result = inspectElement({ selector: "#topmost-el" });
        expect(result.found).toBe(true);
        expect(result.element?.isObstructed).toBe(false);
      } finally {
        document.body.removeChild(el);
        vi.restoreAllMocks();
      }
    });

    it("F4-EVENT-002: returns true when another element is on top", async () => {
      // Skip if elementFromPoint is not available (jsdom limitation)
      if (typeof document.elementFromPoint !== "function") {
        return;
      }

      const el = makeElementWithRect("obstructed-el", { x: 10, y: 10, width: 100, height: 50 });
      const overlay = document.createElement("div");
      document.body.appendChild(overlay);

      // Mock elementFromPoint to return a different element (overlay)
      vi.spyOn(document, "elementFromPoint").mockImplementation((x: number, y: number) => {
        if (x === 60 && y === 35) { // center of the element
          return overlay; // Different element on top
        }
        return el;
      });

      try {
        const result = inspectElement({ selector: "#obstructed-el" });
        expect(result.found).toBe(true);
        expect(result.element?.isObstructed).toBe(true);
      } finally {
        document.body.removeChild(el);
        document.body.removeChild(overlay);
        vi.restoreAllMocks();
      }
    });
  });

  describe("clickTargetSize", () => {
    it("F4-EVENT-003: returns bounding box dimensions", async () => {
      const el = makeElementWithRect("target-size", { x: 10, y: 20, width: 100, height: 40 });

      try {
        const result = inspectElement({ selector: "#target-size" });
        expect(result.found).toBe(true);
        expect(result.element?.clickTargetSize).toBeDefined();
        expect(result.element?.clickTargetSize?.width).toBe(100);
        expect(result.element?.clickTargetSize?.height).toBe(40);
      } finally {
        document.body.removeChild(el);
      }
    });
  });
});
