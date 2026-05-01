# Review — comments-sync-hardening — Phase D rerun

## Status: PASS

Automated checks I ran in `packages/comments`:
- `pnpm test` ✅
- `pnpm build` ✅
- `pnpm lint` ✅ (`no lint configured yet`)

## Verdict

All four previously-known blockers are closed on current HEAD.

### 1) architecture/runtime-wiring — CLOSED
- `packages/comments/src/comments-bootstrap.ts:87-126` now constructs `new ExternalFanoutNotifier()` with no `NativeComments` in the notifier path.
- `packages/comments/src/comment-tools/mutation-handlers.ts:86-160` now notifies external observers only; MCP mutations no longer call correctness-bearing native widget mutation helpers.
- The canonical convergence path is now `store mutation -> store.onChanged -> nc.reconcile(store.getAllThreads())`.
- `packages/comments/src/__tests__/extension.test.ts:818-869` proves MCP mutations do not directly invoke `NativeComments.addThread/updateThread/removeThread/removeThreads`.

### 2) validation-contract — CLOSED
- `packages/comments/src/comment-mutation-ops.ts:46-62` now enforces `duplicate-thread-id -> duplicate-comment-id -> thread-limit-reached` for `createThread()`.
- `packages/comments/src/comment-mutation-ops.ts:101-112` now enforces `thread-not-found -> duplicate-comment-id -> comment-limit-reached` for `reply()`.
- Assertion-level precedence proof exists in:
  - `packages/comments/src/__tests__/comment-store-validation.test.ts:769-847`
  - `packages/comments/src/__tests__/comment-tools.test.ts:452-557`

### 3) proof-surface — CLOSED
- Exact-message helpers are used for stable-code assertions in `comment-store-validation.test.ts` and the relevant `comment-tools.test.ts` mutation-boundary cases.
- Repository grep found no stable-code substring `toThrow("invalid-/duplicate-/thread-/comment-")` assertions under `packages/comments/src/__tests__`.
- `packages/comments/src/__tests__/extension.test.ts:890-944` now proves the exact `accordo.comments.new` store delta and exact native sync state for the created thread.
- `packages/comments/src/__tests__/extension.test.ts:781-816, 890-944` would fail if `store.onChanged -> reconcile` were removed, because MCP/native creation paths no longer have a direct native-widget fallback.

### 4) D3 testing guide usability — CLOSED
- `docs/testing-guide-comments-sync-hardening.md:77-116` now provides actionable manual flows using normal tester actions: create, reply, resolve, reopen, delete, and reload/restore.
- Internal diagnostics and malformed/orphan simulation steps were moved to an optional developer-only appendix (`docs/testing-guide-comments-sync-hardening.md:186-192`).

## Non-blocking concerns

- `packages/comments/src/__tests__/extension-exports.test.ts:5-10,93-110` still refers to a “composite” notifier in comments/test wording even though runtime now uses `ExternalFanoutNotifier`. The behavior under test is correct; only the wording is stale.

## Review doc path

- `docs/reviews/comments-sync-hardening-phase-d.md`

Phase D may proceed to Phase E presentation.
