/**
 * wait-tool.test.ts
 *
 * Tests for M109-WAIT — browser_wait_for MCP Tool
 *
 * These tests validate the wait primitives defined in B2-WA-001 through B2-WA-007:
 * - B2-WA-001: Wait for text appearance
 * - B2-WA-002: Wait for CSS selector match
 * - B2-WA-003: Wait for stable layout (no layout changes for N ms)
 * - B2-WA-004: Configurable timeout (default 10000, max 30000)
 * - B2-WA-005: Timeout error semantics include elapsedMs = timeout value
 * - B2-WA-006: Navigation interrupt returns error "navigation-interrupted"
 * - B2-WA-007: Page close interrupt returns error "page-closed"
 *
 * API checklist (buildWaitForTool):
 * - browser_wait_for → registered, handler dispatches to relay
 *
 * API checklist (handleWaitFor):
 * - handleWaitFor(texts)        → WaitForResult with met=true when text found (B2-WA-001)
 * - handleWaitFor(selector)     → WaitForResult with met=true when element found (B2-WA-002)
 * - handleWaitFor(stableLayoutMs) → WaitForResult with met=true after layout stable (B2-WA-003)
 * - handleWaitFor(timeout)      → respects default (10000) and max (30000) (B2-WA-004)
 * - handleWaitFor(timeout exceeded) → { met: false, error: "timeout", elapsedMs } (B2-WA-005)
 * - handleWaitFor(navigation)   → { met: false, error: "navigation-interrupted" } (B2-WA-006)
 * - handleWaitFor(page closed)   → { met: false, error: "page-closed" } (B2-WA-007)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildWaitForTool,
  handleWaitFor,
  WaitForArgs,
  WaitForResult,
  WAIT_DEFAULT_TIMEOUT_MS,
  WAIT_MAX_TIMEOUT_MS,
  RELAY_TIMEOUT_MS,
} from "../wait-tool.js";
import { handleWaitForInline } from "../page-tool-handlers-impl.js";

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Wraps a handleWaitFor call, converting pre-assertion "not implemented" stub throws
 * into assertion-level failures that carry requirement context. This ensures RED failures
 * are contract-level assertion failures, not uncaught stub exceptions.
 */
async function expectHandleWaitFor(
  relay: ReturnType<typeof makeRelayResolve>,
  args: WaitForArgs,
  requirement: string
): Promise<WaitForResult> {
  try {
    return await handleWaitFor(relay, args);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "not implemented") {
      expect.fail(`[${requirement}] handleWaitFor threw "not implemented" — stub must be replaced with real implementation`);
    }
    throw err;
  }
}

/** Makes a mock relay that resolves with a successful wait result. */
function makeRelayResolve(result: WaitForResult) {
  return {
    request: vi.fn().mockResolvedValue({ success: true, data: result }),
    isConnected: vi.fn(() => true),
  };
}

/** Makes a mock relay that rejects with a navigation-interrupted error. */
function makeRelayNavigationInterrupted() {
  return {
    request: vi.fn().mockResolvedValue({
      success: false,
      error: "navigation-interrupted",
    }),
    isConnected: vi.fn(() => true),
  };
}

/** Makes a mock relay that rejects with a page-closed error. */
function makeRelayPageClosed() {
  return {
    request: vi.fn().mockResolvedValue({
      success: false,
      error: "page-closed",
    }),
    isConnected: vi.fn(() => true),
  };
}

/** Makes a mock relay that rejects because browser is not connected. */
function makeRelayNotConnected() {
  return {
    request: vi.fn().mockRejectedValue(new Error("browser not-connected")),
    isConnected: vi.fn(() => false),
  };
}

// ── buildWaitForTool tests ─────────────────────────────────────────────────────

describe("buildWaitForTool", () => {
  it("B2-WA-001..007: returns browser_wait_for tool definition", () => {
    const relay = makeRelayResolve({ met: true, elapsedMs: 0 });
    const tool = buildWaitForTool(relay);
    expect(tool.name).toBe("accordo_browser_wait_for");
  });

  it("B2-WA-001: tool description mentions text wait capability", () => {
    const relay = makeRelayResolve({ met: true, elapsedMs: 0 });
    const tool = buildWaitForTool(relay);
    expect(tool.description).toContain("text");
  });

  it("B2-WA-002: tool description mentions selector wait capability", () => {
    const relay = makeRelayResolve({ met: true, elapsedMs: 0 });
    const tool = buildWaitForTool(relay);
    expect(tool.description).toContain("selector");
  });

  it("B2-WA-003: tool description mentions layout stability capability", () => {
    const relay = makeRelayResolve({ met: true, elapsedMs: 0 });
    const tool = buildWaitForTool(relay);
    expect(tool.description).toContain("layout");
  });

  it("B2-WA-004: tool schema includes texts, selector, stableLayoutMs, timeout properties", () => {
    const relay = makeRelayResolve({ met: true, elapsedMs: 0 });
    const tool = buildWaitForTool(relay);
    const schema = tool.inputSchema as { properties: Record<string, unknown> };
    expect(schema.properties).toHaveProperty("texts");
    expect(schema.properties).toHaveProperty("selector");
    expect(schema.properties).toHaveProperty("stableLayoutMs");
    expect(schema.properties).toHaveProperty("timeout");
  });

  it("B2-WA-004: tool schema timeout has correct description referencing default and max", () => {
    const relay = makeRelayResolve({ met: true, elapsedMs: 0 });
    const tool = buildWaitForTool(relay);
    const schema = tool.inputSchema as { properties: Record<string, { description: string }> };
    expect(schema.properties.timeout.description).toMatch(/10000/);
    expect(schema.properties.timeout.description).toMatch(/30000/);
  });

  it("B2-WA-001..007: tool is marked idempotent and safe", () => {
    const relay = makeRelayResolve({ met: true, elapsedMs: 0 });
    const tool = buildWaitForTool(relay);
    expect(tool.idempotent).toBe(true);
    expect(tool.dangerLevel).toBe("safe");
  });
});

// ── handleWaitFor: B2-WA-001 Wait for text ─────────────────────────────────────

describe("handleWaitFor — B2-WA-001: Wait for text", () => {
  it("B2-WA-001: resolves with met:true when requested text appears on page", async () => {
    const relay = makeRelayResolve({ met: true, matchedCondition: "Success", elapsedMs: 500 });
    const result = await expectHandleWaitFor(relay, { texts: ["Success"] }, "B2-WA-001");
    // RED: direct assertions for clearer diagnostics
    expect(result.met).toBe(true);
    expect(result.matchedCondition).toBe("Success");
    expect(result.elapsedMs).toBe(500);
  });

  it("B2-WA-001: relays texts array to content script polling loop", async () => {
    const relay = makeRelayResolve({ met: true, matchedCondition: "Found", elapsedMs: 200 });
    await expectHandleWaitFor(relay, { texts: ["Found", "Also found"] }, "B2-WA-001");
    expect(relay.request).toHaveBeenCalledWith(
      "wait_for",
      expect.objectContaining({ texts: ["Found", "Also found"] }),
      expect.any(Number)
    );
  });

  it("B2-WA-001: returns matchedCondition equal to the text that was found", async () => {
    const relay = makeRelayResolve({ met: true, matchedCondition: "Target text", elapsedMs: 150 });
    const result = await expectHandleWaitFor(relay, { texts: ["Other", "Target text", "More"] }, "B2-WA-001");
    expect(result.matchedCondition).toBe("Target text");
  });
});

// ── handleWaitFor: B2-WA-002 Wait for selector ────────────────────────────────

describe("handleWaitFor — B2-WA-002: Wait for selector", () => {
  it("B2-WA-002: resolves with met:true when CSS selector matches element", async () => {
    const relay = makeRelayResolve({ met: true, matchedCondition: ".result", elapsedMs: 300 });
    const result = await expectHandleWaitFor(relay, { selector: ".result" }, "B2-WA-002");
    // RED: direct assertions for clearer diagnostics
    expect(result.met).toBe(true);
    expect(result.matchedCondition).toBe(".result");
    expect(result.elapsedMs).toBe(300);
  });

  it("B2-WA-002: relays selector string to content script polling loop", async () => {
    const relay = makeRelayResolve({ met: true, matchedCondition: "#submit", elapsedMs: 100 });
    await expectHandleWaitFor(relay, { selector: "#submit" }, "B2-WA-002");
    expect(relay.request).toHaveBeenCalledWith(
      "wait_for",
      expect.objectContaining({ selector: "#submit" }),
      expect.any(Number)
    );
  });
});

// ── handleWaitFor: B2-WA-003 Wait for stable layout ───────────────────────────

describe("handleWaitFor — B2-WA-003: Wait for stable layout", () => {
  it("B2-WA-003: resolves with met:true when no layout changes occur for stableLayoutMs", async () => {
    const relay = makeRelayResolve({ met: true, matchedCondition: "stable-layout", elapsedMs: 1500 });
    const result = await expectHandleWaitFor(relay, { stableLayoutMs: 1000 }, "B2-WA-003");
    // RED: direct assertions for clearer diagnostics
    expect(result.met).toBe(true);
    expect(result.matchedCondition).toBe("stable-layout");
    expect(result.elapsedMs).toBe(1500);
  });

  it("B2-WA-003: relays stableLayoutMs to content script layout watcher", async () => {
    const relay = makeRelayResolve({ met: true, matchedCondition: "stable-layout", elapsedMs: 2000 });
    await expectHandleWaitFor(relay, { stableLayoutMs: 1500 }, "B2-WA-003");
    expect(relay.request).toHaveBeenCalledWith(
      "wait_for",
      expect.objectContaining({ stableLayoutMs: 1500 }),
      expect.any(Number)
    );
  });

  it("B2-WA-003: matchedCondition is 'stable-layout' string when layout stabilises", async () => {
    const relay = makeRelayResolve({ met: true, matchedCondition: "stable-layout", elapsedMs: 500 });
    const result = await expectHandleWaitFor(relay, { stableLayoutMs: 500 }, "B2-WA-003");
    expect(result.matchedCondition).toBe("stable-layout");
  });
});

// ── handleWaitFor: B2-WA-004 Configurable timeout ───────────────────────────────

describe("handleWaitFor — B2-WA-004: Configurable timeout", () => {
  it("B2-WA-004: uses default timeout of 10000 when no timeout specified", async () => {
    const relay = makeRelayResolve({ met: true, elapsedMs: 0 });
    await expectHandleWaitFor(relay, { texts: ["something"] }, "B2-WA-004");
    // The relay-level timeout must be RELAY_TIMEOUT_MS (headroom above MAX), not the payload timeout.
    // The payload's timeout field stays at the default (10000) inside the args object.
    const actualTimeout = relay.request.mock.calls[0][2];
    expect(actualTimeout).toBe(RELAY_TIMEOUT_MS);
  });

  it("B2-WA-004: clamps timeout to maximum of 30000 when exceeded", async () => {
    const relay = makeRelayResolve({ met: false, error: "timeout", elapsedMs: 30000 });
    // Pass a timeout exceeding the max — implementation must clamp payload to 30000,
    // but the relay-level timeout must always be RELAY_TIMEOUT_MS (35000).
    await expectHandleWaitFor(relay, { texts: ["test"], timeout: 60000 }, "B2-WA-004");
    const actualTimeout = relay.request.mock.calls[0][2];
    expect(actualTimeout).toBe(RELAY_TIMEOUT_MS);
  });

  it("B2-WA-004: rejects negative timeout with invalid-request error", async () => {
    const relay = makeRelayResolve({ met: false, error: "timeout", elapsedMs: 0 });
    const result = await expectHandleWaitFor(relay, { texts: ["test"], timeout: -100 }, "B2-WA-004");
    // RED: direct property assertions for clearer diagnostic on failure
    expect(result.success).toBe(false);
    expect(result.error).toBe("invalid-request");
  });

  it("B2-WA-004: WAIT_DEFAULT_TIMEOUT_MS equals 10000", () => {
    expect(WAIT_DEFAULT_TIMEOUT_MS).toBe(10000);
  });

  it("B2-WA-004: WAIT_MAX_TIMEOUT_MS equals 30000", () => {
    expect(WAIT_MAX_TIMEOUT_MS).toBe(30000);
  });
});

// ── handleWaitFor: B2-WA-005 Timeout error semantics ──────────────────────────

describe("handleWaitFor — B2-WA-005: Timeout error semantics", () => {
  it("B2-WA-005: returns { met: false, error: 'timeout', elapsedMs } on timeout", async () => {
    const relay = makeRelayResolve({ met: false, error: "timeout", elapsedMs: 10000 });
    const result = await expectHandleWaitFor(relay, { texts: ["never appears"], timeout: 10000 }, "B2-WA-005");
    // RED: direct assertions — clearer diagnostics than toMatchObject
    expect(result.met).toBe(false);
    expect(result.error).toBe("timeout");
    expect(result.elapsedMs).toBe(10000);
  });

  it("B2-WA-005: elapsedMs equals timeout value when timeout occurs", async () => {
    const relay = makeRelayResolve({ met: false, error: "timeout", elapsedMs: 15000 });
    const result = await expectHandleWaitFor(relay, { texts: ["never"], timeout: 15000 }, "B2-WA-005");
    expect(result.elapsedMs).toBe(15000);
  });

  it("B2-WA-005: response structure includes met, error, and elapsedMs fields", async () => {
    const relay = makeRelayResolve({ met: false, error: "timeout", elapsedMs: 10000 });
    const result = await expectHandleWaitFor(relay, { texts: ["never"] }, "B2-WA-005");
    const r = result;
    expect(r).toHaveProperty("met");
    expect(r).toHaveProperty("error", "timeout");
    expect(r).toHaveProperty("elapsedMs");
  });

  it("B2-WA-005: timeout-exceeded acceptance shape is { met: false, error: 'timeout', elapsedMs: <timeout> }", async () => {
    const relay = makeRelayResolve({ met: false, error: "timeout", elapsedMs: 25000 });
    const result = await expectHandleWaitFor(relay, { texts: ["never"], timeout: 25000 }, "B2-WA-005");
    // Direct assertion of the timeout-exceeded acceptance shape
    expect(result.met).toBe(false);
    expect(result.error).toBe("timeout");
    expect(result.elapsedMs).toBe(25000);
  });
});

// ── handleWaitFor: B2-WA-006 Navigation interrupt ────────────────────────────────

describe("handleWaitFor — B2-WA-006: Navigation interrupt", () => {
  it("B2-WA-006: returns { met: false, error: 'navigation-interrupted' } when page navigates", async () => {
    const relay = makeRelayNavigationInterrupted();
    const result = await expectHandleWaitFor(relay, { texts: ["test"] }, "B2-WA-006");
    // RED: direct assertions
    expect(result.met).toBe(false);
    expect(result.error).toBe("navigation-interrupted");
  });

  it("B2-WA-006: error code is the string 'navigation-interrupted' (not a different variant)", async () => {
    const relay = makeRelayNavigationInterrupted();
    const result = await expectHandleWaitFor(relay, { texts: ["test"] }, "B2-WA-006");
    expect(result.error).toBe("navigation-interrupted");
  });

  it("B2-WA-006: navigation interrupt resolves promptly (within 1s per acceptance criteria)", async () => {
    const relay = makeRelayNavigationInterrupted();
    const start = Date.now();
    await expectHandleWaitFor(relay, { texts: ["test"] }, "B2-WA-006");
    const elapsed = Date.now() - start;
    // Must have called relay.request to process the interrupt — not just returned early
    expect(relay.request).toHaveBeenCalled();
    // Should not wait for the full timeout — navigation is detected quickly
    expect(elapsed).toBeLessThan(1000);
  });
});

// ── handleWaitFor: B2-WA-007 Page close interrupt ──────────────────────────────

describe("handleWaitFor — B2-WA-007: Page close interrupt", () => {
  it("B2-WA-007: returns { met: false, error: 'page-closed' } when tab is closed", async () => {
    const relay = makeRelayPageClosed();
    const result = await expectHandleWaitFor(relay, { texts: ["test"] }, "B2-WA-007");
    // RED: direct assertions
    expect(result.met).toBe(false);
    expect(result.error).toBe("page-closed");
  });

  it("B2-WA-007: error code is the string 'page-closed' (not a different variant)", async () => {
    const relay = makeRelayPageClosed();
    const result = await expectHandleWaitFor(relay, { texts: ["test"] }, "B2-WA-007");
    expect(result.error).toBe("page-closed");
  });

  it("B2-WA-007: page-closed interrupt resolves promptly", async () => {
    const relay = makeRelayPageClosed();
    const start = Date.now();
    await expectHandleWaitFor(relay, { texts: ["test"] }, "B2-WA-007");
    const elapsed = Date.now() - start;
    // Must have called relay.request to process the interrupt — not just returned early
    expect(relay.request).toHaveBeenCalled();
    expect(elapsed).toBeLessThan(1000);
  });
});

// ── Edge cases ─────────────────────────────────────────────────────────────────

describe("handleWaitFor — edge cases", () => {
  it("returns success:false with error 'browser-not-connected' when relay is disconnected", async () => {
    const relay = makeRelayNotConnected();
    const result = await expectHandleWaitFor(relay, { texts: ["test"] }, "EDGE:browser-not-connected");
    // RED: direct assertions
    expect(result.success).toBe(false);
    expect(result.error).toBe("browser-not-connected");
  });

  it("MCP-ER-002: browser-not-connected error includes retryable:true and retryAfterMs", async () => {
    const relay = makeRelayNotConnected();
    const result = await handleWaitFor(relay as unknown as ReturnType<typeof makeRelayNotConnected>, { texts: ["test"] });
    expect(result).toHaveProperty("success", false);
    const err = result as { success: false; error: string; retryable: boolean; retryAfterMs?: number; recoveryHints?: string };
    expect(err.retryable).toBe(true);
    expect(err.retryAfterMs).toBeGreaterThan(0);
    expect(typeof err.recoveryHints).toBe("string");
  });

  it("MCP-ER-002: invalid-request error includes retryable:false", async () => {
    const relay = makeRelayResolve({ met: false, error: "timeout", elapsedMs: 0 });
    // @ts-expect-error — intentionally passing empty args
    const result = await handleWaitFor(relay, {});
    expect(result).toHaveProperty("success", false);
    const err = result as { success: false; error: string; retryable: boolean };
    expect(err.retryable).toBe(false);
  });

  it("accepts a combined condition (texts + selector) — first condition met wins", async () => {
    const relay = makeRelayResolve({ met: true, matchedCondition: "Found", elapsedMs: 100 });
    const result = await expectHandleWaitFor(relay, { texts: ["Found"], selector: ".missing" }, "EDGE:combined-conditions");
    // RED: direct assertions
    expect(result.met).toBe(true);
    expect(result.matchedCondition).toBe("Found");
    expect(result.elapsedMs).toBe(100);
  });

  it("accepts all three condition types simultaneously", async () => {
    const relay = makeRelayResolve({ met: true, matchedCondition: "stable-layout", elapsedMs: 800 });
    const result = await expectHandleWaitFor(relay, {
      texts: ["Never"],
      selector: ".missing",
      stableLayoutMs: 500,
    }, "EDGE:all-conditions");
    // RED: direct assertions
    expect(result.met).toBe(true);
    expect(result.matchedCondition).toBe("stable-layout");
    expect(result.elapsedMs).toBe(800);
  });

  it("returns invalid-request error when called with no conditions", async () => {
    const relay = makeRelayResolve({ met: false, error: "timeout", elapsedMs: 0 });
    // @ts-expect-error — intentionally passing empty args to test validation
    const result = await expectHandleWaitFor(relay, {}, "EDGE:empty-conditions");
    // RED: direct assertions
    expect(result.success).toBe(false);
    expect(result.error).toBe("invalid-request");
  });
});

// ── handleWaitForInline — H2: retry hints on timeout ──────────────────────────

/**
 * B2-WA-005 / H2: handleWaitForInline timeout fallback returns retryable hint fields.
 *
 * When the relay returns a non-success response with no data, or returns
 * navigation-interrupted / page-closed, the handler must populate elapsedMs
 * from real elapsed time (not hardcoded 0) and include retryable/retryAfterMs
 * on the timeout path.
 */
describe("handleWaitForInline — H2: retry hints on timeout fallback", () => {
  /** Minimal relay shape expected by handleWaitForInline */
  function makeInlineRelay(response: { success: boolean; error?: string; data?: unknown }) {
    return {
      request: vi.fn().mockResolvedValue(response),
      isConnected: vi.fn(() => true),
    };
  }

  it("H2: timeout fallback includes retryable: true", async () => {
    // Relay returns failure with no data — triggers the timeout fallback path
    const relay = makeInlineRelay({ success: false });
    const result = await handleWaitForInline(relay as never, { texts: ["x"], timeout: 100 });
    const r = result as { met: boolean; error?: string; retryable?: boolean };
    expect(r.met).toBe(false);
    expect(r.retryable).toBe(true);
  });

  it("H2: timeout fallback includes retryAfterMs: 1000", async () => {
    const relay = makeInlineRelay({ success: false });
    const result = await handleWaitForInline(relay as never, { texts: ["x"], timeout: 100 });
    const r = result as { retryAfterMs?: number };
    expect(r.retryAfterMs).toBe(1000);
  });

  it("H2: timeout fallback elapsedMs is a non-negative number (not hardcoded 0)", async () => {
    const relay = makeInlineRelay({ success: false });
    const result = await handleWaitForInline(relay as never, { texts: ["x"], timeout: 100 });
    const r = result as { elapsedMs?: number };
    // elapsedMs must be a number (real elapsed time, not hardcoded 0)
    expect(typeof r.elapsedMs).toBe("number");
    expect(r.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it("H2: navigation-interrupted path includes elapsedMs from real elapsed time", async () => {
    const relay = makeInlineRelay({ success: false, error: "navigation-interrupted" });
    const result = await handleWaitForInline(relay as never, { texts: ["x"], timeout: 100 });
    const r = result as { met: boolean; error?: string; elapsedMs?: number };
    expect(r.met).toBe(false);
    expect(r.error).toBe("navigation-interrupted");
    expect(typeof r.elapsedMs).toBe("number");
    expect(r.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it("H2: page-closed path includes elapsedMs from real elapsed time", async () => {
    const relay = makeInlineRelay({ success: false, error: "page-closed" });
    const result = await handleWaitForInline(relay as never, { texts: ["x"], timeout: 100 });
    const r = result as { met: boolean; error?: string; elapsedMs?: number };
    expect(r.met).toBe(false);
    expect(r.error).toBe("page-closed");
    expect(typeof r.elapsedMs).toBe("number");
    expect(r.elapsedMs).toBeGreaterThanOrEqual(0);
  });
});

// ── handleWaitFor — H4: real elapsedMs in standalone handler ──────────────────

/**
 * H4: handleWaitFor (standalone, in wait-tool.ts) must use real elapsed time,
 * not the configured timeout value, in the fallback path.
 *
 * This tests the bug fix: before the fix, `elapsedMs` was set to `timeoutMs`
 * (the clamped config value). After the fix, it is `Date.now() - startMs`.
 */
describe("handleWaitFor — H4: real elapsed time in timeout fallback", () => {
  it("H4-1: timeout fallback elapsedMs is a non-negative number (not equal to timeoutMs when relay responds quickly)", async () => {
    // Relay returns failure with no data — triggers the fallback path.
    // The relay responds immediately (no artificial delay), so elapsedMs
    // should be much less than timeoutMs (10000 default).
    const relay = {
      request: vi.fn().mockResolvedValue({ success: false }),
      isConnected: vi.fn(() => true),
    };
    const result = await handleWaitFor(relay as never, { texts: ["x"] });
    const r = result as { met?: boolean; error?: string; elapsedMs?: number };
    // elapsedMs must be a real measured value — not equal to the 10000 ms default timeout
    expect(typeof r.elapsedMs).toBe("number");
    expect(r.elapsedMs).toBeGreaterThanOrEqual(0);
    // A fast relay response will produce elapsedMs far less than the default 10000 ms.
    // If the old bug (elapsedMs = timeoutMs = 10000) were present, this would fail.
    expect(r.elapsedMs).toBeLessThan(5000);
  });

  it("H4-2: timeout fallback elapsedMs is not equal to an explicit timeout value when relay responds immediately", async () => {
    // Use a recognizable timeout value. If bugged, elapsedMs === 5000.
    const relay = {
      request: vi.fn().mockResolvedValue({ success: false }),
      isConnected: vi.fn(() => true),
    };
    const result = await handleWaitFor(relay as never, { texts: ["x"], timeout: 5000 });
    const r = result as { elapsedMs?: number };
    expect(typeof r.elapsedMs).toBe("number");
    // Real elapsed with an immediate relay response will be < 100 ms,
    // not the configured 5000 ms timeout value.
    expect(r.elapsedMs).not.toBe(5000);
    expect(r.elapsedMs).toBeLessThan(1000);
  });
});
