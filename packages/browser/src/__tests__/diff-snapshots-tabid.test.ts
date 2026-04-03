/**
 * diff-snapshots-tabid.test.ts
 *
 * Tests for B2-CTX-002/B2-CTX-003 — tabId routing in diff_snapshots tool.
 *
 * Tests the Hub handler (handleDiffSnapshots in diff-tool.ts) forwards tabId
 * to relay.request("get_page_map", ...) for implicit snapshot resolution.
 *
 * API checklist (handleDiffSnapshots):
 * - handleDiffSnapshots → B2-CTX-002 (tabId in resolveFreshSnapshot)
 * - handleDiffSnapshots → B2-CTX-003 (tabId in resolveFromSnapshot)
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * BUGS BEING TESTED:
 *
 * Bug 1 — resolveFreshSnapshot passes {} to relay.request("get_page_map", {}, ...)
 *   → tabId is NEVER forwarded for fresh snapshot capture.
 *   → If agent wants to diff snapshots from tab 42, the fresh capture goes to active tab.
 *
 * Bug 2 — resolveFromSnapshot passes {} to relay.request("get_page_map", {}, ...)
 *   → tabId is NEVER forwarded for "from" snapshot preflight.
 *   → Preflight capture goes to active tab instead of target tab.
 *
 * These tests use a recording relay to capture the exact payload sent to
 * relay.request() and assert tabId is present when expected.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleDiffSnapshots } from "../diff-tool.js";
import type { DiffSnapshotsArgs } from "../diff-tool.js";
import type { BrowserRelayLike } from "../types.js";
import { SnapshotRetentionStore } from "../snapshot-retention.js";

// ── Recording Relay ────────────────────────────────────────────────────────────

/**
 * Recording relay that captures all relay.request calls with their action
 * and payload. Returns success for get_page_map (used in implicit resolution)
 * and diff_snapshots (main action).
 */
function createRecordingRelay() {
  const recordedCalls: Array<{ action: string; payload: Record<string, unknown> }> = [];

  const relay = {
    request: vi.fn().mockImplementation(async (action: string, payload?: Record<string, unknown>) => {
      recordedCalls.push({ action, payload: { ...(payload ?? {}) } });

      if (action === "get_page_map") {
        // Mock get_page_map success for implicit snapshot resolution
        return {
          success: true,
          requestId: "test",
          data: {
            pageId: "page",
            frameId: "main",
            snapshotId: "page:5",
            capturedAt: "2025-01-01T00:00:05.000Z",
            viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
            source: "dom" as const,
            pageUrl: "https://example.com",
            title: "Test",
            nodes: [],
            totalElements: 0,
            depth: 0,
            truncated: false,
          },
        };
      }

      if (action === "diff_snapshots") {
        return {
          success: true,
          requestId: "test",
          data: {
            fromSnapshotId: (payload?.fromSnapshotId as string) ?? "page:4",
            toSnapshotId: (payload?.toSnapshotId as string) ?? "page:5",
            added: [],
            removed: [],
            changed: [],
            summary: { addedCount: 0, removedCount: 0, changedCount: 0, textDelta: "no changes" },
            pageId: "page",
            frameId: "main",
            snapshotId: "page:5",
            capturedAt: "2025-01-01T00:00:05.000Z",
            viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
            source: "dom" as const,
          },
        };
      }

      return { success: true, requestId: "test", data: {} };
    }),
    isConnected: vi.fn(() => true),
    getRecordedCalls: () => recordedCalls,
    resetRecordedCalls: () => { recordedCalls.length = 0; },
  } as unknown as BrowserRelayLike & {
    getRecordedCalls(): Array<{ action: string; payload: Record<string, unknown> }>;
    resetRecordedCalls(): void;
  };

  return relay;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("B2-CTX-002: diff_snapshots — tabId in resolveFreshSnapshot (implicit `to`)", () => {
  let relay: ReturnType<typeof createRecordingRelay>;
  let store: SnapshotRetentionStore;

  beforeEach(() => {
    relay = createRecordingRelay();
    relay.resetRecordedCalls();
    store = new SnapshotRetentionStore();
  });

  /**
   * B2-CTX-002 RED: When toSnapshotId is omitted AND tabId is provided,
   * resolveFreshSnapshot MUST call relay.request("get_page_map", { tabId }, ...)
   * so the fresh snapshot is captured from the correct tab.
   *
   * Current behavior FAILS: resolveFreshSnapshot calls relay.request("get_page_map", {}, ...)
   * — no tabId in payload. The fresh snapshot is captured from the active tab,
   * not the target tab.
   */
  it("B2-CTX-002 RED: resolveFreshSnapshot includes tabId in get_page_map relay call when tabId is provided", async () => {
    const args: DiffSnapshotsArgs = { tabId: 42, fromSnapshotId: "page:0" };

    await handleDiffSnapshots(relay, args, store);

    // Find the get_page_map call (resolveFreshSnapshot makes this call)
    const getPageMapCalls = relay.getRecordedCalls().filter(c => c.action === "get_page_map");
    expect(getPageMapCalls.length).toBeGreaterThan(0);

    // The first get_page_map call should have tabId in the payload
    const freshSnapshotCall = getPageMapCalls[0]!;
    expect(freshSnapshotCall.payload).toHaveProperty("tabId");
    expect(freshSnapshotCall.payload.tabId).toBe(42);
  });

  /**
   * B2-CTX-002: When tabId is absent (active tab fallback), the get_page_map
   * call should NOT include tabId (backward compatibility).
   */
  it("B2-CTX-002: resolveFreshSnapshot omits tabId from get_page_map when tabId is absent (active tab fallback)", async () => {
    const args: DiffSnapshotsArgs = { fromSnapshotId: "page:0" };

    await handleDiffSnapshots(relay, args, store);

    const getPageMapCalls = relay.getRecordedCalls().filter(c => c.action === "get_page_map");
    expect(getPageMapCalls.length).toBeGreaterThan(0);

    const freshSnapshotCall = getPageMapCalls[0]!;
    expect(freshSnapshotCall.payload).not.toHaveProperty("tabId");
  });
});

describe("B2-CTX-003: diff_snapshots — tabId in resolveFromSnapshot (implicit `from`)", () => {
  let relay: ReturnType<typeof createRecordingRelay>;
  let store: SnapshotRetentionStore;

  beforeEach(() => {
    relay = createRecordingRelay();
    relay.resetRecordedCalls();
    store = new SnapshotRetentionStore();
  });

  /**
   * B2-CTX-003 RED: When fromSnapshotId is omitted AND tabId is provided,
   * resolveFromSnapshot MUST call relay.request("get_page_map", { tabId }, ...)
   * for the preflight check, so the page context is verified on the correct tab.
   *
   * Current behavior FAILS: resolveFromSnapshot calls relay.request("get_page_map", {}, ...)
   * — no tabId in payload. The preflight capture goes to the active tab.
   */
  it("B2-CTX-003 RED: resolveFromSnapshot includes tabId in get_page_map relay call when tabId is provided", async () => {
    const args: DiffSnapshotsArgs = { tabId: 77, toSnapshotId: "page:5" };

    await handleDiffSnapshots(relay, args, store);

    // With toSnapshotId provided, ONLY resolveFromSnapshot runs (no resolveFreshSnapshot).
    // There is exactly ONE get_page_map call — the resolveFromSnapshot preflight.
    const getPageMapCalls = relay.getRecordedCalls().filter(c => c.action === "get_page_map");
    expect(getPageMapCalls.length).toBe(1);

    const fromPreflightCall = getPageMapCalls[0];
    expect(fromPreflightCall).toBeDefined();
    expect(fromPreflightCall!.payload).toHaveProperty("tabId");
    expect(fromPreflightCall!.payload.tabId).toBe(77);
  });

  /**
   * B2-CTX-003: When tabId is absent, active tab is used — no tabId in payload.
   */
  it("B2-CTX-003: resolveFromSnapshot omits tabId when tabId is absent (active tab fallback)", async () => {
    const args: DiffSnapshotsArgs = { toSnapshotId: "page:5" };

    await handleDiffSnapshots(relay, args, store);

    const getPageMapCalls = relay.getRecordedCalls().filter(c => c.action === "get_page_map");
    expect(getPageMapCalls.length).toBeGreaterThan(0);

    // All get_page_map calls should omit tabId when not provided
    for (const call of getPageMapCalls) {
      expect(call.payload).not.toHaveProperty("tabId");
    }
  });
});

describe("B2-CTX-002/003: diff_snapshots — explicit snapshot IDs do not need tabId", () => {
  let relay: ReturnType<typeof createRecordingRelay>;
  let store: SnapshotRetentionStore;

  beforeEach(() => {
    relay = createRecordingRelay();
    relay.resetRecordedCalls();
    store = new SnapshotRetentionStore();
  });

  /**
   * B2-CTX-002/003: When both fromSnapshotId and toSnapshotId are explicit,
   * the relay's diff_snapshots payload does NOT need tabId (snapshots are
   * retrieved by ID from the store, tabId is only for implicit capture paths).
   *
   * This is the explicit ID path — no implicit get_page_map calls should be made.
   * tabId is only forwarded for implicit capture (resolveFreshSnapshot/resolveFromSnapshot).
   */
  it("B2-CTX-002/003: with explicit IDs, no get_page_map calls are made (tabId not needed in relay payload)", async () => {
    const args: DiffSnapshotsArgs = { fromSnapshotId: "page:0", toSnapshotId: "page:5" };

    await handleDiffSnapshots(relay, args, store);

    // With explicit IDs, no get_page_map calls should be made
    // (resolveFreshSnapshot and resolveFromSnapshot are skipped)
    const getPageMapCalls = relay.getRecordedCalls().filter(c => c.action === "get_page_map");
    expect(getPageMapCalls).toHaveLength(0);

    // diff_snapshots call should be made with explicit IDs
    const diffCalls = relay.getRecordedCalls().filter(c => c.action === "diff_snapshots");
    expect(diffCalls).toHaveLength(1);
    expect(diffCalls[0]!.payload.fromSnapshotId).toBe("page:0");
    expect(diffCalls[0]!.payload.toSnapshotId).toBe("page:5");
  });
});
