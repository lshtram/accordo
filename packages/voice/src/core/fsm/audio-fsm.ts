/**
 * AudioFsm — manages the audio capture/STT pipeline state.
 *
 * M50-FSM-20 through M50-FSM-26
 */

import { type AudioState, VoiceFsmError } from "./types.js";

export class AudioFsm {
  private _state: AudioState = "idle";

  /** M50-FSM-20 */
  get state(): AudioState {
    return this._state;
  }

  /** M50-FSM-21: idle → listening */
  startCapture(): void {
    if (this._state !== "idle") {
      throw new VoiceFsmError("AudioFsm", this._state, "startCapture");
    }
    this._state = "listening";
  }

  /** M50-FSM-22: listening → processing */
  stopCapture(): void {
    if (this._state !== "listening") {
      throw new VoiceFsmError("AudioFsm", this._state, "stopCapture");
    }
    this._state = "processing";
  }

  /** M50-FSM-23: processing → idle */
  transcriptReady(): void {
    if (this._state !== "processing") {
      throw new VoiceFsmError("AudioFsm", this._state, "transcriptReady");
    }
    this._state = "idle";
  }

  /** M50-FSM-24: processing → error */
  error(): void {
    if (this._state !== "processing") {
      throw new VoiceFsmError("AudioFsm", this._state, "error");
    }
    this._state = "error";
  }

  /** M50-FSM-25: error → idle */
  reset(): void {
    if (this._state !== "error") {
      throw new VoiceFsmError("AudioFsm", this._state, "reset");
    }
    this._state = "idle";
  }
}
