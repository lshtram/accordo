/**
 * snapshot-retention-dom-excerpt.test.ts
 *
 * Tests that handleGetDomExcerpt persists SnapshotEnvelopeFields into
 * SnapshotRetentionStore on success, and does NOT persist on failure.
 */

import { describe, it, expect, vi } from "vitest";
import { SnapshotRetentionStore } from "../snapshot-retention.js";
import { handleGetDomExcerpt } from "../page-understanding-tools.js";
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
      data: { ...makeEnvelope(pageId, version), found: true, html: "<div>Hello</div>", text: "Hello", nodeCount: 1, truncated: false },
    }),
    isConnected: () => true,
  };
}

describe("B2-SV-004: handleGetDomExcerpt persists envelope into store", () => {
  it("saves envelope to store on success", async () => {
    const store = new SnapshotRetentionStore();
    await handleGetDomExcerpt(successRelay("page-003", 1), { selector: "div" }, store);
    expect(store.getLatest("page-003")?.pageId).toBe("page-003");
  });

  it("does NOT save to store on relay failure", async () => {
    const store = new SnapshotRetentionStore();
    const relay = { request: vi.fn().mockResolvedValue({ requestId: "r1", success: false, data: {} }), isConnected: () => true };
    await handleGetDomExcerpt(relay, { selector: "div" }, store);
    expect(store.list("page-003")).toHaveLength(0);
  });

  it("does NOT save to store when browser is not connected", async () => {
    const store = new SnapshotRetentionStore();
    const relay = { request: vi.fn(), isConnected: () => false };
    await handleGetDomExcerpt(relay, { selector: "div" }, store);
    expect(store.list("page-003")).toHaveLength(0);
  });
});