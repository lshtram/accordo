# Testing Guide — comments-sync-hardening

**Module:** `accordo-comments` (VSCode extension)
**TDD Phase:** C/D — canonical reconcile + validation implementation
**Created:** 2026-05-01

---

## Overview

This guide covers automated verification commands and manual steps for validating the comments-sync-hardening implementation (M36-CS-12/13, M37-NC-11/12/14, M40-EXT-14).

### Canonical Architecture

- **CommentStore** is the single source of truth
- **NativeComments** and **Accordo Comments Panel** are projections
- **Canonical mutation path**: `store mutation → store.onChanged → nc.reconcile(store.getAllThreads())`
- MCP mutation handlers notify **external observers only** (browser relay) — never NativeComments directly
- `NativeCommentSync.reconcile()` and `getSyncState()` implement the bidirectional sync algorithm

### Notifier Architecture (comments-sync-hardening)

| Component | Role |
|---|---|
| `ExternalFanoutNotifier` | Fans out to external observers (browser relay). **NOT** NativeComments |
| `NativeComments` | Receives store mutations **only** via `store.onChanged → nc.reconcile()` |
| `registerBrowserNotifier()` | Adds browser relay notifiers to `externalFanout` only |

**Key invariant**: Native widget mutation must NEVER happen via direct handler → `nc.addThread/updateThread/removeThread`. It must ONLY happen via `store.onChanged → nc.reconcile()`.

---

## 1. Automated Verification

### 1.1 Run Phase C/D focused test suite

```bash
cd packages/comments && pnpm test -- \
  src/__tests__/native-comment-sync.test.ts \
  src/__tests__/comment-store-validation.test.ts \
  src/__tests__/extension.test.ts \
  src/__tests__/comment-tools.test.ts \
  src/__tests__/composite-notifier.test.ts \
  src/__tests__/comment-store.test.ts
```

**What it verifies:**
- `NativeCommentSync.reconcile()`: orphan removal, missing widget creation, changed-widget updates, idempotency
- `NativeCommentSync.getSyncState()`: accurate storeThreadIds, nativeWidgetIds, missingWidgetIds, orphanWidgetIds, inSync
- Load-time validation: empty IDs, duplicates, mismatches dropped correctly
- Mutation boundary validation: whitespace IDs rejected with stable codes
- Store-driven reconcile wiring via `store.onChanged`
- Startup reconcile after load/prune
- ExternalFanoutNotifier: external-only fanout semantics (CN-01..08)

### 1.2 Run full package test suite

```bash
cd packages/comments && pnpm test && pnpm build
```

**What it verifies:**
- No regression in existing tests
- TypeScript compiles cleanly (`tsc -b`)
- All 17 test files pass

### 1.3 TypeScript type check

```bash
cd packages/comments && pnpm tsc --noEmit
```

**What it verifies:** No type errors in the implementation

---

## 2. Manual / User-Facing Verification

These steps validate the behavior in a live VS Code environment with the accordo-comments extension loaded.

### 2.1 Create a comment and verify both panels sync

**Steps:**
1. Open the VS Code Comments panel (`View → Comments` or `Cmd+Shift+P → Comments`)
2. Open the Accordo Comments Panel (sidebar)
3. Create a comment via the gutter `+` icon on any source file
4. **Verify**: comment appears in VS Code Comments panel AND Accordo Comments Panel simultaneously
5. Reply to the thread via either panel — **verify** reply appears in both panels
6. Resolve the thread via either panel — **verify** thread shows resolved state in both panels
7. Reopen the thread — **verify** thread returns to open state in both panels
8. Delete the thread — **verify** thread is removed from both panels

### 2.2 Reload / restore session persistence

**Steps:**
1. Create a normal source-file comment using the gutter `+` icon
2. Verify it appears in the editor, VS Code Comments panel, and Accordo Comments Panel
3. Reload the VS Code extension host / development window
4. After activation, verify the same comment is present in the editor, VS Code Comments panel, and Accordo Comments Panel
5. Delete the comment and verify it disappears from both panels

### 2.3 Create and reply via MCP tools

**Steps:**
1. Use an MCP client connected to accordo-hub
2. Call `comment_create` with a text anchor
3. **Verify**: thread appears in both VS Code Comments panel and Accordo panel
4. Call `comment_reply` on the created thread
5. **Verify**: reply appears in both panels
6. Call `comment_resolve`
7. **Verify**: thread status is resolved in both panels
8. Call `comment_reopen`
9. **Verify**: thread status returns to open in both panels
10. Call `comment_delete`
11. **Verify**: thread is removed from both panels

---

## 3. Error Code Reference

### Stable error codes (M36-CS-13 — mutation boundaries)

| Code | When thrown |
|---|---|
| `invalid-thread-id` | threadId is empty or whitespace-only |
| `invalid-comment-id` | commentId is empty or whitespace-only |
| `thread-not-found` | thread ID does not exist in store |
| `comment-not-found` | comment ID does not exist in its thread |
| `thread-already-resolved` | trying to resolve an already-resolved thread |
| `thread-not-resolved` | trying to reopen a non-resolved thread |
| `duplicate-thread-id` | caller-supplied threadId already exists in store (M36-CS-13 precedence: first wins) |
| `duplicate-comment-id` | caller-supplied commentId already exists in store (M36-CS-13 precedence: first wins) |

### Precedence rules for caller-supplied IDs (M36-CS-13)

| Operation | Order |
|---|---|
| `comment_create` | 1. duplicate thread ID → 2. duplicate comment ID → 3. thread limit reached |
| `comment_reply` | 1. thread not found → 2. duplicate comment ID → 3. comment limit reached |

### Load-time validation issue codes (M36-CS-12)

| Code | When reported |
|---|---|
| `empty-thread-id` | thread has empty/whitespace ID |
| `duplicate-thread-id` | thread ID already seen (first wins) |
| `empty-comment-id` | comment has empty/whitespace ID |
| `duplicate-comment-id` | comment ID already seen in same thread (first wins) |
| `mismatched-comment-thread-id` | comment.threadId does not match parent thread ID |

---

## 4. Architecture Notes

### Canonical reconcile path

```
store.createThread/reply/resolve/reopen/delete
  → store.onChanged(uri)
    → nc.reconcile(store.getAllThreads())
      → dispose orphans (widget IDs not in store)
      → create missing (store threads not in widgets map)
      → update changed (widget state differs from store thread)
```

### Bootstrap wiring (comments-bootstrap.ts)

```
activate()
  → store.load() + pruneStaleThreads()
  → nc.init(store, context)
  → nc.restoreThreads(store.getAllThreads())
  → runStartupNativeProjectionReconcile(store, nc)   // full reconcile after load
  → wireStoreDrivenNativeProjectionReconcile(store, nc) // store.onChanged listener
  → externalFanout = new ExternalFanoutNotifier()   // NOT composite with nc
  → createCommentTools(store, externalFanout)        // handlers notify externalFanout only
  → registerBrowserNotifier(notifier) → externalFanout.add(notifier)
```

### Diagnostic command (bridge-integration.ts)

`accordo_comments_internal_getSyncState` → `nc.getSyncState(store.getAllThreads())`

Returns live `NativeCommentSyncState` reflecting current store + native widget map.

### Optional developer diagnostics appendix

These checks are **optional and developer-only**. They are not required for normal manual verification:

- Run `accordo_comments_internal_getSyncState` from an extension-development console or test harness to inspect `inSync`, `missingWidgetIds`, and `orphanWidgetIds`.
- Inject malformed `.accordo/comments.json` contents in a disposable workspace to verify load-time validation reports.
- Simulate orphan native widgets only from tests or a development harness; normal testers should not create raw VS Code API widgets manually.

---

## 5. Test Coverage Map

| Requirement | Test File | What is tested |
|---|---|---|
| M36-CS-12 (load-time validation) | `comment-store-validation.test.ts` | empty IDs, duplicates, mismatches dropped with machine-checkable report |
| M36-CS-13 (mutation boundary + precedence) | `comment-store-validation.test.ts` | whitespace IDs rejected with stable error codes; duplicate ID precedence |
| M37-NC-11 (reconcile algorithm) | `native-comment-sync.test.ts` | orphan removal, missing creation, update detection, idempotency |
| M37-NC-12 (store-driven reconcile) | `extension.test.ts` B6/B7 tests | store.onChanged → reconcile wiring at activation |
| M37-NC-14 (sync diagnostics) | `native-comment-sync.test.ts` + `extension.test.ts` B8 | getSyncState returns accurate live state |
| M40-EXT-14 (diagnostic command) | `extension.test.ts` B8 | `accordo_comments_internal_getSyncState` registered and returns correct shape |
| CN-01..08 (external fanout) | `composite-notifier.test.ts` | ExternalFanoutNotifier external-only fanout semantics |
