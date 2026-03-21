/**
 * presentation-state.test.ts — Tests for PresentationStateContribution
 *
 * PresentationStateContribution manages and publishes the accordo-marp modality
 * state. It is a thin state container that merges partial updates and calls
 * bridge.publishState on every transition.
 *
 * Requirements covered:
 *   M50-STATE-01  Publishes state key "accordo-marp" (NOT "accordo-slidev")
 *   M50-STATE-02  Includes isOpen, deckUri, currentSlide, totalSlides, narrationAvailable
 *   M50-STATE-03  Emits updates on open/close, navigation, narration events
 *   M50-STATE-04  Calls bridge.publishState on every state transition
 *
 * Test state: ALL tests expected to FAIL with "not implemented" until implementation lands.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { PresentationStateContribution } from "../presentation-state.js";
import { INITIAL_SESSION_STATE } from "../types.js";
import type { BridgeAPI } from "../types.js";

function makeBridge(): BridgeAPI {
  return {
    registerTools: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    publishState: vi.fn(),
  };
}

// ── Initial state ──────────────────────────────────────────────────────────────

describe("PresentationStateContribution — initial state", () => {
  it("M50-STATE-02: getState returns closed initial state on construction", () => {
    // The state starts in the INITIAL_SESSION_STATE shape.
    const bridge = makeBridge();
    const contrib = new PresentationStateContribution(bridge);
    const state = contrib.getState();
    expect(state).toEqual(INITIAL_SESSION_STATE);
    expect(state.isOpen).toBe(false);
    expect(state.deckUri).toBeNull();
    expect(state.currentSlide).toBe(0);
    expect(state.totalSlides).toBe(0);
    expect(state.narrationAvailable).toBe(false);
  });
});

// ── update() ──────────────────────────────────────────────────────────────────

describe("PresentationStateContribution — update()", () => {
  let bridge: BridgeAPI;
  let contrib: PresentationStateContribution;

  beforeEach(() => {
    bridge = makeBridge();
    contrib = new PresentationStateContribution(bridge);
  });

  it("M50-STATE-03: update() merges partial state without clobbering unchanged fields", () => {
    // Only the provided fields should change; others remain at their previous value.
    contrib.update({ isOpen: true, deckUri: "/deck/slides.md", totalSlides: 10 });
    const state = contrib.getState();
    expect(state.isOpen).toBe(true);
    expect(state.deckUri).toBe("/deck/slides.md");
    expect(state.totalSlides).toBe(10);
    // unchanged fields must be preserved
    expect(state.narrationAvailable).toBe(false);
    expect(state.currentSlide).toBe(0);
  });

  it("M50-STATE-04: update() calls bridge.publishState exactly once per call", () => {
    // Every single update must trigger exactly one publishState call.
    contrib.update({ currentSlide: 3 });
    expect(bridge.publishState).toHaveBeenCalledTimes(1);
  });

  it("M50-STATE-01: publishState called with extensionId 'accordo-marp'", () => {
    // The state key MUST be 'accordo-marp', not 'accordo-slidev'.
    contrib.update({ currentSlide: 2 });
    expect(bridge.publishState).toHaveBeenCalledWith(
      "accordo-marp",
      expect.any(Object),
    );
  });

  it("M50-STATE-02: published payload includes all required state fields", () => {
    // The published state object must include all PresentationSessionState fields.
    contrib.update({ isOpen: true, deckUri: "/deck.md", currentSlide: 1, totalSlides: 5 });
    const [, payload] = (bridge.publishState as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(payload).toMatchObject({
      isOpen: true,
      deckUri: "/deck.md",
      currentSlide: 1,
      totalSlides: 5,
      narrationAvailable: false,
    });
  });

  it("M50-STATE-03: consecutive updates each trigger a separate publish", () => {
    // Three state transitions must produce three publishState calls.
    contrib.update({ currentSlide: 1 });
    contrib.update({ currentSlide: 2 });
    contrib.update({ narrationAvailable: true });
    expect(bridge.publishState).toHaveBeenCalledTimes(3);
  });

  it("M50-STATE-03: update() does not mutate the previous state snapshot", () => {
    // Snapshots obtained before a subsequent update must be immutable.
    contrib.update({ totalSlides: 8 });
    const snap1 = contrib.getState();
    contrib.update({ currentSlide: 4 });
    const snap2 = contrib.getState();
    // snap1 was captured before the second update
    expect(snap1.currentSlide).toBe(0);
    expect(snap2.currentSlide).toBe(4);
  });

  it("M50-STATE-03: update() can set narrationAvailable to true", () => {
    // Narration generation events must be propagatable via update.
    contrib.update({ narrationAvailable: true });
    expect(contrib.getState().narrationAvailable).toBe(true);
  });
});

// ── reset() ───────────────────────────────────────────────────────────────────

describe("PresentationStateContribution — reset()", () => {
  it("M50-STATE-03: reset() restores state to INITIAL_SESSION_STATE", () => {
    // After reset, the state must be identical to the initial closed state.
    const bridge = makeBridge();
    const contrib = new PresentationStateContribution(bridge);
    contrib.update({ isOpen: true, deckUri: "/deck.md", currentSlide: 3, totalSlides: 10 });
    contrib.reset();
    expect(contrib.getState()).toEqual(INITIAL_SESSION_STATE);
  });

  it("M50-STATE-04: reset() calls bridge.publishState", () => {
    // Closing the session is a state transition that must be published.
    const bridge = makeBridge();
    const contrib = new PresentationStateContribution(bridge);
    vi.mocked(bridge.publishState).mockClear();
    contrib.reset();
    expect(bridge.publishState).toHaveBeenCalledTimes(1);
  });

  it("M50-STATE-01: reset() publishes with extensionId 'accordo-marp'", () => {
    // Even the reset must use the 'accordo-marp' namespace.
    const bridge = makeBridge();
    const contrib = new PresentationStateContribution(bridge);
    contrib.reset();
    expect(bridge.publishState).toHaveBeenCalledWith("accordo-marp", expect.any(Object));
  });

  it("M50-STATE-03: reset() published payload equals INITIAL_SESSION_STATE", () => {
    // The reset payload must match the initial closed state exactly.
    const bridge = makeBridge();
    const contrib = new PresentationStateContribution(bridge);
    contrib.update({ isOpen: true, deckUri: "/deck.md" });
    vi.mocked(bridge.publishState).mockClear();
    contrib.reset();
    const [, payload] = (bridge.publishState as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(payload).toMatchObject(INITIAL_SESSION_STATE);
  });
});

// ── getState() isolation ──────────────────────────────────────────────────────

describe("PresentationStateContribution — getState() isolation", () => {
  it("M50-STATE-02: getState returns a copy, not a live reference", () => {
    // Mutating the returned state object must not affect the internal state.
    const bridge = makeBridge();
    const contrib = new PresentationStateContribution(bridge);
    const snap = contrib.getState();
    // Force a mutation attempt
    (snap as { isOpen: boolean }).isOpen = true;
    expect(contrib.getState().isOpen).toBe(false);
  });

  it("M50-STATE-02: two consecutive getState() calls return equal but distinct objects", () => {
    // Must not leak the same reference on consecutive calls.
    const bridge = makeBridge();
    const contrib = new PresentationStateContribution(bridge);
    const snap1 = contrib.getState();
    const snap2 = contrib.getState();
    expect(snap1).toEqual(snap2);
    // They should be different object references
    expect(snap1).not.toBe(snap2);
  });
});
