# Comments Module Cleanup Plan

## A. Must update

### `docs/20-requirements/requirements-comments.md`
- [ ] Replace stale public tool names (`accordo_comment_*`) with the current actual tool names (`comment_*`)
- [ ] Update the MCP tool inventory to reflect the real 8-tool surface:
  - `comment_list`
  - `comment_get`
  - `comment_create`
  - `comment_reply`
  - `comment_resolve`
  - `comment_reopen`
  - `comment_delete`
  - `comment_sync_version`
- [ ] Verify examples and schema snippets match the current code contracts
- [ ] Reconcile any old comments/browser integration assumptions with the current unified tool surface

### `docs/20-requirements/requirements-comments-panel.md`
- [ ] Rewrite the panel spec to match the current implementation
- [ ] Update the view container id from `accordo-comments-container` to `accordo-comments`
- [ ] Replace the old two-level tree model with the current three-level tree model
- [ ] Add current group modes:
  - `by-status`
  - `by-file`
  - `by-activity`
- [ ] Update thread item label/description/icon/context contracts to match `comments-tree-provider.ts`
- [ ] Update reply-flow requirements to match in-context navigation behavior instead of top-level `showInputBox`
- [ ] Reconcile navigation requirements with the current registry-first-but-not-fully-generic router state

### `docs/module-map-comments.md`
- [ ] Replace the incorrect “webview panel” description with the actual `TreeView` panel implementation
- [ ] Update the composition-root description to reflect current bootstrap/wiring responsibilities
- [ ] Correct the tool count and public/internal boundary descriptions
- [ ] Recheck module responsibilities against the current package layout

### `docs/10-architecture/comments-panel-architecture.md`
- [ ] Update container/view ids to current values
- [ ] Replace old two-level panel assumptions with the current three-level/group-mode model
- [ ] Update routing examples to match current command ids and router behavior
- [ ] Update the reply UX description to match current in-context reply behavior
- [ ] Mark any historical material clearly as historical instead of active architecture

### `docs/10-architecture/architecture.md`
- [ ] Update comments-panel status so it is no longer described as deferred
- [ ] Reconcile registry/router claims with current `navigation-router.ts`
- [ ] Replace stale browser focus command naming in comments-related routing sections
- [ ] Ensure comments ownership boundaries match the current package reality

## B. Should add / consolidate

### Comments testing guide cleanup
- [ ] Create or refresh a current comments testing guide in the canonical testing docs area
- [ ] Replace reliance on archived Session 9 / older comments testing docs
- [ ] Document current automated checks for:
  - store/repository
  - tool handlers
  - panel tree/filter/command behavior
  - navigation router

### Comments review consolidation
- [ ] Identify one canonical current review for comments/navigation state
- [ ] Mark older review threads as archive/reference only where appropriate
- [ ] Reduce ambiguity between cross-package navigation reviews and comments-owned review state

## C. Code cleanup candidates

### `packages/comments/src/panel/navigation-router.ts`
- [ ] Remove stale source comments that still describe `accordo_browser_focusThread` as current
- [ ] Decide whether to continue the router cleanup toward fully registry-owned dispatch
- [ ] If keeping mixed mode, document clearly which surfaces remain branch-special-cased and why
- [ ] Reconcile adapter comments with actual command constants and current ownership

### `packages/comments/src/panel/comments-tree-provider.ts`
- [ ] Align docstrings/comments with the real current tree/item behavior
- [ ] Verify display semantics are fully documented in the requirements/architecture docs

### `packages/comments/src/panel/panel-commands.ts`
- [ ] Ensure command comments match current behavior (especially reply flow)
- [ ] Review whether command acquisition of Marp registry should stay command-based or be generalized

### `packages/comments/src/comments-bootstrap.ts`
- [ ] Decide whether console logging is acceptable here or should move to a more consistent output/logging strategy

## D. Test/doc wording cleanup

### `packages/comments/src/panel/__tests__/navigation-registry-integration.test.ts`
- [ ] Remove stale “Phase B failing tests” / “not yet implemented” wording
- [ ] Rewrite test descriptions to describe current guarantees rather than past intended work
- [ ] Keep the regression coverage, but remove obsolete historical framing

### Other comments tests/source comments
- [ ] Remove stale references to deferred or not-yet-implemented panel/router behavior
- [ ] Normalize command naming in comments and docstrings

## E. Tooling / repo hygiene

### `packages/comments/package.json`
- [ ] Replace placeholder lint script with real linting
- [ ] Or explicitly document why lint is intentionally deferred (if that is truly the decision)

### Local/generated artifacts
- [ ] Confirm `packages/comments/dist/**` is treated as generated output only
- [ ] Check whether package-local Vitest results artifact should be ignored/cleaned:
  - `packages/comments/node_modules/.vite/vitest/.../results.json`

## F. Cross-module contract cleanup

### Comments-owned navigation contract
- [ ] Align comments router docs with actual browser/marp/md-viewer integration contracts
- [ ] Reconcile command naming between:
  - comments router
  - capabilities constants
  - browser focus command
  - marp focus command
  - preview focus command docs
- [ ] Make explicit which contracts are canonical and which fallbacks are legacy/deferred-only

## G. Archive review only, probably don’t delete blindly

### Keep as archive/reference
- archived comments architecture/requirements/testing docs under `docs/90-archive/`
- older handoff docs like `handoff-B4-comments.md`
- older navigation/consolidation reviews where still useful as historical evidence

### Review for stronger archive marking
- cross-package review docs that still describe old comments router state as current

## Recommended execution order
1. `requirements-comments.md`
2. `requirements-comments-panel.md`
3. `module-map-comments.md`
4. `comments-panel-architecture.md`
5. top-level `architecture.md` comments sections
6. test/comment wording cleanup (`navigation-registry-integration.test.ts` etc.)
7. lint/tooling cleanup
8. cross-module command/adapter contract normalization
