# Browser Extension Cleanup Plan

## A. Must update

### `docs/20-requirements/requirements-browser-extension.md`
- [ ] Separate historical v1 baseline from active current requirements
- [ ] Update manifest/build contract to match actual extension output:
  - `service-worker.js`
  - `content-script.js`
  - `popup.html`
  - `shadow-tracker.js`
- [ ] Reconcile permissions list with actual manifest (`webNavigation`, `debugger`, etc.)
- [ ] Reconcile content script model with current implementation (`all_frames`, separate shadow tracker entry)
- [ ] Remove or explicitly scope obsolete “no SDK dependency” requirement language
- [ ] Verify context-menu/title/state-machine requirements against actual implementation
- [ ] Update any stale acceptance criteria tied to older path/layout assumptions

### `docs/10-architecture/browser-extension-architecture.md`
- [ ] Rewrite package/source tree to match current topology (remove `background/`, `mcp/`, `types/` fiction where obsolete)
- [ ] Replace old keyboard shortcut references (`Ctrl+Shift+A` / `Cmd+Shift+A`) with current actual shortcut if still canonical
- [ ] Reconcile SDK statements with reality:
  - current code imports `@accordo/comment-sdk`
  - current package.json depends on it
- [ ] Mark historical sections clearly as historical rather than active architecture
- [ ] Update diagrams and module descriptions to current runtime paths

### `docs/00-workplan/workplan.md`
- [ ] Update Priority P browser-extension notes so they no longer claim `VscodeRelayAdapter` is stubbed
- [ ] Update `selectAdapter()` status to reflect actual implementation
- [ ] Preserve remaining real issues (if any) without stale implementation claims
- [ ] Re-check Priority Q notes against current browser focus-thread path

### `docs/module-map-browser-extension.md`
- [ ] Remove or downgrade `content-pins.ts` as a key module if it is no longer part of runtime path
- [ ] Update module map to center current paths (`comment-ui.ts`, relay handlers, page understanding, capture, lifecycle)
- [ ] Verify composition root and public APIs against actual source

### `docs/20-requirements/requirements-browser-mcp.md`
- [ ] Normalize tool namespace wording (`browser_*` vs `accordo_browser_*`)
- [ ] Make canonical naming explicit and consistent with actual tool surface
- [ ] Check all examples and inventory rows for naming consistency

### `docs/20-requirements/README.md`
- [ ] Ensure browser reading guide names the authoritative current docs in priority order
- [ ] Clarify which docs are active vs historical when requirements overlap

## B. Should add / consolidate

### Browser-extension testing guide cleanup
- [ ] Update `docs/40-testing/testing-guide-browser-tab-control.md` test counts
- [ ] Update any other browser-extension testing guides with current counts and current package behavior
- [ ] Move misplaced browser testing guides into the canonical testing area if needed:
  - `docs/testing-guide-browser-pagination.md`
  - `docs/testing-guide-shared-browser-relay.md`

### Browser-extension review consolidation
- [ ] Identify one current canonical browser-extension review doc
- [ ] Mark older overlapping review docs as archive/reference only
- [ ] Reduce ambiguity between `docs/reviews/`, `docs/40-reviews/`, and `docs/50-reviews/`

## C. Code cleanup candidates

### `packages/browser-extension/src/content-pins.ts`
- [ ] Confirm whether this file is still used in any live runtime path
- [ ] If unused, delete it and remove its dedicated tests
- [ ] If intentionally retained, document why it coexists with SDK-based comment UI

### `packages/browser-extension/src/popup.ts`
- [ ] Remove unused eslint-disable directive causing lint warning

### `packages/browser-extension/src/sw-lifecycle.ts`
- [ ] Remove unused `getRelayConfig` import if truly not needed
- [ ] Review any silent catch blocks and empty branches for intentionality/documentation

### `packages/browser-extension/src/constants.ts`
- [ ] Confirm whether `MESSAGE_TYPES.UPDATE_COMMENT` is still needed
- [ ] Remove dead compatibility constants if no longer required

### `packages/browser-extension/src/relay-comment-handlers.ts`
- [ ] Review direct-store read/write split for cleanliness after adapter introduction
- [ ] Confirm there is no leftover concern mixing from pre-adapter implementation

## D. Tooling / repo hygiene

### `packages/browser-extension/package-lock.json`
- [ ] Verify whether this should exist in a pnpm workspace
- [ ] Remove if accidental/unneeded

### Generated/runtime artifacts
- [ ] Confirm `dist/` stays ignored / treated as generated
- [ ] Confirm package-local `node_modules/` noise is ignored and not treated as source of truth

## E. Test/doc wording cleanup

### Browser-extension review/test docs
- [ ] Update stale test counts (931, 1253, etc.) to current values where appropriate
- [ ] Refresh references to old module shapes and old architecture claims
- [ ] Normalize command/tool names in prose and examples

### Source comments
- [ ] Remove lingering comments that describe old architecture or pre-refactor behavior as current
- [ ] Keep historical rationale only where it helps explain current constraints

## F. Archive review only, probably don’t delete blindly

### Likely keep as archive/reference
- `docs/90-archive/requirements-browser-extension-pre-unified-comments-2026-03-22.md`
- `docs/90-archive/browser-extension-architecture-pre-unified-comments-2026-03-22.md`
- `docs/90-archive/testing/testing-guide-browser-v2a.md`
- older browser MCP review chains in `docs/60-archive/` and `docs/90-archive/`

### Review for relocation or stronger archive marking
- overlapping browser review docs in:
  - `docs/reviews/`
  - `docs/40-reviews/`
  - `docs/50-reviews/`

## Recommended execution order
1. `requirements-browser-extension.md`
2. `browser-extension-architecture.md`
3. `workplan.md` browser-extension sections
4. `module-map-browser-extension.md`
5. MCP naming normalization docs
6. testing/review doc consolidation
7. code cleanup (`content-pins.ts`, lint/import debris)
8. repo hygiene (`package-lock.json`, generated artifact policy)
