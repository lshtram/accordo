# MD Viewer Cleanup Plan

## A. Must update

### `docs/20-requirements/requirements-md-viewer.md`
- [ ] Fix `MarkdownRenderer.create(options)` vs actual `create()`
- [ ] Either implement or remove documented `fenceRenderers` extensibility
- [ ] Fix shiki theme requirement to match actual behavior
- [ ] Resolve KaTeX contradiction:
  - server-side in module spec
  - client-side in non-requirements
- [ ] Update test coverage section:
  - 127 tests
  - 7 test files
  - extension tests are explicit, not just “Phase C integration”
- [ ] Fix internal command name:
  - from dotted `accordo.comments.internal.getStore`
  - to canonical current command naming / capability constant wording

### `docs/10-architecture/architecture.md`
- [ ] Fix section 17.4 claim that `markdown-preview` adapter is registered by `packages/md-viewer/`
- [ ] Fix “registry-first” description if current router still uses explicit branching
- [ ] Align “deferred path deprecated” statement with actual `navigation-router.ts`

### `docs/10-architecture/comments-panel-architecture.md`
- [ ] Replace dotted preview command name with canonical current name
- [ ] Verify routing description matches actual markdown-preview behavior
- [ ] Mark clearly if this doc is target architecture vs current architecture

### `docs/20-requirements/README.md`
- [ ] Change package classification from `accordo-editor` markdown module
- [ ] Point to standalone `accordo-md-viewer`

### `docs/00-workplan/architecture-presentation.md`
- [ ] Reconcile “md-viewer MCP tool” with actual design
- [ ] If no MCP tool exists or is planned, remove the claim
- [ ] If planned, mark as future work explicitly

## B. Should add

### `docs/40-testing/testing-guide-md-viewer.md`
- [ ] Add current automated test commands
- [ ] Add user-flow checks for:
  - open `.md` in preview
  - comments load
  - comment create/reply/resolve
  - focus thread behavior
  - images/math/mermaid rendering
- [ ] Replace dependence on archived week7 guide

### `docs/40-reviews/` or `docs/reviews/`
- [ ] Add a current standalone md-viewer review note
- [ ] Summarize current state, residual debt, and known doc drift fixes

## C. Code cleanup candidates

### `packages/md-viewer/src/commentable-preview.ts`
- [ ] Remove or justify `bridge!` non-null assertion
- [ ] Consider a safer ready-handler pattern without assertion
- [ ] Check whether `renderer` caching behavior should be documented

### `packages/md-viewer/src/renderer.ts`
- [ ] Decide whether `themeKind` is real behavior or dead API surface
- [ ] Decide whether `fenceRenderers` is real behavior or dead API surface
- [ ] If keeping them, implement
- [ ] If not keeping them, remove from type surface and docs

### `packages/md-viewer/src/webview-template.ts`
- [ ] Review console logging in injected script
- [ ] Decide whether runtime diagnostics here are intentional policy

### `packages/md-viewer/src/preview-bridge.ts`
- [ ] Review `console.error` usage vs project logging conventions
- [ ] Consider whether unknown message handling should stay silent or be traceable in tests/docs

## D. Test/documentation wording cleanup

### `packages/md-viewer/src/__tests__/mocks/vscode.ts`
- [ ] Fix header: it says `accordo-comments`, but this is md-viewer’s mock

### `packages/md-viewer/src/__tests__/*.test.ts`
- [ ] Remove “failing tests (Phase B)” wording where stale
- [ ] Normalize command-name references in comments/docstrings
- [ ] Refresh requirement notes if they reference outdated contracts

## E. Tooling hygiene

### `packages/md-viewer/package.json`
- [ ] Replace placeholder lint script
- [ ] Or explicitly document why lint is deferred/not configured
- [ ] Confirm packaging assumptions around `vsce package --no-dependencies`

### `packages/md-viewer/scripts/copy-webview-assets.mjs`
- [ ] Document packaging/runtime asset model somewhere canonical
- [ ] Clarify that some runtime assets are copied into `dist/`, not “all dependencies bundled”

## F. Archive review only, probably don’t delete

### Keep archived, but don’t treat as authoritative
- `docs/90-archive/testing/testing-guide-week7.md`
- `docs/90-archive/testing/testing-guide-session8a.md`
- `docs/90-archive/requirements-comments-pre-unified-modality-tools-2026-03-22.md`

### Special check
- `docs/90-archive/research/markdown-viewer-showcase_.md`
- [ ] Verify whether trailing `_` is accidental
- [ ] Rename or leave archived with note

## Recommended execution order
1. `requirements-md-viewer.md`
2. architecture docs
3. requirements index + workplan presentation doc
4. active testing guide
5. code/API cleanup (`renderer.ts`, `commentable-preview.ts`)
6. test header/comment cleanup
7. lint/tooling cleanup
