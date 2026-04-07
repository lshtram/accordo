/**
 * Tests for disconnect-handler.ts
 * Requirements: adr-reload-reconnect.md §D1
 *
 * All tests are RED until DisconnectHandler is implemented —
 * the constructor throws "not implemented".
 *
 * API checklist:
 * ✓ DisconnectHandler constructor            [1 structural test]
 * ✓ startGraceTimer()                        [3 tests: DH-01, DH-03, DH-08]
 * ✓ cancelGraceTimer()                       [2 tests: DH-02, DH-04]
 * ✓ getState()                               [2 tests: DH-05, DH-06]
 * ✓ dispose()                                [1 test: DH-07]
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  DisconnectHandler,
  type DisconnectHandlerConfig,
  type DisconnectHandlerState,
} from "../disconnect-handler.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeConfig(overrides: Partial<DisconnectHandlerConfig> = {}): DisconnectHandlerConfig {
  return {
    graceWindowMs: 10_000,
    onGraceExpired: vi.fn(),
    log: vi.fn(),
    ...overrides,
  };
}

// ── DisconnectHandler — structural ────────────────────────────────────────────

describe("DisconnectHandler — structural", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("can be instantiated with a valid config", () => {
    const config = makeConfig();
    // RED: constructor throws "not implemented"
    expect(() => new DisconnectHandler(config)).not.toThrow();
  });
});

// ── DH-01: startGraceTimer fires onGraceExpired after graceWindowMs ───────────

describe("DisconnectHandler — DH-01: grace timer fires after window", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("DH-01: startGraceTimer() → onGraceExpired called after graceWindowMs", async () => {
    const onGraceExpired = vi.fn();
    const config = makeConfig({ graceWindowMs: 10_000, onGraceExpired });
    const handler = new DisconnectHandler(config);

    handler.startGraceTimer();

    // Before timeout — callback must NOT have fired yet
    await vi.advanceTimersByTimeAsync(9_999);
    expect(onGraceExpired).not.toHaveBeenCalled();

    // After timeout — callback MUST fire
    await vi.advanceTimersByTimeAsync(1);
    expect(onGraceExpired).toHaveBeenCalledTimes(1);
  });
});

// ── DH-02: cancelGraceTimer before expiry prevents onGraceExpired ─────────────

describe("DisconnectHandler — DH-02: cancel before expiry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("DH-02: startGraceTimer() → cancelGraceTimer() → onGraceExpired never called", async () => {
    const onGraceExpired = vi.fn();
    const config = makeConfig({ graceWindowMs: 10_000, onGraceExpired });
    const handler = new DisconnectHandler(config);

    handler.startGraceTimer();
    await vi.advanceTimersByTimeAsync(5_000); // halfway through

    handler.cancelGraceTimer();
    expect(onGraceExpired).not.toHaveBeenCalled();

    // Advance past the original deadline — callback must still NOT fire
    await vi.advanceTimersByTimeAsync(10_000);
    expect(onGraceExpired).not.toHaveBeenCalled();
  });

  it("DH-02: after cancelGraceTimer(), getState().graceTimerActive is false", async () => {
    const config = makeConfig({ graceWindowMs: 10_000 });
    const handler = new DisconnectHandler(config);

    handler.startGraceTimer();
    handler.cancelGraceTimer();

    const state = handler.getState();
    expect(state.graceTimerActive).toBe(false);
  });
});

// ── DH-03: second startGraceTimer resets the countdown ────────────────────────

describe("DisconnectHandler — DH-03: restart resets timer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("DH-03: calling startGraceTimer() twice — only one onGraceExpired fires", async () => {
    const onGraceExpired = vi.fn();
    const config = makeConfig({ graceWindowMs: 10_000, onGraceExpired });
    const handler = new DisconnectHandler(config);

    // First start
    handler.startGraceTimer();
    await vi.advanceTimersByTimeAsync(5_000); // halfway through first timer

    // Second start — should reset the countdown
    handler.startGraceTimer();
    await vi.advanceTimersByTimeAsync(9_999); // 9.999s after second start

    // Original timer would have fired by now, but it was cancelled
    expect(onGraceExpired).not.toHaveBeenCalled();

    // Complete second timer
    await vi.advanceTimersByTimeAsync(1);
    expect(onGraceExpired).toHaveBeenCalledTimes(1);
  });

  it("DH-03: after second startGraceTimer(), timer fires at second start's deadline", async () => {
    const onGraceExpired = vi.fn();
    const config = makeConfig({ graceWindowMs: 10_000, onGraceExpired });
    const handler = new DisconnectHandler(config);

    handler.startGraceTimer();
    await vi.advanceTimersByTimeAsync(3_000);

    const t2Start = Date.now(); // relative: 3000ms after first start
    handler.startGraceTimer();

    // Advance to just before the second timer's deadline (3000 + 9999 = 12999ms total)
    await vi.advanceTimersByTimeAsync(9_999);
    expect(onGraceExpired).not.toHaveBeenCalled();

    // Advance the last 1ms — now at 3000 + 10000 = 13000ms total
    await vi.advanceTimersByTimeAsync(1);
    expect(onGraceExpired).toHaveBeenCalledTimes(1);

    void t2Start; // suppress unused variable warning
  });
});

// ── DH-04: cancelGraceTimer when no timer running is a no-op ──────────────────

describe("DisconnectHandler — DH-04: cancel when no timer running", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("DH-04: cancelGraceTimer() when no timer running does not throw", () => {
    const config = makeConfig();
    const handler = new DisconnectHandler(config);

    // Should be a no-op, no error
    expect(() => handler.cancelGraceTimer()).not.toThrow();
  });

  it("DH-04: calling cancelGraceTimer() twice does not throw", () => {
    const config = makeConfig();
    const handler = new DisconnectHandler(config);

    handler.startGraceTimer();
    handler.cancelGraceTimer();

    // Second cancel — no timer running, must not throw
    expect(() => handler.cancelGraceTimer()).not.toThrow();
  });
});

// ── DH-05: getState() when timer is inactive ──────────────────────────────────

describe("DisconnectHandler — DH-05: getState() when inactive", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("DH-05: getState() before any start returns graceTimerActive=false", () => {
    const config = makeConfig();
    const handler = new DisconnectHandler(config);

    const state: DisconnectHandlerState = handler.getState();
    expect(state.graceTimerActive).toBe(false);
  });

  it("DH-05: getState() before any start returns graceStartedAt=null", () => {
    const config = makeConfig();
    const handler = new DisconnectHandler(config);

    const state = handler.getState();
    expect(state.graceStartedAt).toBeNull();
  });

  it("DH-05: getState() before any start returns graceRemainingMs=null", () => {
    const config = makeConfig();
    const handler = new DisconnectHandler(config);

    const state = handler.getState();
    expect(state.graceRemainingMs).toBeNull();
  });
});

// ── DH-06: getState() when timer is active ────────────────────────────────────

describe("DisconnectHandler — DH-06: getState() when active", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("DH-06: getState() after startGraceTimer() returns graceTimerActive=true", () => {
    const config = makeConfig({ graceWindowMs: 10_000 });
    const handler = new DisconnectHandler(config);

    handler.startGraceTimer();

    const state = handler.getState();
    expect(state.graceTimerActive).toBe(true);
  });

  it("DH-06: getState() after startGraceTimer() returns a recent graceStartedAt", () => {
    const before = Date.now();
    const config = makeConfig({ graceWindowMs: 10_000 });
    const handler = new DisconnectHandler(config);

    handler.startGraceTimer();
    const after = Date.now();

    const state = handler.getState();
    expect(state.graceStartedAt).not.toBeNull();
    expect(state.graceStartedAt!).toBeGreaterThanOrEqual(before);
    expect(state.graceStartedAt!).toBeLessThanOrEqual(after + 50); // generous tolerance
  });

  it("DH-06: getState() after startGraceTimer() returns graceRemainingMs > 0", () => {
    const config = makeConfig({ graceWindowMs: 10_000 });
    const handler = new DisconnectHandler(config);

    handler.startGraceTimer();

    const state = handler.getState();
    expect(state.graceRemainingMs).not.toBeNull();
    expect(state.graceRemainingMs!).toBeGreaterThan(0);
  });
});

// ── DH-07: dispose() cancels running timer ────────────────────────────────────

describe("DisconnectHandler — DH-07: dispose() cancels running timer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("DH-07: dispose() prevents onGraceExpired from firing", async () => {
    const onGraceExpired = vi.fn();
    const config = makeConfig({ graceWindowMs: 10_000, onGraceExpired });
    const handler = new DisconnectHandler(config);

    handler.startGraceTimer();
    await vi.advanceTimersByTimeAsync(5_000);

    handler.dispose();

    // Advance past the original deadline
    await vi.advanceTimersByTimeAsync(10_000);
    expect(onGraceExpired).not.toHaveBeenCalled();
  });

  it("DH-07: dispose() does not throw when no timer is running", () => {
    const config = makeConfig();
    const handler = new DisconnectHandler(config);

    expect(() => handler.dispose()).not.toThrow();
  });
});

// ── DH-08: custom graceWindowMs is respected ─────────────────────────────────

describe("DisconnectHandler — DH-08: custom graceWindowMs", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("DH-08: timer fires at custom graceWindowMs (500ms), not at default 10s", async () => {
    const onGraceExpired = vi.fn();
    const config = makeConfig({ graceWindowMs: 500, onGraceExpired });
    const handler = new DisconnectHandler(config);

    handler.startGraceTimer();

    // Should NOT have fired at 499ms
    await vi.advanceTimersByTimeAsync(499);
    expect(onGraceExpired).not.toHaveBeenCalled();

    // Should fire at 500ms
    await vi.advanceTimersByTimeAsync(1);
    expect(onGraceExpired).toHaveBeenCalledTimes(1);
  });

  it("DH-08: default 10s timer does NOT fire at 500ms", async () => {
    const onGraceExpired = vi.fn();
    const config = makeConfig({ graceWindowMs: 10_000, onGraceExpired });
    const handler = new DisconnectHandler(config);

    handler.startGraceTimer();

    await vi.advanceTimersByTimeAsync(500);
    expect(onGraceExpired).not.toHaveBeenCalled();
  });
});
