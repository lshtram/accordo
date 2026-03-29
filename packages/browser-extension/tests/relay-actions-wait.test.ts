/**
 * relay-actions-wait.test.ts
 *
 * Tests for M109-WAIT — wait_for relay action routing at the handleRelayAction boundary.
 *
 * Gap addressed: proves that handleRelayAction({ action: "wait_for" }) correctly
 * routes to the content wait provider (handleWaitForAction) and handles all relevant
 * success and error paths.
 *
 * Covers:
 * - B2-WA-RT-01: wait_for is routable via handleRelayAction (RelayAction union)
 * - B2-WA-RT-02: SW context — success path forwards to content script and returns
 *                the WaitResult from the content wait provider (handleWaitForAction)
 * - B2-WA-RT-03: SW context — action-failed when no active tab is found
 * - B2-WA-RT-04: SW context — action-failed when content script returns a generic error
 * - B2-WA-RT-05: SW context — success:true propagated for navigation-interrupted
 *                (expected termination, not an error from the relay's perspective)
 * - B2-WA-RT-06: SW context — success:true propagated for page-closed
 * - B2-WA-RT-07: Content-script context (document defined) — unsupported path
 *                throws and relay returns action-failed
 * - B2-WA-RT-08: SW context — tabs.sendMessage is called with
 *                PAGE_UNDERSTANDING_ACTION / wait_for and the original payload
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resetChromeMocks } from "./setup/chrome-mock.js";
import { handleRelayAction } from "../src/relay-actions.js";
import type { RelayAction } from "../src/relay-actions.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Simulate service worker context by removing the global document. */
function hideDocument(): typeof globalThis.document {
  const saved = globalThis.document;
  // @ts-expect-error — intentionally simulate SW environment
  globalThis.document = undefined;
  return saved;
}

// ── Union type test ───────────────────────────────────────────────────────────

describe("M109-WAIT relay action union", () => {
  /**
   * B2-WA-RT-01: wait_for must be part of the RelayAction union so that the
   * compiler accepts it as a valid action and the router's switch reaches the
   * wait_for case without falling through to the default branch.
   */
  it("B2-WA-RT-01: RelayAction union includes 'wait_for'", () => {
    const action: RelayAction = "wait_for";
    expect(action).toBe("wait_for");
  });
});

// ── Service worker context (document === undefined) ───────────────────────────

describe("M109-WAIT — wait_for routing in service worker context", () => {
  let savedDocument: typeof globalThis.document;

  beforeEach(() => {
    resetChromeMocks();
    savedDocument = hideDocument();
  });

  afterEach(() => {
    globalThis.document = savedDocument;
  });

  /**
   * B2-WA-RT-02: Success path — content script returns a met=true WaitResult.
   * The relay must forward the result under `data` with success:true and
   * preserve the requestId.
   */
  it("B2-WA-RT-02: success path — forwards to content script and returns WaitResult", async () => {
    const fakeResult = { met: true, matchedCondition: "Hello world", elapsedMs: 120 };

    (chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: fakeResult,
    });
    (chrome.tabs.query as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 7, url: "https://example.com/", active: true },
    ]);

    const response = await handleRelayAction({
      requestId: "req-wait-ok",
      action: "wait_for",
      payload: { texts: ["Hello world"], timeout: 5_000 },
    });

    expect(response.requestId).toBe("req-wait-ok");
    expect(response.success).toBe(true);
    expect(response.error).toBeUndefined();

    const data = response.data as { met: boolean; matchedCondition: string; elapsedMs: number };
    expect(data.met).toBe(true);
    expect(data.matchedCondition).toBe("Hello world");
    expect(data.elapsedMs).toBe(120);
  });

  /**
   * B2-WA-RT-08: The relay must call chrome.tabs.sendMessage with the
   * PAGE_UNDERSTANDING_ACTION message type, action "wait_for", and the
   * original payload unchanged.
   */
  it("B2-WA-RT-08: relay calls tabs.sendMessage with PAGE_UNDERSTANDING_ACTION/wait_for", async () => {
    const payload = { texts: ["Loaded"], timeout: 3_000 };
    const fakeResult = { met: true, matchedCondition: "Loaded", elapsedMs: 80 };

    (chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: fakeResult,
    });
    (chrome.tabs.query as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 3, url: "https://example.com/", active: true },
    ]);

    await handleRelayAction({
      requestId: "req-wait-msg",
      action: "wait_for",
      payload,
    });

    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
      3,
      expect.objectContaining({
        type: "PAGE_UNDERSTANDING_ACTION",
        action: "wait_for",
        payload,
      }),
    );
  });

  /**
   * B2-WA-RT-03: No active tab — relay must return success:false, error:"action-failed".
   */
  it("B2-WA-RT-03: returns action-failed when no active tab is found", async () => {
    (chrome.tabs.query as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const response = await handleRelayAction({
      requestId: "req-wait-notab",
      action: "wait_for",
      payload: { texts: ["Ready"] },
    });

    expect(response.requestId).toBe("req-wait-notab");
    expect(response.success).toBe(false);
    expect(response.error).toBe("action-failed");
  });

  /**
   * B2-WA-RT-04: Content script returns a generic error object (no specific
   * error code). Relay must return success:false, error:"action-failed".
   */
  it("B2-WA-RT-04: returns action-failed when content script returns a generic error", async () => {
    (chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
      error: "some-unknown-error",
    });
    (chrome.tabs.query as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 2, url: "https://example.com/", active: true },
    ]);

    const response = await handleRelayAction({
      requestId: "req-wait-err",
      action: "wait_for",
      payload: { selector: ".button" },
    });

    expect(response.requestId).toBe("req-wait-err");
    expect(response.success).toBe(false);
    expect(response.error).toBe("action-failed");
  });

  /**
   * B2-WA-RT-05: Content script returns navigation-interrupted (B2-WA-006).
   * The relay treats this as a successful termination — success:true with the
   * raw response forwarded in data, so callers can inspect the error field.
   */
  it("B2-WA-RT-05: propagates navigation-interrupted as success:true with data", async () => {
    const navInterrupted = { met: false, error: "navigation-interrupted", elapsedMs: 450 };

    (chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue(navInterrupted);
    (chrome.tabs.query as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 4, url: "https://example.com/", active: true },
    ]);

    const response = await handleRelayAction({
      requestId: "req-wait-nav",
      action: "wait_for",
      payload: { texts: ["NeverShown"] },
    });

    expect(response.requestId).toBe("req-wait-nav");
    expect(response.success).toBe(true);

    const data = response.data as { met: boolean; error: string; elapsedMs: number };
    expect(data.met).toBe(false);
    expect(data.error).toBe("navigation-interrupted");
  });

  /**
   * B2-WA-RT-06: Content script returns page-closed (B2-WA-007).
   * Same treatment as navigation-interrupted: success:true with the raw response
   * in data so callers can detect the interruption condition.
   */
  it("B2-WA-RT-06: propagates page-closed as success:true with data", async () => {
    const pageClosed = { met: false, error: "page-closed", elapsedMs: 200 };

    (chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockResolvedValue(pageClosed);
    (chrome.tabs.query as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 5, url: "https://example.com/", active: true },
    ]);

    const response = await handleRelayAction({
      requestId: "req-wait-closed",
      action: "wait_for",
      payload: { selector: ".done" },
    });

    expect(response.requestId).toBe("req-wait-closed");
    expect(response.success).toBe(true);

    const data = response.data as { met: boolean; error: string; elapsedMs: number };
    expect(data.met).toBe(false);
    expect(data.error).toBe("page-closed");
  });
});

// ── Content-script / jsdom context (document defined) ────────────────────────

describe("M109-WAIT — wait_for routing in content-script context (document defined)", () => {
  beforeEach(() => {
    resetChromeMocks();
  });

  /**
   * B2-WA-RT-07: In jsdom / content-script context (document is defined),
   * the wait_for case is not yet implemented and throws synchronously.
   * The outer try/catch in handleRelayAction must convert that into a
   * structured action-failed response rather than an unhandled rejection.
   */
  it("B2-WA-RT-07: returns action-failed when called in content-script context (not implemented)", async () => {
    // document is available in jsdom — the wait_for branch throws "not implemented"
    expect(globalThis.document).toBeDefined();

    const response = await handleRelayAction({
      requestId: "req-wait-jsdom",
      action: "wait_for",
      payload: { texts: ["Hello"] },
    });

    expect(response.requestId).toBe("req-wait-jsdom");
    expect(response.success).toBe(false);
    expect(response.error).toBe("action-failed");
  });
});
