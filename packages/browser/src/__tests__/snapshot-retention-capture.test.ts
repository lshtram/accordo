/**
 * snapshot-retention-capture.test.ts
 *
 * Tests that handleCaptureRegion persists SnapshotEnvelopeFields into
 * SnapshotRetentionStore on success, and does NOT persist on failure.
 */

import { describe, it, expect, vi } from "vitest";
import { SnapshotRetentionStore } from "../snapshot-retention.js";
import { handleCaptureRegion } from "../page-understanding-tools.js";
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
      data: { ...makeEnvelope(pageId, version), source: "visual" as const, success: true, dataUrl: "data:image/jpeg;base64,/9j/4A==", width: 200, height: 150, sizeBytes: 4096 },
    }),
    isConnected: () => true,
  };
}

describe("B2-SV-004: handleCaptureRegion persists envelope into store", () => {
  it("saves envelope to store on success", async () => {
    const store = new SnapshotRetentionStore();
    await handleCaptureRegion(successRelay("page-004", 1), { anchorKey: "id:btn" }, store);
    expect(store.getLatest("page-004")?.pageId).toBe("page-004");
  });

  it("does NOT save to store on relay failure", async () => {
    const store = new SnapshotRetentionStore();
    const relay = { request: vi.fn().mockResolvedValue({ requestId: "r1", success: false, data: {} }), isConnected: () => true };
    await handleCaptureRegion(relay, { anchorKey: "id:btn" }, store);
    expect(store.list("page-004")).toHaveLength(0);
  });

  it("does NOT save to store when browser is not connected", async () => {
    const store = new SnapshotRetentionStore();
    const relay = { request: vi.fn(), isConnected: () => false };
    await handleCaptureRegion(relay, { anchorKey: "id:btn" }, store);
    expect(store.list("page-004")).toHaveLength(0);
  });
});