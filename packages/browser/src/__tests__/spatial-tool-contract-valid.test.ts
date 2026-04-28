/**
 * spatial-tool-contract-valid.test.ts
 *
 * GAP-D1 item 5 — Contract success + description/schema guidance tests.
 * Tests: empty array acceptance, registration description guidance.
 *
 * @module
 */

import { describe, it, expect, beforeEach } from "vitest";
import { buildSpatialRelationsTool } from "../spatial-relations-tool.js";
import { SnapshotRetentionStore } from "../snapshot-retention.js";
import { createMockRelay } from "./spatial-test-fixtures.js";

beforeEach(() => { vi.clearAllMocks(); });

describe("GAP-D1-05: Empty array acceptance (adapter-emitted field)", () => {
  const relay = createMockRelay();
  const store = new SnapshotRetentionStore();
  const tool = buildSpatialRelationsTool(relay, store);

  async function call(args: Record<string, unknown>) {
    return (tool.handler as (a: Record<string, unknown>) => Promise<unknown>)(args);
  }

  it("GAP-D1-05: valid nodeIds + uids:[] returns success", async () => {
    const result = await call({ snapshotId: "page:1", nodeIds: [1, 2], uids: [] });
    expect(result).toHaveProperty("pageId");
    expect(result).toHaveProperty("relations");
    expect(relay.request).toHaveBeenCalled();
  });

  it("GAP-D1-05: valid uids + nodeIds:[] returns success", async () => {
    const result = await call({ snapshotId: "page:1", nodeIds: [], uids: ["main:1", "main:2"] });
    expect(result).toHaveProperty("pageId");
    expect(result).toHaveProperty("relations");
    expect(relay.request).toHaveBeenCalled();
  });
});

describe("GAP-D1-05: Registration — exact-one guidance", () => {
  it("GAP-D1-05: tool description mentions mutual exclusivity", () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();
    const tool = buildSpatialRelationsTool(relay, store);
    expect(tool.description).toContain("exactly one");
    expect(tool.description).toContain("nodeIds");
    expect(tool.description).toContain("uids");
  });

  it("GAP-D1-05: tool description mentions empty array adapter hint", () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();
    const tool = buildSpatialRelationsTool(relay, store);
    expect(tool.description).toContain("[]");
    expect(tool.description).toContain("adapter");
  });

  it("GAP-D1-05: schema nodeIds description mentions exact-one guidance", () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();
    const tool = buildSpatialRelationsTool(relay, store);
    const nodeIdsSchema = tool.inputSchema.properties?.nodeIds;
    expect(nodeIdsSchema?.description).toContain("exactly one");
  });

  it("GAP-D1-05: schema uids description mentions exact-one guidance", () => {
    const relay = createMockRelay();
    const store = new SnapshotRetentionStore();
    const tool = buildSpatialRelationsTool(relay, store);
    const uidsSchema = tool.inputSchema.properties?.uids;
    expect(uidsSchema?.description).toContain("exactly one");
  });
});
