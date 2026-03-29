/**
 * State Diff
 *
 * Diff computation and patch serialization for IDEState.
 * Pure functions — no side effects, no VSCode dependency.
 *
 * Requirements: requirements-bridge.md §6.3
 */

import type { IDEState } from "@accordo/bridge-types";

/**
 * Build an empty IDEState for initialization.
 * Used as the baseline when no prior state has been sent (sentState === null).
 */
export function emptyState(): IDEState {
  return {
    activeFile: null,
    activeFileLine: 1,
    activeFileColumn: 1,
    openEditors: [],
    openTabs: [],
    visibleEditors: [],
    workspaceFolders: [],
    activeTerminal: null,
    workspaceName: null,
    remoteAuthority: null,
    modalities: {},
  };
}

/**
 * Compute the diff between currentState and sentState.
 * Returns only the fields that have changed, or null if nothing changed.
 *
 * §6.3: Arrays compared by value (JSON serialization).
 *        Scalars compared by strict equality.
 *        modalities compared per-key by JSON equality.
 *
 * @param currentState  The current local IDEState (source of truth)
 * @param sentState     The last state sent to Hub, or null if never sent
 * @returns             Partial patch with only changed fields, or null
 */
export function computePatch(
  currentState: IDEState,
  sentState: IDEState | null,
): Partial<IDEState> | null {
  const cur = currentState;
  const sent = sentState ?? emptyState();
  const patch: Partial<IDEState> = {};

  if (cur.activeFile !== sent.activeFile) patch.activeFile = cur.activeFile;
  if (cur.activeFileLine !== sent.activeFileLine) patch.activeFileLine = cur.activeFileLine;
  if (cur.activeFileColumn !== sent.activeFileColumn) patch.activeFileColumn = cur.activeFileColumn;
  if (cur.activeTerminal !== sent.activeTerminal) patch.activeTerminal = cur.activeTerminal;
  if (cur.workspaceName !== sent.workspaceName) patch.workspaceName = cur.workspaceName;
  if (cur.remoteAuthority !== sent.remoteAuthority) patch.remoteAuthority = cur.remoteAuthority;

  if (JSON.stringify(cur.openEditors) !== JSON.stringify(sent.openEditors))
    patch.openEditors = cur.openEditors;
  if (JSON.stringify(cur.openTabs) !== JSON.stringify(sent.openTabs))
    patch.openTabs = cur.openTabs;
  if (JSON.stringify(cur.visibleEditors) !== JSON.stringify(sent.visibleEditors))
    patch.visibleEditors = cur.visibleEditors;
  if (JSON.stringify(cur.workspaceFolders) !== JSON.stringify(sent.workspaceFolders))
    patch.workspaceFolders = cur.workspaceFolders;
  if (JSON.stringify(cur.modalities) !== JSON.stringify(sent.modalities))
    patch.modalities = cur.modalities;

  return Object.keys(patch).length > 0 ? patch : null;
}
