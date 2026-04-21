# Bridge Types Cleanup Plan

## A. Must update

### `packages/bridge-types/src/index.ts`
- [ ] Decide whether `relay-types.ts` is part of the canonical public surface
- [ ] If yes, export relay types from the root barrel
- [ ] If no, remove or relocate `relay-types.ts` and update docs accordingly
- [ ] Reconcile barrel exports with all intended canonical shared comment/relay mutation types

### `packages/bridge-types/package.json`
- [ ] Fix lint coverage so all source files are linted, including `src/relay-types.ts`
- [ ] Replace the hardcoded file list with a source glob or equivalent full-source strategy
- [ ] Review whether the package should publish compiled test artifacts under `dist/__tests__`

### `docs/testing-guide-bridge-types.md`
- [ ] Rewrite the testing guide to match current code and tests
- [ ] Fix stale protocol-version claims
- [ ] Fix stale REQ/test inventory mapping
- [ ] Correct statements about what lint/test/typecheck actually cover
- [ ] Clarify what the 10 current tests do and what they do not protect

### `packages/bridge-types/README.md`
- [ ] Remove false claim that the package has “no runtime code”
- [ ] Remove false claim that there are “no tests to run”
- [ ] Fix stale import examples (`BridgeAPI`, `WsBridgeMessage`, `WsHubMessage` if not actually exported)
- [ ] Update consumer list to reflect current reality across the repo
- [ ] Explain the package purpose more clearly:
  - shared types
  - shared constants
  - root-only import policy

## B. High-priority contract/doc cleanup

### Relay contract ownership
- [ ] Resolve the inconsistency between docs that say browser relay shared contract lives in `@accordo/bridge-types` and the package barrel not exporting it
- [ ] Make one canonical statement in docs about whether `relay-types.ts` is authoritative for browser relay contracts
- [ ] Align browser/browser-extension/shared-relay docs with that decision

### IDE state / tool registration docs
- [ ] Reconcile `requirements-hub.md` and `requirements-bridge.md` around current `IDEState` shape (`openTabs` etc.)
- [ ] Reconcile all docs about `ToolRegistration` with the current flat wire-safe structure
- [ ] Remove stale references to old wrapper forms like `definition`

## C. Review / architecture cleanup

### `docs/10-architecture/architecture.md`
- [ ] Update bridge-types package map to include the actual current file layout
- [ ] Include `relay-types.ts` if it is part of the intended package architecture
- [ ] Remove old 5-file-only descriptions if the package now has more canonical domains

### Stale bridge-types review docs
- [ ] Review and update or archive more clearly:
  - `docs/reviews/bridge-types-A.md`
  - `docs/reviews/bridge-types-B.md`
  - `docs/reviews/bridge-types-D2.md`
- [ ] Fix stale claims such as:
  - old `ReauthRequest` shape
  - old `IDEState.tabs` / `activeTabId`
  - old `ToolRegistration.definition` wrapper

### Modularity/planning docs
- [ ] Reconcile historical split-plan docs with actual implemented filenames/domains
- [ ] Avoid leaving old file naming plans (`ide-state.ts`, `tool-contracts.ts`, etc.) looking current when implementation differs

## D. Code/test cleanup candidates

### `packages/bridge-types/src/relay-types.ts`
- [ ] If canonical, add tests that assert barrel exposure and stable relay-type names
- [ ] If non-canonical, remove it or move it to the owning package
- [ ] Clarify its relationship to local browser/browser-extension relay helper types

### `packages/bridge-types/src/comment-types.ts`
- [ ] Decide whether newer comment mutation queue/event types should be publicly exported from the barrel
- [ ] If bridge-types is canonical for these, align consumers and remove duplicates elsewhere

### `packages/bridge-types/eslint.config.mjs`
- [ ] Remove contradictory duplicate rule entries (e.g. `no-explicit-any` set twice with different values)
- [ ] Make config intent obvious and maintainable

### Test coverage additions
- [ ] Add a barrel-export contract test for expected public symbols
- [ ] Add explicit coverage for relay-types if it remains in the package
- [ ] Consider a guard against publishing test artifacts in `dist/`

## E. Packaging / repo hygiene

### Build output hygiene
- [ ] Decide whether `dist/__tests__/` should be emitted/published
- [ ] If not, split build/test tsconfig or adjust include/exclude settings

### Generated/package-local artifacts
- [ ] Confirm `packages/bridge-types/dist/**` is treated as generated output only
- [ ] Clean or ignore `packages/bridge-types/tsconfig.tsbuildinfo`
- [ ] Clean or ignore package-local Vitest result artifacts under `node_modules/.vite/vitest/`

## F. Cross-module contract cleanup

### Browser/browser-extension dependency story
- [ ] Decide whether `browser-extension` should depend on `@accordo/bridge-types` for shared mutation/relay types
- [ ] If yes, add the dependency and remove local duplicates
- [ ] If no, update docs to stop implying it already does

### Shared contract matrix
- [ ] Create or update a single current matrix of what `@accordo/bridge-types` owns:
  - IDE state
  - tool registration
  - ws messages
  - comment data model
  - relay contracts
  - protocol/operational constants

## G. Archive / keep-but-mark-historical

### Keep but mark historical if not updated
- older bridge-types review docs
- modularity split planning docs using superseded filenames
- archived browser/comment architecture docs that predate current shared contract layout

## Recommended execution order
1. decide relay-types ownership and barrel-export policy
2. fix `src/index.ts` + package lint coverage
3. update README
4. update testing guide
5. update architecture/review docs with current contracts
6. decide comment mutation / browser-extension shared-type ownership
7. clean build-output and published-artifact hygiene
