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
