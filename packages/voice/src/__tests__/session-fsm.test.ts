/**
 * M50-FSM SessionFsm tests — Phase B (all must FAIL before implementation)
 * Coverage: M50-FSM-10 → M50-FSM-17
 */

import { describe, it, expect, beforeEach } from "vitest";
import { SessionFsm } from "../core/fsm/session-fsm.js";
import { VoiceFsmError, DEFAULT_VOICE_POLICY } from "../core/fsm/types.js";

describe("SessionFsm", () => {
  let fsm: SessionFsm;
  beforeEach(() => { fsm = new SessionFsm(); });

  it("M50-FSM-10: starts in 'inactive' state", () => {
    expect(fsm.state).toBe("inactive");
  });

  it("M50-FSM-11: enable() transitions inactive → active", () => {
    fsm.enable();
    expect(fsm.state).toBe("active");
  });

  it("M50-FSM-11: enable() is idempotent when already active", () => {
    fsm.enable();
    fsm.enable();
    expect(fsm.state).toBe("active");
  });

  it("M50-FSM-12: disable() transitions active → inactive", () => {
    fsm.enable();
    fsm.disable();
    expect(fsm.state).toBe("inactive");
  });

  it("M50-FSM-12: disable() transitions suspended → inactive", () => {
    fsm.enable();
    fsm.pushToTalkStart();
    fsm.disable();
    expect(fsm.state).toBe("inactive");
  });

  it("M50-FSM-12: disable() is idempotent when already inactive", () => {
    fsm.disable();
    expect(fsm.state).toBe("inactive");
  });

  it("M50-FSM-13: pushToTalkStart() transitions active → suspended", () => {
    fsm.enable();
    fsm.pushToTalkStart();
    expect(fsm.state).toBe("suspended");
  });

  it("M50-FSM-14: pushToTalkEnd() transitions suspended → active", () => {
    fsm.enable();
    fsm.pushToTalkStart();
    fsm.pushToTalkEnd();
    expect(fsm.state).toBe("active");
  });

  it("M50-FSM-15: invalid transition throws VoiceFsmError", () => {
    // pushToTalkStart from inactive is invalid
    expect(() => fsm.pushToTalkStart()).toThrowError(VoiceFsmError);
  });

  it("M50-FSM-15: VoiceFsmError carries fsm, from, trigger fields", () => {
    try {
      fsm.pushToTalkEnd(); // invalid from inactive
    } catch (e) {
      expect(e).toBeInstanceOf(VoiceFsmError);
      if (e instanceof VoiceFsmError) {
        expect(e.fsm).toBe("SessionFsm");
        expect(e.from).toBe("inactive");
        expect(e.trigger).toBe("pushToTalkEnd");
      }
    }
  });

  it("M50-FSM-16: updatePolicy() merges partial into current policy", () => {
    fsm.updatePolicy({ speed: 1.5 });
    expect(fsm.policy.speed).toBe(1.5);
    // Other fields preserved
    expect(fsm.policy.narrationMode).toBe(DEFAULT_VOICE_POLICY.narrationMode);
  });

  it("M50-FSM-17: policy getter returns a copy (mutations don't affect internal state)", () => {
    const p = fsm.policy;
    p.speed = 999;
    expect(fsm.policy.speed).toBe(DEFAULT_VOICE_POLICY.speed);
  });
});
