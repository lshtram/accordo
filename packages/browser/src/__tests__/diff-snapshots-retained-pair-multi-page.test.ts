/**
 * diff-snapshots-retained-pair-multi-page.test.ts
 *
 * Design point 4c: multi-page recency — most-recently captured snapshot wins,
 * regardless of which page it belongs to.
 *
 * Tests that cross-page pair selection uses capturedAt timestamps (true recency)
 * rather than Map iteration order or any page-identity constraint.
 */

import { describe, it, expect } from "vitest";
import type { BrowserRelayLike } from "../types.js";
import type { DiffSnapshotsResponse } from "../diff-tool-contracts.js";
import type { SnapshotRetentionStore } from "../snapshot-retention.js";
import { handleDiffSnapshots } from "../diff-tool-handler.js";
import { SnapshotRetentionStore as StoreClass } from "../snapshot-retention.js";

function makeEnvelopeWithTime(pageId: string, version: number, capturedAtMs: number) {
  return {
    pageId,
    frameId: "main",
    snapshotId: `${pageId}:${version}`,
    capturedAt: new Date(capturedAtMs).toISOString(),
    viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
    source: "dom" as const,
    nodes: [],
  };
}

function makeDiffResponse(fromSnapshotId: string, toSnapshotId: string) {
  const [pageId, v] = fromSnapshotId.split(":");
  return {
    ...makeEnvelopeWithTime(pageId!, parseInt(v!, 10), Date.now()),
    fromSnapshotId,
    toSnapshotId,
    added: [{ nodeId: 1, text: "added" }],
    removed: [],
    changed: [],
    summary: { addedCount: 1, removedCount: 0, changedCount: 0, textDelta: "1 added" },
  };
}

// ── Design point 4c: multi-page recency selection ────────────────────────────

describe("both IDs omitted — design point 4c: multi-page recency", () => {
  it("picks actual most-recent by capturedAt across pages (not last Map key)", async () => {
    // page-B captured MOST RECENTLY → its snapshot becomes "to"
    // page-A captured earlier → its latest becomes "from"
    const store = new StoreClass();
    store.save("page-A", makeEnvelopeWithTime("page-A", 10, Date.now() - 60_000));
    store.save("page-A", makeEnvelopeWithTime("page-A", 11, Date.now() - 60_000));
    store.save("page-B", makeEnvelopeWithTime("page-B", 1, Date.now()));        // most recent → to
    store.save("page-B", makeEnvelopeWithTime("page-B", 2, Date.now() - 30_000)); // second most recent → from

    const relay = {
      request: vi.fn().mockResolvedValue({
        success: true,
        requestId: "test",
        data: makeDiffResponse("page-B:2", "page-B:1"),
      }),
      isConnected: () => true,
    } as unknown as BrowserRelayLike;

    const result = await handleDiffSnapshots(relay, {}, store);

    expect(result).not.toHaveProperty("success", false);
    const diffResult = result as DiffSnapshotsResponse;
    expect(diffResult.fromSnapshotId).toBe("page-B:2");
    expect(diffResult.toSnapshotId).toBe("page-B:1");
  });

  it("resolves pair from two one-snapshot pages (no same-page requirement)", async () => {
    // page-X captured first → older → "from"
    // page-Y captured second → newer → "to"
    const store = new StoreClass();
    store.save("page-X", makeEnvelopeWithTime("page-X", 1, Date.now() - 100_000));
    store.save("page-Y", makeEnvelopeWithTime("page-Y", 1, Date.now() - 50_000));

    const relay = {
      request: vi.fn().mockResolvedValue({
        success: true,
        requestId: "test",
        data: makeDiffResponse("page-X:1", "page-Y:1"),
      }),
      isConnected: () => true,
    } as unknown as BrowserRelayLike;

    const result = await handleDiffSnapshots(relay, {}, store);

    expect(result).not.toHaveProperty("success", false);
    const diffResult = result as DiffSnapshotsResponse;
    expect(diffResult.fromSnapshotId).toBe("page-X:1");
    expect(diffResult.toSnapshotId).toBe("page-Y:1");
  });
});