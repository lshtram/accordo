/**
 * snapshot-retention-page-map.test.ts
 *
 * Tests that handleGetPageMap persists SnapshotEnvelopeFields into
 * SnapshotRetentionStore on success, and does NOT persist on failure.
 */

import { describe, it, expect, vi } from "vitest";
import { SnapshotRetentionStore } from "../snapshot-retention.js";
import { handleGetPageMap } from "../page-understanding-tools.js";
import type { SnapshotEnvelopeFields } from "../types.js";

function makeEnvelope(pageId: string, version: number): SnapshotEnvelopeFields {
  return {
    pageId,
    frameId: "main",
    snapshotId: `${pageId}:${version}`,
    capturedAt: `2025-01-01T00:00:0${version}.000Z`,
    viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
    source: "dom" as const,
  };
}

function successRelay(data: Record<string, unknown> = {}) {
  return {
    request: vi.fn().mockResolvedValue({
      requestId: "r1", success: true,
      data: { ...makeEnvelope("page-001", 1), pageUrl: "https://example.com", title: "Test", nodes: [], totalElements: 0, truncated: false, ...data },
    }),
    isConnected: () => true,
  };
}

describe("B2-SV-004: handleGetPageMap persists envelope into store", () => {
  it("saves envelope to store on success", async () => {
    const store = new SnapshotRetentionStore();
    await handleGetPageMap(successRelay(), {}, store);
    expect(store.getLatest("page-001")).toBeDefined();
    expect(store.getLatest("page-001")?.pageId).toBe("page-001");
  });

  it("does NOT save to store on relay failure (success=false)", async () => {
    const store = new SnapshotRetentionStore();
    const relay = { request: vi.fn().mockResolvedValue({ requestId: "r1", success: false, data: {} }), isConnected: () => true };
    await handleGetPageMap(relay, {}, store);
    expect(store.list("page-001")).toHaveLength(0);
  });

  it("does NOT save to store when browser is not connected", async () => {
    const store = new SnapshotRetentionStore();
    const relay = { request: vi.fn(), isConnected: () => false };
    await handleGetPageMap(relay, {}, store);
    expect(store.list("page-001")).toHaveLength(0);
  });

  it("does NOT save to store on relay exception", async () => {
    const store = new SnapshotRetentionStore();
    const relay = { request: vi.fn().mockRejectedValue(new Error("timeout")), isConnected: () => true };
    await handleGetPageMap(relay, {}, store);
    expect(store.list("page-001")).toHaveLength(0);
  });
});