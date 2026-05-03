# Review — bidirectional browser comment sync re-review

## Status: PASS

## Checks

- `packages/comments`: targeted vitest + `pnpm typecheck` + `pnpm build` ✅
- `packages/browser`: targeted vitest + `pnpm typecheck` + `pnpm build` + `pnpm lint` ✅
- `packages/browser-extension`: targeted vitest + `pnpm typecheck` + `pnpm build` ✅

## Verdict

Previously reported blockers are closed in the current workspace state.

- `sync_comment_state` now returns the merged/exported comments-store state from the real `accordo-comments` production path, not the inbound browser payload:
  - `packages/comments/src/comments-bootstrap.ts`
  - `packages/comments/src/comment-store-browser-sync.ts`
  - `packages/browser/src/comment-sync-runtime.ts`
  - `packages/browser/src/relay-lifecycle-runtime.ts`
- Browser extension persistence is now durable across in-memory resets and is reloaded from `chrome.storage.local` on the next outbound sync:
  - `packages/browser-extension/src/browser-comment-sync-store.ts`
  - `packages/browser-extension/src/relay-sync-handlers.ts`
- Active legacy browser read models are updated from the merged state so current runtime readers continue to see Accordo-only replies:
  - `packages/browser-extension/src/relay-sync-handlers.ts`
  - proof via `packages/browser-extension/tests/browser-extension-relay-runtime.test.ts`
- Ping-pong prevention is wired through the production `store.onChanged` path with explicit apply-depth guarding:
  - `packages/comments/src/comments-bootstrap.ts`
  - `packages/comments/src/comment-store.ts`
  - proof via `packages/comments/src/__tests__/browser-sync-wakeup.test.ts`
- Browser `anchorKey` metadata is preserved through apply/export for non-default anchors:
  - `packages/comments/src/comment-store-browser-sync.ts`
  - proof via `packages/comments/src/__tests__/browser-sync-wakeup.test.ts`

## Blocking issues

None.
