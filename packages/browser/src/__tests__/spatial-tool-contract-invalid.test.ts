/**
 * spatial-tool-contract-invalid.test.ts
 *
 * GAP-D1 item 5 — Contract invalid-request tests for browser_get_spatial_relations.
 *
 * @module
 */

import { describe, it, expect, beforeEach } from "vitest";
import { buildSpatialRelationsTool } from "../spatial-relations-tool.js";
import { narrowSpatialArgs } from "../spatial-relations-contract.js";
import { SnapshotRetentionStore } from "../snapshot-retention.js";
import { createMockRelay } from "./spatial-test-fixtures.js";

beforeEach(() => { vi.clearAllMocks(); });

describe("GAP-D1-05: snapshotId validation", () => {
  const relay = createMockRelay();
  const tool = buildSpatialRelationsTool(relay, new SnapshotRetentionStore());
  const call = (args: Record<string, unknown>) => tool.handler(args) as Promise<unknown>;

  it("GAP-D1-05: missing snapshotId returns invalid-request", async () => {
    const result = await call({ nodeIds: [1, 2] });
    expect(result).toHaveProperty("success", false);
    expect((result as { success: false; error: string }).error).toBe("invalid-request");
    expect(relay.request).not.toHaveBeenCalled();
  });

  it("GAP-D1-05: non-string/empty/whitespace snapshotId returns invalid-request", async () => {
    const r1 = await call({ snapshotId: 123, nodeIds: [1] });
    expect((r1 as { success: false; error: string }).error).toBe("invalid-request");
    const r2 = await call({ snapshotId: "", nodeIds: [1] });
    expect((r2 as { success: false; error: string }).error).toBe("invalid-request");
    const r3 = await call({ snapshotId: "   ", nodeIds: [1] });
    expect((r3 as { success: false; error: string }).error).toBe("invalid-request");
    expect(relay.request).not.toHaveBeenCalled();
  });

  it("GAP-D1-05: shared narrower rejects empty snapshotId and non-array fields", () => {
    expect(narrowSpatialArgs({ snapshotId: "", nodeIds: [1] })).toBeNull();
    expect(narrowSpatialArgs({ snapshotId: "   ", nodeIds: [1] })).toBeNull();
    expect(narrowSpatialArgs({ snapshotId: "page:1", nodeIds: "bad", uids: ["main:1"] })).toBeNull();
    expect(narrowSpatialArgs({ snapshotId: "page:1", nodeIds: [1], uids: 123 })).toBeNull();
  });
});

describe("GAP-D1-05: non-array nodeIds/uids fields", () => {
  const relay = createMockRelay();
  const tool = buildSpatialRelationsTool(relay, new SnapshotRetentionStore());
  const call = (args: Record<string, unknown>) => tool.handler(args) as Promise<unknown>;

  it("GAP-D1-05: non-array nodeIds returns invalid-request", async () => {
    const result = await call({ snapshotId: "page:1", nodeIds: "bad" as unknown, uids: ["main:1"] });
    expect(result).toHaveProperty("success", false);
    expect((result as { success: false; error: string }).error).toBe("invalid-request");
    expect(relay.request).not.toHaveBeenCalled();
  });

  it("GAP-D1-05: non-array uids returns invalid-request", async () => {
    const result = await call({ snapshotId: "page:1", nodeIds: [1], uids: 123 as unknown });
    expect(result).toHaveProperty("success", false);
    expect((result as { success: false; error: string }).error).toBe("invalid-request");
    expect(relay.request).not.toHaveBeenCalled();
  });
});

describe("GAP-D1-05: nodeIds entry validation", () => {
  const relay = createMockRelay();
  const tool = buildSpatialRelationsTool(relay, new SnapshotRetentionStore());
  const call = (args: Record<string, unknown>) => tool.handler(args) as Promise<unknown>;

  it("GAP-D1-05: malformed nodeId entries return invalid-request", async () => {
    const r1 = await call({ snapshotId: "page:1", nodeIds: [-1, 2] });
    expect((r1 as { success: false; error: string }).error).toBe("invalid-request");
    const r2 = await call({ snapshotId: "page:1", nodeIds: [1.5, 2] });
    expect((r2 as { success: false; error: string }).error).toBe("invalid-request");
    const r3 = await call({ snapshotId: "page:1", nodeIds: [Infinity, 2] });
    expect((r3 as { success: false; error: string }).error).toBe("invalid-request");
    const r4 = await call({ snapshotId: "page:1", nodeIds: ["1" as unknown, 2] });
    expect((r4 as { success: false; error: string }).error).toBe("invalid-request");
    expect(relay.request).not.toHaveBeenCalled();
  });

  it("GAP-D1-05: error details mention malformed nodeIds", async () => {
    const result = await call({ snapshotId: "page:1", nodeIds: [-1] }) as { success: false; details?: string };
    expect(result.success).toBe(false);
    expect(result.details).toContain("nodeIds entries must be non-negative integers");
  });
});

describe("GAP-D1-05: uids entry validation", () => {
  const relay = createMockRelay();
  const tool = buildSpatialRelationsTool(relay, new SnapshotRetentionStore());
  const call = (args: Record<string, unknown>) => tool.handler(args) as Promise<unknown>;

  it("GAP-D1-05: malformed uid entries return invalid-request", async () => {
    const r1 = await call({ snapshotId: "page:1", uids: [1 as unknown, "main:2"] });
    expect((r1 as { success: false; error: string }).error).toBe("invalid-request");
    const r2 = await call({ snapshotId: "page:1", uids: ["", "main:2"] });
    expect((r2 as { success: false; error: string }).error).toBe("invalid-request");
    const r3 = await call({ snapshotId: "page:1", uids: ["   ", "main:2"] });
    expect((r3 as { success: false; error: string }).error).toBe("invalid-request");
    expect(relay.request).not.toHaveBeenCalled();
  });

  it("GAP-D1-05: error details mention malformed uids", async () => {
    const result = await call({ snapshotId: "page:1", uids: [""] }) as { success: false; details?: string };
    expect(result.success).toBe(false);
    expect(result.details).toContain("uids entries must be non-empty strings");
  });
});

describe("GAP-D1-05: mutual exclusivity rejection", () => {
  const relay = createMockRelay();
  const tool = buildSpatialRelationsTool(relay, new SnapshotRetentionStore());
  const call = (args: Record<string, unknown>) => tool.handler(args) as Promise<unknown>;

  it("GAP-D1-05: both non-empty nodeIds and uids returns invalid-request", async () => {
    const result = await call({ snapshotId: "page:1", nodeIds: [1, 2], uids: ["main:3"] });
    expect(result).toHaveProperty("success", false);
    expect((result as { success: false; error: string }).error).toBe("invalid-request");
    expect(relay.request).not.toHaveBeenCalled();
  });

  it("GAP-D1-05: neither nodeIds nor uids returns invalid-request", async () => {
    const result = await call({ snapshotId: "page:1" });
    expect(result).toHaveProperty("success", false);
    expect((result as { success: false; error: string }).error).toBe("invalid-request");
    expect(relay.request).not.toHaveBeenCalled();
  });

  it("GAP-D1-05: error includes exact-one detail and recovery hint", async () => {
    const result = await call({ snapshotId: "page:1", nodeIds: [1], uids: ["main:2"] }) as { success: false; details?: string; recoveryHints?: string };
    expect(result.success).toBe(false);
    expect(result.details).toContain("exactly one identity mode");
    expect(result.details).toContain("nodeIds");
    expect(result.details).toContain("uids");
    expect(result.recoveryHints).toContain("[]");
    expect(result.recoveryHints).toContain("adapter");
  });
});
