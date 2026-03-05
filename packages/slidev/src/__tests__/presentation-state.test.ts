/**
 * presentation-state.test.ts — Tests for PresentationStateContribution
 *
 * Requirements covered:
 *   M44-STATE-01  Publishes state key modalities["accordo-slidev"]
 *   M44-STATE-02  Includes isOpen, deckUri, currentSlide, totalSlides, narrationAvailable
 *   M44-STATE-03  Emits updates on open/close, navigation, narration events
 *   M44-STATE-04  Calls bridge.publishState on every state transition
 *   M44-PVD-06   On dispose, state resets to closed shape
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

// ── Initial state ─────────────────────────────────────────────────────────────

describe("PresentationStateContribution — initial state", () => {
  it("M44-STATE-02: getState returns closed initial state on construction", () => {
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

// ── update() ─────────────────────────────────────────────────────────────────

describe("PresentationStateContribution — update()", () => {
  let bridge: BridgeAPI;
  let contrib: PresentationStateContribution;

  beforeEach(() => {
    bridge = makeBridge();
    contrib = new PresentationStateContribution(bridge);
  });

  it("M44-STATE-03: update() merges partial state", () => {
    contrib.update({ isOpen: true, deckUri: "/deck/slides.md", totalSlides: 10 });
    const state = contrib.getState();
    expect(state.isOpen).toBe(true);
    expect(state.deckUri).toBe("/deck/slides.md");
    expect(state.totalSlides).toBe(10);
    // unchanged field preserved
    expect(state.narrationAvailable).toBe(false);
  });

  it("M44-STATE-04: update() calls bridge.publishState once per call", () => {
    contrib.update({ currentSlide: 3 });
    expect(bridge.publishState).toHaveBeenCalledTimes(1);
  });

  it("M44-STATE-01: publishState called with extensionId 'accordo-slidev'", () => {
    contrib.update({ currentSlide: 2 });
    expect(bridge.publishState).toHaveBeenCalledWith(
      "accordo-slidev",
      expect.any(Object),
    );
  });

  it("M44-STATE-02: published payload includes all required fields", () => {
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

  it("M44-STATE-03: consecutive updates each trigger a publish", () => {
    contrib.update({ currentSlide: 1 });
    contrib.update({ currentSlide: 2 });
    contrib.update({ narrationAvailable: true });
    expect(bridge.publishState).toHaveBeenCalledTimes(3);
  });

  it("M44-STATE-03: update() does not mutate the previous state snapshot", () => {
    contrib.update({ totalSlides: 8 });
    const snap1 = contrib.getState();
    contrib.update({ currentSlide: 4 });
    const snap2 = contrib.getState();
    // snap1 was taken before second update — it should reflect only totalSlides change
    expect(snap1.currentSlide).toBe(0);
    expect(snap2.currentSlide).toBe(4);
  });
});

// ── reset() ──────────────────────────────────────────────────────────────────

describe("PresentationStateContribution — reset()", () => {
  it("M44-PVD-06: reset() restores state to INITIAL_SESSION_STATE", () => {
    const bridge = makeBridge();
    const contrib = new PresentationStateContribution(bridge);
    contrib.update({ isOpen: true, deckUri: "/deck.md", currentSlide: 3, totalSlides: 10 });
    contrib.reset();
    expect(contrib.getState()).toEqual(INITIAL_SESSION_STATE);
  });

  it("M44-STATE-04: reset() calls bridge.publishState", () => {
    const bridge = makeBridge();
    const contrib = new PresentationStateContribution(bridge);
    vi.mocked(bridge.publishState).mockClear();
    contrib.reset();
    expect(bridge.publishState).toHaveBeenCalledTimes(1);
  });

  it("M44-STATE-01: reset publishes with extensionId 'accordo-slidev'", () => {
    const bridge = makeBridge();
    const contrib = new PresentationStateContribution(bridge);
    contrib.reset();
    expect(bridge.publishState).toHaveBeenCalledWith("accordo-slidev", expect.any(Object));
  });
});

// ── getState() isolation ──────────────────────────────────────────────────────

describe("PresentationStateContribution — getState() isolation", () => {
  it("M44-STATE-02: getState returns a copy, not a live reference", () => {
    const bridge = makeBridge();
    const contrib = new PresentationStateContribution(bridge);
    const snap = contrib.getState();
    // mutating the snapshot should not affect internal state
    (snap as { isOpen: boolean }).isOpen = true;
    expect(contrib.getState().isOpen).toBe(false);
  });
});
