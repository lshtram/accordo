# Review — bridge-mcp-config-token-drift — Phase A

## Verdict

**PASS**

All previously reported Phase A blockers are resolved in current HEAD.

## PASS

- `docs/reviews/bridge-mcp-config-token-drift-phase-a.md:70-95` is coherent with the current extraction and lifecycle seam design.
- `packages/bridge/src/extension-hub-manager-events.ts:6-30` matches the approved Phase A lifecycle behavior:
  - reconnect no longer skips config sync
  - credential rotation triggers config sync
- `packages/bridge/src/extension-config-sync-seams.ts:6-54` cleanly separates authorities:
  - `syncMcpSettings()` remains the sole Copilot/user-level writer
  - `writeAgentConfigsFromStorage()` remains the workspace-only storage-backed seam
- `packages/bridge/src/agent-config-sync.ts:15-34` retains explicit no-workspace-root modeling with `WorkspaceAgentConfigTarget`.
- Previously flagged modularity issues are resolved for the reviewed files. Current line counts are all within the 150-line gate:
  - `extension-composition.ts` — 13
  - `extension-hub-manager-events.ts` — 32
  - `extension-config-sync-seams.ts` — 54
  - `agent-config.ts` — 30
  - `agent-config-sync.ts` — 40
  - `agent-config-writer.ts` — 5
  - `workspace-agent-config.ts` — 43
  - `workspace-agent-config-file-writer.ts` — 49
  - `__tests__/extension-config-sync-seams.test.ts` — 44
  - `__tests__/workspace-agent-config-builders.test.ts` — 32
- `packages/bridge/src/__tests__/extension-composition.test.ts:838-878` now asserts the current seam behavior instead of the stale reconnect-skip behavior.

## Blockers

None.

## Non-blockers

- `docs/reviews/bridge-mcp-config-token-drift-phase-a.md:12-14` still describes the original bug symptoms in historical terms, which is appropriate for a Phase A design doc and not a freshness issue.

## Freshness check against current HEAD

- **Fresh:** design doc and current lifecycle seam code agree on reconnect and rotation behavior.
- **Fresh:** extension-composition lifecycle seam assertions in tests now match current code and Phase A design.
- **Fresh:** no-workspace-root modeling is still present and explicit.
- **Fresh:** Copilot authority remains clearly user-level only; no stale workspace-Copilot authority reference was found in the reviewed files.
- **Fresh:** no open Phase A blockers remain in the reviewed scope.

## Summary for project-manager

Phase A gate passes for `bridge-mcp-config-token-drift`.
