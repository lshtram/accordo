# Bridge MCP config token drift — Phase A remediation plan

**Date:** 2026-04-21  
**Purpose:** one coherent remediation pass to clear all remaining Phase A blockers without introducing Phase C implementation logic.

---

## Scope guard

This pass is **Phase A only**.

Allowed:
- contracts/interfaces
- stubs throwing `not implemented`
- structural refactors for module-size/focus compliance
- design-doc corrections and stale-reference cleanup

Not allowed:
- real token-read/write behavior changes
- lifecycle behavior implementation beyond stubbed wiring seams
- production bugfix logic for reconnect/rotation

---

## Comprehensive pass strategy

The remaining failures are overlapping, so they will be handled as a **single architectural cleanup** rather than as isolated edits:

1. **Align lifecycle wiring with the approved Phase A design** by extracting ready/rotation config-sync planning into a focused module and making `extension-composition.ts` reference the correct two authorities at the interface level.
2. **Finish modular decomposition** of oversized source and test files so each touched file has one primary responsibility and stays within the project size gate.
3. **Remove stale Copilot references** so the code and docs consistently state that `syncMcpSettings()` in `extension-bootstrap.ts` is the authoritative user-level Copilot writer, while workspace agent config modules remain workspace-only.

This plan intentionally couples these changes because the stale references and file-size violations are concentrated in the same surfaces.

---

## Blocker 1 — `extension-composition` behavior mismatch with Phase A design

### Problem

Current `extension-composition.ts` still encodes pre-remediation behavior:
- reconnect path still skips workspace-config sync
- `onCredentialsRotated()` still updates memory only
- workspace config path still references `writeAgentConfigs()` directly instead of the approved storage-backed workspace sync seam

### Remediation

Create a focused lifecycle-planning/wiring helper for config sync triggers and move Phase A lifecycle intent there.

Planned shape:
- extract a small module for Hub lifecycle config-sync planning, e.g. `bridge-config-sync-plan.ts` or equivalent focused name
- that module will expose:
  - a typed plan/result for **Copilot sync request** (`syncMcpSettings()` authority)
  - a typed plan/result for **workspace sync request** (`writeAgentConfigsFromStorage()` authority)
  - helper(s) used by `buildHubManagerEvents()` so `extension-composition.ts` no longer hardcodes “skip on reconnect”
- `extension-composition.ts` will be reduced to orchestration, calling the helper/stub seams instead of embedding policy inline

### Done when

- `extension-composition.ts` no longer contains logic/commentary that says reconnect skips config sync
- `onHubReady()` references the two approved authorities at the interface level:
  - `syncMcpSettings()` for user-level Copilot config
  - `writeAgentConfigsFromStorage()` for workspace config sync
- `onCredentialsRotated()` also references both sync paths at the interface level
- any workspace-sync call site uses the explicit no-workspace-root model from `WorkspaceAgentConfigTarget`
- no real lifecycle fix is implemented yet beyond stubs/planning seams

### Exact files to touch

- `packages/bridge/src/extension-composition.ts`
- `packages/bridge/src/agent-config-sync.ts`
- `packages/bridge/src/extension-bootstrap.ts` (only if a type import/export seam is needed; no behavior change)
- **new focused source module** for config-sync planning/wiring
- `docs/reviews/bridge-mcp-config-token-drift-phase-a.md`

---

## Blocker 2 — modularity gate violations (`agent-config-writer.ts`, `extension-composition.ts`, `agent-config.test.ts`)

### Problem

Three files remain oversized and multi-concern:
- `agent-config-writer.ts`
- `extension-composition.ts`
- `agent-config.test.ts`

### Remediation

#### 2A. `agent-config-writer.ts`
Split by responsibility:
- one file for workspace file writers (`opencode.json`, `.claude/mcp.json`)
- one file for workspace support helpers (`appendGitignore`, settings helpers)
- remove or isolate the stale legacy workspace Copilot writer surface

#### 2B. `extension-composition.ts`
Split by responsibility:
- one file for `HubManagerEvents` construction / lifecycle wiring
- one file for `WsClientEvents`
- one file for command registration and/or BridgeAPI composition if needed
- keep each file focused and below gate size

#### 2C. `agent-config.test.ts`
Split by concern:
- builders tests
- workspace writers/orchestrator tests
- settings/gitignore helper tests
- remove/update stale file header text while splitting

### Done when

- each reviewed source/test file touched in this pass is `<= 150` lines
- each touched file has one primary responsibility
- no file bundles unrelated concerns just to preserve old import paths
- imports continue to compile cleanly through barrels/re-exports where needed
- test headers/comments accurately describe current Phase A status

### Exact files to touch

- `packages/bridge/src/agent-config-writer.ts`
- `packages/bridge/src/agent-config.ts` (barrel adjustments only)
- `packages/bridge/src/workspace-agent-config.ts`
- `packages/bridge/src/extension-composition.ts`
- **new focused source modules** extracted from the above
- `packages/bridge/src/__tests__/agent-config.test.ts`
- **new focused test files** replacing the monolithic test file

---

## Blocker 3 — stale header / stale references / Copilot writer authority mismatch

### Problem

There are still stale references that contradict the approved authority split:
- legacy comments/code still imply workspace Copilot writer ownership
- stale test header says functions are all stubs/red when many are implemented
- some Phase A references still describe delegation vaguely enough to blur the authority boundary

### Remediation

Clean all stale references in one pass:
- update design doc language so it consistently says:
  - `syncMcpSettings()` in `extension-bootstrap.ts` is authoritative for `MCP-02/MCP-04`
  - workspace agent config modules own only `CFG-01`/`CFG-02`/`CFG-03` workspace files
- remove or quarantine the unused legacy workspace `writeCopilotConfig()` path from active reviewed modules
- update stale headers/comments in tests and source files

### Done when

- no reviewed Phase A doc/source file states or implies that workspace agent config modules own Copilot user-level config
- `agent-config-writer.ts` no longer advertises an active authoritative Copilot path inconsistent with the design
- test/source headers no longer contain stale “all functions are stubs” or equivalent outdated claims
- the design doc and source surface use the same authority vocabulary

### Exact files to touch

- `docs/reviews/bridge-mcp-config-token-drift-phase-a.md`
- `packages/bridge/src/agent-config-writer.ts`
- `packages/bridge/src/agent-config.ts`
- extracted writer/helper modules created in this pass
- split test files replacing `packages/bridge/src/__tests__/agent-config.test.ts`

---

## Execution order for the single pass

1. **Refactor source module layout first**
   - split `agent-config-writer.ts`
   - split `extension-composition.ts`
2. **Introduce focused Phase A lifecycle planning seam**
   - wire `onHubReady()` / `onCredentialsRotated()` to the two approved authorities at stub/contract level only
3. **Split tests by concern**
   - replace monolithic `agent-config.test.ts`
4. **Clean stale comments/docs/headers**
   - remove authority ambiguity and stale wording everywhere touched
5. **Typecheck only**
   - verify imports/barrels remain coherent

This keeps the pass coherent: structure first, then surface alignment, then stale-reference cleanup.

---

## Success criteria for the full remediation pass

- all current blockers from `bridge-mcp-config-token-drift-phase-a-review.md` are addressed in one pass
- lifecycle wiring in `extension-composition` matches the approved Phase A design at the contract/stub level
- no touched source/test file exceeds 150 lines
- Copilot authority is unambiguous across docs and code
- no Phase C implementation logic is introduced

---

## Final closure step — stale `extension-composition` reconnect tests

### Exact test cases/sections to update or replace

- Replace the stale reconnect section at `packages/bridge/src/__tests__/extension-composition.test.ts:833-872`
  - remove the old `AR-05` assertion that reconnect skips config sync
  - remove the old `AR-06` assertion that lifecycle wiring calls `writeAgentConfigs()` directly
- Update the stale module mock block near the old `writeAgentConfigs` mock so the test file mocks the current seams instead:
  - `requestConfigSyncs()` from `extension-config-sync-seams.ts`
  - `setupWsClient()` from `extension-ws-client-setup.ts`

### New expected behavior assertions

- `onHubReady(port, token, true)` requests config sync via `requestConfigSyncs(deps, port, token)`
- `onHubReady(port, token)` also requests config sync via the same seam
- `onHubReady(...)` no longer distinguishes reconnect vs fresh spawn at the sync-request level
- `onCredentialsRotated(token, secret)` requests config sync via `requestConfigSyncs(deps, currentHubPort, token)`
- `onCredentialsRotated(token, secret)` still updates the in-memory token and WS secret when `updateSecret()` exists
- no assertion refers to `writeAgentConfigs()` as the lifecycle hook under test

### Done when

- the stale reconnect block is removed or rewritten to assert current Phase A seams only
- the test file references `requestConfigSyncs()` instead of `writeAgentConfigs()` for lifecycle sync assertions
- reconnect and rotation tests both reflect the approved authority split indirectly through the seam
- targeted `extension-composition` tests pass together with bridge typecheck
