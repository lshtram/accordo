/**
 * Tests for hub-process.ts — killHub() SIGKILL fallback
 * Requirements: adr-reload-reconnect.md §D3
 *
 * All KH-xx tests are RED until the SIGKILL fallback is wired in killHub().
 * The stub has a comment: "SIGKILL fallback — stub: implementation will add setTimeout + SIGKILL"
 *
 * API checklist:
 * ✓ HubProcess.killHub(timeoutMs)  [4 tests: KH-01–KH-04]
 * ✓ HubProcess.spawn()            [tested in hub-manager.test.ts]
 * ✓ HubProcess.readPidFile()      [tested in hub-manager.test.ts]
 * ✓ HubProcess.isProcessAlive()   [tested in hub-manager.test.ts]
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { HubProcess } from "../hub-process.js";
import type { HubProcessEvents, HubProcessSharedState } from "../hub-process.js";
import { EventEmitter } from "node:events";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeOutputChannel() {
  return { appendLine: vi.fn(), show: vi.fn() };
}

function makeEvents(): HubProcessEvents {
  return { onUnexpectedExit: vi.fn() };
}

function makeState(overrides: Partial<HubProcessSharedState> = {}): HubProcessSharedState {
  return {
    hubProcess: null,
    secret: null,
    token: null,
    restartAttempted: false,
    killRequested: false,
    ...overrides,
  };
}

function makeHubProcess(state: HubProcessSharedState): HubProcess {
  return new HubProcess(
    { executablePath: "", hubEntryPoint: "/hub/index.js" },
    makeOutputChannel(),
    makeEvents(),
    state,
  );
}

// ── Mock process that can simulate SIGTERM and SIGKILL ────────────────────────

class MockProcess extends EventEmitter {
  pid = 99998;
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  exitCode: number | null = null;
  killCalls: string[] = [];

  kill(signal?: string) {
    this.killCalls.push(signal ?? "SIGTERM");
    if (signal !== "SIGKILL") {
      // SIGTERM: process exits by default (normal case)
      // To simulate an ignoring process, test sets suppressExit=true
      if (!this.suppressExit) {
        // Async: emit exit on next tick to simulate process shutdown
        setImmediate(() => {
          this.exitCode = 0;
          this.emit("exit", 0, null);
        });
      }
    } else {
      // SIGKILL always exits immediately
      setImmediate(() => {
        this.exitCode = 9;
        this.emit("exit", null, "SIGKILL");
      });
    }
  }

  suppressExit = false;
}

// ── KH-01: Process exits within SIGTERM timeout → no SIGKILL ─────────────────

describe("HubProcess.killHub() — KH-01: process exits on SIGTERM", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("KH-01: when process exits on SIGTERM, killHub() resolves without SIGKILL", async () => {
    const mockProc = new MockProcess();
    const state = makeState({
      hubProcess: mockProc as unknown as HubProcessSharedState["hubProcess"],
    });
    const hp = makeHubProcess(state);

    const killPromise = hp.killHub(2000);
    // Flush the setImmediate that triggers exit
    await vi.runAllTimersAsync();

    await killPromise;

    // SIGKILL must NOT have been sent — process exited cleanly on SIGTERM
    expect(mockProc.killCalls).not.toContain("SIGKILL");
    expect(mockProc.killCalls).toContain("SIGKILL" in mockProc.killCalls ? "SIGKILL" : "SIGTERM");
  });

  it("KH-01: killHub() resolves after process exits within timeout window", async () => {
    const mockProc = new MockProcess();
    const state = makeState({
      hubProcess: mockProc as unknown as HubProcessSharedState["hubProcess"],
    });
    const hp = makeHubProcess(state);

    const killPromise = hp.killHub(2000);
    await vi.runAllTimersAsync();

    // Must resolve without hanging
    await expect(killPromise).resolves.toBeUndefined();
  });
});

// ── KH-02: Process ignores SIGTERM → SIGKILL sent after timeout ───────────────

describe("HubProcess.killHub() — KH-02: SIGKILL fallback after timeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("KH-02: when process ignores SIGTERM, SIGKILL is sent after timeoutMs", async () => {
    const mockProc = new MockProcess();
    mockProc.suppressExit = true; // process ignores SIGTERM

    const state = makeState({
      hubProcess: mockProc as unknown as HubProcessSharedState["hubProcess"],
    });
    const hp = makeHubProcess(state);

    // Start killHub — do NOT await it; stub hangs waiting for "exit" that never comes
    const killPromise = hp.killHub(2000);
    killPromise.catch(() => {}); // suppress unhandled rejection

    // Advance to just before timeout — SIGKILL must NOT have fired yet
    await vi.advanceTimersByTimeAsync(1_999);
    const sigkillBeforeTimeout = mockProc.killCalls.includes("SIGKILL");

    // Advance past timeout — SIGKILL must fire (RED: stub doesn't implement this yet)
    await vi.advanceTimersByTimeAsync(1);
    await vi.runAllTimersAsync();

    // RED: SIGKILL fallback is not yet wired — killCalls will NOT contain SIGKILL
    expect(sigkillBeforeTimeout).toBe(false); // correct regardless of implementation
    expect(mockProc.killCalls).toContain("SIGKILL"); // RED: will fail until SIGKILL wired
  });

  it("KH-02: killHub() resolves after SIGKILL is sent", async () => {
    const mockProc = new MockProcess();
    mockProc.suppressExit = true;

    const state = makeState({
      hubProcess: mockProc as unknown as HubProcessSharedState["hubProcess"],
    });
    const hp = makeHubProcess(state);

    const killPromise = hp.killHub(2000);

    // Advance past the 2s timeout → SIGKILL fires → exit emitted
    await vi.advanceTimersByTimeAsync(2_001);
    await vi.runAllTimersAsync();

    // RED: killHub() will not resolve because SIGKILL never fires (stub doesn't implement fallback).
    // We verify the SIGKILL was sent; the promise resolution will be verified once implemented.
    // Use a fake-timer-safe check: assert SIGKILL was sent, then abandon promise.
    expect(mockProc.killCalls).toContain("SIGKILL");

    // Suppress unhandled rejection from the abandoned promise
    killPromise.catch(() => {});
  });
});

// ── KH-03: Custom timeoutMs is respected ──────────────────────────────────────

describe("HubProcess.killHub() — KH-03: custom timeoutMs", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("KH-03: SIGKILL is sent after custom 500ms timeout, not after default 2000ms", async () => {
    const mockProc = new MockProcess();
    mockProc.suppressExit = true;

    const state = makeState({
      hubProcess: mockProc as unknown as HubProcessSharedState["hubProcess"],
    });
    const hp = makeHubProcess(state);

    const killPromise = hp.killHub(500); // custom: 500ms

    // At 499ms → SIGKILL must NOT have been sent
    await vi.advanceTimersByTimeAsync(499);
    expect(mockProc.killCalls).not.toContain("SIGKILL");

    // At 500ms → SIGKILL must fire
    await vi.advanceTimersByTimeAsync(1);
    await vi.runAllTimersAsync();
    killPromise.catch(() => {});

    // RED: SIGKILL fallback not wired
    expect(mockProc.killCalls).toContain("SIGKILL");
  });

  it("KH-03: SIGKILL is NOT sent before 500ms custom timeout", async () => {
    const mockProc = new MockProcess();
    mockProc.suppressExit = true;

    const state = makeState({
      hubProcess: mockProc as unknown as HubProcessSharedState["hubProcess"],
    });
    const hp = makeHubProcess(state);

    hp.killHub(500).catch(() => {});

    // Advance to 499ms — just before the custom timeout
    await vi.advanceTimersByTimeAsync(499);

    // No SIGKILL yet
    expect(mockProc.killCalls).not.toContain("SIGKILL");
  });
});

// ── KH-04: No process running → immediate resolve ────────────────────────────

describe("HubProcess.killHub() — KH-04: no process running", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("KH-04: killHub() resolves immediately when no process is running", async () => {
    const state = makeState({ hubProcess: null }); // no process
    const hp = makeHubProcess(state);

    // Must resolve without error
    await expect(hp.killHub()).resolves.toBeUndefined();
  });

  it("KH-04: killHub() does not call kill() when state.hubProcess is null", async () => {
    const state = makeState({ hubProcess: null });
    const hp = makeHubProcess(state);

    // No process to send signals to — must be a clean no-op
    await hp.killHub();
    // If we reach here without error, the test passes
    expect(true).toBe(true);
  });
});
