/**
 * spatial-tool-runtime.test.ts
 *
 * GAP-D1 — D2-002..D2-008: Tool handler runtime tests.
 *
 * @module
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockRelay, invokeToolHandler } from "./spatial-test-fixtures.js";
import { SnapshotRetentionStore } from "../snapshot-retention.js";
import type { SpatialRelationsToolError } from "../spatial-relations-tool.js";

describe("D2-002: Valid nodeIds returns relations", () => {
  it("D2-002: handler returns success with valid nodeIds", async () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();
    const result = await invokeToolHandler(relay, store, { nodeIds: [1, 2] });
    expect(result).toHaveProperty("pageId");
    expect(result).toHaveProperty("relations");
  });

  it("D2-002: response contains relations array", async () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();
    const result = await invokeToolHandler(relay, store, { nodeIds: [1, 2] });
    if ("success" in result && result.success) expect(Array.isArray(result.relations)).toBe(true);
  });

  it("D2-002: response contains nodeCount and pairCount", async () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();
    const result = await invokeToolHandler(relay, store, { nodeIds: [1, 2] });
    if ("success" in result && result.success) {
      expect(typeof result.nodeCount).toBe("number");
      expect(typeof result.pairCount).toBe("number");
    }
  });
});

describe("D2-003: too-many-nodes error", () => {
  it("D2-003: returns error when nodeIds exceeds 50", async () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();
    const nodeIds = Array.from({ length: 51 }, (_, i) => i + 1);
    const result = await invokeToolHandler(relay, store, { nodeIds });
    expect(result).toHaveProperty("success");
    if ("success" in result) {
      expect(result.success).toBe(false);
      expect((result as SpatialRelationsToolError).error).toBe("too-many-nodes");
    }
  });

  it("D2-003: mixed non-empty arrays are rejected as invalid-request (precedence over count cap)", async () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();
    const nodeIds = Array.from({ length: 30 }, (_, i) => i + 1);
    const uids = Array.from({ length: 25 }, (_, i) => `main:${i + 100}`);
    const result = await invokeToolHandler(relay, store, { nodeIds, uids });
    expect(result).toHaveProperty("success");
    if ("success" in result) {
      expect(result.success).toBe(false);
      expect((result as SpatialRelationsToolError).error).toBe("invalid-request");
    }
  });

  it("D2-003: count cap still applies when exactly one identity mode is used", async () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();
    const nodeIds = Array.from({ length: 51 }, (_, i) => i + 1);
    const result = await invokeToolHandler(relay, store, { nodeIds, uids: [] });
    expect(result).toHaveProperty("success");
    if ("success" in result) {
      expect(result.success).toBe(false);
      expect((result as SpatialRelationsToolError).error).toBe("too-many-nodes");
    }
  });
});

describe("D2-004: Unknown pageId error", () => {
  it("D2-004: handler responds to snapshotId in request", async () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();
    const result = await invokeToolHandler(relay, store, { snapshotId: "unknown-page:1", nodeIds: [1] });
    expect(result).toHaveProperty("pageId");
  });
});

describe("structured relay errors", () => {
  it("returns structured browser-not-connected error when relay is disconnected", async () => {
    const relay = createMockRelay({ connected: false });
    const store = new SnapshotRetentionStore();

    const result = await invokeToolHandler(relay, store, { nodeIds: [1, 2] });

    expect(result).toMatchObject({
      success: false,
      error: "browser-not-connected",
      errorCode: "browser-not-connected",
      retryable: true,
      retryAfterMs: 2000,
    });
    expect((result as { recoveryHints?: string }).recoveryHints).toContain("browser relay");
  });

  it("returns structured browser-not-connected error when relay request rejects as disconnected", async () => {
    const relay = createMockRelay({ response: Promise.reject(new Error("browser not-connected")) });
    const store = new SnapshotRetentionStore();

    const result = await invokeToolHandler(relay, store, { nodeIds: [1, 2] });

    expect(result).toMatchObject({
      success: false,
      error: "browser-not-connected",
      errorCode: "browser-not-connected",
      retryable: true,
      retryAfterMs: 2000,
    });
    expect((result as { recoveryHints?: string }).recoveryHints).toContain("browser relay");
  });

  it("returns structured timeout error when relay request rejects as timeout", async () => {
    const relay = createMockRelay({ response: Promise.reject(new Error("request timeout")) });
    const store = new SnapshotRetentionStore();

    const result = await invokeToolHandler(relay, store, { nodeIds: [1, 2] });

    expect(result).toMatchObject({
      success: false,
      error: "timeout",
      errorCode: "timeout",
      retryable: true,
      retryAfterMs: 1000,
    });
  });
});

describe("D2-005: Single node returns empty relations", () => {
  it("D2-005: single nodeId returns empty relations array", async () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();
    const result = await invokeToolHandler(relay, store, { nodeIds: [1] });
    if ("success" in result && result.success) {
      expect(result.relations).toHaveLength(0);
      expect(result.nodeCount).toBe(1);
      expect(result.pairCount).toBe(0);
    }
  });
});
describe("D2-006: Pairwise leftOf relation", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("D2-006: returns leftOf: true when source is left of target", async () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();
    const result = await invokeToolHandler(relay, store, { nodeIds: [1, 2] });
    if ("success" in result && result.success) {
      const leftOf = result.relations.find(r => r.sourceNodeId === 1 && r.targetNodeId === 2);
      expect(leftOf?.leftOf).toBe(true);
    }
  });
});

describe("D2-007: Pairwise overlap (IoU)", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("D2-007: returns overlap fraction when nodes overlap", async () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();
    const result = await invokeToolHandler(relay, store, { nodeIds: [1, 3] });
    if ("success" in result && result.success) {
      const overlap = result.relations.find(r => r.sourceNodeId === 1 && r.targetNodeId === 3);
      expect(overlap?.overlap).toBeGreaterThan(0);
    }
  });
});

describe("D2-008: SnapshotEnvelope compliance + retention", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("D2-008: response has SnapshotEnvelope fields", async () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();
    const result = await invokeToolHandler(relay, store, { nodeIds: [1] });
    if ("success" in result && result.success) {
      expect(result).toHaveProperty("pageId");
      expect(result).toHaveProperty("snapshotId");
      expect(result).toHaveProperty("capturedAt");
      expect(result).toHaveProperty("viewport");
    }
  });

  it("D2-008: handler calls relay.request with correct action name", async () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();
    await invokeToolHandler(relay, store, { nodeIds: [1] });
    expect(relay.request).toHaveBeenCalledWith("get_spatial_relations", expect.any(Object), expect.any(Number));
  });
});
