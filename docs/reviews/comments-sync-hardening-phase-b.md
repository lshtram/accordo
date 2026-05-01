# Review — comments-sync-hardening — Phase B re-review

## Status: PASS

### Resolved blockers

1. **boundary-proof** (was: `native-comment-sync.test.ts:108-127, 339-356`)
   - "reconcile does not remove widgets that correspond to store threads" (line 108–127): now also asserts `report.storeThreadIds` contains threadId, `report.nativeWidgetIds` contains threadId, and `report.inSync === true`. These require real reconciliation to pass.
   - "getSyncState returns inSync=true when all store threads have native widgets" (line 339–356): now also asserts `state.storeThreadIds` contains threadId and `state.nativeWidgetIds` contains threadId. These require real sync-state computation to pass.

2. **Missing pass-eligible proof surface** (was: `extension.test.ts:712-740`)
   - Phase B plan now explicitly names B8 registration and shape tests (lines 713–720, 722–740) as pass-eligible — they verify command registration and schema contract only.
   - B8 "getSyncState reflects store mutations in real time" (line 743–769) is moved to the red/non-pass-eligible table — it requires live store→syncState correlation the stub cannot provide.
   - C9 (line 780+) also listed as non-pass-eligible.

### Result

No open blockers remain. The approval surface now explicitly includes the
intentional green-before-Phase-C C10 registration-only case at
`packages/comments/src/__tests__/extension.test.ts:826-833`, so the prior
approval-surface completeness blocker is closed.

---

## Phase B Test Plan — comments-sync-hardening

This section is the explicit approval surface for pass-eligible Phase B cases.

### Intentional pass-eligible cases (allowed to pass before Phase C)

| Test file | Lines | What is tested | Why it passes now |
|---|---|---|---|
| `comment-tools.test.ts` | 83–118 | `createCommentTools()` returns exactly 8 tools with correct names (`comment_list`, `comment_get`, `comment_create`, `comment_reply`, `comment_resolve`, `comment_reopen`, `comment_delete`, `comment_sync_version`), correct inputSchema, and non-null handlers | `createCommentTools` is fully implemented; tool registration shape is stable and unchanged |
| `comment-tools.test.ts` | 83–118 | `all tools have descriptions ≤ 120 chars` and `all tools have inputSchema.type === 'object'` | Schema contract already met by existing implementation |
| `extension.test.ts` | 190–223 | `registerTools` called with `"accordo-comments"` and exactly 8 tools | Activation wiring and registration calls are already connected and functional |
| `extension.test.ts` | 190–223 | `pushes tool disposable into context.subscriptions` | Extension activation lifecycle already wired; disposables already flow into subscriptions |
| `extension.test.ts` | 183–224 | Extension context subscriptions include controller + tools | Idempotent and already satisfied by current wiring |
| `extension.test.ts` | 713–720 | B8: `accordo_comments_internal_getSyncState` command is registered after `activate()` | Command registration path is already wired via existing extension activation; no sync-state computation required |
| `extension.test.ts` | 722–740 | B8: registered `getSyncState` command returns the correct `NativeCommentSyncState` shape (all required fields present, correct types) | Shape is defined by the TypeScript interface `NativeCommentSyncState`; the stub handler already returns a correctly-typed object; this is a schema-contract check only |
| `extension.test.ts` | 826–833 | C10: `accordo.comments.new` command is registered after `activate()` | Command registration is an existing activation-boundary contract; this test only proves the user-facing command is present before behavior/convergence assertions run |

### New sync/validation behavior — red / not pass-eligible

All tests in `native-comment-sync.test.ts` targeting `reconcile()` / `getSyncState()`
are intended as **non-pass-eligible** sync-behavior proofs, and the extension-level
runtime boundary tests for store-driven reconcile / startup reconcile / live sync
state / MCP convergence are also intended to remain red until Phase C behavior exists.

| Test file | Lines | Why non-pass-eligible |
|---|---|---|
| `native-comment-sync.test.ts` | 108–127 | `reconcile does not remove widgets that correspond to store threads` — now asserts `storeThreadIds`, `nativeWidgetIds`, and `inSync` are computed, not hardcoded empty |
| `native-comment-sync.test.ts` | 339–356 | `getSyncState returns inSync=true when all store threads have native widgets` — now asserts `storeThreadIds` and `nativeWidgetIds` are populated from actual state |
| `extension.test.ts` | 743–769 | B8: `getSyncState reflects store mutations in real time` — asserts live store→syncState correlation; stub returns stale empty arrays |
| `extension.test.ts` | 780+ | C9: MCP tool → store → native projection convergence — full behavior path; requires Phase C implementation |
