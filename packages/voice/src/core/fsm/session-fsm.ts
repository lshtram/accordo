/**
 * SessionFsm — manages the voice session lifecycle.
 *
 * M50-FSM-10 through M50-FSM-17
 */

import { type SessionState, type VoicePolicy, DEFAULT_VOICE_POLICY, VoiceFsmError } from "./types.js";

export class SessionFsm {
  private _state: SessionState = "inactive";
  private _policy: VoicePolicy = { ...DEFAULT_VOICE_POLICY };

  /** M50-FSM-17 */
  get state(): SessionState {
    return this._state;
  }

  /** M50-FSM-17 — returns a copy so callers cannot mutate internal state */
  get policy(): VoicePolicy {
    return { ...this._policy };
  }

  /** M50-FSM-11: inactive → active (idempotent if already active) */
  enable(): void {
    if (this._state === "active") return; // idempotent
    if (this._state !== "inactive") {
      throw new VoiceFsmError("SessionFsm", this._state, "enable");
    }
    this._state = "active";
  }

  /** M50-FSM-12: active|suspended → inactive (idempotent if already inactive) */
  disable(): void {
    if (this._state === "inactive") return; // idempotent
    if (this._state !== "active" && this._state !== "suspended") {
      throw new VoiceFsmError("SessionFsm", this._state, "disable");
    }
    this._state = "inactive";
  }

  /** M50-FSM-13: active → suspended */
  pushToTalkStart(): void {
    if (this._state !== "active") {
      throw new VoiceFsmError("SessionFsm", this._state, "pushToTalkStart");
    }
    this._state = "suspended";
  }

  /** M50-FSM-14: suspended → active */
  pushToTalkEnd(): void {
    if (this._state !== "suspended") {
      throw new VoiceFsmError("SessionFsm", this._state, "pushToTalkEnd");
    }
    this._state = "active";
  }

  /** M50-FSM-16: merge partial into policy */
  updatePolicy(partial: Partial<VoicePolicy>): void {
    this._policy = { ...this._policy, ...partial };
  }
}

