/**
 * M50-FSM NarrationFsm tests — Phase B (all must FAIL before implementation)
 * Coverage: M50-FSM-30 → M50-FSM-38
 */

import { describe, it, expect, beforeEach } from "vitest";
import { NarrationFsm, type NarrationRequest } from "../core/fsm/narration-fsm.js";

const narrate = (text: string): NarrationRequest => ({ text, mode: "narrate-everything" });
const req1 = narrate("Hello world");
const req2 = narrate("Second sentence");

describe("NarrationFsm", () => {
  let fsm: NarrationFsm;
  beforeEach(() => { fsm = new NarrationFsm(); });

  it("M50-FSM-30: starts in 'idle' state with empty queue", () => {
    expect(fsm.state).toBe("idle");
    expect(fsm.queueLength).toBe(0);
  });

  it("M50-FSM-31: enqueue() transitions idle → queued and stores request", () => {
    fsm.enqueue(req1);
    expect(fsm.state).toBe("queued");
    expect(fsm.queueLength).toBe(1);
  });

  it("M50-FSM-32: enqueue() with narrate-off mode is a no-op", () => {
    fsm.enqueue({ text: "ignored", mode: "narrate-off" });
    expect(fsm.state).toBe("idle");
    expect(fsm.queueLength).toBe(0);
  });

  it("M50-FSM-31: enqueue() when already queued pushes without transitioning", () => {
    fsm.enqueue(req1);
    fsm.startProcessing();
    fsm.enqueue(req2);
    expect(fsm.state).toBe("processing");
    expect(fsm.queueLength).toBe(2); // req1 (processing) + req2 (waiting) both in queue
  });

  it("M50-FSM-33: startProcessing() transitions queued → processing", () => {
    fsm.enqueue(req1);
    fsm.startProcessing();
    expect(fsm.state).toBe("processing");
  });

  it("M50-FSM-34: audioReady() transitions processing → playing", () => {
    fsm.enqueue(req1);
    fsm.startProcessing();
    fsm.audioReady();
    expect(fsm.state).toBe("playing");
  });

  it("M50-FSM-35: pause() transitions playing → paused", () => {
    fsm.enqueue(req1);
    fsm.startProcessing();
    fsm.audioReady();
    fsm.pause();
    expect(fsm.state).toBe("paused");
  });

  it("M50-FSM-36: resume() transitions paused → playing", () => {
    fsm.enqueue(req1);
    fsm.startProcessing();
    fsm.audioReady();
    fsm.pause();
    fsm.resume();
    expect(fsm.state).toBe("playing");
  });

  it("M50-FSM-37: complete() with empty queue → idle returns undefined", () => {
    fsm.enqueue(req1);
    fsm.startProcessing();
    fsm.audioReady();
    const next = fsm.complete();
    expect(next).toBeUndefined();
    expect(fsm.state).toBe("idle");
  });

  it("M50-FSM-37: complete() with more queued items → queued returns next request", () => {
    fsm.enqueue(req1);
    fsm.startProcessing();
    fsm.enqueue(req2); // queue next while processing
    fsm.audioReady();
    const next = fsm.complete();
    expect(next).toEqual(req2);
    expect(fsm.state).toBe("queued");
  });

  it("M50-FSM-38: error() from queued → idle", () => {
    fsm.enqueue(req1);
    fsm.error();
    expect(fsm.state).toBe("idle");
  });

  it("M50-FSM-38: error() from processing → idle", () => {
    fsm.enqueue(req1);
    fsm.startProcessing();
    fsm.error();
    expect(fsm.state).toBe("idle");
  });

  it("M50-FSM-38: error() from playing → idle", () => {
    fsm.enqueue(req1);
    fsm.startProcessing();
    fsm.audioReady();
    fsm.error();
    expect(fsm.state).toBe("idle");
  });

  it("M50-FSM-38: error() clears queue", () => {
    fsm.enqueue(req1);
    fsm.enqueue(req2);
    fsm.error();
    expect(fsm.queueLength).toBe(0);
  });
});
