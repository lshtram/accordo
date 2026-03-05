/**
 * accordo-slidev — Modality State Contribution
 *
 * Owns the in-memory PresentationSessionState and publishes changes
 * to Hub via bridge.publishState("accordo-slidev", ...).
 *
 * Source: requirements-slidev.md §4 M44-STATE
 *
 * Requirements:
 *   M44-STATE-01  Publishes state key modalities["accordo-slidev"]
 *   M44-STATE-02  Includes isOpen, deckUri, currentSlide, totalSlides, narrationAvailable
 *   M44-STATE-03  Emits updates on open/close, navigation, narration events
 *   M44-STATE-04  Subscribes to runtime adapter events and webview lifecycle;
 *                 calls bridge.publishState on every state transition
 */

import type { BridgeAPI, PresentationSessionState } from "./types.js";
import { INITIAL_SESSION_STATE } from "./types.js";

const EXTENSION_ID = "accordo-slidev";

/**
 * M44-STATE — owns and broadcasts the presentation session state.
 */
export class PresentationStateContribution {
  private state: PresentationSessionState = { ...INITIAL_SESSION_STATE };

  constructor(private readonly bridge: BridgeAPI) {}

  /**
   * M44-STATE-03
   * Applies a partial update to the current state and publishes the result.
   */
  update(partial: Partial<PresentationSessionState>): void {
    this.state = { ...this.state, ...partial };
    this.publish();
  }

  /**
   * M44-PVD-06
   * Resets state to the closed/default shape and publishes.
   */
  reset(): void {
    this.state = { ...INITIAL_SESSION_STATE };
    this.publish();
  }

  /**
   * Returns a snapshot of the current state (not a reference).
   */
  getState(): PresentationSessionState {
    return { ...this.state };
  }

  /**
   * M44-STATE-04
   * Publishes the current state snapshot via bridge.publishState.
   * Called internally by update() and reset().
   */
  private publish(): void {
    // Spread into a new plain record to satisfy the Record<string, unknown> signature
    const payload: Record<string, unknown> = { ...this.state };
    this.bridge.publishState(EXTENSION_ID, payload);
  }
}
