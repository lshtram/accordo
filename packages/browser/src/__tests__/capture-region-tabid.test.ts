/**
 * capture-region-tabid.test.ts
 *
 * Tests for B2-CTX-001/B2-CTX-002 — tabId routing in capture_region tool.
 *
 * Tests the Hub handler (handleCaptureRegion in page-tool-handlers-impl.ts)
 * passes tabId through to the relay.request("capture_region", payload) call.
 *
 * API checklist (handleCaptureRegion):
 * - handleCaptureRegion → B2-CTX-001 (tabId pass-through)
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * BUG BEING TESTED:
 *
 * CaptureRegionArgs has tabId?: number (Phase A stub ✅).
 * handleCaptureRegion passes args as Record<string, unknown> to relay.request,
 * so tabId flows through IF CaptureRegionArgs includes it.
 *
 * But the design doc says:
 * - "Hub Passes: ✅ transparent pass-through" — meaning the handler already
 *   passes args through correctly (args as Record<string,unknown>).
 * - The real bugs are on the extension side (toCapturePayload ignores tabId,
 *   resolvePaddedBounds ignores tabId, etc.).
 *
 * These tests verify the Hub-side pass-through is correct. They document
 * the expected contract: tabId flows through to the relay payload.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleCaptureRegion } from "../page-tool-handlers-impl.js";
import type { CaptureRegionArgs } from "../page-tool-types.js";
import type { BrowserRelayLike } from "../types.js";
import { SnapshotRetentionStore } from "../snapshot-retention.js";

// ── Recording Relay ────────────────────────────────────────────────────────────

/**
 * Recording relay — captures the exact payload passed to relay.request().
 * Use to verify the handler passes tabId through to the relay.
 */
function createRecordingRelay() {
  let recordedPayload: Record<string, unknown> = {};

  const relay = {
    request: vi.fn().mockImplementation(async (_action: string, payload?: Record<string, unknown>) => {
      recordedPayload = { ...(payload ?? {}) };
      return {
        success: true,
        requestId: "test",
        data: {
          success: true,
          dataUrl: "data:image/jpeg;base64,mock",
          width: 100,
          height: 100,
          sizeBytes: 1000,
          anchorSource: "rect",
          pageId: "page",
          frameId: "main",
          snapshotId: "page:0",
          capturedAt: "2025-01-01T00:00:00.000Z",
          viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
          source: "dom" as const,
        },
      };
    }),
    isConnected: vi.fn(() => true),
    getRecordedPayload: () => recordedPayload,
    resetRecordedPayload: () => { recordedPayload = {}; },
  } as unknown as BrowserRelayLike & {
    getRecordedPayload(): Record<string, unknown>;
    resetRecordedPayload(): void;
  };

  return relay;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("B2-CTX-001: capture_region tabId hub-side pass-through", () => {
  let relay: ReturnType<typeof createRecordingRelay>;
  let store: SnapshotRetentionStore;

  beforeEach(() => {
    relay = createRecordingRelay();
    relay.resetRecordedPayload();
    store = new SnapshotRetentionStore();
  });

  /**
   * B2-CTX-001: When tabId is provided in args, relay.request receives tabId
   * in the payload.
   *
   * Expected: tabId IS included (transparent pass-through).
   * This test verifies the pass-through contract.
   */
  it("B2-CTX-001: handleCaptureRegion passes tabId through to relay.request when provided", async () => {
    const args: CaptureRegionArgs = { tabId: 42, anchorKey: "btn_1" };

    await handleCaptureRegion(relay, args, store);

    const payload = relay.getRecordedPayload();
    expect(payload).toHaveProperty("tabId");
    expect(payload.tabId).toBe(42);
  });

  /**
   * B2-CTX-001: When tabId is absent, relay.request does NOT include tabId
   * in the payload (backward compatibility — active tab is used).
   *
   * Expected: tabId is absent from payload (backward-compatible omission).
   * This test verifies backward-compatible behavior.
   */
  it("B2-CTX-001: handleCaptureRegion omits tabId from relay payload when absent", async () => {
    const args: CaptureRegionArgs = { anchorKey: "btn_2" };

    await handleCaptureRegion(relay, args, store);

    const payload = relay.getRecordedPayload();
    expect(payload).not.toHaveProperty("tabId");
  });

  /**
   * B2-CTX-002: When tabId targets a non-active tab (e.g. tabId: 99),
   * relay.request includes the correct tabId value.
   *
   * This is the key regression test: the agent specifies tabId: 99 to
   * capture a background tab, and the relay must forward that tabId so the
   * extension can route to the correct tab.
   */
  it("B2-CTX-002: handleCaptureRegion passes correct tabId for non-active tab targeting", async () => {
    const args: CaptureRegionArgs = { tabId: 99, rect: { x: 0, y: 0, width: 100, height: 100 } };

    await handleCaptureRegion(relay, args, store);

    const payload = relay.getRecordedPayload();
    expect(payload.tabId).toBe(99);
  });
});
