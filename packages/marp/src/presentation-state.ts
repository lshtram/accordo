/**
 * accordo-marp — Modality State Contribution
 *
 * Source: requirements-marp.md §4 M50-STATE
 */

import type { BridgeAPI, PresentationSessionState } from "./types.js";
import { INITIAL_SESSION_STATE } from "./types.js";

export class PresentationStateContribution {
  private state: PresentationSessionState = { ...INITIAL_SESSION_STATE };

  constructor(private readonly bridge: BridgeAPI) {}

  update(partial: Partial<PresentationSessionState>): void {
    this.state = { ...this.state, ...partial };
    this.publish();
  }

  reset(): void {
    this.state = { ...INITIAL_SESSION_STATE };
    this.publish();
  }

  getState(): PresentationSessionState {
    return { ...this.state };
  }

  private publish(): void {
    const payload: Record<string, unknown> = { ...this.state };
    this.bridge.publishState("accordo-marp", payload);
  }
}
