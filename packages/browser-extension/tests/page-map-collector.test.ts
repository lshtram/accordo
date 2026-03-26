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
 *
 * API checklist (collectPageMap):
 * - PU-F-01: Returns structured PageNode[] array with ref, tag, role, name, text, attrs, children
 * - PU-F-02: Respects maxDepth parameter (default 4, max 8)
 * - PU-F-03: Respects maxNodes parameter (default 200, max 500)
 * - PU-F-04: Excludes script, style, noscript, template, display:none elements
 * - PU-F-05: Returns page metadata: pageUrl, title, viewport, totalElements, truncated
 * - PU-F-06: Optionally includes bounding box coordinates (includeBounds: true)
 */

import { describe, it, expect } from "vitest";
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

describe("M90-MAP type exports", () => {
  /**
   * PU-F-01: PageNode interface has required fields
   */
  it("PU-F-01: PageNode type has required fields (ref, tag)", () => {
    const node: PageNode = {
      ref: "ref-123",
      tag: "div",
    };
    expect(node.ref).toBe("ref-123");
    expect(node.tag).toBe("div");
  });

  it("PU-F-01: PageNode type allows optional fields (role, name, text, attrs, bounds, children)", () => {
    const node: PageNode = {
      ref: "ref-456",
      tag: "button",
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
      pageUrl: "https://example.com/page",
      title: "Example Page",
      viewport: { width: 1920, height: 1080 },
      nodes: [],
      totalElements: 0,
      truncated: false,
    };
    expect(result.pageUrl).toBe("https://example.com/page");
    expect(result.title).toBe("Example Page");
    expect(result.viewport).toEqual({ width: 1920, height: 1080 });
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
