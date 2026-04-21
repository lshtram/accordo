# Browser Module Cleanup Plan

## A. Must update

### `docs/module-map-browser.md`
- [ ] Rewrite the module map to reflect the current architecture
- [ ] Make `tool-assembly.ts` the real composition point instead of over-centering `extension.ts`
- [ ] Update the tool inventory and responsibilities to match the current MCP surface
- [ ] Include shared relay components as first-class architecture, not side notes
- [ ] Remove stale statements like “registers 10 browser tools” if no longer accurate

### `docs/10-architecture/architecture.md`
- [ ] Replace stale browser focus command name `accordo_browser_focusThread`
- [ ] Use the current actual command `accordo_browser.focusThread`
- [ ] Reconcile any browser routing text that still assumes deferred underscore command naming is current
- [ ] Ensure browser architecture sections match the current shared-relay/tool-assembly model

### `docs/20-requirements/requirements-browser-mcp.md`
- [ ] Normalize tool naming throughout the doc
- [ ] Reconcile prose that says `accordo_browser_*` with actual `browser_*` tool inventory
- [ ] Make the canonical naming convention explicit
- [ ] Update examples and requirement language to match the real tool surface

### Browser-related workplan / review references
- [ ] Update any active docs that still describe the old browser focus-thread mismatch as current if it is now resolved
- [ ] Keep historical issues only where clearly marked historical

## B. Should add / consolidate

### Browser testing guide cleanup
- [ ] Update `docs/testing-guide-shared-browser-relay.md` test counts and file counts
- [ ] Review all browser testing guides for stale counts and stale command/tool names
- [ ] Move misplaced testing guides into the canonical testing area if appropriate:
  - `docs/testing-guide-browser-pagination.md`
  - `docs/testing-guide-shared-browser-relay.md`

### Browser review consolidation
- [ ] Identify one canonical current browser review document
- [ ] Mark overlapping browser reviews as archive/reference where appropriate
- [ ] Reduce ambiguity across `docs/reviews/`, `docs/40-reviews/`, and `docs/50-reviews/`

## C. Code cleanup candidates

### `packages/browser/src/browser-tools.ts`
- [ ] Decide whether to keep this deprecated file
- [ ] If kept, document exactly why it remains and who still uses it
- [ ] If unused except for historical reference/tests, consider deleting it and updating tests/docs

### `packages/browser/src/browser-comment-relay-handler.ts`
- [ ] Confirm argument ordering is robust for all mapped commands, not just `focus_thread`
- [ ] Consider making argument mapping more explicit than `...Object.values(args)` if order-safety is a concern
- [ ] Add/keep regression coverage for the `focus_thread` argument-shape path

### `packages/browser/src/comment-notifier.ts`
- [ ] Confirm the command mapping for `focus_thread` is the canonical path
- [ ] Ensure comments/docstrings describe the current command contract, not the old deferred one

## D. Cross-module contract cleanup

### Browser focus command naming
- [ ] Align all references to the current browser focus command across the repo
- [ ] Check and update:
  - `packages/capabilities/src/index.ts`
  - `packages/comments/src/panel/navigation-router.ts`
  - `docs/10-architecture/architecture.md`
  - browser-related reviews/workplan docs
- [ ] Remove or clearly deprecate the underscore command form if no longer valid

## E. Test/doc wording cleanup

### Testing guides and review docs
- [ ] Update stale browser package test counts (currently 1120 in latest run)
- [ ] Update stale file-count references
- [ ] Normalize browser tool naming in prose and examples

### Source comments
- [ ] Remove comments that describe outdated architecture as current
- [ ] Keep historical context only when it explains active constraints

## F. Archive review only, probably don’t delete blindly

### Likely keep as archive/reference
- overlapping browser review documents across:
  - `docs/reviews/`
  - `docs/40-reviews/`
  - `docs/50-reviews/`
  - `docs/60-archive/`
  - `docs/90-archive/`

### Special review target
- `packages/browser/src/browser-tools.ts`
- [ ] classify as keep-for-reference, migrate, or delete

## Recommended execution order
1. `docs/module-map-browser.md`
2. `docs/10-architecture/architecture.md` browser command references
3. `docs/20-requirements/requirements-browser-mcp.md`
4. testing guide count/location cleanup
5. review consolidation / archive marking
6. decide fate of `browser-tools.ts`
7. cross-module command naming cleanup
