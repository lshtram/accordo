/**
 * snapshot-retention-inspect.test.ts
 *
 * Tests that handleInspectElement persists SnapshotEnvelopeFields into
 * SnapshotRetentionStore on success, and does NOT persist on failure.
 */

import { describe, it, expect, vi } from "vitest";
import { SnapshotRetentionStore } from "../snapshot-retention.js";
import { handleInspectElement } from "../page-understanding-tools.js";
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

function successRelay(pageId: string, version: number) {
  return {
    request: vi.fn().mockResolvedValue({
      requestId: "r1", success: true,
      data: { ...makeEnvelope(pageId, version), found: true, anchorKey: "id:main", anchorStrategy: "id", anchorConfidence: "high" },
    }),
    isConnected: () => true,
  };
}

describe("B2-SV-004: handleInspectElement persists envelope into store", () => {
  it("saves envelope to store on success", async () => {
    const store = new SnapshotRetentionStore();
    await handleInspectElement(successRelay("page-002", 1), { selector: "#main" }, store);
    expect(store.getLatest("page-002")?.pageId).toBe("page-002");
  });

  it("does NOT save to store on relay failure", async () => {
    const store = new SnapshotRetentionStore();
    const relay = { request: vi.fn().mockResolvedValue({ requestId: "r1", success: false, data: {} }), isConnected: () => true };
    await handleInspectElement(relay, { selector: "#main" }, store);
    expect(store.list("page-002")).toHaveLength(0);
  });

  it("does NOT save to store when browser is not connected", async () => {
    const store = new SnapshotRetentionStore();
    const relay = { request: vi.fn(), isConnected: () => false };
    await handleInspectElement(relay, { selector: "#main" }, store);
    expect(store.list("page-002")).toHaveLength(0);
  });
});