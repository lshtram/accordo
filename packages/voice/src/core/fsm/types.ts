/**
 * FSM shared types for the Voice subsystem.
 *
 * M50-FSM-01 through M50-FSM-09
 */

// ---------------------------------------------------------------------------
// AudioFsm types — M50-FSM-01, M50-FSM-02
// ---------------------------------------------------------------------------

export type AudioState = "idle" | "listening" | "processing" | "error";
export type AudioTrigger = "startCapture" | "stopCapture" | "transcriptReady" | "sttError" | "reset";

// ---------------------------------------------------------------------------
// NarrationFsm types — M50-FSM-03, M50-FSM-04
// ---------------------------------------------------------------------------

export type NarrationState = "idle" | "queued" | "processing" | "playing" | "paused";
export type NarrationTrigger = "enqueue" | "startProcessing" | "audioReady" | "pause" | "resume" | "complete" | "error";

// ---------------------------------------------------------------------------
// SessionFsm types — M50-FSM-05, M50-FSM-06
// ---------------------------------------------------------------------------

export type SessionState = "inactive" | "active" | "suspended";
export type SessionTrigger = "enable" | "disable" | "pushToTalkStart" | "pushToTalkEnd";

// ---------------------------------------------------------------------------
// Narration mode — M50-FSM-07
// ---------------------------------------------------------------------------

export type NarrationMode = "narrate-off" | "narrate-everything" | "narrate-summary";

/** All valid narration modes. M50-FSM-07 */
export const NARRATION_MODES: readonly NarrationMode[] = [
  "narrate-off",
  "narrate-everything",
  "narrate-summary",
] as const;

// ---------------------------------------------------------------------------
// VoicePolicy — M50-FSM-08
// ---------------------------------------------------------------------------

export interface VoicePolicy {
  enabled: boolean;
  narrationMode: NarrationMode;
  speed: number;
  voice: string;
  language: string;
}

export const DEFAULT_VOICE_POLICY: VoicePolicy = {
  enabled: false,
  narrationMode: "narrate-off",
  speed: 1.0,
  voice: "af_sarah",
  language: "en",
};

// ---------------------------------------------------------------------------
// VoiceFsmError — M50-FSM-09
// ---------------------------------------------------------------------------

/** Thrown on invalid FSM transitions. M50-FSM-09 */
export class VoiceFsmError extends Error {
  constructor(
    public readonly fsm: string,
    public readonly from: string,
    public readonly trigger: string,
  ) {
    super(`[${fsm}] Invalid transition '${trigger}' from state '${from}'`);
    this.name = "VoiceFsmError";
  }
}
