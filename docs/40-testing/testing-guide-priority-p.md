# Testing Guide — Priority P: Comment Store Unification (VS Code ↔ Browser Extension)

**Module:** Priority P — Comment Store Unification
**Date:** 2026-04-19
**Phase:** D3 — Testing Guide

---

## Section 1 — Automated Tests

All automated tests are in `packages/browser` and `packages/browser-extension`.

### Run All Priority P Tests

```bash
# Browser package (comment-relay-contract + relay-comment-dispatch)
cd packages/browser && pnpm test -- --run

# Browser-extension package (sw-comment-sync-contract)
cd packages/browser-extension && pnpm test -- --run
```

### Test Files and What They Verify

#### `packages/browser/src/__tests__/comment-relay-contract.test.ts`

| Test ID | What It Verifies |
|---|---|
| BR-F-144-01 | `normalizeReadResult({ threads: [...] })` returns envelope unchanged |
| BR-F-144-02 | `normalizeReadResult([...])` (bare array, legacy) returns `{ threads: [...] }` |
| BR-F-144-03 | `normalizeReadResult(null)` and `normalizeReadResult(undefined)` return `{ threads: [] }` |
| BR-F-144-04 | `normalizeReadResult({ threads: null })` and `normalizeReadResult({ threads: "bad" })` return `{ threads: [] }` |
| BR-F-145-01 | `shapeRelayResponse` wraps success result with `success: true` and `requestId` |
| BR-F-145-02 | `shapeRelayResponse` wraps error result with `success: false` and exact error discriminator |
| BR-F-145-03 | `shapeRelayResponse` returns stable `requestId` (same action → same ID on repeated calls) |
| BR-F-144-PARITY-01 | Both relay modes produce the same `{ threads }` shape via `normalizeReadResult` |

**Expected result:** All 11 tests pass.

#### `packages/browser/src/__tests__/relay-comment-dispatch.test.ts`

| Test ID | What It Verifies |
|---|---|
| BR-F-122-01 | `get_comments` routes to `comment_list` tool with `{ url }` |
| BR-F-122-02 | `get_all_comments` routes to `comment_list` with `{ allWindows: true }` |
| BR-F-122-03 | `create_comment` routes to `comment_create` with full args |
| BR-F-122-04 | `reply_comment` routes to `comment_reply` with `{ threadId, body }` |
| BR-F-122-05 | `resolve_thread` routes to `comment_resolve` with `{ threadId }` |
| BR-F-122-06 | `reopen_thread` routes to `comment_reopen` with `{ threadId }` |
| BR-F-122-07 | `delete_comment` routes to `comment_delete` with `{ threadId, commentId }` |
| BR-F-122-08 | `delete_thread` routes to `comment_delete` with `{ threadId }` |
| BR-F-145-04 | Error from `invokeTool` returns `success: false` with error discriminator |
| BR-F-145-05 | (removed — timeout not in Phase A contract) |
| BR-F-43-01 | Works with any `RelayDispatchDeps` implementation |

**Expected result:** All 11 tests pass.

#### `packages/browser-extension/tests/sw-comment-sync-contract.test.ts`

| Test ID | What It Verifies |
|---|---|
| BR-F-146-01 | Canonical `{ threads }` envelope decoded correctly |
| BR-F-146-02 | Legacy bare array decoded and wrapped as `{ threads }` |
| BR-F-146-03 | `null` / `undefined` input returns `[]` without throwing |
| BR-F-146-04 | `{ threads: null }` / `{ threads: "bad" }` returns `[]` defensively |
| BR-F-146-05 | Each thread validated: `id`, `anchor.uri`, `anchor.surfaceType`, `comments[0].author.name` exist |
| BR-F-146-06 | `get_comments` encodes to correct wire format `{ action, payload }` |
| BR-F-146-07 | `create_comment` and `reply_comment` encode with all required fields |
| BR-F-146-08 | Unknown action throws `Error("not implemented")` |

**Expected result:** All 10 tests pass.

---

## Section 2 — User Journey Tests

### Context

Priority P fixes a synchronization bug between the VS Code comment store and the browser extension's local store. The fix ensures that comments created or replied to by the agent appear as pins in the browser extension, matching the behavior of user-created comments.

### Prerequisites

- VS Code with Accordo IDE extension loaded
- Accordo Browser Extension installed in Chrome
- A GitHub page (or any browser-tab surface) that supports comments
- Agent connected via MCP

### Test Scenario 1: Agent Comment Appears as Browser Pin

**Steps:**
1. Open VS Code with the Accordo IDE extension active
2. Connect the browser extension to VS Code via the pairing flow (`accordo_browser_pair`)
3. Open a GitHub PR page in Chrome (e.g., a Copilot review page)
4. In the agent (MCP-connected terminal), create a comment on the page:
   ```
   accordo_comment_create surfaceType=browser url=<page-url> body="Agent test comment"
   ```
5. Observe the page in Chrome — a pin should appear at the comment's anchor location
6. Verify the pin is visible and shows the comment body

**Pass criteria:** A pin appears on the GitHub page in Chrome containing "Agent test comment".

---

### Test Scenario 2: Agent Reply Appears as Browser Pin

**Steps:**
1. With the browser extension connected and a page open
2. Have a user create a comment on the page (user comment → visible as pin ✅)
3. In the agent terminal, reply to the existing thread:
   ```
   accordo_comment_reply threadId=<existing-thread-id> body="Agent reply here"
   ```
4. Observe the same page in Chrome — the existing pin should now show the agent's reply

**Pass criteria:** The reply appears in the same pin thread as the user's original comment.

---

### Test Scenario 3: Both Relay Modes Produce Same Pin Behavior

**Steps:**
1. Test with **shared relay mode** (single browser extension connection):
   - Connect browser extension normally
   - Create an agent comment, verify pin appears
2. Test with **per-window relay mode** (multi-window):
   - Open a second VS Code window with the extension
   - Connect a second browser extension window
   - Create an agent comment in the second window
   - Verify the pin behavior is identical in both modes

**Pass criteria:** Pin visibility is identical regardless of relay mode activation path.

---

### Test Scenario 4: Error Path — Browser Not Connected

**Steps:**
1. Disconnect the browser extension from VS Code (close the extension popup)
2. Attempt to create a comment:
   ```
   accordo_comment_create surfaceType=browser url=<page-url> body="Should fail gracefully"
   ```
3. Verify the VS Code comment store still records the comment (even if browser pin doesn't appear)
4. Reconnect the browser extension
5. The previously created comment should now appear as a pin (comments are persisted in VS Code store)

**Pass criteria:** Comment is created in VS Code even when relay is disconnected. Pin appears when relay reconnects.

---

### Test Scenario 5: Marp Slide Comments — Pin Behavior (Related to Priority R)

**Steps:**
1. Open a Marp presentation in VS Code (`accordo_marp_deck` or `accordo_marp_present`)
2. Add a comment on a slide using the agent
3. Verify the pin appears on the slide
4. Click the pin — the presentation should **not** dismiss
5. Verify the popover opens showing the comment thread

**Pass criteria:** Clicking a pin on a slide opens the popover without dismissing the presentation.

---

## Known Limitations

- Comments on browser-tab surfaces require the browser extension to be connected
- Very large comment threads (> 100 comments on one anchor) may have reduced pin visibility
- Pin anchoring on complex SVG diagrams may be imprecise (separate tracking item)
