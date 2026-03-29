# Testing Guide — Session 14: Unified Comments Contract

**Module:** `accordo-comments` + `accordo-browser`  
**Packages:** `packages/comments`, `packages/browser`, `packages/bridge-types`  
**Session:** 14 — M84-TOOLS, M85-PANEL, M86-MIGRATE  
**Requirements:** `docs/requirements-comments.md` M38/M40; `docs/requirements-browser-extension.md` §3.13

---

## Section 1 — Automated Tests

### Run all tests

```bash
pnpm test
```

Expected: all packages pass, zero failures.

### Run `accordo-comments` tests

```bash
cd packages/comments && pnpm test
```

**What it verifies:**

| Test group | What it covers |
|---|---|
| `CommentStore` §createThread | M36-CS-01: creates thread with retention; volatile-browser for browser modality |
| `CommentStore` §listThreads | M36-CS-05/06: filters by uri, status, intent, anchorKind, surfaceType |
| `CommentStore` §reopen | M36-CS-04: agent can reopen resolved threads (M38-CT-06) |
| `CommentStore` §deleteAllByModality | M38-CT-07: bulk deletes only browser threads; returns count; persists |
| `CommentTools` §tool count | 7 tools registered (was 6) |
| `CommentTools` §scope.modality routing | M38-CT-01: each modality (text/browser/diagram/slide/etc.) routes to correct store filter |
| `CommentTools` §accordo_comment_reopen | M38-CT-06: tool exists, correct dangerLevel, handler reopens thread |
| `CommentTools` §accordo_comment_create browser | M38-CT-03: browser modality sets retention="volatile-browser"; anchor.kind="browser" builds surface anchor |
| `CommentTools` §deleteScope | M38-CT-07: deleteScope with modality=browser+all=true triggers bulk delete path |
| `extension` §tool registration | 7 tools registered via BridgeAPI |
| `panel-commands` §deleteAllBrowserComments | M40-EXT-12: confirmation dialog → store.deleteAllByModality → refresh |

**Expected output:**
```
Test Files  9 passed (9)
     Tests  315 passed (315)
```

### Run `accordo-browser` tests

```bash
cd packages/browser && pnpm test
```

**What it verifies:**

| Test group | What it covers |
|---|---|
| `auth-token` | Token generation and validation |
| `request-router` | Relay request routing |
| `extension-activation` | Extension activates and registers tools |
| `browser-tools` | 8 `accordo_browser_*` tools registered and callable |
| `relay-server` | WebSocket relay server lifecycle |

**Expected output:**
```
Test Files  5 passed (5)
     Tests  11 passed (11)
```

### TypeScript type check

```bash
cd packages/comments && pnpm exec tsc --noEmit
cd packages/browser && pnpm exec tsc --noEmit
cd packages/bridge-types && pnpm exec tsc --noEmit
```

Expected: zero errors on all three packages.

---

## Section 2 — User Journey Tests

### Prerequisites

1. VS Code with all Accordo extensions installed (`accordo-hub`, `accordo-bridge`, `accordo-comments`, `accordo-browser`)
2. Chrome browser with the `accordo-browser` extension loaded (`chrome://extensions` → Load unpacked → `packages/browser-extension/dist`)
3. Hub running (`cd packages/hub && pnpm start`)
4. Bridge connected to Hub

---

### Journey 1 — Unified comment tools for browser

**Setup:** Chrome extension loaded, browser open to any webpage, Comments Mode toggled on.

| Step | Action | Expected |
|---|---|---|
| 1 | In VS Code, open the Comments Panel (`Views` → `Accordo Comments`) | Panel shows with globe icon |
| 2 | Open Chrome to `https://example.com` | Page loads |
| 3 | Right-click an element on the page, select "Add Comment" | SDK composer opens |
| 4 | Type "Test comment" and submit | Pin appears on page; popup shows thread |
| 5 | In VS Code Comments Panel, expand "Browser" section | Thread appears with globe icon |
| 6 | Open a code file in VS Code (e.g. `src/index.ts`) | File opens in editor |
| 7 | Select a line, use `accordo_comment_list` with `scope.modality: "text"` | Returns code file comments only |
| 8 | Use `accordo_comment_list` with `scope.modality: "browser"` | Returns browser page comments only |

**Requirement verified:** M38-CT-01, M38-CT-11, BR-F-132

---

### Journey 2 — Create and resolve browser comments via unified tools

**Setup:** Hub connected, browser extension active.

| Step | Action | Expected |
|---|---|---|
| 1 | Open Chrome to a webpage | — |
| 2 | Toggle Comments Mode (`Alt+Shift+C`) | Extension icon updates |
| 3 | In VS Code, call `accordo_comment_create` with: `scope.modality: "browser"`, `scope.url: "https://example.com"`, `body: "Agent comment via unified tool"` | Thread created on the browser page |
| 4 | Refresh the browser page | Pin re-anchors near same element |
| 5 | Call `accordo_comment_resolve` with `threadId` from step 3, `resolutionNote: "Fixed via unified tool"` | Thread status → resolved |
| 6 | In Chrome popup, check thread list | Thread shows as resolved with green indicator |

**Requirement verified:** M38-CT-03 (browser modality + retention), M38-CT-05, BR-F-132

---

### Journey 3 — Reopen a resolved browser comment

| Step | Action | Expected |
|---|---|---|
| 1 | Create and resolve a browser comment (Journey 2 steps 1–5) | Thread is resolved |
| 2 | Call `accordo_comment_reopen` with the `threadId` | Thread status → open |
| 3 | In Chrome popup, check thread list | Thread shows as open (blue pin) |

**Requirement verified:** M38-CT-06, BR-F-132

---

### Journey 4 — Bulk browser cleanup via Comments Panel

**Setup:** Multiple browser comment threads exist across different pages.

| Step | Action | Expected |
|---|---|---|
| 1 | Open VS Code Comments Panel | Shows all threads grouped by status |
| 2 | Click the `...` menu or right-click in the panel | Context menu appears |
| 3 | Select "Delete All Browser Comments" | Confirmation dialog: "Delete all browser comments? This cannot be undone." |
| 4 | Click "Delete All" | All browser threads deleted; panel refreshes |
| 5 | Check Chrome popup for any open pages | No browser threads listed |

**Requirement verified:** M40-EXT-12, BR-F-135

---

### Journey 5 — DeleteScope bulk browser delete via tool

| Step | Action | Expected |
|---|---|---|
| 1 | Create 3 browser comment threads across different URLs | All 3 visible in `accordo_comment_list` with `scope.modality: "browser"` |
| 2 | Call `accordo_comment_delete` with `deleteScope: { modality: "browser", all: true }` | All 3 threads deleted |
| 3 | Call `accordo_comment_list` with `scope.modality: "browser"` | Returns empty `threads: []` |
| 4 | Verify text/slide/diagram comments are untouched | Other modality threads unaffected |

**Requirement verified:** M38-CT-07, BR-F-135

---

### Journey 6 — Agent reopening (user and agent can reopen)

| Step | Action | Expected |
|---|---|---|
| 1 | Resolve a comment thread (user or agent) | Thread marked resolved |
| 2 | Agent calls `accordo_comment_reopen` with `threadId` | Thread reopens without error |
| 3 | Human reopens via panel context menu "Reopen" | Also works |

**Requirement verified:** M38-CT-06 (agent reopen)

---

## Section 3 — Final Check

### Build both packages

```bash
cd packages/browser-extension && pnpm build
cd packages/browser && pnpm build
```

### Full regression test

```bash
pnpm test
```

Expected: **2,590 tests passing**, zero failures.

### Manual smoke test checklist

| Check | How | Pass criteria |
|---|---|---|
| VS Code extensions all activate | Open VS Code with all extensions; check Output panel for activation messages | No red errors |
| Hub connects | `GET http://localhost:3000/health` returns `{"ok":true}` | Status 200, `"bridge":"connected"` |
| Comments Panel opens | Click Accordo Comments in View menu | Panel shows tree view |
| Browser extension loads | Open `chrome://extensions`, confirm extension is enabled | No errors |
| Unified tools visible to agent | Check Hub `/tools` response for `accordo_comment_*` tools | 7 tools listed |
| `deleteAllBrowserComments` command registered | Check VS Code command palette for `accordo.commentsPanel.deleteAllBrowserComments` | Command found |
