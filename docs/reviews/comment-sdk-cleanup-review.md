# Comment SDK Cleanup Review (2026-04-21)

## Summary

This cleanup aligned Comment SDK requirements/architecture/docs with the actual package API and integration boundaries, added missing package/testing documentation, and removed stale requirement drift.

## Completed fixes

1. **Requirements contract rewrite**
   - Rewrote `docs/20-requirements/requirements-comments-sdk.md` to match live SDK behavior:
     - lifecycle: `new AccordoCommentSDK()` + `init()` + `destroy()`
     - thread mutation API: `loadThreads`, `addThread`, `updateThread(threadId, update)`, `removeThread`, `reposition`
     - callback names: `onCreate`, `onReply`, `onResolve`, `onReopen`, `onDelete`
     - data model updates (`author` object, `ScreenPosition {x,y}`, current `SdkThread` shape)
     - protocol shape updates (`comment:reopen`, `comments:focus`, `comments:update` with `threadId + update`, resolve note support)
   - Normalized requirement IDs to `M41-SDK-*` style.

2. **Architecture alignment**
   - Updated Comment SDK section in `docs/10-architecture/architecture.md`:
     - removed stale `onNew` callback naming
     - clarified package consumption model (`@accordo/comment-sdk` + CSS export)
     - clarified integration boundary: host consumers own transport/message wiring; SDK owns UI + callbacks

3. **Comments-panel stale prerequisite removal**
   - Removed obsolete prerequisite bugfix section from `docs/20-requirements/requirements-comments-panel.md`.

4. **Package documentation added**
   - Added `packages/comment-sdk/README.md` documenting API, lifecycle, integration boundary, CSS usage, and optional browser-wrapper build path.

5. **Testing guide added**
   - Added `docs/40-testing/testing-guide-comment-sdk.md` with current automated commands and user-journey checks.

6. **Packaging helper decision implemented**
   - Kept `scripts/bundle-browser.mjs` as an optional helper.
   - Wired script into `package.json` via `bundle:browser` and `build:browser`.

7. **Stale test header wording cleaned**
   - Updated `packages/comment-sdk/src/__tests__/sdk.test.ts` header to remove Phase-B/stub-era phrasing.

## Validation

Executed from another working directory (`/tmp`):

- `pnpm --dir /home/liorshtram/projects/accordo --filter @accordo/comment-sdk test` ✅ (47 passing)
- `pnpm --dir /home/liorshtram/projects/accordo --filter @accordo/comment-sdk typecheck` ✅
- `pnpm --dir /home/liorshtram/projects/accordo --filter @accordo/comment-sdk build` ✅
- `pnpm --dir /home/liorshtram/projects/accordo --filter @accordo/comment-sdk build:browser` ✅ (`sdk.browser.js written`)
