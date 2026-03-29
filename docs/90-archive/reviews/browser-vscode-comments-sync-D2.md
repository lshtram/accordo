# Review — browser-vscode-comments-sync — Phase D2 (final short re-review)

## PASS
- Tests: `pnpm --filter browser-extension test` → **17 files, 190 passing, 0 failing**; `pnpm --filter accordo-browser test` → **9 files, 53 passing, 0 failing**.
- Reply `commentId` parity is now explicitly covered end-to-end across the relay boundary:
  - `packages/browser-extension/tests/service-worker.test.ts` (`BR-F-140-E2E`) verifies explicit `commentId` is returned, persisted locally, and forwarded in `reply_comment` payload.
  - `packages/browser/src/__tests__/relay-onrelay.test.ts` (`BR-F-140-MAP`) verifies `reply_comment.commentId` is mapped into `comment_reply` tool invocation.
- Mixed anchored/unanchored fallback non-overlap is explicitly covered:
  - `packages/browser-extension/tests/content-pins.test.ts` (`BR-F-143-MIXED`) asserts anchored pin independence and non-overlapping stacked fallback tops (+32px spacing).
- Previously resolved items remain valid:
  - Tombstone suppression: `BR-F-141` in `service-worker.test.ts`.
  - SW wake periodic sync rehydration: `BR-F-142` in `service-worker.test.ts`.
  - `get_comments_version` mapping: `BR-F-142` in `relay-onrelay.test.ts`.
  - BR-F-122 doc alignment: `docs/requirements-browser-extension.md` states unified `comment_*` routing, no `accordo_browser_*` registration.

## FAIL — must fix before Phase E
- None.
