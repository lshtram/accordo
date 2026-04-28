/**
 * snapshot-retention-shared.test.ts
 *
 * Tests that all 4 data-producing handlers share the same store instance
 * and that per-page FIFO eviction applies across all paths.
 */

import { describe, it, expect, vi } from "vitest";
import { SnapshotRetentionStore, RETENTION_SLOTS } from "../snapshot-retention.js";
import {
  handleGetPageMap,
  handleInspectElement,
  handleGetDomExcerpt,
  handleCaptureRegion,
} from "../page-understanding-tools.js";
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

function makeVersionRelay(pageId: string, version: number, extraFields: Record<string, unknown> = {}) {
  return {
    request: vi.fn().mockResolvedValue({ requestId: `r${version}`, success: true, data: { ...makeEnvelope(pageId, version), ...extraFields } }),
    isConnected: () => true,
  };
}

describe("B2-SV-004: shared store — all 4 paths use coherent per-page retention", () => {
  it("all 4 handlers write to the same store instance", async () => {
    const store = new SnapshotRetentionStore();
    const pageMapRelay = makeVersionRelay("shared-page", 1, { pageUrl: "https://x.com", title: "X", nodes: [], totalElements: 0, truncated: false });
    const inspectRelay = makeVersionRelay("shared-page", 2, { found: true, anchorKey: "id:x", anchorStrategy: "id", anchorConfidence: "high" });
    const excerptRelay = makeVersionRelay("shared-page", 3, { found: true, html: "<div/>", text: "", nodeCount: 1, truncated: false });
    const captureRelay = makeVersionRelay("shared-page", 4, { source: "visual" as const, success: true, dataUrl: "data:image/jpeg;base64,A==", width: 10, height: 10, sizeBytes: 100 });

    await handleGetPageMap(pageMapRelay, {}, store);
    await handleInspectElement(inspectRelay, { selector: "#x" }, store);
    await handleGetDomExcerpt(excerptRelay, { selector: "div" }, store);
    await handleCaptureRegion(captureRelay, { anchorKey: "id:x" }, store);

    const retained = store.list("shared-page");
    expect(retained).toHaveLength(4);
    expect(retained.map((e) => e.snapshotId)).toEqual(["shared-page:1", "shared-page:2", "shared-page:3", "shared-page:4"]);
  });

  it("10-slot FIFO eviction applies across all 4 handler paths on the same page", async () => {
    const store = new SnapshotRetentionStore();
    const pageId = "eviction-page";

    await handleGetPageMap(makeVersionRelay(pageId, 1, { pageUrl: "https://x.com", title: "X", nodes: [], totalElements: 0, truncated: false }), {}, store);
    await handleInspectElement(makeVersionRelay(pageId, 2, { found: true, anchorKey: "id:x", anchorStrategy: "id", anchorConfidence: "high" }), { selector: "#x" }, store);
    await handleGetDomExcerpt(makeVersionRelay(pageId, 3, { found: true, html: "<div/>", text: "", nodeCount: 1, truncated: false }), { selector: "div" }, store);
    await handleCaptureRegion(makeVersionRelay(pageId, 4, { source: "visual" as const, success: true, dataUrl: "data:image/jpeg;base64,A==", width: 10, height: 10, sizeBytes: 100 }), { anchorKey: "id:x" }, store);
    await handleGetPageMap(makeVersionRelay(pageId, 5, { pageUrl: "https://x.com", title: "X", nodes: [], totalElements: 0, truncated: false }), {}, store);
    await handleInspectElement(makeVersionRelay(pageId, 6, { found: true, anchorKey: "id:x", anchorStrategy: "id", anchorConfidence: "high" }), { selector: "#x" }, store);
    await handleGetDomExcerpt(makeVersionRelay(pageId, 7, { found: true, html: "<div/>", text: "", nodeCount: 1, truncated: false }), { selector: "div" }, store);
    await handleCaptureRegion(makeVersionRelay(pageId, 8, { source: "visual" as const, success: true, dataUrl: "data:image/jpeg;base64,A==", width: 10, height: 10, sizeBytes: 100 }), { anchorKey: "id:x" }, store);
    await handleGetPageMap(makeVersionRelay(pageId, 9, { pageUrl: "https://x.com", title: "X", nodes: [], totalElements: 0, truncated: false }), {}, store);
    await handleInspectElement(makeVersionRelay(pageId, 10, { found: true, anchorKey: "id:x", anchorStrategy: "id", anchorConfidence: "high" }), { selector: "#x" }, store);
    await handleGetPageMap(makeVersionRelay(pageId, 11, { pageUrl: "https://x.com", title: "X", nodes: [], totalElements: 0, truncated: false }), {}, store);

    const retained = store.list(pageId);
    expect(retained).toHaveLength(RETENTION_SLOTS);
    expect(retained[0].snapshotId).toBe(`${pageId}:2`);
    expect(retained[RETENTION_SLOTS - 1].snapshotId).toBe(`${pageId}:11`);
    expect(store.get(`${pageId}:1`)).toBeUndefined();
  });
});