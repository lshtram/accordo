/**
 * spatial-tool-registration.test.ts
 *
 * GAP-D1 — D2-001: Tool registration + D2-010: Type exports tests.
 * Split from spatial-relations-tool.test.ts (<=150 lines).
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import { buildSpatialRelationsTool } from "../spatial-relations-tool.js";
import { SnapshotRetentionStore } from "../snapshot-retention.js";
import { createMockRelay } from "./spatial-test-fixtures.js";

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

  it("D2-001: Tool description mentions snapshotId", () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();
    const tool = buildSpatialRelationsTool(relay, store);
    expect(tool.description).toContain("snapshotId");
  });

  it("D2-001: Tool description mentions pairwise relationships", () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();
    const tool = buildSpatialRelationsTool(relay, store);
    expect(tool.description).toContain("pairwise");
  });

  it("D2-001: inputSchema defines nodeIds as array of integers", () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();
    const tool = buildSpatialRelationsTool(relay, store);
    const nodeIdsSchema = tool.inputSchema.properties?.nodeIds;
    expect(nodeIdsSchema).toBeDefined();
    expect(nodeIdsSchema.type).toBe("array");
    expect(nodeIdsSchema.items.type).toBe("integer");
    expect(nodeIdsSchema.minItems).toBe(1);
    expect(nodeIdsSchema.maxItems).toBe(50);
  });

  it("D2-001: inputSchema defines uids as array of strings", () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();
    const tool = buildSpatialRelationsTool(relay, store);
    const uidsSchema = tool.inputSchema.properties?.uids;
    expect(uidsSchema).toBeDefined();
    expect(uidsSchema.type).toBe("array");
    expect(uidsSchema.items.type).toBe("string");
    expect(uidsSchema.minItems).toBe(1);
    expect(uidsSchema.maxItems).toBe(50);
  });

  it("D2-001: inputSchema defines optional tabId", () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();
    const tool = buildSpatialRelationsTool(relay, store);
    const tabIdSchema = tool.inputSchema.properties?.tabId;
    expect(tabIdSchema).toBeDefined();
    expect(tabIdSchema.type).toBe("number");
  });

  it("D2-001: inputSchema defines required snapshotId", () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();
    const tool = buildSpatialRelationsTool(relay, store);
    expect(tool.inputSchema.required ?? []).toContain("snapshotId");
  });

  it("D2-001: dangerLevel is safe", () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();
    const tool = buildSpatialRelationsTool(relay, store);
    expect(tool.dangerLevel).toBe("safe");
  });

  it("D2-001: idempotent is true", () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();
    const tool = buildSpatialRelationsTool(relay, store);
    expect(tool.idempotent).toBe(true);
  });

  it("D2-001: handler is a function", () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();
    const tool = buildSpatialRelationsTool(relay, store);
    expect(typeof tool.handler).toBe("function");
  });
});

describe("D2-010: Type exports", () => {
  it("D2-010: SpatialRelationsToolError is a TypeScript interface", async () => {
    // SpatialRelationsToolError is a TypeScript interface — verify the type import succeeds
    await expect(import("../spatial-relations-tool.js")).resolves.toBeDefined();
  });

  it("D2-010: SpatialRelationsResponse has required fields", async () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();
    const result = await import("./spatial-test-fixtures.js").then(m => m.invokeToolHandler(relay, store, { nodeIds: [1] }));
    expect(result).toHaveProperty("pageUrl");
    expect(result).toHaveProperty("relations");
    expect(result).toHaveProperty("nodeCount");
    expect(result).toHaveProperty("pairCount");
  });
});
