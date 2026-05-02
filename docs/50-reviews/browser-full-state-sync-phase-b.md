# browser-full-state-sync Phase B test plan

**Date:** 2026-05-02
**Phase:** B (Test Builder)
**Files under test:**
- `packages/comments/src/__tests__/browser-sync-contract.test.ts`
- `packages/browser/src/__tests__/browser-full-state-sync.test.ts`
- `packages/browser-extension/tests/browser-extension-relay-contract.test.ts`

**Requirements covered:** BR-F-157, BR-F-158, BR-F-159, BR-F-160, BR-F-161, BR-F-162, BR-F-163, BR-F-164, BR-F-165, BR-F-166, BR-F-167, BR-F-168, M36-CS-14, M36-CS-16, M36-CS-17, M36-CS-18, M38-CT-12, M38-CT-13, M38-CT-14, M40-EXT-15

---

## 1. Test file structure

### `browser-sync-contract.test.ts` (accordo-comments)

| Section | Description | Pass-eligible? |
|---|---|---|
| A | Contract shape (schemaVersion, uniqueness, timestamps, consistency, tombstone) | 🟢 Yes — inline fixtures only |
| B | Revision metadata semantics (increment, ordering, emittedBy, ISO timestamps) | 🟢 Yes — inline fixtures only |
| C | Browser extension storage shape (multi-page, multi-thread, multi-comment fixtures) | 🟢 Yes — inline fixtures only |
| D | Deprecated path isolation — concept tests + runtime proof via browser package | 🟢 Pass-eligible: error vocabulary + concept; 🔴 real proof in browser package |
| E | Accordo package integration — real CommentStore boundary + ExternalFanoutNotifier wakeup seam | 🔴 RED — calls real production APIs |
| F | Runtime happy-path proof — full-state document structure fixtures | 🟢 Yes — inline fixtures only |

### `browser-full-state-sync.test.ts` (accordo-browser)

| Section | Description | Pass-eligible? |
|---|---|---|
| G | syncBrowserComments runtime behavior — real function, relay request inspection | 🔴 RED — real function + mock relay |
| D | Deprecated dispatch isolation — dispatchBrowserCommentAction rejection | 🔴 RED — real function with mock deps |
| H | Tombstone preservation fixtures | 🟢 Yes — inline fixtures only |
| I | Full-state document structure fixtures | 🟢 Yes — inline fixtures only |

### `browser-extension-relay-contract.test.ts` (browser-extension)

| Section | Description | Pass-eligible? |
|---|---|---|
| A | Canonical store key constant — CANONICAL_BROWSER_COMMENT_SYNC_KEY | 🔴 RED — assertion-level |
| B | Canonical meta persistence — applyMergedBrowserCommentSyncState / persistMergedBrowserCommentSyncState | 🔴 RED — assertion-level |
| C | Canonical active read — getActiveBrowserThreadsForPage | 🔴 RED — storage-injection proof (17-02, 17-03, 17-04 all fail) |
| D | Full-state runner — runBrowserCommentFullStateSync | 🔴 RED — assertion-level |
| E | Fixture proof — canonical key format, action names, meta field names | 🟢 Yes — inline fixtures only |

---

## 2. PASS-ELIGIBLE-IN-B register

Tests that legitimately pass with stubs or inline fixtures; no Phase C wiring required.

### `browser-sync-contract.test.ts` (677 passing)

| Test ID | Why pass-eligible | Proof boundary |
|---|---|---|
| A-01..A-04 | schemaVersion field shape only, no validation call | Inline fixture |
| A-05..A-06 | pageUrl uniqueness detection via Set | Inline fixture |
| A-07..A-08 | thread ID uniqueness detection | Inline fixture |
| A-09 | comment ID uniqueness detection | Inline fixture |
| A-10..A-12 | timestamp format detection via Date.parse | Inline fixture |
| A-13..A-14 | thread.pageUrl consistency checks | Inline fixture |
| A-15..A-16 | comment.threadId consistency checks | Inline fixture |
| A-17..A-18 | tombstone shape + filter on fixture data | Inline fixture |
| A-19 | lastActivity ordering | Inline fixture |
| A-20 | anchorKey non-empty | Inline fixture |
| A-21..A-22 | pageUrl format and requirement | Inline fixture |
| A-23..A-24 | revision integer and ordering | Inline fixture |
| B-01..B-10 | revision metadata semantics (all inline fixtures) | Inline fixture |
| C-01..C-04 | browser extension storage shapes | Inline fixture |
| D-01 | error code vocabulary check | Inline |
| D-02..D-05 | deprecated action names defined (concept only) | Inline |
| D-06 | notify_comments_updated concept | Inline |
| D-07 | request_comment_state_sync concept | Inline |
| F-01..F-05 | full-state document structure fixtures | Inline fixture |
| M36-CS-18-01 | comment_reply tool name exists in createCommentTools | `createCommentTools()` export |
| M38-CT-13-03 | tombstone raw data preserved fixture | Inline fixture |

### `browser-full-state-sync.test.ts` (1357 passing)

| Test ID | Why pass-eligible | Proof boundary |
|---|---|---|
| H-01..H-06 | tombstone fixtures (deletedAt field, filter, raw preservation) | Inline fixture |
| I-01..I-15 | full-state document structure fixtures | Inline fixture |
| D-06 | action-unsupported error code vocabulary | Inline |
| D-07 | request_comment_state_sync concept | Inline |

### `browser-extension-relay-contract.test.ts` (8 passing — all pass-eligible)

| Test ID | Why pass-eligible | Proof boundary |
|---|---|---|
| M36-CS-14-01 | constant exported — existence check only | `browser-comment-sync-store.js` |
| M36-CS-14-02 | constant value check | `browser-comment-sync-store.js` |
| M36-CS-16-01 | function exported — existence check only | `browser-comment-sync-store.js` |
| M36-CS-16-03 | function exported — existence check only | `browser-comment-sync-store.js` |
| M36-CS-18-01 | function exported — existence check only | `browser-comment-sync-runner.js` |
| M38-CT-14-01 | canonical key format has namespace prefix | Inline fixture |
| M38-CT-14-02 | sync_comment_state action name is non-empty string | Inline fixture |
| M38-CT-14-03 | meta field names match intended Phase C schema | Inline fixture |

---

## 3. Required RED tests (production wiring required)

These tests call real production boundaries. They MUST FAIL against the current broken implementation until Phase C adds the missing wiring.

### `browser-sync-contract.test.ts` — 9 🔴 red tests

| Test ID | Requirement | Production boundary | Failure message |
|---|---|---|---|
| M38-CT-12-01 | CommentStore has applyBrowserCommentSyncState method | `CommentStore` class, `../comment-store.js` | `expected 'undefined' to be 'function'` |
| M38-CT-12-02 | method is callable (function type) | Same | `expected 'undefined' to be 'function'` |
| M38-CT-12-03 | applyBrowserCommentSyncState merge persists via getAllThreads | Same + `store.getAllThreads()` | early exit when method undefined → assertion fails |
| M38-CT-12-04 | second call replaces (not appends) state | Same | `expected 'undefined' to be 'function'` |
| M38-CT-12-05 | accepts pageUrl as string | Same | `expected 'undefined' to be 'function'` |
| M36-CS-18-02 | ExternalFanoutNotifier has scheduleWakeup method | `ExternalFanoutNotifier` class, `../comment-tools.js` | `expected 'undefined' to be 'function'` |
| M36-CS-18-03 | comment_reply handler calls scheduleWakeup on external notifier | `createCommentTools(store, trackingNotifier)` + real `comment_reply` handler | test double has scheduleWakeup but handler does not call it → `expected false to be true` |
| M38-CT-13-01 | CommentStore excludes tombstoned threads from active reads | `CommentStore.applyBrowserCommentSyncState()` + `getAllThreads()` | early exit when method undefined |
| M38-CT-13-02 | CommentStore excludes tombstoned comments from active reads | Same | early exit when method undefined |

### `browser-full-state-sync.test.ts` — 7 🔴 red tests

| Test ID | Requirement | Production boundary | Failure message |
|---|---|---|---|
| G-01 | syncBrowserComments calls sync_comment_state relay action | `syncBrowserComments` in `../comment-sync-runtime.js` | `expected [ 'get_all_comments' ] to include 'sync_comment_state'` |
| G-02 | syncBrowserComments does NOT call get_all_comments | Same | `expected [ 'get_all_comments' ] not to include 'get_all_comments'` |
| D-01 | dispatchBrowserCommentAction rejects reply_comment | `dispatchBrowserCommentAction` in `../relay-comment-dispatch.js` | `expected true to be false` (success=true in broken) |
| D-02 | dispatchBrowserCommentAction rejects create_comment | Same | Same |
| D-03 | dispatchBrowserCommentAction rejects delete_comment | Same | Same |
| D-04 | dispatchBrowserCommentAction rejects delete_thread | Same | Same |
| D-05 | dispatchBrowserCommentAction rejects update_comment | Same | Same |

### `browser-extension-relay-contract.test.ts` — 9 🔴 red tests (assertion-level, storage-injection + event-log)

| Test ID | Requirement | Production boundary | Failure message |
|---|---|---|---|
| M36-CS-16-02 | applyMergedBrowserCommentSyncState updates stored meta | `browser-comment-sync-store.ts` | expected meta.lastSentBrowserRevision to be 5, got 0 |
| M36-CS-16-04 | persistMergedBrowserCommentSyncState updates stored meta | Same | expected meta.lastSentBrowserRevision to be 7, got 0 |
| M36-CS-17-02 | getActiveBrowserThreadsForPage returns concrete thread IDs from canonical storage | Same | expected canonical thread t-from-canonical-storage to be present, got no matching thread because persist did not write to injected storage |
| M36-CS-17-03 | getActiveBrowserThreadsForPage filters tombstoned threads | Same | persist did not write canonical data → no matching active thread after filtering → FAILS |
| M36-CS-17-04 | getActiveBrowserThreadsForPage reads from canonical v2 key (not legacy) | Same | persist did not write canonical data → no matching canonical thread → FAILS |
| M36-CS-18-02 | runBrowserCommentFullStateSync sends sync_comment_state | `browser-comment-sync-runner.ts` | expected event log to include request action sync_comment_state, got none |
| M36-CS-18-03 | runBrowserCommentFullStateSync does NOT call get_all_comments | Same | expected action list to contain sync_comment_state before checking absence of get_all_comments, got empty action list |
| M36-CS-18-04 | runBrowserCommentFullStateSync does NOT call get_comments per-page | Same | expected action list to contain sync_comment_state before checking absence of get_comments, got empty action list |
| M36-CS-18-05 | runBrowserCommentFullStateSync persists before broadcast | Same | expected request/persist/broadcast ordering events, got none |

Passing tests in this file (8): M36-CS-14-01, M36-CS-14-02, M36-CS-16-01, M36-CS-16-03, M36-CS-18-01, M38-CT-14-01, M38-CT-14-02, M38-CT-14-03.

---

## 4. Process repair: accidental Phase C implementation removed

The prior Phase B pass introduced `scheduleWakeup` stub implementation in the comments package. This has been reverted:

- ✅ Removed `scheduleWakeup(action, payload?)` from `CommentUINotifier` interface
- ✅ Removed no-op `ExternalFanoutNotifier.scheduleWakeup` implementation
- ✅ Removed `_external.scheduleWakeup(...)` call from `comment_reply` handler in `mutation-handlers.ts`

**Result:** M36-CS-18-02 and M36-CS-18-03 now fail as genuine missing-seam red tests (not green from stub).

---

## 5. Test commands and observed output

### Comments package
```bash
pnpm --filter accordo-comments test -- --run src/__tests__/browser-sync-contract.test.ts

Observed:
  Test Files  1 failed | 17 passed (18)
  Tests       9 failed | 676 passed (685)

Failing tests (all in Section E — real production boundary calls):
  M38-CT-12-01: expected 'undefined' to be 'function'
  M38-CT-12-02: expected 'undefined' to be 'function'
  M38-CT-12-03: expected 'undefined' to be 'function'
  M38-CT-12-04: expected 'undefined' to be 'function'
  M38-CT-12-05: expected 'undefined' to be 'function'
  M36-CS-18-02: expected 'undefined' to be 'function'
  M36-CS-18-03: expected false to be true  (assertion failure — handler does not call scheduleWakeup)
  M38-CT-13-01: expected 'undefined' to be 'function'
  M38-CT-13-02: expected 'undefined' to be 'function'
```

### Browser package
```bash
pnpm --filter accordo-browser test -- --run src/__tests__/browser-full-state-sync.test.ts

Observed:
  Test Files  1 failed | 86 passed (87)
  Tests       7 failed | 1357 passed (1364)

Failing tests:
  G-01: expected [ 'get_all_comments' ] to include 'sync_comment_state'
  G-02: expected [ 'get_all_comments' ] not to include 'get_all_comments'
  D-01: expected true to be false (success=true in broken)
  D-02: same
  D-03: same
  D-04: same
  D-05: same
```

### Browser-extension package
```bash
pnpm --filter browser-extension test -- --run tests/browser-extension-relay-contract.test.ts

Observed:
  Test Files  1 failed | 89 passed (90)
  Tests       9 failed | 1538 passed (1547)

Failing tests (all at assertion level — stubs exist, behavior is broken):
  M36-CS-16-02: expected meta.lastSentBrowserRevision to be 5, got 0
  M36-CS-16-04: expected meta.lastSentBrowserRevision to be 7, got 0
  M36-CS-17-02: expected canonical thread t-from-canonical-storage to be present, got no matching thread because persist did not write to injected storage
  M36-CS-17-03: expected active thread t-active-thread to be present after tombstone filtering, got no matching thread because persist did not write canonical data
  M36-CS-17-04: expected canonical-only v2 thread t-canonical-only-v2 to be present and legacy-only thread absent, got no matching canonical thread because persist did not write canonical data
  M36-CS-18-02: expected event log to include request action sync_comment_state, got none
  M36-CS-18-03: expected action list to contain sync_comment_state before checking absence of get_all_comments, got empty action list
  M36-CS-18-04: expected action list to contain sync_comment_state before checking absence of get_comments, got empty action list
  M36-CS-18-05: expected request/persist/broadcast ordering events, got none

Passing: Section A (2/2), Section B (2/4: 16-01, 16-03 pass), Section C (0/3), Section D (1/5: 18-01 passes), Section E (3/3).

---

## 6. Phase C prerequisite summary

The following production features must be implemented in Phase C for the red tests to pass:

| Missing feature | Phase C target file | Required by |
|---|---|---|
| `CANONICAL_BROWSER_COMMENT_SYNC_KEY = "accordo:browser-comments-sync:v2"` constant | `src/browser-comment-sync-store.ts` | M36-CS-14-01, M36-CS-14-02 |
| `applyMergedBrowserCommentSyncState(response)` — updates stored meta (lastSentBrowserRevision, lastAckedBrowserRevision, lastPersistedAccordoRevision, nextBrowserRevision) | Same | M36-CS-16-01, M36-CS-16-02 |
| `persistMergedBrowserCommentSyncState(state)` | Same | M36-CS-16-03 |
| `getActiveBrowserThreadsForPage(url)` — reads from canonical v2 document, filters tombstones, does NOT read legacy `comments:{url}` keys | Same | M36-CS-17-01, M36-CS-17-02, M36-CS-17-03, M36-CS-17-04 |
| `runBrowserCommentFullStateSync(relay)` — sends sync_comment_state, persists canonical doc, then broadcasts | `src/browser-comment-sync-runner.ts` | M36-CS-18-01, M36-CS-18-02, M36-CS-18-03, M36-CS-18-04, M36-CS-18-05 |
| `CommentStore.applyBrowserCommentSyncState(state: BrowserCommentSyncState): Promise<void>` | `src/comment-store.ts` | M38-CT-12-01, M38-CT-12-02, M38-CT-12-03, M38-CT-12-04, M38-CT-12-05, M38-CT-13-01, M38-CT-13-02 |
| `ExternalFanoutNotifier.scheduleWakeup(action: string, payload?: unknown): void` (extends existing class per approved doc) | `src/comment-tools/notifier.ts` | M36-CS-18-02 |
| `comment_reply` handler calls `_external.scheduleWakeup("request_comment_state_sync", ...)` after store mutation | `src/comment-tools/mutation-handlers.ts` | M36-CS-18-03 |
| `sync_comment_state` implemented in `syncBrowserComments` (replaces get_all_comments + get_comments) | `src/comment-sync-runtime.ts` | G-01, G-02 |
| `dispatchBrowserCommentAction` returns `{ success: false, error: "action-unsupported" }` for deprecated actions | `src/relay-comment-dispatch.ts` | D-01, D-02, D-03, D-04, D-05 |

---

## 7. Phase C non-pass-eligible boundary summary

The following Phase C implementation work is **NOT eligible to be deferred** — all red tests must pass:

1. `CommentStore.applyBrowserCommentSyncState` must validate `schemaVersion === "2.0"` and reject "1.0"
2. `applyBrowserCommentSyncState` must apply full-state merge and persist to `accordo:browser-comments-sync:v2` canonical store key
3. `applyBrowserCommentSyncState` must filter tombstoned threads/comments from `getAllThreads()` output
4. `ExternalFanoutNotifier.scheduleWakeup` must be called by `comment_reply` handler after store mutation (Phase C seam extends the existing class)
5. `syncBrowserComments` must send `sync_comment_state` with structured payload, not `get_all_comments`
6. `dispatchBrowserCommentAction` must return `action-unsupported` for all deprecated actions
7. `request_comment_state_sync` must be the only wakeup action after mutations
8. browser-extension `browser-comment-sync-store.ts` must implement canonical v2 store with meta update semantics
9. browser-extension `browser-comment-sync-runner.ts` must send `sync_comment_state`, persist canonical doc, then broadcast