# Hub Module Cleanup Plan

## A. Must update

### `docs/20-requirements/requirements-hub.md`
- [ ] Reconcile token persistence contract with actual implementation
- [ ] Decide whether Hub tokens are:
  - memory-only, or
  - persisted to `tokenFilePath` during reauth
- [ ] Reconcile `/mcp` transport contract with reality:
  - if GET `/mcp` SSE is supported, document it
  - if it should be removed, update code/tests
- [ ] Reconcile bridge connection policy:
  - reject second connection with 409, or
  - evict stale bridge and accept new one
- [ ] Remove the internal contradiction about grouped tools visibility in prompt/tool summaries
- [ ] Add missing implemented endpoints to the interface section:
  - `/bridge/disconnect`
  - `/browser/status` (if still intended public/internal endpoint)
- [ ] Reconcile heartbeat/liveness requirements with actual implemented ping interval and disconnect behavior

### `docs/module-map-hub.md`
- [ ] Rewrite to match current hub package layout and behavior
- [ ] Remove stale token/PID/port file claims if no longer canonical
- [ ] Fix package naming if it still uses `@accordo/hub` instead of `accordo-hub`
- [ ] Reconcile `/mcp` endpoint description with current implementation

### `packages/hub/README.md`
- [ ] Update endpoint table to match actual runtime surface
- [ ] Add/clarify `/bridge/disconnect` if it is an active supported endpoint
- [ ] Update `/health` response example to current shape
- [ ] Update CLI/config docs to reflect current flags and behavior
- [ ] Reconcile grace-window wording with current reconnect-first implementation
- [ ] Update stale test count to current reality
- [ ] Remove stale claims such as gzip audit archiving if not actually implemented

### `docs/10-architecture/architecture.md`
- [ ] Update hub file-structure section to current filenames
- [ ] Remove references to missing files like old `protocol.ts` / `health.ts` shapes if no longer present
- [ ] Reconcile architecture text with actual reconnect-first + current transport behavior

## B. High-priority code cleanup

### `packages/hub/src/bridge-dispatch.ts`
- [ ] Fix current lint errors for missing explicit return types
- [ ] Review the existing non-null assertion and remove/justify it

### `packages/hub/src/prompt-engine.ts`
- [ ] Remove or justify the current non-null assertion flagged by lint
- [ ] Reconcile grouped-tool visibility behavior with the final requirements decision

### `packages/hub/src/server.ts`
- [ ] Remove or justify the non-null assertion in shutdown path
- [ ] Reconcile token file writing behavior with final contract decision

### `packages/hub/src/disconnect-handler.ts`
- [ ] Remove stale “STUB/not implemented” style comments if implementation is complete
- [ ] Align comments with current reconnect-first semantics

### `packages/hub/src/tool-registry.ts`
- [ ] Reconcile comment claiming “hub-native tools appear first” with actual merge order semantics
- [ ] Make ordering/precedence behavior explicit and truthful in code comments/tests/docs

## C. Test cleanup / additions

### Existing tests needing alignment
- [ ] Align token-file persistence tests with the final requirements decision
- [ ] Align bridge-connection tests with the final single-connection policy decision
- [ ] Align `/mcp` GET/SSE tests with the final public transport contract

### Missing tests to add
- [ ] Add a test for missed-pong / heartbeat timeout behavior if that remains part of the spec
- [ ] Add stdio-mode tests for the final intended auth behavior (`ACCORDO_TOKEN` required or not)
- [ ] Add explicit tests for documented endpoint surface if `/bridge/disconnect` and `/browser/status` are part of the public/internal contract

### Current testing guide gap
- [ ] Add or refresh a current non-archived hub testing guide aligned to the current implementation

## D. Tooling / repo hygiene

### Restore clean quality gate
- [ ] Fix hub lint baseline to green (currently 2 errors, 3 warnings)

### Generated/package-local artifacts
- [ ] Confirm `packages/hub/dist/**` is treated as generated output only
- [ ] Clean or ignore `tsconfig.tsbuildinfo`
- [ ] Clean or ignore package-local Vitest result artifacts under `node_modules/.vite/vitest/`
- [ ] Remove stray debug/runtime artifact if unneeded:
  - `packages/hub/off`

## E. Documentation / archive cleanup

### Active docs to refresh
- [ ] `requirements-hub.md`
- [ ] `module-map-hub.md`
- [ ] `packages/hub/README.md`
- [ ] relevant hub section in top-level architecture docs

### Historical docs to mark/archive harder
- [ ] hub script-routing docs that remain searchable after script removal
- [ ] old multi-session / ephemeral-hub review trail, clearly marked historical where superseded by reconnect-first docs
- [ ] annotate `accomplished-tasks.md` so removed built-in scripting does not read as still-active capability

### ADR status cleanup
- [ ] Update `docs/10-architecture/adr-reload-reconnect.md` status if it is no longer merely proposed

## F. Cross-module contract cleanup

### Hub ↔ bridge lifecycle contract
- [ ] Make one canonical statement about:
  - reconnect grace behavior
  - token rotation persistence
  - bridge replacement/eviction policy
  - disconnect endpoint behavior
- [ ] Align bridge docs and hub docs to the same lifecycle model

### Prompt/tool visibility contract
- [ ] Make one canonical statement about grouped tools in prompt visibility/tool summaries
- [ ] Ensure prompt-engine docs, requirements, and tests all match

## Recommended execution order
1. fix hub lint baseline
2. decide and document token persistence behavior
3. decide and document `/mcp` GET/SSE and bridge single-connection policy
4. update `requirements-hub.md`
5. update `module-map-hub.md` and `packages/hub/README.md`
6. clean stale comments/artifacts (`disconnect-handler`, `off`, old script docs)
7. add/refresh current hub testing guide
