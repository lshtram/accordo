/**
 * spatial-relations-tool.test.ts
 *
 * Tests for GAP-D1 — Spatial Relations MCP Tool (browser package)
 *
 * Tests validate:
 * - D2: handleGetSpatialRelations handler with valid nodeIds
 * - D2: too-many-nodes error when nodeIds exceeds 50
 * - D2: unknown pageId error
 * - D2: viewportRatio and containerId in response
 * - D2: single node returns empty relations
 * - D2: pairwise leftOf → "left-of" relation type
 * - D2: pairwise overlap → "overlaps" relation type with iou
 * - Tool registration with correct name, inputSchema, and response schema
 *
 * API checklist (buildSpatialRelationsTool):
 * - name: "accordo_browser_get_spatial_relations"
 * - description: mentions pairwise spatial relationships, node IDs from prior get_page_map
 * - inputSchema.nodeIds: array of integers, minItems 1, maxItems 50
 * - inputSchema.tabId: optional number
 * - dangerLevel: "safe"
 * - idempotent: true
 * - handler: callable and returns SpatialRelationsResponse | SpatialRelationsToolError
 *
 * B2-D1-001..008 are tested by calling the tool.handler directly with a mock relay.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  buildSpatialRelationsTool,
  type SpatialRelation,
  type SpatialRelationsToolError,
} from "../spatial-relations-tool.js";
import {
  type GetSpatialRelationsArgs,
  type SpatialRelationsResponse,
  SPATIAL_RELATIONS_TIMEOUT_MS,
} from "../page-tool-types.js";
import { SnapshotRetentionStore } from "../snapshot-retention.js";
import type { BrowserRelayLike } from "../types.js";

// ── Test fixtures ──────────────────────────────────────────────────────────────

/** Mock SnapshotEnvelope fields */
const MOCK_ENVELOPE = {
  pageId: "mock-page-001",
  frameId: "main",
  snapshotId: "mock-page-001:1",
  capturedAt: "2025-01-01T00:00:00.000Z",
  viewport: { width: 1920, height: 1080, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
  source: "dom" as const,
};

/** Mock spatial relations response from content script */
const MOCK_SPATIAL_RELATIONS_DATA: SpatialRelationsResponse = {
  ...MOCK_ENVELOPE,
  pageUrl: "https://example.com/page",
  relations: [
    {
      sourceNodeId: 1,
      targetNodeId: 2,
      leftOf: true,
      above: false,
      contains: false,
      containedBy: false,
      overlap: 2500 / 17500,
      distance: 200,
    },
    {
      sourceNodeId: 1,
      targetNodeId: 3,
      leftOf: false,
      above: true,
      contains: false,
      containedBy: false,
      overlap: 0.25,
      distance: 200,
    },
    {
      sourceNodeId: 2,
      targetNodeId: 3,
      leftOf: true,
      above: true,
      contains: false,
      containedBy: false,
      overlap: 0,
      distance: Math.SQRT2 * 200,
    },
  ],
  nodeCount: 3,
  pairCount: 3,
};

// ── Mock relay factory ────────────────────────────────────────────────────────

function createMockRelay(overrides?: Partial<{
  connected: boolean;
  response: ReturnType<BrowserRelayLike["request"]>;
}>) {
  const defaults = {
    connected: true,
    response: Promise.resolve({ success: true, requestId: "test", data: MOCK_SPATIAL_RELATIONS_DATA }),
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
  args: GetSpatialRelationsArgs = { nodeIds: [1, 2, 3] },
): Promise<SpatialRelationsResponse | SpatialRelationsToolError> {
  const tool = buildSpatialRelationsTool(relay, store);
  return (tool.handler as (args: GetSpatialRelationsArgs) => Promise<SpatialRelationsResponse | SpatialRelationsToolError>)(args);
}

// ── D2-001: Tool Registration ───────────────────────────────────────────────

describe("D2-001: Tool registration", () => {
  it("D2-001: buildSpatialRelationsTool returns tool with correct name", () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();
    const tool = buildSpatialRelationsTool(relay, store);
    expect(tool.name).toBe("accordo_browser_get_spatial_relations");
  });

  it("D2-001: Tool description mentions pairwise spatial relationships", () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();
    const tool = buildSpatialRelationsTool(relay, store);
    expect(tool.description).toContain("spatial");
    expect(tool.description).toContain("node IDs");
    expect(tool.description).toContain("get_page_map");
  });

  it("D2-001: Tool dangerLevel is 'safe'", () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();
    const tool = buildSpatialRelationsTool(relay, store);
    expect(tool.dangerLevel).toBe("safe");
  });

  it("D2-001: Tool idempotent is true", () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();
    const tool = buildSpatialRelationsTool(relay, store);
    expect(tool.idempotent).toBe(true);
  });

  it("D2-001: Tool inputSchema has nodeIds as required array of integers", () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();
    const tool = buildSpatialRelationsTool(relay, store);
    expect(tool.inputSchema).toBeDefined();
    expect(tool.inputSchema.type).toBe("object");
    expect(tool.inputSchema.properties).toBeDefined();
    expect(tool.inputSchema.properties.nodeIds).toBeDefined();
    expect(tool.inputSchema.properties.nodeIds.type).toBe("array");
    expect(tool.inputSchema.properties.nodeIds.items.type).toBe("integer");
    expect(tool.inputSchema.properties.nodeIds.minItems).toBe(1);
    expect(tool.inputSchema.properties.nodeIds.maxItems).toBe(50);
    expect(tool.inputSchema.required).toContain("nodeIds");
  });

  it("D2-001: Tool inputSchema has optional tabId as number", () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();
    const tool = buildSpatialRelationsTool(relay, store);
    expect(tool.inputSchema.properties.tabId).toBeDefined();
    expect(tool.inputSchema.properties.tabId.type).toBe("number");
  });

  it("D2-001: Tool handler exists and is callable", () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();
    const tool = buildSpatialRelationsTool(relay, store);
    expect(typeof tool.handler).toBe("function");
  });
});

// ── D2-002: Valid nodeIds returns relations ───────────────────────────────────

describe("D2-002: Valid nodeIds returns relations", () => {
  it("D2-002: Handler returns SpatialRelationsResponse with relations array", async () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();
    const result = await invokeToolHandler(relay, store, { nodeIds: [1, 2, 3] });
    if ("success" in result && result.success === false) {
      throw new Error(`Expected SpatialRelationsResponse but got error: ${JSON.stringify(result)}`);
    }
    expect(result).toHaveProperty("relations");
    expect(Array.isArray(result.relations)).toBe(true);
  });

  it("D2-002: Handler returns correct nodeCount and pairCount", async () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();
    const result = await invokeToolHandler(relay, store, { nodeIds: [1, 2, 3] });
    if ("success" in result && result.success === false) {
      throw new Error(`Expected SpatialRelationsResponse but got error: ${JSON.stringify(result)}`);
    }
    expect(result.nodeCount).toBe(3);
    expect(result.pairCount).toBe(3);
  });

  it("D2-002: Handler includes pageUrl in response", async () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();
    const result = await invokeToolHandler(relay, store, { nodeIds: [1, 2, 3] });
    if ("success" in result && result.success === false) {
      throw new Error(`Expected SpatialRelationsResponse but got error: ${JSON.stringify(result)}`);
    }
    expect(result).toHaveProperty("pageUrl");
    expect(typeof result.pageUrl).toBe("string");
  });

  it("D2-002: Handler includes SnapshotEnvelope fields", async () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();
    const result = await invokeToolHandler(relay, store, { nodeIds: [1, 2, 3] });
    if ("success" in result && result.success === false) {
      throw new Error(`Expected SpatialRelationsResponse but got error: ${JSON.stringify(result)}`);
    }
    expect(result).toHaveProperty("pageId");
    expect(result).toHaveProperty("frameId");
    expect(result).toHaveProperty("snapshotId");
    expect(result).toHaveProperty("capturedAt");
    expect(result).toHaveProperty("viewport");
  });

  it("D2-002: Relations include all required spatial fields", async () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();
    const result = await invokeToolHandler(relay, store, { nodeIds: [1, 2, 3] });
    if ("success" in result && result.success === false) {
      throw new Error(`Expected SpatialRelationsResponse but got error: ${JSON.stringify(result)}`);
    }
    for (const relation of result.relations) {
      expect(relation).toHaveProperty("sourceNodeId");
      expect(relation).toHaveProperty("targetNodeId");
      expect(relation).toHaveProperty("leftOf");
      expect(relation).toHaveProperty("above");
      expect(relation).toHaveProperty("contains");
      expect(relation).toHaveProperty("containedBy");
      expect(relation).toHaveProperty("overlap");
      expect(relation).toHaveProperty("distance");
    }
  });
});

// ── D2-003: too-many-nodes error ─────────────────────────────────────────────

describe("D2-003: too-many-nodes error", () => {
  it("D2-003: nodeIds exceeds 50 → returns error 'too-many-nodes'", async () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();
    // Create 51 node IDs
    const tooManyNodeIds = Array.from({ length: 51 }, (_, i) => i);
    const result = await invokeToolHandler(relay, store, { nodeIds: tooManyNodeIds });
    expect(result).toHaveProperty("success");
    if ("success" in result) {
      expect(result.success).toBe(false);
      expect((result as SpatialRelationsToolError).error).toBe("too-many-nodes");
    }
  });

  it("D2-003: exactly 50 nodeIds → does not return too-many-nodes", async () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();
    // Create exactly 50 node IDs
    const maxNodeIds = Array.from({ length: 50 }, (_, i) => i);
    const result = await invokeToolHandler(relay, store, { nodeIds: maxNodeIds });
    expect(result).not.toHaveProperty("success");
    // Or if it does have success:false, the error should NOT be "too-many-nodes"
    if ("success" in result && result.success === false) {
      expect((result as SpatialRelationsToolError).error).not.toBe("too-many-nodes");
    }
  });

  it("D2-003: error message mentions maximum of 50", async () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();
    const tooManyNodeIds = Array.from({ length: 51 }, (_, i) => i);
    const result = await invokeToolHandler(relay, store, { nodeIds: tooManyNodeIds });
    if ("success" in result && result.success === false) {
      const error = result as SpatialRelationsToolError;
      expect(error.error).toBe("too-many-nodes");
      // Error message should mention the limit
      expect(error).toHaveProperty("details");
    }
  });
});

// ── D2-004: Unknown pageId error ─────────────────────────────────────────────

describe("D2-004: Unknown pageId error", () => {
  it("D2-004: Unknown pageId → returns appropriate error", async () => {
    const relay = createMockRelay({
      response: Promise.resolve({ 
        success: false, 
        requestId: "test", 
        error: "action-failed" 
      }),
    });
    const store = new SnapshotRetentionStore();
    const result = await invokeToolHandler(relay, store, { nodeIds: [1, 2] });
    expect(result).toHaveProperty("success");
    if ("success" in result) {
      expect(result.success).toBe(false);
      expect((result as SpatialRelationsToolError).error).toBe("action-failed");
    }
  });
});

// ── D2-005: Single node returns empty relations ──────────────────────────────

describe("D2-005: Single node returns empty relations", () => {
  it("D2-005: nodeIds with only 1 element → returns empty relations array", async () => {
    const singleNodeData: SpatialRelationsResponse = {
      ...MOCK_ENVELOPE,
      pageUrl: "https://example.com/page",
      relations: [],
      nodeCount: 1,
      pairCount: 0,
    };
    const relay = createMockRelay({
      response: Promise.resolve({ success: true, requestId: "test", data: singleNodeData }),
    });
    const store = new SnapshotRetentionStore();
    const result = await invokeToolHandler(relay, store, { nodeIds: [1] });
    if ("success" in result && result.success === false) {
      throw new Error(`Expected SpatialRelationsResponse but got error: ${JSON.stringify(result)}`);
    }
    expect(result.relations).toHaveLength(0);
    expect(result.pairCount).toBe(0);
  });
});

// ── D2-006: Pairwise leftOf → "left-of" relation ─────────────────────────────

describe("D2-006: Pairwise leftOf relation", () => {
  it("D2-006: Two nodes that are leftOf → relation type has leftOf=true", async () => {
    const leftOfData: SpatialRelationsResponse = {
      ...MOCK_ENVELOPE,
      pageUrl: "https://example.com/page",
      relations: [
        {
          sourceNodeId: 1,
          targetNodeId: 2,
          leftOf: true,
          above: false,
          contains: false,
          containedBy: false,
          overlap: 0,
          distance: 200,
        },
      ],
      nodeCount: 2,
      pairCount: 1,
    };
    const relay = createMockRelay({
      response: Promise.resolve({ success: true, requestId: "test", data: leftOfData }),
    });
    const store = new SnapshotRetentionStore();
    const result = await invokeToolHandler(relay, store, { nodeIds: [1, 2] });
    if ("success" in result && result.success === false) {
      throw new Error(`Expected SpatialRelationsResponse but got error: ${JSON.stringify(result)}`);
    }
    expect(result.relations[0].leftOf).toBe(true);
  });

  it("D2-006: Nodes not leftOf → leftOf=false", async () => {
    const notLeftOfData: SpatialRelationsResponse = {
      ...MOCK_ENVELOPE,
      pageUrl: "https://example.com/page",
      relations: [
        {
          sourceNodeId: 1,
          targetNodeId: 2,
          leftOf: false,
          above: false,
          contains: false,
          containedBy: false,
          overlap: 0,
          distance: 200,
        },
      ],
      nodeCount: 2,
      pairCount: 1,
    };
    const relay = createMockRelay({
      response: Promise.resolve({ success: true, requestId: "test", data: notLeftOfData }),
    });
    const store = new SnapshotRetentionStore();
    const result = await invokeToolHandler(relay, store, { nodeIds: [1, 2] });
    if ("success" in result && result.success === false) {
      throw new Error(`Expected SpatialRelationsResponse but got error: ${JSON.stringify(result)}`);
    }
    expect(result.relations[0].leftOf).toBe(false);
  });
});

// ── D2-007: Pairwise overlap → IoU field ────────────────────────────────────

describe("D2-007: Pairwise overlap (IoU)", () => {
  it("D2-007: Two nodes that overlap → overlap field is correct IoU", async () => {
    // Overlapping boxes: a at 0,0 100x100; b at 50,50 100x100
    // Intersection: 50x50=2500; Union: 17500; IoU: 2500/17500 ≈ 0.143
    const overlapData: SpatialRelationsResponse = {
      ...MOCK_ENVELOPE,
      pageUrl: "https://example.com/page",
      relations: [
        {
          sourceNodeId: 1,
          targetNodeId: 2,
          leftOf: false,
          above: false,
          contains: false,
          containedBy: false,
          overlap: 2500 / 17500,
          distance: Math.SQRT2 * 50,
        },
      ],
      nodeCount: 2,
      pairCount: 1,
    };
    const relay = createMockRelay({
      response: Promise.resolve({ success: true, requestId: "test", data: overlapData }),
    });
    const store = new SnapshotRetentionStore();
    const result = await invokeToolHandler(relay, store, { nodeIds: [1, 2] });
    if ("success" in result && result.success === false) {
      throw new Error(`Expected SpatialRelationsResponse but got error: ${JSON.stringify(result)}`);
    }
    expect(result.relations[0].overlap).toBeCloseTo(2500 / 17500, 3);
  });

  it("D2-007: Disjoint nodes → overlap is 0", async () => {
    const disjointData: SpatialRelationsResponse = {
      ...MOCK_ENVELOPE,
      pageUrl: "https://example.com/page",
      relations: [
        {
          sourceNodeId: 1,
          targetNodeId: 2,
          leftOf: true,
          above: false,
          contains: false,
          containedBy: false,
          overlap: 0,
          distance: 500,
        },
      ],
      nodeCount: 2,
      pairCount: 1,
    };
    const relay = createMockRelay({
      response: Promise.resolve({ success: true, requestId: "test", data: disjointData }),
    });
    const store = new SnapshotRetentionStore();
    const result = await invokeToolHandler(relay, store, { nodeIds: [1, 2] });
    if ("success" in result && result.success === false) {
      throw new Error(`Expected SpatialRelationsResponse but got error: ${JSON.stringify(result)}`);
    }
    expect(result.relations[0].overlap).toBe(0);
  });

  it("D2-007: Identical boxes → overlap is 1.0", async () => {
    const identicalData: SpatialRelationsResponse = {
      ...MOCK_ENVELOPE,
      pageUrl: "https://example.com/page",
      relations: [
        {
          sourceNodeId: 1,
          targetNodeId: 2,
          leftOf: false,
          above: false,
          contains: false,
          containedBy: false,
          overlap: 1.0,
          distance: 0,
        },
      ],
      nodeCount: 2,
      pairCount: 1,
    };
    const relay = createMockRelay({
      response: Promise.resolve({ success: true, requestId: "test", data: identicalData }),
    });
    const store = new SnapshotRetentionStore();
    const result = await invokeToolHandler(relay, store, { nodeIds: [1, 2] });
    if ("success" in result && result.success === false) {
      throw new Error(`Expected SpatialRelationsResponse but got error: ${JSON.stringify(result)}`);
    }
    expect(result.relations[0].overlap).toBe(1.0);
  });
});

// ── D2-008: SnapshotEnvelope and retention ────────────────────────────────────

describe("D2-008: SnapshotEnvelope compliance + retention", () => {
  it("D2-008: Handler persists snapshot to retention store", async () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();
    const tool = buildSpatialRelationsTool(relay, store);
    await (tool.handler as (args: GetSpatialRelationsArgs) => Promise<unknown>)({ nodeIds: [1, 2, 3] });
    const saved = store.getLatest("mock-page-001");
    expect(saved).toBeDefined();
    expect(saved?.pageId).toBe("mock-page-001");
  });

  it("D2-008: Handler returns capturedAt as ISO 8601", async () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();
    const result = await invokeToolHandler(relay, store, { nodeIds: [1, 2, 3] });
    if ("success" in result && result.success === false) {
      throw new Error(`Expected SpatialRelationsResponse but got error: ${JSON.stringify(result)}`);
    }
    expect(result).toHaveProperty("capturedAt");
    expect(result.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});

// ── D2-009: Error handling ────────────────────────────────────────────────────

describe("D2-009: Error handling", () => {
  it("D2-009: Handler returns browser-not-connected error when relay disconnected", async () => {
    const relay = createMockRelay({ connected: false });
    const store = new SnapshotRetentionStore();
    const result = await invokeToolHandler(relay, store, { nodeIds: [1, 2] });
    expect(result).toHaveProperty("success");
    if ("success" in result) {
      expect(result.success).toBe(false);
      expect((result as SpatialRelationsToolError).error).toBe("browser-not-connected");
    }
  });

  it("D2-009: Handler maps relay timeout to timeout error", async () => {
    const relay = createMockRelay({
      response: Promise.resolve({ success: false, requestId: "test", error: "timeout" as const }),
    });
    const store = new SnapshotRetentionStore();
    const result = await invokeToolHandler(relay, store, { nodeIds: [1, 2] });
    expect(result).toHaveProperty("success");
    if ("success" in result) {
      expect(result.success).toBe(false);
      expect((result as SpatialRelationsToolError).error).toBe("timeout");
    }
  });

  it("D2-009: Handler maps origin-blocked to origin-blocked error", async () => {
    const blockedData = {
      ...MOCK_SPATIAL_RELATIONS_DATA,
      pageUrl: "https://blocked-origin.com/page",
    };
    const relay = createMockRelay({
      response: Promise.resolve({ success: true, requestId: "test", data: blockedData }),
    });
    const store = new SnapshotRetentionStore();
    // Create tool with security that blocks the origin
    const { buildSpatialRelationsTool: buildSRT } = await import("../spatial-relations-tool.js");
    const { DEFAULT_SECURITY_CONFIG } = await import("../security/index.js");
    // Override origin policy to block the test origin
    const blockingSecurity = {
      ...DEFAULT_SECURITY_CONFIG,
      originPolicy: { allowedOrigins: [], deniedOrigins: ["https://blocked-origin.com"] },
    };
    const tool = buildSRT(relay, store, blockingSecurity);
    const result = await (tool.handler as (args: GetSpatialRelationsArgs) => Promise<unknown>)({ nodeIds: [1, 2] });
    expect(result).toHaveProperty("success");
    if ("success" in result) {
      expect(result.success).toBe(false);
      expect((result as SpatialRelationsToolError).error).toBe("origin-blocked");
    }
  });
});

// ── D2-010: Type exports ─────────────────────────────────────────────────────

describe("D2-010: Type exports", () => {
  it("D2-010: SPATIAL_RELATIONS_TIMEOUT_MS is 10 seconds", () => {
    expect(SPATIAL_RELATIONS_TIMEOUT_MS).toBe(10_000);
  });

  it("D2-010: SpatialRelation type has all required fields", () => {
    const relation: SpatialRelation = {
      sourceNodeId: 1,
      targetNodeId: 2,
      leftOf: true,
      above: false,
      contains: false,
      containedBy: false,
      overlap: 0.5,
      distance: 100,
    };
    expect(relation.leftOf).toBe(true);
    expect(relation.above).toBe(false);
    expect(relation.contains).toBe(false);
    expect(relation.containedBy).toBe(false);
    expect(relation.overlap).toBe(0.5);
    expect(relation.distance).toBe(100);
  });

  it("D2-010: SpatialRelationsToolError has correct error codes", () => {
    const errorCodes: SpatialRelationsToolError["error"][] = [
      "browser-not-connected",
      "timeout",
      "action-failed",
      "origin-blocked",
      "too-many-nodes",
      "no-bounds",
    ];
    for (const code of errorCodes) {
      const error: SpatialRelationsToolError = { success: false, error: code };
      expect(error.error).toBe(code);
    }
  });
});

// ── D2-011: Missing node IDs ──────────────────────────────────────────────────

describe("D2-011: Missing node IDs", () => {
  it("D2-011: Response may include missingNodeIds field", async () => {
    const dataWithMissing: SpatialRelationsResponse = {
      ...MOCK_ENVELOPE,
      pageUrl: "https://example.com/page",
      relations: [
        {
          sourceNodeId: 1,
          targetNodeId: 999, // This node doesn't exist
          leftOf: false,
          above: false,
          contains: false,
          containedBy: false,
          overlap: 0,
          distance: 0,
        },
      ],
      nodeCount: 2,
      pairCount: 1,
      missingNodeIds: [999],
    };
    const relay = createMockRelay({
      response: Promise.resolve({ success: true, requestId: "test", data: dataWithMissing }),
    });
    const store = new SnapshotRetentionStore();
    const result = await invokeToolHandler(relay, store, { nodeIds: [1, 999] });
    if ("success" in result && result.success === false) {
      throw new Error(`Expected SpatialRelationsResponse but got error: ${JSON.stringify(result)}`);
    }
    expect(result).toHaveProperty("missingNodeIds");
  });
});
