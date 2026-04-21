# Bridge Module Cleanup Plan

## A. Must update

### `docs/20-requirements/requirements-bridge.md`
- [ ] Reconcile extension deactivation behavior with current implementation
- [ ] Decide whether Bridge deactivation should:
  - kill Hub, or
  - soft-disconnect and leave Hub alive for reconnect-first behavior
- [ ] Update LCM-11 and any related lifecycle requirements accordingly
- [ ] Reconcile status bar requirements with actual current status-bar text/semantics
- [ ] Reconcile `showStatus` requirements with the actual current quick-pick content
- [ ] Update config-file format validation requirements (`CFG-08` etc.) to match the current Opencode/Claude config schema
- [ ] Remove stale `instructions_url` / old `mcpServers` assumptions if they are no longer canonical

### `docs/module-map-bridge.md`
- [ ] Rewrite the module map to match the current bridge package layout
- [ ] Remove references to files that do not exist (`mcp-registration.ts`, `protocol.ts`, `config.ts`, etc.)
- [ ] Update lifecycle/control-flow ownership to current modules:
  - `extension-bootstrap.ts`
  - `extension-service-factory.ts`
  - `extension-composition.ts`
  - `hub-manager.ts`
  - `state-publisher.ts`
  - `agent-config.ts`

### `packages/bridge/README.md`
- [ ] Remove stale PID-file claims if no longer true
- [ ] Remove stale “cleans up Hub on deactivation” statement if reconnect-first behavior is canonical
- [ ] Fix stale grace-window wording if no longer accurate
- [ ] Fix wrong BridgeAPI import example (BridgeAPI comes from bridge exports, not bridge-types)
- [ ] Update config section to include all current user-facing settings (including Claude)
- [ ] Update test count from stale value to current reality

### `docs/10-architecture/architecture.md`
- [ ] Update bridge file layout and bridge lifecycle description to current reality
- [ ] Reconcile Copilot MCP registration mechanism with actual `mcp.json` sync approach
- [ ] Remove or clearly mark any superseded bridge process/registration architecture text

## B. High-priority code cleanup

### `packages/bridge/src/extension-composition.ts`
- [ ] Fix the current lint error (`!=` → `!==` or equivalent)
- [ ] Review/remove `buildShowStatusHandler()` if it is truly unused
- [ ] Reconcile show-status implementation with the documented requirements, or revise docs if current implementation is intentional

### `packages/bridge/src/extension.ts`
- [ ] Remove or justify the non-null assertion on `bootstrap!`
- [ ] Keep top-level comments aligned with current reconnect-first lifecycle behavior

### `packages/bridge/src/hub-manager.ts`
- [ ] Remove or justify the non-null assertion reported by lint
- [ ] Reconcile comments/method names around deactivate/kill behavior with actual architecture intent
- [ ] Decide whether PID-related helper methods are still needed in the reconnect-first world

### `packages/bridge/src/hub-process.ts`
- [ ] Update stale comments that still imply PID-file ownership if current implementation no longer works that way
- [ ] Remove dead PID-path assumptions if they are no longer part of active design

## C. Test cleanup / additions

### Existing tests needing cleanup
- [ ] Remove stale “RED/stub/not implemented” wording from bridge test headers/comments where implementation is complete
- [ ] Reconcile test narratives with current reconnect-first model

### Missing tests to add
- [ ] Add direct unit tests for utility modules lacking focused coverage:
  - `hub-registry.ts`
  - `project-identity.ts`
  - `state-diff.ts`
  - `state-collector.ts` (if current coverage is mostly indirect)
- [ ] Add a repeated activate/deactivate cleanup test to ensure no reconnect timer/listener leaks
- [ ] Add or strengthen tests around current show-status behavior if that command remains user-facing and important

### Bridge integration / E2E hardening
- [ ] Consider a lightweight real-runtime integration test for Bridge ↔ Hub WS path to complement the heavy mocking strategy

## D. Tooling / repo hygiene

### Restore clean quality gate
- [ ] Fix bridge lint baseline to green (currently 1 error, 2 warnings)
- [ ] Decide whether non-null assertions are acceptable in these specific cases or should be refactored away

### Generated/package-local artifacts
- [ ] Confirm `packages/bridge/dist/**` is treated as generated output only
- [ ] Clean or ignore `packages/bridge/tsconfig.tsbuildinfo`
- [ ] Clean or ignore package-local Vitest result artifacts under `node_modules/.vite/vitest/`

## E. Documentation / review cleanup

### Active docs to refresh
- [ ] `docs/20-requirements/requirements-bridge.md`
- [ ] `docs/module-map-bridge.md`
- [ ] `packages/bridge/README.md`
- [ ] bridge section in top-level `docs/10-architecture/architecture.md`

### Review docs to mark historical / clarify
- [ ] Revisit `docs/40-reviews/reload-reconnect-phase-a.md` and `phase-b.md` to mark what is now implemented vs still pending
- [ ] Keep archive multi-session reviews clearly historical

### Testing guide gap
- [ ] Add or refresh a current non-archived bridge testing guide for the reconnect-first/current architecture

## F. Cross-module contract cleanup

### Agent config contract
- [ ] Align bridge docs, code, and consumer expectations for generated config file shapes
- [ ] Make one canonical statement about current Opencode config schema and Claude schema merge behavior

### BridgeAPI contract communication
- [ ] Ensure other package READMEs/examples acquire `BridgeAPI` from the bridge extension exports, not from bridge-types
- [ ] Normalize examples across editor, voice, comments, md-viewer, marp, and browser docs

## Recommended execution order
1. fix lint baseline in bridge code
2. decide and document canonical deactivate/Hub-lifecycle behavior
3. update `requirements-bridge.md`
4. update `module-map-bridge.md` and `packages/bridge/README.md`
5. reconcile agent-config docs with actual generated schema
6. remove stale/dead code/comments (`buildShowStatusHandler`, PID-file leftovers if applicable)
7. add missing focused tests + current bridge testing guide
