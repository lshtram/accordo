/**
 * script-runner.ts
 *
 * ScriptRunner: executes a NarrationScript step-by-step.
 * All side-effectful operations are injected via ScriptRunnerDeps
 * so the runner is fully testable without a real VSCode host.
 *
 * M52-SR — Script Runner
 *
 * NOTE: This file is a verbatim copy from packages/script/src/script-runner.ts
 * with only the import path changed (script-types.js is now a sibling).
 * The script package's copy will be removed once the migration is complete.
 */

import type { NarrationScript, ScriptState, ScriptStatus, ScriptStep } from "./script-types.js";

// ── Dependency injection interface ────────────────────────────────────────────

/**
 * All side-effectful operations the runner needs, injected at construction
 * time so tests can stub each one independently.
 */
export interface ScriptRunnerDeps {
  /**
   * Execute a command by name with optional arguments.
   * In the Hub, this maps to bridgeServer.invoke() with throw-on-failure.
   */
  executeCommand(command: string, args?: unknown): Promise<unknown>;

  /**
   * Speak text aloud via the voice extension.
   * Undefined when the voice extension is not installed — the runner
   * falls back to showSubtitle instead.
   */
  speakText?: (
    text: string,
    opts: { voice?: string; speed?: number; block: boolean },
  ) => Promise<void>;

  /**
   * Show a subtitle string for the given duration.
   */
  showSubtitle(text: string, durationMs: number): void;

  /**
   * Open a file and apply highlight decorations to the given line range.
   * Lines are 1-based.
   */
  openAndHighlight(file: string, startLine: number, endLine: number): Promise<void>;

  /**
   * Remove all highlight decorations previously applied by openAndHighlight.
   */
  clearHighlights(): void;

  /**
   * Pause execution for ms milliseconds.
   */
  wait(ms: number): Promise<void>;
}

// ── Callbacks emitted during execution ───────────────────────────────────────

export interface ScriptRunnerCallbacks {
  onStepStart?: (stepIndex: number, step: ScriptStep) => void;
  onStepComplete?: (stepIndex: number, step: ScriptStep) => void;
  onComplete?: () => void;
  onStop?: (reason: "error" | "cancelled", stepIndex: number, err?: Error) => void;
}

// ── ScriptRunner ──────────────────────────────────────────────────────────────

/**
 * Executes a NarrationScript sequentially.
 *
 * State machine: idle → running → (completed | stopped | error)
 * Only one script may run at a time.
 */
export class ScriptRunner {
  private _state: ScriptState = "idle";
  private _status: ScriptStatus = { state: "idle", currentStep: -1, totalSteps: 0 };
  private _stopRequested = false;
  private _stopResolvers: Array<() => void> = [];

  constructor(
    private readonly deps: ScriptRunnerDeps,
    private readonly callbacks?: ScriptRunnerCallbacks,
  ) {}

  /** Current execution state. */
  get state(): ScriptState {
    return this._state;
  }

  /** Full status snapshot (safe to serialise and return to the MCP caller). */
  get status(): ScriptStatus {
    return { ...this._status };
  }

  /**
   * Begin executing a validated NarrationScript.
   * Returns immediately (fire-and-forget); progress is reported via callbacks.
   * Throws synchronously if a script is already running.
   *
   * M52-SR-01 through M52-SR-18
   *
   * @param scriptId - Optional; if provided, seeds runner.status.scriptId before execution.
   * @param extraCallbacks - Optional; extra per-execution callbacks (used by Hub tools).
   */
  run(script: NarrationScript, scriptId?: string, extraCallbacks?: ScriptRunnerCallbacks): void {
    if (this._state === "running" || this._state === "stopping") {
      throw new Error("ScriptRunner already running");
    }
    this._stopRequested = false;
    this._state = "running";
    this._status = {
      state: "running",
      currentStep: -1,
      totalSteps: script.steps.length,
      label: script.label,
      scriptId: scriptId ?? this._status.scriptId,
    };
    void this._execute(script, extraCallbacks);
  }

  /**
   * Request a graceful stop of the running script.
   * Idempotent — safe to call when idle or already stopped.
   * Returns a Promise that resolves when execution has fully stopped.
   *
   * M52-SR-08, M52-SR-09
   */
  stop(): Promise<void> {
    if (this._state !== "running" && this._state !== "stopping") {
      return Promise.resolve();
    }
    this._stopRequested = true;
    this._state = "stopping";
    return new Promise<void>(resolve => {
      this._stopResolvers.push(resolve);
    });
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private _mergeCallbacks(extra?: ScriptRunnerCallbacks): ScriptRunnerCallbacks {
    if (!extra) return this.callbacks ?? {};
    const base = this.callbacks ?? {};
    return {
      onStepStart: (i, step): void => {
        base.onStepStart?.(i, step);
        extra.onStepStart?.(i, step);
      },
      onStepComplete: (i, step): void => {
        base.onStepComplete?.(i, step);
        extra.onStepComplete?.(i, step);
      },
      onComplete: (): void => {
        base.onComplete?.();
        extra.onComplete?.();
      },
      onStop: (reason, i, err): void => {
        base.onStop?.(reason, i, err);
        extra.onStop?.(reason, i, err);
      },
    };
  }

  private _resolveStop(): void {
    const resolvers = this._stopResolvers;
    this._stopResolvers = [];
    for (const r of resolvers) r();
  }

  private _finishStopped(stepIndex: number, cb: ScriptRunnerCallbacks): void {
    this._state = "stopped";
    this._status = { ...this._status, state: "stopped" };
    cb.onStop?.("cancelled", stepIndex, undefined);
    this._resolveStop();
  }

  private async _execute(script: NarrationScript, extraCallbacks?: ScriptRunnerCallbacks): Promise<void> {
    const cb = this._mergeCallbacks(extraCallbacks);
    const errPolicy = script.errPolicy ?? "abort";

    for (let i = 0; i < script.steps.length; i++) {
      if (this._stopRequested) {
        this._finishStopped(i, cb);
        return;
      }

      const step = script.steps[i];
      this._status = { ...this._status, state: "running", currentStep: i };
      cb.onStepStart?.(i, step);

      try {
        await this._executeStep(step);
      } catch (err) {
        if (errPolicy === "abort") {
          this._state = "error";
          this._status = { ...this._status, state: "error", error: String(err) };
          cb.onStop?.("error", i, err instanceof Error ? err : new Error(String(err)));
          this._resolveStop();
          return;
        }
        // errPolicy === "skip": swallow and continue
      }

      cb.onStepComplete?.(i, step);

      // Check after step completes (handles stop requested mid-step)
      if (this._stopRequested) {
        this._finishStopped(i + 1, cb);
        return;
      }
    }

    this._state = "completed";
    this._status = { ...this._status, state: "completed" };
    cb.onComplete?.();
    this._resolveStop();
  }

  private _executeStep(step: ScriptStep): Promise<void> {
    switch (step.type) {
      case "speak":
        if (this.deps.speakText) {
          if (step.block !== false) {
            return this.deps.speakText(step.text, { voice: step.voice, speed: step.speed, block: true });
          } else {
            void this.deps.speakText(step.text, { voice: step.voice, speed: step.speed, block: false });
            return Promise.resolve();
          }
        } else {
          const words = step.text.split(/\s+/).length;
          const estimated = Math.max(2000, words * 250);
          this.deps.showSubtitle(step.text, estimated);
          return this.deps.wait(estimated);
        }

      case "subtitle": {
        const words = step.text.split(/\s+/).length;
        const dur = step.durationMs ?? Math.max(2000, words * 250);
        this.deps.showSubtitle(step.text, dur);
        return this.deps.wait(dur);
      }

      case "command":
        return this.deps.executeCommand(step.command, step.args).then(() => undefined);

      case "delay":
        return this.deps.wait(step.ms);

      case "highlight":
        if (step.durationMs !== undefined) {
          const dur = step.durationMs;
          return this.deps.openAndHighlight(step.file, step.startLine, step.endLine)
            .then(() => this.deps.wait(dur))
            .then(() => { this.deps.clearHighlights(); });
        }
        return this.deps.openAndHighlight(step.file, step.startLine, step.endLine);

      case "clear-highlights":
        this.deps.clearHighlights();
        return Promise.resolve();
    }
  }
}
