# Comment SDK Cleanup Plan

## A. Must update

### `docs/20-requirements/requirements-comments-sdk.md`
- [ ] Rewrite the public API section to match the real implementation
- [ ] Replace constructor-based lifecycle with actual lifecycle:
  - `new AccordoCommentSDK()`
  - `init(opts)`
  - `destroy()`
- [ ] Update thread mutation API to match reality:
  - `loadThreads(threads)`
  - `addThread(thread)`
  - `updateThread(threadId, update)`
  - `removeThread(threadId)`
  - `reposition()`
- [ ] Update callback names to match code:
  - `onCreate`
  - `onReply`
  - `onResolve`
  - `onReopen`
  - `onDelete`
- [ ] Fix the data model to match current code:
  - `SdkComment.author` is `{ kind, name }`, not a plain string
  - `SdkThread` does not currently include `uri`, `createdAt`, `updatedAt`
  - `ScreenPosition` is `{ x, y }`, not `{ top, left }`
- [ ] Fix protocol types to match current code:
  - include `comment:reopen`
  - include `comments:focus`
  - use current `comments:update` shape (`threadId` + `update`)
  - reflect `resolutionNote` on resolve messages
- [ ] Clarify that the SDK itself does not currently own `window.addEventListener('message', ...)`; consumers wire host messages unless you intentionally want to change that
- [ ] Update the test coverage count from 37 to current reality
- [ ] Normalize requirement ID naming (`M41a-*` vs `M41-*`)

### `docs/10-architecture/architecture.md`
- [ ] Update the Comment SDK section so it matches the actual integration model
- [ ] Replace stale callback naming such as `onNew` with current callback names
- [ ] Clarify whether `sdk.browser.js` is a package-owned canonical output or a consumer-built asset pattern
- [ ] Reconcile “communicates exclusively via postMessage” with current callback-based API boundary

### `docs/20-requirements/requirements-comments-panel.md`
- [ ] Remove the stale prerequisite-fix note about `.accordo-pin-badge`
- [ ] If the historical bug is still worth remembering, move it to an archive/changelog note instead of active requirements

## B. Should add / improve documentation

### `packages/comment-sdk/README.md`
- [ ] Add a package-level README (currently missing)
- [ ] Document:
  - public API
  - lifecycle (`init` / `destroy`)
  - message/callback boundary ownership
  - expected bundling model for webview consumers
  - CSS import/embedding expectations
  - supported thread/message shapes

### Current testing guide
- [ ] Add or refresh a current testing guide for `@accordo/comment-sdk` in the canonical testing docs area
- [ ] Replace dependence on archived Week 7 testing notes
- [ ] Document the current 47-test suite and what it protects

### Canonical ownership doc
- [ ] Add a concise statement somewhere current that clarifies who owns host-message wiring:
  - SDK itself, or
  - consumer webview shell (`md-viewer`, `marp`, `browser-extension`)

## C. Code cleanup candidates

### `packages/comment-sdk/scripts/bundle-browser.mjs`
- [ ] Decide whether this script is still part of the intended package story
- [ ] If yes, wire it into `package.json` scripts and document output ownership
- [ ] If no, delete it

### `packages/comment-sdk/src/sdk.ts`
- [ ] Consider whether `init()` should guard against double-initialization explicitly
- [ ] Consider whether `destroy()` should be documented/tested as idempotent
- [ ] Review whether the package should expose a clearer programmatic message-handling helper if multiple consumers keep re-implementing the same glue

### `packages/comment-sdk/src/thread-manager.ts`
- [ ] Consider whether `removeThread()` should also remove gutter marker classes when last thread for a block disappears
- [ ] Confirm badge/state update logic preserves all required classes/attributes after repeated updates

### `packages/comment-sdk/src/popover-renderer.ts`
- [ ] Decide whether resolve should always pass empty-string resolution notes or whether the API/docs should explicitly describe that behavior
- [ ] Consider whether callback semantics should be documented more precisely for future consumers

## D. Test cleanup / additions

### `packages/comment-sdk/src/__tests__/sdk.test.ts`
- [ ] Remove stale “Phase B — all must fail on stubs” wording
- [ ] Rewrite headers/comments to describe current guarantees, not initial implementation status

### Missing/weak tests to consider
- [ ] Add explicit test for double `init()` behavior (guard or defined behavior)
- [ ] Add explicit idempotency test for repeated `destroy()`
- [ ] Add regression test for repeated `updateThread()` preserving badge + state classes cleanly
- [ ] Add targeted tests for callback payload semantics (`resolutionNote`, reopen flow, delete flow)

## E. Packaging / repo hygiene

### Generated/package-local artifacts
- [ ] Confirm `packages/comment-sdk/dist/**` is treated as generated output only
- [ ] Clean or ignore `packages/comment-sdk/tsconfig.tsbuildinfo`
- [ ] Clean or ignore package-local Vitest result artifacts under `node_modules/.vite/vitest/`

### CSS output story
- [ ] Reconcile requirements text saying CSS ships in `dist/` with actual package export `./css -> ./src/sdk.css`
- [ ] Decide and document the canonical shipped CSS path

## F. Cross-module contract cleanup

### SDK integration contract across consumers
- [ ] Align docs for `md-viewer`, `marp`, and `browser-extension` to the same SDK contract
- [ ] Ensure all consumer docs stop implying the SDK itself handles host-message wiring if consumers actually do that work
- [ ] Normalize terminology around:
  - `blockId`
  - `comments:focus`
  - partial thread updates
  - callback vs postMessage ownership

### Historical drift cleanup
- [ ] Review active docs that still describe earlier SDK assumptions and move them to archive/historical notes if needed

## G. Archive / review cleanup

### Stale historical references in active docs
- [ ] Revisit active comments/browser/presentation docs that describe older SDK API shapes as current
- [ ] Mark historical references clearly rather than leaving them mixed into active requirements

### Archived testing/docs
- [ ] Keep Week 7 archive docs as historical reference only
- [ ] Avoid treating them as current SDK truth in indexes or search-driven review work

## Recommended execution order
1. `requirements-comments-sdk.md`
2. top-level architecture Comment SDK section
3. remove stale prerequisite bug notes from comments-panel docs
4. decide fate of `bundle-browser.mjs` and packaging story
5. add package README
6. refresh/add current testing guide
7. clean stale test headers + add missing lifecycle tests
8. align consumer docs on the same SDK contract
