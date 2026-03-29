# Testing Guide — Browser Extension v2a (SDK + Relay)

Purpose: verify that browser comments use SDK-based interactions and that the new `accordo-browser` relay tools are wired and callable.

Note: current dev setup uses a shared local relay token (`accordo-local-dev-token`) so Chrome extension and `accordo-browser` connect automatically on localhost.

## Part 1 — Get everything running

1. Install dependencies:
   - `pnpm install --no-frozen-lockfile`
2. Build and test the two relevant packages:
   - `pnpm --filter browser-extension test && pnpm --filter browser-extension build`
   - `pnpm --filter accordo-browser test && pnpm --filter accordo-browser build`
3. In VS Code, run the extension host with `accordo-browser` enabled.
4. In Chrome, open `chrome://extensions`, enable Developer Mode, click **Load unpacked**, and choose `packages/browser-extension/dist`.
5. In Chrome extension shortcuts (`chrome://extensions/shortcuts`), set:
   - `Toggle Comments Mode on/off for the active tab` -> `Alt+Shift+C`

## Part 2 — Tool/relay checks

Tool 1 of 8 — `accordo_browser_getAllComments`
- Setup: Keep Chrome extension loaded and any `https://` page open.
- Test 1a: invoke tool and verify page list is returned sorted by `lastActivity` descending.

Tool 2 of 8 — `accordo_browser_getComments`
- Setup: keep one active browser tab in focus.
- Test 2a: invoke with no `url`; verify it defaults to active tab URL.

Tool 3 of 8 — `accordo_browser_createComment`
- Setup: keep one active browser tab in focus.
- Test 3a: invoke with `{ body }`; verify thread is created on active-tab URL.
- Test 3b: invoke with `{ url, anchor, body }`; verify explicit URL/anchor create path works.

Tool 4 of 8 — `accordo_browser_replyComment`
- Setup: create at least one thread manually on the page.
- Test 4a: invoke with `{ threadId, body }`; expect success response when relay is connected.

Tool 5 of 8 — `accordo_browser_resolveThread`
- Setup: thread is currently open.
- Test 5a: invoke with `{ threadId, resolutionNote }`; expect thread status changes to resolved.

Tool 6 of 8 — `accordo_browser_reopenThread`
- Setup: thread is currently resolved.
- Test 6a: invoke with `{ threadId }`; expect thread status changes back to open.

Tool 7 of 8 — `accordo_browser_deleteComment`
- Setup: thread has at least 2 comments.
- Test 7a: invoke with `{ threadId, commentId }`; expect success and comment disappears.

Tool 8 of 8 — `accordo_browser_deleteThread`
- Setup: thread exists.
- Test 8a: invoke with `{ threadId }`; expect success and thread disappears from popup list.

## Part 3 — Browser interaction checks

1. Open `https://example.com`.
2. Toggle Comments Mode with `Alt+Shift+C`.
3. Right-click an element (composer opens directly).
4. Confirm SDK-style inline composer appears and submit a comment.
5. Click the created pin and verify:
   - reply works
   - delete comment works
   - delete thread works
6. Refresh the page and verify re-anchoring behavior remains stable.

## Part 4 — Manual / End-User Tests

| # | Action | Expected |
|---|---|---|
| 1 | Enable comments mode and right-click target element | Right-click launches SDK composer flow (not a separate legacy form) |
| 2 | Submit first comment | Pin appears near click location; popup list shows latest comment preview |
| 3 | Add reply in thread popover | Reply appears immediately and count updates |
| 4 | Resolve then reopen a thread (SDK popover + agent tools) | Status toggles resolved ↔ open without page reload |
| 5 | Delete one reply | Reply is removed from active view/export |
| 6 | Delete thread | Thread disappears from active pins and popup list |
| 7 | Export Markdown | Clipboard contains URL + timestamp + thread/comment text |
| 8 | Refresh page | Existing pins re-anchor close to intended target |
| 9 | Invoke `accordo_browser_getAllComments` from agent | Returns all commented URLs ordered by most recent activity |
| 10 | Invoke `accordo_browser_getComments` without URL | Returns active-tab URL comments and thread summaries |
| 11 | Invoke `accordo_browser_createComment` with only `body` | Creates a thread on active-tab URL and UI updates without page refresh |

## Part 5 — Final check

1. Re-run regression tests:
   - `pnpm --filter browser-extension test`
   - `pnpm --filter accordo-browser test`
2. Re-run package type checks:
   - `pnpm --filter browser-extension typecheck`
   - `pnpm --filter accordo-browser typecheck`
3. Rebuild both packages:
   - `pnpm --filter browser-extension build`
   - `pnpm --filter accordo-browser build`
