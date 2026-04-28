/**
 * diff-snapshots-retained-pair.test.ts
 *
 * Design point 4 — both IDs omitted: basic retained-pair resolution.
 *
 * Tests the "no fresh capture" behavior and error path when insufficient
 * snapshots are retained. Tests for same-page multi-snapshot cases.
 */

import { describe, it, expect } from "vitest";
import type { BrowserRelayLike } from "../types.js";
import type { DiffSnapshotsResponse, DiffToolError } from "../diff-tool-contracts.js";
import type { SnapshotRetentionStore } from "../snapshot-retention.js";
import { handleDiffSnapshots } from "../diff-tool-handler.js";
import { SnapshotRetentionStore as StoreClass } from "../snapshot-retention.js";

function makeEnvelope(pageId: string, version: number) {
  return {
    pageId,
    frameId: "main",
    snapshotId: `${pageId}:${version}`,
    capturedAt: new Date().toISOString(),
    viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
    source: "dom" as const,
    nodes: [],
  };
}

function makeDiffResponse(fromSnapshotId: string, toSnapshotId: string) {
  const [pageId, v] = fromSnapshotId.split(":");
  return {
    ...makeEnvelope(pageId!, parseInt(v!, 10)),
    fromSnapshotId,
    toSnapshotId,
    added: [{ nodeId: 1, text: "added" }],
    removed: [],
    changed: [],
    summary: { addedCount: 1, removedCount: 0, changedCount: 0, textDelta: "1 added" },
  };
}

function seedSnapshots(store: SnapshotRetentionStore, pageId: string, versions: number[]) {
  for (const v of versions) store.save(pageId, makeEnvelope(pageId, v));
}

function createMockRelay() {
  return {
    request: vi.fn().mockResolvedValue({
      success: true,
      requestId: "test",
      data: makeDiffResponse("page-omitted:4", "page-omitted:5"),
    }),
    isConnected: () => true,
  } as unknown as BrowserRelayLike;
}

// ── Design point 4a: >= 2 same-page snapshots → use previous/latest pair ───

describe("both IDs omitted — design point 4a: >=2 retained snapshots", () => {
  it("succeeds using previous/latest retained pair; no get_page_map calls", async () => {
    const relay = createMockRelay();
    const store = new StoreClass();
    seedSnapshots(store, "page-omitted", [3, 4, 5]);

    const result = await handleDiffSnapshots(relay, {}, store);

    expect(result).not.toHaveProperty("success", false);
    const diffResult = result as DiffSnapshotsResponse;
    expect(diffResult.fromSnapshotId).toBe("page-omitted:4");
    expect(diffResult.toSnapshotId).toBe("page-omitted:5");

    // Zero get_page_map calls — key behavioral guarantee
    const getPageMapCalls = relay.request.mock.calls.filter(([action]: [string]) => action === "get_page_map");
    expect(getPageMapCalls).toHaveLength(0);

    // First relay action is diff_snapshots, not get_page_map
    const firstCall = relay.request.mock.calls[0];
    expect(firstCall?.[0]).toBe("diff_snapshots");
  });
});

// ── Design point 4b: < 2 total snapshots → clear snapshot-not-found error ────

describe("both IDs omitted — design point 4b: fewer than 2 retained snapshots", () => {
  it("returns snapshot-not-found; no get_page_map calls; no invented ID", async () => {
    const relay = createMockRelay();
    const store = new StoreClass();
    store.save("page-few", makeEnvelope("page-few", 1));

    const result = await handleDiffSnapshots(relay, {}, store);

    expect(result).toHaveProperty("success", false);
    const error = result as DiffToolError;
    expect(error.error).toBe("snapshot-not-found");
    expect(error.recoveryHints).toContain("fewer than two snapshots");
    expect(error.recoveryHints).toContain("Capture at least two snapshots");
    // Must NOT invent or reference a next snapshot ID
    expect(error.recoveryHints).not.toContain(":2");
    expect(error.recoveryHints).not.toContain("page-few:2");
    expect(error.details?.availableSnapshotIds).toBeUndefined();
    const getPageMapCalls = relay.request.mock.calls.filter(([action]: [string]) => action === "get_page_map");
    expect(getPageMapCalls).toHaveLength(0);
  });

  it("returns snapshot-not-found when store is completely empty", async () => {
    const relay = createMockRelay();
    const store = new StoreClass();

    const result = await handleDiffSnapshots(relay, {}, store);

    expect(result).toHaveProperty("success", false);
    const error = result as DiffToolError;
    expect(error.error).toBe("snapshot-not-found");
    expect(error.recoveryHints).toContain("fewer than two snapshots");
    expect(error.details?.availableSnapshotIds).toBeUndefined();
    const getPageMapCalls = relay.request.mock.calls.filter(([action]: [string]) => action === "get_page_map");
    expect(getPageMapCalls).toHaveLength(0);
  });
});