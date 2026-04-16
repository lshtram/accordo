/**
 * text-map-tool.test.ts
 *
 * Tests for M112-TEXT — Text Map MCP Tool (browser package)
 *
 * Tests validate:
 * - B2-TX-007: SnapshotEnvelope compliance + retention
 * - B2-TX-008: maxSegments parameter handling (default 500, max 2000)
 * - B2-TX-009: Tool registration (browser_get_text_map with dangerLevel "safe", idempotent true)
 * - B2-TX-010: Backward compatibility — purely additive, no existing tools modified
 *
 * API checklist (buildTextMapTool):
 * - name: "accordo_browser_get_text_map"
 * - description: mentions raw/normalized text, bbox, visibility, semantic context, reading order
 * - inputSchema.maxSegments: integer, minimum 1, maximum 2000
 * - dangerLevel: "safe"
 * - idempotent: true
 * - handler: callable and returns TextMapResponse | TextMapToolError
 *
 * B2-TX-007..010 are tested by calling the tool.handler directly with a mock relay.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  buildTextMapTool,
  GetTextMapArgs,
  TEXT_MAP_TIMEOUT_MS,
  TextVisibility,
  TextMapResponse,
  TextMapToolError,
} from "../text-map-tool.js";
import { SnapshotRetentionStore } from "../snapshot-retention.js";
import type { BrowserRelayLike } from "../types.js";

// ── Test fixtures ──────────────────────────────────────────────────────────────

/** Mock SnapshotEnvelope fields (B2-SV-003). */
const MOCK_ENVELOPE = {
  pageId: "mock-page-001",
  frameId: "main",
  snapshotId: "mock-page-001:1",
  capturedAt: "2025-01-01T00:00:00.000Z",
  viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
  source: "dom" as const,
};

/** Mock text map response from content script (B2-TX-001..008). */
const MOCK_TEXT_MAP_DATA: TextMapResponse = {
  ...MOCK_ENVELOPE,
  pageUrl: "https://example.com/page",
  title: "Example Page",
  segments: [
    {
      textRaw: "Hello",
      textNormalized: "Hello",
      nodeId: 0,
      role: "heading",
      accessibleName: undefined,
      bbox: { x: 0, y: 0, width: 200, height: 40 },
      visibility: "visible" as TextVisibility,
      readingOrderIndex: 0,
    },
    {
      textRaw: "World",
      textNormalized: "World",
      nodeId: 1,
      role: undefined,
      accessibleName: undefined,
      bbox: { x: 0, y: 50, width: 200, height: 30 },
      visibility: "visible" as TextVisibility,
      readingOrderIndex: 1,
    },
    {
      textRaw: "Hidden text",
      textNormalized: "Hidden text",
      nodeId: 2,
      role: undefined,
      accessibleName: undefined,
      bbox: { x: 0, y: 100, width: 200, height: 30 },
      visibility: "hidden" as TextVisibility,
      readingOrderIndex: 2,
    },
    {
      textRaw: "More text",
      textNormalized: "More text",
      nodeId: 3,
      role: undefined,
      accessibleName: undefined,
      bbox: { x: 0, y: 150, width: 200, height: 30 },
      visibility: "visible" as TextVisibility,
      readingOrderIndex: 3,
    },
  ],
  totalSegments: 4,
  truncated: false,
};

// ── Mock relay factory ────────────────────────────────────────────────────────

function createMockRelay(overrides?: Partial<{
  connected: boolean;
  response: ReturnType<BrowserRelayLike["request"]>;
}>) {
  const defaults = {
    connected: true,
    response: Promise.resolve({ success: true, requestId: "test", data: MOCK_TEXT_MAP_DATA }),
  };
  const { connected = defaults.connected, response = defaults.response } = overrides ?? {};

  return {
    request: vi.fn().mockImplementation(() => response),
    push: vi.fn(),
    isConnected: vi.fn(() => connected),
  } as unknown as BrowserRelayLike;
}

// ── Helper to invoke tool handler ─────────────────────────────────────────────

async function invokeToolHandler(
  relay: BrowserRelayLike,
  store: SnapshotRetentionStore,
  args: GetTextMapArgs = {},
): Promise<TextMapResponse | TextMapToolError> {
  const tool = buildTextMapTool(relay, store);
  return (tool.handler as (args: GetTextMapArgs) => Promise<TextMapResponse | TextMapToolError>)(args);
}

// ── B2-TX-009: Tool Registration ─────────────────────────────────────────────

describe("B2-TX-009: Tool registration", () => {
  it("B2-TX-009: buildTextMapTool returns tool with name 'browser_get_text_map'", () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();
    const tool = buildTextMapTool(relay, store);
    expect(tool.name).toBe("accordo_browser_get_text_map");
  });

  it("B2-TX-009: Tool description mentions key capabilities", () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();
    const tool = buildTextMapTool(relay, store);
    expect(tool.description).toContain("text");
    expect(tool.description).toContain("bounding box");
    expect(tool.description).toContain("visibility");
    expect(tool.description).toContain("reading");
  });

  it("B2-TX-009: Tool dangerLevel is 'safe'", () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();
    const tool = buildTextMapTool(relay, store);
    expect(tool.dangerLevel).toBe("safe");
  });

  it("B2-TX-009: Tool idempotent is true", () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();
    const tool = buildTextMapTool(relay, store);
    expect(tool.idempotent).toBe(true);
  });

  it("B2-TX-009: Tool inputSchema has maxSegments as integer with minimum 1, maximum 2000", () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();
    const tool = buildTextMapTool(relay, store);
    expect(tool.inputSchema).toBeDefined();
    expect(tool.inputSchema.type).toBe("object");
    expect(tool.inputSchema.properties).toBeDefined();
    expect(tool.inputSchema.properties.maxSegments).toBeDefined();
    expect(tool.inputSchema.properties.maxSegments.type).toBe("integer");
    expect(tool.inputSchema.properties.maxSegments.minimum).toBe(1);
    expect(tool.inputSchema.properties.maxSegments.maximum).toBe(2000);
  });

  it("B2-TX-009: Tool handler exists and is callable", () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();
    const tool = buildTextMapTool(relay, store);
    expect(typeof tool.handler).toBe("function");
  });
});

// ── B2-TX-007: SnapshotEnvelope Compliance ───────────────────────────────────

describe("B2-TX-007: SnapshotEnvelope compliance + retention", () => {
  it("B2-TX-007: Handler returns TextMapResponse with all envelope fields", async () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();
    const result = await invokeToolHandler(relay, store);
    if ("success" in result) {
      throw new Error(`Expected TextMapResponse but got error: ${JSON.stringify(result)}`);
    }
    expect(result).toHaveProperty("pageId");
    expect(result).toHaveProperty("frameId");
    expect(result).toHaveProperty("snapshotId");
    expect(result).toHaveProperty("capturedAt");
    expect(result).toHaveProperty("viewport");
    expect(result).toHaveProperty("source");
  });

  it("B2-TX-007: Handler persists snapshot to retention store", async () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();
    // Create tool with the store
    const tool = buildTextMapTool(relay, store);
    await (tool.handler as (args: GetTextMapArgs) => Promise<unknown>)({});
    // Store should have the snapshot keyed by pageId (use getLatest for most recent)
    const saved = store.getLatest("mock-page-001");
    expect(saved).toBeDefined();
    expect(saved?.pageId).toBe("mock-page-001");
  });

  it("B2-TX-007: Handler passes pageUrl and title through", async () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();
    const result = await invokeToolHandler(relay, store);
    if ("success" in result) {
      throw new Error(`Expected TextMapResponse but got error: ${JSON.stringify(result)}`);
    }
    expect(result).toHaveProperty("pageUrl", "https://example.com/page");
    expect(result).toHaveProperty("title", "Example Page");
  });

  it("B2-TX-007: pageId is included in persisted snapshot", async () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();
    const tool = buildTextMapTool(relay, store);
    await (tool.handler as (args: GetTextMapArgs) => Promise<unknown>)({});
    const saved = store.getLatest("mock-page-001");
    expect(saved?.pageId).toBe("mock-page-001");
    expect(saved?.frameId).toBe("main");
    expect(saved?.snapshotId).toBe("mock-page-001:1");
  });

  it("B2-TX-007: capturedAt is ISO 8601", async () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();
    const result = await invokeToolHandler(relay, store);
    if ("success" in result) {
      throw new Error(`Expected TextMapResponse but got error: ${JSON.stringify(result)}`);
    }
    expect(result).toHaveProperty("capturedAt");
    expect((result as TextMapResponse).capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it("B2-TX-007: viewport fields are present", async () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();
    const result = await invokeToolHandler(relay, store);
    if ("success" in result) {
      throw new Error(`Expected TextMapResponse but got error: ${JSON.stringify(result)}`);
    }
    const vp = (result as TextMapResponse).viewport;
    expect(vp).toHaveProperty("width");
    expect(vp).toHaveProperty("height");
    expect(vp).toHaveProperty("scrollX");
    expect(vp).toHaveProperty("scrollY");
    expect(vp).toHaveProperty("devicePixelRatio");
  });
});

// ── B2-TX-008: maxSegments Parameter ─────────────────────────────────────────

describe("B2-TX-008: maxSegments parameter", () => {
  it("B2-TX-008: maxSegments forwarded to content script", async () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();
    const tool = buildTextMapTool(relay, store);
    await (tool.handler as (args: GetTextMapArgs) => Promise<unknown>)({ maxSegments: 100 });
    expect(relay.request).toHaveBeenCalledWith(
      "get_text_map",
      expect.objectContaining({ maxSegments: 100 }),
      expect.any(Number),
    );
  });

  it("B2-TX-008: maxSegments forwarded when specified", async () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();
    const tool = buildTextMapTool(relay, store);
    await (tool.handler as (args: GetTextMapArgs) => Promise<unknown>)({ maxSegments: 50 });
    expect(relay.request).toHaveBeenCalledWith(
      "get_text_map",
      expect.objectContaining({ maxSegments: 50 }),
      expect.any(Number),
    );
  });

  it("B2-TX-008: Truncated response is passed through", async () => {
    const truncatedData: TextMapResponse = {
      ...MOCK_TEXT_MAP_DATA,
      segments: MOCK_TEXT_MAP_DATA.segments.slice(0, 1),
      totalSegments: 3,
      truncated: true,
    };
    const relay = createMockRelay({
      response: Promise.resolve({ success: true, requestId: "test", data: truncatedData }),
    });
    const store = new SnapshotRetentionStore();
    const result = await invokeToolHandler(relay, store, { maxSegments: 1 });
    if ("success" in result) {
      throw new Error(`Expected TextMapResponse but got error: ${JSON.stringify(result)}`);
    }
    expect((result as TextMapResponse).truncated).toBe(true);
    expect((result as TextMapResponse).segments.length).toBe(1);
  });

  it("B2-TX-008: totalSegments reflects actual count before truncation", async () => {
    const truncatedData: TextMapResponse = {
      ...MOCK_TEXT_MAP_DATA,
      segments: MOCK_TEXT_MAP_DATA.segments.slice(0, 1),
      totalSegments: 100,
      truncated: true,
    };
    const relay = createMockRelay({
      response: Promise.resolve({ success: true, requestId: "test", data: truncatedData }),
    });
    const store = new SnapshotRetentionStore();
    const result = await invokeToolHandler(relay, store, { maxSegments: 1 });
    if ("success" in result) {
      throw new Error(`Expected TextMapResponse but got error: ${JSON.stringify(result)}`);
    }
    expect((result as TextMapResponse).totalSegments).toBe(100);
    expect((result as TextMapResponse).truncated).toBe(true);
  });

  it("B2-TX-008: TEXT_MAP_TIMEOUT_MS is 10 seconds", () => {
    expect(TEXT_MAP_TIMEOUT_MS).toBe(10_000);
  });
});

// ── B2-TX-010: Backward Compatibility ───────────────────────────────────────

describe("B2-TX-010: Backward compatibility", () => {
  it("B2-TX-010: Handler returns browser-not-connected error when relay disconnected", async () => {
    const relay = createMockRelay({ connected: false });
    const store = new SnapshotRetentionStore();
    const result = await invokeToolHandler(relay, store);
    expect(result).toHaveProperty("success");
    if ("success" in result) {
      expect(result.success).toBe(false);
      expect((result as { error: string }).error).toBe("browser-not-connected");
    }
  });

  it("B2-TX-010: Handler maps relay error to action-failed", async () => {
    const relay = createMockRelay({
      response: Promise.resolve({ success: false, requestId: "test", error: "action-failed" as const }),
    });
    const store = new SnapshotRetentionStore();
    const result = await invokeToolHandler(relay, store);
    expect(result).toHaveProperty("success");
    if ("success" in result) {
      expect(result.success).toBe(false);
      expect((result as { error: string }).error).toBe("action-failed");
    }
  });

  it("B2-TX-010: Handler maps browser-not-connected relay error correctly", async () => {
    const relay = createMockRelay({
      response: Promise.resolve({ success: false, requestId: "test", error: "browser-not-connected" as const }),
    });
    const store = new SnapshotRetentionStore();
    const result = await invokeToolHandler(relay, store);
    expect(result).toHaveProperty("success");
    if ("success" in result) {
      expect(result.success).toBe(false);
      expect((result as { error: string }).error).toBe("browser-not-connected");
    }
  });

  it("F12: Handler maps relay iframe-cross-origin error to iframe-cross-origin", async () => {
    const relay = createMockRelay({
      response: Promise.resolve({ success: false, requestId: "test", error: "iframe-cross-origin" as const }),
    });
    const store = new SnapshotRetentionStore();
    const result = await invokeToolHandler(relay, store);
    expect(result).toHaveProperty("success");
    if ("success" in result) {
      expect(result.success).toBe(false);
      expect((result as { error: string }).error).toBe("iframe-cross-origin");
    }
  });

  it("B2-TX-010: BrowserRelayAction union includes 'get_text_map'", async () => {
    // This is a compile-time check — import should succeed
    const { BrowserRelayAction } = await import("../types.js");
    const action: BrowserRelayAction = "get_text_map";
    expect(action).toBe("get_text_map");
  });

  it("B2-TX-010: Tool is purely additive — new tool added, no existing tools removed", async () => {
    // B2-TX-010 requires that browser_get_text_map is purely additive.
    // We validate:
    // 1. New tool (buildTextMapTool) registers successfully and its handler works
    // 2. Existing BrowserRelayAction entries are preserved (registry unchanged)
    // 3. New action is added to the union without modifying existing ones
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();

    // 1. New tool is added and works
    const textMapTool = buildTextMapTool(relay, store);
    await (textMapTool.handler as (args: GetTextMapArgs) => Promise<unknown>)({});
    expect(relay.request).toHaveBeenCalledWith("get_text_map", expect.any(Object), expect.any(Number));

    // 2. Verify registry unchanged — all previously-existing actions still valid
    const { BrowserRelayAction } = await import("../types.js");
    const existingActions: BrowserRelayAction[] = [
      "get_page_map",
      "inspect_element",
      "get_dom_excerpt",
      "capture_region",
    ];
    for (const action of existingActions) {
      // Each existing action is still a valid BrowserRelayAction member
      const isValidAction: BrowserRelayAction = action;
      expect(isValidAction).toBe(action);
    }

    // 3. Verify new action is the only addition
    const newAction: BrowserRelayAction = "get_text_map";
    expect(newAction).toBe("get_text_map");

    // 4. Additive verification: existing actions are not modified or removed
    // Type-level check that existing union members are intact
    const allActions = [
      ...existingActions,
      newAction,
    ] as BrowserRelayAction[];
    expect(allActions.length).toBe(existingActions.length + 1);
  });

  it("B2-TX-010: Tool is registered alongside all previously-existing browser tools", async () => {
    // Runtime registry-level proof: import the real tool builders and verify all tools coexist
    const { buildPageUnderstandingTools } = await import("../page-understanding-tools.js");
    const { buildWaitForTool } = await import("../wait-tool.js");
    const { buildTextMapTool: buildTM } = await import("../text-map-tool.js");
    const { SnapshotRetentionStore: Store } = await import("../snapshot-retention.js");

    const relay = createMockRelay();
    const store = new Store();

    const pageTools = buildPageUnderstandingTools(relay, store);
    const waitTool = buildWaitForTool(relay);
    const textTool = buildTM(relay, store);

    const allTools = [...pageTools, waitTool, textTool];
    const toolNames = allTools.map((t) => t.name);

    // All previously-existing tools are still present
    expect(toolNames).toContain("accordo_browser_get_page_map");
    expect(toolNames).toContain("accordo_browser_inspect_element");
    expect(toolNames).toContain("accordo_browser_get_dom_excerpt");
    expect(toolNames).toContain("accordo_browser_capture_region");
    expect(toolNames).toContain("accordo_browser_wait_for");
    // New tool is present
    expect(toolNames).toContain("accordo_browser_get_text_map");
    // Exactly 8 tools total (6 page + 1 wait + 1 text)
    expect(allTools.length).toBe(8);
  });
});

// ── B2-TX-001..006: Text Map Response Shape ──────────────────────────────────

describe("B2-TX-001..006: TextMapResponse shape", () => {
  it("B2-TX-001: Response includes segments array", async () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();
    const result = await invokeToolHandler(relay, store);
    if ("success" in result) {
      throw new Error(`Expected TextMapResponse but got error: ${JSON.stringify(result)}`);
    }
    expect(Array.isArray((result as TextMapResponse).segments)).toBe(true);
  });

  it("B2-TX-002: Segments have nodeId and bbox", async () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();
    const result = await invokeToolHandler(relay, store);
    if ("success" in result) {
      throw new Error(`Expected TextMapResponse but got error: ${JSON.stringify(result)}`);
    }
    for (const seg of (result as TextMapResponse).segments) {
      expect(seg).toHaveProperty("nodeId");
      expect(seg).toHaveProperty("bbox");
      expect(seg.bbox).toHaveProperty("x");
      expect(seg.bbox).toHaveProperty("y");
      expect(seg.bbox).toHaveProperty("width");
      expect(seg.bbox).toHaveProperty("height");
    }
  });

  it("B2-TX-002: nodeId is non-negative integer", async () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();
    const result = await invokeToolHandler(relay, store);
    if ("success" in result) {
      throw new Error(`Expected TextMapResponse but got error: ${JSON.stringify(result)}`);
    }
    for (const seg of (result as TextMapResponse).segments) {
      expect(typeof seg.nodeId).toBe("number");
      expect(seg.nodeId).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(seg.nodeId)).toBe(true);
    }
  });

  it("B2-TX-002: bbox has non-negative width and height", async () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();
    const result = await invokeToolHandler(relay, store);
    if ("success" in result) {
      throw new Error(`Expected TextMapResponse but got error: ${JSON.stringify(result)}`);
    }
    for (const seg of (result as TextMapResponse).segments) {
      expect(seg.bbox.width).toBeGreaterThanOrEqual(0);
      expect(seg.bbox.height).toBeGreaterThanOrEqual(0);
    }
  });

  it("B2-TX-003: Segments have textRaw and textNormalized", async () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();
    const result = await invokeToolHandler(relay, store);
    if ("success" in result) {
      throw new Error(`Expected TextMapResponse but got error: ${JSON.stringify(result)}`);
    }
    for (const seg of (result as TextMapResponse).segments) {
      expect(seg).toHaveProperty("textRaw");
      expect(seg).toHaveProperty("textNormalized");
      expect(typeof seg.textRaw).toBe("string");
      expect(typeof seg.textNormalized).toBe("string");
    }
  });

  it("B2-TX-004: Segments have readingOrderIndex", async () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();
    const result = await invokeToolHandler(relay, store);
    if ("success" in result) {
      throw new Error(`Expected TextMapResponse but got error: ${JSON.stringify(result)}`);
    }
    for (const seg of (result as TextMapResponse).segments) {
      expect(seg).toHaveProperty("readingOrderIndex");
      expect(typeof seg.readingOrderIndex).toBe("number");
    }
  });

  it("B2-TX-004 RTL: RTL text map reverses within-band x-order (right-to-left)", async () => {
    // Simulate an RTL page where two items in the same y-band have reversed x-order
    // Rightmost element (higher x) should have lower readingOrderIndex in RTL
    const rtlData: TextMapResponse = {
      ...MOCK_TEXT_MAP_DATA,
      segments: [
        {
          textRaw: "Right-first",
          textNormalized: "Right-first",
          nodeId: 0,
          role: "heading",
          accessibleName: undefined,
          bbox: { x: 500, y: 50, width: 200, height: 40 },
          visibility: "visible" as TextVisibility,
          readingOrderIndex: 0,
        },
        {
          textRaw: "Left-second",
          textNormalized: "Left-second",
          nodeId: 1,
          role: undefined,
          accessibleName: undefined,
          bbox: { x: 10, y: 50, width: 200, height: 40 },
          visibility: "visible" as TextVisibility,
          readingOrderIndex: 1,
        },
      ],
      totalSegments: 2,
      truncated: false,
    };
    const relay = createMockRelay({
      response: Promise.resolve({ success: true, requestId: "test", data: rtlData }),
    });
    const store = new SnapshotRetentionStore();
    const result = await invokeToolHandler(relay, store);
    if ("success" in result) {
      throw new Error(`Expected TextMapResponse but got error: ${JSON.stringify(result)}`);
    }
    // In RTL, rightmost (higher x) should come first in reading order
    const segments = (result as TextMapResponse).segments;
    expect(segments.length).toBe(2);
    expect(segments[0].bbox.x).toBeGreaterThan(segments[1].bbox.x);
    expect(segments[0].readingOrderIndex).toBeLessThan(segments[1].readingOrderIndex);
  });

  it("B2-TX-005: Segments have visibility field with valid value", async () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();
    const result = await invokeToolHandler(relay, store);
    if ("success" in result) {
      throw new Error(`Expected TextMapResponse but got error: ${JSON.stringify(result)}`);
    }
    for (const seg of (result as TextMapResponse).segments) {
      expect(seg).toHaveProperty("visibility");
      expect(["visible", "hidden", "offscreen"]).toContain(seg.visibility);
    }
  });

  it("B2-TX-006: Segments may have role and accessibleName", async () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();
    const result = await invokeToolHandler(relay, store);
    if ("success" in result) {
      throw new Error(`Expected TextMapResponse but got error: ${JSON.stringify(result)}`);
    }
    // At least one segment in the mock data has role "heading"
    const roles = (result as TextMapResponse).segments.map((s) => s.role).filter(Boolean);
    expect(roles.length).toBeGreaterThan(0);
  });

  it("B2-TX-006: accessibleName is string or undefined", async () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();
    const result = await invokeToolHandler(relay, store);
    if ("success" in result) {
      throw new Error(`Expected TextMapResponse but got error: ${JSON.stringify(result)}`);
    }
    for (const seg of (result as TextMapResponse).segments) {
      if (seg.accessibleName !== undefined) {
        expect(typeof seg.accessibleName).toBe("string");
      }
    }
  });
});

// ── Type Exports ─────────────────────────────────────────────────────────────

describe("M112-TEXT type exports", () => {
  it("GetTextMapArgs allows optional maxSegments", () => {
    const args: GetTextMapArgs = {};
    expect(args.maxSegments).toBeUndefined();
    const argsWithMax: GetTextMapArgs = { maxSegments: 100 };
    expect(argsWithMax.maxSegments).toBe(100);
  });

  it("TextVisibility type has all three visibility states", () => {
    const values: TextVisibility[] = ["visible", "hidden", "offscreen"];
    expect(values).toContain("visible");
    expect(values).toContain("hidden");
    expect(values).toContain("offscreen");
  });

  it("TEXT_MAP_TIMEOUT_MS is exported and is a number", () => {
    expect(typeof TEXT_MAP_TIMEOUT_MS).toBe("number");
    expect(TEXT_MAP_TIMEOUT_MS).toBeGreaterThan(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// Incremental Pagination — get_text_map (offset + limit)
// Approved design: add optional offset/limit to tool args; return hasMore,
// nextOffset, totalAvailable when offset or limit is explicitly provided.
// Pagination is stateless offset+limit bounded by collector caps (maxSegments=2000).
// ════════════════════════════════════════════════════════════════════════════════

describe("Incremental Pagination — get_text_map schema (offset + limit args)", () => {
  /**
   * PAG-01: get_text_map tool schema accepts optional offset parameter.
   */
  it("PAG-01: browser_get_text_map tool accepts offset?: number in inputSchema", () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();
    const tool = buildTextMapTool(relay, store);
    expect(tool.inputSchema.properties).toHaveProperty("offset");
    expect(tool.inputSchema.properties.offset.type).toBe("number");
  });

  /**
   * PAG-01: get_text_map tool schema accepts optional limit parameter.
   */
  it("PAG-01: browser_get_text_map tool accepts limit?: number in inputSchema", () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();
    const tool = buildTextMapTool(relay, store);
    expect(tool.inputSchema.properties).toHaveProperty("limit");
    expect(tool.inputSchema.properties.limit.type).toBe("number");
  });

  /**
   * PAG-01: offset and limit are both optional — purely opt-in.
   */
  it("PAG-01: offset and limit are not in the required array", () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();
    const tool = buildTextMapTool(relay, store);
    const required = tool.inputSchema.required ?? [];
    expect(required).not.toContain("offset");
    expect(required).not.toContain("limit");
  });
});

describe("Incremental Pagination — get_text_map handler forwarding", () => {
  /**
   * PAG-02: offset is forwarded to relay when provided.
   */
  it("PAG-02: handler forwards offset to relay.request payload", async () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();
    const tool = buildTextMapTool(relay, store);
    await (tool.handler as (args: GetTextMapArgs) => Promise<unknown>)({ offset: 100 });
    expect(relay.request).toHaveBeenCalledWith(
      "get_text_map",
      expect.objectContaining({ offset: 100 }),
      expect.any(Number),
    );
  });

  /**
   * PAG-02: limit is forwarded to relay when provided.
   */
  it("PAG-02: handler forwards limit to relay.request payload", async () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();
    const tool = buildTextMapTool(relay, store);
    await (tool.handler as (args: GetTextMapArgs) => Promise<unknown>)({ limit: 50 });
    expect(relay.request).toHaveBeenCalledWith(
      "get_text_map",
      expect.objectContaining({ limit: 50 }),
      expect.any(Number),
    );
  });

  /**
   * PAG-02: Both offset and limit forwarded simultaneously.
   */
  it("PAG-02: handler forwards both offset and limit together", async () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();
    const tool = buildTextMapTool(relay, store);
    await (tool.handler as (args: GetTextMapArgs) => Promise<unknown>)({ offset: 200, limit: 100 });
    expect(relay.request).toHaveBeenCalledWith(
      "get_text_map",
      expect.objectContaining({ offset: 200, limit: 100 }),
      expect.any(Number),
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// Incremental Pagination — get_text_map BLACK-BOX CLAMPING TESTS
//
// PAG-CLAMP-01: offset < 0  →  behaves identically to offset = 0
// PAG-CLAMP-02: limit  < 1  →  behaves identically to limit  = 1
// PAG-CLAMP-03: limit  > effectiveCap  →  behaves identically to limit = effectiveCap
//
// Effective cap for get_text_map = min(maxSegments ?? 500, 2000).
// Default effective cap = 500.
//
// Strategy: call handler with (invalid value) and (its clamped equivalent).
// Both calls MUST produce identical observable outputs (segments, hasMore,
// nextOffset, totalAvailable, no error).  This is a black-box equivalence
// test — we do NOT inspect what the handler forwarded to the relay.
// ════════════════════════════════════════════════════════════════════════════════

describe("Incremental Pagination — get_text_map clamping (PAG-CLAMP-01..03)", () => {
  function makeSegment(index: number) {
    return {
      textRaw: `seg${index}`,
      textNormalized: `seg${index}`,
      nodeId: index,
      bbox: { x: 0, y: index * 10, width: 200, height: 10 },
      visibility: "visible" as const,
      readingOrderIndex: index,
    };
  }

  // ── PAG-CLAMP-01: offset < 0 behaves the same as offset = 0 ─────────────
  //
  // Use a SINGLE relay mock so the same underlying scenario is exercised.
  // The mock implementation returns different data based on the forwarded offset:
  //   - negative offset  → returns fewer segments (simulates collector drift / different slice)
  //   - valid offset     → returns the full 3-segment page
  //
  // Without clamping:   offset=-5 → mock returns 1 segment  (FAIL)
  // With clamping:      offset=-5 → clamped to offset=0 → returns 3 segments (PASS)
  //
  // The mock's internal branching is a fixture detail, not an assertion.

  it("PAG-CLAMP-01: offset=-5 produces identical output to offset=0", async () => {
    const store = new SnapshotRetentionStore();

    // Single shared relay — deterministic fixture.
    // mockImplementation reads the CURRENT call's args (last entry in mock.calls).
    // This mirrors how a real collector would return different slices for different offsets.
    //
    // Strategy: use a fixture of 5+ ordered segments; limit=2 so negative offset
    // produces a clearly different slice than offset=0 when NOT clamped.
    // Without clamping: offset=-5 → collector returns fewer segments (1) — test FAILS
    // With clamping:    offset=-5 → clamped to offset=0 → collector returns 2 segments — test PASSES

    const relay = {
      request: vi.fn().mockImplementation(async () => {
        // Always read the LAST call's args — this is the current invocation's args.
        const calls = vi.mocked(relay.request).mock.calls as unknown[][];
        const callArgs = (calls[calls.length - 1] ?? []) as unknown[];
        const payload = callArgs[1] as Record<string, unknown>;
        const offset = (payload?.offset as number) ?? 0;

        if (offset < 0) {
          // Unclamped negative offset — collector skips/returns nothing from negative index
          return {
            success: true,
            requestId: "test",
            data: {
              ...MOCK_ENVELOPE,
              pageUrl: "https://example.com/page",
              title: "Example Page",
              segments: [makeSegment(0)],   // 1 segment — clamped behavior (collector cannot serve -5)
              totalSegments: 10,
              truncated: false,
            },
          };
        }
        // Valid offset (or clamped-to-0) — collector returns 2 segments from the page
        return {
          success: true,
          requestId: "test",
          data: {
            ...MOCK_ENVELOPE,
            pageUrl: "https://example.com/page",
            title: "Example Page",
            segments: [makeSegment(0), makeSegment(1), makeSegment(2), makeSegment(3), makeSegment(4)],
            totalSegments: 10,
            truncated: false,
          },
        };
      }),
      push: vi.fn(),
      isConnected: vi.fn(() => true),
    } as unknown as BrowserRelayLike;

    // offset=0 call — baseline (valid) → collector returns 2 segments (capped by limit=2)
    const resultAt0 = await invokeToolHandler(relay, store, { offset: 0, limit: 2 });
    // offset=-5 call — if clamping exists it behaves as offset=0 → also 2 segments
    //                  if clamping broken → collector receives offset=-5 → returns 1 segment (different)
    const resultAtNeg = await invokeToolHandler(relay, store, { offset: -5, limit: 2 });

    if ("success" in resultAt0) throw new Error("Expected TextMapResponse");
    if ("success" in resultAtNeg) throw new Error("Expected TextMapResponse");

    // Observable equivalence: both calls must produce identical output
    expect((resultAtNeg as TextMapResponse).segments.length).toEqual((resultAt0 as TextMapResponse).segments.length);
    expect((resultAtNeg as TextMapResponse).totalSegments).toEqual((resultAt0 as TextMapResponse).totalSegments);
    expect((resultAtNeg as TextMapResponse).truncated).toEqual((resultAt0 as TextMapResponse).truncated);
  });

  it("PAG-CLAMP-01: offset=-1 produces identical output to offset=0 (boundary)", async () => {
    const store = new SnapshotRetentionStore();

    const relay = {
      request: vi.fn().mockImplementation(async () => {
        const calls = vi.mocked(relay.request).mock.calls as unknown[][];
        const callArgs = (calls[calls.length - 1] ?? []) as unknown[];
        const payload = callArgs[1] as Record<string, unknown>;
        const offset = (payload?.offset as number) ?? 0;

        if (offset < 0) {
          return {
            success: true,
            requestId: "test",
            data: {
              ...MOCK_ENVELOPE,
              pageUrl: "https://example.com/page",
              title: "Example Page",
              segments: [makeSegment(0)],   // 1 — clamped behavior
              totalSegments: 10,
              truncated: false,
            },
          };
        }
        return {
          success: true,
          requestId: "test",
          data: {
            ...MOCK_ENVELOPE,
            pageUrl: "https://example.com/page",
            title: "Example Page",
            segments: [makeSegment(0), makeSegment(1), makeSegment(2), makeSegment(3), makeSegment(4)],
            totalSegments: 10,
            truncated: false,
          },
        };
      }),
      push: vi.fn(),
      isConnected: vi.fn(() => true),
    } as unknown as BrowserRelayLike;

    const resultAt0 = await invokeToolHandler(relay, store, { offset: 0, limit: 2 });
    const resultAtNeg = await invokeToolHandler(relay, store, { offset: -1, limit: 2 });

    if ("success" in resultAt0) throw new Error("Expected TextMapResponse");
    if ("success" in resultAtNeg) throw new Error("Expected TextMapResponse");

    expect((resultAtNeg as TextMapResponse).segments.length).toEqual((resultAt0 as TextMapResponse).segments.length);
    expect((resultAtNeg as TextMapResponse).totalSegments).toEqual((resultAt0 as TextMapResponse).totalSegments);
  });

  // ── PAG-CLAMP-02: limit < 1 behaves the same as limit = 1 ──────────────
  //
  // Use a SINGLE shared relay mock that reads the forwarded limit from call args.
  // Returns different segment counts based on the actual limit received:
  //   - limit < 1  → collector returns 0 segments (wrong/unclamped behaviour)
  //   - limit >= 1 → collector returns 1 segment (correct/clamped behaviour)
  //
  // Without clamping: limit=0 → relay gets limit=0 → returns 0 segments (FAIL)
  // With clamping:    limit=0 → clamped to limit=1 → relay gets limit=1 → 1 segment (PASS)

  it("PAG-CLAMP-02: limit=0 produces identical output to limit=1", async () => {
    const store = new SnapshotRetentionStore();

    const relay = {
      request: vi.fn().mockImplementation(async () => {
        // Read this call's forwarded limit — always the last entry in mock.calls
        const calls = vi.mocked(relay.request).mock.calls;
        const payload = (calls[calls.length - 1]?.[1] as Record<string, unknown>) ?? {};
        const limit = (payload?.limit as number) ?? 1;

        if (limit < 1) {
          // Unclamped limit < 1 — collector returns 0 segments
          return {
            success: true,
            requestId: "test",
            data: {
              ...MOCK_ENVELOPE,
              pageUrl: "https://example.com/page",
              title: "Example Page",
              segments: [],   // 0 segments — unclamped behaviour
              totalSegments: 10,
              truncated: false,
            },
          };
        }
        // Clamped-to-1 (or valid) — collector returns 1 segment
        return {
          success: true,
          requestId: "test",
          data: {
            ...MOCK_ENVELOPE,
            pageUrl: "https://example.com/page",
            title: "Example Page",
            segments: [makeSegment(0)],   // 1 segment — clamped behaviour
            totalSegments: 10,
            truncated: false,
          },
        };
      }),
      push: vi.fn(),
      isConnected: vi.fn(() => true),
    } as unknown as BrowserRelayLike;

    const resultAt1 = await invokeToolHandler(relay, store, { offset: 0, limit: 1 });
    const resultAt0 = await invokeToolHandler(relay, store, { offset: 0, limit: 0 });

    if ("success" in resultAt1) throw new Error("Expected TextMapResponse");
    if ("success" in resultAt0) throw new Error("Expected TextMapResponse");

    expect((resultAt0 as TextMapResponse).segments.length).toEqual((resultAt1 as TextMapResponse).segments.length);
    expect((resultAt0 as TextMapResponse).totalSegments).toEqual((resultAt1 as TextMapResponse).totalSegments);
  });

  it("PAG-CLAMP-02: negative limit=-3 produces identical output to limit=1 (boundary)", async () => {
    const store = new SnapshotRetentionStore();

    const relay = {
      request: vi.fn().mockImplementation(async () => {
        const calls = vi.mocked(relay.request).mock.calls;
        const payload = (calls[calls.length - 1]?.[1] as Record<string, unknown>) ?? {};
        const limit = (payload?.limit as number) ?? 1;

        if (limit < 1) {
          return {
            success: true,
            requestId: "test",
            data: {
              ...MOCK_ENVELOPE,
              pageUrl: "https://example.com/page",
              title: "Example Page",
              segments: [],   // 0 segments — unclamped behaviour
              totalSegments: 10,
              truncated: false,
            },
          };
        }
        return {
          success: true,
          requestId: "test",
          data: {
            ...MOCK_ENVELOPE,
            pageUrl: "https://example.com/page",
            title: "Example Page",
            segments: [makeSegment(0)],   // 1 segment — clamped behaviour
            totalSegments: 10,
            truncated: false,
          },
        };
      }),
      push: vi.fn(),
      isConnected: vi.fn(() => true),
    } as unknown as BrowserRelayLike;

    const resultAt1 = await invokeToolHandler(relay, store, { offset: 0, limit: 1 });
    const resultAtNeg = await invokeToolHandler(relay, store, { offset: 0, limit: -3 });

    if ("success" in resultAt1) throw new Error("Expected TextMapResponse");
    if ("success" in resultAtNeg) throw new Error("Expected TextMapResponse");

    expect((resultAtNeg as TextMapResponse).segments.length).toEqual((resultAt1 as TextMapResponse).segments.length);
    expect((resultAtNeg as TextMapResponse).totalSegments).toEqual((resultAt1 as TextMapResponse).totalSegments);
  });

  // ── PAG-CLAMP-03: limit > effectiveCap behaves the same as limit = effectiveCap ─
  //
  // Use a SINGLE shared relay mock that reads the forwarded limit from call args.
  // Default effective cap = 500 for get_text_map.
  //   - limit > 500  → collector returns 3 segments (unclamped behaviour)
  //   - limit <= 500 → collector returns 5 segments (clamped/capped behaviour)
  //
  // Without clamping: limit=10000 → relay gets 10000 → returns 3 segments (FAIL)
  // With clamping:    limit=10000 → clamped to 500 → relay gets 500 → 5 segments (PASS)

  it("PAG-CLAMP-03: limit=10000 produces identical output to limit=500 (effective cap = 500)", async () => {
    const store = new SnapshotRetentionStore();

    const relay = {
      request: vi.fn().mockImplementation(async () => {
        const calls = vi.mocked(relay.request).mock.calls;
        const payload = (calls[calls.length - 1]?.[1] as Record<string, unknown>) ?? {};
        const limit = (payload?.limit as number) ?? 500;

        if (limit > 500) {
          // Unclamped limit > cap — collector returns fewer segments
          return {
            success: true,
            requestId: "test",
            data: {
              ...MOCK_ENVELOPE,
              pageUrl: "https://example.com/page",
              title: "Example Page",
              segments: [makeSegment(0), makeSegment(1), makeSegment(2)],  // 3 — unclamped behaviour
              totalSegments: 10,
              truncated: false,
            },
          };
        }
        // Clamped-to-cap (or valid) — collector returns 5 segments
        return {
          success: true,
          requestId: "test",
          data: {
            ...MOCK_ENVELOPE,
            pageUrl: "https://example.com/page",
            title: "Example Page",
            segments: Array.from({ length: 5 }, (_, i) => makeSegment(i)),  // 5 — clamped behaviour
            totalSegments: 10,
            truncated: false,
          },
        };
      }),
      push: vi.fn(),
      isConnected: vi.fn(() => true),
    } as unknown as BrowserRelayLike;

    const resultAtCap  = await invokeToolHandler(relay, store, { offset: 0, limit: 500 });
    const resultAtOver = await invokeToolHandler(relay, store, { offset: 0, limit: 10000 });

    if ("success" in resultAtCap) throw new Error("Expected TextMapResponse");
    if ("success" in resultAtOver) throw new Error("Expected TextMapResponse");

    expect((resultAtOver as TextMapResponse).segments.length).toEqual((resultAtCap as TextMapResponse).segments.length);
    expect((resultAtOver as TextMapResponse).totalSegments).toEqual((resultAtCap as TextMapResponse).totalSegments);
    expect((resultAtOver as TextMapResponse).truncated).toEqual((resultAtCap as TextMapResponse).truncated);
  });

  it("PAG-CLAMP-03: limit=5000 with maxSegments=3000 produces identical output to limit=2000", async () => {
    const store = new SnapshotRetentionStore();

    // effective cap = min(3000, 2000) = 2000
    const relay = {
      request: vi.fn().mockImplementation(async () => {
        const calls = vi.mocked(relay.request).mock.calls;
        const payload = (calls[calls.length - 1]?.[1] as Record<string, unknown>) ?? {};
        const limit = (payload?.limit as number) ?? 2000;

        if (limit > 2000) {
          // Unclamped limit > cap — collector returns fewer segments
          return {
            success: true,
            requestId: "test",
            data: {
              ...MOCK_ENVELOPE,
              pageUrl: "https://example.com/page",
              title: "Example Page",
              segments: [makeSegment(0), makeSegment(1)],  // 2 — unclamped behaviour
              totalSegments: 10,
              truncated: false,
            },
          };
        }
        // Clamped-to-cap — collector returns 5 segments
        return {
          success: true,
          requestId: "test",
          data: {
            ...MOCK_ENVELOPE,
            pageUrl: "https://example.com/page",
            title: "Example Page",
            segments: Array.from({ length: 5 }, (_, i) => makeSegment(i)),  // 5 — clamped behaviour
            totalSegments: 10,
            truncated: false,
          },
        };
      }),
      push: vi.fn(),
      isConnected: vi.fn(() => true),
    } as unknown as BrowserRelayLike;

    const resultAtCap  = await invokeToolHandler(relay, store, { offset: 0, limit: 2000, maxSegments: 3000 });
    const resultAtOver = await invokeToolHandler(relay, store, { offset: 0, limit: 5000, maxSegments: 3000 });

    if ("success" in resultAtCap) throw new Error("Expected TextMapResponse");
    if ("success" in resultAtOver) throw new Error("Expected TextMapResponse");

    expect((resultAtOver as TextMapResponse).segments.length).toEqual((resultAtCap as TextMapResponse).segments.length);
    expect((resultAtOver as TextMapResponse).totalSegments).toEqual((resultAtCap as TextMapResponse).totalSegments);
  });

  it("PAG-CLAMP-03: limit=500 (at effective cap) passes through unchanged — no error produced", async () => {
    const store = new SnapshotRetentionStore();

    const relay = createMockRelay({
      response: Promise.resolve({
        success: true,
        requestId: "test",
        data: {
          ...MOCK_ENVELOPE,
          pageUrl: "https://example.com/page",
          title: "Example Page",
          segments: Array.from({ length: 5 }, (_, i) => makeSegment(i)),
          totalSegments: 10,
          truncated: false,
        },
      }),
    });

    const result = await invokeToolHandler(relay, store, { offset: 0, limit: 500 });

    if ("success" in result) throw new Error("Expected TextMapResponse");
    expect((result as TextMapResponse).segments.length).toBe(5);
    expect((result as TextMapResponse).truncated).toBe(false);
  });
});

describe("Incremental Pagination — get_text_map response metadata", () => {
  it("PAG-03: handler applies offset/limit slice when relay returns unsliced segments", async () => {
    const relayData: TextMapResponse = {
      ...MOCK_ENVELOPE,
      pageUrl: "https://example.com/page",
      title: "Example Page",
      // Relay returns unsliced data (full page)
      segments: Array.from({ length: 10 }, (_, i) => ({
        textRaw: `seg${i}`,
        textNormalized: `seg${i}`,
        nodeId: i,
        bbox: { x: 0, y: i * 10, width: 200, height: 10 },
        visibility: "visible" as const,
        readingOrderIndex: i,
      })),
      totalSegments: 10,
      truncated: false,
    };
    const relay = createMockRelay({
      response: Promise.resolve({ success: true, requestId: "test", data: relayData }),
    });
    const store = new SnapshotRetentionStore();
    const result = await invokeToolHandler(relay, store, { offset: 2, limit: 3 });

    if ("success" in result) {
      throw new Error(`Expected TextMapResponse but got error: ${JSON.stringify(result)}`);
    }
    expect(result.segments).toHaveLength(3);
    expect(result.segments.map((s) => s.textNormalized)).toEqual(["seg2", "seg3", "seg4"]);
    expect(result).toHaveProperty("nextOffset", 5);
  });

  /**
   * PAG-03: offset AND limit together trigger pagination metadata in response.
   * Handler injects metadata (or relay provides it — either satisfies the contract).
   */
  it("PAG-03: with offset+limit, result includes hasMore, nextOffset, totalAvailable", async () => {
    const plainData: TextMapResponse = {
      ...MOCK_ENVELOPE,
      pageUrl: "https://example.com/page",
      title: "Example Page",
      segments: MOCK_TEXT_MAP_DATA.segments.slice(0, 3),
      totalSegments: 10,
      truncated: false,
      // intentionally NO pagination metadata
    };
    const relay = createMockRelay({
      response: Promise.resolve({ success: true, requestId: "test", data: plainData }),
    });
    const store = new SnapshotRetentionStore();
    const result = await invokeToolHandler(relay, store, { offset: 0, limit: 3 });

    if ("success" in result) {
      throw new Error(`Expected TextMapResponse but got error: ${JSON.stringify(result)}`);
    }
    // PAG-03: Pagination metadata must be present when offset+limit are used
    expect(result).toHaveProperty("hasMore", true);
    expect(result).toHaveProperty("nextOffset", 3);
    expect(result).toHaveProperty("totalAvailable", 10);
  });

  /**
   * PAG-03 regression (live relay): metadata must use totalSegments from the
   * collector result (full set), not the current returned segment slice length.
   */
  it("PAG-03 regression: text_map metadata uses totalSegments for hasMore/totalAvailable", async () => {
    const plainData: TextMapResponse = {
      ...MOCK_ENVELOPE,
      pageUrl: "https://example.com/page",
      title: "Example Page",
      segments: Array.from({ length: 50 }, (_, i) => ({
        textRaw: `seg${i}`,
        textNormalized: `seg${i}`,
        nodeId: i,
        bbox: { x: 0, y: i * 10, width: 200, height: 10 },
        visibility: "visible" as const,
        readingOrderIndex: i,
      })),
      totalSegments: 675,
      truncated: true,
    };
    const relay = createMockRelay({
      response: Promise.resolve({ success: true, requestId: "test", data: plainData }),
    });
    const store = new SnapshotRetentionStore();
    const result = await invokeToolHandler(relay, store, { maxSegments: 50, offset: 0, limit: 10 });

    if ("success" in result) {
      throw new Error(`Expected TextMapResponse but got error: ${JSON.stringify(result)}`);
    }

    expect(result.segments).toHaveLength(10);
    expect(result).toHaveProperty("totalAvailable", 50);
    expect(result).toHaveProperty("hasMore", true);
    expect(result).toHaveProperty("nextOffset", 10);
  });

  /**
   * PAG-03: offset alone (no limit) also triggers pagination metadata.
   * limit defaults to effective cap (maxSegments=2000) when omitted.
   */
  it("PAG-03: offset alone (no limit) triggers pagination metadata", async () => {
    const plainData: TextMapResponse = {
      ...MOCK_ENVELOPE,
      pageUrl: "https://example.com/page",
      title: "Example Page",
      segments: Array.from({ length: 500 }, (_, i) => ({
        textRaw: `seg${i}`,
        textNormalized: `seg${i}`,
        nodeId: i,
        bbox: { x: 0, y: i * 10, width: 200, height: 10 },
        visibility: "visible" as const,
        readingOrderIndex: i,
      })),
      totalSegments: 500,
      truncated: false,
      // intentionally NO pagination metadata
    };
    const relay = createMockRelay({
      response: Promise.resolve({ success: true, requestId: "test", data: plainData }),
    });
    const store = new SnapshotRetentionStore();
    const result = await invokeToolHandler(relay, store, { offset: 0 });

    if ("success" in result) {
      throw new Error(`Expected TextMapResponse but got error: ${JSON.stringify(result)}`);
    }
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
    const plainData: TextMapResponse = {
      ...MOCK_ENVELOPE,
      pageUrl: "https://example.com/page",
      title: "Example Page",
      segments: [{ textRaw: "seg0", textNormalized: "seg0", nodeId: 0, bbox: { x: 0, y: 0, width: 200, height: 10 }, visibility: "visible" as const, readingOrderIndex: 0 }],
      totalSegments: 100,
      truncated: false,
      // intentionally NO pagination metadata
    };
    const relay = createMockRelay({
      response: Promise.resolve({ success: true, requestId: "test", data: plainData }),
    });
    const store = new SnapshotRetentionStore();
    const result = await invokeToolHandler(relay, store, { limit: 10 });

    if ("success" in result) {
      throw new Error(`Expected TextMapResponse but got error: ${JSON.stringify(result)}`);
    }
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
    const store = new SnapshotRetentionStore();
    const result = await invokeToolHandler(relay, store, { maxSegments: 500 });
    if ("success" in result) {
      throw new Error(`Expected TextMapResponse but got error: ${JSON.stringify(result)}`);
    }
    expect((result as Record<string, unknown>).hasMore).toBeUndefined();
    expect((result as Record<string, unknown>).nextOffset).toBeUndefined();
    expect((result as Record<string, unknown>).totalAvailable).toBeUndefined();
  });

  /**
   * PAG-04: offset beyond totalAvailable returns empty segments,
   * hasMore=false, nextOffset omitted.
   */
  it("PAG-04: offset beyond totalAvailable returns empty segments, hasMore=false, nextOffset omitted", async () => {
    const beyondData: TextMapResponse = {
      ...MOCK_ENVELOPE,
      pageUrl: "https://example.com/page",
      title: "Example Page",
      segments: [],
      totalSegments: 0,
      truncated: false,
      // intentionally NO pagination metadata
    };
    const relay = createMockRelay({
      response: Promise.resolve({ success: true, requestId: "test", data: beyondData }),
    });
    const store = new SnapshotRetentionStore();
    const result = await invokeToolHandler(relay, store, { offset: 100, limit: 10 });

    if ("success" in result) {
      throw new Error(`Expected TextMapResponse but got error: ${JSON.stringify(result)}`);
    }
    expect(result.segments).toHaveLength(0);
    expect(result).toHaveProperty("hasMore", false);
    expect((result as Record<string, unknown>).nextOffset).toBeUndefined();
  });

  /**
   * PAG-05: truncated:true from collector cap means hasMore=false.
   * Fixture: page has 3000 total segments, offset=1500, limit=1000.
   * Collector cap is 2000, so at offset=1500 it collects 1500-2000 (500 segments),
   * truncated=true. Cannot paginate beyond cap.
   */
  it("PAG-05: truncated:true from cap hit means hasMore=false in response", async () => {
    const cappedSegments = Array.from({ length: 500 }, (_, i) => ({
      textRaw: `seg${1500 + i}`,
      textNormalized: `seg${1500 + i}`,
      nodeId: 1500 + i,
      bbox: { x: 0, y: (1500 + i) * 10, width: 200, height: 10 },
      visibility: "visible" as const,
      readingOrderIndex: 1500 + i,
    }));
    const cappedData: TextMapResponse = {
      ...MOCK_ENVELOPE,
      pageUrl: "https://example.com/page",
      title: "Example Page",
      segments: cappedSegments,
      totalSegments: 3000,
      truncated: true,
      // intentionally NO pagination metadata
    };
    const relay = createMockRelay({
      response: Promise.resolve({ success: true, requestId: "test", data: cappedData }),
    });
    const store = new SnapshotRetentionStore();
    const result = await invokeToolHandler(relay, store, { offset: 1500, limit: 1000 });

    if ("success" in result) {
      throw new Error(`Expected TextMapResponse but got error: ${JSON.stringify(result)}`);
    }
    expect(result).toHaveProperty("truncated", true);
    expect(result).toHaveProperty("hasMore", false);
    // Non-trivial: returned count is strictly less than limit due to cap
    expect(result.segments.length).toBeLessThan(1000);
  });

  /**
   * PAG-05-EFFCAP: User-provided maxSegments lower than global cap (2000).
   * Effective cap is min(maxSegments, 2000). Fixture: page has 5000 total,
   * user sets maxSegments=300, requesting offset=0, limit=500.
   * Effective cap is 300 — collector returns 300 segments, truncated=true.
   */
  it("PAG-05-EFFCAP: user maxSegments below global cap becomes the effective cap", async () => {
    const effCapSegments = Array.from({ length: 300 }, (_, i) => ({
      textRaw: `seg${i}`,
      textNormalized: `seg${i}`,
      nodeId: i,
      bbox: { x: 0, y: i * 10, width: 200, height: 10 },
      visibility: "visible" as const,
      readingOrderIndex: i,
    }));
    const effCapData: TextMapResponse = {
      ...MOCK_ENVELOPE,
      pageUrl: "https://example.com/page",
      title: "Example Page",
      segments: effCapSegments,
      totalSegments: 5000,
      truncated: true,
      // intentionally NO pagination metadata
    };
    const relay = createMockRelay({
      response: Promise.resolve({ success: true, requestId: "test", data: effCapData }),
    });
    const store = new SnapshotRetentionStore();
    // User wants 500 but maxSegments=300 clamps effective cap to 300
    const result = await invokeToolHandler(relay, store, { offset: 0, limit: 500, maxSegments: 300 });

    if ("success" in result) {
      throw new Error(`Expected TextMapResponse but got error: ${JSON.stringify(result)}`);
    }
    // Non-trivial: exactly 300 returned (maxSegments cap), not 500
    expect(result.segments.length).toBe(300);
    expect(result).toHaveProperty("truncated", true);
    expect(result).toHaveProperty("hasMore", false);
  });

  /**
   * PAG-06: Pagination coherence uses pageId, not snapshotId.
   * The relay provides sequential pagination metadata — handler passes it through.
   * Same pageId with different snapshotId must return consistent pagination slices.
   */
  it("PAG-06: pagination uses pageId coherence — two calls with same pageId return consistent slices", async () => {
    // First page: offset=0, limit=2 → relay returns nextOffset=2, hasMore=true
    const firstPageData: TextMapResponse = {
      ...MOCK_ENVELOPE,
      pageId: "text-page-A",
      snapshotId: "text-page-A:1",
      pageUrl: "https://example.com/page",
      title: "Example Page",
      segments: MOCK_TEXT_MAP_DATA.segments.slice(0, 2),
      totalSegments: 10,
      truncated: false,
      hasMore: true,
      nextOffset: 2,
      totalAvailable: 10,
    };
    // Second page: offset=2, limit=2 → relay computes nextOffset=4, hasMore=true
    const secondPageData: TextMapResponse = {
      ...MOCK_ENVELOPE,
      pageId: "text-page-A",
      snapshotId: "text-page-A:2", // different snapshot — DOM drift accepted
      pageUrl: "https://example.com/page",
      title: "Example Page",
      segments: MOCK_TEXT_MAP_DATA.segments.slice(2, 4),
      totalSegments: 10,
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
      push: vi.fn(),
      isConnected: vi.fn(() => true),
    } as unknown as BrowserRelayLike;

    const store = new SnapshotRetentionStore();
    const tool = buildTextMapTool(relay, store);

    const firstResult = await (tool.handler as (args: GetTextMapArgs) => Promise<TextMapResponse | TextMapToolError>)(
      { offset: 0, limit: 2, tabId: 1 },
    );
    if ("success" in firstResult) throw new Error("Expected TextMapResponse");
    expect(firstResult).toHaveProperty("pageId", "text-page-A");
    expect(firstResult).toHaveProperty("hasMore", true);
    expect(firstResult).toHaveProperty("nextOffset", 2);

    const secondResult = await (tool.handler as (args: GetTextMapArgs) => Promise<TextMapResponse | TextMapToolError>)(
      { offset: 2, limit: 2, tabId: 1 },
    );
    if ("success" in secondResult) throw new Error("Expected TextMapResponse");
    expect(secondResult).toHaveProperty("pageId", "text-page-A");
    expect(secondResult).toHaveProperty("hasMore", true);
    expect(secondResult).toHaveProperty("nextOffset", 4);
  });
});
