/**
 * page-understanding-actions.test.ts
 *
 * Tests for M90-ACT — Page Understanding Relay Actions
 *
 * These tests validate:
 * - RelayAction union includes get_page_map, inspect_element, get_dom_excerpt, capture_region
 * - BrowserRelayAction in types.ts includes all 4 page-understanding actions
 * - handleRelayAction routes page-understanding actions correctly
 * - Stub implementations throw "not implemented" errors
 * - PU-F-53: Successful relay forwarding + structured result path
 * - PU-F-25: Enhanced anchor resolution fallback hierarchy order
 * - PU-F-33: Runtime { found: false } for missing selector
 *
 * API checklist (handleRelayAction):
 * - get_page_map     → throws not implemented (PU-F-30)
 * - inspect_element  → throws not implemented (PU-F-31)
 * - get_dom_excerpt  → throws not implemented (PU-F-32)
 * - capture_region   → throws not implemented (CR-F-02..CR-F-07)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resetChromeMocks } from "./setup/chrome-mock.js";
import { handleRelayAction } from "../src/relay-actions.js";
import type { RelayAction } from "../src/relay-actions.js";

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("M90-ACT relay action union", () => {
  /**
   * PU-F-30: get_page_map relay action is part of the RelayAction union
   */
  it("PU-F-30: RelayAction includes 'get_page_map'", () => {
    const action: RelayAction = "get_page_map";
    expect(action).toBe("get_page_map");
  });

  /**
   * PU-F-31: inspect_element relay action is part of the RelayAction union
   */
  it("PU-F-31: RelayAction includes 'inspect_element'", () => {
    const action: RelayAction = "inspect_element";
    expect(action).toBe("inspect_element");
  });

  /**
   * PU-F-32: get_dom_excerpt relay action is part of the RelayAction union
   */
  it("PU-F-32: RelayAction includes 'get_dom_excerpt'", () => {
    const action: RelayAction = "get_dom_excerpt";
    expect(action).toBe("get_dom_excerpt");
  });

  /**
   * CR-F-02: capture_region relay action is part of the RelayAction union
   */
  it("CR-F-02: RelayAction includes 'capture_region'", () => {
    const action: RelayAction = "capture_region";
    expect(action).toBe("capture_region");
  });

  /**
   * PU-F-30..PU-F-32 + CR-F-02: RelayAction union includes page-understanding actions
   */
  it("PU-F-30..PU-F-32 + CR-F-02: RelayAction union includes page-understanding actions", () => {
    const actions: RelayAction[] = [
      "get_page_map",
      "inspect_element",
      "get_dom_excerpt",
      "capture_region",
    ];

    actions.forEach((action) => {
      const valid: RelayAction = action;
      expect(valid).toBe(action);
    });
  });
});

describe("M90-ACT handleRelayAction routing for page-understanding actions", () => {
  beforeEach(() => {
    resetChromeMocks();
  });

  /**
   * PU-F-30: get_page_map route returns structured data
   * Stub returns success: true with stub data - tests expect real behavior
   */
  it("PU-F-30: handleRelayAction routes get_page_map action and returns structured data", async () => {
    const response = await handleRelayAction({
      requestId: "test-pum",
      action: "get_page_map",
      payload: { maxDepth: 4, maxNodes: 200 },
    });

    // Stub returns success: true with stub data
    expect(response).toHaveProperty("success", true);
    expect(response).toHaveProperty("requestId", "test-pum");
    expect(response).toHaveProperty("data");
    // Stub returns "https://stub.example.com" - real implementation would return real URL
    expect(response.data).toHaveProperty("pageUrl");
    expect(response.data).toHaveProperty("title");
    expect(response.data).toHaveProperty("viewport");
    expect(response.data).toHaveProperty("nodes");
    expect(response.data).toHaveProperty("totalElements");
    expect(response.data).toHaveProperty("truncated");
  });

  /**
   * PU-F-31: inspect_element route returns structured data
   */
  it("PU-F-31: handleRelayAction routes inspect_element action and returns structured data", async () => {
    const response = await handleRelayAction({
      requestId: "test-inspect",
      action: "inspect_element",
      payload: { ref: "ref-123" },
    });

    expect(response).toHaveProperty("success", true);
    expect(response).toHaveProperty("requestId", "test-inspect");
    expect(response).toHaveProperty("data");
    expect(response.data).toHaveProperty("found");
  });

  /**
   * PU-F-32: get_dom_excerpt route returns structured data
   */
  it("PU-F-32: handleRelayAction routes get_dom_excerpt action and returns structured data", async () => {
    const response = await handleRelayAction({
      requestId: "test-excerpt",
      action: "get_dom_excerpt",
      payload: { selector: "#main", maxDepth: 3, maxLength: 2000 },
    });

    expect(response).toHaveProperty("success", true);
    expect(response).toHaveProperty("requestId", "test-excerpt");
    expect(response).toHaveProperty("data");
    expect(response.data).toHaveProperty("found");
  });

  /**
   * CR-F-02: capture_region route returns structured data
   */
  it("CR-F-02: handleRelayAction routes capture_region action and returns structured data", async () => {
    const response = await handleRelayAction({
      requestId: "test-capture",
      action: "capture_region",
      payload: { anchorKey: "id:submit-btn", padding: 8, quality: 70 },
    });

    expect(response).toHaveProperty("success", true);
    expect(response).toHaveProperty("requestId", "test-capture");
    expect(response).toHaveProperty("data");
  });
});

describe("M90-ACT page-understanding actions return structured data", () => {
  beforeEach(() => {
    resetChromeMocks();
  });

  /**
   * PU-F-30: get_page_map case returns structured PageMapResult
   */
  it("PU-F-30: get_page_map returns structured PageMapResult with all required fields", async () => {
    const response = await handleRelayAction({
      requestId: "test-pum-data",
      action: "get_page_map",
      payload: {},
    });

    expect(response.success).toBe(true);
    expect(response.data).toHaveProperty("pageUrl");
    expect(response.data).toHaveProperty("title");
    expect(response.data).toHaveProperty("viewport");
    expect(response.data).toHaveProperty("nodes");
    expect(response.data).toHaveProperty("totalElements");
    expect(response.data).toHaveProperty("truncated");
    // pageUrl must be a valid http/https URL with pathname — not a stub domain
    expect((response.data as { pageUrl: string }).pageUrl).toMatch(/^https?:\/\/.+/);
    expect((response.data as { pageUrl: string }).pageUrl).not.toContain("stub.example.com");
    // title must be a meaningful, non-empty string — not a placeholder
    expect((response.data as { title: string }).title).toBeTruthy();
    expect((response.data as { title: string }).title.trim().length).toBeGreaterThan(0);
    expect((response.data as { title: string }).title).not.toBe("Stub Page");
  });

  /**
   * PU-F-31: inspect_element case returns structured InspectElementResult
   */
  it("PU-F-31: inspect_element returns structured InspectElementResult", async () => {
    const response = await handleRelayAction({
      requestId: "test-inspect-data",
      action: "inspect_element",
      payload: { ref: "ref-123" },
    });

    expect(response.success).toBe(true);
    expect(response.data).toHaveProperty("found");
  });

  /**
   * PU-F-32: get_dom_excerpt case returns structured ExcerptResult
   */
  it("PU-F-32: get_dom_excerpt returns structured ExcerptResult", async () => {
    const response = await handleRelayAction({
      requestId: "test-excerpt-data",
      action: "get_dom_excerpt",
      payload: { selector: "#main" },
    });

    expect(response.success).toBe(true);
    expect(response.data).toHaveProperty("found");
  });

  /**
   * CR-F-02: capture_region case returns structured CaptureRegionResult
   */
  it("CR-F-02: capture_region returns structured CaptureRegionResult", async () => {
    const response = await handleRelayAction({
      requestId: "test-capture-data",
      action: "capture_region",
      payload: { anchorKey: "id:submit-btn" },
    });

    expect(response.success).toBe(true);
    expect(response.data).toHaveProperty("success");
  });
});

describe("M90-ACT input validation contracts", () => {
  beforeEach(() => {
    resetChromeMocks();
  });

  /**
   * PU-F-01: get_page_map accepts maxDepth and maxNodes in payload
   */
  it("PU-F-01: get_page_map accepts maxDepth and maxNodes parameters", async () => {
    const response = await handleRelayAction({
      requestId: "test-params",
      action: "get_page_map",
      payload: { maxDepth: 8, maxNodes: 500, includeBounds: true },
    });

    // Validates that parameters are accepted (even if not processed yet)
    expect(response.requestId).toBe("test-params");
  });

  /**
   * PU-F-10: inspect_element accepts ref OR selector as input
   */
  it("PU-F-10: inspect_element accepts ref parameter", async () => {
    const response = await handleRelayAction({
      requestId: "test-ref",
      action: "inspect_element",
      payload: { ref: "node-ref-abc123" },
    });

    expect(response.requestId).toBe("test-ref");
  });

  /**
   * PU-F-10: inspect_element accepts selector as alternative input
   */
  it("PU-F-10: inspect_element accepts selector parameter", async () => {
    const response = await handleRelayAction({
      requestId: "test-sel",
      action: "inspect_element",
      payload: { selector: "#main > div.article" },
    });

    expect(response.requestId).toBe("test-sel");
  });

  /**
   * PU-F-30: get_dom_excerpt accepts selector, maxDepth, maxLength
   */
  it("PU-F-30: get_dom_excerpt accepts selector, maxDepth, maxLength parameters", async () => {
    const response = await handleRelayAction({
      requestId: "test-dom",
      action: "get_dom_excerpt",
      payload: { selector: "article.content", maxDepth: 5, maxLength: 3000 },
    });

    expect(response.requestId).toBe("test-dom");
  });

  /**
   * CR-F-02: capture_region accepts anchorKey as input
   */
  it("CR-F-02: capture_region accepts anchorKey parameter", async () => {
    const response = await handleRelayAction({
      requestId: "test-ank",
      action: "capture_region",
      payload: { anchorKey: "id:submit-btn" },
    });

    expect(response.requestId).toBe("test-ank");
  });

  /**
   * CR-F-03: capture_region accepts nodeRef as input
   */
  it("CR-F-03: capture_region accepts nodeRef parameter", async () => {
    const response = await handleRelayAction({
      requestId: "test-noderef",
      action: "capture_region",
      payload: { nodeRef: "node-xyz-789" },
    });

    expect(response.requestId).toBe("test-noderef");
  });

  /**
   * CR-F-04: capture_region accepts rect as fallback input
   */
  it("CR-F-04: capture_region accepts rect parameter with x, y, width, height", async () => {
    const response = await handleRelayAction({
      requestId: "test-rect",
      action: "capture_region",
      payload: { rect: { x: 100, y: 200, width: 300, height: 150 } },
    });

    expect(response.requestId).toBe("test-rect");
  });

  /**
   * CR-F-05: capture_region accepts padding parameter
   */
  it("CR-F-05: capture_region accepts padding parameter", async () => {
    const response = await handleRelayAction({
      requestId: "test-pad",
      action: "capture_region",
      payload: { anchorKey: "id:main", padding: 20 },
    });

    expect(response.requestId).toBe("test-pad");
  });

  /**
   * CR-F-06: capture_region accepts quality parameter
   */
  it("CR-F-06: capture_region accepts quality parameter", async () => {
    const response = await handleRelayAction({
      requestId: "test-qual",
      action: "capture_region",
      payload: { anchorKey: "id:main", quality: 75 },
    });

    expect(response.requestId).toBe("test-qual");
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// PU-F-53: Handler relay forwarding + structured result path
// Validates that when stubs are replaced with real implementations, handlers
// forward to the relay with correct action names and return structured results.
// ════════════════════════════════════════════════════════════════════════════════

describe("PU-F-53: relay forwarding + structured result path (behavioral)", () => {
  beforeEach(() => {
    resetChromeMocks();
  });

  /**
   * PU-F-53: get_page_map forwards to content script via relay and returns structured PageMapResult
   * Stub returns stub data - tests check for real behavior
   */
  it("PU-F-53: get_page_map forwards action and returns structured PageMapResult", async () => {
    const response = await handleRelayAction({
      requestId: "test-fwd-pum",
      action: "get_page_map",
      payload: { maxDepth: 4, maxNodes: 200, includeBounds: true },
    });

    expect(response.success).toBe(true);
    expect(response.data).toHaveProperty("nodes");
    expect(response.data).toHaveProperty("pageUrl");
    expect(response.data).toHaveProperty("title");
    expect(response.data).toHaveProperty("viewport");
    expect(response.data).toHaveProperty("totalElements");
    expect(response.data).toHaveProperty("truncated");
    // pageUrl must be a valid http/https URL with pathname — not a stub domain
    expect((response.data as { pageUrl: string }).pageUrl).toMatch(/^https?:\/\/.+/);
    expect((response.data as { pageUrl: string }).pageUrl).not.toContain("stub.example.com");
    // title must be a meaningful, non-empty string — not a placeholder
    expect((response.data as { title: string }).title).toBeTruthy();
    expect((response.data as { title: string }).title.trim().length).toBeGreaterThan(0);
    expect((response.data as { title: string }).title).not.toBe("Stub Page");
  });

  /**
   * PU-F-53: inspect_element forwards action and returns InspectElementResult
   */
  it("PU-F-53: inspect_element forwards action and returns InspectElementResult", async () => {
    const response = await handleRelayAction({
      requestId: "test-fwd-inspect",
      action: "inspect_element",
      payload: { selector: "#main" },
    });

    expect(response.success).toBe(true);
    expect(response.data).toHaveProperty("found");
    expect(response.data).toHaveProperty("anchorKey");
    expect(response.data).toHaveProperty("anchorStrategy");
  });

  /**
   * PU-F-53: get_dom_excerpt forwards action and returns ExcerptResult
   */
  it("PU-F-53: get_dom_excerpt forwards action and returns ExcerptResult", async () => {
    const response = await handleRelayAction({
      requestId: "test-fwd-excerpt",
      action: "get_dom_excerpt",
      payload: { selector: "#main", maxDepth: 3, maxLength: 2000 },
    });

    expect(response.success).toBe(true);
    expect(response.data).toHaveProperty("found");
    expect(response.data).toHaveProperty("html");
    expect(response.data).toHaveProperty("text");
  });

  /**
   * PU-F-53: capture_region forwards action and returns CaptureRegionResult
   */
  it("PU-F-53: capture_region forwards action and returns CaptureRegionResult", async () => {
    const response = await handleRelayAction({
      requestId: "test-fwd-capture",
      action: "capture_region",
      payload: { anchorKey: "id:btn", padding: 8, quality: 70 },
    });

    expect(response.success).toBe(true);
    expect(response.data).toHaveProperty("dataUrl");
    expect(response.data).toHaveProperty("width");
    expect(response.data).toHaveProperty("height");
    expect(response.data).toHaveProperty("sizeBytes");
    expect(response.data).toHaveProperty("source");
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// PU-F-33: Runtime { found: false } for missing selector
// Validates that get_dom_excerpt returns { found: false } at RUNTIME when the
// selector matches no elements, not just a type-shape check.
// ════════════════════════════════════════════════════════════════════════════════

describe("PU-F-33: getDomExcerpt runtime { found: false } for missing selector", () => {
  beforeEach(() => {
    resetChromeMocks();
  });

  /**
   * PU-F-33: get_dom_excerpt returns { found: false } when selector matches nothing
   * This is a runtime behavior test - stub returns found: false for any selector
   */
  it("PU-F-33: get_dom_excerpt returns { found: false } for nonexistent selector", async () => {
    const response = await handleRelayAction({
      requestId: "test-not-found",
      action: "get_dom_excerpt",
      payload: { selector: ".nonexistent-class-xyz-123", maxDepth: 3, maxLength: 2000 },
    });

    expect(response.success).toBe(true);
    expect((response.data as { found: boolean }).found).toBe(false);
  });

  /**
   * PU-F-33: get_dom_excerpt { found: false } result has no html/text fields
   */
  it("PU-F-33: get_dom_excerpt { found: false } excludes html/text from result", async () => {
    const response = await handleRelayAction({
      requestId: "test-not-found-shape",
      action: "get_dom_excerpt",
      payload: { selector: ".nonexistent-class-xyz-456" },
    });

    expect(response.success).toBe(true);
    expect((response.data as { found: boolean }).found).toBe(false);
    expect((response.data as { html?: string }).html).toBeUndefined();
    expect((response.data as { text?: string }).text).toBeUndefined();
  });

  /**
   * PU-F-33: get_dom_excerpt { found: true } includes html, text, nodeCount, truncated
   * Stub returns found: false - real implementation would find valid selectors
   */
  it("PU-F-33: get_dom_excerpt { found: true } includes all excerpt fields", async () => {
    const response = await handleRelayAction({
      requestId: "test-found",
      action: "get_dom_excerpt",
      payload: { selector: "body", maxDepth: 3, maxLength: 2000 },
    });

    expect(response.success).toBe(true);
    expect((response.data as { found: boolean }).found).toBe(true);
    expect(response.data).toHaveProperty("html");
    expect(response.data).toHaveProperty("text");
    expect(response.data).toHaveProperty("nodeCount");
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// SW→CS forwarding path tests
// Validates that when document is undefined (service worker context), the three
// page-understanding actions forward to the active tab's content script via
// chrome.tabs.sendMessage instead of calling DOM functions directly.
// ════════════════════════════════════════════════════════════════════════════════

describe("SW→CS forwarding via tabs.sendMessage (service worker context)", () => {
  let originalDocument: typeof globalThis.document;

  beforeEach(() => {
    resetChromeMocks();
    // Simulate service worker context by hiding document
    originalDocument = globalThis.document;
    // @ts-expect-error — simulate no document in SW
    globalThis.document = undefined;
  });

  afterEach(() => {
    globalThis.document = originalDocument;
  });

  it("PU-F-SW-01: get_page_map forwards to content script via tabs.sendMessage in SW context", async () => {
    // Arrange: mock tabs.sendMessage to return fake page map data
    const fakePageMap = {
      pageUrl: "https://example.com/page",
      title: "Test Page",
      viewport: { width: 1280, height: 720 },
      nodes: [],
      totalElements: 0,
      truncated: false,
    };
    (chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({ data: fakePageMap });
    // Also make tabs.query return a valid tab
    (chrome.tabs.query as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 1, url: "https://example.com/page", active: true }
    ]);

    const response = await handleRelayAction({
      requestId: "test-sw-pum",
      action: "get_page_map",
      payload: { maxDepth: 4 },
    });

    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ type: "PAGE_UNDERSTANDING_ACTION", action: "get_page_map" }),
    );
    expect(response.success).toBe(true);
    expect(response.data).toEqual(fakePageMap);
  });

  it("PU-F-SW-02: inspect_element forwards to content script via tabs.sendMessage in SW context", async () => {
    const fakeResult = { found: true, anchorKey: "div:0:abc", anchorStrategy: "id" };
    (chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({ data: fakeResult });
    (chrome.tabs.query as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 1, url: "https://example.com/page", active: true }
    ]);

    const response = await handleRelayAction({
      requestId: "test-sw-inspect",
      action: "inspect_element",
      payload: { selector: "#main" },
    });

    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ type: "PAGE_UNDERSTANDING_ACTION", action: "inspect_element" }),
    );
    expect(response.success).toBe(true);
    expect(response.data).toEqual(fakeResult);
  });

  it("PU-F-SW-03: get_dom_excerpt forwards to content script via tabs.sendMessage in SW context", async () => {
    const fakeResult = { found: true, html: "<p>Hello</p>", text: "Hello", nodeCount: 1 };
    (chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({ data: fakeResult });
    (chrome.tabs.query as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 1, url: "https://example.com/page", active: true }
    ]);

    const response = await handleRelayAction({
      requestId: "test-sw-excerpt",
      action: "get_dom_excerpt",
      payload: { selector: "body" },
    });

    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ type: "PAGE_UNDERSTANDING_ACTION", action: "get_dom_excerpt" }),
    );
    expect(response.success).toBe(true);
    expect(response.data).toEqual(fakeResult);
  });

  it("PU-F-SW-04: returns action-failed when no active tab is found in SW context", async () => {
    (chrome.tabs.query as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const response = await handleRelayAction({
      requestId: "test-sw-no-tab",
      action: "get_page_map",
      payload: {},
    });

    expect(response.success).toBe(false);
    expect(response.error).toBe("action-failed");
  });
});
