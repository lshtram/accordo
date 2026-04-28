/**
 * diff-snapshots-runtime-mismatch.test.ts
 *
 * Design point 6 — relay returns snapshot-not-found but both IDs are
 * locally present: extension/runtime lookup mismatch detection.
 *
 * When the relay reports snapshot-not-found AND both requested snapshot IDs
 * exist in the local retention store, the error must indicate a mismatch
 * (not a "here are alternatives" case). In particular, availableSnapshotIds
 * is OMITTED from the mismatch error because listing IDs that ARE available
 * but relay still failed is contradictory.
 */

import { describe, it, expect } from "vitest";
import type { BrowserRelayLike } from "../types.js";
import type { DiffToolError } from "../diff-tool-contracts.js";
import { SnapshotRetentionStore } from "../snapshot-retention.js";
import { handleDiffSnapshots } from "../diff-tool-handler.js";

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

// ─────────────────────────────────────────────────────────────────────────────
// Design point 6: mismatch detection — both IDs present locally but relay fails
// ─────────────────────────────────────────────────────────────────────────────

describe("relay snapshot-not-found with both IDs locally present — mismatch error (design point 6)", () => {
  it("returns mismatch error; omits availableSnapshotIds from details", async () => {
    // Relay configured to return snapshot-not-found for any diff
    const relay = {
      request: vitest.fn().mockResolvedValue({
        success: false,
        requestId: "test",
        error: "snapshot-not-found",
      }),
      isConnected: () => true,
    } as unknown as BrowserRelayLike;

    const store = new SnapshotRetentionStore();
    // Populate store — both IDs ARE in the store
    store.save("page-g2d", makeEnvelope("page-g2d", 5));
    store.save("page-g2d", makeEnvelope("page-g2d", 6));

    const result = await handleDiffSnapshots(
      relay,
      { fromSnapshotId: "page-g2d:5", toSnapshotId: "page-g2d:6" },
      store
    );

    expect(result).toHaveProperty("success", false);
    const error = result as DiffToolError;
    expect(error.error).toBe("snapshot-not-found");
    // Both IDs are present locally — availableSnapshotIds must be omitted
    // (design point 6: listing IDs that ARE available but relay still failed is contradictory)
    expect(error.details?.availableSnapshotIds).toBeUndefined();
    // Recovery hints must reference the mismatch scenario
    expect(error.recoveryHints).toContain("extension/runtime failed to diff them");
  });
});