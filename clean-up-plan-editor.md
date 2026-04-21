# Editor Module Cleanup Plan

## A. Must update

### `docs/20-requirements/requirements-editor.md`
- [ ] Reconcile the requirements doc with the actual implemented editor tool surface
- [ ] Decide whether legacy workspace/diagnostics tools are still in scope:
  - `accordo.workspace.getTree`
  - `accordo.workspace.search`
  - `accordo.diagnostics.list`
- [ ] If out of scope, remove/de-scope them clearly
- [ ] Normalize tool names to the current underscore MCP convention
- [ ] Update registration examples from `accordo-editor` to the actual extension id `accordo.accordo-editor`
- [ ] Document current special open behavior for `.md` and `.mmd`
- [ ] Reconcile `resolvePath` requirements with actual multi-root behavior
- [ ] Fix broken internal doc references (missing `panel-toggle-architecture.md`, wrong layout-state path)

### `docs/10-architecture/architecture.md`
- [ ] Update editor section to match the current file layout and tool split
- [ ] Remove stale references to `workspace.ts` or non-existent editor modules
- [ ] Normalize command names from dotted form to underscore form where editor tools are concerned
- [ ] Update tool-count statements to current reality
- [ ] Update registration examples to match actual `bridge.registerTools("accordo.accordo-editor", allTools)` usage

### `docs/20-requirements/README.md`
- [ ] Update editor entry from “16 tools” to the actual current tool count
- [ ] Keep package classification accurate and consistent with current implementation

### `packages/editor/README.md`
- [ ] Rewrite tool counts to current reality
- [ ] Fix stale parameter descriptions
- [ ] Add missing layout tools (`accordo_layout_state`, `accordo_layout_panel`)
- [ ] Reconcile development/test section with current test count (`349` in latest run)
- [ ] Update activation/registration narrative to current extension id and tool composition

## B. High-priority code/contract cleanup

### `packages/editor/src/tools/layout.ts`
- [ ] Reassess `accordo_panel_toggle` metadata: if behavior truly toggles visibility, it should not be marked `idempotent: true`
- [ ] Decide whether panel behavior should stay as true toggle or become explicit open/close-only semantics everywhere
- [ ] Remove stale comment reference to missing `docs/00-workplan/panel-toggle-architecture.md`

### `packages/editor/src/tools/editor-utils.ts` / `util.ts`
- [ ] Decide whether to implement the documented unique-match multi-root path resolution behavior
- [ ] If not, simplify and update docs so ambiguity handling is explicitly the intended behavior

### `packages/editor/src/extension.ts`
- [ ] Update stale comment claiming “21 tools” if tool count has changed
- [ ] Consider adding a lightweight guard/test for exact registered tool count to prevent future drift

## C. Test cleanup / additions

### Missing tests to add
- [ ] Add extension activation/integration tests for:
  - full tool registration count
  - inert behavior when bridge is missing
  - command registration coverage
- [ ] Add test for terminal lifecycle close-event cleanup path if not already covered explicitly
- [ ] Add test guarding exported tool count consistency across `editorTools`, `terminalTools`, and `createLayoutTools()`
- [ ] Add test around current multi-root behavior (or future unique-match behavior if implemented)
- [ ] Add test for idempotency metadata correctness where it matters (`accordo_panel_toggle`)

### Existing tests needing cleanup
- [ ] Remove stale “Phase B / stub” wording in test headers/comments if present
- [ ] Reduce duplicated coverage between `panel-toggle.test.ts` and `layout.test.ts` where overlap is unnecessary

## D. Tooling / repo hygiene

### Package-level cleanup
- [ ] Verify/remove transient artifacts in `packages/editor/`:
  - `test-result.txt`
  - `test-output.txt`
- [ ] Confirm `dist/**` is treated as generated output only
- [ ] Clean or ignore `tsconfig.tsbuildinfo`
- [ ] Clean or ignore package-local Vitest result artifacts under `node_modules/.vite/vitest/`

## E. Review / archive cleanup

### Active reviews needing status clarification
- [ ] Revisit `docs/reviews/editor-close-fix-D2.md` and mark fixed findings as historical if already resolved
- [ ] Consolidate duplicate bar-tools review docs across `docs/reviews/` and `docs/50-reviews/`

### Historical design docs to archive harder or cross-link correctly
- [ ] `docs/90-archive/bar-tools-architecture-2026-03-31.md`
- [ ] `docs/90-archive/panel-toggle-architecture-2026-03-31.md`
- [ ] old editor testing guides that no longer reflect the current tool surface

## F. Cross-module documentation cleanup

### Editor as foundational modality
- [ ] Align all cross-module docs that mention editor tool naming/counts with current reality
- [ ] Ensure script/testing/multi-session docs use the current editor tool IDs and semantics
- [ ] Remove stale dotted-name examples where the repo has standardized on underscore names

## Recommended execution order
1. `requirements-editor.md`
2. editor section in top-level architecture doc
3. `packages/editor/README.md` + requirements index count fixes
4. settle `accordo_panel_toggle` idempotency and `resolvePath` contract
5. add missing activation/count tests
6. clean duplicate/stale review docs
7. remove transient package artifacts and generated-noise assumptions
