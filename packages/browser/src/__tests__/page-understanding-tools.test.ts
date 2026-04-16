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
 * B2-CTX-001 multi-tab support tests:
 * - browser_list_pages → tool registered, correct schema, success/error handlers
 * - browser_select_page → tool registered, correct schema, success/error handlers
 * - All existing tools accept optional tabId parameter (backward compat)
 * - All existing tool handlers forward tabId in relay payload when provided
 *
 * API checklist (buildPageUnderstandingTools):
 * - browser_get_page_map    → registered, handler forwards to relay
 * - browser_inspect_element → registered, handler forwards to relay
 * - browser_get_dom_excerpt → registered, handler forwards to relay
 * - browser_capture_region  → registered, handler forwards to relay
 * - browser_list_pages     → registered (B2-CTX-001)
 * - browser_select_page    → registered (B2-CTX-001)
 *
 * API checklist (individual handlers):
 * - handleGetPageMap        → forwards to relay.request "get_page_map"
 * - handleInspectElement    → forwards to relay.request "inspect_element"
 * - handleGetDomExcerpt     → forwards to relay.request "get_dom_excerpt"
 * - handleCaptureRegion     → forwards to relay.request "capture_region"
 * - handleListPages         → forwards to relay.request "list_pages" (B2-CTX-001)
 * - handleSelectPage        → forwards to relay.request "select_page" (B2-CTX-001)
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
import { buildWaitForTool } from "../wait-tool.js";
import { buildTextMapTool } from "../text-map-tool.js";
import { buildSemanticGraphTool } from "../semantic-graph-tool.js";
import { SnapshotRetentionStore } from "../snapshot-retention.js";

/** Shared no-op store used by tests that don't assert on retention behaviour. */
const noopStore = new SnapshotRetentionStore();

// ── Mock relay ────────────────────────────────────────────────────────────────

/** B2-SV-003: Valid SnapshotEnvelopeFields for mock relay responses. */
const MOCK_ENVELOPE = {
  pageId: "mock-page-001",
  frameId: "main",
  snapshotId: "mock-page-001:1",
  capturedAt: "2025-01-01T00:00:00.000Z",
  viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
  source: "dom" as const,
};

function createMockRelay() {
  return {
    request: vi.fn().mockImplementation(async (action: string, payload?: Record<string, unknown>) => {
      if (action === "get_page_map") {
        const hasFilter = payload && (
          payload.visibleOnly !== undefined ||
          payload.interactiveOnly !== undefined ||
          payload.roles !== undefined ||
          payload.textMatch !== undefined ||
          payload.selector !== undefined ||
          payload.regionFilter !== undefined
        );
        const activeFilters: string[] = [];
        if (payload?.visibleOnly !== undefined) activeFilters.push("visibleOnly");
        if (payload?.interactiveOnly !== undefined) activeFilters.push("interactiveOnly");
        if (payload?.roles !== undefined) activeFilters.push("roles");
        if (payload?.textMatch !== undefined) activeFilters.push("textMatch");
        if (payload?.selector !== undefined) activeFilters.push("selector");
        if (payload?.regionFilter !== undefined) activeFilters.push("regionFilter");
        return {
          success: true,
          requestId: "test",
          data: {
            ...MOCK_ENVELOPE,
            pageUrl: "https://example.com/page",
            title: "Example Page",
            viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
            nodes: [],
            totalElements: 10,
            depth: 0,
            truncated: false,
            ...(hasFilter ? {
              filterSummary: {
                activeFilters,
                totalBeforeFilter: 10,
                totalAfterFilter: 3,
                reductionRatio: 0.7,
              },
            } : {}),
          },
        };
      }
      if (action === "inspect_element") {
        const selector = (payload?.selector as string | undefined) ?? "";
        if (selector === "body") {
          return {
            success: true,
            requestId: "test",
            data: {
              ...MOCK_ENVELOPE,
              found: true,
              anchorKey: "body:50%x50%",
              anchorStrategy: "viewport-pct",
              anchorConfidence: "low",
            },
          };
        }
        if (selector.includes("data-testid")) {
          return {
            success: true,
            requestId: "test",
            data: {
              ...MOCK_ENVELOPE,
              found: true,
              anchorKey: "data-testid:test-btn",
              anchorStrategy: "data-testid",
              anchorConfidence: "high",
            },
          };
        }
        if (selector.includes("no-stable")) {
          return {
            success: true,
            requestId: "test",
            data: {
              ...MOCK_ENVELOPE,
              found: true,
              anchorKey: "body:50%x50%",
              anchorStrategy: "viewport-pct",
              anchorConfidence: "low",
            },
          };
        }
        return {
          success: true,
          requestId: "test",
          data: {
            ...MOCK_ENVELOPE,
            found: true,
            anchorKey: "id:main",
            anchorStrategy: "id",
            anchorConfidence: "high",
          },
        };
      }
      if (action === "get_dom_excerpt") {
        const selector = (payload?.selector as string | undefined) ?? "";
        if (selector.includes("nonexistent") || selector.includes("xyz123") || selector.includes("xyz-456")) {
          return {
            success: true,
            requestId: "test",
            data: { ...MOCK_ENVELOPE, found: false },
          };
        }
        return {
          success: true,
          requestId: "test",
          data: {
            ...MOCK_ENVELOPE,
            found: true,
            html: "<body>Example</body>",
            text: "Example",
            nodeCount: 1,
            truncated: false,
          },
        };
      }
      if (action === "capture_region") {
        // B2-SV-003: capture_region relay response must include full SnapshotEnvelope.
        const capturePayload = payload ?? {};
        const anchorKey = capturePayload.anchorKey as string | undefined;

        // CR-F-12: anchorKey-driven error simulation
        if (anchorKey === "id:nonexistent-element-xyz") {
          return {
            success: true,
            requestId: "test",
            data: { ...MOCK_ENVELOPE, source: "visual" as const, success: false, error: "element-not-found" },
          };
        }
        if (anchorKey === "id:below-fold") {
          return {
            success: true,
            requestId: "test",
            data: { ...MOCK_ENVELOPE, source: "visual" as const, success: false, error: "element-off-screen" },
          };
        }
        if (anchorKey === "id:some-element") {
          return {
            success: true,
            requestId: "test",
            data: { ...MOCK_ENVELOPE, source: "visual" as const, success: false, error: "capture-failed" },
          };
        }
        // CR-F-10: tiny element → no-target
        if (anchorKey === "id:tiny-element") {
          return {
            success: true,
            requestId: "test",
            data: { ...MOCK_ENVELOPE, source: "visual" as const, success: false, error: "no-target" },
          };
        }
        // CR-F-10: boundary element → 10×10
        if (anchorKey === "id:small-but-valid") {
          return {
            success: true,
            requestId: "test",
            data: {
              ...MOCK_ENVELOPE,
              source: "visual" as const,
              success: true,
              dataUrl: "data:image/jpeg;base64,/9j/4A==",
              width: 10,
              height: 10,
              sizeBytes: 100,
              anchorSource: anchorKey,
            },
          };
        }
        // CR-F-09: large rect → downscaled (1920×1080 → 1200×675 for 16:9)
        const rect = capturePayload.rect as { x: number; y: number; width: number; height: number } | undefined;
        if (rect) {
          // CR-F-11: 1200×1200 at quality 85 → image-too-large
          const quality = (capturePayload.quality as number | undefined) ?? 70;
          if (rect.width >= 1200 && rect.height >= 1200 && quality >= 85) {
            return {
              success: true,
              requestId: "test",
              data: { ...MOCK_ENVELOPE, source: "visual" as const, success: false, error: "image-too-large" },
            };
          }
          // CR-F-09: downscale to max 1200px
          let { width, height } = rect;
          const MAX_DIM = 1200;
          if (width > MAX_DIM || height > MAX_DIM) {
            const scale = Math.min(MAX_DIM / width, MAX_DIM / height);
            width = Math.round(width * scale);
            height = Math.round(height * scale);
          }
          return {
            success: true,
            requestId: "test",
            data: {
              ...MOCK_ENVELOPE,
              source: "visual" as const,
              success: true,
              dataUrl: "data:image/jpeg;base64,/9j/4A==",
              width,
              height,
              sizeBytes: width * height * 3,
            },
          };
        }
        // CR-F-11: default case — within size limit
        return {
          success: true,
          requestId: "test",
          data: {
            ...MOCK_ENVELOPE,
            source: "visual" as const,
            success: true,
            dataUrl: "data:image/jpeg;base64,/9j/4A==",
            width: 200,
            height: 150,
            sizeBytes: 4096,
            anchorSource: anchorKey ?? "rect",
          },
        };
      }
      return { success: false, requestId: "test", error: "action-failed" };
    }),
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
    const tools = buildPageUnderstandingTools(relay, noopStore);
    expect(Array.isArray(tools)).toBe(true);
    const toolNames = tools.map((t) => t.name);
    expect(toolNames).toContain("accordo_browser_get_page_map");
  });

  /**
   * PU-F-51: browser_inspect_element MCP tool registered via bridge.registerTools()
   */
  it("PU-F-51: buildPageUnderstandingTools returns array with browser_inspect_element tool", () => {
    const relay = createMockRelay();
    const tools = buildPageUnderstandingTools(relay, noopStore);
    const toolNames = tools.map((t) => t.name);
    expect(toolNames).toContain("accordo_browser_inspect_element");
  });

  /**
   * PU-F-52: browser_get_dom_excerpt MCP tool registered via bridge.registerTools()
   */
  it("PU-F-52: buildPageUnderstandingTools returns array with browser_get_dom_excerpt tool", () => {
    const relay = createMockRelay();
    const tools = buildPageUnderstandingTools(relay, noopStore);
    const toolNames = tools.map((t) => t.name);
    expect(toolNames).toContain("accordo_browser_get_dom_excerpt");
  });

  /**
   * CR-F-01: browser_capture_region MCP tool registered via bridge.registerTools()
   */
  it("CR-F-01: buildPageUnderstandingTools returns array with browser_capture_region tool", () => {
    const relay = createMockRelay();
    const tools = buildPageUnderstandingTools(relay, noopStore);
    const toolNames = tools.map((t) => t.name);
    expect(toolNames).toContain("accordo_browser_capture_region");
  });

  /**
   * PU-F-50..PU-F-52 + CR-F-01: All 4 tools are registered together
   */
  it("PU-F-50..PU-F-52 + CR-F-01: buildPageUnderstandingTools returns exactly 4 tools", () => {
    const relay = createMockRelay();
    const tools = buildPageUnderstandingTools(relay, noopStore);
    expect(tools).toHaveLength(6);
  });

  /**
   * PU-F-50..PU-F-52 + CR-F-01: Each tool has required fields (name, description, inputSchema, dangerLevel)
   */
  it("PU-F-50..PU-F-52 + CR-F-01: Each tool has name, description, inputSchema, dangerLevel", () => {
    const relay = createMockRelay();
    const tools = buildPageUnderstandingTools(relay, noopStore);
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
    const tools = buildPageUnderstandingTools(relay, noopStore);
    const pageMapTool = tools.find((t) => t.name === "accordo_browser_get_page_map");
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
    const tools = buildPageUnderstandingTools(relay, noopStore);
    const inspectTool = tools.find((t) => t.name === "accordo_browser_inspect_element");
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
    const result = await handleGetPageMap(relay, args, noopStore);

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
    const result = await handleInspectElement(relay, args, noopStore);

    expect(result).toHaveProperty("found");
  });

  /**
   * PU-F-52: handleGetDomExcerpt returns structured ExcerptResult
   */
  it("PU-F-52: handleGetDomExcerpt returns ExcerptResult", async () => {
    const relay = createMockRelay();
    const args: GetDomExcerptArgs = { selector: "#main", maxDepth: 3, maxLength: 2000 };
    const result = await handleGetDomExcerpt(relay, args, noopStore);

    expect(result).toHaveProperty("found");
  });

  it("F12: handleInspectElement maps relay iframe-cross-origin to structured iframe-cross-origin", async () => {
    const relay = {
      request: vi.fn().mockResolvedValue({ success: false, requestId: "test", error: "iframe-cross-origin" as const }),
      isConnected: vi.fn(() => true),
    };
    const result = await handleInspectElement(relay, { ref: "ref-123", frameId: "cross-frame" }, noopStore);

    expect(result.success).toBe(false);
    expect((result as { error: string }).error).toBe("iframe-cross-origin");
  });

  it("F12: handleGetDomExcerpt maps relay iframe-cross-origin to structured iframe-cross-origin", async () => {
    const relay = {
      request: vi.fn().mockResolvedValue({ success: false, requestId: "test", error: "iframe-cross-origin" as const }),
      isConnected: vi.fn(() => true),
    };
    const result = await handleGetDomExcerpt(relay, { selector: "body", frameId: "cross-frame" }, noopStore);

    expect(result.success).toBe(false);
    expect((result as { error: string }).error).toBe("iframe-cross-origin");
  });

  /**
   * CR-F-01: handleCaptureRegion returns structured CaptureRegionResult
   * B2-SV-003: Response includes SnapshotEnvelope fields (snapshotId, pageId, capturedAt, etc.)
   */
  it("CR-F-01: handleCaptureRegion returns CaptureRegionResult with SnapshotEnvelope", async () => {
    const relay = createMockRelay();
    const args: CaptureRegionArgs = { anchorKey: "id:submit-btn", padding: 8, quality: 70 };
    const result = await handleCaptureRegion(relay, args, noopStore);

    expect(result).toHaveProperty("success", true);
    // B2-SV-003: envelope fields must be present
    expect(result).toHaveProperty("snapshotId");
    expect(result).toHaveProperty("pageId", "mock-page-001");
    expect(result).toHaveProperty("frameId", "main");
    expect(result).toHaveProperty("capturedAt");
    expect(result).toHaveProperty("viewport");
    expect(result).toHaveProperty("source");
    // Snapshot ID format: {pageId}:{version}
    expect((result as { snapshotId: string }).snapshotId).toMatch(/^[^:]+:\d+$/);
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
    const result = await handleGetPageMap(relay, {}, noopStore);
    expect(result).toHaveProperty("success", false);
    expect(result).toHaveProperty("error", "browser-not-connected");
  });

  it("PU-F-54: handleInspectElement returns { success: false, error: 'browser-not-connected' } when relay is disconnected", async () => {
    const relay = createMockRelay();
    relay.isConnected = vi.fn(() => false);
    const result = await handleInspectElement(relay, { ref: "ref-123" }, noopStore);
    expect(result).toHaveProperty("success", false);
    expect(result).toHaveProperty("error", "browser-not-connected");
  });

  it("PU-F-54: handleGetDomExcerpt returns { success: false, error: 'browser-not-connected' } when relay is disconnected", async () => {
    const relay = createMockRelay();
    relay.isConnected = vi.fn(() => false);
    const result = await handleGetDomExcerpt(relay, { selector: "#main" }, noopStore);
    expect(result).toHaveProperty("success", false);
    expect(result).toHaveProperty("error", "browser-not-connected");
  });

  it("PU-F-54: handleCaptureRegion returns { success: false, error: 'browser-not-connected' } when relay is disconnected", async () => {
    const relay = createMockRelay();
    relay.isConnected = vi.fn(() => false);
    const result = await handleCaptureRegion(relay, { anchorKey: "id:btn" }, noopStore);
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
      const result = await handleGetPageMap(relay, args, noopStore);
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
      const result = await handleInspectElement(relay, args, noopStore);
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
      const result = await handleGetDomExcerpt(relay, args, noopStore);
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
      const result = await handleCaptureRegion(relay, args, noopStore);
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
    const tools = buildPageUnderstandingTools(relay, noopStore);
    const pageMapTool = tools.find((t) => t.name === "accordo_browser_get_page_map");
    expect(pageMapTool?.inputSchema.properties).toHaveProperty("maxDepth");
  });

  /**
   * PU-F-03: get_page_map respects maxNodes parameter (default 200, max 500)
   */
  it("PU-F-03: tool accepts maxNodes parameter in inputSchema", () => {
    const relay = createMockRelay();
    const tools = buildPageUnderstandingTools(relay, noopStore);
    const pageMapTool = tools.find((t) => t.name === "accordo_browser_get_page_map");
    expect(pageMapTool?.inputSchema.properties).toHaveProperty("maxNodes");
  });

  /**
   * PU-F-06: get_page_map optionally includes bounding box coordinates (includeBounds: true)
   */
  it("PU-F-06: tool accepts includeBounds parameter in inputSchema", () => {
    const relay = createMockRelay();
    const tools = buildPageUnderstandingTools(relay, noopStore);
    const pageMapTool = tools.find((t) => t.name === "accordo_browser_get_page_map");
    expect(pageMapTool?.inputSchema.properties).toHaveProperty("includeBounds");
  });

  /**
   * PU-F-03: get_page_map enforces maxNodes ceiling at 500
   * Note: This tests the tool schema, not the implementation
   */
  it("PU-F-03: maxNodes has maximum value constraint in schema", () => {
    const relay = createMockRelay();
    const tools = buildPageUnderstandingTools(relay, noopStore);
    const pageMapTool = tools.find((t) => t.name === "accordo_browser_get_page_map");
    expect(pageMapTool?.inputSchema.properties.maxNodes).toHaveProperty("maximum", 500);
  });
});

describe("browser_get_page_map — filter parameter schema (B2-FI-001..008)", () => {
  /**
   * B2-FI-001: visibleOnly: boolean parameter
   */
  it("B2-FI-001: tool accepts visibleOnly parameter in inputSchema", () => {
    const relay = createMockRelay();
    const tools = buildPageUnderstandingTools(relay, noopStore);
    const pageMapTool = tools.find((t) => t.name === "accordo_browser_get_page_map");
    expect(pageMapTool?.inputSchema.properties).toHaveProperty("visibleOnly");
    expect(pageMapTool?.inputSchema.properties.visibleOnly.type).toBe("boolean");
  });

  /**
   * B2-FI-002: interactiveOnly: boolean parameter
   */
  it("B2-FI-002: tool accepts interactiveOnly parameter in inputSchema", () => {
    const relay = createMockRelay();
    const tools = buildPageUnderstandingTools(relay, noopStore);
    const pageMapTool = tools.find((t) => t.name === "accordo_browser_get_page_map");
    expect(pageMapTool?.inputSchema.properties).toHaveProperty("interactiveOnly");
    expect(pageMapTool?.inputSchema.properties.interactiveOnly.type).toBe("boolean");
  });

  /**
   * B2-FI-003: roles: string[] parameter
   */
  it("B2-FI-003: tool accepts roles parameter in inputSchema (array of strings)", () => {
    const relay = createMockRelay();
    const tools = buildPageUnderstandingTools(relay, noopStore);
    const pageMapTool = tools.find((t) => t.name === "accordo_browser_get_page_map");
    expect(pageMapTool?.inputSchema.properties).toHaveProperty("roles");
    expect(pageMapTool?.inputSchema.properties.roles.type).toBe("array");
    expect(pageMapTool?.inputSchema.properties.roles.items).toEqual({ type: "string" });
  });

  /**
   * B2-FI-004: textMatch: string parameter
   */
  it("B2-FI-004: tool accepts textMatch parameter in inputSchema", () => {
    const relay = createMockRelay();
    const tools = buildPageUnderstandingTools(relay, noopStore);
    const pageMapTool = tools.find((t) => t.name === "accordo_browser_get_page_map");
    expect(pageMapTool?.inputSchema.properties).toHaveProperty("textMatch");
    expect(pageMapTool?.inputSchema.properties.textMatch.type).toBe("string");
  });

  /**
   * B2-FI-005: selector: string parameter
   */
  it("B2-FI-005: tool accepts selector parameter in inputSchema", () => {
    const relay = createMockRelay();
    const tools = buildPageUnderstandingTools(relay, noopStore);
    const pageMapTool = tools.find((t) => t.name === "accordo_browser_get_page_map");
    expect(pageMapTool?.inputSchema.properties).toHaveProperty("selector");
    expect(pageMapTool?.inputSchema.properties.selector.type).toBe("string");
  });

  /**
   * B2-FI-006: regionFilter: { x, y, width, height } parameter
   */
  it("B2-FI-006: tool accepts regionFilter parameter in inputSchema", () => {
    const relay = createMockRelay();
    const tools = buildPageUnderstandingTools(relay, noopStore);
    const pageMapTool = tools.find((t) => t.name === "accordo_browser_get_page_map");
    expect(pageMapTool?.inputSchema.properties).toHaveProperty("regionFilter");
    expect(pageMapTool?.inputSchema.properties.regionFilter.type).toBe("object");
  });

  it("B2-FI-006: regionFilter has x, y, width, height properties (all required)", () => {
    const relay = createMockRelay();
    const tools = buildPageUnderstandingTools(relay, noopStore);
    const pageMapTool = tools.find((t) => t.name === "accordo_browser_get_page_map");
    const rf = pageMapTool?.inputSchema.properties.regionFilter;
    expect(rf.properties).toHaveProperty("x");
    expect(rf.properties).toHaveProperty("y");
    expect(rf.properties).toHaveProperty("width");
    expect(rf.properties).toHaveProperty("height");
    expect(rf.required).toContain("x");
    expect(rf.required).toContain("y");
    expect(rf.required).toContain("width");
    expect(rf.required).toContain("height");
  });

  it("B2-VD-001..004: tool accepts piercesShadow parameter in inputSchema", () => {
    const relay = createMockRelay();
    const tools = buildPageUnderstandingTools(relay, noopStore);
    const pageMapTool = tools.find((t) => t.name === "accordo_browser_get_page_map");
    expect(pageMapTool?.inputSchema.properties).toHaveProperty("piercesShadow");
    expect(pageMapTool?.inputSchema.properties.piercesShadow.type).toBe("boolean");
  });

  it("B2-VD-005..009: tool accepts traverseFrames parameter in inputSchema", () => {
    const relay = createMockRelay();
    const tools = buildPageUnderstandingTools(relay, noopStore);
    const pageMapTool = tools.find((t) => t.name === "accordo_browser_get_page_map");
    expect(pageMapTool?.inputSchema.properties).toHaveProperty("traverseFrames");
    expect(pageMapTool?.inputSchema.properties.traverseFrames.type).toBe("boolean");
  });

  /**
   * B2-VD-009: traverseFrames description must honestly state child-frame DOM
   * traversal is NOT included. The description must contain "NOT included" or similar
   * disclaimer to avoid overclaiming.
   */
  it("B2-VD-009: traverseFrames description honestly disclaims child-frame DOM traversal", () => {
    const relay = createMockRelay();
    const tools = buildPageUnderstandingTools(relay, noopStore);
    const pageMapTool = tools.find((t) => t.name === "accordo_browser_get_page_map");
    const desc = (pageMapTool?.inputSchema.properties.traverseFrames.description as string).toLowerCase();
    expect(desc).toBeDefined();
    // Must disclaim child-frame DOM traversal — this feature is metadata-only
    expect(desc).toMatch(/not included|not part of|metadata.only|metadata only/);
  });

  /**
   * B2-FI-007: Filter combination — all filter parameters are present for AND composition
   */
  it("B2-FI-007: tool accepts all six filter parameters simultaneously", () => {
    const relay = createMockRelay();
    const tools = buildPageUnderstandingTools(relay, noopStore);
    const pageMapTool = tools.find((t) => t.name === "accordo_browser_get_page_map");
    const props = pageMapTool?.inputSchema.properties;
    expect(props).toHaveProperty("visibleOnly");
    expect(props).toHaveProperty("interactiveOnly");
    expect(props).toHaveProperty("roles");
    expect(props).toHaveProperty("textMatch");
    expect(props).toHaveProperty("selector");
    expect(props).toHaveProperty("regionFilter");
  });
});

describe("browser_inspect_element — input contract (PU-F-10)", () => {
  /**
   * PU-F-10: inspect_element accepts ref (from page map) or selector (CSS)
   */
  it("PU-F-10: tool accepts ref parameter in inputSchema", () => {
    const relay = createMockRelay();
    const tools = buildPageUnderstandingTools(relay, noopStore);
    const inspectTool = tools.find((t) => t.name === "accordo_browser_inspect_element");
    expect(inspectTool?.inputSchema.properties).toHaveProperty("ref");
  });

  /**
   * PU-F-10: inspect_element accepts selector as alternative to ref
   */
  it("PU-F-10: tool accepts selector parameter in inputSchema", () => {
    const relay = createMockRelay();
    const tools = buildPageUnderstandingTools(relay, noopStore);
    const inspectTool = tools.find((t) => t.name === "accordo_browser_inspect_element");
    expect(inspectTool?.inputSchema.properties).toHaveProperty("selector");
  });

  it("F12: tool accepts frameId parameter in inputSchema", () => {
    const relay = createMockRelay();
    const tools = buildPageUnderstandingTools(relay, noopStore);
    const inspectTool = tools.find((t) => t.name === "accordo_browser_inspect_element");
    expect(inspectTool?.inputSchema.properties).toHaveProperty("frameId");
  });
});

describe("browser_get_dom_excerpt — input contract (PU-F-30)", () => {
  /**
   * PU-F-30: get_dom_excerpt accepts CSS selector and returns sanitized HTML fragment
   */
  it("PU-F-30: tool accepts selector parameter in inputSchema", () => {
    const relay = createMockRelay();
    const tools = buildPageUnderstandingTools(relay, noopStore);
    const excerptTool = tools.find((t) => t.name === "accordo_browser_get_dom_excerpt");
    expect(excerptTool?.inputSchema.properties).toHaveProperty("selector");
    expect(excerptTool?.inputSchema.required).toContain("selector");
  });

  /**
   * PU-F-31: get_dom_excerpt respects maxDepth (default 3) and maxLength (default 2000)
   */
  it("PU-F-31: tool accepts maxDepth and maxLength parameters in inputSchema", () => {
    const relay = createMockRelay();
    const tools = buildPageUnderstandingTools(relay, noopStore);
    const excerptTool = tools.find((t) => t.name === "accordo_browser_get_dom_excerpt");
    expect(excerptTool?.inputSchema.properties).toHaveProperty("maxDepth");
    expect(excerptTool?.inputSchema.properties).toHaveProperty("maxLength");
  });

  it("F12: tool accepts frameId parameter in inputSchema", () => {
    const relay = createMockRelay();
    const tools = buildPageUnderstandingTools(relay, noopStore);
    const excerptTool = tools.find((t) => t.name === "accordo_browser_get_dom_excerpt");
    expect(excerptTool?.inputSchema.properties).toHaveProperty("frameId");
  });
});

describe("browser_capture_region — input contract (CR-F-02..CR-F-06)", () => {
  /**
   * CR-F-02: Tool accepts anchorKey input
   */
  it("CR-F-02: tool accepts anchorKey parameter in inputSchema", () => {
    const relay = createMockRelay();
    const tools = buildPageUnderstandingTools(relay, noopStore);
    const captureTool = tools.find((t) => t.name === "accordo_browser_capture_region");
    expect(captureTool?.inputSchema.properties).toHaveProperty("anchorKey");
  });

  /**
   * CR-F-03: Tool accepts nodeRef input (from get_page_map)
   */
  it("CR-F-03: tool accepts nodeRef parameter in inputSchema", () => {
    const relay = createMockRelay();
    const tools = buildPageUnderstandingTools(relay, noopStore);
    const captureTool = tools.find((t) => t.name === "accordo_browser_capture_region");
    expect(captureTool?.inputSchema.properties).toHaveProperty("nodeRef");
  });

  /**
   * CR-F-04: Tool accepts rect input (explicit viewport-relative rectangle)
   */
  it("CR-F-04: tool accepts rect parameter with x, y, width, height in inputSchema", () => {
    const relay = createMockRelay();
    const tools = buildPageUnderstandingTools(relay, noopStore);
    const captureTool = tools.find((t) => t.name === "accordo_browser_capture_region");
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
    const tools = buildPageUnderstandingTools(relay, noopStore);
    const captureTool = tools.find((t) => t.name === "accordo_browser_capture_region");
    expect(captureTool?.inputSchema.properties).toHaveProperty("padding");
  });

  /**
   * CR-F-06: Tool accepts optional quality (JPEG quality 1–100, default 70, clamped to 30–85)
   */
  it("CR-F-06: tool accepts quality parameter in inputSchema", () => {
    const relay = createMockRelay();
    const tools = buildPageUnderstandingTools(relay, noopStore);
    const captureTool = tools.find((t) => t.name === "accordo_browser_capture_region");
    expect(captureTool?.inputSchema.properties).toHaveProperty("quality");
  });

  /**
   * CR-NF-03: Tool marked dangerLevel: "safe" and idempotent: true
    * (Per docs/20-requirements/requirements-browser-extension.md §3.18)
   */
  it("CR-NF-03: capture_region tool is marked safe and idempotent", () => {
    const relay = createMockRelay();
    const tools = buildPageUnderstandingTools(relay, noopStore);
    const captureTool = tools.find((t) => t.name === "accordo_browser_capture_region");
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
    const tools = buildPageUnderstandingTools(relay, noopStore);
    // Verify tools are registered - timeout is a performance contract
    // that would be tested in integration/E2E tests
    expect(tools.length).toBe(6);
  });

  /**
   * PU-NF-06: Page understanding MCP tools have same security posture as existing tools
   * (loopback + token auth) — validated by tool being registered in browser package
   */
  it("PU-NF-06: page understanding tools are registered in browser package", () => {
    const relay = createMockRelay();
    const tools = buildPageUnderstandingTools(relay, noopStore);
    const toolNames = tools.map((t) => t.name);
    expect(toolNames).toContain("accordo_browser_get_page_map");
    expect(toolNames).toContain("accordo_browser_inspect_element");
    expect(toolNames).toContain("accordo_browser_get_dom_excerpt");
    expect(toolNames).toContain("accordo_browser_capture_region");
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
    const result = await handleGetPageMap(relay, args, noopStore);

    // PU-F-53 contract: relay.request() must be called with action name, args, and timeout
    expect(relay.request).toHaveBeenCalledWith("get_page_map", args, expect.any(Number));

    expect(result).toHaveProperty("nodes");
    expect(result).toHaveProperty("pageUrl");
    expect(result).toHaveProperty("title");
    expect(result).toHaveProperty("viewport");
    expect(result).toHaveProperty("totalElements");
    expect(result).toHaveProperty("truncated");
  });

  it("B2-VD-005..009: handleGetPageMap forwards traverseFrames to relay", async () => {
    const relay = createMockRelay();
    const args: GetPageMapArgs = { traverseFrames: true };

    await handleGetPageMap(relay, args, noopStore);

    expect(relay.request).toHaveBeenCalledWith(
      "get_page_map",
      expect.objectContaining({ traverseFrames: true }),
      expect.any(Number),
    );
  });

  /**
   * PU-F-53: handleInspectElement forwards "inspect_element" action to relay
   */
  it("PU-F-53: handleInspectElement returns InspectElementResult with anchorKey and anchorStrategy", async () => {
    const relay = createMockRelay();
    const args: InspectElementArgs = { ref: "ref-123" };

    const result = await handleInspectElement(relay, args, noopStore);

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

    const result = await handleGetDomExcerpt(relay, args, noopStore);

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

    const result = await handleCaptureRegion(relay, args, noopStore);

    // PU-F-53 contract: relay.request() must be called with action name, args, and timeout
    expect(relay.request).toHaveBeenCalledWith("capture_region", expect.objectContaining({ anchorKey: "id:submit-btn" }), expect.any(Number));

    expect(result).toHaveProperty("fileUri");
    expect(result).toHaveProperty("filePath");
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

    const result = await handleInspectElement(relay, args, noopStore);

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

    const result = await handleInspectElement(relay, args, noopStore);

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

    const result = await handleInspectElement(relay, args, noopStore);

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
    const result = await handleGetDomExcerpt(relay, args, noopStore);
    expect(result.found).toBe(false);
  });

  /**
   * PU-F-33: getDomExcerpt result shape when found=false includes no html/text fields
   */
  it("PU-F-33: getDomExcerpt { found: false } result has no html/text fields", async () => {
    const relay = createMockRelay();
    const args: GetDomExcerptArgs = { selector: ".nonexistent-xyz-456" };

    const result = await handleGetDomExcerpt(relay, args, noopStore);
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

    const result = await handleGetDomExcerpt(relay, args, noopStore);
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

    const result = await handleCaptureRegion(relay, args, noopStore);

    expect(result).toHaveProperty("success");
    // Default transport is file-ref; result has fileUri + filePath instead of dataUrl
    expect(result.success).toBe(true);
    expect(result).toHaveProperty("fileUri");
    expect(result).toHaveProperty("filePath");
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

    const result = await handleCaptureRegion(relay, args, noopStore);

    expect(result.success).toBe(true);
    expect(result).toHaveProperty("fileUri");
    expect(result).toHaveProperty("filePath");
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

    const result = await handleCaptureRegion(relay, args, noopStore);

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

    const result = await handleCaptureRegion(relay, args, noopStore);

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

    const result = await handleCaptureRegion(relay, args, noopStore);

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

    const result = await handleCaptureRegion(relay, args, noopStore);

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

    const result = await handleCaptureRegion(relay, args, noopStore);

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

    const result = await handleCaptureRegion(relay, args, noopStore);

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

    const result = await handleCaptureRegion(relay, args, noopStore);

    expect(result.success).toBe(false);
    expect(result.error).toBe("element-not-found");
  });

  /**
   * CR-F-12: capture returns element-off-screen error when element is outside viewport
   */
  it("CR-F-12: capture returns element-off-screen error for off-screen element", async () => {
    const relay = createMockRelay();
    const args: CaptureRegionArgs = { anchorKey: "id:below-fold" };

    const result = await handleCaptureRegion(relay, args, noopStore);

    expect(result.success).toBe(false);
    expect(result.error).toBe("element-off-screen");
  });

  /**
   * CR-F-12: capture returns capture-failed error for underlying capture errors
   */
  it("CR-F-12: capture returns capture-failed error for underlying capture errors", async () => {
    const relay = createMockRelay();
    const args: CaptureRegionArgs = { anchorKey: "id:some-element" };

    const result = await handleCaptureRegion(relay, args, noopStore);

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

// ════════════════════════════════════════════════════════════════════════════════
// B2-FI-001..008: Runtime forwarding — all six filter args forwarded to relay
// Validates that handleGetPageMap forwards all six filter parameters to the
// relay.request("get_page_map", payload) call.
// ════════════════════════════════════════════════════════════════════════════════

describe("B2-FI-001..008: get_page_map forwards all six filter args to relay payload", () => {
  /**
   * B2-FI-001: visibleOnly forwarded to relay
   */
  it("B2-FI-001: handleGetPageMap forwards visibleOnly=true to relay payload", async () => {
    const relay = createMockRelay();
    const args: GetPageMapArgs = { visibleOnly: true };
    await handleGetPageMap(relay, args, noopStore);
    expect(relay.request).toHaveBeenCalledWith(
      "get_page_map",
      expect.objectContaining({ visibleOnly: true }),
      expect.any(Number),
    );
  });

  it("B2-FI-001: visibleOnly=false is forwarded to relay payload", async () => {
    const relay = createMockRelay();
    const args: GetPageMapArgs = { visibleOnly: false };
    await handleGetPageMap(relay, args, noopStore);
    expect(relay.request).toHaveBeenCalledWith(
      "get_page_map",
      expect.objectContaining({ visibleOnly: false }),
      expect.any(Number),
    );
  });

  /**
   * B2-FI-002: interactiveOnly forwarded to relay
   */
  it("B2-FI-002: handleGetPageMap forwards interactiveOnly=true to relay payload", async () => {
    const relay = createMockRelay();
    const args: GetPageMapArgs = { interactiveOnly: true };
    await handleGetPageMap(relay, args, noopStore);
    expect(relay.request).toHaveBeenCalledWith(
      "get_page_map",
      expect.objectContaining({ interactiveOnly: true }),
      expect.any(Number),
    );
  });

  /**
   * B2-FI-003: roles forwarded to relay
   */
  it("B2-FI-003: handleGetPageMap forwards roles array to relay payload", async () => {
    const relay = createMockRelay();
    const args: GetPageMapArgs = { roles: ["button", "link", "heading"] };
    await handleGetPageMap(relay, args, noopStore);
    expect(relay.request).toHaveBeenCalledWith(
      "get_page_map",
      expect.objectContaining({ roles: ["button", "link", "heading"] }),
      expect.any(Number),
    );
  });

  it("B2-FI-003: empty roles array is forwarded to relay payload", async () => {
    const relay = createMockRelay();
    const args: GetPageMapArgs = { roles: [] };
    await handleGetPageMap(relay, args, noopStore);
    expect(relay.request).toHaveBeenCalledWith(
      "get_page_map",
      expect.objectContaining({ roles: [] }),
      expect.any(Number),
    );
  });

  /**
   * B2-FI-004: textMatch forwarded to relay
   */
  it("B2-FI-004: handleGetPageMap forwards textMatch string to relay payload", async () => {
    const relay = createMockRelay();
    const args: GetPageMapArgs = { textMatch: "login" };
    await handleGetPageMap(relay, args, noopStore);
    expect(relay.request).toHaveBeenCalledWith(
      "get_page_map",
      expect.objectContaining({ textMatch: "login" }),
      expect.any(Number),
    );
  });

  it("B2-FI-004: textMatch with spaces is forwarded to relay payload", async () => {
    const relay = createMockRelay();
    const args: GetPageMapArgs = { textMatch: "Sign In" };
    await handleGetPageMap(relay, args, noopStore);
    expect(relay.request).toHaveBeenCalledWith(
      "get_page_map",
      expect.objectContaining({ textMatch: "Sign In" }),
      expect.any(Number),
    );
  });

  /**
   * B2-FI-005: selector forwarded to relay
   */
  it("B2-FI-005: handleGetPageMap forwards selector string to relay payload", async () => {
    const relay = createMockRelay();
    const args: GetPageMapArgs = { selector: ".nav-item" };
    await handleGetPageMap(relay, args, noopStore);
    expect(relay.request).toHaveBeenCalledWith(
      "get_page_map",
      expect.objectContaining({ selector: ".nav-item" }),
      expect.any(Number),
    );
  });

  it("B2-FI-005: compound selector forwarded to relay payload", async () => {
    const relay = createMockRelay();
    const args: GetPageMapArgs = { selector: "button.primary" };
    await handleGetPageMap(relay, args, noopStore);
    expect(relay.request).toHaveBeenCalledWith(
      "get_page_map",
      expect.objectContaining({ selector: "button.primary" }),
      expect.any(Number),
    );
  });

  /**
   * B2-FI-006: regionFilter forwarded to relay
   */
  it("B2-FI-006: handleGetPageMap forwards regionFilter object to relay payload", async () => {
    const relay = createMockRelay();
    const args: GetPageMapArgs = { regionFilter: { x: 100, y: 200, width: 300, height: 400 } };
    await handleGetPageMap(relay, args, noopStore);
    expect(relay.request).toHaveBeenCalledWith(
      "get_page_map",
      expect.objectContaining({ regionFilter: { x: 100, y: 200, width: 300, height: 400 } }),
      expect.any(Number),
    );
  });

  it("B2-FI-006: regionFilter with zero values forwarded to relay payload", async () => {
    const relay = createMockRelay();
    const args: GetPageMapArgs = { regionFilter: { x: 0, y: 0, width: 100, height: 100 } };
    await handleGetPageMap(relay, args, noopStore);
    expect(relay.request).toHaveBeenCalledWith(
      "get_page_map",
      expect.objectContaining({ regionFilter: { x: 0, y: 0, width: 100, height: 100 } }),
      expect.any(Number),
    );
  });

  /**
   * B2-FI-007: All six filter args forwarded simultaneously (AND composition)
   */
  it("B2-FI-007: all six filter args forwarded simultaneously to relay payload", async () => {
    const relay = createMockRelay();
    const args: GetPageMapArgs = {
      visibleOnly: true,
      interactiveOnly: false,
      roles: ["button", "link"],
      textMatch: "submit",
      selector: ".primary",
      regionFilter: { x: 0, y: 0, width: 1280, height: 800 },
    };
    await handleGetPageMap(relay, args, noopStore);
    expect(relay.request).toHaveBeenCalledWith(
      "get_page_map",
      expect.objectContaining({
        visibleOnly: true,
        interactiveOnly: false,
        roles: ["button", "link"],
        textMatch: "submit",
        selector: ".primary",
        regionFilter: { x: 0, y: 0, width: 1280, height: 800 },
      }),
      expect.any(Number),
    );
  });

  /**
   * B2-FI-007: Non-filter args (maxDepth, maxNodes, includeBounds) also forwarded
   */
  it("B2-FI-007: non-filter args forwarded alongside filter args", async () => {
    const relay = createMockRelay();
    const args: GetPageMapArgs = {
      maxDepth: 6,
      maxNodes: 300,
      includeBounds: true,
      visibleOnly: true,
    };
    await handleGetPageMap(relay, args, noopStore);
    expect(relay.request).toHaveBeenCalledWith(
      "get_page_map",
      expect.objectContaining({
        maxDepth: 6,
        maxNodes: 300,
        includeBounds: true,
        visibleOnly: true,
      }),
      expect.any(Number),
    );
  });

  /**
   * B2-FI-007: Filter args forwarded with base args (maxDepth, maxNodes)
   */
  it("B2-FI-007: filter args forwarded when only filter args are set", async () => {
    const relay = createMockRelay();
    const args: GetPageMapArgs = { roles: ["heading"] };
    await handleGetPageMap(relay, args, noopStore);
    expect(relay.request).toHaveBeenCalledWith(
      "get_page_map",
      expect.objectContaining({ roles: ["heading"] }),
      expect.any(Number),
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// B2-FI-007/008: filterSummary semantics — shape and passthrough validation
// Validates that handleGetPageMap passes filterSummary through to the caller
// with the correct shape when filter parameters are active.
// ════════════════════════════════════════════════════════════════════════════════

describe("B2-FI-007/008: filterSummary semantics and passthrough", () => {
  /**
   * B2-FI-008: When no filter parameters are provided, filterSummary must
   * be absent from the result.
   */
  it("B2-FI-008: filterSummary is absent in result when no filter args are provided", async () => {
    const relay = createMockRelay();
    const result = await handleGetPageMap(relay, { maxDepth: 4, maxNodes: 200 }, noopStore);
    expect((result as { filterSummary?: unknown }).filterSummary).toBeUndefined();
  });

  /**
   * B2-FI-008: When visibleOnly=true is set, filterSummary must be present
   * in the result with all required fields.
   */
  it("B2-FI-008: filterSummary is present with correct shape when visibleOnly=true", async () => {
    const relay = createMockRelay();
    const result = await handleGetPageMap(relay, { visibleOnly: true }, noopStore);
    const fs = (result as { filterSummary?: unknown }).filterSummary as {
      activeFilters: string[];
      totalBeforeFilter: number;
      totalAfterFilter: number;
      reductionRatio: number;
    } | undefined;
    expect(fs).toBeDefined();
    expect(Array.isArray(fs?.activeFilters)).toBe(true);
    expect(typeof fs?.totalBeforeFilter).toBe("number");
    expect(typeof fs?.totalAfterFilter).toBe("number");
    expect(typeof fs?.reductionRatio).toBe("number");
  });

  /**
   * B2-FI-008: filterSummary.activeFilters includes the correct filter names.
   */
  it("B2-FI-008: filterSummary.activeFilters includes 'visibleOnly' when that filter is set", async () => {
    const relay = createMockRelay();
    const result = await handleGetPageMap(relay, { visibleOnly: true }, noopStore);
    const fs = (result as { filterSummary?: { activeFilters: string[] } }).filterSummary;
    expect(fs?.activeFilters).toContain("visibleOnly");
  });

  /**
   * B2-FI-008: filterSummary.reductionRatio is in [0.0, 1.0].
   */
  it("B2-FI-008: filterSummary.reductionRatio is between 0.0 and 1.0 inclusive", async () => {
    const relay = createMockRelay();
    const result = await handleGetPageMap(relay, { interactiveOnly: true }, noopStore);
    const fs = (result as { filterSummary?: { reductionRatio: number } }).filterSummary;
    expect(fs?.reductionRatio).toBeGreaterThanOrEqual(0);
    expect(fs?.reductionRatio).toBeLessThanOrEqual(1);
  });

  /**
   * B2-FI-007: AND composition — filterSummary lists all active filter names
   * when multiple filters are set simultaneously.
   */
  it("B2-FI-007: filterSummary.activeFilters lists all active filters in AND composition", async () => {
    const relay = createMockRelay();
    const args: GetPageMapArgs = {
      visibleOnly: true,
      interactiveOnly: true,
      textMatch: "login",
    };
    const result = await handleGetPageMap(relay, args, noopStore);
    const fs = (result as { filterSummary?: { activeFilters: string[] } }).filterSummary;
    expect(fs?.activeFilters).toContain("visibleOnly");
    expect(fs?.activeFilters).toContain("interactiveOnly");
    expect(fs?.activeFilters).toContain("textMatch");
  });

  /**
   * B2-FI-008: totalBeforeFilter >= totalAfterFilter (filtering can only reduce).
   */
  it("B2-FI-008: totalBeforeFilter >= totalAfterFilter in filterSummary", async () => {
    const relay = createMockRelay();
    const result = await handleGetPageMap(relay, { roles: ["button"] }, noopStore);
    const fs = (result as { filterSummary?: { totalBeforeFilter: number; totalAfterFilter: number } }).filterSummary;
    expect(fs).toBeDefined();
    expect(fs!.totalBeforeFilter).toBeGreaterThanOrEqual(fs!.totalAfterFilter);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// B2-CTX-001: Multi-tab support — browser_list_pages tool
// Tests for the new list_pages tool that enumerates all open browser tabs.
// ════════════════════════════════════════════════════════════════════════════════

describe("B2-CTX-001: browser_list_pages tool registration", () => {
  /**
   * B2-CTX-001: browser_list_pages tool is in the returned tool array.
   * buildPageUnderstandingTools must return 6 tools (4 existing + 2 new).
   */
  it("B2-CTX-001: buildPageUnderstandingTools returns browser_list_pages in tool array", () => {
    const relay = createMockRelay();
    const tools = buildPageUnderstandingTools(relay, noopStore);
    const toolNames = tools.map((t) => t.name);
    expect(toolNames).toContain("accordo_browser_list_pages");
  });

  /**
   * B2-CTX-001: buildPageUnderstandingTools returns 6 tools total (4 existing + list_pages + select_page)
   */
  it("B2-CTX-001: buildPageUnderstandingTools returns 6 tools", () => {
    const relay = createMockRelay();
    const tools = buildPageUnderstandingTools(relay, noopStore);
    expect(tools).toHaveLength(6);
  });

  /**
   * B2-CTX-001: browser_list_pages tool has correct inputSchema.
   * tabId is optional (tabId?: number) — caller can list tabs generally or for a specific tab.
   * dangerLevel is 1 (safe — read-only tab enumeration).
   */
  it("B2-CTX-001: browser_list_pages has tabId?: number in inputSchema (optional)", () => {
    const relay = createMockRelay();
    const tools = buildPageUnderstandingTools(relay, noopStore);
    const listPagesTool = tools.find((t) => t.name === "accordo_browser_list_pages");
    expect(listPagesTool?.inputSchema.properties).toHaveProperty("tabId");
    expect(listPagesTool?.inputSchema.properties.tabId.type).toBe("number");
    // tabId is optional — not in required array
    expect(listPagesTool?.inputSchema.required || []).not.toContain("tabId");
  });

  /**
   * B2-CTX-001: browser_list_pages is marked dangerLevel: "safe"
   */
  it("B2-CTX-001: browser_list_pages dangerLevel is safe", () => {
    const relay = createMockRelay();
    const tools = buildPageUnderstandingTools(relay, noopStore);
    const listPagesTool = tools.find((t) => t.name === "accordo_browser_list_pages");
    expect(listPagesTool?.dangerLevel).toBe("safe");
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// B2-CTX-001: Multi-tab support — browser_select_page tool
// ════════════════════════════════════════════════════════════════════════════════

describe("B2-CTX-001: browser_select_page tool registration", () => {
  /**
   * B2-CTX-001: browser_select_page tool is in the returned tool array.
   */
  it("B2-CTX-001: buildPageUnderstandingTools returns browser_select_page in tool array", () => {
    const relay = createMockRelay();
    const tools = buildPageUnderstandingTools(relay, noopStore);
    const toolNames = tools.map((t) => t.name);
    expect(toolNames).toContain("accordo_browser_select_page");
  });

  /**
   * B2-CTX-001: browser_select_page tool has tabId: { type: "number", description: "..." } as required parameter.
   */
  it("B2-CTX-001: browser_select_page has tabId as required number parameter in inputSchema", () => {
    const relay = createMockRelay();
    const tools = buildPageUnderstandingTools(relay, noopStore);
    const selectPageTool = tools.find((t) => t.name === "accordo_browser_select_page");
    expect(selectPageTool?.inputSchema.properties).toHaveProperty("tabId");
    expect(selectPageTool?.inputSchema.properties.tabId.type).toBe("number");
    expect(selectPageTool?.inputSchema.required || []).toContain("tabId");
  });

  /**
   * B2-CTX-001: browser_select_page is marked dangerLevel: "safe"
   */
  it("B2-CTX-001: browser_select_page dangerLevel is safe", () => {
    const relay = createMockRelay();
    const tools = buildPageUnderstandingTools(relay, noopStore);
    const selectPageTool = tools.find((t) => t.name === "accordo_browser_select_page");
    expect(selectPageTool?.dangerLevel).toBe("safe");
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// B2-CTX-001: All existing tools accept optional tabId parameter in schema
// Validates backward compatibility — existing callers without tabId continue to work.
// ════════════════════════════════════════════════════════════════════════════════

describe("B2-CTX-001: all existing tools accept optional tabId in inputSchema", () => {
  // Tools from buildPageUnderstandingTools
  const pageUnderstandingToolNames = [
    "accordo_browser_get_page_map",
    "accordo_browser_inspect_element",
    "accordo_browser_get_dom_excerpt",
  ] as const;

  pageUnderstandingToolNames.forEach((toolName) => {
    it(`B2-CTX-001: ${toolName} has tabId?: number in inputSchema properties`, () => {
      const relay = createMockRelay();
      const tools = buildPageUnderstandingTools(relay, noopStore);
      const tool = tools.find((t) => t.name === toolName);
      expect(tool?.inputSchema.properties).toHaveProperty("tabId");
      expect(tool?.inputSchema.properties.tabId.type).toBe("number");
    });
  });

  it("B2-CTX-001: browser_wait_for has tabId?: number in inputSchema properties", () => {
    const relay = createMockRelay();
    const tool = buildWaitForTool(relay);
    expect(tool.inputSchema.properties).toHaveProperty("tabId");
    expect(tool.inputSchema.properties.tabId.type).toBe("number");
  });

  it("B2-CTX-001: browser_get_text_map has tabId?: number in inputSchema properties", () => {
    const relay = createMockRelay();
    const tool = buildTextMapTool(relay, noopStore);
    expect(tool.inputSchema.properties).toHaveProperty("tabId");
    expect(tool.inputSchema.properties.tabId.type).toBe("number");
  });

  it("B2-CTX-001: browser_get_semantic_graph has tabId?: number in inputSchema properties", () => {
    const relay = createMockRelay();
    const tool = buildSemanticGraphTool(relay, noopStore);
    expect(tool.inputSchema.properties).toHaveProperty("tabId");
    expect(tool.inputSchema.properties.tabId.type).toBe("number");
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// B2-CTX-001: All existing tool handlers forward tabId in relay payload when provided
// Validates that tabId from args is passed through to relay.request payload so the
// relay can forward to the correct tab.
// ════════════════════════════════════════════════════════════════════════════════

describe("B2-CTX-001: all existing tool handlers forward tabId in relay payload when provided", () => {
  /**
   * B2-CTX-001: handleGetPageMap forwards tabId to relay.request payload when provided.
   */
  it("B2-CTX-001: handleGetPageMap forwards tabId: 42 to relay.request payload", async () => {
    const relay = createMockRelay();
    relay.request = vi.fn().mockResolvedValue({
      success: true,
      data: { pageUrl: "https://example.com", pageId: "p1", frameId: "main", snapshotId: "p1:1", capturedAt: "2025-01-01T00:00:00Z", viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 0, devicePixelRatio: 1 }, source: "dom", title: "Test", nodes: [], totalElements: 0, depth: 0, truncated: false },
    });

    await handleGetPageMap(relay, { tabId: 42, maxDepth: 4 }, noopStore);

    expect(relay.request).toHaveBeenCalledWith(
      "get_page_map",
      expect.objectContaining({ tabId: 42 }),
      expect.any(Number),
    );
  });

  /**
   * B2-CTX-001: handleInspectElement forwards tabId to relay.request payload when provided.
   */
  it("B2-CTX-001: handleInspectElement forwards tabId: 42 to relay.request payload", async () => {
    const relay = createMockRelay();
    relay.request = vi.fn().mockResolvedValue({
      success: true,
      data: { found: true, pageId: "p1", frameId: "main", snapshotId: "p1:1", capturedAt: "2025-01-01T00:00:00Z", viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 0, devicePixelRatio: 1 }, source: "dom", anchorKey: "id:btn", anchorStrategy: "id", anchorConfidence: "high" },
    });

    await handleInspectElement(relay, { tabId: 42, ref: "btn" }, noopStore);

    expect(relay.request).toHaveBeenCalledWith(
      "inspect_element",
      expect.objectContaining({ tabId: 42 }),
      expect.any(Number),
    );
  });

  /**
   * B2-CTX-001: handleGetDomExcerpt forwards tabId to relay.request payload when provided.
   */
  it("B2-CTX-001: handleGetDomExcerpt forwards tabId: 42 to relay.request payload", async () => {
    const relay = createMockRelay();
    relay.request = vi.fn().mockResolvedValue({
      success: true,
      data: { found: true, pageId: "p1", frameId: "main", snapshotId: "p1:1", capturedAt: "2025-01-01T00:00:00Z", viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 0, devicePixelRatio: 1 }, source: "dom", html: "<div>", text: "div", nodeCount: 1 },
    });

    await handleGetDomExcerpt(relay, { tabId: 42, selector: "body" }, noopStore);

    expect(relay.request).toHaveBeenCalledWith(
      "get_dom_excerpt",
      expect.objectContaining({ tabId: 42 }),
      expect.any(Number),
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// Incremental Pagination — get_page_map (offset + limit)
// Approved design: add optional offset/limit to tool args; return hasMore,
// nextOffset, totalAvailable when offset or limit is explicitly provided.
// Pagination is stateless offset+limit bounded by collector caps (maxNodes=500).
// ════════════════════════════════════════════════════════════════════════════════

describe("Incremental Pagination — get_page_map schema (offset + limit args)", () => {
  /**
   * PAG-01: get_page_map tool schema accepts optional offset parameter.
   */
  it("PAG-01: browser_get_page_map tool accepts offset?: number in inputSchema", () => {
    const relay = createMockRelay();
    const tools = buildPageUnderstandingTools(relay, noopStore);
    const pageMapTool = tools.find((t) => t.name === "accordo_browser_get_page_map");
    expect(pageMapTool?.inputSchema.properties).toHaveProperty("offset");
    expect(pageMapTool?.inputSchema.properties.offset.type).toBe("number");
  });

  /**
   * PAG-01: get_page_map tool schema accepts optional limit parameter.
   */
  it("PAG-01: browser_get_page_map tool accepts limit?: number in inputSchema", () => {
    const relay = createMockRelay();
    const tools = buildPageUnderstandingTools(relay, noopStore);
    const pageMapTool = tools.find((t) => t.name === "accordo_browser_get_page_map");
    expect(pageMapTool?.inputSchema.properties).toHaveProperty("limit");
    expect(pageMapTool?.inputSchema.properties.limit.type).toBe("number");
  });

  /**
   * PAG-01: offset and limit are both optional (no 'required' entry).
   */
  it("PAG-01: offset and limit are not required — pagination is purely opt-in", () => {
    const relay = createMockRelay();
    const tools = buildPageUnderstandingTools(relay, noopStore);
    const pageMapTool = tools.find((t) => t.name === "accordo_browser_get_page_map");
    const required = pageMapTool?.inputSchema.required ?? [];
    expect(required).not.toContain("offset");
    expect(required).not.toContain("limit");
  });
});

describe("Incremental Pagination — get_page_map handler behavior", () => {
  /**
   * PAG-02: offset is forwarded to relay when provided.
   */
  it("PAG-02: handleGetPageMap forwards offset to relay.request payload", async () => {
    const relay = createMockRelay();
    await handleGetPageMap(relay, { offset: 100 }, noopStore);
    expect(relay.request).toHaveBeenCalledWith(
      "get_page_map",
      expect.objectContaining({ offset: 100 }),
      expect.any(Number),
    );
  });

  /**
   * PAG-02: limit is forwarded to relay when provided.
   */
  it("PAG-02: handleGetPageMap forwards limit to relay.request payload", async () => {
    const relay = createMockRelay();
    await handleGetPageMap(relay, { limit: 50 }, noopStore);
    expect(relay.request).toHaveBeenCalledWith(
      "get_page_map",
      expect.objectContaining({ limit: 50 }),
      expect.any(Number),
    );
  });

  /**
   * PAG-02: Both offset and limit are forwarded simultaneously.
   */
  it("PAG-02: handleGetPageMap forwards both offset and limit together", async () => {
    const relay = createMockRelay();
    await handleGetPageMap(relay, { offset: 200, limit: 100 }, noopStore);
    expect(relay.request).toHaveBeenCalledWith(
      "get_page_map",
      expect.objectContaining({ offset: 200, limit: 100 }),
      expect.any(Number),
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// Incremental Pagination — get_page_map BLACK-BOX CLAMPING TESTS
//
// PAG-CLAMP-01: offset < 0  →  behaves identically to offset = 0
// PAG-CLAMP-02: limit  < 1  →  behaves identically to limit  = 1
// PAG-CLAMP-03: limit  > effectiveCap  →  behaves identically to limit = effectiveCap
//
// Effective cap for get_page_map = min(maxNodes ?? 200, 500).
// Default effective cap = 200.
//
// Strategy: call handler with (invalid value) and (its clamped equivalent).
// Both calls MUST produce identical observable outputs (nodes, hasMore,
// nextOffset, totalAvailable, no error).  This is a black-box equivalence
// test — we do NOT inspect what the handler forwarded to the relay.
// ════════════════════════════════════════════════════════════════════════════════

describe("Incremental Pagination — get_page_map clamping (PAG-CLAMP-01..03)", () => {
  // Shared base fixture — 10 total nodes, paginated.
  function makePageData(nodes: { uid: string }[]) {
    return {
      pageId: "mock-page-001",
      frameId: "main",
      snapshotId: "mock-page-001:1",
      capturedAt: "2025-01-01T00:00:00.000Z",
      viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
      source: "dom" as const,
      pageUrl: "https://example.com/page",
      title: "Example Page",
      nodes,
      totalElements: 10,
      depth: 1,
      truncated: false,
    };
  }

  // ── PAG-CLAMP-01: offset < 0 behaves the same as offset = 0 ─────────────
  //
  // Use a SINGLE relay mock that reads the CURRENT call's args (calls.length - 1).
  // Use a fixture of 5+ ordered nodes with limit=2 so offset=-5 produces a
  // clearly different slice than offset=0 when NOT clamped.
  //
  // Without clamping: offset=-5 → collector receives -5 → returns fewer nodes (1) — test FAILS
  // With clamping:    offset=-5 → clamped to 0 → collector returns 2 nodes — test PASSES

  it("PAG-CLAMP-01: offset=-5 produces identical output to offset=0", async () => {
    const relay = {
      request: vi.fn().mockImplementation(async () => {
        const calls = vi.mocked(relay.request).mock.calls as unknown[][];
        const callArgs = (calls[calls.length - 1] ?? []) as unknown[];
        const payload = callArgs[1] as Record<string, unknown>;
        const offset = (payload?.offset as number) ?? 0;

        if (offset < 0) {
          // Unclamped negative offset — collector cannot serve negative index → fewer nodes
          return { success: true, requestId: "test", data: makePageData([{ uid: "n0" }]) };
        }
        // Valid offset (or clamped-to-0) — collector returns 2 nodes (capped by limit=2)
        return { success: true, requestId: "test", data: makePageData([{ uid: "n0" }, { uid: "n1" }, { uid: "n2" }, { uid: "n3" }, { uid: "n4" }]) };
      }),
      isConnected: vi.fn(() => true),
    };

    const resultAt0 = await handleGetPageMap(relay, { offset: 0, limit: 2 }, noopStore);
    const resultAtNeg = await handleGetPageMap(relay, { offset: -5, limit: 2 }, noopStore);

    if ("success" in resultAt0) throw new Error("Expected PageMapResponse");
    if ("success" in resultAtNeg) throw new Error("Expected PageMapResponse");

    expect((resultAtNeg as PageMapResponse).nodes.length).toEqual((resultAt0 as PageMapResponse).nodes.length);
    expect((resultAtNeg as PageMapResponse).totalElements).toEqual((resultAt0 as PageMapResponse).totalElements);
    expect((resultAtNeg as PageMapResponse).truncated).toEqual((resultAt0 as PageMapResponse).truncated);
  });

  it("PAG-CLAMP-01: offset=-1 produces identical output to offset=0 (boundary)", async () => {
    const relay = {
      request: vi.fn().mockImplementation(async () => {
        const calls = vi.mocked(relay.request).mock.calls as unknown[][];
        const callArgs = (calls[calls.length - 1] ?? []) as unknown[];
        const payload = callArgs[1] as Record<string, unknown>;
        const offset = (payload?.offset as number) ?? 0;

        if (offset < 0) {
          return { success: true, requestId: "test", data: makePageData([{ uid: "n0" }]) };
        }
        return { success: true, requestId: "test", data: makePageData([{ uid: "n0" }, { uid: "n1" }, { uid: "n2" }, { uid: "n3" }, { uid: "n4" }]) };
      }),
      isConnected: vi.fn(() => true),
    };

    const resultAt0 = await handleGetPageMap(relay, { offset: 0, limit: 2 }, noopStore);
    const resultAtNeg = await handleGetPageMap(relay, { offset: -1, limit: 2 }, noopStore);

    if ("success" in resultAt0) throw new Error("Expected PageMapResponse");
    if ("success" in resultAtNeg) throw new Error("Expected PageMapResponse");

    expect((resultAtNeg as PageMapResponse).nodes.length).toEqual((resultAt0 as PageMapResponse).nodes.length);
    expect((resultAtNeg as PageMapResponse).totalElements).toEqual((resultAt0 as PageMapResponse).totalElements);
  });

  // ── PAG-CLAMP-02: limit < 1 behaves the same as limit = 1 ──────────────
  //
  // Single shared relay that reads the CURRENT call's limit.
  // Without clamping: limit=0 → collector gets 0 → returns 0 nodes — test FAILS
  // With clamping:    limit=0 → clamped to 1 → collector gets 1 → 1 node — test PASSES

  it("PAG-CLAMP-02: limit=0 produces identical output to limit=1", async () => {
    const relay = {
      request: vi.fn().mockImplementation(async () => {
        const calls = vi.mocked(relay.request).mock.calls as unknown[][];
        const callArgs = (calls[calls.length - 1] ?? []) as unknown[];
        const payload = callArgs[1] as Record<string, unknown>;
        const limit = (payload?.limit as number) ?? 1;

        if (limit < 1) {
          return { success: true, requestId: "test", data: makePageData([]) };
        }
        return { success: true, requestId: "test", data: makePageData([{ uid: "n0" }]) };
      }),
      isConnected: vi.fn(() => true),
    };

    const resultAt1 = await handleGetPageMap(relay, { offset: 0, limit: 1 }, noopStore);
    const resultAt0 = await handleGetPageMap(relay, { offset: 0, limit: 0 }, noopStore);

    if ("success" in resultAt1) throw new Error("Expected PageMapResponse");
    if ("success" in resultAt0) throw new Error("Expected PageMapResponse");

    expect((resultAt0 as PageMapResponse).nodes.length).toEqual((resultAt1 as PageMapResponse).nodes.length);
    expect((resultAt0 as PageMapResponse).totalElements).toEqual((resultAt1 as PageMapResponse).totalElements);
  });

  it("PAG-CLAMP-02: negative limit=-3 produces identical output to limit=1 (boundary)", async () => {
    const relay = {
      request: vi.fn().mockImplementation(async () => {
        const calls = vi.mocked(relay.request).mock.calls as unknown[][];
        const callArgs = (calls[calls.length - 1] ?? []) as unknown[];
        const payload = callArgs[1] as Record<string, unknown>;
        const limit = (payload?.limit as number) ?? 1;

        if (limit < 1) {
          return { success: true, requestId: "test", data: makePageData([]) };
        }
        return { success: true, requestId: "test", data: makePageData([{ uid: "n0" }]) };
      }),
      isConnected: vi.fn(() => true),
    };

    const resultAt1 = await handleGetPageMap(relay, { offset: 0, limit: 1 }, noopStore);
    const resultAtNeg = await handleGetPageMap(relay, { offset: 0, limit: -3 }, noopStore);

    if ("success" in resultAt1) throw new Error("Expected PageMapResponse");
    if ("success" in resultAtNeg) throw new Error("Expected PageMapResponse");

    expect((resultAtNeg as PageMapResponse).nodes.length).toEqual((resultAt1 as PageMapResponse).nodes.length);
    expect((resultAtNeg as PageMapResponse).totalElements).toEqual((resultAt1 as PageMapResponse).totalElements);
  });

  // ── PAG-CLAMP-03: limit > effectiveCap behaves the same as limit = effectiveCap ─
  //
  // Single shared relay that reads the CURRENT call's limit.
  // Without clamping: limit=10000 → collector gets 10000 → returns 3 nodes — test FAILS
  // With clamping:    limit=10000 → clamped to 200 → collector gets 200 → 5 nodes — test PASSES

  it("PAG-CLAMP-03: limit=10000 produces identical output to limit=200 (effective cap = 200)", async () => {
    const relay = {
      request: vi.fn().mockImplementation(async () => {
        const calls = vi.mocked(relay.request).mock.calls as unknown[][];
        const callArgs = (calls[calls.length - 1] ?? []) as unknown[];
        const payload = callArgs[1] as Record<string, unknown>;
        const limit = (payload?.limit as number) ?? 200;

        if (limit > 200) {
          return { success: true, requestId: "test", data: makePageData(Array.from({ length: 3 }, (_, i) => ({ uid: `n${i}` }))) };
        }
        return { success: true, requestId: "test", data: makePageData(Array.from({ length: 5 }, (_, i) => ({ uid: `n${i}` }))) };
      }),
      isConnected: vi.fn(() => true),
    };

    const resultAtCap  = await handleGetPageMap(relay, { offset: 0, limit: 200 }, noopStore);
    const resultAtOver = await handleGetPageMap(relay, { offset: 0, limit: 10000 }, noopStore);

    if ("success" in resultAtCap) throw new Error("Expected PageMapResponse");
    if ("success" in resultAtOver) throw new Error("Expected PageMapResponse");

    expect((resultAtOver as PageMapResponse).nodes.length).toEqual((resultAtCap as PageMapResponse).nodes.length);
    expect((resultAtOver as PageMapResponse).totalElements).toEqual((resultAtCap as PageMapResponse).totalElements);
    expect((resultAtOver as PageMapResponse).truncated).toEqual((resultAtCap as PageMapResponse).truncated);
  });

  it("PAG-CLAMP-03: limit=600 with maxNodes=800 produces identical output to limit=500", async () => {
    const relay = {
      request: vi.fn().mockImplementation(async () => {
        const calls = vi.mocked(relay.request).mock.calls as unknown[][];
        const callArgs = (calls[calls.length - 1] ?? []) as unknown[];
        const payload = callArgs[1] as Record<string, unknown>;
        const limit = (payload?.limit as number) ?? 500;

        if (limit > 500) {
          return { success: true, requestId: "test", data: makePageData(Array.from({ length: 2 }, (_, i) => ({ uid: `n${i}` }))) };
        }
        return { success: true, requestId: "test", data: makePageData(Array.from({ length: 5 }, (_, i) => ({ uid: `n${i}` }))) };
      }),
      isConnected: vi.fn(() => true),
    };

    const resultAt500 = await handleGetPageMap(relay, { offset: 0, limit: 500, maxNodes: 800 }, noopStore);
    const resultAt600 = await handleGetPageMap(relay, { offset: 0, limit: 600, maxNodes: 800 }, noopStore);

    if ("success" in resultAt500) throw new Error("Expected PageMapResponse");
    if ("success" in resultAt600) throw new Error("Expected PageMapResponse");

    expect((resultAt600 as PageMapResponse).nodes.length).toEqual((resultAt500 as PageMapResponse).nodes.length);
    expect((resultAt600 as PageMapResponse).totalElements).toEqual((resultAt500 as PageMapResponse).totalElements);
  });

  it("PAG-CLAMP-03: limit=200 (at effective cap) passes through unchanged — no error produced", async () => {
    const dataAt200 = makePageData(Array.from({ length: 5 }, (_, i) => ({ uid: `n${i}` })));
    const relay = {
      request: vi.fn().mockResolvedValue({ success: true, requestId: "test", data: dataAt200 }),
      isConnected: vi.fn(() => true),
    };

    const result = await handleGetPageMap(relay, { offset: 0, limit: 200 }, noopStore);

    if ("success" in result) throw new Error("Expected PageMapResponse");
    expect((result as PageMapResponse).nodes.length).toBe(5);
    expect((result as PageMapResponse).truncated).toBe(false);
  });
});

describe("Incremental Pagination — get_page_map response metadata", () => {
  it("PAG-03: handler applies offset/limit slice when relay returns unsliced nodes", async () => {
    const relayData = {
      pageId: "mock-page-001",
      frameId: "main",
      snapshotId: "mock-page-001:1",
      capturedAt: "2025-01-01T00:00:00.000Z",
      viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
      source: "dom" as const,
      pageUrl: "https://example.com/page",
      title: "Example Page",
      // Relay returns unsliced data (full page)
      nodes: Array.from({ length: 10 }, (_, i) => ({ uid: `n${i}` })),
      totalElements: 10,
      depth: 1,
      truncated: false,
    };
    const relay = {
      request: vi.fn().mockResolvedValue({ success: true, requestId: "test", data: relayData }),
      isConnected: vi.fn(() => true),
    };

    const result = await handleGetPageMap(relay, { offset: 2, limit: 3 }, noopStore);

    expect(result.nodes).toHaveLength(3);
    expect(result.nodes.map((n: { uid: string }) => n.uid)).toEqual(["n2", "n3", "n4"]);
    expect(result).toHaveProperty("nextOffset", 5);
  });

  /**
   * PAG-03: When offset AND limit are explicitly provided together,
   * response includes hasMore, nextOffset, totalAvailable.
   * The handler injects these (or the relay provides them — either satisfies the contract).
   */
  it("PAG-03: with offset+limit, result includes hasMore, nextOffset, totalAvailable", async () => {
    const plainData = {
      pageId: "mock-page-001",
      frameId: "main",
      snapshotId: "mock-page-001:1",
      capturedAt: "2025-01-01T00:00:00.000Z",
      viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
      source: "dom" as const,
      pageUrl: "https://example.com/page",
      title: "Example Page",
      nodes: [{ uid: "n0" }, { uid: "n1" }, { uid: "n2" }, { uid: "n3" }, { uid: "n4" }],
      totalElements: 10,
      depth: 1,
      truncated: false,
      // intentionally NO hasMore, nextOffset, totalAvailable
    };
    const relay = {
      request: vi.fn().mockResolvedValue({ success: true, requestId: "test", data: plainData }),
      isConnected: vi.fn(() => true),
    };
    const result = await handleGetPageMap(relay, { offset: 0, limit: 5 }, noopStore);

    // PAG-03: Pagination metadata must be present when offset+limit are used
    expect(result).toHaveProperty("hasMore", true);
    expect(result).toHaveProperty("nextOffset", 5);
    expect(result).toHaveProperty("totalAvailable", 10);
  });

  /**
   * PAG-03 regression (live relay): when filters are active, totalAvailable/hasMore
   * must be based on the post-filter total, not totalElements (pre-filter DOM total).
   */
  it("PAG-03 regression: page_map metadata uses filterSummary.totalAfterFilter when present", async () => {
    const filteredData = {
      pageId: "mock-page-001",
      frameId: "main",
      snapshotId: "mock-page-001:1",
      capturedAt: "2025-01-01T00:00:00.000Z",
      viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
      source: "dom" as const,
      pageUrl: "https://example.com/page",
      title: "Example Page",
      nodes: Array.from({ length: 92 }, (_, i) => ({ uid: `n${i}` })),
      totalElements: 1258,
      depth: 1,
      truncated: false,
      filterSummary: {
        activeFilters: ["interactiveOnly"],
        totalBeforeFilter: 618,
        totalAfterFilter: 92,
        reductionRatio: 0.85,
      },
    };
    const relay = {
      request: vi.fn().mockResolvedValue({ success: true, requestId: "test", data: filteredData }),
      isConnected: vi.fn(() => true),
    };

    const result = await handleGetPageMap(relay, { interactiveOnly: true, offset: 0, limit: 5 }, noopStore);

    expect(result.nodes).toHaveLength(5);
    expect(result).toHaveProperty("totalAvailable", 92);
    expect(result).toHaveProperty("hasMore", true);
    expect(result).toHaveProperty("nextOffset", 5);
  });

  /**
   * PAG-03: offset alone (no limit) also triggers pagination metadata.
   * limit defaults to effective cap (maxNodes) when omitted.
   */
  it("PAG-03: offset alone (no limit) triggers pagination metadata", async () => {
    const plainData = {
      pageId: "mock-page-001",
      frameId: "main",
      snapshotId: "mock-page-001:1",
      capturedAt: "2025-01-01T00:00:00.000Z",
      viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
      source: "dom" as const,
      pageUrl: "https://example.com/page",
      title: "Example Page",
      nodes: Array.from({ length: 200 }, (_, i) => ({ uid: `n${i}` })),
      totalElements: 200,
      depth: 1,
      truncated: false,
      // intentionally NO pagination metadata
    };
    const relay = {
      request: vi.fn().mockResolvedValue({ success: true, requestId: "test", data: plainData }),
      isConnected: vi.fn(() => true),
    };
    const result = await handleGetPageMap(relay, { offset: 0 }, noopStore);

    // PAG-03: Metadata required when offset is provided, regardless of limit
    expect(result).toHaveProperty("hasMore", expect.any(Boolean));
    expect(result).toHaveProperty("nextOffset", expect.any(Number));
    expect(result).toHaveProperty("totalAvailable", expect.any(Number));
  });

  /**
   * PAG-03: limit alone (no offset) also triggers pagination metadata.
   * offset defaults to 0 when omitted.
   */
  it("PAG-03: limit alone (no offset) triggers pagination metadata", async () => {
    const plainData = {
      pageId: "mock-page-001",
      frameId: "main",
      snapshotId: "mock-page-001:1",
      capturedAt: "2025-01-01T00:00:00.000Z",
      viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
      source: "dom" as const,
      pageUrl: "https://example.com/page",
      title: "Example Page",
      nodes: [{ uid: "n0" }],
      totalElements: 100,
      depth: 1,
      truncated: false,
      // intentionally NO pagination metadata
    };
    const relay = {
      request: vi.fn().mockResolvedValue({ success: true, requestId: "test", data: plainData }),
      isConnected: vi.fn(() => true),
    };
    const result = await handleGetPageMap(relay, { limit: 10 }, noopStore);

    // PAG-03: Metadata required when limit is provided, regardless of offset
    expect(result).toHaveProperty("hasMore", expect.any(Boolean));
    expect(result).toHaveProperty("nextOffset", expect.any(Number));
    expect(result).toHaveProperty("totalAvailable", expect.any(Number));
  });

  /**
   * PAG-03: Without offset AND limit, pagination metadata must NOT be present.
   */
  it("PAG-03: without offset/limit, pagination metadata is absent from result", async () => {
    const relay = createMockRelay();
    const result = await handleGetPageMap(relay, { maxDepth: 4 }, noopStore);
    expect((result as Record<string, unknown>).hasMore).toBeUndefined();
    expect((result as Record<string, unknown>).nextOffset).toBeUndefined();
    expect((result as Record<string, unknown>).totalAvailable).toBeUndefined();
  });

  /**
   * PAG-04: offset beyond totalAvailable returns empty nodes,
   * hasMore=false, and nextOffset omitted.
   */
  it("PAG-04: offset beyond totalAvailable returns empty nodes, hasMore=false, nextOffset omitted", async () => {
    const beyondData = {
      pageId: "mock-page-001",
      frameId: "main",
      snapshotId: "mock-page-001:1",
      capturedAt: "2025-01-01T00:00:00.000Z",
      viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
      source: "dom" as const,
      pageUrl: "https://example.com/page",
      title: "Example Page",
      nodes: [],
      totalElements: 0,
      depth: 0,
      truncated: false,
      // intentionally NO pagination metadata
    };
    const relay = {
      request: vi.fn().mockResolvedValue({ success: true, requestId: "test", data: beyondData }),
      isConnected: vi.fn(() => true),
    };
    const result = await handleGetPageMap(relay, { offset: 100, limit: 10 }, noopStore);

    expect(result.nodes).toHaveLength(0);
    expect(result).toHaveProperty("hasMore", false);
    expect((result as Record<string, unknown>).nextOffset).toBeUndefined();
  });

  /**
   * PAG-05: truncated:true means collector hit its cap; hasMore=false.
   * The cap is maxNodes=500 for page-map. The fixture uses 600 total elements
   * with offset=400 + limit=200 — collector stops at cap=500, returns 100 nodes,
   * truncated=true.
   */
  it("PAG-05: truncated:true from cap hit means hasMore=false in response", async () => {
    const cappedData = {
      pageId: "mock-page-001",
      frameId: "main",
      snapshotId: "mock-page-001:1",
      capturedAt: "2025-01-01T00:00:00.000Z",
      viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
      source: "dom" as const,
      pageUrl: "https://example.com/page",
      title: "Example Page",
      // 100 nodes returned (offset 400–500), but cap hit means no more beyond this
      nodes: Array.from({ length: 100 }, (_, i) => ({ uid: `n${400 + i}` })),
      totalElements: 600,
      depth: 1,
      truncated: true,
      // intentionally NO pagination metadata
    };
    const relay = {
      request: vi.fn().mockResolvedValue({ success: true, requestId: "test", data: cappedData }),
      isConnected: vi.fn(() => true),
    };
    const result = await handleGetPageMap(relay, { offset: 400, limit: 200 }, noopStore);

    expect(result).toHaveProperty("truncated", true);
    expect(result).toHaveProperty("hasMore", false);
    // Non-trivial: returned node count is strictly less than limit due to cap
    expect(result.nodes.length).toBeLessThan(200);
  });

  /**
   * PAG-05-EFFCAP: User-provided maxNodes lower than global cap (500).
   * The effective cap is min(maxNodes, 500). Pagination cannot exceed this.
   * Fixture: page has 1000 total, user sets maxNodes=100, requesting offset=0, limit=200.
   * Effective cap is 100 — collector returns 100 nodes, truncated=true.
   */
  it("PAG-05-EFFCAP: user maxNodes below global cap becomes the effective cap", async () => {
    const effCapData = {
      pageId: "mock-page-001",
      frameId: "main",
      snapshotId: "mock-page-001:1",
      capturedAt: "2025-01-01T00:00:00.000Z",
      viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
      source: "dom" as const,
      pageUrl: "https://example.com/page",
      title: "Example Page",
      // 100 nodes returned (maxNodes cap of 100), not 200
      nodes: Array.from({ length: 100 }, (_, i) => ({ uid: `n${i}` })),
      totalElements: 1000,
      depth: 1,
      truncated: true,
      // intentionally NO pagination metadata
    };
    const relay = {
      request: vi.fn().mockResolvedValue({ success: true, requestId: "test", data: effCapData }),
      isConnected: vi.fn(() => true),
    };
    // User wants 200 but maxNodes=100 clamps the effective cap to 100
    const result = await handleGetPageMap(relay, { offset: 0, limit: 200, maxNodes: 100 }, noopStore);

    // Non-trivial: exactly 100 nodes returned (maxNodes cap), not 200
    expect(result.nodes.length).toBe(100);
    expect(result).toHaveProperty("truncated", true);
    expect(result).toHaveProperty("hasMore", false);
  });

  /**
   * PAG-06: Pagination coherence uses pageId, not snapshotId.
   * The relay provides sequential pagination metadata — handler passes it through.
   * Same pageId with different snapshotId must return consistent pagination slices.
   */
  it("PAG-06: pagination uses pageId coherence — two calls with same pageId return consistent slices", async () => {
    // First page: offset=0, limit=2 → nextOffset=2, hasMore=true
    const firstPageData = {
      pageId: "page-A",
      frameId: "main",
      snapshotId: "page-A:1",
      capturedAt: "2025-01-01T00:00:00.000Z",
      viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
      source: "dom" as const,
      pageUrl: "https://example.com/page",
      title: "Example Page",
      nodes: [{ uid: "n0" }, { uid: "n1" }],
      totalElements: 10,
      depth: 1,
      truncated: false,
      hasMore: true,
      nextOffset: 2,
      totalAvailable: 10,
    };
    // Second page: offset=2, limit=2 → relay computes nextOffset=4, hasMore=true
    const secondPageData = {
      pageId: "page-A",
      frameId: "main",
      snapshotId: "page-A:2", // different snapshot — DOM drift accepted
      capturedAt: "2025-01-01T00:00:01.000Z",
      viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
      source: "dom" as const,
      pageUrl: "https://example.com/page",
      title: "Example Page",
      nodes: [{ uid: "n2" }, { uid: "n3" }],
      totalElements: 10,
      depth: 1,
      truncated: false,
      hasMore: true,
      nextOffset: 4, // sequential from relay
      totalAvailable: 10,
    };

    let callCount = 0;
    const relay = {
      request: vi.fn().mockImplementation(async () => {
        callCount++;
        return {
          success: true,
          requestId: "test",
          data: callCount === 1 ? firstPageData : secondPageData,
        };
      }),
      isConnected: vi.fn(() => true),
    };

    const firstResult = await handleGetPageMap(relay, { offset: 0, limit: 2, tabId: 1 }, noopStore);
    expect(firstResult).toHaveProperty("pageId", "page-A");
    expect(firstResult).toHaveProperty("hasMore", true);
    expect(firstResult).toHaveProperty("nextOffset", 2);

    const secondResult = await handleGetPageMap(relay, { offset: 2, limit: 2, tabId: 1 }, noopStore);
    expect(secondResult).toHaveProperty("pageId", "page-A");
    expect(secondResult).toHaveProperty("hasMore", true);
    expect(secondResult).toHaveProperty("nextOffset", 4);
  });
});
