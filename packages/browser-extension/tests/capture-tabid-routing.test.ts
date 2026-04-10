/**
 * capture-tabid-routing.test.ts
 *
 * Tests for B2-CTX-001/B2-CTX-003/B2-CTX-004/B2-CTX-005 — tabId routing
 * in the capture_region extension-side handler.
 *
 * Tests the extension service worker functions:
 * - toCapturePayload (relay-type-guards.ts) — must extract tabId from payload
 * - resolvePaddedBounds (relay-capture-handler.ts) — must send RESOLVE_ANCHOR_BOUNDS
 *   message to the correct tabId (not active tab)
 * - requestContentScriptEnvelope (relay-forwarder.ts) — must use explicit tabId
 *   when provided
 * - Tab-swap logic for captureVisibleTab (relay-capture-handler.ts)
 *
 * API checklist (capture_region extension handlers):
 * - toCapturePayload → B2-CTX-003 (tabId extraction)
 * - resolvePaddedBounds → B2-CTX-003 (correct tabId routing) [NOTE: internal, requires export]
 * - executeCaptureRegion → B2-CTX-004 (tab-swap for non-active tabs)
 * - requestContentScriptEnvelope → B2-CTX-005 (explicit tabId parameter)
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * BUGS BEING TESTED:
 *
 * Bug 1 — toCapturePayload does NOT extract tabId:
 *   Line 86-106: returns { anchorKey, nodeRef, padding, quality, rect }
 *   — tabId is silently dropped.
 *
 * Bug 2 — resolvePaddedBounds hardcodes active tab:
 *   Line 109: chrome.tabs.query({ active: true, currentWindow: true })
 *   → Always sends RESOLVE_ANCHOR_BOUNDS to the active tab, ignoring payload.tabId.
 *   [NOTE: resolvePaddedBounds is internal — tested via handleCaptureRegion]
 *
 * Bug 3 — requestContentScriptEnvelope hardcodes active tab:
 *   relay-forwarder.ts Line 56: chrome.tabs.query({ active: true, currentWindow: true })
 *   → Always gets envelope from active tab.
 *
 * Bug 4 — captureVisibleTab has no tab-swap logic:
 *   relay-capture-handler.ts Line 138: chrome.tabs.captureVisibleTab()
 *   → Chrome API only captures the active/visible tab.
 *   → Non-active tab capture needs tab-swap: activate → capture → restore.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Chrome mock must be set up before importing modules that use chrome.*
import "./setup/chrome-mock.js";
import { resetChromeMocks, setMockTabUrl } from "./setup/chrome-mock.js";
import { toCapturePayload } from "../src/relay-type-guards.js";
import { requestContentScriptEnvelope } from "../src/relay-forwarder.js";
import type { CapturePayload } from "../src/relay-definitions.js";

// ── Tests: toCapturePayload ────────────────────────────────────────────────────

describe("B2-CTX-003: toCapturePayload extracts tabId from relay payload", () => {
  beforeEach(() => {
    resetChromeMocks();
  });

  /**
   * B2-CTX-003 RED: toCapturePayload MUST extract tabId from the payload
   * and include it in the returned CapturePayload.
   *
   * Current behavior FAILS: toCapturePayload returns:
   *   { anchorKey, nodeRef, padding, quality, rect }
   *   — tabId is NOT extracted, tabId is silently dropped.
   *
   * After the fix, toCapturePayload should include:
   *   { tabId: 42, anchorKey, nodeRef, padding, quality, rect }
   */
  it("B2-CTX-003 RED: toCapturePayload extracts tabId from payload when present", () => {
    const payload: Record<string, unknown> = {
      tabId: 42,
      anchorKey: "btn_1",
      padding: 8,
      quality: 70,
    };

    const capturePayload = toCapturePayload(payload);

    // This assertion FAILS currently — toCapturePayload does not extract tabId
    expect(capturePayload).toHaveProperty("tabId");
    expect(capturePayload.tabId).toBe(42);
  });

  /**
   * B2-CTX-003: When tabId is absent, the returned CapturePayload should
   * have tabId: undefined (backward compatibility).
   */
  it("B2-CTX-003: toCapturePayload returns tabId: undefined when absent from payload", () => {
    const payload: Record<string, unknown> = {
      anchorKey: "btn_2",
      padding: 16,
    };

    const capturePayload = toCapturePayload(payload);

    expect(capturePayload.tabId).toBeUndefined();
  });

  /**
   * B2-CTX-003: toCapturePayload correctly extracts other fields alongside tabId.
   */
  it("B2-CTX-003: toCapturePayload extracts all fields including tabId", () => {
    const payload: Record<string, unknown> = {
      tabId: 99,
      anchorKey: "node_ref_123",
      nodeRef: "persistent_id_abc",
      padding: 12,
      quality: 75,
      rect: { x: 10, y: 20, width: 300, height: 200 },
    };

    const capturePayload = toCapturePayload(payload);

    expect(capturePayload.tabId).toBe(99);
    expect(capturePayload.anchorKey).toBe("node_ref_123");
    expect(capturePayload.nodeRef).toBe("persistent_id_abc");
    expect(capturePayload.padding).toBe(12);
    expect(capturePayload.quality).toBe(75);
    expect(capturePayload.rect).toEqual({ x: 10, y: 20, width: 300, height: 200 });
  });
});

describe("CR-F-03: RESOLVE_ANCHOR_BOUNDS resolves nodeRef via page-map ref index", () => {
  beforeEach(() => {
    resetChromeMocks();
  });

  it("looks up nodeRef with getElementByRef instead of treating it as an anchorKey", async () => {
    document.body.innerHTML = `<button id="capture-target">Capture me</button>`;

    const target = document.getElementById("capture-target")!;
    vi.spyOn(target, "getBoundingClientRect").mockReturnValue({
      x: 120,
      y: 240,
      width: 80,
      height: 30,
      top: 240,
      left: 120,
      bottom: 270,
      right: 200,
      toJSON: () => ({}),
    } as DOMRect);

    const { collectPageMap } = await import("../src/content/page-map-collector.js");
    await import("../src/content/message-handlers.js");
    collectPageMap({ includeBounds: true });

    const listener = (chrome.runtime.onMessage.addListener as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0];
    expect(typeof listener).toBe("function");

    const response = await new Promise<unknown>((resolve) => {
      listener(
        { type: "RESOLVE_ANCHOR_BOUNDS", nodeRef: "ref-0", padding: 0 },
        {},
        resolve,
      );
    });

    expect(response).toEqual({
      bounds: { x: 120, y: 240, width: 80, height: 30 },
    });
  });

  it("ignores zero-sized rect and still resolves nodeRef bounds", async () => {
    const { handleCaptureRegion } = await import("../src/relay-capture-handler.js");

    (chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockImplementation(
      async (_tabId: number, message: unknown) => {
        const typed = message as Record<string, unknown>;
        if (typed.type === "RESOLVE_ANCHOR_BOUNDS") {
          return { bounds: { x: 65, y: 222, width: 200, height: 35 } };
        }
        if (typed.type === "CAPTURE_SNAPSHOT_ENVELOPE") {
          return {
            pageId: "page",
            frameId: "main",
            snapshotId: "page:0",
            capturedAt: "2025-01-01T00:00:00.000Z",
            viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
            source: "visual" as const,
          };
        }
        return undefined;
      }
    );
    (chrome.tabs.captureVisibleTab as ReturnType<typeof vi.fn>).mockResolvedValue("data:image/png;base64,AAAA");

    const response = await handleCaptureRegion({
      requestId: "test-node-ref-with-empty-rect",
      action: "capture_region",
      payload: {
        tabId: 1,
        nodeRef: "ref-2",
        rect: { x: 0, y: 0, width: 0, height: 0 },
        padding: 0,
        quality: 80,
        format: "png",
      },
    });

    expect(response.success).toBe(true);
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ type: "RESOLVE_ANCHOR_BOUNDS", nodeRef: "ref-2" }),
    );
  });
});

// ── Tests: requestContentScriptEnvelope ───────────────────────────────────────

describe("B2-CTX-005: requestContentScriptEnvelope uses explicit tabId when provided", () => {
  beforeEach(() => {
    resetChromeMocks();
    setMockTabUrl(1, "https://example.com/active");
    setMockTabUrl(42, "https://example.com/target");
  });

  /**
   * B2-CTX-005 RED: requestContentScriptEnvelope MUST accept an optional
   * tabId parameter and use it for chrome.tabs.sendMessage instead of
   * querying the active tab.
   *
   * Current behavior FAILS:
   * - relay-forwarder.ts Line 56: chrome.tabs.query({ active: true, currentWindow: true })
   * - Line 58: chrome.tabs.sendMessage(tab.id, ...) — tab.id is the active tab
   * → requestContentScriptEnvelope always uses the active tab (1).
   * → When called with tabId=42, it still sends to tab 1.
   *
   * The function signature needs to change to accept tabId?: number.
   */
  it("B2-CTX-005 RED: requestContentScriptEnvelope uses explicit tabId when provided", async () => {
    let capturedTabId: number | undefined;
    (chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockImplementation(
      async (tabId: number, _message: unknown) => {
        capturedTabId = tabId;
        // Return a valid envelope shape
        return {
          pageId: "page",
          frameId: "main",
          snapshotId: "page:0",
          capturedAt: "2025-01-01T00:00:00.000Z",
          viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
          source: "visual" as const,
        };
      }
    );

    // Call with explicit tabId: 42
    // NOTE: The current function signature is (source: "dom" | "visual")
    // so tabId cannot even be passed. This test documents the expected
    // interface after the fix. The test will fail because:
    // 1. If tabId param not added yet: function doesn't accept 2nd param (TypeScript error)
    // 2. After tabId param is added but not used: capturedTabId === 1 (active tab)
    await requestContentScriptEnvelope("visual", 42);

    // This FAILS currently: capturedTabId === 1 (active tab) instead of 42
    expect(capturedTabId).toBe(42);
  });

  /**
   * B2-CTX-005: When tabId is omitted, requestContentScriptEnvelope falls back
   * to querying the active tab (current behavior must be preserved).
   */
  it("B2-CTX-005: requestContentScriptEnvelope falls back to active tab when tabId omitted", async () => {
    let capturedTabId: number | undefined;
    (chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockImplementation(
      async (tabId: number, _message: unknown) => {
        capturedTabId = tabId;
        return {
          pageId: "page",
          frameId: "main",
          snapshotId: "page:0",
          capturedAt: "2025-01-01T00:00:00.000Z",
          viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
          source: "visual" as const,
        };
      }
    );

    // Call without tabId (only source parameter)
    await requestContentScriptEnvelope("visual");

    // Should use active tab (tab 1)
    expect(capturedTabId).toBe(1);
  });

  it("M114: requestContentScriptEnvelope throws when content script is unavailable", async () => {
    (chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("Could not establish connection. Receiving end does not exist."),
    );

    await expect(requestContentScriptEnvelope("visual", 42)).rejects.toThrow(
      "Receiving end does not exist.",
    );
  });
});

// ── Tests: Tab-Swap Logic for captureVisibleTab ─────────────────────────────────

describe("B2-CTX-004: captureTab activates target tab before capture (tab-swap strategy)", () => {
  beforeEach(() => {
    resetChromeMocks();
    setMockTabUrl(1, "https://example.com/active");
    setMockTabUrl(42, "https://example.com/target");
    setMockTabUrl(99, "https://example.com/other");
  });

  /**
   * B2-CTX-004 RED: When targeting a non-active tab (tabId: 42),
   * the capture flow MUST:
   * 1. Save the current active tab ID (1)
   * 2. Call chrome.tabs.update(42, { active: true }) to activate target tab
   * 3. Call chrome.tabs.sendMessage (RESOLVE_ANCHOR_BOUNDS + CAPTURE_SNAPSHOT_ENVELOPE)
   * 4. Call chrome.tabs.captureVisibleTab() — now captures target tab since it's active
   * 5. Restore the previous active tab via chrome.tabs.update(1, { active: true })
   *
   * Current behavior FAILS:
   * - relay-capture-handler.ts Line 138: captureVisibleTab() calls
   *   chrome.tabs.captureVisibleTab() with NO tab-swap logic
   * - Chrome API only captures the currently visible/active tab
   * → Non-active tab capture silently captures the wrong (active) tab.
   *
   * This test is NOT vacuous: it calls handleCaptureRegion() which triggers the
   * full capture chain including the (missing) tab-swap logic.
   */
  it("B2-CTX-004 RED: handleCaptureRegion with non-active tabId triggers tab-swap", async () => {
    // Import handleCaptureRegion for the full integration test
    const { handleCaptureRegion } = await import("../src/relay-capture-handler.js");

    // Track chrome.tabs.update calls for tab-swap verification
    const updateCalls: Array<{ tabId: number; properties: { active?: boolean } }> = [];
    (chrome.tabs.update as ReturnType<typeof vi.fn>).mockImplementation(
      async (tabId: number, properties: { active?: boolean; url?: string; pinned?: boolean }) => {
        updateCalls.push({ tabId, properties });
        return { id: tabId, url: "https://example.com/page", active: properties.active ?? false } as chrome.tabs.Tab;
      }
    );

    (chrome.tabs.captureVisibleTab as ReturnType<typeof vi.fn>).mockResolvedValue(
      "data:image/jpeg;base64,mockScreenshot"
    );

    // Mock sendMessage to return bounds and envelope for the full chain
    (chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockImplementation(
      async (tabId: number, message: unknown) => {
        if ((message as Record<string, unknown>)["type"] === "RESOLVE_ANCHOR_BOUNDS") {
          return { bounds: { x: 100, y: 200, width: 300, height: 150 } };
        }
        if ((message as Record<string, unknown>)["type"] === "CAPTURE_SNAPSHOT_ENVELOPE") {
          return {
            pageId: "page",
            frameId: "main",
            snapshotId: "page:0",
            capturedAt: "2025-01-01T00:00:00.000Z",
            viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
            source: "visual" as const,
          };
        }
        return undefined;
      }
    );

    // Call handleCaptureRegion with a non-active tabId (42)
    // Active tab is 1, so this should trigger tab-swap
    await handleCaptureRegion({
      requestId: "test-tabswap-activate",
      action: "capture_region",
      payload: {
        tabId: 42,
        anchorKey: "target_element",
        padding: 8,
        quality: 70,
      },
    });

    // Phase C fix will make these assertions pass:
    // 1. At least 2 update calls: one to activate target (42), one to restore original (1)
    expect(updateCalls.length).toBeGreaterThanOrEqual(2);

    // 2. First update activates the target tab (42)
    expect(updateCalls[0].tabId).toBe(42);
    expect(updateCalls[0].properties.active).toBe(true);

    // 3. captureVisibleTab was called (now captures tab 42 since it's active)
    expect(chrome.tabs.captureVisibleTab).toHaveBeenCalled();

    // 4. Issue 2 fix: restore step — last update restores the original active tab (1)
    const lastUpdate = updateCalls[updateCalls.length - 1];
    expect(lastUpdate.tabId).toBe(1);
    expect(lastUpdate.properties.active).toBe(true);
  });

  /**
   * B2-CTX-004: Tab-swap should NOT occur when targeting the already-active tab.
   * chrome.tabs.update should not be called when tabId === active tab.
   */
  it("B2-CTX-004: handleCaptureRegion with active tabId skips tab-swap", async () => {
    const { handleCaptureRegion } = await import("../src/relay-capture-handler.js");

    // Track chrome.tabs.update calls
    const updateCalls: Array<{ tabId: number; properties: { active?: boolean } }> = [];
    (chrome.tabs.update as ReturnType<typeof vi.fn>).mockImplementation(
      async (tabId: number, properties: { active?: boolean }) => {
        updateCalls.push({ tabId, properties });
        return { id: tabId, url: "https://example.com/page", active: properties.active ?? false } as chrome.tabs.Tab;
      }
    );

    (chrome.tabs.captureVisibleTab as ReturnType<typeof vi.fn>).mockResolvedValue(
      "data:image/jpeg;base64,mockScreenshot"
    );

    (chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockImplementation(
      async (tabId: number, message: unknown) => {
        if ((message as Record<string, unknown>)["type"] === "RESOLVE_ANCHOR_BOUNDS") {
          return { bounds: { x: 100, y: 200, width: 300, height: 150 } };
        }
        if ((message as Record<string, unknown>)["type"] === "CAPTURE_SNAPSHOT_ENVELOPE") {
          return {
            pageId: "page",
            frameId: "main",
            snapshotId: "page:0",
            capturedAt: "2025-01-01T00:00:00.000Z",
            viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
            source: "visual" as const,
          };
        }
        return undefined;
      }
    );

    // Call with active tabId (1) — no swap should occur
    await handleCaptureRegion({
      requestId: "test-tabswap-active",
      action: "capture_region",
      payload: {
        tabId: 1,
        anchorKey: "target_element",
        padding: 8,
        quality: 70,
      },
    });

    // No chrome.tabs.update calls needed when tab is already active
    expect(updateCalls.length).toBe(0);
    // But captureVisibleTab should still be called
    expect(chrome.tabs.captureVisibleTab).toHaveBeenCalled();
  });
});

// ── Tests: Integration via handleCaptureRegion (tests full routing chain) ───────

describe("B2-CTX-003: handleCaptureRegion routes to correct tabId via full chain", () => {
  beforeEach(() => {
    resetChromeMocks();
    setMockTabUrl(1, "https://example.com/active");
    setMockTabUrl(42, "https://example.com/target");
  });

  /**
   * B2-CTX-003 RED: Integration test — when handleCaptureRegion is called
   * with payload containing tabId=42 and anchorKey, the RESOLVE_ANCHOR_BOUNDS
   * message should be sent to tab 42, not the active tab (1).
   *
   * This test goes through the full chain:
   * handleCaptureRegion → toCapturePayload → executeCaptureRegion → resolvePaddedBounds
   *
   * The bug chain:
   * 1. toCapturePayload doesn't extract tabId → payload.tabId is lost
   * 2. resolvePaddedBounds doesn't receive tabId → uses active tab query
   *
   * After the fixes:
   * 1. toCapturePayload extracts tabId → payload.tabId = 42
   * 2. resolvePaddedBounds accepts tabId param → sends to tab 42
   */
  it("B2-CTX-003 RED: handleCaptureRegion with tabId routes RESOLVE_ANCHOR_BOUNDS to correct tab", async () => {
    // Import handleCaptureRegion for the full integration test
    const { handleCaptureRegion } = await import("../src/relay-capture-handler.js");

    // Set up sendMessage mock to capture the tabId used
    let capturedTabId: number | undefined;
    (chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockImplementation(
      async (tabId: number, message: unknown) => {
        capturedTabId = tabId;
        if ((message as Record<string, unknown>)["type"] === "RESOLVE_ANCHOR_BOUNDS") {
          return { bounds: { x: 100, y: 200, width: 300, height: 150 } };
        }
        if ((message as Record<string, unknown>)["type"] === "CAPTURE_SNAPSHOT_ENVELOPE") {
          return {
            pageId: "page",
            frameId: "main",
            snapshotId: "page:0",
            capturedAt: "2025-01-01T00:00:00.000Z",
            viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
            source: "visual" as const,
          };
        }
        return undefined;
      }
    );

    // Call handleCaptureRegion with tabId=42 and anchorKey
    await handleCaptureRegion({
      requestId: "test-tabid-routing",
      action: "capture_region",
      payload: {
        tabId: 42,
        anchorKey: "target_element",
        padding: 8,
        quality: 70,
      },
    });

    // This FAILS because:
    // 1. toCapturePayload doesn't extract tabId → tabId is lost
    // 2. resolvePaddedBounds uses chrome.tabs.query({ active: true }) → sends to tab 1
    expect(capturedTabId).toBe(42);
  });
});

// ── NOTE on resolvePaddedBounds unit tests ──────────────────────────────────────
// The internal function resolvePaddedBounds is not exported from relay-capture-handler.ts.
// For proper unit testing of its tabId routing behavior, it needs to be exported:
//
// export async function resolvePaddedBounds(
//   payload: CapturePayload,
//   padding: number,
//   targetTabId?: number,  // NEW: explicit tabId parameter
// ): Promise<{ x: number; y: number; width: number; height: number }>
//
// Tests for resolvePaddedBounds (to be uncommented after export):
// - B2-CTX-003 RED: with tabId=42, sendMessage is called with tabId=42 (not active tab)
// - B2-CTX-003: without tabId, falls back to chrome.tabs.query({ active: true })
// - B2-CTX-003: with rect, does NOT call sendMessage (rect bypass path)

// ── Tests: redactPatterns preservation ─────────────────────────────────────────

describe("toCapturePayload preserves redactPatterns from relay payload", () => {
  /**
   * GAP-I1 / MCP-VC-005: redactPatterns MUST be extracted from the relay payload
   * and included in the returned CapturePayload so handleCaptureRegion can apply
   * screenshot redaction.
   */
  it("toCapturePayload extracts redactPatterns when present as string array", () => {
    const payload: Record<string, unknown> = {
      tabId: 1,
      anchorKey: "btn_1",
      redactPatterns: ["email", "phone", "\\d{4}"],
    };

    const capturePayload = toCapturePayload(payload);

    expect(capturePayload.redactPatterns).toBeDefined();
    expect(capturePayload.redactPatterns).toHaveLength(3);
    expect(capturePayload.redactPatterns).toEqual(["email", "phone", "\\d{4}"]);
  });

  /**
   * When redactPatterns is absent, the field should be undefined (not an empty array).
   */
  it("toCapturePayload returns redactPatterns: undefined when absent", () => {
    const payload: Record<string, unknown> = {
      tabId: 1,
      anchorKey: "btn_1",
    };

    const capturePayload = toCapturePayload(payload);

    expect(capturePayload.redactPatterns).toBeUndefined();
  });

  /**
   * When redactPatterns is present but not an array, it should be ignored
   * (type guard returns undefined).
   */
  it("toCapturePayload ignores redactPatterns when not an array", () => {
    const payload: Record<string, unknown> = {
      tabId: 1,
      redactPatterns: "not-an-array",
    };

    const capturePayload = toCapturePayload(payload);

    expect(capturePayload.redactPatterns).toBeUndefined();
  });

  /**
   * redactPatterns works alongside all other CapturePayload fields.
   */
  it("toCapturePayload extracts redactPatterns alongside all other fields", () => {
    const payload: Record<string, unknown> = {
      tabId: 5,
      anchorKey: "node_x",
      nodeRef: "ref_x",
      padding: 16,
      quality: 80,
      rect: { x: 10, y: 20, width: 300, height: 200 },
      mode: "viewport",
      format: "png",
      redactPatterns: ["pattern1", "pattern2"],
    };

    const capturePayload = toCapturePayload(payload);

    expect(capturePayload.tabId).toBe(5);
    expect(capturePayload.anchorKey).toBe("node_x");
    expect(capturePayload.nodeRef).toBe("ref_x");
    expect(capturePayload.padding).toBe(16);
    expect(capturePayload.quality).toBe(80);
    expect(capturePayload.rect).toEqual({ x: 10, y: 20, width: 300, height: 200 });
    expect(capturePayload.mode).toBe("viewport");
    expect(capturePayload.format).toBe("png");
    expect(capturePayload.redactPatterns).toEqual(["pattern1", "pattern2"]);
  });
});

// ── Tests: resolveBoundsFromMessage unit test ─────────────────────────────────────────

describe("resolveBoundsFromMessage handles error-field responses", () => {
  it("returns { error: string } when val has error: string", async () => {
    const { resolveBoundsFromMessage } = await import("../src/relay-type-guards.js");
    const result = resolveBoundsFromMessage({ error: "element-not-found" } as unknown);
    expect(result).not.toBeNull();
    if (result !== null) {
      expect("error" in result).toBe(true);
      expect((result as { error: string }).error).toBe("element-not-found");
    }
  });

  it("returns { error: string } for element-off-screen", async () => {
    const { resolveBoundsFromMessage } = await import("../src/relay-type-guards.js");
    const result = resolveBoundsFromMessage({ error: "element-off-screen" } as unknown);
    expect(result).not.toBeNull();
    if (result !== null) {
      expect("error" in result).toBe(true);
      expect((result as { error: string }).error).toBe("element-off-screen");
    }
  });

  it("returns null for undefined input", async () => {
    const { resolveBoundsFromMessage } = await import("../src/relay-type-guards.js");
    const result = resolveBoundsFromMessage(undefined);
    expect(result).toBeNull();
  });

  it("returns null for response with no error or bounds", async () => {
    const { resolveBoundsFromMessage } = await import("../src/relay-type-guards.js");
    const result = resolveBoundsFromMessage({} as unknown);
    expect(result).toBeNull();
  });

  it("returns { bounds } for valid bounds response", async () => {
    const { resolveBoundsFromMessage } = await import("../src/relay-type-guards.js");
    const result = resolveBoundsFromMessage({ bounds: { x: 10, y: 20, width: 100, height: 50 } } as unknown);
    expect(result).not.toBeNull();
    if (result !== null && "bounds" in result) {
      expect(result.bounds).toEqual({ x: 10, y: 20, width: 100, height: 50 });
    }
  });
});

// ── Tests: structured error code propagation ─────────────────────────────────────

describe("handleCaptureRegion propagates RESOLVE_ANCHOR_BOUNDS error codes", () => {
  beforeEach(() => {
    resetChromeMocks();
    setMockTabUrl(1, "https://example.com/active");
    setMockTabUrl(42, "https://example.com/target");
  });

  /**
   * CR-F-12: When RESOLVE_ANCHOR_BOUNDS returns { error: "element-not-found" },
   * the capture result error should be "element-not-found" — NOT "no-target".
   *
   * Previously resolveBoundsFromMessage returned null for error-field responses,
   * collapsing all failures to "no-target". Now the named error is propagated.
   */
  it("CR-F-12: propagate element-not-found error code from content script", async () => {
    const { handleCaptureRegion } = await import("../src/relay-capture-handler.js");

    // Track what sendMessage returns
    let sendMessageCalls: unknown[] = [];
    (chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockImplementation(
      async (_tabId: number, message: unknown) => {
        sendMessageCalls.push(message);
        if ((message as Record<string, unknown>)["type"] === "RESOLVE_ANCHOR_BOUNDS") {
          // Content script explicitly returns element-not-found
          return { error: "element-not-found" };
        }
        if ((message as Record<string, unknown>)["type"] === "CAPTURE_SNAPSHOT_ENVELOPE") {
          return {
            pageId: "page",
            frameId: "main",
            snapshotId: "page:0",
            capturedAt: "2025-01-01T00:00:00.000Z",
            viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
            source: "visual" as const,
          };
        }
        return undefined;
      }
    );

    const response = await handleCaptureRegion({
      requestId: "test-error-propagation-not-found",
      action: "capture_region",
      payload: {
        tabId: 1,
        anchorKey: "missing_element",
        padding: 8,
        quality: 70,
      },
    });

    expect(response.success).toBe(true);
    expect((response.data as Record<string, unknown>)["success"]).toBe(false);
    // Must NOT be "no-target" — the specific error from content script is preserved
    expect((response.data as Record<string, unknown>)["error"]).toBe("element-not-found");
  });

  /**
   * CR-F-12: When RESOLVE_ANCHOR_BOUNDS returns { error: "element-off-screen" },
   * the capture result error should be "element-off-screen" — NOT "no-target".
   */
  it("CR-F-12: propagate element-off-screen error code from content script", async () => {
    const { handleCaptureRegion } = await import("../src/relay-capture-handler.js");

    (chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockImplementation(
      async (_tabId: number, message: unknown) => {
        if ((message as Record<string, unknown>)["type"] === "RESOLVE_ANCHOR_BOUNDS") {
          return { error: "element-off-screen" };
        }
        if ((message as Record<string, unknown>)["type"] === "CAPTURE_SNAPSHOT_ENVELOPE") {
          return {
            pageId: "page",
            frameId: "main",
            snapshotId: "page:0",
            capturedAt: "2025-01-01T00:00:00.000Z",
            viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
            source: "visual" as const,
          };
        }
        return undefined;
      }
    );

    const response = await handleCaptureRegion({
      requestId: "test-error-propagation-off-screen",
      action: "capture_region",
      payload: {
        tabId: 1,
        anchorKey: "off_screen_element",
        padding: 8,
        quality: 70,
      },
    });

    expect(response.success).toBe(true);
    expect((response.data as Record<string, unknown>)["success"]).toBe(false);
    expect((response.data as Record<string, unknown>)["error"]).toBe("element-off-screen");
  });

  /**
   * Verify that the error code propagation works correctly through the full chain:
   * handleCaptureRegion → toCapturePayload → executeCaptureRegion → resolvePaddedBounds
   */
  it("error code is preserved through the full handleCaptureRegion chain", async () => {
    const { handleCaptureRegion } = await import("../src/relay-capture-handler.js");

    (chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockImplementation(
      async (_tabId: number, message: unknown) => {
        if ((message as Record<string, unknown>)["type"] === "RESOLVE_ANCHOR_BOUNDS") {
          return { error: "element-not-found" };
        }
        if ((message as Record<string, unknown>)["type"] === "CAPTURE_SNAPSHOT_ENVELOPE") {
          return {
            pageId: "page",
            frameId: "main",
            snapshotId: "page:0",
            capturedAt: "2025-01-01T00:00:00.000Z",
            viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
            source: "visual" as const,
          };
        }
        return undefined;
      }
    );

    const response = await handleCaptureRegion({
      requestId: "test-error-full-chain",
      action: "capture_region",
      payload: {
        tabId: 42, // non-active tab
        anchorKey: "element_x",
        redactPatterns: ["pattern"], // also verify redactPatterns is preserved
        padding: 8,
        quality: 70,
      },
    });

    expect(response.success).toBe(true);
    expect((response.data as Record<string, unknown>)["success"]).toBe(false);
    expect((response.data as Record<string, unknown>)["error"]).toBe("element-not-found");
  });
});
