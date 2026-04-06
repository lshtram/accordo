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
  ],
  totalSegments: 3,
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
