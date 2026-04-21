# Marp Module Cleanup Plan

## A. Must update

### `docs/20-requirements/requirements-marp.md`
- [ ] Reconcile the engine configuration contract with reality
- [ ] Decide whether `accordo.presentation.engine` truly supports both `marp` and `slidev` from this package’s manifest point of view
- [ ] If Marp contributes only `marp`, update the requirements doc accordingly
- [ ] If dual-engine selection remains the intended contract, update `package.json` and supporting docs to match
- [ ] Split public MCP tool naming from internal command naming clearly:
  - public tools are `accordo_presentation_*`
  - internal focus command is `accordo.presentation.internal.focusThread`
- [ ] Update all examples and requirement rows to use the correct actual names
- [ ] Reconcile `accordo_webview_capture` danger level (`moderate` in spec vs `safe` in code)
- [ ] Clarify the intended meaning of `narrationAvailable`

### `docs/10-architecture/marp-architecture.md`
- [ ] Update status from `PROPOSED` to the correct current status
- [ ] Reconcile architecture text with the actual current implementation
- [ ] Document the public-tool vs internal-command naming split explicitly
- [ ] Update live-reload description to match current implementation or planned target behavior
- [ ] Clarify current comments integration behavior and known gaps

### `docs/README.md`
- [ ] Point presentation/Marp architecture references to `docs/10-architecture/marp-architecture.md`
- [ ] Stop treating `presentation-architecture.md` as the active Marp architecture source if it is historical

### `docs/20-requirements/README.md`
- [ ] Change the package mapping from `accordo-editor` presentation module to `accordo-marp`
- [ ] Ensure the requirements index points readers to the correct active Marp docs

### `docs/10-architecture/presentation-architecture.md`
- [ ] Decide whether this is still an active architecture document or a historical Slidev-era doc
- [ ] If historical, mark/archive it clearly
- [ ] Remove it as an active source-of-truth for Marp if no longer applicable

## B. Should add / consolidate

### Marp testing guide cleanup
- [ ] Create or refresh a current Marp testing guide in the canonical testing docs area
- [ ] Include current automated checks for:
  - extension activation
  - provider lifecycle
  - tools
  - capture
  - comments bridge
  - live reload behavior
- [ ] Reduce dependence on archived Marp testing guides

### Marp review consolidation
- [ ] Identify one canonical current Marp review doc
- [ ] Mark overlapping modularity/consolidation/slide-comments reviews as archive/reference where appropriate
- [ ] Keep E2E debt notes separate from module-complete implementation reviews

## C. Real code/behavior cleanup candidates

### `packages/marp/src/marp-webview-html.ts`
- [ ] Implement handling for `marp:update` messages if that remains the intended live-reload contract
- [ ] Add monotonic revision handling (`revision <= lastReceivedRevision` should be ignored) if required by spec
- [ ] Ensure `comments:update` calls `refreshPins()`
- [ ] Ensure `comments:remove` calls `refreshPins()`
- [ ] Review whether `comments:focus` should do anything additional when already on the target slide
- [ ] Add or remove `webview:ready` emission depending on whether the provider should rely on it

### `packages/marp/src/presentation-provider.ts`
- [ ] Add file-change debounce if the 300ms debounce requirement remains valid
- [ ] Reconcile the host-side `marp:update` protocol with actual webview support
- [ ] Decide whether `webview:ready` listener is required or dead
- [ ] Add tests for `requestCapture()` close-before-response rejection if not already covered sufficiently

### `packages/marp/src/extension.ts`
- [ ] Reconcile `narrationAvailable` initialization/update semantics with the intended state meaning
- [ ] Decide whether bridge dependency should be explicitly activated (`await bridgeExt.activate()`) or requirements should be relaxed
- [ ] Review whether `slideSubscription` in `SessionState` is truly needed or is stale scaffolding

### `packages/marp/src/presentation-tools.ts`
- [ ] Reconcile capture danger level with requirements
- [ ] Ensure the tool naming/documentation is treated as canonical in docs

## D. Test/doc wording cleanup

### Marp tests with stale headers
- [ ] Remove “ALL tests expected to FAIL until implementation lands” wording from:
  - `src/__tests__/presentation-tools.test.ts`
  - `src/__tests__/presentation-provider.test.ts`
  - any other tests carrying stale Phase B wording
- [ ] Rewrite comments to describe current guarantees, not earlier intended work

### Source comments
- [ ] Remove comments that describe old command mismatch history as if still active where already fixed
- [ ] Keep historical rationale only where it explains current cross-module constraints

## E. Tooling / repo hygiene

### `packages/marp/package.json`
- [ ] Replace placeholder lint script with real linting
- [ ] Or document explicitly why lint is intentionally deferred

### Generated / package artifacts
- [ ] Remove or justify checked-in packaged artifact:
  - `packages/marp/accordo-marp-0.1.0.vsix`
- [ ] Remove or justify checked-in output artifact:
  - `packages/marp/slide1.svg`
- [ ] Confirm `dist/` is treated as generated output only
- [ ] Check whether package-local Vitest output under `node_modules/.vite/vitest/.../results.json` should be ignored/cleaned

### Repo-root temp presentation artifacts
- [ ] Review and likely remove temp capture artifacts if still present in repo root:
  - `tmp-slide1-index.svg`
  - `tmp-slide2.png`
  - `tmp-slide3.png`

## F. Cross-module contract cleanup

### Marp ↔ comments ↔ capabilities navigation contract
- [ ] Make the canonical slide focus path explicit across docs:
  - `accordo.presentation.internal.focusThread`
- [ ] Ensure comments-router docs match the current Marp adapter/fallback behavior
- [ ] Remove stale references to the old underscore internal focus command where already fixed
- [ ] Clarify which path is canonical vs fallback-only

### E2E debt documentation
- [ ] Reconcile module-level “PASS” docs with workplan Priority R E2E failure notes
- [ ] Keep implementation correctness vs live integrated behavior clearly separated in docs

## G. Archive review only, probably don’t delete blindly

### Keep as archive/reference
- archived Marp workplans in `docs/90-archive/`
- archived Marp testing guides in `docs/90-archive/testing/`
- older Marp/Slidev architecture docs if explicitly marked historical

### Review for stronger archive marking
- `docs/10-architecture/presentation-architecture.md`
- overlapping Marp slide comment / modularity / consolidation review docs

## Recommended execution order
1. `requirements-marp.md`
2. `marp-architecture.md`
3. docs indexes (`docs/README.md`, `docs/20-requirements/README.md`)
4. decide status of `presentation-architecture.md`
5. webview live-reload / comments-refresh behavior cleanup
6. state semantics cleanup (`narrationAvailable`, bridge activation expectations)
7. stale test header cleanup
8. lint/tooling/generated artifact cleanup
9. cross-module navigation contract normalization
