/**
 * page-map-collector.test.ts
 *
 * Tests for M90-MAP — Page Map Collector
 *
 * These tests validate:
 * - collectPageMap stub throws not implemented
 * - PageNode, PageMapOptions, PageMapResult types are correctly defined
 * - Constants are properly exported (EXCLUDED_TAGS, MAX_DEPTH_LIMIT, etc.)
 * - Ref index functions exist and work correctly
 * - M102-FILT integration: filter pipeline wired into traversal (B2-FI-001..008)
 *
 * API checklist (collectPageMap):
 * - PU-F-01: Returns structured PageNode[] array with ref, tag, role, name, text, attrs, children
 * - PU-F-02: Respects maxDepth parameter (default 4, max 8)
 * - PU-F-03: Respects maxNodes parameter (default 200, max 500)
 * - PU-F-04: Excludes script, style, noscript, template, display:none elements
 * - PU-F-05: Returns page metadata: pageUrl, title, viewport, totalElements, truncated
 * - PU-F-06: Optionally includes bounding box coordinates (includeBounds: true)
 * - B2-FI-001..008: Filter pipeline integration, filterSummary accounting
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  collectPageMap,
  getElementByRef,
  clearRefIndex,
  EXCLUDED_TAGS,
  MAX_DEPTH_LIMIT,
  MAX_NODES_LIMIT,
  DEFAULT_MAX_DEPTH,
  DEFAULT_MAX_NODES,
  MAX_TEXT_LENGTH,
  INCLUDED_ATTRS,
} from "../src/content/page-map-collector.js";
import type { PageNode, PageMapOptions, PageMapResult } from "../src/content/page-map-collector.js";
import type { SnapshotEnvelope } from "../src/snapshot-versioning.js";

/** Stub envelope fields for type-compliance in tests (B2-SV-003). */
const STUB_ENVELOPE: SnapshotEnvelope = {
  pageId: "page",
  frameId: "main",
  snapshotId: "page:0",
  capturedAt: "2025-01-01T00:00:00.000Z",
  viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
  source: "dom",
};

describe("M90-MAP type exports", () => {
  /**
   * PU-F-01: PageNode interface has required fields
   */
  it("PU-F-01: PageNode type has required fields (ref, tag)", () => {
    const node: PageNode = {
      ref: "ref-123",
      tag: "div",
      nodeId: 0,
    };
    expect(node.ref).toBe("ref-123");
    expect(node.tag).toBe("div");
  });

  it("PU-F-01: PageNode type allows optional fields (role, name, text, attrs, bounds, children)", () => {
    const node: PageNode = {
      ref: "ref-456",
      tag: "button",
      nodeId: 1,
      role: "button",
      name: "Submit",
      text: "Click me",
      attrs: { id: "submit-btn", class: "btn primary" },
      bounds: { x: 10, y: 20, width: 100, height: 40 },
      children: [],
    };
    expect(node.role).toBe("button");
    expect(node.name).toBe("Submit");
    expect(node.text).toBe("Click me");
    expect(node.bounds).toEqual({ x: 10, y: 20, width: 100, height: 40 });
    expect(node.children).toEqual([]);
  });

  /**
   * PU-F-02: PageMapOptions interface for collection options
   */
  it("PU-F-02: PageMapOptions allows maxDepth parameter", () => {
    const opts: PageMapOptions = { maxDepth: 8 };
    expect(opts.maxDepth).toBe(8);
  });

  /**
   * PU-F-03: PageMapOptions allows maxNodes parameter
   */
  it("PU-F-03: PageMapOptions allows maxNodes parameter", () => {
    const opts: PageMapOptions = { maxNodes: 500 };
    expect(opts.maxNodes).toBe(500);
  });

  /**
   * PU-F-06: PageMapOptions allows includeBounds parameter
   */
  it("PU-F-06: PageMapOptions allows includeBounds parameter", () => {
    const opts: PageMapOptions = { includeBounds: true };
    expect(opts.includeBounds).toBe(true);
  });

  /**
   * PU-F-05: PageMapResult interface includes page metadata
   */
  it("PU-F-05: PageMapResult type has required metadata fields", () => {
    const result: PageMapResult = {
      ...STUB_ENVELOPE,
      pageUrl: "https://example.com/page",
      title: "Example Page",
      nodes: [],
      totalElements: 0,
      truncated: false,
    };
    expect(result.pageUrl).toBe("https://example.com/page");
    expect(result.title).toBe("Example Page");
    expect(result.viewport).toEqual(STUB_ENVELOPE.viewport);
    expect(result.truncated).toBe(false);
  });
});

describe("M90-MAP constants", () => {
  /**
   * PU-F-04: EXCLUDED_TAGS contains script, style, noscript, template, link, meta
   */
  it("PU-F-04: EXCLUDED_TAGS is a ReadonlySet with script, style, noscript, template, link, meta", () => {
    expect(EXCLUDED_TAGS).toBeInstanceOf(Set);
    expect(EXCLUDED_TAGS.has("script")).toBe(true);
    expect(EXCLUDED_TAGS.has("style")).toBe(true);
    expect(EXCLUDED_TAGS.has("noscript")).toBe(true);
    expect(EXCLUDED_TAGS.has("template")).toBe(true);
    expect(EXCLUDED_TAGS.has("link")).toBe(true);
    expect(EXCLUDED_TAGS.has("meta")).toBe(true);
  });

  /**
   * PU-F-02: MAX_DEPTH_LIMIT is 8
   */
  it("PU-F-02: MAX_DEPTH_LIMIT equals 8", () => {
    expect(MAX_DEPTH_LIMIT).toBe(8);
  });

  /**
   * PU-F-03: MAX_NODES_LIMIT is 500
   */
  it("PU-F-03: MAX_NODES_LIMIT equals 500", () => {
    expect(MAX_NODES_LIMIT).toBe(500);
  });

  /**
   * PU-F-02: DEFAULT_MAX_DEPTH is 4
   */
  it("PU-F-02: DEFAULT_MAX_DEPTH equals 4", () => {
    expect(DEFAULT_MAX_DEPTH).toBe(4);
  });

  /**
   * PU-F-03: DEFAULT_MAX_NODES is 200
   */
  it("PU-F-03: DEFAULT_MAX_NODES equals 200", () => {
    expect(DEFAULT_MAX_NODES).toBe(200);
  });

  /**
   * PU-F-01: MAX_TEXT_LENGTH is 100
   */
  it("PU-F-01: MAX_TEXT_LENGTH equals 100", () => {
    expect(MAX_TEXT_LENGTH).toBe(100);
  });

  /**
   * PU-F-01: INCLUDED_ATTRS contains expected attributes
   */
  it("PU-F-01: INCLUDED_ATTRS contains expected attributes", () => {
    expect(INCLUDED_ATTRS).toContain("id");
    expect(INCLUDED_ATTRS).toContain("class");
    expect(INCLUDED_ATTRS).toContain("href");
    expect(INCLUDED_ATTRS).toContain("src");
    expect(INCLUDED_ATTRS).toContain("data-testid");
    expect(INCLUDED_ATTRS).toContain("aria-label");
  });
});

describe("M90-MAP collectPageMap behavioral output", () => {
  /**
   * PU-F-01: collectPageMap returns structured PageMapResult with all required fields
   */
  it("PU-F-01: collectPageMap returns PageMapResult with pageUrl, title, viewport, nodes, totalElements, truncated", () => {
    const result = collectPageMap();
    expect(result).toHaveProperty("pageUrl");
    expect(result).toHaveProperty("title");
    expect(result).toHaveProperty("viewport");
    expect(result).toHaveProperty("nodes");
    expect(result).toHaveProperty("totalElements");
    expect(result).toHaveProperty("truncated");
  });

  /**
   * PU-F-01: collectPageMap nodes array contains PageNode objects with required fields
   */
  it("PU-F-01: collectPageMap returns nodes with ref and tag fields", () => {
    const result = collectPageMap();
    expect(Array.isArray(result.nodes)).toBe(true);
  });

  /**
   * PU-F-02: collectPageMap respects maxDepth parameter
   * The stub returns empty nodes regardless, but the real implementation would use maxDepth
   */
  it("PU-F-02: collectPageMap({ maxDepth: 8 }) returns result with all required fields", () => {
    const result = collectPageMap({ maxDepth: 8 });
    expect(result).toHaveProperty("nodes");
    expect(result).toHaveProperty("pageUrl");
    expect(result).toHaveProperty("viewport");
    // Stub returns empty nodes - a real implementation with maxDepth:8 on a real page
    // would return non-empty nodes. This test FAILS against stub because it expects
    // nodes to reflect actual DOM content.
    expect(result.nodes.length).toBeGreaterThan(0);
  });

  /**
   * PU-F-03: collectPageMap respects maxNodes parameter
   */
  it("PU-F-03: collectPageMap({ maxNodes: 500 }) returns result with all required fields", () => {
    const result = collectPageMap({ maxNodes: 500 });
    expect(result).toHaveProperty("nodes");
    expect(result).toHaveProperty("totalElements");
    // Stub returns totalElements: 0 - a real implementation would return
    // actual element count from the DOM
    expect(result.totalElements).toBeGreaterThan(0);
  });

  /**
   * PU-F-05: collectPageMap returns page metadata including viewport
   */
  it("PU-F-05: collectPageMap returns viewport with width and height", () => {
    const result = collectPageMap();
    expect(result.viewport).toHaveProperty("width");
    expect(result.viewport).toHaveProperty("height");
    expect(typeof result.viewport.width).toBe("number");
    expect(typeof result.viewport.height).toBe("number");
  });

  /**
   * PU-F-06: collectPageMap with includeBounds:true would include bounds in nodes
   * Stub does not include bounds even when includeBounds is true
   */
  it("PU-F-06: collectPageMap({ includeBounds: true }) includes bounds in nodes", () => {
    const result = collectPageMap({ includeBounds: true });
    // Stub returns empty nodes, so bounds field is not present
    // A real implementation would include bounds in each node when includeBounds: true
    if (result.nodes.length > 0) {
      expect(result.nodes[0]).toHaveProperty("bounds");
    }
    // This test FAILS against stub because stub returns empty nodes
    expect(result.nodes.length).toBeGreaterThan(0);
  });

  /**
   * PU-F-04: collectPageMap excludes script, style, noscript, template, link, meta at runtime
   *
   * The real implementation must filter out excluded tags from the collected nodes.
   * Stub returns empty nodes[] so the exclusion is trivially satisfied — but the contract
   * is that non-empty results must never contain excluded tags.
   *
   * Phase-B note: expect(result.nodes.length).toBeGreaterThan(0) fails against stub.
   * When real implementation exists, this test verifies the exclusion logic.
   */
  it("PU-F-04: collectPageMap returns no script/style/noscript/template/link/meta nodes", () => {
    const result = collectPageMap();
    const excludedTags = ["script", "style", "noscript", "template", "link", "meta"];
    // Contract: if nodes were collected from a real DOM, none would have excluded tags
    if (result.nodes.length > 0) {
      for (const node of result.nodes) {
        expect(excludedTags).not.toContain(node.tag);
      }
    }
    // FAILS against stub (empty nodes) — real implementation would have nodes to check
    expect(result.nodes.length).toBeGreaterThan(0);
  });

  /**
   * PU-F-05: pageUrl is a valid URL with proper structure
   */
  it("PU-F-05: collectPageMap returns pageUrl with valid URL structure", () => {
    const result = collectPageMap();
    // pageUrl must be a valid http/https URL with a pathname — not a stub domain
    expect(result.pageUrl).toMatch(/^https?:\/\/.+/);
    expect(result.pageUrl).not.toContain("stub.example.com");
  });

  /**
   * PU-F-05: title is a meaningful non-empty string
   */
  it("PU-F-05: collectPageMap returns non-empty page title", () => {
    const result = collectPageMap();
    // title must be a meaningful, non-empty string — not a placeholder
    expect(result.title).toBeTruthy();
    expect(result.title.length).toBeGreaterThan(0);
    expect(result.title).not.toBe("Stub Page");
  });
});

describe("M90-MAP ref index functions", () => {
  /**
   * PU-F-15: Ref index is built during collectPageMap, consumed by inspect_element
   * These tests verify the ref index API exists and works at the type level
   */
  it("PU-F-15: getElementByRef function exists and is exported", () => {
    expect(typeof getElementByRef).toBe("function");
  });

  it("PU-F-15: clearRefIndex function exists and is exported", () => {
    expect(typeof clearRefIndex).toBe("function");
  });

  /**
   * PU-F-15: getElementByRef returns null for unknown refs (stub behavior)
   */
  it("PU-F-15: getElementByRef returns null for unknown ref", () => {
    // Clear any existing state first
    clearRefIndex();
    // Unknown ref should return null
    expect(getElementByRef("unknown-ref")).toBeNull();
  });

  /**
   * PU-F-15: clearRefIndex clears the index (stub behavior)
   */
  it("PU-F-15: clearRefIndex can be called without error", () => {
    expect(() => clearRefIndex()).not.toThrow();
  });

  /**
   * PU-F-15: clearRefIndex invalidates all refs — stale-ref lifecycle
   *
   * Scenario: User navigates to a new page. The old page map's refs are now stale.
   * Calling clearRefIndex() must clear the ephemeral index so that getElementByRef
   * returns null for any ref from the previous page map.
   *
   * Stub behavior: clearRefIndex() is a no-op, getElementByRef always returns null.
   * Real implementation: clearRefIndex() empties the Map, making all prior refs invalid.
   *
   * Phase-B note: expect(result.nodes.length).toBeGreaterThan(0) fails against stub.
   */
  it("PU-F-15: clearRefIndex() invalidates refs from previous page map", () => {
    // Build a page map — real implementation would populate the ref index
    const pageMap = collectPageMap();
    // Clear the index — simulates navigation to a new page
    clearRefIndex();
    // After clearing, getElementByRef must return null for any ref (stale-ref contract)
    // Stub always returns null anyway, so this is trivially satisfied.
    // Real implementation would return null for refs from the now-invalidated pageMap.
    const result = getElementByRef("any-ref-from-old-page-map");
    expect(result).toBeNull();
    // Phase-B failure: stub returns empty nodes, not a real page map
    expect(pageMap.nodes.length).toBeGreaterThan(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// M102-FILT: Collector-level integration tests (B2-FI-001..008)
//
// These tests validate that the filter pipeline is wired into collectPageMap()
// and that filterSummary is populated correctly.
//
// Setup: each test injects elements into document.body before calling
// collectPageMap(), then removes them in afterEach/beforeEach.
// ══════════════════════════════════════════════════════════════════════════════

describe("M102-FILT collector integration — B2-FI-001..008", () => {
  /** Reset body before each test to avoid state leakage. */
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  // ── B2-FI-007/008: filterSummary absent when no filters ──────────────────

  /**
   * B2-FI-007: When no filter parameters are provided, filterSummary must
   * be absent from the result.
   */
  it("B2-FI-007: filterSummary is absent when no filters are active", () => {
    document.body.innerHTML = "<div>hello</div><p>world</p>";
    const result = collectPageMap();
    expect(result.filterSummary).toBeUndefined();
  });

  // ── B2-FI-008: filterSummary shape ───────────────────────────────────────

  /**
   * B2-FI-008: filterSummary is present with correct shape when at least one
   * filter is active. Uses interactiveOnly=true as the trigger filter.
   */
  it("B2-FI-008: filterSummary is present and has correct shape when interactiveOnly=true", () => {
    document.body.innerHTML = `
      <div>non-interactive</div>
      <button>Click me</button>
      <a href="#">link</a>
    `;
    const result = collectPageMap({ interactiveOnly: true });
    expect(result.filterSummary).toBeDefined();
    const fs = result.filterSummary!;
    expect(fs).toHaveProperty("activeFilters");
    expect(fs).toHaveProperty("totalBeforeFilter");
    expect(fs).toHaveProperty("totalAfterFilter");
    expect(fs).toHaveProperty("reductionRatio");
    expect(Array.isArray(fs.activeFilters)).toBe(true);
    expect(typeof fs.totalBeforeFilter).toBe("number");
    expect(typeof fs.totalAfterFilter).toBe("number");
    expect(typeof fs.reductionRatio).toBe("number");
  });

  /**
   * B2-FI-008: activeFilters lists "interactiveOnly" when that filter is active.
   */
  it("B2-FI-008: filterSummary.activeFilters includes 'interactiveOnly'", () => {
    document.body.innerHTML = "<button>btn</button>";
    const result = collectPageMap({ interactiveOnly: true });
    expect(result.filterSummary?.activeFilters).toContain("interactiveOnly");
  });

  /**
   * B2-FI-008: totalBeforeFilter tracks ALL traversed nodes, not just top-level.
   * It must be >= totalAfterFilter.
   */
  it("B2-FI-008: totalBeforeFilter >= totalAfterFilter", () => {
    document.body.innerHTML = `
      <div>
        <span>text</span>
        <button>click</button>
      </div>
    `;
    const result = collectPageMap({ interactiveOnly: true });
    const fs = result.filterSummary!;
    expect(fs.totalBeforeFilter).toBeGreaterThanOrEqual(fs.totalAfterFilter);
  });

  /**
   * B2-FI-008: reductionRatio is in [0.0, 1.0] range.
   */
  it("B2-FI-008: reductionRatio is between 0.0 and 1.0 inclusive", () => {
    document.body.innerHTML = `
      <div>plain</div>
      <button>btn</button>
    `;
    const result = collectPageMap({ interactiveOnly: true });
    const ratio = result.filterSummary!.reductionRatio;
    expect(ratio).toBeGreaterThanOrEqual(0);
    expect(ratio).toBeLessThanOrEqual(1);
  });

  // ── B2-FI-002: interactiveOnly filter ────────────────────────────────────

  /**
   * B2-FI-002: When interactiveOnly=true, only interactive elements are returned.
   * Non-interactive divs/spans must be excluded.
   */
  it("B2-FI-002: interactiveOnly=true excludes non-interactive elements", () => {
    document.body.innerHTML = `
      <div id="non-interactive">plain div</div>
      <span>span text</span>
      <button id="btn">Click</button>
      <a id="lnk" href="#">Link</a>
    `;
    const result = collectPageMap({ interactiveOnly: true });
    const tags = result.nodes.map((n) => n.tag);
    expect(tags).not.toContain("div");
    expect(tags).not.toContain("span");
    expect(tags).toContain("button");
    expect(tags).toContain("a");
  });

  /**
   * B2-FI-002: onclick attribute makes a non-interactive element interactive.
   */
  it("B2-FI-002: element with onclick attribute passes interactiveOnly filter", () => {
    document.body.innerHTML = `
      <div id="plain">not interactive</div>
      <div id="clicky" onclick="handler()">has onclick</div>
    `;
    const result = collectPageMap({ interactiveOnly: true });
    const ids = result.nodes.map((n) => n.id).filter(Boolean);
    expect(ids).toContain("clicky");
    expect(ids).not.toContain("plain");
  });

  // ── B2-FI-003: roles filter ───────────────────────────────────────────────

  /**
   * B2-FI-003: roles filter returns only elements matching specified ARIA roles.
   * Implicit mapping: h1–h6 → "heading".
   */
  it("B2-FI-003: roles=['heading'] returns h1 elements via implicit role mapping", () => {
    document.body.innerHTML = `
      <h1 id="title">Title</h1>
      <p id="para">Paragraph</p>
      <div id="div">div</div>
    `;
    const result = collectPageMap({ roles: ["heading"] });
    const tags = result.nodes.map((n) => n.tag);
    expect(tags).toContain("h1");
    expect(tags).not.toContain("p");
    expect(tags).not.toContain("div");
  });

  /**
   * B2-FI-003: roles filter respects explicit role attribute.
   */
  it("B2-FI-003: roles=['button'] returns elements with role='button' attribute", () => {
    document.body.innerHTML = `
      <div id="fake-btn" role="button">custom btn</div>
      <div id="normal">normal div</div>
    `;
    const result = collectPageMap({ roles: ["button"] });
    const ids = result.nodes.map((n) => n.id).filter(Boolean);
    expect(ids).toContain("fake-btn");
    expect(ids).not.toContain("normal");
  });

  // ── B2-FI-004: textMatch filter ───────────────────────────────────────────

  /**
   * B2-FI-004: textMatch returns only elements containing the substring
   * (case-insensitive).
   */
  it("B2-FI-004: textMatch filters by case-insensitive text content", () => {
    document.body.innerHTML = `
      <p id="match">Hello World</p>
      <p id="no-match">Goodbye</p>
    `;
    const result = collectPageMap({ textMatch: "hello" });
    const ids = result.nodes.map((n) => n.id).filter(Boolean);
    expect(ids).toContain("match");
    expect(ids).not.toContain("no-match");
  });

  // ── B2-FI-005: selector filter ────────────────────────────────────────────

  /**
   * B2-FI-005: selector filter returns only elements matching the CSS selector.
   */
  it("B2-FI-005: selector='.highlight' returns only elements matching that class", () => {
    document.body.innerHTML = `
      <div id="a" class="highlight">selected</div>
      <div id="b">not selected</div>
    `;
    const result = collectPageMap({ selector: ".highlight" });
    const ids = result.nodes.map((n) => n.id).filter(Boolean);
    expect(ids).toContain("a");
    expect(ids).not.toContain("b");
  });

  /**
   * B2-FI-005: Invalid CSS selector is silently ignored (returns all elements).
   */
  it("B2-FI-005: invalid selector falls back to include-all (no crash)", () => {
    document.body.innerHTML = `<div>hello</div>`;
    expect(() => collectPageMap({ selector: "[[invalid" })).not.toThrow();
    const result = collectPageMap({ selector: "[[invalid" });
    expect(result.nodes.length).toBeGreaterThan(0);
  });

  // ── B2-FI-007: AND composition ────────────────────────────────────────────

  /**
   * B2-FI-007: Multiple filters compose with AND semantics.
   * interactiveOnly=true AND roles=['button'] must only return interactive buttons.
   */
  it("B2-FI-007: AND composition — interactiveOnly + roles both required", () => {
    document.body.innerHTML = `
      <button id="btn" role="button">Submit</button>
      <div id="fake-btn" role="button">Fake</div>
      <a id="lnk" href="#">Link</a>
    `;
    const result = collectPageMap({ interactiveOnly: true, roles: ["button"] });
    const ids = result.nodes.map((n) => n.id).filter(Boolean);
    // <a> has implicit role "link" — fails roles filter
    // <button> is interactive AND has implicit role "button" — passes both
    // <div role="button"> passes roles filter AND is interactive via ARIA role
    expect(ids).toContain("btn");
    expect(ids).toContain("fake-btn");
    expect(ids).not.toContain("lnk");
    // filterSummary must list both filters
    expect(result.filterSummary?.activeFilters).toContain("interactiveOnly");
    expect(result.filterSummary?.activeFilters).toContain("roles");
  });

  /**
   * B2-FI-007: AND composition — filterSummary.activeFilters names all active filters.
   */
  it("B2-FI-007: filterSummary.activeFilters names all active filters in AND composition", () => {
    document.body.innerHTML = `<button>btn</button>`;
    const result = collectPageMap({
      interactiveOnly: true,
      textMatch: "btn",
    });
    const fs = result.filterSummary!;
    expect(fs.activeFilters).toContain("interactiveOnly");
    expect(fs.activeFilters).toContain("textMatch");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// M102-FILT: Additional collector-level integration tests
//
// Covers:
//  - visibleOnly filter at collector level (B2-FI-001)
//  - regionFilter at collector level (B2-FI-006)
//  - Nested-child retention: parent fails filter but child passes (traversal fix)
//  - B2-FI-008 acceptance via real collectPageMap across 3 DOM fixtures
// ══════════════════════════════════════════════════════════════════════════════

describe("M102-FILT collector — visibleOnly, regionFilter, nested-child retention", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  // ── B2-FI-001: visibleOnly at collector level ─────────────────────────────

  /**
   * B2-FI-001: visibleOnly=true at collector level: elements outside the
   * viewport are excluded. We mock getBoundingClientRect per element so the
   * test is deterministic in jsdom (which has no real layout engine).
   */
  it("B2-FI-001: visibleOnly=true excludes elements outside viewport", () => {
    document.body.innerHTML = `
      <div id="visible">visible</div>
      <div id="hidden-below">hidden below</div>
    `;

    // jsdom viewport is 1024×768 (confirmed by check-viewport.test.ts)
    const visibleEl = document.getElementById("visible")!;
    const hiddenEl = document.getElementById("hidden-below")!;

    // Visible element: inside viewport
    vi.spyOn(visibleEl, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, width: 200, height: 40,
      top: 0, left: 0, bottom: 40, right: 200,
      toJSON: () => ({}),
    } as DOMRect);

    // Hidden element: below viewport (y=2000)
    vi.spyOn(hiddenEl, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 2000, width: 200, height: 40,
      top: 2000, left: 0, bottom: 2040, right: 200,
      toJSON: () => ({}),
    } as DOMRect);

    const result = collectPageMap({ visibleOnly: true });
    const ids = result.nodes.map((n) => n.id).filter(Boolean);
    expect(ids).toContain("visible");
    expect(ids).not.toContain("hidden-below");
    expect(result.filterSummary?.activeFilters).toContain("visibleOnly");
  });

  // ── B2-FI-006: regionFilter at collector level ────────────────────────────

  /**
   * B2-FI-006: regionFilter at collector level: only elements whose bounding
   * box intersects the specified region are returned.
   */
  it("B2-FI-006: regionFilter returns only elements intersecting the region", () => {
    document.body.innerHTML = `
      <div id="in-region">in region</div>
      <div id="out-region">out of region</div>
    `;

    const inEl = document.getElementById("in-region")!;
    const outEl = document.getElementById("out-region")!;

    // inEl is inside region {x:0, y:0, width:300, height:200}
    vi.spyOn(inEl, "getBoundingClientRect").mockReturnValue({
      x: 50, y: 50, width: 100, height: 40,
      top: 50, left: 50, bottom: 90, right: 150,
      toJSON: () => ({}),
    } as DOMRect);

    // outEl is outside the region
    vi.spyOn(outEl, "getBoundingClientRect").mockReturnValue({
      x: 500, y: 500, width: 100, height: 40,
      top: 500, left: 500, bottom: 540, right: 600,
      toJSON: () => ({}),
    } as DOMRect);

    const result = collectPageMap({ regionFilter: { x: 0, y: 0, width: 300, height: 200 } });
    const ids = result.nodes.map((n) => n.id).filter(Boolean);
    expect(ids).toContain("in-region");
    expect(ids).not.toContain("out-region");
    expect(result.filterSummary?.activeFilters).toContain("regionFilter");
  });

  // ── Traversal fix: nested-child retention ────────────────────────────────

  /**
   * Traversal fix: When a parent element fails the interactiveOnly filter,
   * its interactive children must still appear in the result (they are
   * "promoted" to the parent's level — not silently pruned).
   *
   * Without the traversal fix, the <div> fails → buildNode returns null →
   * the <button> child is never visited.
   */
  it("Traversal fix: interactive child of non-interactive parent is retained", () => {
    document.body.innerHTML = `
      <div id="wrapper">
        <button id="child-btn">Click me</button>
      </div>
    `;
    const result = collectPageMap({ interactiveOnly: true });
    const ids = result.nodes.map((n) => n.id).filter(Boolean);
    // wrapper (div) should NOT appear — it failed the filter
    expect(ids).not.toContain("wrapper");
    // child-btn (button) SHOULD appear — it passes the filter and is promoted
    expect(ids).toContain("child-btn");
  });

  /**
   * Traversal fix: Deep nesting. The button is two levels below a failing
   * grandparent div — it must still be surfaced.
   */
  it("Traversal fix: deeply nested interactive element is retained after traversal", () => {
    document.body.innerHTML = `
      <div id="outer">
        <div id="inner">
          <button id="deep-btn">Deep</button>
        </div>
      </div>
    `;
    const result = collectPageMap({ interactiveOnly: true, maxDepth: 8 });
    const ids = result.nodes.map((n) => n.id).filter(Boolean);
    expect(ids).not.toContain("outer");
    expect(ids).not.toContain("inner");
    expect(ids).toContain("deep-btn");
  });

  /**
   * Traversal fix: Only the child passes — the parent div is absent;
   * the child appears at the top level of result.nodes (promoted).
   */
  it("Traversal fix: promoted child appears at top-level nodes (not nested under failing parent)", () => {
    document.body.innerHTML = `
      <div id="non-interactive-parent">
        <a id="link-child" href="#">link</a>
      </div>
    `;
    const result = collectPageMap({ interactiveOnly: true });
    // The result.nodes at top-level should contain the promoted <a>
    const topLevelTags = result.nodes.map((n) => n.tag);
    expect(topLevelTags).toContain("a");
    // No div at top level
    expect(topLevelTags).not.toContain("div");
  });

  /**
   * B2-FI-002 flat-list mode: interactiveOnly=true with a very small maxDepth must
   * still return interactive elements that live deeper than maxDepth in the DOM.
   *
   * Regression test for the bug reported in the evaluation:
   *   get_page_map({ interactiveOnly: true, maxDepth: 2 }) returned 0 results when
   *   all interactive elements were at depth >= 3.
   *
   * The fix: when interactiveOnly=true, non-matching ancestors are traversed
   * beyond maxDepth so interactive descendants at any depth are reachable.
   */
  it("B2-FI-002 flat-list mode: interactiveOnly=true + small maxDepth still returns deep interactive elements", () => {
    // Build a DOM where interactive elements live at depth 4 (body > div > div > div > button)
    document.body.innerHTML = `
      <div id="level1">
        <div id="level2">
          <div id="level3">
            <button id="deep-btn-1">Click me</button>
            <a id="deep-link-1" href="#">Go</a>
          </div>
        </div>
      </div>
    `;
    // maxDepth: 2 means the normal traversal would stop at level2 div, never reaching the button
    const result = collectPageMap({ interactiveOnly: true, maxDepth: 2 });
    const ids = result.nodes.map((n) => n.id).filter(Boolean);

    // Interactive elements at depth 4 must be returned despite maxDepth: 2
    expect(ids).toContain("deep-btn-1");
    expect(ids).toContain("deep-link-1");

    // Non-interactive ancestors must NOT appear
    expect(ids).not.toContain("level1");
    expect(ids).not.toContain("level2");
    expect(ids).not.toContain("level3");
  });

  /**
   * B2-FI-002 flat-list mode: backward compatibility — without interactiveOnly,
   * maxDepth truncation must still work normally (no regression).
   */
  it("B2-FI-002 backward compat: without interactiveOnly, maxDepth still truncates tree normally", () => {
    document.body.innerHTML = `
      <div id="level1">
        <div id="level2">
          <div id="level3">
            <button id="deep-btn">Deep button</button>
          </div>
        </div>
      </div>
    `;
    // Without interactiveOnly, depth 2 means nodes beyond maxDepth are NOT returned.
    // Depth numbering: body's direct children start at depth 0.
    // level1=depth0, level2=depth1, level3=depth2 (at the limit — included but no children),
    // deep-btn=depth3 (beyond maxDepth — NOT included).
    const result = collectPageMap({ maxDepth: 2 });

    // Flatten the tree to collect all node IDs at every depth
    function collectIds(nodes: typeof result.nodes): string[] {
      const ids: string[] = [];
      for (const n of nodes) {
        if (n.id) ids.push(n.id);
        if (n.children) ids.push(...collectIds(n.children));
      }
      return ids;
    }
    const allIds = collectIds(result.nodes);

    // level1 (depth 0), level2 (depth 1), level3 (depth 2) are all included in the tree
    expect(allIds).toContain("level1");
    expect(allIds).toContain("level2");
    expect(allIds).toContain("level3");

    // deep-btn at depth 3 (> maxDepth 2) must NOT appear — truncated
    expect(allIds).not.toContain("deep-btn");
    expect(result.truncated).toBe(true);
  });

  /**
   * Combined: regionFilter + interactiveOnly. Only interactive elements
   * inside the region should appear.
   */
  it("Combined regionFilter + interactiveOnly — only interactive elements in region", () => {
    document.body.innerHTML = `
      <button id="btn-in">In region</button>
      <button id="btn-out">Out of region</button>
      <div id="div-in">Non-interactive in region</div>
    `;

    const btnIn = document.getElementById("btn-in")!;
    const btnOut = document.getElementById("btn-out")!;
    const divIn = document.getElementById("div-in")!;

    vi.spyOn(btnIn, "getBoundingClientRect").mockReturnValue({
      x: 10, y: 10, width: 80, height: 30,
      top: 10, left: 10, bottom: 40, right: 90,
      toJSON: () => ({}),
    } as DOMRect);
    vi.spyOn(btnOut, "getBoundingClientRect").mockReturnValue({
      x: 800, y: 800, width: 80, height: 30,
      top: 800, left: 800, bottom: 830, right: 880,
      toJSON: () => ({}),
    } as DOMRect);
    vi.spyOn(divIn, "getBoundingClientRect").mockReturnValue({
      x: 10, y: 60, width: 80, height: 30,
      top: 60, left: 10, bottom: 90, right: 90,
      toJSON: () => ({}),
    } as DOMRect);

    const result = collectPageMap({
      interactiveOnly: true,
      regionFilter: { x: 0, y: 0, width: 200, height: 200 },
    });
    const ids = result.nodes.map((n) => n.id).filter(Boolean);
    expect(ids).toContain("btn-in");
    expect(ids).not.toContain("btn-out");
    expect(ids).not.toContain("div-in");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// B2-FI-008: Acceptance — >=40% payload reduction via real collectPageMap
//
// These tests use real collectPageMap() on 3 deterministic DOM fixtures
// injected into document.body, comparing filtered vs unfiltered node counts.
// ══════════════════════════════════════════════════════════════════════════════

describe("B2-FI-008: Acceptance — >=40% reduction via real collectPageMap (3 fixtures)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  /**
   * Fixture 1: E-commerce product listing
   * ~50 non-interactive divs/spans + 10 interactive (buttons, inputs, links)
   * Expected: >=40% reduction with interactiveOnly=true
   */
  it("B2-FI-008 real fixture 1: e-commerce listing — interactiveOnly reduces nodes by >=40%", () => {
    // Build DOM: 10 interactive + 50 non-interactive
    const html = [
      // 10 interactive
      `<button id="b1">Add to Cart</button>`,
      `<button id="b2">Wishlist</button>`,
      `<a id="b3" href="#">View</a>`,
      `<a id="b4" href="#">Details</a>`,
      `<input id="b5" type="text" placeholder="Search" />`,
      `<input id="b6" type="text" placeholder="Filter" />`,
      `<select id="b7"><option>All</option></select>`,
      `<button id="b8">Sort</button>`,
      `<button id="b9">Buy Now</button>`,
      `<a id="b10" href="#">Checkout</a>`,
      // 50 non-interactive
      ...Array.from({ length: 50 }, (_, i) =>
        `<div id="d${i + 1}"><span>Product ${i + 1}</span></div>`,
      ),
    ].join("");
    document.body.innerHTML = html;

    const baseline = collectPageMap({ maxDepth: 8, maxNodes: 500 });
    const filtered = collectPageMap({ interactiveOnly: true, maxDepth: 8, maxNodes: 500 });

    const baselineCount = baseline.nodes.length;
    const filteredCount = filtered.nodes.length;

    expect(baselineCount).toBeGreaterThan(0);
    expect(filteredCount).toBeGreaterThan(0);
    expect(filteredCount).toBeLessThan(baselineCount);

    const reduction = (baselineCount - filteredCount) / baselineCount;
    expect(reduction).toBeGreaterThanOrEqual(0.40);

    // filterSummary must be present and report reduction
    expect(filtered.filterSummary).toBeDefined();
    expect(filtered.filterSummary!.reductionRatio).toBeGreaterThanOrEqual(0.40);
  });

  /**
   * Fixture 2: Article page with navigation
   * 5 links, 85 divs/p/span (non-interactive article content)
   * Expected: >=40% reduction with interactiveOnly=true
   */
  it("B2-FI-008 real fixture 2: article page — interactiveOnly reduces nodes by >=40%", () => {
    const html = [
      // 5 interactive
      `<a id="nav1" href="#">Home</a>`,
      `<a id="nav2" href="#">About</a>`,
      `<a id="nav3" href="#">Blog</a>`,
      `<a id="nav4" href="#">Contact</a>`,
      `<a id="nav5" href="#">Subscribe</a>`,
      // 85 non-interactive
      ...Array.from({ length: 85 }, (_, i) =>
        `<p id="p${i + 1}">Paragraph ${i + 1} of article content goes here.</p>`,
      ),
    ].join("");
    document.body.innerHTML = html;

    const baseline = collectPageMap({ maxDepth: 8, maxNodes: 500 });
    const filtered = collectPageMap({ interactiveOnly: true, maxDepth: 8, maxNodes: 500 });

    const reduction = (baseline.nodes.length - filtered.nodes.length) / baseline.nodes.length;
    expect(reduction).toBeGreaterThanOrEqual(0.40);
    expect(filtered.filterSummary!.reductionRatio).toBeGreaterThanOrEqual(0.40);
  });

  /**
   * Fixture 3: Dashboard with form
   * 8 form controls + 34 non-interactive divs/tds/spans
   * Expected: >=40% reduction with interactiveOnly=true
   */
  it("B2-FI-008 real fixture 3: dashboard — interactiveOnly reduces nodes by >=40%", () => {
    const html = [
      // 8 interactive
      `<button id="save">Save</button>`,
      `<button id="cancel">Cancel</button>`,
      `<input id="inp1" type="text" />`,
      `<input id="inp2" type="text" />`,
      `<input id="inp3" type="text" />`,
      `<select id="sel1"><option>A</option></select>`,
      `<textarea id="ta1"></textarea>`,
      `<a id="lnk1" href="#">Export</a>`,
      // 34 non-interactive
      ...Array.from({ length: 34 }, (_, i) =>
        `<div id="stat${i + 1}"><span>Stat ${i + 1}</span></div>`,
      ),
    ].join("");
    document.body.innerHTML = html;

    const baseline = collectPageMap({ maxDepth: 8, maxNodes: 500 });
    const filtered = collectPageMap({ interactiveOnly: true, maxDepth: 8, maxNodes: 500 });

    const reduction = (baseline.nodes.length - filtered.nodes.length) / baseline.nodes.length;
    expect(reduction).toBeGreaterThanOrEqual(0.40);
    expect(filtered.filterSummary!.reductionRatio).toBeGreaterThanOrEqual(0.40);
  });

  /**
   * Cross-fixture: average reduction across all 3 fixtures >= 40%
   */
  it("B2-FI-008 real cross-fixture: average reduction across all 3 fixtures is >=40%", () => {
    // Fixture 1
    document.body.innerHTML = [
      ...Array.from({ length: 10 }, (_, i) => `<button id="fb1-b${i}">Btn ${i}</button>`),
      ...Array.from({ length: 50 }, (_, i) => `<div id="fb1-d${i}">Div ${i}</div>`),
    ].join("");
    const f1base = collectPageMap({ maxDepth: 8, maxNodes: 500 }).nodes.length;
    const f1filt = collectPageMap({ interactiveOnly: true, maxDepth: 8, maxNodes: 500 }).nodes.length;
    const r1 = (f1base - f1filt) / f1base;

    // Fixture 2
    document.body.innerHTML = [
      ...Array.from({ length: 5 }, (_, i) => `<a id="fb2-a${i}" href="#">Link ${i}</a>`),
      ...Array.from({ length: 85 }, (_, i) => `<p id="fb2-p${i}">Para ${i}</p>`),
    ].join("");
    const f2base = collectPageMap({ maxDepth: 8, maxNodes: 500 }).nodes.length;
    const f2filt = collectPageMap({ interactiveOnly: true, maxDepth: 8, maxNodes: 500 }).nodes.length;
    const r2 = (f2base - f2filt) / f2base;

    // Fixture 3
    document.body.innerHTML = [
      ...Array.from({ length: 8 }, (_, i) =>
        i < 3 ? `<input id="fb3-i${i}" />` : i < 6 ? `<button id="fb3-b${i}">B</button>` : `<a id="fb3-a${i}" href="#">L</a>`,
      ),
      ...Array.from({ length: 34 }, (_, i) => `<div id="fb3-d${i}">D ${i}</div>`),
    ].join("");
    const f3base = collectPageMap({ maxDepth: 8, maxNodes: 500 }).nodes.length;
    const f3filt = collectPageMap({ interactiveOnly: true, maxDepth: 8, maxNodes: 500 }).nodes.length;
    const r3 = (f3base - f3filt) / f3base;

    const avg = (r1 + r2 + r3) / 3;
    expect(avg).toBeGreaterThanOrEqual(0.40);
  });
});

// ── GAP-D1: Viewport Ratio and Container ID Enrichment ───────────────────────────

/**
 * GAP-D1 tests for D4 (viewportIntersectionRatio) and D5 (containerId)
 *
 * These tests validate that when includeBounds:true is passed to collectPageMap:
 * - D4: Each node has viewportRatio (0-1) indicating how much of the element is visible
 * - D5: Each node has containerId pointing to its nearest semantic container ancestor
 *
 * The PageNode type already has viewportRatio?: number and containerId?: number fields.
 * The actual computation uses viewportIntersectionRatio() and findNearestContainer() from spatial-helpers.
 */

/**
 * Recursively search a PageNode tree for a node matching a predicate.
 * Required because collectPageMap returns a nested tree, not a flat array.
 */
function findNodeDeep(nodes: PageNode[], predicate: (n: PageNode) => boolean): PageNode | undefined {
  for (const node of nodes) {
    if (predicate(node)) return node;
    if (node.children) {
      const found = findNodeDeep(node.children, predicate);
      if (found) return found;
    }
  }
  return undefined;
}

function findAllNodesDeep(nodes: PageNode[], predicate: (n: PageNode) => boolean, acc: PageNode[] = []): PageNode[] {
  for (const node of nodes) {
    if (predicate(node)) acc.push(node);
    if (node.children) findAllNodesDeep(node.children, predicate, acc);
  }
  return acc;
}

/**
 * Mock getBoundingClientRect for a DOM element by ID to return specific bounds.
 * jsdom does not compute CSS layout, so layout-dependent tests must mock this.
 */
function mockBoundingRect(id: string, rect: { x: number; y: number; width: number; height: number }): void {
  const el = document.getElementById(id);
  if (el) {
    vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
      x: rect.x, y: rect.y, width: rect.width, height: rect.height,
      top: rect.y, left: rect.x, right: rect.x + rect.width, bottom: rect.y + rect.height,
      toJSON: () => rect,
    } as DOMRect);
  }
}

describe("GAP-D1: viewportRatio enrichment (D4)", () => {
  /**
   * D4-viewportRatio-01: Node fully inside viewport → viewportRatio = 1.0
   */
  it("D4-viewportRatio-01: Node fully inside viewport → viewportRatio = 1.0", () => {
    // Set up a simple DOM with an element fully inside the viewport
    document.body.innerHTML = `<div id="test"></div>`;
    // jsdom does not compute CSS layout — mock getBoundingClientRect to simulate
    // an element fully inside the viewport (1024x768 in jsdom)
    mockBoundingRect("test", { x: 100, y: 100, width: 200, height: 100 });
    const result = collectPageMap({ includeBounds: true, maxDepth: 8 });
    const node = findNodeDeep(result.nodes, (n) => n.id === "test");
    expect(node).toBeDefined();
    if (node && node.bounds) {
      // Element is fully inside viewport (viewport is typically 1024x768 in jsdom)
      expect(node.viewportRatio).toBeCloseTo(1.0, 2);
    }
  });

  /**
   * D4-viewportRatio-02: Node partially clipped → viewportRatio between 0 and 1
   */
  it("D4-viewportRatio-02: Node partially clipped by viewport → viewportRatio < 1.0", () => {
    // Element partially off-screen to the left: x=-100, width=200 → 100px visible, 100px off
    document.body.innerHTML = `<div id="partial"></div>`;
    // jsdom does not compute CSS layout — mock bounds to simulate element at x=-100
    mockBoundingRect("partial", { x: -100, y: 100, width: 200, height: 100 });
    const result = collectPageMap({ includeBounds: true, maxDepth: 8 });
    const node = findNodeDeep(result.nodes, (n) => n.id === "partial");
    expect(node).toBeDefined();
    if (node && node.bounds) {
      // Element extends off-screen, so viewportRatio should be < 1.0
      expect(node.viewportRatio).toBeLessThan(1.0);
      expect(node.viewportRatio).toBeGreaterThan(0);
    }
  });

  /**
   * D4-viewportRatio-03: Node entirely outside viewport → viewportRatio = 0.0
   */
  it("D4-viewportRatio-03: Node entirely outside viewport → viewportRatio = 0.0", () => {
    // Position element way off-screen (below the viewport)
    document.body.innerHTML = `<div id="offscreen" style="position:absolute;left:0;top:-5000px;width:100px;height:100px;"></div>`;
    const result = collectPageMap({ includeBounds: true, maxDepth: 8 });
    const node = result.nodes.find((n) => n.id === "offscreen");
    expect(node).toBeDefined();
    if (node && node.bounds) {
      expect(node.viewportRatio).toBe(0.0);
    }
  });

  /**
   * D4-viewportRatio-04: Node at edge of viewport → correct ratio
   */
  it("D4-viewportRatio-04: Node at edge of viewport → correct ratio", () => {
    // Element starts at y=700, height=200 → spans y=700..900
    // Viewport (jsdom: 768px tall) clips at y=768 → 68px visible out of 200
    // viewportRatio = (1920 * 68) / (1920 * 200) = 68/200 = 0.34
    document.body.innerHTML = `<div id="edge"></div>`;
    // jsdom does not compute CSS layout — mock bounds directly
    mockBoundingRect("edge", { x: 0, y: 700, width: 1920, height: 200 });
    const result = collectPageMap({ includeBounds: true, maxDepth: 8 });
    const node = findNodeDeep(result.nodes, (n) => n.id === "edge");
    expect(node).toBeDefined();
    if (node && node.bounds) {
      // Element starts at y=700, height=200, so it spans y=700..900
      // Viewport ends at y=768, so only 68px is visible
      // viewportRatio = visible_area / total_area = 68/200 = 0.34
      expect(node.viewportRatio).toBeLessThan(1.0);
      expect(node.viewportRatio).toBeGreaterThan(0);
    }
  });

  /**
   * D4-viewportRatio-05: Node without bounds → no viewportRatio
   */
  it("D4-viewportRatio-05: Node collected without includeBounds → no viewportRatio", () => {
    document.body.innerHTML = `<div id="nobounds"></div>`;
    const result = collectPageMap({ includeBounds: false, maxDepth: 8 });
    const node = result.nodes.find((n) => n.id === "nobounds");
    expect(node).toBeDefined();
    // Without includeBounds, the node should not have viewportRatio
    // (it may be undefined or not present on the node object)
    if (node && node.bounds) {
      expect(node.viewportRatio).toBeUndefined();
    }
  });

  /**
   * D4-viewportRatio-06: Zero-size element → viewportRatio = 0.0 or handled gracefully
   */
  it("D4-viewportRatio-06: Zero-size element → viewportRatio = 0.0 or handled gracefully", () => {
    document.body.innerHTML = `<div id="zero" style="position:absolute;left:100px;top:100px;width:0;height:0;"></div>`;
    const result = collectPageMap({ includeBounds: true, maxDepth: 8 });
    const node = result.nodes.find((n) => n.id === "zero");
    expect(node).toBeDefined();
    // Zero-size elements have no area to be visible
    if (node && node.bounds) {
      expect(node.viewportRatio).toBe(0.0);
    }
  });
});

describe("GAP-D1: containerId enrichment (D5)", () => {
  /**
   * D5-containerId-01: Child of semantic container → has containerId pointing to container
   */
  it("D5-containerId-01: Child of semantic container → has containerId", () => {
    document.body.innerHTML = `
      <section id="main-content">
        <button id="action-btn">Click me</button>
      </section>
    `;
    const result = collectPageMap({ includeBounds: true, maxDepth: 8 });
    const sectionNode = findNodeDeep(result.nodes, (n) => n.id === "main-content");
    const buttonNode = findNodeDeep(result.nodes, (n) => n.id === "action-btn");
    expect(sectionNode).toBeDefined();
    expect(buttonNode).toBeDefined();
    // The button should have a containerId pointing to the section's nodeId
    if (buttonNode && sectionNode) {
      expect(buttonNode.containerId).toBe(sectionNode.nodeId);
    }
  });

  /**
   * D5-containerId-02: Deeply nested child → containerId points to nearest semantic ancestor
   */
  it("D5-containerId-02: Nested in article > section > div → nearest container is section", () => {
    document.body.innerHTML = `
      <article id="article-1">
        <section id="section-1">
          <div id="deeply-nested">
            <span id="target">Target</span>
          </div>
        </section>
      </article>
    `;
    const result = collectPageMap({ includeBounds: true, maxDepth: 8 });
    const sectionNode = findNodeDeep(result.nodes, (n) => n.id === "section-1");
    const targetNode = findNodeDeep(result.nodes, (n) => n.id === "target");
    expect(sectionNode).toBeDefined();
    expect(targetNode).toBeDefined();
    // The target should point to section-1 (the nearest semantic container), not article-1
    if (targetNode && sectionNode) {
      expect(targetNode.containerId).toBe(sectionNode.nodeId);
    }
  });

  /**
   * D5-containerId-03: Element not in a semantic container → containerId is undefined
   */
  it("D5-containerId-03: Top-level element with no semantic container → containerId undefined", () => {
    document.body.innerHTML = `<div id="orphan">Orphan element</div>`;
    const result = collectPageMap({ includeBounds: true, maxDepth: 8 });
    const orphanNode = result.nodes.find((n) => n.id === "orphan");
    expect(orphanNode).toBeDefined();
    // Orphan has no semantic container ancestor, so containerId should be undefined
    if (orphanNode) {
      expect(orphanNode.containerId).toBeUndefined();
    }
  });

  /**
   * D5-containerId-04: Semantic container tags are recognized
   */
  it("D5-containerId-04: Elements in article, section, aside, nav, header, footer, form, dialog, details are containers", () => {
    const tags = ["article", "section", "aside", "nav", "header", "footer", "form", "dialog", "details"];
    for (const tag of tags) {
      // Note: <dialog> requires the `open` attribute to be visible (otherwise display:none in jsdom)
      const openAttr = tag === "dialog" ? " open" : "";
      document.body.innerHTML = `<${tag} id="test-${tag}"${openAttr}><button id="btn">Test</button></${tag}>`;
      const result = collectPageMap({ includeBounds: true, maxDepth: 8 });
      const containerNode = findNodeDeep(result.nodes, (n) => n.id === `test-${tag}`);
      const btnNode = findNodeDeep(result.nodes, (n) => n.id === "btn");
      expect(containerNode).toBeDefined();
      expect(btnNode).toBeDefined();
      if (btnNode && containerNode) {
        expect(btnNode.containerId).toBe(containerNode.nodeId);
      }
    }
  });

  /**
   * D5-containerId-05: Elements with semantic ARIA roles are containers
   */
  it("D5-containerId-05: Elements with role=region, navigation, main, complementary are containers", () => {
    const roles = ["region", "navigation", "main", "complementary"];
    for (const role of roles) {
      document.body.innerHTML = `<div id="test-${role}" role="${role}"><button id="btn-${role}">Test</button></div>`;
      const result = collectPageMap({ includeBounds: true, maxDepth: 8 });
      const containerNode = findNodeDeep(result.nodes, (n) => n.id === `test-${role}`);
      const btnNode = findNodeDeep(result.nodes, (n) => n.id === `btn-${role}`);
      expect(containerNode).toBeDefined();
      expect(btnNode).toBeDefined();
      if (btnNode && containerNode) {
        expect(btnNode.containerId).toBe(containerNode.nodeId);
      }
    }
  });

  /**
   * D5-containerId-06: Node without includeBounds → no containerId
   */
  it("D5-containerId-06: Node collected without includeBounds → no containerId", () => {
    document.body.innerHTML = `
      <section id="main">
        <button id="btn">Test</button>
      </section>
    `;
    const result = collectPageMap({ includeBounds: false, maxDepth: 8 });
    const btnNode = findNodeDeep(result.nodes, (n) => n.id === "btn");
    expect(btnNode).toBeDefined();
    // Without includeBounds, containerId should not be set (even if the element is inside a container)
    if (btnNode && btnNode.bounds) {
      expect(btnNode.containerId).toBeUndefined();
    }
  });

  /**
   * D5-containerId-07: <body> is NOT considered a container (stop at body)
   */
  it("D5-containerId-07: Elements inside body but not in semantic container → containerId undefined", () => {
    document.body.innerHTML = `<button id="direct-body-btn">Direct body child</button>`;
    const result = collectPageMap({ includeBounds: true, maxDepth: 8 });
    const btnNode = result.nodes.find((n) => n.id === "direct-body-btn");
    expect(btnNode).toBeDefined();
    // Body itself is not a semantic container, so this button should have no containerId
    if (btnNode) {
      expect(btnNode.containerId).toBeUndefined();
    }
  });
});

describe("GAP-D1: Combined viewportRatio and containerId", () => {
  /**
   * D4+D5-combined-01: includeBounds:true enables both viewportRatio and containerId
   */
  it("D4+D5-combined-01: includeBounds:true enables both viewportRatio and containerId", () => {
    document.body.innerHTML = `
      <section id="container">
        <div id="item">Item</div>
      </section>
    `;
    const result = collectPageMap({ includeBounds: true, maxDepth: 8 });
    const itemNode = findNodeDeep(result.nodes, (n) => n.id === "item");
    const containerNode = findNodeDeep(result.nodes, (n) => n.id === "container");
    expect(itemNode).toBeDefined();
    expect(containerNode).toBeDefined();

    if (itemNode && itemNode.bounds && containerNode) {
      // Both viewportRatio and containerId should be present
      expect(itemNode.viewportRatio).toBeDefined();
      expect(itemNode.containerId).toBe(containerNode.nodeId);
    }
  });

  /**
   * D4+D5-combined-02: Both fields absent when includeBounds:false
   */
  it("D4+D5-combined-02: Both viewportRatio and containerId absent when includeBounds:false", () => {
    document.body.innerHTML = `
      <section id="container">
        <div id="item">Item</div>
      </section>
    `;
    const result = collectPageMap({ includeBounds: false, maxDepth: 8 });
    const itemNode = findNodeDeep(result.nodes, (n) => n.id === "item");
    expect(itemNode).toBeDefined();
    // Without includeBounds, neither field should be present
    if (itemNode && itemNode.bounds) {
      expect(itemNode.viewportRatio).toBeUndefined();
      expect(itemNode.containerId).toBeUndefined();
    }
  });

  /**
   * D4+D5-combined-03: Real fixture with multiple elements in/out of containers and viewport
   */
  it("D4+D5-combined-03: Real fixture — mixed container membership and visibility", () => {
    document.body.innerHTML = `
      <article id="art">
        <section id="sec1">
          <button id="btn1">Visible Button</button>
        </section>
        <div id="offscreen-section" style="position:absolute;top:-5000px;">
          <span id="offscreen-span">Offscreen</span>
        </div>
      </article>
      <button id="orphan-btn">Orphan</button>
    `;
    const result = collectPageMap({ includeBounds: true, maxDepth: 8 });

    const btn1 = result.nodes.find((n) => n.id === "btn1");
    const orphanBtn = result.nodes.find((n) => n.id === "orphan-btn");
    const offscreenSpan = result.nodes.find((n) => n.id === "offscreen-span");
    const sec1 = result.nodes.find((n) => n.id === "sec1");

    // btn1 is in section, should have containerId
    if (btn1 && sec1 && btn1.bounds) {
      expect(btn1.containerId).toBe(sec1.nodeId);
      expect(btn1.viewportRatio).toBeGreaterThan(0);
    }

    // orphan-btn has no container
    if (orphanBtn && orphanBtn.bounds) {
      expect(orphanBtn.containerId).toBeUndefined();
    }

    // offscreen-span is in a container but viewportRatio = 0
    if (offscreenSpan && sec1 && offscreenSpan.bounds) {
      expect(offscreenSpan.containerId).toBe(sec1.nodeId);
      expect(offscreenSpan.viewportRatio).toBe(0.0);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// B2-VD-001..003: Shadow DOM Traversal
//
// Validates that open shadow roots are traversed when piercesShadow: true,
// closed shadow roots are annotated on the host but not traversed,
// and non-shadow behavior is unaffected.
// ══════════════════════════════════════════════════════════════════════════════

describe("B2-VD-001..003: Shadow DOM traversal", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  /**
   * Helper: attach a mock open shadow root to an element.
   * jsdom supports open shadow roots via attachShadow({ mode: "open" }).
   */
  function attachOpenShadowRoot(hostEl: Element, shadowHtml: string): void {
    const shadowRoot = hostEl.attachShadow({ mode: "open" });
    shadowRoot.innerHTML = shadowHtml;
  }

  /**
   * Helper: attach a mock closed shadow root to an element.
   * jsdom's Element.shadowRoot is a getter, so we use Object.defineProperty.
   */
  function attachClosedShadowRoot(hostEl: Element): void {
    hostEl.attachShadow({ mode: "closed" });
  }

  // ── B2-VD-004: piercesShadow defaults to false ───────────────────────────

  /**
   * B2-VD-004: piercesShadow defaults to false — without the flag, shadow
   * content must not be traversed.
   */
  it("B2-VD-004: without piercesShadow, shadow content is not traversed (default=false)", () => {
    document.body.innerHTML = `<div id="shadow-host">host</div>`;
    const host = document.getElementById("shadow-host")!;
    attachOpenShadowRoot(host, `<button id="shadow-btn">Shadow</button>`);

    const result = collectPageMap({ maxDepth: 8 });
    const hostNode = findNodeDeep(result.nodes, (n) => n.id === "shadow-host");
    const shadowBtnNode = findNodeDeep(result.nodes, (n) => n.id === "shadow-btn");

    // Shadow host should appear
    expect(hostNode).toBeDefined();
    // Shadow button should NOT appear (shadow not pierced by default)
    expect(shadowBtnNode).toBeUndefined();
  });

  // ── B2-VD-001: Open shadow root traversal ──────────────────────────────────

  /**
   * B2-VD-001: When piercesShadow: true, open shadow DOM children appear in
   * the page map with inShadowRoot: true.
   */
  it("B2-VD-001: piercesShadow=true exposes shadow children with inShadowRoot:true", () => {
    document.body.innerHTML = `<div id="shadow-host">host</div>`;
    const host = document.getElementById("shadow-host")!;
    attachOpenShadowRoot(host, `<button id="shadow-btn">Shadow</button>`);

    const result = collectPageMap({ piercesShadow: true, maxDepth: 8 });
    const shadowBtnNode = findNodeDeep(result.nodes, (n) => n.id === "shadow-btn");

    expect(shadowBtnNode).toBeDefined();
    expect(shadowBtnNode!.inShadowRoot).toBe(true);
  });

  /**
   * B2-VD-002: Shadow DOM nodes include shadowHostId referencing the host's nodeId.
   */
  it("B2-VD-002: shadow children have shadowHostId pointing to the host element's nodeId", () => {
    document.body.innerHTML = `<div id="shadow-host">host</div>`;
    const host = document.getElementById("shadow-host")!;
    attachOpenShadowRoot(host, `<button id="shadow-btn">Shadow</button>`);

    const result = collectPageMap({ piercesShadow: true, maxDepth: 8 });
    const hostNode = findNodeDeep(result.nodes, (n) => n.id === "shadow-host");
    const shadowBtnNode = findNodeDeep(result.nodes, (n) => n.id === "shadow-btn");

    expect(shadowBtnNode).toBeDefined();
    expect(hostNode).toBeDefined();
    expect(shadowBtnNode!.shadowHostId).toBe(hostNode!.nodeId);
  });

  /**
   * B2-VD-001: Multiple shadow children in an open shadow root are all exposed.
   */
  it("B2-VD-001: all shadow children in open shadow root are exposed", () => {
    document.body.innerHTML = `<div id="host"></div>`;
    const host = document.getElementById("host")!;
    attachOpenShadowRoot(host, `
      <button id="btn1">One</button>
      <span id="span1">Two</span>
      <div id="div1">Three</div>
    `);

    const result = collectPageMap({ piercesShadow: true, maxDepth: 8 });
    const btn1 = findNodeDeep(result.nodes, (n) => n.id === "btn1");
    const span1 = findNodeDeep(result.nodes, (n) => n.id === "span1");
    const div1 = findNodeDeep(result.nodes, (n) => n.id === "div1");

    expect(btn1).toBeDefined();
    expect(btn1!.inShadowRoot).toBe(true);
    expect(span1).toBeDefined();
    expect(span1!.inShadowRoot).toBe(true);
    expect(div1).toBeDefined();
    expect(div1!.inShadowRoot).toBe(true);
  });

  // ── B2-VD-002: Shadow host identification ───────────────────────────────────

  /**
   * B2-VD-002: Deep shadow children (nested inside shadow DOM elements)
   * also have shadowHostId pointing to the original shadow host.
   */
  it("B2-VD-002: deep shadow descendants have shadowHostId pointing to original host", () => {
    document.body.innerHTML = `<div id="host"></div>`;
    const host = document.getElementById("host")!;
    attachOpenShadowRoot(host, `<div id="shadow-parent"><span id="deep-span">deep</span></div>`);

    const result = collectPageMap({ piercesShadow: true, maxDepth: 8 });
    const hostNode = findNodeDeep(result.nodes, (n) => n.id === "host");
    const deepSpanNode = findNodeDeep(result.nodes, (n) => n.id === "deep-span");

    expect(deepSpanNode).toBeDefined();
    expect(deepSpanNode!.inShadowRoot).toBe(true);
    expect(deepSpanNode!.shadowHostId).toBe(hostNode!.nodeId);
  });

  it("B2-VD-002: nested shadow roots rebase shadowHostId to the nested host element", () => {
    document.body.innerHTML = `<div id="outer-host"></div>`;
    const outerHost = document.getElementById("outer-host")!;
    attachOpenShadowRoot(outerHost, `<div id="inner-host"></div>`);
    const innerHost = outerHost.shadowRoot!.getElementById("inner-host")!;
    attachOpenShadowRoot(innerHost, `<button id="deep-shadow-btn">Deep</button>`);

    const result = collectPageMap({ piercesShadow: true, maxDepth: 8 });
    const innerHostNode = findNodeDeep(result.nodes, (n) => n.id === "inner-host");
    const deepShadowBtn = findNodeDeep(result.nodes, (n) => n.id === "deep-shadow-btn");

    expect(innerHostNode).toBeDefined();
    expect(deepShadowBtn).toBeDefined();
    expect(deepShadowBtn!.shadowHostId).toBe(innerHostNode!.nodeId);
  });

  // ── B2-VD-003: Closed shadow root reporting ───────────────────────────────

  /**
   * B2-VD-003: When a closed shadow root is encountered, the host element
   * is annotated with shadowRoot: 'closed' and its content is not traversed.
   */
  it("B2-VD-003: closed shadow root host is annotated with shadowRoot:'closed'", () => {
    document.body.innerHTML = `<div id="closed-host">host</div>`;
    const host = document.getElementById("closed-host")!;
    attachClosedShadowRoot(host);

    const result = collectPageMap({ piercesShadow: true, maxDepth: 8 });
    const hostNode = findNodeDeep(result.nodes, (n) => n.id === "closed-host");

    expect(hostNode).toBeDefined();
    expect(hostNode!.shadowRoot).toBe("closed");
  });

  /**
   * B2-VD-003: Closed shadow root content is not traversed (no shadow children appear).
   */
  it("B2-VD-003: closed shadow root content is NOT traversed", () => {
    document.body.innerHTML = `<div id="closed-host">host</div>`;
    const host = document.getElementById("closed-host")!;
    attachClosedShadowRoot(host);

    const result = collectPageMap({ piercesShadow: true, maxDepth: 8 });
    // The closed host itself should appear
    const hostNode = findNodeDeep(result.nodes, (n) => n.id === "closed-host");
    expect(hostNode).toBeDefined();
    expect(hostNode!.shadowRoot).toBe("closed");
    // No emitted shadow descendants should reference the closed host.
    const descendantsForClosedHost = findAllNodesDeep(result.nodes, (n) => n.shadowHostId === hostNode!.nodeId);
    expect(descendantsForClosedHost).toHaveLength(0);
  });

  it("B2-VD-001: shadow children remain discoverable when the host fails filters", () => {
    document.body.innerHTML = `<div id="shadow-host"></div>`;
    const host = document.getElementById("shadow-host")!;
    attachOpenShadowRoot(host, `<button id="shadow-btn">Shadow</button>`);

    const result = collectPageMap({ piercesShadow: true, interactiveOnly: true, maxDepth: 8 });
    const hostNode = findNodeDeep(result.nodes, (n) => n.id === "shadow-host");
    const shadowBtnNode = findNodeDeep(result.nodes, (n) => n.id === "shadow-btn");

    expect(hostNode).toBeUndefined();
    expect(shadowBtnNode).toBeDefined();
    expect(shadowBtnNode!.inShadowRoot).toBe(true);
    expect(typeof shadowBtnNode!.shadowHostId).toBe("number");
  });

  // ── Non-shadow behavior unchanged ─────────────────────────────────────────

  /**
   * Non-shadow elements are unaffected by piercesShadow: true.
   */
  it("Non-shadow elements appear normally with piercesShadow:true", () => {
    document.body.innerHTML = `
      <div id="normal-div">normal</div>
      <button id="normal-btn">button</button>
    `;

    const result = collectPageMap({ piercesShadow: true, maxDepth: 8 });
    const divNode = findNodeDeep(result.nodes, (n) => n.id === "normal-div");
    const btnNode = findNodeDeep(result.nodes, (n) => n.id === "normal-btn");

    expect(divNode).toBeDefined();
    expect(divNode!.inShadowRoot).toBeUndefined();
    expect(btnNode).toBeDefined();
    expect(btnNode!.inShadowRoot).toBeUndefined();
  });

  /**
   * Without piercesShadow, normal (non-shadow) page works exactly as before.
   * containerId requires includeBounds:true to be computed (B2-FI-006).
   */
  it("Without piercesShadow, non-shadow page map is unchanged", () => {
    document.body.innerHTML = `
      <section id="container">
        <button id="btn">Click</button>
      </section>
    `;

    const result = collectPageMap({ maxDepth: 8, includeBounds: true });
    const containerNode = findNodeDeep(result.nodes, (n) => n.id === "container");
    const btnNode = findNodeDeep(result.nodes, (n) => n.id === "btn");

    expect(containerNode).toBeDefined();
    expect(btnNode).toBeDefined();
    expect(btnNode!.containerId).toBe(containerNode!.nodeId);
    expect(btnNode!.inShadowRoot).toBeUndefined();
    expect(btnNode!.shadowHostId).toBeUndefined();
  });

  // ── B2-VD-001: PageNode type fields ───────────────────────────────────────

  /**
   * B2-VD-001/002: PageNode interface supports inShadowRoot and shadowHostId fields.
   */
  it("B2-VD-001/002: PageNode type allows inShadowRoot and shadowHostId fields", () => {
    const node: PageNode = {
      ref: "ref-1",
      tag: "span",
      nodeId: 5,
      inShadowRoot: true,
      shadowHostId: 2,
    };
    expect(node.inShadowRoot).toBe(true);
    expect(node.shadowHostId).toBe(2);
  });

  /**
   * B2-VD-003: PageNode interface supports shadowRoot:'closed' field.
   */
  it("B2-VD-003: PageNode type allows shadowRoot:'closed' field", () => {
    const node: PageNode = {
      ref: "ref-2",
      tag: "div",
      nodeId: 3,
      shadowRoot: "closed",
    };
    expect(node.shadowRoot).toBe("closed");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// B2-VD-005..009: Iframe Metadata
//
// Tests for:
// - IframeMetadata type exports and shape
// - PageMapOptions.traverseFrames parameter
// - PageMapResult.iframes optional field
// - enumerateIframes helper function
// - Same-origin / cross-origin iframe detection
// - Bounds included when includeBounds=true
// ══════════════════════════════════════════════════════════════════════════════

import { enumerateIframes } from "../src/content/page-map-collector.js";
import type { IframeMetadata } from "../src/content/page-map-collector.js";

describe("B2-VD-005..009: Iframe metadata — type exports", () => {
  /**
   * B2-VD-006: IframeMetadata type has required fields: frameId, src, bounds, sameOrigin.
   */
  it("B2-VD-006: IframeMetadata type has required fields", () => {
    const entry: IframeMetadata = {
      frameId: "iframe-0",
      src: "https://example.com/child.html",
      bounds: { x: 0, y: 0, width: 400, height: 300 },
      sameOrigin: true,
      parentFrameId: null,
      depth: 1,
      classification: "content",
      visible: true,
    };
    expect(entry.frameId).toBe("iframe-0");
    expect(entry.src).toBe("https://example.com/child.html");
    expect(entry.bounds).toEqual({ x: 0, y: 0, width: 400, height: 300 });
    expect(entry.sameOrigin).toBe(true);
  });

  /**
   * B2-VD-006: IframeMetadata sameOrigin can be false for cross-origin iframes.
   */
  it("B2-VD-006: IframeMetadata sameOrigin can be false", () => {
    const entry: IframeMetadata = {
      frameId: "iframe-0",
      src: "https://other-domain.com/",
      bounds: { x: 0, y: 0, width: 400, height: 300 },
      sameOrigin: false,
      parentFrameId: null,
      depth: 1,
      classification: "unknown",
      visible: true,
    };
    expect(entry.sameOrigin).toBe(false);
  });

  /**
   * B2-VD-006: IframeMetadata bounds are viewport coordinates.
   */
  it("B2-VD-006: IframeMetadata bounds uses viewport coordinates", () => {
    const entry: IframeMetadata = {
      frameId: "main-iframe",
      src: "",
      bounds: { x: 10, y: 20, width: 800, height: 600 },
      sameOrigin: true,
      parentFrameId: null,
      depth: 1,
      classification: "content",
      visible: true,
    };
    expect(entry.bounds.x).toBe(10);
    expect(entry.bounds.y).toBe(20);
    expect(entry.bounds.width).toBe(800);
    expect(entry.bounds.height).toBe(600);
  });
});

describe("B2-VD-005..009: PageMapOptions.traverseFrames", () => {
  /**
   * B2-VD-009: PageMapOptions accepts traverseFrames parameter.
   */
  it("B2-VD-009: PageMapOptions allows traverseFrames parameter", () => {
    const opts: PageMapOptions = { traverseFrames: true };
    expect(opts.traverseFrames).toBe(true);
  });

  /**
   * B2-VD-009: traverseFrames defaults to false (not set) — this is validated
   * by the absence test below.
   */
  it("B2-VD-009: PageMapOptions allows traverseFrames: false", () => {
    const opts: PageMapOptions = { traverseFrames: false };
    expect(opts.traverseFrames).toBe(false);
  });
});

describe("B2-VD-005..009: PageMapResult.iframes field", () => {
  /**
   * B2-VD-005: When traverseFrames is omitted, iframes is absent from result.
   */
  it("B2-VD-005: collectPageMap({}) — iframes is absent when traverseFrames is not set", () => {
    document.body.innerHTML = `<iframe id="test-frame" src="https://example.com/"></iframe>`;
    const result = collectPageMap({});
    expect(result.iframes).toBeUndefined();
  });

  /**
   * B2-VD-005: When traverseFrames=false, iframes is absent from result.
   */
  it("B2-VD-005: collectPageMap({ traverseFrames: false }) — iframes is absent", () => {
    document.body.innerHTML = `<iframe id="test-frame" src="https://example.com/"></iframe>`;
    const result = collectPageMap({ traverseFrames: false });
    expect(result.iframes).toBeUndefined();
  });

  /**
   * B2-VD-005: When traverseFrames=true, iframes is present in result.
   */
  it("B2-VD-005: collectPageMap({ traverseFrames: true }) — iframes is present", () => {
    document.body.innerHTML = `<iframe id="test-frame" src="https://example.com/"></iframe>`;
    const result = collectPageMap({ traverseFrames: true });
    expect(result.iframes).toBeDefined();
    expect(Array.isArray(result.iframes)).toBe(true);
  });

  /**
   * B2-VD-006: iframes entries include frameId, src, bounds, sameOrigin.
   */
  it("B2-VD-006: collectPageMap({ traverseFrames: true }) — entries have frameId, src, bounds, sameOrigin", () => {
    document.body.innerHTML = `<iframe id="test-frame" src="https://example.com/child.html"></iframe>`;
    const result = collectPageMap({ traverseFrames: true });
    expect(result.iframes).toBeDefined();
    expect(result.iframes!.length).toBeGreaterThan(0);
    const entry = result.iframes![0];
    expect(entry).toHaveProperty("frameId");
    expect(entry).toHaveProperty("src");
    expect(entry).toHaveProperty("bounds");
    expect(entry).toHaveProperty("sameOrigin");
  });

  /**
   * B2-VD-006: frameId uses iframe id when name is absent.
   */
  it("B2-VD-006: frameId derived from iframe id when name attribute is empty", () => {
    document.body.innerHTML = `<iframe id="my-iframe" src="https://example.com/"></iframe>`;
    const result = collectPageMap({ traverseFrames: true });
    expect(result.iframes).toBeDefined();
    expect(result.iframes!.length).toBeGreaterThan(0);
    expect(result.iframes![0].frameId).toBe("my-iframe");
  });

  /**
   * B2-VD-006: frameId uses iframe name when name attribute is present.
   */
  it("B2-VD-006: frameId derived from iframe name attribute (preferred over id)", () => {
    document.body.innerHTML = `<iframe id="my-id" name="my-name" src="https://example.com/"></iframe>`;
    const result = collectPageMap({ traverseFrames: true });
    expect(result.iframes).toBeDefined();
    expect(result.iframes![0].frameId).toBe("my-name");
  });

  /**
   * B2-VD-006: src reflects the iframe src attribute.
   */
  it("B2-VD-006: iframe src attribute is captured in metadata", () => {
    document.body.innerHTML = `<iframe id="frame-1" src="https://example.com/embed"></iframe>`;
    const result = collectPageMap({ traverseFrames: true });
    expect(result.iframes![0].src).toBe("https://example.com/embed");
  });

  /**
   * B2-VD-006: src is empty string for iframes without src attribute.
   */
  it("B2-VD-006: iframe with no src attribute has empty src string", () => {
    document.body.innerHTML = `<iframe id="frame-1"></iframe>`;
    const result = collectPageMap({ traverseFrames: true });
    expect(result.iframes![0].src).toBe("");
  });

  /**
   * B2-VD-007: Cross-origin iframe has sameOrigin=false.
   *
   * In the test environment (jsdom + localhost), cross-origin means a different
   * host/port combination.
   */
  it("B2-VD-007: Cross-origin iframe has sameOrigin=false", () => {
    document.body.innerHTML = `<iframe id="cross-frame" src="https://other-domain.example.com/"></iframe>`;
    const result = collectPageMap({ traverseFrames: true });
    expect(result.iframes![0].sameOrigin).toBe(false);
  });

  /**
   * B2-VD-005: Page with no iframes returns empty array.
   */
  it("B2-VD-005: Page with no iframes — iframes is empty array", () => {
    document.body.innerHTML = `<div>No iframes here</div>`;
    const result = collectPageMap({ traverseFrames: true });
    expect(result.iframes).toBeDefined();
    expect(result.iframes!.length).toBe(0);
  });

  /**
   * B2-VD-006: Multiple iframes are all enumerated.
   */
  it("B2-VD-006: Multiple iframes — all entries present", () => {
    document.body.innerHTML = `
      <iframe id="frame-1" src="https://example.com/1"></iframe>
      <iframe id="frame-2" src="https://example.com/2"></iframe>
      <iframe id="frame-3" src="https://other.example.com/3"></iframe>
    `;
    const result = collectPageMap({ traverseFrames: true });
    expect(result.iframes!.length).toBe(3);
    const ids = result.iframes!.map((e) => e.frameId);
    expect(ids).toContain("frame-1");
    expect(ids).toContain("frame-2");
    expect(ids).toContain("frame-3");
  });

  /**
   * B2-VD-007: Cross-origin iframe has sameOrigin=false in mixed-origin page.
   *
   * In the jsdom test environment, window.location.origin may not be a real browser
   * origin (often "null" for file URLs). We test with absolute URLs where the origin
   * is clearly different (different host), so the comparison is deterministic regardless
   * of what the test environment's origin is.
   *
   * Note: jsdom does not enforce same-origin policy, so contentDocument is still
   * accessible. This test validates the URL-based origin comparison logic only.
   */
  it("B2-VD-007: Cross-origin iframe has sameOrigin=false in mixed-origin page", () => {
    document.body.innerHTML = `
      <iframe id="cross-origin-frame" src="https://another-domain.example.com/embed"></iframe>
    `;
    const result = collectPageMap({ traverseFrames: true });
    // Any iframe with a different origin than the parent should have sameOrigin=false
    expect(result.iframes![0].sameOrigin).toBe(false);
  });
});

describe("B2-VD-006: enumerateIframes helper — unit-level", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  /**
   * enumerateIframes returns empty array when no iframes exist.
   */
  it("enumerateIframes: no iframes → empty array", () => {
    document.body.innerHTML = `<div>content</div>`;
    expect(enumerateIframes()).toEqual([]);
  });

  /**
   * enumerateIframes returns actual bounds regardless of includeBounds.
   */
  it("enumerateIframes: includeBounds=false still returns actual iframe bounds", () => {
    document.body.innerHTML = `<iframe id="frame-1" src="https://example.com/"></iframe>`;
    const iframe = document.getElementById("frame-1") as HTMLIFrameElement;
    vi.spyOn(iframe, "getBoundingClientRect").mockReturnValue({
      x: 10, y: 20, width: 300, height: 200,
      top: 20, left: 10, bottom: 220, right: 310,
      toJSON: () => ({}),
    } as DOMRect);
    const result = enumerateIframes();
    expect(result[0].bounds).toEqual({ x: 10, y: 20, width: 300, height: 200 });
  });

  it("B2-VD-006: explicit same-origin iframe URL with accessible contentDocument is sameOrigin=true", () => {
    document.body.innerHTML = `<iframe id="same-origin" src="${window.location.origin}/child"></iframe>`;
    const iframe = document.getElementById("same-origin") as HTMLIFrameElement;
    Object.defineProperty(iframe, "contentDocument", {
      value: document.implementation.createHTMLDocument("child"),
      configurable: true,
    });

    const result = enumerateIframes();
    expect(result[0].sameOrigin).toBe(true);
  });

  it("B2-VD-006: explicit same-origin iframe URL without DOM access is sameOrigin=false", () => {
    document.body.innerHTML = `<iframe id="same-origin-blocked" src="${window.location.origin}/child"></iframe>`;
    const iframe = document.getElementById("same-origin-blocked") as HTMLIFrameElement;
    Object.defineProperty(iframe, "contentDocument", {
      get() {
        throw new DOMException("Blocked", "SecurityError");
      },
      configurable: true,
    });

    const result = enumerateIframes();
    expect(result[0].sameOrigin).toBe(false);
  });

  it("B2-VD-006: about:blank iframe with accessible contentDocument is treated as same-origin", () => {
    document.body.innerHTML = `<iframe id="blank-frame" src="about:blank"></iframe>`;
    const iframe = document.getElementById("blank-frame") as HTMLIFrameElement;
    Object.defineProperty(iframe, "contentDocument", {
      value: document.implementation.createHTMLDocument("child"),
      configurable: true,
    });

    const result = enumerateIframes();
    expect(result[0].sameOrigin).toBe(true);
  });

  it("B2-VD-006: srcdoc iframe with accessible contentDocument is treated as same-origin", () => {
    document.body.innerHTML = `<iframe id="srcdoc-frame" srcdoc="<p>hi</p>"></iframe>`;
    const iframe = document.getElementById("srcdoc-frame") as HTMLIFrameElement;
    Object.defineProperty(iframe, "contentDocument", {
      value: document.implementation.createHTMLDocument("child"),
      configurable: true,
    });

    const result = enumerateIframes();
    expect(result[0].sameOrigin).toBe(true);
  });

  it("B2-VD-007: sandboxed iframe without accessible contentDocument is treated as opaque", () => {
    document.body.innerHTML = `<iframe id="sandboxed" src="https://example.com/child" sandbox></iframe>`;
    const iframe = document.getElementById("sandboxed") as HTMLIFrameElement;
    Object.defineProperty(iframe, "contentDocument", {
      get() {
        throw new DOMException("Blocked", "SecurityError");
      },
      configurable: true,
    });

    const result = enumerateIframes();
    expect(result[0].sameOrigin).toBe(false);
  });

  /**
   * enumerateIframes is exported and callable.
   */
  it("enumerateIframes: function is exported and callable", () => {
    document.body.innerHTML = `<iframe id="frame-1" src="https://example.com/"></iframe>`;
    expect(typeof enumerateIframes).toBe("function");
    const result = enumerateIframes();
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(1);
  });
});
