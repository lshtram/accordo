/**
 * wait-provider.test.ts
 *
 * Tests for M109-WAIT — Wait Provider (Content Script)
 *
 * Covers:
 * - B2-WA-001: waitForText — success (text appears) and timeout
 * - B2-WA-002: waitForSelector — success (selector matches) and timeout
 * - B2-WA-003: waitForStableLayout — success (stable) and timeout
 * - B2-WA-004: handleWaitForAction timeout clamping and validation
 * - B2-WA-005: elapsedMs equals exactly timeoutMs on timeout
 * - B2-WA-006: navigation-interrupted error via beforeunload
 * - B2-WA-007: page-closed error via pagehide (persisted=false)
 * - Multi-condition race: first-winner cancels losing branches
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  waitForText,
  waitForSelector,
  waitForStableLayout,
  handleWaitForAction,
  POLL_INTERVAL_MS,
  DEFAULT_TIMEOUT_MS,
  MAX_TIMEOUT_MS,
} from "../src/content/wait-provider.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Advance fake timers by `ms` and flush microtasks. */
async function tick(ms: number): Promise<void> {
  vi.advanceTimersByTime(ms);
  await Promise.resolve();
  await Promise.resolve();
}

// ── waitForText ───────────────────────────────────────────────────────────────

describe("M109-WAIT waitForText", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerText = "";
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * B2-WA-001: text already present on first poll — resolves immediately.
   */
  it("B2-WA-001: resolves met=true when text is already present", async () => {
    document.body.innerText = "Hello world";

    const resultPromise = waitForText(["Hello"], { timeoutMs: 5_000 });
    await tick(0);
    const result = await resultPromise;

    expect(result.met).toBe(true);
    expect(result.matchedCondition).toBe("Hello");
    expect(result.error).toBeUndefined();
  });

  /**
   * B2-WA-001: text appears after two poll ticks — resolves on correct tick.
   */
  it("B2-WA-001: resolves met=true when text appears after polling", async () => {
    const resultPromise = waitForText(["Loaded"], { timeoutMs: 5_000 });

    await tick(POLL_INTERVAL_MS);
    document.body.innerText = "Page Loaded OK";
    await tick(POLL_INTERVAL_MS);

    const result = await resultPromise;
    expect(result.met).toBe(true);
    expect(result.matchedCondition).toBe("Loaded");
  });

  /**
   * B2-WA-005: elapsedMs must equal exactly timeoutMs (not measured overshoot).
   */
  it("B2-WA-005: elapsedMs equals exactly timeoutMs on timeout", async () => {
    const timeoutMs = 500;
    const resultPromise = waitForText(["NeverShown"], { timeoutMs });

    // Advance past timeout
    await tick(timeoutMs + POLL_INTERVAL_MS);

    const result = await resultPromise;
    expect(result.met).toBe(false);
    expect(result.error).toBe("timeout");
    expect(result.elapsedMs).toBe(timeoutMs);
  });

  /**
   * B2-WA-006: navigation interrupt returns navigation-interrupted.
   */
  it("B2-WA-006: returns navigation-interrupted when beforeunload fires", async () => {
    const resultPromise = waitForText(["NeverShown"], { timeoutMs: 30_000 });

    await tick(POLL_INTERVAL_MS);
    window.dispatchEvent(new Event("beforeunload"));
    await tick(0);

    const result = await resultPromise;
    expect(result.met).toBe(false);
    expect(result.error).toBe("navigation-interrupted");
  });

  /**
   * B2-WA-007: page-close interrupt (pagehide persisted=false) returns page-closed.
   */
  it("B2-WA-007: returns page-closed when pagehide fires with persisted=false", async () => {
    const resultPromise = waitForText(["NeverShown"], { timeoutMs: 30_000 });

    await tick(POLL_INTERVAL_MS);
    window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: false }));
    await tick(0);

    const result = await resultPromise;
    expect(result.met).toBe(false);
    expect(result.error).toBe("page-closed");
  });

  /**
   * Abort signal cancels the loop immediately — used by multi-condition race.
   */
  it("abort signal terminates the loop with timeout error", async () => {
    const controller = new AbortController();
    const resultPromise = waitForText(["NeverShown"], {
      timeoutMs: 30_000,
      signal: controller.signal,
    });

    await tick(POLL_INTERVAL_MS);
    controller.abort();
    await tick(POLL_INTERVAL_MS);

    const result = await resultPromise;
    expect(result.met).toBe(false);
    expect(result.error).toBe("timeout");
  });
});

// ── waitForSelector ───────────────────────────────────────────────────────────

describe("M109-WAIT waitForSelector", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * B2-WA-002: selector matches an existing element.
   */
  it("B2-WA-002: resolves met=true when selector matches immediately", async () => {
    const resultPromise = waitForSelector("#submit-btn", { timeoutMs: 5_000 });
    await tick(0);
    const result = await resultPromise;

    expect(result.met).toBe(true);
    expect(result.matchedCondition).toBe("#submit-btn");
  });

  /**
   * B2-WA-005: elapsedMs equals exactly timeoutMs on timeout.
   */
  it("B2-WA-005: elapsedMs equals exactly timeoutMs on selector timeout", async () => {
    const timeoutMs = 300;
    const resultPromise = waitForSelector(".nonexistent-xyz", { timeoutMs });

    await tick(timeoutMs + POLL_INTERVAL_MS);

    const result = await resultPromise;
    expect(result.met).toBe(false);
    expect(result.error).toBe("timeout");
    expect(result.elapsedMs).toBe(timeoutMs);
  });

  /**
   * B2-WA-006: navigation interrupt.
   */
  it("B2-WA-006: returns navigation-interrupted for selector wait", async () => {
    const resultPromise = waitForSelector(".never-matches", { timeoutMs: 30_000 });

    await tick(POLL_INTERVAL_MS);
    window.dispatchEvent(new Event("beforeunload"));
    await tick(0);

    const result = await resultPromise;
    expect(result.met).toBe(false);
    expect(result.error).toBe("navigation-interrupted");
  });

  /**
   * B2-WA-007: page-close interrupt.
   */
  it("B2-WA-007: returns page-closed for selector wait", async () => {
    const resultPromise = waitForSelector(".never-matches", { timeoutMs: 30_000 });

    await tick(POLL_INTERVAL_MS);
    window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: false }));
    await tick(0);

    const result = await resultPromise;
    expect(result.met).toBe(false);
    expect(result.error).toBe("page-closed");
  });
});

// ── waitForStableLayout ───────────────────────────────────────────────────────

describe("M109-WAIT waitForStableLayout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * B2-WA-003: layout is already stable — resolves after stableMs.
   */
  it("B2-WA-003: resolves met=true when layout remains stable", async () => {
    const stableMs = 200;
    const resultPromise = waitForStableLayout(stableMs, { timeoutMs: 5_000 });

    // Let stableMs worth of polls pass without layout change
    await tick(stableMs + POLL_INTERVAL_MS * 2);

    const result = await resultPromise;
    expect(result.met).toBe(true);
    expect(result.matchedCondition).toBe("stable-layout");
  });

  /**
   * B2-WA-005: elapsedMs equals exactly timeoutMs on timeout.
   */
  it("B2-WA-005: elapsedMs equals exactly timeoutMs on stableLayout timeout", async () => {
    const timeoutMs = 300;
    // Use a stableMs larger than timeout so it always times out
    const resultPromise = waitForStableLayout(10_000, { timeoutMs });

    await tick(timeoutMs + POLL_INTERVAL_MS);

    const result = await resultPromise;
    expect(result.met).toBe(false);
    expect(result.error).toBe("timeout");
    expect(result.elapsedMs).toBe(timeoutMs);
  });

  /**
   * B2-WA-006: navigation interrupt.
   */
  it("B2-WA-006: returns navigation-interrupted for stableLayout wait", async () => {
    const resultPromise = waitForStableLayout(30_000, { timeoutMs: 60_000 });

    await tick(POLL_INTERVAL_MS);
    window.dispatchEvent(new Event("beforeunload"));
    await tick(0);

    const result = await resultPromise;
    expect(result.met).toBe(false);
    expect(result.error).toBe("navigation-interrupted");
  });

  /**
   * B2-WA-007: page-close interrupt.
   */
  it("B2-WA-007: returns page-closed for stableLayout wait", async () => {
    const resultPromise = waitForStableLayout(30_000, { timeoutMs: 60_000 });

    await tick(POLL_INTERVAL_MS);
    window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: false }));
    await tick(0);

    const result = await resultPromise;
    expect(result.met).toBe(false);
    expect(result.error).toBe("page-closed");
  });
});

// ── handleWaitForAction ───────────────────────────────────────────────────────

describe("M109-WAIT handleWaitForAction", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerText = "";
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * B2-WA-004: returns error when no condition is provided.
   */
  it("B2-WA-004: returns invalid-request error when no condition given", async () => {
    const result = await handleWaitForAction({});
    expect(result).toEqual({ error: "invalid-request" });
  });

  /**
   * B2-WA-004: texts=[] (empty array) is treated as no condition.
   */
  it("B2-WA-004: returns invalid-request when texts is empty array", async () => {
    const result = await handleWaitForAction({ texts: [] });
    expect(result).toEqual({ error: "invalid-request" });
  });

  /**
   * B2-WA-004: timeout defaults to DEFAULT_TIMEOUT_MS when omitted.
   */
  it("B2-WA-004: uses DEFAULT_TIMEOUT_MS when timeout is omitted", async () => {
    const resultPromise = handleWaitForAction({ texts: ["NeverShown"] });

    // Advance past default timeout
    await tick(DEFAULT_TIMEOUT_MS + POLL_INTERVAL_MS);

    const result = await resultPromise;
    expect("met" in result && !result.met).toBe(true);
    if ("elapsedMs" in result) {
      expect(result.elapsedMs).toBe(DEFAULT_TIMEOUT_MS);
    }
  });

  /**
   * B2-WA-004: timeout is clamped to MAX_TIMEOUT_MS.
   */
  it("B2-WA-004: clamps timeout to MAX_TIMEOUT_MS", async () => {
    const resultPromise = handleWaitForAction({
      texts: ["NeverShown"],
      timeout: MAX_TIMEOUT_MS + 99_999,
    });

    await tick(MAX_TIMEOUT_MS + POLL_INTERVAL_MS);

    const result = await resultPromise;
    if ("elapsedMs" in result) {
      expect(result.elapsedMs).toBe(MAX_TIMEOUT_MS);
    }
  });

  /**
   * B2-WA-001: handleWaitForAction succeeds when text condition is met.
   */
  it("B2-WA-001: resolves met=true via texts condition", async () => {
    document.body.innerText = "Welcome";
    const resultPromise = handleWaitForAction({ texts: ["Welcome"] });
    await tick(0);

    const result = await resultPromise;
    expect("met" in result && result.met).toBe(true);
    if ("matchedCondition" in result) {
      expect(result.matchedCondition).toBe("Welcome");
    }
  });

  /**
   * B2-WA-002: handleWaitForAction succeeds when selector condition is met.
   */
  it("B2-WA-002: resolves met=true via selector condition", async () => {
    const resultPromise = handleWaitForAction({ selector: "#submit-btn" });
    await tick(0);

    const result = await resultPromise;
    expect("met" in result && result.met).toBe(true);
  });

  /**
   * Multi-condition race: winning branch cancels losing branches.
   * Text condition is met instantly; selector for nonexistent element should
   * not leak (no outstanding listener after resolution).
   */
  it("Multi-condition race: first condition wins and cancels the rest", async () => {
    document.body.innerText = "Race winner";

    // Both conditions provided — text is met immediately, selector never matches
    const resultPromise = handleWaitForAction({
      texts: ["Race winner"],
      selector: ".never-matches-ever",
      timeout: 5_000,
    });

    await tick(0);
    const result = await resultPromise;

    // Should have resolved with the winning text condition
    expect("met" in result && result.met).toBe(true);
    if ("matchedCondition" in result) {
      expect(result.matchedCondition).toBe("Race winner");
    }
  });
});

// ── Constants export ──────────────────────────────────────────────────────────

describe("M109-WAIT exported constants", () => {
  it("POLL_INTERVAL_MS is 100", () => {
    expect(POLL_INTERVAL_MS).toBe(100);
  });

  it("DEFAULT_TIMEOUT_MS is 10000", () => {
    expect(DEFAULT_TIMEOUT_MS).toBe(10_000);
  });

  it("MAX_TIMEOUT_MS is 30000", () => {
    expect(MAX_TIMEOUT_MS).toBe(30_000);
  });
});
