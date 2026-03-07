/**
 * NarrationFsm — manages TTS narration queue and state.
 *
 * M50-FSM-30 through M50-FSM-38
 */

import type { NarrationState, NarrationMode } from "./types.js";

export interface NarrationRequest {
  text: string;
  mode: NarrationMode;
}

/** Active states where error() transitions to idle */
const ACTIVE_STATES: ReadonlySet<NarrationState> = new Set(["queued", "processing", "playing", "paused"]);

export class NarrationFsm {
  private _state: NarrationState = "idle";
  private _queue: NarrationRequest[] = [];

  /** M50-FSM-30 */
  get state(): NarrationState {
    return this._state;
  }

  get queueLength(): number {
    return this._queue.length;
  }

  /**
   * M50-FSM-31: idle → queued, pushes request.
   * If non-idle, just pushes (no transition).
   * M50-FSM-32: narrate-off requests are no-ops.
   */
  enqueue(request: NarrationRequest): void {
    if (request.mode === "narrate-off") return; // M50-FSM-32
    this._queue.push(request);
    if (this._state === "idle") {
      this._state = "queued";
    }
    // if non-idle, just push — no state transition
  }

  /** M50-FSM-33: queued → processing */
  startProcessing(): void {
    this._state = "processing";
  }

  /** M50-FSM-34: processing → playing */
  audioReady(): void {
    this._state = "playing";
  }

  /** M50-FSM-35: playing → paused */
  pause(): void {
    this._state = "paused";
  }

  /** M50-FSM-36: paused → playing */
  resume(): void {
    this._state = "playing";
  }

  /**
   * M50-FSM-37: shifts queue, returns next request if any (→ queued),
   * or undefined (→ idle).
   */
  complete(): NarrationRequest | undefined {
    this._queue.shift(); // remove current item
    if (this._queue.length > 0) {
      this._state = "queued";
      return this._queue[0];
    }
    this._state = "idle";
    return undefined;
  }

  /** M50-FSM-38: any active state → idle, clears queue */
  error(): void {
    if (ACTIVE_STATES.has(this._state)) {
      this._state = "idle";
      this._queue = [];
    }
  }
}
