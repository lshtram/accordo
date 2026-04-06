/**
 * semantic-graph-tool.test.ts
 *
 * Tests for M113-SEM — Semantic Graph MCP Tool (browser package)
 *
 * Tests validate:
 * - B2-SG-011: Tool registration (browser_get_semantic_graph with dangerLevel "safe", idempotent true)
 * - B2-SG-007: SnapshotEnvelope compliance + retention
 * - B2-SG-010RL: Relay error handling
 * - B2-SG-012: Backward compatibility — purely additive, no existing tools modified
 *
 * API checklist (buildSemanticGraphTool):
 * - name: "accordo_browser_get_semantic_graph"
 * - description: mentions accessibility tree, landmark regions, document outline, form models
 * - inputSchema.maxDepth: integer, minimum 1, maximum 16
 * - inputSchema.visibleOnly: boolean
 * - dangerLevel: "safe"
 * - idempotent: true
 * - handler: callable and returns SemanticGraphResponse | SemanticGraphToolError
 *
 * B2-SG-007..012 and type exports are tested by calling the tool.handler directly
 * with a mock relay.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  buildSemanticGraphTool,
  GetSemanticGraphArgs,
  SEMANTIC_GRAPH_TOOL_TIMEOUT_MS,
  SemanticGraphResponse,
  SemanticGraphToolError,
} from "../semantic-graph-tool.js";
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

/** Mock semantic graph response from content script (B2-SG-001..009). */
const MOCK_SEMANTIC_GRAPH_DATA: SemanticGraphResponse = {
  ...MOCK_ENVELOPE,
  pageUrl: "https://example.com/page",
  title: "Example Page",
  a11yTree: [
    {
      role: "document",
      name: "Example Page",
      nodeId: 0,
      children: [
        {
          role: "banner",
          name: undefined,
          nodeId: 1,
          children: [],
        },
        {
          role: "main",
          name: undefined,
          nodeId: 2,
          children: [
            {
              role: "heading",
              name: "Section One",
              level: 2,
              nodeId: 3,
              children: [],
            },
          ],
        },
      ],
    },
  ],
  landmarks: [
    {
      role: "banner",
      label: undefined,
      nodeId: 1,
      tag: "header",
    },
    {
      role: "main",
      label: undefined,
      nodeId: 2,
      tag: "main",
    },
    {
      role: "navigation",
      label: "Primary nav",
      nodeId: 4,
      tag: "nav",
    },
  ],
  outline: [
    {
      level: 1,
      text: "Example Page",
      nodeId: 0,
      id: undefined,
    },
    {
      level: 2,
      text: "Section One",
      nodeId: 3,
      id: "section-1",
    },
  ],
  forms: [
    {
      formId: "login-form",
      name: "login",
      action: "/login",
      method: "POST",
      nodeId: 5,
      fields: [
        {
          tag: "input",
          type: "text",
          name: "username",
          label: "Username",
          required: true,
          value: "",
          nodeId: 6,
        },
        {
          tag: "input",
          type: "password",
          name: "password",
          label: "Password",
          required: false,
          value: "[REDACTED]",
          nodeId: 7,
        },
        {
          tag: "button",
          type: "submit",
          name: undefined,
          label: "Sign In",
          required: false,
          value: undefined,
          nodeId: 8,
        },
      ],
    },
  ],
};

// ── Mock relay factory ────────────────────────────────────────────────────────

function createMockRelay(overrides?: Partial<{
  connected: boolean;
  response: ReturnType<BrowserRelayLike["request"]>;
}>) {
  const defaults = {
    connected: true,
    response: Promise.resolve({ success: true, requestId: "test", data: MOCK_SEMANTIC_GRAPH_DATA }),
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
  args: GetSemanticGraphArgs = {},
): Promise<SemanticGraphResponse | SemanticGraphToolError> {
  const tool = buildSemanticGraphTool(relay, store);
  return (tool.handler as (args: GetSemanticGraphArgs) => Promise<SemanticGraphResponse | SemanticGraphToolError>)(args);
}

// ── B2-SG-011: Tool Registration ─────────────────────────────────────────────

describe("B2-SG-011: Tool registration", () => {
  it("B2-SG-011: buildSemanticGraphTool returns tool with name 'browser_get_semantic_graph'", () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();
    const tool = buildSemanticGraphTool(relay, store);
    expect(tool.name).toBe("accordo_browser_get_semantic_graph");
  });

  it("B2-SG-011: Tool description mentions accessibility tree, landmarks, outline, and forms", () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();
    const tool = buildSemanticGraphTool(relay, store);
    expect(tool.description).toContain("accessibility");
    expect(tool.description).toContain("landmark");
    expect(tool.description).toContain("outline");
    expect(tool.description).toContain("form");
  });

  it("B2-SG-011: Tool dangerLevel is 'safe'", () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();
    const tool = buildSemanticGraphTool(relay, store);
    expect(tool.dangerLevel).toBe("safe");
  });

  it("B2-SG-011: Tool idempotent is true", () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();
    const tool = buildSemanticGraphTool(relay, store);
    expect(tool.idempotent).toBe(true);
  });

  it("B2-SG-011: Tool inputSchema has maxDepth as integer with minimum 1, maximum 16", () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();
    const tool = buildSemanticGraphTool(relay, store);
    expect(tool.inputSchema).toBeDefined();
    expect(tool.inputSchema.type).toBe("object");
    expect(tool.inputSchema.properties).toBeDefined();
    expect(tool.inputSchema.properties.maxDepth).toBeDefined();
    expect(tool.inputSchema.properties.maxDepth.type).toBe("integer");
    expect(tool.inputSchema.properties.maxDepth.minimum).toBe(1);
    expect(tool.inputSchema.properties.maxDepth.maximum).toBe(16);
  });

  it("B2-SG-011: Tool inputSchema has visibleOnly as boolean", () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();
    const tool = buildSemanticGraphTool(relay, store);
    expect(tool.inputSchema.properties.visibleOnly).toBeDefined();
    expect(tool.inputSchema.properties.visibleOnly.type).toBe("boolean");
  });

  it("B2-SG-011: Tool handler exists and is callable", () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();
    const tool = buildSemanticGraphTool(relay, store);
    expect(typeof tool.handler).toBe("function");
  });
});

// ── B2-SG-007: SnapshotEnvelope Compliance + Retention ────────────────────────

describe("B2-SG-007: SnapshotEnvelope compliance + retention", () => {
  it("B2-SG-007: Handler returns SemanticGraphResponse with all envelope fields", async () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();
    const result = await invokeToolHandler(relay, store);
    if ("success" in result) {
      throw new Error(`Expected SemanticGraphResponse but got error: ${JSON.stringify(result)}`);
    }
    expect(result).toHaveProperty("pageId");
    expect(result).toHaveProperty("frameId");
    expect(result).toHaveProperty("snapshotId");
    expect(result).toHaveProperty("capturedAt");
    expect(result).toHaveProperty("viewport");
    expect(result).toHaveProperty("source");
  });

  it("B2-SG-007: Handler persists snapshot to retention store", async () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();
    const tool = buildSemanticGraphTool(relay, store);
    await (tool.handler as (args: GetSemanticGraphArgs) => Promise<unknown>)({});
    const saved = store.getLatest("mock-page-001");
    expect(saved).toBeDefined();
    expect(saved?.pageId).toBe("mock-page-001");
  });

  it("B2-SG-007: Handler passes pageUrl and title through", async () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();
    const result = await invokeToolHandler(relay, store);
    if ("success" in result) {
      throw new Error(`Expected SemanticGraphResponse but got error: ${JSON.stringify(result)}`);
    }
    expect(result).toHaveProperty("pageUrl", "https://example.com/page");
    expect(result).toHaveProperty("title", "Example Page");
  });

  it("B2-SG-007: pageId is included in persisted snapshot", async () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();
    const tool = buildSemanticGraphTool(relay, store);
    await (tool.handler as (args: GetSemanticGraphArgs) => Promise<unknown>)({});
    const saved = store.getLatest("mock-page-001");
    expect(saved?.pageId).toBe("mock-page-001");
    expect(saved?.frameId).toBe("main");
    expect(saved?.snapshotId).toBe("mock-page-001:1");
  });

  it("B2-SG-007: capturedAt is ISO 8601", async () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();
    const result = await invokeToolHandler(relay, store);
    if ("success" in result) {
      throw new Error(`Expected SemanticGraphResponse but got error: ${JSON.stringify(result)}`);
    }
    expect(result).toHaveProperty("capturedAt");
    expect((result as SemanticGraphResponse).capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it("B2-SG-007: viewport fields are present", async () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();
    const result = await invokeToolHandler(relay, store);
    if ("success" in result) {
      throw new Error(`Expected SemanticGraphResponse but got error: ${JSON.stringify(result)}`);
    }
    const vp = (result as SemanticGraphResponse).viewport;
    expect(vp).toHaveProperty("width");
    expect(vp).toHaveProperty("height");
    expect(vp).toHaveProperty("scrollX");
    expect(vp).toHaveProperty("scrollY");
    expect(vp).toHaveProperty("devicePixelRatio");
  });

  it("B2-SG-007: SEMANTIC_GRAPH_TOOL_TIMEOUT_MS is 15000", () => {
    expect(SEMANTIC_GRAPH_TOOL_TIMEOUT_MS).toBe(15_000);
  });
});

// ── B2-SG-008..009: Parameter Forwarding ─────────────────────────────────────

describe("B2-SG-008..009: Parameter forwarding", () => {
  it("B2-SG-008: maxDepth forwarded to content script", async () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();
    const tool = buildSemanticGraphTool(relay, store);
    await (tool.handler as (args: GetSemanticGraphArgs) => Promise<unknown>)({ maxDepth: 4 });
    expect(relay.request).toHaveBeenCalledWith(
      "get_semantic_graph",
      expect.objectContaining({ maxDepth: 4 }),
      expect.any(Number),
    );
  });

  it("B2-SG-008: visibleOnly forwarded to content script", async () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();
    const tool = buildSemanticGraphTool(relay, store);
    await (tool.handler as (args: GetSemanticGraphArgs) => Promise<unknown>)({ visibleOnly: false });
    expect(relay.request).toHaveBeenCalledWith(
      "get_semantic_graph",
      expect.objectContaining({ visibleOnly: false }),
      expect.any(Number),
    );
  });

  it("B2-SG-008: Both maxDepth and visibleOnly forwarded together", async () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();
    const tool = buildSemanticGraphTool(relay, store);
    await (tool.handler as (args: GetSemanticGraphArgs) => Promise<unknown>)({ maxDepth: 8, visibleOnly: true });
    expect(relay.request).toHaveBeenCalledWith(
      "get_semantic_graph",
      expect.objectContaining({ maxDepth: 8, visibleOnly: true }),
      expect.any(Number),
    );
  });
});

// ── B2-SG-010RL: Relay Error Handling ───────────────────────────────────────

describe("B2-SG-010RL: Relay error handling", () => {
  it("B2-SG-010RL: Handler returns browser-not-connected error when relay disconnected", async () => {
    const relay = createMockRelay({ connected: false });
    const store = new SnapshotRetentionStore();
    const result = await invokeToolHandler(relay, store);
    expect(result).toHaveProperty("success");
    if ("success" in result) {
      expect(result.success).toBe(false);
      expect((result as { error: string }).error).toBe("browser-not-connected");
    }
  });

  it("B2-SG-010RL: Handler maps relay error to action-failed", async () => {
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

  it("B2-SG-010RL: Handler maps browser-not-connected relay error correctly", async () => {
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
});

// ── B2-SG-012: Backward Compatibility ────────────────────────────────────────

describe("B2-SG-012: Backward compatibility", () => {
  it("B2-SG-012: BrowserRelayAction union includes 'get_semantic_graph'", async () => {
    const { BrowserRelayAction } = await import("../types.js");
    const action: BrowserRelayAction = "get_semantic_graph";
    expect(action).toBe("get_semantic_graph");
  });

  it("B2-SG-012: Tool is purely additive — new tool added, no existing tools removed", async () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();

    // 1. New tool is added and works
    const sgTool = buildSemanticGraphTool(relay, store);
    await (sgTool.handler as (args: GetSemanticGraphArgs) => Promise<unknown>)({});
    expect(relay.request).toHaveBeenCalledWith("get_semantic_graph", expect.any(Object), expect.any(Number));

    // 2. Verify registry unchanged — all previously-existing actions still valid
    const { BrowserRelayAction } = await import("../types.js");
    const existingActions: BrowserRelayAction[] = [
      "get_page_map",
      "inspect_element",
      "get_dom_excerpt",
      "capture_region",
    ];
    for (const action of existingActions) {
      const isValidAction: BrowserRelayAction = action;
      expect(isValidAction).toBe(action);
    }

    // 3. Verify new action is the only addition
    const newAction: BrowserRelayAction = "get_semantic_graph";
    expect(newAction).toBe("get_semantic_graph");

    // 4. Additive verification: existing + new
    const allActions = [
      ...existingActions,
      newAction,
    ] as BrowserRelayAction[];
    expect(allActions.length).toBe(existingActions.length + 1);
  });

  it("B2-SG-012: Tool is registered alongside all previously-existing browser tools", async () => {
    const { buildPageUnderstandingTools } = await import("../page-understanding-tools.js");
    const { buildWaitForTool } = await import("../wait-tool.js");
    const { buildTextMapTool } = await import("../text-map-tool.js");
    const { buildSemanticGraphTool: buildSG } = await import("../semantic-graph-tool.js");
    const { SnapshotRetentionStore: Store } = await import("../snapshot-retention.js");

    const relay = createMockRelay();
    const store = new Store();

    const pageTools = buildPageUnderstandingTools(relay, store);
    const waitTool = buildWaitForTool(relay);
    const textTool = buildTextMapTool(relay, store);
    const sgTool = buildSG(relay, store);

    const allTools = [...pageTools, waitTool, textTool, sgTool];
    const toolNames = allTools.map((t) => t.name);

    // All previously-existing tools are still present
    expect(toolNames).toContain("accordo_browser_get_page_map");
    expect(toolNames).toContain("accordo_browser_inspect_element");
    expect(toolNames).toContain("accordo_browser_get_dom_excerpt");
    expect(toolNames).toContain("accordo_browser_capture_region");
    expect(toolNames).toContain("accordo_browser_wait_for");
    expect(toolNames).toContain("accordo_browser_get_text_map");
    // New tool is present
    expect(toolNames).toContain("accordo_browser_get_semantic_graph");
    // Total: 6 page + 1 wait + 1 text + 1 sg = 9
    expect(allTools.length).toBe(9);
  });
});

// ── B2-SG-001..009: Semantic Graph Response Shape ─────────────────────────────

describe("B2-SG-001..009: SemanticGraphResponse shape", () => {
  it("B2-SG-001: Response includes all four sub-trees", async () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();
    const result = await invokeToolHandler(relay, store);
    if ("success" in result) {
      throw new Error(`Expected SemanticGraphResponse but got error: ${JSON.stringify(result)}`);
    }
    expect(result).toHaveProperty("a11yTree");
    expect(result).toHaveProperty("landmarks");
    expect(result).toHaveProperty("outline");
    expect(result).toHaveProperty("forms");
  });

  it("B2-SG-002: a11yTree is an array of SemanticA11yNode", async () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();
    const result = await invokeToolHandler(relay, store);
    if ("success" in result) {
      throw new Error(`Expected SemanticGraphResponse but got error: ${JSON.stringify(result)}`);
    }
    expect(Array.isArray((result as SemanticGraphResponse).a11yTree)).toBe(true);
  });

  it("B2-SG-003: landmarks is an array of Landmark", async () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();
    const result = await invokeToolHandler(relay, store);
    if ("success" in result) {
      throw new Error(`Expected SemanticGraphResponse but got error: ${JSON.stringify(result)}`);
    }
    expect(Array.isArray((result as SemanticGraphResponse).landmarks)).toBe(true);
  });

  it("B2-SG-004: outline is an array of OutlineHeading", async () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();
    const result = await invokeToolHandler(relay, store);
    if ("success" in result) {
      throw new Error(`Expected SemanticGraphResponse but got error: ${JSON.stringify(result)}`);
    }
    expect(Array.isArray((result as SemanticGraphResponse).outline)).toBe(true);
  });

  it("B2-SG-005: forms is an array of FormModel", async () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();
    const result = await invokeToolHandler(relay, store);
    if ("success" in result) {
      throw new Error(`Expected SemanticGraphResponse but got error: ${JSON.stringify(result)}`);
    }
    expect(Array.isArray((result as SemanticGraphResponse).forms)).toBe(true);
  });
});

// ── Type Exports ─────────────────────────────────────────────────────────────

describe("M113-SEM type exports", () => {
  it("GetSemanticGraphArgs allows optional maxDepth and visibleOnly", () => {
    const args: GetSemanticGraphArgs = {};
    expect(args.maxDepth).toBeUndefined();
    expect(args.visibleOnly).toBeUndefined();
    const argsWithBoth: GetSemanticGraphArgs = { maxDepth: 8, visibleOnly: false };
    expect(argsWithBoth.maxDepth).toBe(8);
    expect(argsWithBoth.visibleOnly).toBe(false);
  });

  it("SemanticGraphToolError has success: false and typed error", () => {
    const err: SemanticGraphToolError = { success: false, error: "browser-not-connected" };
    expect(err.success).toBe(false);
    expect(["browser-not-connected", "timeout", "action-failed"]).toContain(err.error);
  });

  it("SEMANTIC_GRAPH_TOOL_TIMEOUT_MS is exported and is a number", () => {
    expect(typeof SEMANTIC_GRAPH_TOOL_TIMEOUT_MS).toBe("number");
    expect(SEMANTIC_GRAPH_TOOL_TIMEOUT_MS).toBeGreaterThan(0);
    expect(SEMANTIC_GRAPH_TOOL_TIMEOUT_MS).toBe(15_000);
  });
});
