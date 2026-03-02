/**
 * Hub State Cache
 *
 * Maintains a live snapshot of IDE state, patched incrementally
 * from Bridge WebSocket messages.
 *
 * Requirements: requirements-hub.md §5.2
 */

import type { IDEState } from "@accordo/bridge-types";

/**
 * Creates a new empty IDEState with all fields initialized to defaults.
 */
export function createEmptyState(): IDEState {
  return {
    activeFile: null,
    activeFileLine: 1,
    activeFileColumn: 1,
    openEditors: [],
    visibleEditors: [],
    workspaceFolders: [],
    activeTerminal: null,
    workspaceName: null,
    remoteAuthority: null,
    modalities: {},
  };
}

export class StateCache {
  private state: IDEState;

  constructor() {
    this.state = createEmptyState();
  }

  /**
   * Merge a partial patch into the current state.
   * Top-level fields are replaced; modalities are shallow-merged
   * (per-extension key replacement).
   *
   * @param patch - Partial IDEState with fields to update
   */
  applyPatch(patch: Partial<IDEState>): void {
    if (patch.modalities !== undefined) {
      this.state = {
        ...this.state,
        ...patch,
        modalities: { ...this.state.modalities, ...patch.modalities },
      };
    } else {
      this.state = { ...this.state, ...patch };
    }
  }

  /**
   * Replace the entire state snapshot.
   * Used on initial Bridge connection and reconnect.
   *
   * @param state - Complete IDEState to set
   */
  setSnapshot(state: IDEState): void {
    this.state = JSON.parse(JSON.stringify(state)) as IDEState;
  }

  /**
   * Return a deep copy of the current state.
   */
  getState(): IDEState {
    return JSON.parse(JSON.stringify(this.state)) as IDEState;
  }

  /**
   * Clear only the modalities field (set to empty object).
   * Called when Bridge disconnects and the state-hold timeout expires.
   */
  clearModalities(): void {
    this.state = { ...this.state, modalities: {} };
  }
}
