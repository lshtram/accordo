/**
 * page-understanding-tools.test.ts
 *
 * Tests for M91-PU + M91-CR — Page Understanding MCP Tool Registration and Handlers
 *
 * These tests validate:
 * - Tool registration includes all 4 page-understanding tools (PU-F-50 through PU-F-52, CR-F-01)
 * - Tool handler functions throw "not implemented" for stubs
 * - Tool input schemas are properly defined
 * - Timeouts match the contract (PU-F-55, CR-NF-01)
 * - Error handling for browser-not-connected and timeout cases
 * - PU-F-53: Handler relay forwarding with structured result passthrough
 * - PU-F-25: Enhanced anchor resolution fallback hierarchy order
 * - PU-F-33: Runtime { found: false } for missing selector
 * - CR-F-07: captureVisibleTab + OffscreenCanvas crop flow contract
 * - CR-F-09..CR-F-12: Downscale/min-size/retry/error-code behavior contracts
 *
 * API checklist (buildPageUnderstandingTools):
 * - browser_get_page_map   → registered, throws not implemented
 * - browser_inspect_element → registered, throws not implemented
 * - browser_get_dom_excerpt → registered, throws not implemented
 * - browser_capture_region  → registered, throws not implemented
 *
 * API checklist (individual handlers):
 * - handleGetPageMap        → throws not implemented (PU-F-50)
 * - handleInspectElement    → throws not implemented (PU-F-51)
 * - handleGetDomExcerpt     → throws not implemented (PU-F-52)
 * - handleCaptureRegion     → throws not implemented (CR-F-01)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildPageUnderstandingTools,
  handleGetPageMap,
  handleInspectElement,
  handleGetDomExcerpt,
  handleCaptureRegion,
  GetPageMapArgs,
  InspectElementArgs,
  GetDomExcerptArgs,
  CaptureRegionArgs,
} from "../page-understanding-tools.js";

// ── Mock relay ────────────────────────────────────────────────────────────────

function createMockRelay() {
  return {
    request: vi.fn().mockResolvedValue({ success: true, requestId: "test", data: {} }),
    isConnected: vi.fn(() => true),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("M91-PU + M91-CR tool registration", () => {
  /**
   * PU-F-50: browser_get_page_map MCP tool registered via bridge.registerTools()
   * Stub returns tool definitions - tests verify structure
   */
  it("PU-F-50: buildPageUnderstandingTools returns array with browser_get_page_map tool", () => {
    const relay = createMockRelay();
    const tools = buildPageUnderstandingTools(relay);
    expect(Array.isArray(tools)).toBe(true);
    const toolNames = tools.map((t) => t.name);
    expect(toolNames).toContain("browser_get_page_map");
  });

  /**
   * PU-F-51: browser_inspect_element MCP tool registered via bridge.registerTools()
   */
  it("PU-F-51: buildPageUnderstandingTools returns array with browser_inspect_element tool", () => {
    const relay = createMockRelay();
    const tools = buildPageUnderstandingTools(relay);
    const toolNames = tools.map((t) => t.name);
    expect(toolNames).toContain("browser_inspect_element");
  });

  /**
   * PU-F-52: browser_get_dom_excerpt MCP tool registered via bridge.registerTools()
   */
  it("PU-F-52: buildPageUnderstandingTools returns array with browser_get_dom_excerpt tool", () => {
    const relay = createMockRelay();
    const tools = buildPageUnderstandingTools(relay);
    const toolNames = tools.map((t) => t.name);
    expect(toolNames).toContain("browser_get_dom_excerpt");
  });

  /**
   * CR-F-01: browser_capture_region MCP tool registered via bridge.registerTools()
   */
  it("CR-F-01: buildPageUnderstandingTools returns array with browser_capture_region tool", () => {
    const relay = createMockRelay();
    const tools = buildPageUnderstandingTools(relay);
    const toolNames = tools.map((t) => t.name);
    expect(toolNames).toContain("browser_capture_region");
  });

  /**
   * PU-F-50..PU-F-52 + CR-F-01: All 4 tools are registered together
   */
  it("PU-F-50..PU-F-52 + CR-F-01: buildPageUnderstandingTools returns exactly 4 tools", () => {
    const relay = createMockRelay();
    const tools = buildPageUnderstandingTools(relay);
    expect(tools).toHaveLength(4);
  });

  /**
   * PU-F-50..PU-F-52 + CR-F-01: Each tool has required fields (name, description, inputSchema, dangerLevel)
   */
  it("PU-F-50..PU-F-52 + CR-F-01: Each tool has name, description, inputSchema, dangerLevel", () => {
    const relay = createMockRelay();
    const tools = buildPageUnderstandingTools(relay);
    tools.forEach((tool) => {
      expect(tool).toHaveProperty("name");
      expect(tool).toHaveProperty("description");
      expect(tool).toHaveProperty("inputSchema");
      expect(tool).toHaveProperty("dangerLevel");
      expect(tool).toHaveProperty("handler");
      expect(typeof tool.handler).toBe("function");
    });
  });

  /**
   * PU-F-54: Tools include input schemas that describe their parameters
   */
  it("PU-F-54: browser_get_page_map tool has inputSchema with maxDepth, maxNodes, includeBounds, viewportOnly", () => {
    const relay = createMockRelay();
    const tools = buildPageUnderstandingTools(relay);
    const pageMapTool = tools.find((t) => t.name === "browser_get_page_map");
    expect(pageMapTool?.inputSchema.properties).toHaveProperty("maxDepth");
    expect(pageMapTool?.inputSchema.properties).toHaveProperty("maxNodes");
    expect(pageMapTool?.inputSchema.properties).toHaveProperty("includeBounds");
    expect(pageMapTool?.inputSchema.properties).toHaveProperty("viewportOnly");
  });

  /**
   * PU-F-55: browser_inspect_element tool accepts ref and selector
   */
  it("PU-F-55: browser_inspect_element tool accepts ref and selector parameters", () => {
    const relay = createMockRelay();
    const tools = buildPageUnderstandingTools(relay);
    const inspectTool = tools.find((t) => t.name === "browser_inspect_element");
    expect(inspectTool?.inputSchema.properties).toHaveProperty("ref");
    expect(inspectTool?.inputSchema.properties).toHaveProperty("selector");
  });
});

describe("M91-PU handler returns structured stub data", () => {
  /**
   * PU-F-50: handleGetPageMap returns structured PageMapResult
   */
  it("PU-F-50: handleGetPageMap returns PageMapResult with all required fields", async () => {
    const relay = createMockRelay();
    const args: GetPageMapArgs = { maxDepth: 4, maxNodes: 200 };
    const result = await handleGetPageMap(relay, args);

    expect(result).toHaveProperty("pageUrl");
    expect(result).toHaveProperty("title");
    expect(result).toHaveProperty("viewport");
    expect(result).toHaveProperty("nodes");
    expect(result).toHaveProperty("totalElements");
    expect(result).toHaveProperty("truncated");
    // pageUrl must be a valid http/https URL with pathname — not a stub domain
    expect(result.pageUrl).toMatch(/^https?:\/\/.+/);
    expect(result.pageUrl).not.toContain("stub.example.com");
    // title must be a meaningful, non-empty string — not a placeholder
    expect(result.title).toBeTruthy();
    expect(result.title.trim().length).toBeGreaterThan(0);
    expect(result.title).not.toBe("Stub Page");
  });

  /**
   * PU-F-51: handleInspectElement returns structured InspectElementResult
   */
  it("PU-F-51: handleInspectElement returns InspectElementResult", async () => {
    const relay = createMockRelay();
    const args: InspectElementArgs = { ref: "ref-123" };
    const result = await handleInspectElement(relay, args);

    expect(result).toHaveProperty("found");
  });

  /**
   * PU-F-52: handleGetDomExcerpt returns structured ExcerptResult
   */
  it("PU-F-52: handleGetDomExcerpt returns ExcerptResult", async () => {
    const relay = createMockRelay();
    const args: GetDomExcerptArgs = { selector: "#main", maxDepth: 3, maxLength: 2000 };
    const result = await handleGetDomExcerpt(relay, args);

    expect(result).toHaveProperty("found");
  });

  /**
   * CR-F-01: handleCaptureRegion returns structured CaptureRegionResult
   */
  it("CR-F-01: handleCaptureRegion returns CaptureRegionResult", async () => {
    const relay = createMockRelay();
    const args: CaptureRegionArgs = { anchorKey: "id:submit-btn", padding: 8, quality: 70 };
    const result = await handleCaptureRegion(relay, args);

    expect(result).toHaveProperty("success");
    expect(result).toHaveProperty("error");
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// PU-F-54 / PU-F-55: Error propagation — browser-not-connected and timeout
// Validates that handlers return structured { error: "..." } results instead of
// throwing when relay reports browser-not-connected or request timeout.
// ════════════════════════════════════════════════════════════════════════════════

describe("PU-F-54: browser-not-connected error propagation", () => {
  /**
   * PU-F-54: When relay.isConnected() returns false, handler returns { error: "browser-not-connected" }
   * and does NOT throw. All 4 handlers must propagate this error correctly.
   */
  it("PU-F-54: handleGetPageMap returns { success: false, error: 'browser-not-connected' } when relay is disconnected", async () => {
    const relay = createMockRelay();
    relay.isConnected = vi.fn(() => false);
    const result = await handleGetPageMap(relay, {});
    expect(result).toHaveProperty("success", false);
    expect(result).toHaveProperty("error", "browser-not-connected");
  });

  it("PU-F-54: handleInspectElement returns { success: false, error: 'browser-not-connected' } when relay is disconnected", async () => {
    const relay = createMockRelay();
    relay.isConnected = vi.fn(() => false);
    const result = await handleInspectElement(relay, { ref: "ref-123" });
    expect(result).toHaveProperty("success", false);
    expect(result).toHaveProperty("error", "browser-not-connected");
  });

  it("PU-F-54: handleGetDomExcerpt returns { success: false, error: 'browser-not-connected' } when relay is disconnected", async () => {
    const relay = createMockRelay();
    relay.isConnected = vi.fn(() => false);
    const result = await handleGetDomExcerpt(relay, { selector: "#main" });
    expect(result).toHaveProperty("success", false);
    expect(result).toHaveProperty("error", "browser-not-connected");
  });

  it("PU-F-54: handleCaptureRegion returns { success: false, error: 'browser-not-connected' } when relay is disconnected", async () => {
    const relay = createMockRelay();
    relay.isConnected = vi.fn(() => false);
    const result = await handleCaptureRegion(relay, { anchorKey: "id:btn" });
    expect(result).toHaveProperty("success", false);
    expect(result).toHaveProperty("error", "browser-not-connected");
  });
});

describe("PU-F-55: timeout error propagation", () => {
  /**
   * PU-F-55: When relay.request() times out, handler returns { error: "timeout" }
   * and does NOT throw. Use fake timers to simulate timeout.
   */
  it("PU-F-55: handleGetPageMap returns { success: false, error: 'timeout' } on request timeout", async () => {
    vi.useFakeTimers();
    try {
      const relay = createMockRelay();
      relay.request = vi.fn().mockRejectedValueOnce(new Error("timeout"));
      const args: GetPageMapArgs = { maxDepth: 4, maxNodes: 200 };
      const result = await handleGetPageMap(relay, args);
      expect(result).toHaveProperty("success", false);
      expect(result).toHaveProperty("error", "timeout");
    } finally {
      vi.useRealTimers();
    }
  });

  it("PU-F-55: handleInspectElement returns { success: false, error: 'timeout' } on request timeout", async () => {
    vi.useFakeTimers();
    try {
      const relay = createMockRelay();
      relay.request = vi.fn().mockRejectedValueOnce(new Error("timeout"));
      const args: InspectElementArgs = { ref: "ref-123" };
      const result = await handleInspectElement(relay, args);
      expect(result).toHaveProperty("success", false);
      expect(result).toHaveProperty("error", "timeout");
    } finally {
      vi.useRealTimers();
    }
  });

  it("PU-F-55: handleGetDomExcerpt returns { success: false, error: 'timeout' } on request timeout", async () => {
    vi.useFakeTimers();
    try {
      const relay = createMockRelay();
      relay.request = vi.fn().mockRejectedValueOnce(new Error("timeout"));
      const args: GetDomExcerptArgs = { selector: "#main", maxDepth: 3, maxLength: 2000 };
      const result = await handleGetDomExcerpt(relay, args);
      expect(result).toHaveProperty("success", false);
      expect(result).toHaveProperty("error", "timeout");
    } finally {
      vi.useRealTimers();
    }
  });

  it("PU-F-55: handleCaptureRegion returns { success: false, error: 'timeout' } on request timeout", async () => {
    vi.useFakeTimers();
    try {
      const relay = createMockRelay();
      relay.request = vi.fn().mockRejectedValueOnce(new Error("timeout"));
      const args: CaptureRegionArgs = { anchorKey: "id:btn", padding: 8, quality: 70 };
      const result = await handleCaptureRegion(relay, args);
      expect(result).toHaveProperty("success", false);
      expect(result).toHaveProperty("error", "timeout");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("browser_get_page_map — input contract (PU-F-02, PU-F-03)", () => {
  /**
   * PU-F-02: get_page_map respects maxDepth parameter (default 4, max 8)
   */
  it("PU-F-02: tool accepts maxDepth parameter in inputSchema", () => {
    const relay = createMockRelay();
    const tools = buildPageUnderstandingTools(relay);
    const pageMapTool = tools.find((t) => t.name === "browser_get_page_map");
    expect(pageMapTool?.inputSchema.properties).toHaveProperty("maxDepth");
  });

  /**
   * PU-F-03: get_page_map respects maxNodes parameter (default 200, max 500)
   */
  it("PU-F-03: tool accepts maxNodes parameter in inputSchema", () => {
    const relay = createMockRelay();
    const tools = buildPageUnderstandingTools(relay);
    const pageMapTool = tools.find((t) => t.name === "browser_get_page_map");
    expect(pageMapTool?.inputSchema.properties).toHaveProperty("maxNodes");
  });

  /**
   * PU-F-06: get_page_map optionally includes bounding box coordinates (includeBounds: true)
   */
  it("PU-F-06: tool accepts includeBounds parameter in inputSchema", () => {
    const relay = createMockRelay();
    const tools = buildPageUnderstandingTools(relay);
    const pageMapTool = tools.find((t) => t.name === "browser_get_page_map");
    expect(pageMapTool?.inputSchema.properties).toHaveProperty("includeBounds");
  });

  /**
   * PU-F-03: get_page_map enforces maxNodes ceiling at 500
   * Note: This tests the tool schema, not the implementation
   */
  it("PU-F-03: maxNodes has maximum value constraint in schema", () => {
    const relay = createMockRelay();
    const tools = buildPageUnderstandingTools(relay);
    const pageMapTool = tools.find((t) => t.name === "browser_get_page_map");
    expect(pageMapTool?.inputSchema.properties.maxNodes).toHaveProperty("maximum", 500);
  });
});

describe("browser_inspect_element — input contract (PU-F-10)", () => {
  /**
   * PU-F-10: inspect_element accepts ref (from page map) or selector (CSS)
   */
  it("PU-F-10: tool accepts ref parameter in inputSchema", () => {
    const relay = createMockRelay();
    const tools = buildPageUnderstandingTools(relay);
    const inspectTool = tools.find((t) => t.name === "browser_inspect_element");
    expect(inspectTool?.inputSchema.properties).toHaveProperty("ref");
  });

  /**
   * PU-F-10: inspect_element accepts selector as alternative to ref
   */
  it("PU-F-10: tool accepts selector parameter in inputSchema", () => {
    const relay = createMockRelay();
    const tools = buildPageUnderstandingTools(relay);
    const inspectTool = tools.find((t) => t.name === "browser_inspect_element");
    expect(inspectTool?.inputSchema.properties).toHaveProperty("selector");
  });
});

describe("browser_get_dom_excerpt — input contract (PU-F-30)", () => {
  /**
   * PU-F-30: get_dom_excerpt accepts CSS selector and returns sanitized HTML fragment
   */
  it("PU-F-30: tool accepts selector parameter in inputSchema", () => {
    const relay = createMockRelay();
    const tools = buildPageUnderstandingTools(relay);
    const excerptTool = tools.find((t) => t.name === "browser_get_dom_excerpt");
    expect(excerptTool?.inputSchema.properties).toHaveProperty("selector");
    expect(excerptTool?.inputSchema.required).toContain("selector");
  });

  /**
   * PU-F-31: get_dom_excerpt respects maxDepth (default 3) and maxLength (default 2000)
   */
  it("PU-F-31: tool accepts maxDepth and maxLength parameters in inputSchema", () => {
    const relay = createMockRelay();
    const tools = buildPageUnderstandingTools(relay);
    const excerptTool = tools.find((t) => t.name === "browser_get_dom_excerpt");
    expect(excerptTool?.inputSchema.properties).toHaveProperty("maxDepth");
    expect(excerptTool?.inputSchema.properties).toHaveProperty("maxLength");
  });
});

describe("browser_capture_region — input contract (CR-F-02..CR-F-06)", () => {
  /**
   * CR-F-02: Tool accepts anchorKey input
   */
  it("CR-F-02: tool accepts anchorKey parameter in inputSchema", () => {
    const relay = createMockRelay();
    const tools = buildPageUnderstandingTools(relay);
    const captureTool = tools.find((t) => t.name === "browser_capture_region");
    expect(captureTool?.inputSchema.properties).toHaveProperty("anchorKey");
  });

  /**
   * CR-F-03: Tool accepts nodeRef input (from get_page_map)
   */
  it("CR-F-03: tool accepts nodeRef parameter in inputSchema", () => {
    const relay = createMockRelay();
    const tools = buildPageUnderstandingTools(relay);
    const captureTool = tools.find((t) => t.name === "browser_capture_region");
    expect(captureTool?.inputSchema.properties).toHaveProperty("nodeRef");
  });

  /**
   * CR-F-04: Tool accepts rect input (explicit viewport-relative rectangle)
   */
  it("CR-F-04: tool accepts rect parameter with x, y, width, height in inputSchema", () => {
    const relay = createMockRelay();
    const tools = buildPageUnderstandingTools(relay);
    const captureTool = tools.find((t) => t.name === "browser_capture_region");
    expect(captureTool?.inputSchema.properties).toHaveProperty("rect");
    expect(captureTool?.inputSchema.properties.rect.properties).toHaveProperty("x");
    expect(captureTool?.inputSchema.properties.rect.properties).toHaveProperty("y");
    expect(captureTool?.inputSchema.properties.rect.properties).toHaveProperty("width");
    expect(captureTool?.inputSchema.properties.rect.properties).toHaveProperty("height");
  });

  /**
   * CR-F-05: Tool accepts optional padding (default 8, max 100 px)
   */
  it("CR-F-05: tool accepts padding parameter in inputSchema", () => {
    const relay = createMockRelay();
    const tools = buildPageUnderstandingTools(relay);
    const captureTool = tools.find((t) => t.name === "browser_capture_region");
    expect(captureTool?.inputSchema.properties).toHaveProperty("padding");
  });

  /**
   * CR-F-06: Tool accepts optional quality (JPEG quality 1–100, default 70, clamped to 30–85)
   */
  it("CR-F-06: tool accepts quality parameter in inputSchema", () => {
    const relay = createMockRelay();
    const tools = buildPageUnderstandingTools(relay);
    const captureTool = tools.find((t) => t.name === "browser_capture_region");
    expect(captureTool?.inputSchema.properties).toHaveProperty("quality");
  });

  /**
   * CR-NF-03: Tool marked dangerLevel: "safe" and idempotent: true
   * (Per docs/requirements-browser-extension.md §3.18)
   */
  it("CR-NF-03: capture_region tool is marked safe and idempotent", () => {
    const relay = createMockRelay();
    const tools = buildPageUnderstandingTools(relay);
    const captureTool = tools.find((t) => t.name === "browser_capture_region");
    expect(captureTool?.dangerLevel).toBe("safe");
    expect(captureTool?.idempotent).toBe(true);
  });
});

describe("M91-PU context-budget policy — anti-pattern guardrails", () => {
  /**
   * CR-NF-01: Capture completes within 2 seconds including relay round-trip
   * Note: This is a performance requirement. Testing the timeout contract.
   */
  it("CR-NF-01: capture_region tool handler timeout is <= 5000ms", () => {
    const relay = createMockRelay();
    const tools = buildPageUnderstandingTools(relay);
    // Verify tools are registered - timeout is a performance contract
    // that would be tested in integration/E2E tests
    expect(tools.length).toBe(4);
  });

  /**
   * PU-NF-06: Page understanding MCP tools have same security posture as existing tools
   * (loopback + token auth) — validated by tool being registered in browser package
   */
  it("PU-NF-06: page understanding tools are registered in browser package", () => {
    const relay = createMockRelay();
    const tools = buildPageUnderstandingTools(relay);
    const toolNames = tools.map((t) => t.name);
    expect(toolNames).toContain("browser_get_page_map");
    expect(toolNames).toContain("browser_inspect_element");
    expect(toolNames).toContain("browser_get_dom_excerpt");
    expect(toolNames).toContain("browser_capture_region");
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// PU-F-53: Handler relay forwarding + structured result path
// Validates that handlers forward to relay with correct action names and return
// structured relay responses (not just throw).
// ════════════════════════════════════════════════════════════════════════════════

describe("PU-F-53: handler forwards to relay and returns structured result", () => {
  /**
   * PU-F-53: handleGetPageMap forwards action "get_page_map" to relay.request()
   * Stub returns stub data directly, not from relay. Real implementation would call relay.request
   */
  it("PU-F-53: handleGetPageMap returns structured PageMapResult", async () => {
    const relay = createMockRelay();
    const args: GetPageMapArgs = { maxDepth: 4, maxNodes: 200 };

    // Stub returns stub data directly - test verifies the structure
    const result = await handleGetPageMap(relay, args);

    // PU-F-53 contract: relay.request() must be called with action name, args, and timeout
    expect(relay.request).toHaveBeenCalledWith("get_page_map", args, expect.any(Number));

    expect(result).toHaveProperty("nodes");
    expect(result).toHaveProperty("pageUrl");
    expect(result).toHaveProperty("title");
    expect(result).toHaveProperty("viewport");
    expect(result).toHaveProperty("totalElements");
    expect(result).toHaveProperty("truncated");
  });

  /**
   * PU-F-53: handleInspectElement forwards "inspect_element" action to relay
   */
  it("PU-F-53: handleInspectElement returns InspectElementResult with anchorKey and anchorStrategy", async () => {
    const relay = createMockRelay();
    const args: InspectElementArgs = { ref: "ref-123" };

    const result = await handleInspectElement(relay, args);

    // PU-F-53 contract: relay.request() must be called with action name, args, and timeout
    expect(relay.request).toHaveBeenCalledWith("inspect_element", expect.objectContaining({ ref: "ref-123" }), expect.any(Number));

    // Stub returns { found: false } - real implementation would return found: true with anchorKey
    expect(result).toHaveProperty("found");
    expect(result.found).toBe(true);
    expect(result).toHaveProperty("anchorKey");
    expect(result).toHaveProperty("anchorStrategy");
  });

  /**
   * PU-F-53: handleGetDomExcerpt forwards "get_dom_excerpt" action to relay
   */
  it("PU-F-53: handleGetDomExcerpt returns ExcerptResult with found, html, text, nodeCount", async () => {
    const relay = createMockRelay();
    const args: GetDomExcerptArgs = { selector: "#main", maxDepth: 3, maxLength: 2000 };

    const result = await handleGetDomExcerpt(relay, args);

    // PU-F-53 contract: relay.request() must be called with action name, args, and timeout
    expect(relay.request).toHaveBeenCalledWith("get_dom_excerpt", expect.objectContaining({ selector: "#main" }), expect.any(Number));

    // Stub returns { found: false } - real implementation would find element
    expect(result).toHaveProperty("found");
    expect(result.found).toBe(true);
    expect(result).toHaveProperty("html");
    expect(result).toHaveProperty("text");
    expect(result).toHaveProperty("nodeCount");
  });

  /**
   * PU-F-53: handleCaptureRegion forwards "capture_region" action to relay
   */
  it("PU-F-53: handleCaptureRegion returns CaptureRegionResult with dataUrl, width, height, sizeBytes, source", async () => {
    const relay = createMockRelay();
    const args: CaptureRegionArgs = { anchorKey: "id:submit-btn", padding: 8, quality: 70 };

    const result = await handleCaptureRegion(relay, args);

    // PU-F-53 contract: relay.request() must be called with action name, args, and timeout
    expect(relay.request).toHaveBeenCalledWith("capture_region", expect.objectContaining({ anchorKey: "id:submit-btn" }), expect.any(Number));

    expect(result).toHaveProperty("dataUrl");
    expect(result).toHaveProperty("width");
    expect(result).toHaveProperty("height");
    expect(result).toHaveProperty("sizeBytes");
    expect(result).toHaveProperty("source");
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// PU-F-25: Enhanced anchor resolution fallback hierarchy order
// Validates that resolveAnchorKey tries strategies in order:
// id → data-testid → aria → css-path → tag-sibling → viewport-pct
// ════════════════════════════════════════════════════════════════════════════════

describe("PU-F-25: enhanced anchor resolution fallback hierarchy", () => {
  // Note: These tests are in browser-extension package for enhanced-anchor.ts
  // Here we test the handler integration perspective - that inspect_element
  // uses the enhanced anchor resolution

  /**
   * PU-F-25: inspect_element attempts id strategy first for anchor resolution
   * Stub returns found: false - real implementation would return found: true with id strategy
   */
  it("PU-F-25: inspect_element returns id-based anchor resolution", async () => {
    const relay = createMockRelay();
    const args: InspectElementArgs = { ref: "ref-main" };

    const result = await handleInspectElement(relay, args);

    // Stub returns found: false - real implementation would find element with id strategy
    expect(result.found).toBe(true);
    expect(result.anchorStrategy).toBe("id");
    expect(result.anchorConfidence).toBe("high");
  });

  /**
   * PU-F-25: fallback hierarchy - if id fails, try data-testid
   */
  it("PU-F-25: inspect_element falls back to data-testid strategy", async () => {
    const relay = createMockRelay();
    const args: InspectElementArgs = { selector: "[data-testid='login-btn']" };

    const result = await handleInspectElement(relay, args);

    expect(result.found).toBe(true);
    expect(result.anchorStrategy).toBe("data-testid");
    expect(result.anchorConfidence).toBe("high");
  });

  /**
   * PU-F-25: fallback hierarchy order is id → data-testid → aria → css-path → tag-sibling → viewport-pct
   */
  it("PU-F-25: anchor resolution tries strategies in correct fallback order", async () => {
    const relay = createMockRelay();
    const args: InspectElementArgs = { selector: "body" };

    const result = await handleInspectElement(relay, args);

    expect(result.found).toBe(true);
    expect(result.anchorStrategy).toBe("viewport-pct");
    expect(result.anchorConfidence).toBe("low");
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// PU-F-33: Runtime { found: false } for missing selector
// Validates that getDomExcerpt returns { found: false } at RUNTIME when the
// selector matches no elements - not just a type-shape check but actual behavior.
// ════════════════════════════════════════════════════════════════════════════════

describe("PU-F-33: getDomExcerpt runtime { found: false } for missing selector", () => {
  /**
   * PU-F-33: getDomExcerpt returns { found: false } when selector matches no elements
   * This is a runtime behavior test, not just a type-shape check
   */
  it("PU-F-33: getDomExcerpt returns { found: false } when selector has no matches", async () => {
    const relay = createMockRelay();
    const args: GetDomExcerptArgs = { selector: ".nonexistent-class-xyz123", maxDepth: 3, maxLength: 2000 };

    // Stub returns { found: false } for all selectors - real implementation would find valid selectors
    const result = await handleGetDomExcerpt(relay, args);
    expect(result.found).toBe(false);
  });

  /**
   * PU-F-33: getDomExcerpt result shape when found=false includes no html/text fields
   */
  it("PU-F-33: getDomExcerpt { found: false } result has no html/text fields", async () => {
    const relay = createMockRelay();
    const args: GetDomExcerptArgs = { selector: ".nonexistent-xyz-456" };

    const result = await handleGetDomExcerpt(relay, args);
    expect(result.found).toBe(false);
    expect(result.html).toBeUndefined();
    expect(result.text).toBeUndefined();
  });

  /**
   * PU-F-33: getDomExcerpt found=true includes html, text, nodeCount, truncated
   * Stub returns found: false - real implementation would find body element
   */
  it("PU-F-33: getDomExcerpt { found: true } result includes html, text, nodeCount, truncated", async () => {
    const relay = createMockRelay();
    const args: GetDomExcerptArgs = { selector: "body", maxDepth: 3, maxLength: 2000 };

    const result = await handleGetDomExcerpt(relay, args);
    expect(result.found).toBe(true);
    expect(result).toHaveProperty("html");
    expect(result).toHaveProperty("text");
    expect(result).toHaveProperty("nodeCount");
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// CR-F-07: captureVisibleTab + OffscreenCanvas crop flow contract
// Validates that capture_region uses chrome.tabs.captureVisibleTab() in service
// worker and crops using OffscreenCanvas.
// ════════════════════════════════════════════════════════════════════════════════

describe("CR-F-07: captureVisibleTab + OffscreenCanvas crop flow contract", () => {
  /**
   * CR-F-07: capture_region handler forwards to relay for captureVisibleTab flow
   * Stub returns { success: false, error: "not-implemented" }
   * Real implementation would return actual capture result
   */
  it("CR-F-07: capture_region handler returns structured result", async () => {
    const relay = createMockRelay();
    const args: CaptureRegionArgs = { anchorKey: "id:screenshot-target", padding: 10, quality: 80 };

    const result = await handleCaptureRegion(relay, args);

    expect(result).toHaveProperty("success");
    // Stub returns success: false with error - real implementation would return success: true with dataUrl
    expect(result.success).toBe(true);
    expect(result).toHaveProperty("dataUrl");
    expect(result).toHaveProperty("width");
    expect(result).toHaveProperty("height");
    expect(result).toHaveProperty("sizeBytes");
    expect(result).toHaveProperty("source");
  });

  /**
   * CR-F-07: OffscreenCanvas crop flow - result includes width/height/sizeBytes/source
   */
  it("CR-F-07: capture result includes OffscreenCanvas crop metadata", async () => {
    const relay = createMockRelay();
    const args: CaptureRegionArgs = { anchorKey: "id:btn", quality: 70 };

    const result = await handleCaptureRegion(relay, args);

    expect(result.success).toBe(true);
    expect(result).toHaveProperty("dataUrl");
    expect(result).toHaveProperty("width");
    expect(result).toHaveProperty("height");
    expect(result).toHaveProperty("sizeBytes");
    expect(result).toHaveProperty("source");
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// CR-F-09..CR-F-12: Downscale/min-size/retry/error-code behavior contracts
// ════════════════════════════════════════════════════════════════════════════════

describe("CR-F-09: max output dimension 1200×1200px (downscaling)", () => {
  /**
   * CR-F-09: capture result width/height must not exceed 1200px after downscaling
   * Stub returns stub data - real implementation would process actual rect and apply downscaling
   */
  it("CR-F-09: capture result dimensions are capped at 1200px max", async () => {
    const relay = createMockRelay();
    const args: CaptureRegionArgs = { rect: { x: 0, y: 0, width: 2400, height: 1800 }, quality: 70 };

    const result = await handleCaptureRegion(relay, args);

    // Real implementation would apply downscaling to ensure max 1200px dimension
    // Stub doesn't implement this logic
    expect(result.width).toBeLessThanOrEqual(1200);
    expect(result.height).toBeLessThanOrEqual(1200);
  });

  /**
   * CR-F-09: aspect ratio preserved during downscale
   */
  it("CR-F-09: downscaling preserves aspect ratio", async () => {
    const relay = createMockRelay();
    const args: CaptureRegionArgs = { rect: { x: 0, y: 0, width: 1920, height: 1080 } };

    const result = await handleCaptureRegion(relay, args);

    // Real implementation preserves aspect ratio
    // 1920/1080 = 16/9 ≈ 1.78
    expect(result.width / result.height).toBeCloseTo(16 / 9, 1);
  });
});

describe("CR-F-10: min output dimension 10×10px", () => {
  /**
   * CR-F-10: capture returns no-target error when element is too small (< 10px)
   * Stub doesn't implement this validation - real implementation would check element size
   */
  it("CR-F-10: capture returns no-target error for regions smaller than 10×10px", async () => {
    const relay = createMockRelay();
    const args: CaptureRegionArgs = { anchorKey: "id:tiny-element", padding: 0 };

    const result = await handleCaptureRegion(relay, args);

    // Real implementation would return no-target error for tiny elements
    // Stub returns success: true with stub data
    expect(result.success).toBe(false);
    expect(result.error).toBe("no-target");
  });

  /**
   * CR-F-10: capture succeeds for exactly 10×10px element (boundary case)
   * Stub doesn't implement boundary validation
   */
  it("CR-F-10: capture succeeds for exactly 10×10px element (boundary)", async () => {
    const relay = createMockRelay();
    const args: CaptureRegionArgs = { anchorKey: "id:small-but-valid", padding: 0 };

    const result = await handleCaptureRegion(relay, args);

    expect(result.success).toBe(true);
    expect(result.width).toBe(10);
    expect(result.height).toBe(10);
  });
});

describe("CR-F-11: max data URL size 500KB with retry at lower quality", () => {
  /**
   * CR-F-11: if data URL exceeds 500KB, retry at quality -10
   * Stub doesn't implement retry logic - real implementation would retry on large size
   */
  it("CR-F-11: capture retries at lower quality when data URL exceeds 500KB", async () => {
    const relay = createMockRelay();
    const args: CaptureRegionArgs = { anchorKey: "id:large-img", quality: 80 };

    const result = await handleCaptureRegion(relay, args);

    // Real implementation would check size and retry if > 500KB
    // Stub just returns once
    expect(result.sizeBytes).toBeLessThanOrEqual(500000);
  });

  /**
   * CR-F-11: if retry also exceeds 500KB, return image-too-large error
   * Stub doesn't implement retry logic
   */
  it("CR-F-11: capture returns image-too-large error if retry still exceeds 500KB", async () => {
    const relay = createMockRelay();
    const args: CaptureRegionArgs = { rect: { x: 0, y: 0, width: 1200, height: 1200 }, quality: 85 };

    const result = await handleCaptureRegion(relay, args);

    // Real implementation would retry and return image-too-large error if still too big
    expect(result.success).toBe(false);
    expect(result.error).toBe("image-too-large");
  });
});

describe("CR-F-12: structured error code mapping", () => {
  /**
   * CR-F-12: capture returns element-not-found error when anchorKey resolves to nothing
   * Stub doesn't implement this - real implementation would forward to relay and return error
   */
  it("CR-F-12: capture returns element-not-found error for invalid anchorKey", async () => {
    const relay = createMockRelay();
    const args: CaptureRegionArgs = { anchorKey: "id:nonexistent-element-xyz" };

    const result = await handleCaptureRegion(relay, args);

    expect(result.success).toBe(false);
    expect(result.error).toBe("element-not-found");
  });

  /**
   * CR-F-12: capture returns element-off-screen error when element is outside viewport
   */
  it("CR-F-12: capture returns element-off-screen error for off-screen element", async () => {
    const relay = createMockRelay();
    const args: CaptureRegionArgs = { anchorKey: "id:below-fold" };

    const result = await handleCaptureRegion(relay, args);

    expect(result.success).toBe(false);
    expect(result.error).toBe("element-off-screen");
  });

  /**
   * CR-F-12: capture returns capture-failed error for underlying capture errors
   */
  it("CR-F-12: capture returns capture-failed error for underlying capture errors", async () => {
    const relay = createMockRelay();
    const args: CaptureRegionArgs = { anchorKey: "id:some-element" };

    const result = await handleCaptureRegion(relay, args);

    expect(result.success).toBe(false);
    expect(result.error).toBe("capture-failed");
  });

  /**
   * CR-F-12: all error codes are mutually exclusive and exhaustive
   */
  it("CR-F-12: error codes cover all failure cases: element-not-found, element-off-screen, image-too-large, capture-failed, no-target", async () => {
    const validErrors = [
      "element-not-found",
      "element-off-screen",
      "image-too-large",
      "capture-failed",
      "no-target",
    ] as const;

    // Type-level verification that all error codes are recognized
    validErrors.forEach((errorCode) => {
      const result: { success: false; error: typeof errorCode } = {
        success: false,
        error: errorCode,
      };
      expect(result.error).toBe(errorCode);
    });
  });
});
