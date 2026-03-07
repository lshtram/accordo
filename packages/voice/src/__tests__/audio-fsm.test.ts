/**
 * M50-FSM AudioFsm tests — Phase B (all must FAIL before implementation)
 * Coverage: M50-FSM-20 → M50-FSM-26
 */

import { describe, it, expect, beforeEach } from "vitest";
import { AudioFsm } from "../core/fsm/audio-fsm.js";
import { VoiceFsmError } from "../core/fsm/types.js";

describe("AudioFsm", () => {
  let fsm: AudioFsm;
  beforeEach(() => { fsm = new AudioFsm(); });

  it("M50-FSM-20: starts in 'idle' state", () => {
    expect(fsm.state).toBe("idle");
  });

  it("M50-FSM-21: startCapture() transitions idle → listening", () => {
    fsm.startCapture();
    expect(fsm.state).toBe("listening");
  });

  it("M50-FSM-22: stopCapture() transitions listening → processing", () => {
    fsm.startCapture();
    fsm.stopCapture();
    expect(fsm.state).toBe("processing");
  });

  it("M50-FSM-23: transcriptReady() transitions processing → idle", () => {
    fsm.startCapture();
    fsm.stopCapture();
    fsm.transcriptReady();
    expect(fsm.state).toBe("idle");
  });

  it("M50-FSM-24: error() transitions processing → error", () => {
    fsm.startCapture();
    fsm.stopCapture();
    fsm.error();
    expect(fsm.state).toBe("error");
  });

  it("M50-FSM-25: reset() transitions error → idle", () => {
    fsm.startCapture();
    fsm.stopCapture();
    fsm.error();
    fsm.reset();
    expect(fsm.state).toBe("idle");
  });

  it("M50-FSM-26: invalid transition startCapture() from listening throws VoiceFsmError", () => {
    fsm.startCapture();
    expect(() => fsm.startCapture()).toThrowError(VoiceFsmError);
  });

  it("M50-FSM-26: invalid transition stopCapture() from idle throws VoiceFsmError", () => {
    expect(() => fsm.stopCapture()).toThrowError(VoiceFsmError);
  });

  it("M50-FSM-26: invalid transition transcriptReady() from idle throws VoiceFsmError", () => {
    expect(() => fsm.transcriptReady()).toThrowError(VoiceFsmError);
  });

  it("M50-FSM-26: VoiceFsmError carries fsm = 'AudioFsm'", () => {
    try {
      fsm.reset(); // invalid from idle
    } catch (e) {
      expect(e).toBeInstanceOf(VoiceFsmError);
      if (e instanceof VoiceFsmError) {
        expect(e.fsm).toBe("AudioFsm");
        expect(e.trigger).toBe("reset");
      }
    }
  });
});
