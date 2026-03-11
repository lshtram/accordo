/**
 * M52-SR — ScriptRunner tests (Phase B — must FAIL before implementation)
 * Coverage: M52-SR-01 through M52-SR-18
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ScriptRunner } from "../script-runner.js";
import type { ScriptRunnerDeps, ScriptRunnerCallbacks } from "../script-runner.js";
import type { ScriptStep } from "../script-types.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeDeps(overrides: Partial<ScriptRunnerDeps> = {}): ScriptRunnerDeps {
  return {
    executeCommand: vi.fn().mockResolvedValue(undefined),
    speakText: vi.fn().mockResolvedValue(undefined),
    showSubtitle: vi.fn(),
    openAndHighlight: vi.fn().mockResolvedValue(undefined),
    clearHighlights: vi.fn(),
    wait: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

/** Deps without voice — simulates voice extension absent. */
function makeDepsNoVoice(overrides: Partial<ScriptRunnerDeps> = {}): ScriptRunnerDeps {
  const { speakText: _s, ...rest } = makeDeps(overrides);
  return rest;
}

function makeRunner(
  deps: ScriptRunnerDeps = makeDeps(),
  callbacks: ScriptRunnerCallbacks = {},
): ScriptRunner {
  return new ScriptRunner(deps, callbacks);
}

/** Returns a promise that resolves when onComplete fires (with timeout). */
function waitForComplete(callbacks: { onComplete: ReturnType<typeof vi.fn> }): Promise<void> {
  return vi.waitFor(() => expect(callbacks.onComplete).toHaveBeenCalled(), { timeout: 1000 });
}

const CLEAR: ScriptStep = { type: "clear-highlights" };
const DELAY = (ms: number): ScriptStep => ({ type: "delay", ms });
const SPEAK = (text: string, opts: Partial<{ block: boolean; voice: string; speed: number }> = {}): ScriptStep =>
  ({ type: "speak", text, ...opts });
const SUBTITLE = (text: string, durationMs?: number): ScriptStep =>
  ({ type: "subtitle", text, ...(durationMs !== undefined ? { durationMs } : {}) });
const CMD = (command: string): ScriptStep => ({ type: "command", command });
const HL = (file: string, startLine: number, endLine: number, durationMs?: number): ScriptStep =>
  ({ type: "highlight", file, startLine, endLine, ...(durationMs !== undefined ? { durationMs } : {}) });

// ── M52-SR-15: initial state ──────────────────────────────────────────────────

describe("M52-SR-15 state transitions", () => {
  it("initial state is idle", () => {
    const runner = makeRunner();
    expect(runner.state).toBe("idle");
  });

  it("state transitions to running synchronously on run()", () => {
    const deps = makeDeps({
      wait: vi.fn(() => new Promise<void>(() => { /* never resolves */ })),
    });
    const runner = makeRunner(deps);
    runner.run({ steps: [DELAY(1)] });
    expect(runner.state).toBe("running");
  });

  it("status.currentStep is -1 and totalSteps is 0 when idle", () => {
    const runner = makeRunner();
    expect(runner.status.currentStep).toBe(-1);
    expect(runner.status.totalSteps).toBe(0);
  });
});

// ── M52-SR-01: sequential execution ──────────────────────────────────────────

describe("M52-SR-01 sequential execution", () => {
  it("step N+1 starts only after step N resolves", async () => {
    const order: string[] = [];
    let resolveWait!: () => void;
    const deps = makeDeps({
      wait: vi.fn(() => new Promise<void>(r => { resolveWait = r; })),
      executeCommand: vi.fn(() => { order.push("command"); return Promise.resolve(); }),
    });
    const onComplete = vi.fn();
    const runner = makeRunner(deps, { onComplete });

    runner.run({ steps: [DELAY(1), CMD("test")] });

    // Command must not have run yet — delay is blocking
    expect(deps.executeCommand).not.toHaveBeenCalled();

    resolveWait();
    await waitForComplete({ onComplete });

    expect(order).toContain("command");
    expect(deps.wait).toHaveBeenCalledTimes(1);
    expect(deps.executeCommand).toHaveBeenCalledTimes(1);
  });
});

// ── M52-SR-02: speak block:false ─────────────────────────────────────────────

describe("M52-SR-02 speak block:false", () => {
  it("block:false — next step runs without waiting for speakText to resolve", async () => {
    let resolveSpeak!: () => void;
    const blockingSpeak = new Promise<void>(r => { resolveSpeak = r; });
    const deps = makeDeps({
      speakText: vi.fn(() => blockingSpeak),
    });
    const onComplete = vi.fn();
    const runner = makeRunner(deps, { onComplete });

    runner.run({ steps: [SPEAK("hi", { block: false }), CMD("next")] });

    // Runner should complete even though speakText hasn't resolved
    await waitForComplete({ onComplete });
    expect(deps.executeCommand).toHaveBeenCalledWith("next", undefined);

    // Clean up the dangling speak
    resolveSpeak();
  });
});

// ── M52-SR-03: speak block:true ──────────────────────────────────────────────

describe("M52-SR-03 speak block:true", () => {
  it("block:true (default) — runner awaits speakText before next step", async () => {
    let resolveSpeak!: () => void;
    const blockingSpeak = new Promise<void>(r => { resolveSpeak = r; });
    const deps = makeDeps({
      speakText: vi.fn(() => blockingSpeak),
    });
    const onComplete = vi.fn();
    const runner = makeRunner(deps, { onComplete });

    runner.run({ steps: [SPEAK("hi"), CMD("after")] });

    // Give event loop a tick — command should NOT run yet
    await Promise.resolve();
    expect(deps.executeCommand).not.toHaveBeenCalled();

    // Now complete speech
    resolveSpeak();
    await waitForComplete({ onComplete });
    expect(deps.executeCommand).toHaveBeenCalledWith("after", undefined);
  });
});

// ── M52-SR-04: speak fallback ────────────────────────────────────────────────

describe("M52-SR-04 / M52-SR-05 speak fallback when no voice", () => {
  it("calls showSubtitle when speakText is absent", async () => {
    const deps = makeDepsNoVoice();
    const onComplete = vi.fn();
    const runner = makeRunner(deps, { onComplete });

    runner.run({ steps: [SPEAK("hello world")] });
    await waitForComplete({ onComplete });

    expect(deps.showSubtitle).toHaveBeenCalled();
    expect(deps.wait).toHaveBeenCalled();
  });

  it("M52-SR-05: estimated duration = Math.max(2000, wordCount * 250)", async () => {
    const deps = makeDepsNoVoice();
    const onComplete = vi.fn();
    const runner = makeRunner(deps, { onComplete });

    // 9 words → 9 * 250 = 2250 > 2000
    const text = "one two three four five six seven eight nine";
    runner.run({ steps: [SPEAK(text)] });
    await waitForComplete({ onComplete });

    expect(deps.wait).toHaveBeenCalledWith(2250);
    expect(deps.showSubtitle).toHaveBeenCalledWith(text, 2250);
  });

  it("M52-SR-05: short text uses minimum of 2000ms", async () => {
    const deps = makeDepsNoVoice();
    const onComplete = vi.fn();
    const runner = makeRunner(deps, { onComplete });

    runner.run({ steps: [SPEAK("hi")] }); // 1 word → 250 < 2000
    await waitForComplete({ onComplete });

    expect(deps.wait).toHaveBeenCalledWith(2000);
  });
});

// ── M52-SR-06: errPolicy abort ────────────────────────────────────────────────

describe("M52-SR-06 errPolicy abort (default)", () => {
  it("first step error stops execution and calls onStop(error)", async () => {
    const boom = new Error("step failed");
    const deps = makeDeps({
      executeCommand: vi.fn().mockRejectedValue(boom),
    });
    const onStop = vi.fn();
    const onComplete = vi.fn();
    const runner = makeRunner(deps, { onStop, onComplete });

    runner.run({ steps: [CMD("bad"), CMD("should-not-run")] });

    await vi.waitFor(() => expect(onStop).toHaveBeenCalled(), { timeout: 1000 });

    expect(onStop).toHaveBeenCalledWith("error", 0, boom);
    expect(onComplete).not.toHaveBeenCalled();
    expect(deps.executeCommand).toHaveBeenCalledTimes(1); // second step never ran
  });

  it("state becomes error after step failure with abort policy", async () => {
    const deps = makeDeps({
      executeCommand: vi.fn().mockRejectedValue(new Error("fail")),
    });
    const onStop = vi.fn();
    const runner = makeRunner(deps, { onStop });

    runner.run({ steps: [CMD("fail")] });
    await vi.waitFor(() => expect(onStop).toHaveBeenCalled(), { timeout: 1000 });

    expect(runner.state).toBe("error");
  });
});

// ── M52-SR-07: errPolicy skip ────────────────────────────────────────────────

describe("M52-SR-07 errPolicy skip", () => {
  it("step error is swallowed and execution continues", async () => {
    const deps = makeDeps({
      executeCommand: vi.fn()
        .mockRejectedValueOnce(new Error("step 0 failed"))
        .mockResolvedValue(undefined),
    });
    const onComplete = vi.fn();
    const onStop = vi.fn();
    const runner = makeRunner(deps, { onComplete, onStop });

    runner.run({ steps: [CMD("bad"), CMD("good")], errPolicy: "skip" });

    await waitForComplete({ onComplete });

    expect(onComplete).toHaveBeenCalled();
    expect(onStop).not.toHaveBeenCalled();
    expect(deps.executeCommand).toHaveBeenCalledTimes(2);
  });
});

// ── M52-SR-08 / M52-SR-09: stop() ────────────────────────────────────────────

describe("M52-SR-08 / M52-SR-09 stop()", () => {
  it("stop() returns a Promise", () => {
    const runner = makeRunner();
    const result = runner.stop();
    expect(result).toBeInstanceOf(Promise);
  });

  it("stop() is idempotent when idle — resolves without error", async () => {
    const runner = makeRunner();
    await expect(runner.stop()).resolves.not.toThrow();
    await expect(runner.stop()).resolves.not.toThrow();
  });

  it("current step always completes before cancellation takes effect", async () => {
    let resolveWait!: () => void;
    const deps = makeDeps({
      wait: vi.fn(() => new Promise<void>(r => { resolveWait = r; })),
    });
    const onStepStart = vi.fn();
    const onStop = vi.fn();
    const runner = makeRunner(deps, { onStepStart, onStop });

    runner.run({ steps: [DELAY(1), DELAY(1)] });

    // Let step 0 start
    await vi.waitFor(() => expect(onStepStart).toHaveBeenCalledTimes(1), { timeout: 500 });

    // Request stop while step 0 is in progress
    const stopPromise = runner.stop();

    // Resolve step 0
    resolveWait();
    await stopPromise;

    // Step 1 should never have started
    expect(onStepStart).toHaveBeenCalledTimes(1);
    expect(onStop).toHaveBeenCalledWith("cancelled", expect.any(Number), undefined);
  });

  it("stopPromise resolves after execution fully stops", async () => {
    let resolveWait!: () => void;
    const deps = makeDeps({
      wait: vi.fn(() => new Promise<void>(r => { resolveWait = r; })),
    });
    const runner = makeRunner(deps);

    runner.run({ steps: [DELAY(1)] });
    const stopPromise = runner.stop();

    // Not resolved yet (step is in progress)
    let resolved = false;
    void stopPromise.then(() => { resolved = true; });

    await Promise.resolve(); // tick
    expect(resolved).toBe(false);

    resolveWait();
    await stopPromise;
    expect(resolved).toBe(true);
  });

  it("state becomes stopped after stop()", async () => {
    let resolveWait!: () => void;
    const deps = makeDeps({
      wait: vi.fn(() => new Promise<void>(r => { resolveWait = r; })),
    });
    const runner = makeRunner(deps);

    runner.run({ steps: [DELAY(1)] });
    const p = runner.stop();
    resolveWait();
    await p;

    expect(runner.state).toBe("stopped");
  });
});

// ── M52-SR-10: command step ──────────────────────────────────────────────────

describe("M52-SR-10 command step", () => {
  it("calls executeCommand with command id and args", async () => {
    const deps = makeDeps();
    const onComplete = vi.fn();
    const runner = makeRunner(deps, { onComplete });
    const args = { slide: 3 };

    runner.run({ steps: [{ type: "command", command: "accordo.test.goto", args }] });
    await waitForComplete({ onComplete });

    expect(deps.executeCommand).toHaveBeenCalledWith("accordo.test.goto", args);
  });

  it("calls executeCommand with undefined args when not provided", async () => {
    const deps = makeDeps();
    const onComplete = vi.fn();
    const runner = makeRunner(deps, { onComplete });

    runner.run({ steps: [CMD("no.args.cmd")] });
    await waitForComplete({ onComplete });

    expect(deps.executeCommand).toHaveBeenCalledWith("no.args.cmd", undefined);
  });
});

// ── M52-SR-11: highlight step ────────────────────────────────────────────────

describe("M52-SR-11 highlight step", () => {
  it("calls openAndHighlight with file, startLine, endLine", async () => {
    const deps = makeDeps();
    const onComplete = vi.fn();
    const runner = makeRunner(deps, { onComplete });

    runner.run({ steps: [HL("/src/file.ts", 10, 20)] });
    await waitForComplete({ onComplete });

    expect(deps.openAndHighlight).toHaveBeenCalledWith("/src/file.ts", 10, 20);
  });

  it("with durationMs — schedules clearHighlights after delay", async () => {
    const deps = makeDeps();
    const onComplete = vi.fn();
    const runner = makeRunner(deps, { onComplete });

    runner.run({ steps: [HL("/f.ts", 1, 5, 1000)] });
    await waitForComplete({ onComplete });

    expect(deps.clearHighlights).toHaveBeenCalled();
    expect(deps.wait).toHaveBeenCalledWith(1000);
  });

  it("without durationMs — does NOT call clearHighlights", async () => {
    const deps = makeDeps();
    const onComplete = vi.fn();
    const runner = makeRunner(deps, { onComplete });

    runner.run({ steps: [HL("/f.ts", 1, 5)] });
    await waitForComplete({ onComplete });

    expect(deps.clearHighlights).not.toHaveBeenCalled();
  });
});

// ── M52-SR-12: clear-highlights step ─────────────────────────────────────────

describe("M52-SR-12 clear-highlights step", () => {
  it("calls clearHighlights()", async () => {
    const deps = makeDeps();
    const onComplete = vi.fn();
    const runner = makeRunner(deps, { onComplete });

    runner.run({ steps: [CLEAR] });
    await waitForComplete({ onComplete });

    expect(deps.clearHighlights).toHaveBeenCalledTimes(1);
  });
});

// ── M52-SR-13: delay step ────────────────────────────────────────────────────

describe("M52-SR-13 delay step", () => {
  it("calls deps.wait(step.ms)", async () => {
    const deps = makeDeps();
    const onComplete = vi.fn();
    const runner = makeRunner(deps, { onComplete });

    runner.run({ steps: [DELAY(500)] });
    await waitForComplete({ onComplete });

    expect(deps.wait).toHaveBeenCalledWith(500);
  });
});

// ── M52-SR-14: subtitle step ─────────────────────────────────────────────────

describe("M52-SR-14 subtitle step", () => {
  it("calls showSubtitle and awaits the duration", async () => {
    const deps = makeDeps();
    const onComplete = vi.fn();
    const runner = makeRunner(deps, { onComplete });

    runner.run({ steps: [SUBTITLE("hello", 1500)] });
    await waitForComplete({ onComplete });

    expect(deps.showSubtitle).toHaveBeenCalledWith("hello", 1500);
    expect(deps.wait).toHaveBeenCalledWith(1500);
  });

  it("uses estimated duration when durationMs is absent", async () => {
    const deps = makeDeps();
    const onComplete = vi.fn();
    const runner = makeRunner(deps, { onComplete });

    runner.run({ steps: [SUBTITLE("one two")] }); // 2 words → 2000ms min
    await waitForComplete({ onComplete });

    expect(deps.showSubtitle).toHaveBeenCalledWith("one two", 2000);
    expect(deps.wait).toHaveBeenCalledWith(2000);
  });
});

// ── M52-SR-16: run() on non-idle throws ──────────────────────────────────────

describe("M52-SR-16 run() on non-idle runner", () => {
  it("throws 'ScriptRunner already running'", () => {
    const deps = makeDeps({
      wait: vi.fn(() => new Promise<void>(() => { /* never */ })),
    });
    const runner = makeRunner(deps);

    runner.run({ steps: [DELAY(1)] });
    expect(runner.state).toBe("running");

    expect(() => runner.run({ steps: [CLEAR] })).toThrow("ScriptRunner already running");
  });
});

// ── M52-SR-17: re-usable runner ──────────────────────────────────────────────

describe("M52-SR-17 reusable runner", () => {
  it("can run again after completion", async () => {
    const deps = makeDeps();
    const onComplete = vi.fn();
    const runner = makeRunner(deps, { onComplete });

    runner.run({ steps: [CLEAR] });
    await waitForComplete({ onComplete });
    expect(runner.state).toBe("completed");

    runner.run({ steps: [DELAY(1)] });
    await waitForComplete({ onComplete });
    expect(runner.state).toBe("completed");
    expect(onComplete).toHaveBeenCalledTimes(2);
  });

  it("can run again after stopped state", async () => {
    let resolveWait!: () => void;
    const deps = makeDeps({
      wait: vi.fn(() => new Promise<void>(r => { resolveWait = r; })),
    });
    const onComplete = vi.fn();
    const runner = makeRunner(deps, { onComplete });

    runner.run({ steps: [DELAY(1)] });
    const p = runner.stop();
    resolveWait();
    await p;
    expect(runner.state).toBe("stopped");

    // Replace wait with immediate mock for second run
    deps.wait = vi.fn().mockResolvedValue(undefined);
    runner.run({ steps: [CLEAR] });
    await waitForComplete({ onComplete });
    expect(runner.state).toBe("completed");
  });
});

// ── M52-SR-18: callbacks ─────────────────────────────────────────────────────

describe("M52-SR-18 callbacks fire correctly", () => {
  it("onStepStart fired before each step with index and step object", async () => {
    const deps = makeDeps();
    const onStepStart = vi.fn();
    const onComplete = vi.fn();
    const runner = makeRunner(deps, { onStepStart, onComplete });

    const steps = [CLEAR, DELAY(1)];
    runner.run({ steps });
    await waitForComplete({ onComplete });

    expect(onStepStart).toHaveBeenCalledTimes(2);
    expect(onStepStart).toHaveBeenNthCalledWith(1, 0, steps[0]);
    expect(onStepStart).toHaveBeenNthCalledWith(2, 1, steps[1]);
  });

  it("onStepComplete fired after each step with index and step object", async () => {
    const deps = makeDeps();
    const onStepComplete = vi.fn();
    const onComplete = vi.fn();
    const runner = makeRunner(deps, { onStepComplete, onComplete });

    const steps = [CLEAR, DELAY(1)];
    runner.run({ steps });
    await waitForComplete({ onComplete });

    expect(onStepComplete).toHaveBeenCalledTimes(2);
    expect(onStepComplete).toHaveBeenNthCalledWith(1, 0, steps[0]);
    expect(onStepComplete).toHaveBeenNthCalledWith(2, 1, steps[1]);
  });

  it("onComplete fires when all steps succeed", async () => {
    const deps = makeDeps();
    const onComplete = vi.fn();
    const runner = makeRunner(deps, { onComplete });

    runner.run({ steps: [CLEAR, DELAY(1)] });
    await waitForComplete({ onComplete });

    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("status.currentStep updates as steps progress", async () => {
    const snapshots: number[] = [];
    let resolveFirst!: () => void;
    const deps = makeDeps({
      wait: vi.fn()
        .mockImplementationOnce(() => new Promise<void>(r => { resolveFirst = r; }))
        .mockResolvedValue(undefined),
    });
    const onStepStart = vi.fn((i: number) => snapshots.push(i));
    const onComplete = vi.fn();
    const runner = makeRunner(deps, { onStepStart, onComplete });

    runner.run({ steps: [DELAY(1), DELAY(1)] });

    await vi.waitFor(() => expect(snapshots).toHaveLength(1), { timeout: 500 });
    expect(runner.status.currentStep).toBe(0);

    resolveFirst();
    await waitForComplete({ onComplete });
    expect(runner.status.currentStep).toBe(1);
  });

  it("status.totalSteps set when script starts", () => {
    const deps = makeDeps({
      wait: vi.fn(() => new Promise<void>(() => { /* never */ })),
    });
    const runner = makeRunner(deps);
    runner.run({ steps: [DELAY(1), CLEAR, DELAY(1)] });
    expect(runner.status.totalSteps).toBe(3);
  });
});

// ── Completed state transition ────────────────────────────────────────────────

describe("completed state", () => {
  it("state becomes completed after all steps finish", async () => {
    const deps = makeDeps();
    const onComplete = vi.fn();
    const runner = makeRunner(deps, { onComplete });

    runner.run({ steps: [CLEAR] });
    await waitForComplete({ onComplete });

    expect(runner.state).toBe("completed");
  });
});
