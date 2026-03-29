/**
 * text-map-collector.test.ts
 *
 * Tests for M112-TEXT — Text Map Collector
 *
 * Tests validate:
 * - B2-TX-001: Visible text extraction — collectTextMap returns ordered TextSegment[]
 * - B2-TX-002: Per-segment source mapping — nodeId (per-call scoped) + bbox
 * - B2-TX-003: Whitespace-normalized and raw text modes — textRaw + textNormalized
 * - B2-TX-004: Reading order — readingOrderIndex (top-to-bottom, left-to-right within band)
 * - B2-TX-005: Visibility flags — "visible" | "hidden" | "offscreen"
 * - B2-TX-006: Semantic context — role + accessibleName
 * - B2-TX-007: SnapshotEnvelope compliance
 * - B2-TX-008: maxSegments truncation
 *
 * API checklist (collectTextMap):
 * - B2-TX-001: Returns ordered array of TextSegment with textNormalized values
 * - B2-TX-002: Every segment has nodeId (non-negative integer, per-call scoped) and bbox (non-negative width/height)
 * - B2-TX-003: textRaw preserves whitespace, textNormalized collapses whitespace runs
 * - B2-TX-004: readingOrderIndex is 0-based, sorted top-to-bottom LTR
 * - B2-TX-005: visibility field is "visible" | "hidden" | "offscreen"
 * - B2-TX-006: role and accessibleName are present when applicable
 * - B2-TX-007: Result includes full SnapshotEnvelope (pageId, frameId, snapshotId, capturedAt, viewport, source)
 * - B2-TX-008: maxSegments truncates, truncated flag set, totalSegments reflects actual count
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  collectTextMap,
  DEFAULT_MAX_SEGMENTS,
  MAX_SEGMENTS_LIMIT,
  VERTICAL_BAND_TOLERANCE_PX,
} from "../src/content/text-map-collector.js";
import type { TextSegment, TextMapResult } from "../src/content/text-map-collector.js";

// ── DOM Setup ─────────────────────────────────────────────────────────────────

/**
 * Sets up a DOM with:
 * - Heading "Hello" at top
 * - Two-column layout: sidebar (left) + main content (right)
 * - Elements with various visibility states (hidden, offscreen)
 * - Heading with aria-label for accessibleName test
 * - Elements with roles (button, heading)
 */
function setupTestDOM(): void {
  document.title = "M112-TEXT Test Page";

  document.body.innerHTML = `
    <h1 id="heading-main">Hello</h1>
    <div id="sidebar" style="position:absolute;left:0;top:50px;width:200px;height:300px;">
      <h2 id="sidebar-heading">Sidebar Title</h2>
      <p id="sidebar-para">Sidebar content paragraph</p>
    </div>
    <div id="main-content" style="position:absolute;left:210px;top:50px;width:500px;height:300px;">
      <h2 id="main-heading">Main Content</h2>
      <p id="main-para">World</p>
      <button id="action-btn" aria-label="Submit form">Click me</button>
    </div>
    <div id="hidden-element" style="display:none;">Should be hidden</div>
    <div id="offscreen-element" style="position:absolute;left:-9999px;">Offscreen text</div>
    <div id="opacity-zero" style="opacity:0;">Opacity zero</div>
    <div id="visibility-hidden" style="visibility:hidden;">Visibility hidden</div>
    <p id="whitespace-test">  Multiple   spaces   and
line breaks  </p>
  `;
}

// Mock getBoundingClientRect for elements that don't have explicit styles
function mockGetBoundingClientRect(this: HTMLElement): DOMRect {
  const id = this.id;
  const rects: Record<string, DOMRect> = {
    "heading-main": { x: 0, y: 0, width: 800, height: 40, top: 0, right: 800, bottom: 40, left: 0 } as DOMRect,
    "sidebar": { x: 0, y: 50, width: 200, height: 300, top: 50, right: 200, bottom: 350, left: 0 } as DOMRect,
    "sidebar-heading": { x: 10, y: 60, width: 180, height: 30, top: 60, right: 190, bottom: 90, left: 10 } as DOMRect,
    "sidebar-para": { x: 10, y: 100, width: 180, height: 50, top: 100, right: 190, bottom: 150, left: 10 } as DOMRect,
    "main-content": { x: 210, y: 50, width: 500, height: 300, top: 50, right: 710, bottom: 350, left: 210 } as DOMRect,
    "main-heading": { x: 220, y: 60, width: 480, height: 30, top: 60, right: 700, bottom: 90, left: 220 } as DOMRect,
    "main-para": { x: 220, y: 100, width: 480, height: 40, top: 100, right: 700, bottom: 140, left: 220 } as DOMRect,
    "action-btn": { x: 220, y: 150, width: 100, height: 40, top: 150, right: 320, bottom: 190, left: 220 } as DOMRect,
    "hidden-element": { x: 0, y: 400, width: 200, height: 40, top: 400, right: 200, bottom: 440, left: 0 } as DOMRect,
    "offscreen-element": { x: -1000, y: 100, width: 200, height: 40, top: 100, right: -800, bottom: 140, left: -1000 } as DOMRect,
    "opacity-zero": { x: 0, y: 450, width: 200, height: 40, top: 450, right: 200, bottom: 490, left: 0 } as DOMRect,
    "visibility-hidden": { x: 0, y: 500, width: 200, height: 40, top: 500, right: 200, bottom: 540, left: 0 } as DOMRect,
    "whitespace-test": { x: 220, y: 200, width: 400, height: 40, top: 200, right: 620, bottom: 240, left: 220 } as DOMRect,
  };
  return rects[id ?? ""] ?? { x: 100, y: 100, width: 200, height: 40, top: 100, right: 300, bottom: 140, left: 100 } as DOMRect;
}

// Apply mocks before each test
beforeEach(() => {
  setupTestDOM();
  // Mock getBoundingClientRect
  vi.stubGlobal("getBoundingClientRect", mockGetBoundingClientRect);
  // Mock window.innerWidth/innerHeight for viewport checks
  Object.defineProperty(window, "innerWidth", { value: 1280, writable: true });
  Object.defineProperty(window, "innerHeight", { value: 800, writable: true });
});

// Restore document state after each test to prevent cross-test pollution
afterEach(() => {
  // Reset document direction (RTL test sets dir="rtl")
  document.dir = "ltr";
  // Reset document title set by setupTestDOM
  document.title = "";
  // Clear body to prevent innerHTML leakage between tests
  document.body.innerHTML = "";
  // Unstub the global to prevent mock leakage
  vi.unstubAllGlobals();
});

// ── B2-TX-001: Visible Text Extraction ───────────────────────────────────────

describe("B2-TX-001: Visible text extraction", () => {
  it("B2-TX-001: Returns ordered array of TextSegment", () => {
    const result = collectTextMap();
    expect(result.segments).toBeInstanceOf(Array);
    expect(result.segments.length).toBeGreaterThan(0);
  });

  it("B2-TX-001: Page with heading Hello and paragraph World returns at least two segments", () => {
    // Setup: h1 contains "Hello", p#main-para contains "World"
    const result = collectTextMap();
    const texts = result.segments.map((s) => s.textNormalized);
    expect(texts).toContain("Hello");
    expect(texts).toContain("World");
  });

  it("B2-TX-001: Each segment has required top-level fields", () => {
    const result = collectTextMap();
    for (const segment of result.segments) {
      expect(segment).toHaveProperty("textRaw");
      expect(segment).toHaveProperty("textNormalized");
      expect(segment).toHaveProperty("nodeId");
      expect(segment).toHaveProperty("bbox");
      expect(segment).toHaveProperty("visibility");
      expect(segment).toHaveProperty("readingOrderIndex");
    }
  });
});

// ── B2-TX-002: Per-segment Source Mapping ────────────────────────────────────

describe("B2-TX-002: Per-segment source mapping", () => {
  it("B2-TX-002: Every segment has non-negative integer nodeId", () => {
    const result = collectTextMap();
    for (const segment of result.segments) {
      expect(typeof segment.nodeId).toBe("number");
      expect(segment.nodeId).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(segment.nodeId)).toBe(true);
    }
  });

  it("B2-TX-002: Every segment has bbox with non-negative width and height", () => {
    const result = collectTextMap();
    for (const segment of result.segments) {
      expect(segment.bbox).toBeDefined();
      expect(typeof segment.bbox.width).toBe("number");
      expect(typeof segment.bbox.height).toBe("number");
      expect(segment.bbox.width).toBeGreaterThanOrEqual(0);
      expect(segment.bbox.height).toBeGreaterThanOrEqual(0);
    }
  });

  it("B2-TX-002: nodeId is stable across two calls on unchanged DOM", () => {
    const result1 = collectTextMap();
    const result2 = collectTextMap();
    expect(result1.segments.length).toBe(result2.segments.length);
    for (let i = 0; i < result1.segments.length; i++) {
      expect(result1.segments[i].nodeId).toBe(result2.segments[i].nodeId);
    }
  });

  it("B2-TX-002: nodeId is per-call scoped — different from page-map ref indices", () => {
    // M112 maintains its own independent node ID counter
    const result = collectTextMap();
    // nodeIds should start from 0 and be sequential within this call
    const nodeIds = result.segments.map((s) => s.nodeId).sort((a, b) => a - b);
    for (let i = 0; i < nodeIds.length; i++) {
      expect(nodeIds[i]).toBe(i);
    }
  });

  it("B2-TX-002: bbox has x, y coordinates", () => {
    const result = collectTextMap();
    for (const segment of result.segments) {
      expect(segment.bbox).toHaveProperty("x");
      expect(segment.bbox).toHaveProperty("y");
      expect(typeof segment.bbox.x).toBe("number");
      expect(typeof segment.bbox.y).toBe("number");
    }
  });
});

// ── B2-TX-003: Whitespace-Normalized and Raw Text Modes ──────────────────────

describe("B2-TX-003: Whitespace-normalized and raw text modes", () => {
  it("B2-TX-003: textRaw preserves original whitespace", () => {
    const result = collectTextMap();
    const whitespaceSegment = result.segments.find((s) => s.textNormalized.includes("Multiple"));
    expect(whitespaceSegment).toBeDefined();
    // textRaw should preserve the original spacing and line breaks
    expect(whitespaceSegment!.textRaw).toContain("  ");
    expect(whitespaceSegment!.textRaw).toContain("\n");
  });

  it("B2-TX-003: textNormalized collapses whitespace runs to single space, leading/trailing trimmed", () => {
    const result = collectTextMap();
    const whitespaceSegment = result.segments.find((s) => s.textNormalized.includes("Multiple"));
    expect(whitespaceSegment).toBeDefined();
    expect(whitespaceSegment!.textNormalized).toBe("Multiple spaces and line breaks");
  });

  it("B2-TX-003: textNormalized does not have leading/trailing whitespace", () => {
    const result = collectTextMap();
    for (const segment of result.segments) {
      expect(segment.textNormalized).toBe(segment.textNormalized.trim());
    }
  });

  it("B2-TX-003: textRaw for simple text equals textNormalized", () => {
    const result = collectTextMap();
    const helloSegment = result.segments.find((s) => s.textNormalized === "Hello");
    expect(helloSegment).toBeDefined();
    expect(helloSegment!.textRaw).toBe("Hello");
    expect(helloSegment!.textNormalized).toBe("Hello");
  });
});

// ── B2-TX-004: Reading Order ─────────────────────────────────────────────────

describe("B2-TX-004: Reading order", () => {
  it("B2-TX-004: readingOrderIndex is 0-based integer", () => {
    const result = collectTextMap();
    for (const segment of result.segments) {
      expect(typeof segment.readingOrderIndex).toBe("number");
      expect(Number.isInteger(segment.readingOrderIndex)).toBe(true);
      expect(segment.readingOrderIndex).toBeGreaterThanOrEqual(0);
    }
  });

  it("B2-TX-004: readingOrderIndex is assigned top-to-bottom", () => {
    const result = collectTextMap();
    for (let i = 1; i < result.segments.length; i++) {
      const prev = result.segments[i - 1];
      const curr = result.segments[i];
      // Later index should not have a smaller y coordinate than earlier index
      // (allowing for same-band tolerance)
      const prevMidY = prev.bbox.y + prev.bbox.height / 2;
      const currMidY = curr.bbox.y + curr.bbox.height / 2;
      expect(currMidY).toBeGreaterThanOrEqual(prevMidY - VERTICAL_BAND_TOLERANCE_PX);
    }
  });

  it("B2-TX-004: Within same vertical band, LTR sorts by x ascending", () => {
    const result = collectTextMap();
    // Find the main content area (around y=50-400)
    const segmentsInMainBand = result.segments.filter(
      (s) => s.bbox.y >= 50 && s.bbox.y < 400
    );
    // Check that within any vertical band, x increases
    const midYGroups = new Map<number, TextSegment[]>();
    for (const seg of segmentsInMainBand) {
      const bandKey = Math.floor(seg.bbox.y / VERTICAL_BAND_TOLERANCE_PX);
      if (!midYGroups.has(bandKey)) midYGroups.set(bandKey, []);
      midYGroups.get(bandKey)!.push(seg);
    }
    for (const [, group] of midYGroups) {
      if (group.length <= 1) continue;
      const sorted = [...group].sort((a, b) => a.bbox.x - b.bbox.x);
      for (let i = 1; i < sorted.length; i++) {
        expect(result.segments.indexOf(sorted[i])).toBeGreaterThan(result.segments.indexOf(sorted[i - 1]));
      }
    }
  });

  it("B2-TX-004: Two-column layout — sidebar headings have lower readingOrderIndex than main headings at same vertical position", () => {
    const result = collectTextMap();
    const sidebarHeading = result.segments.find((s) => s.textNormalized === "Sidebar Title");
    const mainHeading = result.segments.find((s) => s.textNormalized === "Main Content");
    expect(sidebarHeading).toBeDefined();
    expect(mainHeading).toBeDefined();
    // Sidebar (left, x~10) should appear before main content (right, x~220) at same vertical band
    expect(sidebarHeading!.readingOrderIndex).toBeLessThan(mainHeading!.readingOrderIndex);
  });

  it("B2-TX-004: readingOrderIndex is unique within the response", () => {
    const result = collectTextMap();
    const indices = result.segments.map((s) => s.readingOrderIndex);
    const uniqueIndices = new Set(indices);
    expect(uniqueIndices.size).toBe(indices.length);
  });

  it("B2-TX-004 RTL: Within same vertical band, RTL sorts by x descending (right-to-left band reversal)", () => {
    // Set document direction to RTL
    document.dir = "rtl";
    try {
      const result = collectTextMap();
      // Find segments in the same vertical band (y=50-400)
      const segmentsInMainBand = result.segments.filter(
        (s) => s.bbox.y >= 50 && s.bbox.y < 400
      );
      // Group by vertical band
      const midYGroups = new Map<number, TextSegment[]>();
      for (const seg of segmentsInMainBand) {
        const bandKey = Math.floor(seg.bbox.y / VERTICAL_BAND_TOLERANCE_PX);
        if (!midYGroups.has(bandKey)) midYGroups.set(bandKey, []);
        midYGroups.get(bandKey)!.push(seg);
      }
      // Within each band, RTL should sort by x descending (rightmost first)
      for (const [, group] of midYGroups) {
        if (group.length <= 1) continue;
        // Sort by x descending (highest x first — rightmost element first in RTL)
        const sorted = [...group].sort((a, b) => b.bbox.x - a.bbox.x);
        for (let i = 1; i < sorted.length; i++) {
          const laterIdx = result.segments.indexOf(sorted[i]);
          const earlierIdx = result.segments.indexOf(sorted[i - 1]);
          expect(laterIdx).toBeGreaterThan(earlierIdx);
        }
      }
    } finally {
      document.dir = "ltr"; // Reset to LTR for other tests
    }
  });
});

// ── B2-TX-005: Visibility Flags ──────────────────────────────────────────────

describe("B2-TX-005: Visibility flags", () => {
  it("B2-TX-005: visibility field is one of 'visible', 'hidden', 'offscreen'", () => {
    const result = collectTextMap();
    for (const segment of result.segments) {
      expect(["visible", "hidden", "offscreen"]).toContain(segment.visibility);
    }
  });

  it("B2-TX-005: Element with display:none has visibility 'hidden'", () => {
    const result = collectTextMap();
    const hiddenSegment = result.segments.find((s) => s.textNormalized === "Should be hidden");
    expect(hiddenSegment).toBeDefined();
    expect(hiddenSegment!.visibility).toBe("hidden");
  });

  it("B2-TX-005: Element with opacity:0 has visibility 'hidden'", () => {
    const result = collectTextMap();
    const opacityZeroSegment = result.segments.find((s) => s.textNormalized === "Opacity zero");
    expect(opacityZeroSegment).toBeDefined();
    expect(opacityZeroSegment!.visibility).toBe("hidden");
  });

  it("B2-TX-005: Element scrolled off-screen (negative x) has visibility 'offscreen'", () => {
    const result = collectTextMap();
    const offscreenSegment = result.segments.find((s) => s.textNormalized === "Offscreen text");
    expect(offscreenSegment).toBeDefined();
    expect(offscreenSegment!.visibility).toBe("offscreen");
  });

  it("B2-TX-005: Normal in-viewport element has visibility 'visible'", () => {
    const result = collectTextMap();
    const visibleSegment = result.segments.find((s) => s.textNormalized === "Hello");
    expect(visibleSegment).toBeDefined();
    expect(visibleSegment!.visibility).toBe("visible");
  });
});

// ── B2-TX-006: Semantic Context ──────────────────────────────────────────────

describe("B2-TX-006: Semantic context per segment", () => {
  it("B2-TX-006: Heading element has role 'heading'", () => {
    const result = collectTextMap();
    const headingSegment = result.segments.find((s) => s.textNormalized === "Hello");
    expect(headingSegment).toBeDefined();
    expect(headingSegment!.role).toBe("heading");
  });

  it("B2-TX-006: Button element has role 'button'", () => {
    const result = collectTextMap();
    const buttonSegment = result.segments.find((s) => s.textNormalized === "Click me");
    expect(buttonSegment).toBeDefined();
    expect(buttonSegment!.role).toBe("button");
  });

  it("B2-TX-006: Element with aria-label has accessibleName set", () => {
    const result = collectTextMap();
    const buttonSegment = result.segments.find((s) => s.textNormalized === "Click me");
    expect(buttonSegment).toBeDefined();
    expect(buttonSegment!.accessibleName).toBe("Submit form");
  });

  it("B2-TX-006: Element without semantic attributes has role and accessibleName omitted", () => {
    const result = collectTextMap();
    const plainPara = result.segments.find((s) => s.textNormalized === "World");
    expect(plainPara).toBeDefined();
    // Plain paragraph should not have a role or accessibleName
    expect(plainPara!.role).toBeUndefined();
    expect(plainPara!.accessibleName).toBeUndefined();
  });

  it("B2-TX-006: accessibleName uses aria-label when present", () => {
    const result = collectTextMap();
    const btnSegment = result.segments.find((s) => s.textNormalized === "Click me");
    expect(btnSegment?.accessibleName).toBe("Submit form");
  });
});

// ── B2-TX-007: Snapshot Envelope Compliance ───────────────────────────────────

describe("B2-TX-007: Snapshot envelope compliance", () => {
  it("B2-TX-007: Result includes full SnapshotEnvelope fields", () => {
    const result = collectTextMap();
    expect(result).toHaveProperty("pageId");
    expect(result).toHaveProperty("frameId");
    expect(result).toHaveProperty("snapshotId");
    expect(result).toHaveProperty("capturedAt");
    expect(result).toHaveProperty("viewport");
    expect(result).toHaveProperty("source");
  });

  it("B2-TX-007: pageId is non-empty string", () => {
    const result = collectTextMap();
    expect(typeof result.pageId).toBe("string");
    expect(result.pageId.length).toBeGreaterThan(0);
  });

  it("B2-TX-007: frameId is 'main' for top-level frame", () => {
    const result = collectTextMap();
    expect(result.frameId).toBe("main");
  });

  it("B2-TX-007: snapshotId format is {pageId}:{version}", () => {
    const result = collectTextMap();
    expect(result.snapshotId).toMatch(/^[^:]+:\d+$/);
  });

  it("B2-TX-007: capturedAt is ISO 8601 timestamp", () => {
    const result = collectTextMap();
    expect(result.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it("B2-TX-007: viewport has width, height, scrollX, scrollY, devicePixelRatio", () => {
    const result = collectTextMap();
    expect(result.viewport).toHaveProperty("width");
    expect(result.viewport).toHaveProperty("height");
    expect(result.viewport).toHaveProperty("scrollX");
    expect(result.viewport).toHaveProperty("scrollY");
    expect(result.viewport).toHaveProperty("devicePixelRatio");
  });

  it("B2-TX-007: source is 'dom'", () => {
    const result = collectTextMap();
    expect(result.source).toBe("dom");
  });

  it("B2-TX-007: pageUrl and title are present", () => {
    const result = collectTextMap();
    expect(result).toHaveProperty("pageUrl");
    expect(result).toHaveProperty("title");
    expect(typeof result.pageUrl).toBe("string");
    expect(typeof result.title).toBe("string");
  });
});

// ── B2-TX-008: Maximum Segment Limit ─────────────────────────────────────────

describe("B2-TX-008: Maximum segment limit", () => {
  it("B2-TX-008: Default maxSegments is 500", () => {
    expect(DEFAULT_MAX_SEGMENTS).toBe(500);
  });

  it("B2-TX-008: Maximum limit is 2000", () => {
    expect(MAX_SEGMENTS_LIMIT).toBe(2000);
  });

  it("B2-TX-008: maxSegments option truncates response to exactly N segments", () => {
    // Force a >3 segment fixture by having more than 3 text nodes in the DOM
    // The test DOM has: heading-main, sidebar-heading, sidebar-para, main-heading,
    // main-para, action-btn, whitespace-test = 7 visible text nodes minimum
    const result = collectTextMap({ maxSegments: 3 });
    // Exact cap assertion — not <= 3 (which would pass even if truncation didn't work)
    expect(result.segments.length).toBe(3);
    expect(result.truncated).toBe(true);
  });

  it("B2-TX-008: When truncated, totalSegments reflects actual count before truncation", () => {
    const result = collectTextMap({ maxSegments: 3 });
    expect(result.totalSegments).toBeGreaterThan(result.segments.length);
  });

  it("B2-TX-008: When not truncated, truncated flag is false", () => {
    // Use a very high limit that exceeds the page's text nodes
    const result = collectTextMap({ maxSegments: 9999 });
    // If the page has fewer than 9999 segments, should not be truncated
    if (result.totalSegments <= 9999) {
      expect(result.truncated).toBe(false);
    }
  });

  it("B2-TX-008: maxSegments: 1 returns exactly 1 segment", () => {
    const result = collectTextMap({ maxSegments: 1 });
    expect(result.segments.length).toBe(1);
    expect(result.truncated).toBe(true);
  });

  it("B2-TX-008: maxSegments respects maximum of 2000", () => {
    // Even with a large page, should not exceed MAX_SEGMENTS_LIMIT
    const result = collectTextMap({ maxSegments: 5000 });
    // Cap enforcement: result must never exceed MAX_SEGMENTS_LIMIT (it's an upper bound)
    expect(result.segments.length).toBeLessThanOrEqual(MAX_SEGMENTS_LIMIT);
    // If total segments fit within limit, should not be truncated
    if (result.totalSegments <= MAX_SEGMENTS_LIMIT) {
      expect(result.truncated).toBe(false);
    }
  });

  it("B2-TX-008: VERTICAL_BAND_TOLERANCE_PX is 5", () => {
    expect(VERTICAL_BAND_TOLERANCE_PX).toBe(5);
  });
});

// ── Type Exports ─────────────────────────────────────────────────────────────

describe("M112-TEXT type exports", () => {
  it("TextSegment interface has all required fields", () => {
    const segment: TextSegment = {
      textRaw: "  Hello   World  \n",
      textNormalized: "Hello World",
      nodeId: 0,
      bbox: { x: 10, y: 20, width: 100, height: 40 },
      visibility: "visible",
      readingOrderIndex: 0,
    };
    expect(segment.textRaw).toBe("  Hello   World  \n");
    expect(segment.textNormalized).toBe("Hello World");
    expect(segment.nodeId).toBe(0);
    expect(segment.bbox).toEqual({ x: 10, y: 20, width: 100, height: 40 });
    expect(segment.visibility).toBe("visible");
    expect(segment.readingOrderIndex).toBe(0);
  });

  it("TextMapResult interface has all required fields", () => {
    const result: TextMapResult = {
      pageId: "test-page",
      frameId: "main",
      snapshotId: "test-page:1",
      capturedAt: "2025-01-01T00:00:00.000Z",
      viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
      source: "dom",
      pageUrl: "https://example.com",
      title: "Test",
      segments: [],
      totalSegments: 0,
      truncated: false,
    };
    expect(result.pageId).toBe("test-page");
    expect(result.segments).toEqual([]);
    expect(result.truncated).toBe(false);
  });
});

// ── Edge Cases ────────────────────────────────────────────────────────────────

describe("M112-TEXT edge cases", () => {
  it("empty page returns segments=[], truncated=false, totalSegments=0", async () => {
    // Override the DOM set up by beforeEach with a completely empty body
    document.body.innerHTML = "";
    document.title = "";

    const result = await collectTextMap();

    expect(result.segments).toEqual([]);
    expect(result.truncated).toBe(false);
    expect(result.totalSegments).toBe(0);
  });

  it("all-hidden page: display:none elements are reported with visibility='hidden'", async () => {
    // Override DOM: only display:none elements
    document.body.innerHTML = `
      <div id="hidden-a" style="display:none;">Hidden A</div>
      <div id="hidden-b" style="display:none;">Hidden B</div>
    `;

    const result = await collectTextMap();

    // All segments that reference the hidden elements must carry visibility="hidden"
    const hiddenSegments = result.segments.filter((s) => s.visibility === "hidden");
    expect(hiddenSegments.length).toBeGreaterThan(0);
    hiddenSegments.forEach((s) => {
      expect(s.visibility).toBe("hidden");
    });
  });
});
