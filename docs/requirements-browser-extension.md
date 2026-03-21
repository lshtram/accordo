# Browser Extension — Requirements Specification

**Package:** `packages/browser-extension` (Chrome Manifest V3 extension)  
**Type:** Chrome browser extension (standalone, no VS Code dependency in v1)  
**Version:** 0.1.0  
**Date:** 2026-03-19  
**Architecture:** [`docs/browser-extension-architecture.md`](browser-extension-architecture.md) v2.0  
**Supersedes:** [`docs/requirements-browser.md`](requirements-browser.md) (over-engineered; relay + VSCode extension removed from v1)

---

## 1. Purpose

A standalone Chrome Manifest V3 extension that lets a user place spatial comment pins on any web page element. Comments are stored locally in `chrome.storage.local`, exported to the clipboard as structured Markdown/JSON, and retrievable by an AI agent via a stubbed MCP API shape.

The extension is **invisible by default**. A keyboard shortcut or toolbar button toggles "Comments Mode", at which point the user can right-click any element to add a comment. This avoids interfering with normal browsing.

---

## 2. Extension Manifest Contract

```json
{
  "manifest_version": 3,
  "name": "Accordo Comments",
  "version": "0.1.0",
  "description": "Spatial comments on any web page — standalone, clipboard-first export",
  "permissions": [
    "activeTab",
    "storage",
    "contextMenus",
    "scripting"
  ],
  "host_permissions": ["<all_urls>"],
  "background": {
    "service_worker": "dist/service-worker.js",
    "type": "module"
  },
  "content_scripts": [
    {
      "matches": ["http://*/*", "https://*/*"],
      "js": ["dist/content-script.js"],
      "css": ["dist/content-styles.css"],
      "run_at": "document_idle"
    }
  ],
  "action": {
    "default_popup": "dist/popup.html",
    "default_icon": {
      "16": "icons/icon-16.png",
      "48": "icons/icon-48.png",
      "128": "icons/icon-128.png"
    }
  },
  "commands": {
    "toggle-comments-mode": {
      "suggested_key": {
        "default": "Ctrl+Shift+A",
        "mac": "Command+Shift+A"
      },
      "description": "Toggle Comments Mode on/off"
    }
  },
  "icons": {
    "16": "icons/icon-16.png",
    "48": "icons/icon-48.png",
    "128": "icons/icon-128.png"
  }
}
```

---

## 3. Functional Requirements

### 3.1 Shared Types (M80-TYP)

| ID | Requirement | Acceptance Criteria |
|---|---|---|
| BR-F-01 | `BrowserComment` interface defines all fields: `id`, `threadId`, `createdAt`, `author`, `body`, `anchorKey`, `pageUrl`, `status`, `resolutionNote?`, `deletedAt?`, `deletedBy?` | TypeScript compiles with `strict: true`; all fields match architecture doc §5.1 |
| BR-F-02 | `BrowserCommentThread` interface groups comments by `threadId` with fields: `id`, `anchorKey`, `pageUrl`, `status`, `comments`, `createdAt`, `lastActivity`, `deletedAt?`, `deletedBy?` | Interface matches architecture doc §5.1 |
| BR-F-03 | `PageCommentStore` interface wraps threads per URL with `version`, `url`, `threads[]`, `lastScreenshot?` | `version` field is literal `"1.0"` |
| BR-F-04 | MCP types defined: `McpToolRequest<T>`, `McpToolResponse<T>`, `GetScreenshotArgs`, `GetScreenshotResult`, `GetCommentsArgs`, `GetCommentsResult` | All types match architecture doc §6.1 |
| BR-F-05 | `ExportPayload`, `Exporter`, `ExportResult` interfaces defined for the export layer | Interfaces match architecture doc §7.1 |
| BR-F-06 | All types are runtime-free (no executable code in types module) | Module has zero `function` or `class` declarations |

### 3.2 Comments Mode State Machine (M80-SM)

| ID | Requirement | Acceptance Criteria |
|---|---|---|
| BR-F-10 | Comments Mode defaults to OFF on extension install and browser launch | `chrome.storage.local` `settings.commentsMode` is `false` after `onInstalled` |
| BR-F-11 | `Ctrl+Shift+A` (Mac: `Cmd+Shift+A`) toggles Comments Mode between OFF and ON | Toggle flips storage value and notifies content script within 100ms |
| BR-F-12 | Toolbar button click toggles Comments Mode between OFF and ON | Same behaviour as keyboard shortcut |
| BR-F-13 | When Comments Mode transitions to ON: context menu "Add Comment" item is created; existing pins for the current URL become visible; badge is updated | Context menu item exists (verified via `chrome.contextMenus.create` call); content script receives `comments-mode-on` message |
| BR-F-14 | When Comments Mode transitions to OFF: context menu "Add Comment" item is removed; all pins are hidden; badge is cleared | Context menu item removed; content script receives `comments-mode-off` message; badge text is empty |
| BR-F-15 | Extension icon title reflects current state: "Accordo Comments (OFF)" or "Accordo Comments (ON)" | `chrome.action.setTitle` called with correct string on each transition |
| BR-F-16 | Comments Mode is **tab-scoped**: each tab has independent ON/OFF state; opening a new tab defaults to OFF regardless of other tabs | New tab starts in OFF state; toggling in tab A does not affect tab B |

### 3.3 Comment Storage Manager (M80-STORE)

| ID | Requirement | Acceptance Criteria |
|---|---|---|
| BR-F-20 | Create a new comment: generates UUID v4 `id`, sets `createdAt` to ISO 8601, stores in the correct URL-keyed `PageCommentStore` | Comment retrievable by `id`; `createdAt` is valid ISO 8601 |
| BR-F-21 | Create a new thread: first comment's `id` becomes `threadId`; thread inherits `anchorKey` and `pageUrl` from the comment | `thread.id === thread.comments[0].id` |
| BR-F-22 | Reply to an existing thread: appends comment with matching `threadId`; updates `thread.lastActivity` | Thread has N+1 comments after reply; `lastActivity` updated |
| BR-F-23 | Resolve a thread: sets `thread.status = "resolved"`; optionally sets `resolutionNote` on the resolving comment | `status` is `"resolved"` after operation |
| BR-F-24 | Reopen a resolved thread: sets `thread.status = "open"` | `status` is `"open"` after operation |
| BR-F-25 | Soft-delete a comment: sets `comment.deletedAt` to ISO 8601 timestamp; comment remains in storage | `deletedAt` is set; comment still exists in storage array |
| BR-F-26 | Soft-delete a thread: sets `thread.deletedAt` to ISO 8601 timestamp; thread and all comments remain in storage | `deletedAt` is set on thread; `threads` array length unchanged |
| BR-F-27 | Query active threads for a URL: returns only threads where `deletedAt === undefined`, with soft-deleted comments filtered out within each thread | Soft-deleted threads excluded; soft-deleted comments within active threads excluded; UI receives pre-filtered data |
| BR-F-28 | Query all threads for a URL (including deleted): returns every thread regardless of `deletedAt` | All threads returned, including soft-deleted |
| BR-F-29 | URL normalization: `origin + pathname` only; query params and hash stripped | `https://example.com/page?utm=abc#section` → `https://example.com/page` |
| BR-F-30 | Storage key format: `"comments:{normalizedUrl}"` | Correct key used for `chrome.storage.local.get`/`set` |

### 3.4 Background Service Worker (M80-SW)

| ID | Requirement | Acceptance Criteria |
|---|---|---|
| BR-F-40 | Service worker initializes on `chrome.runtime.onInstalled` with default settings | `settings` key in storage has `commentsMode: false` and default `userName` |
| BR-F-41 | Service worker routes messages from content script: `create-comment`, `reply-comment`, `resolve-thread`, `reopen-thread`, `delete-comment`, `delete-thread`, `get-threads` | Each message type dispatched to correct M80-STORE function |
| BR-F-42 | Service worker routes messages from popup: `toggle-mode`, `export-comments`, `get-threads`, `get-settings` | Each message type dispatched to correct handler |
| BR-F-43 | Context menu `onClicked` handler captures the clicked element info and sends `show-comment-form` message to the content script | Content script receives the element's anchor key |
| BR-F-44 | Service worker re-initializes state from `chrome.storage.local` on wake (MV3 lifecycle) | No in-memory state survives worker termination; all state read from storage |
| BR-F-45 | Badge count updated after every comment/thread mutation | `chrome.action.setBadgeText` called with current off-screen count |

### 3.5a Content Script — Pin Rendering & Positioning (M80-CS-PINS)

| ID | Requirement | Acceptance Criteria |
|---|---|---|
| BR-F-50 | When Comments Mode is ON, render a pin marker adjacent to each anchored element that has an active (non-deleted) thread | One pin per thread; pin positioned relative to anchor element |
| BR-F-57 | On scroll or resize, reposition all pins relative to their anchor elements | Pins track element positions within one animation frame |
| BR-F-58 | Detect off-screen pins (element above viewport, below viewport, or in collapsed container) and report count to service worker | Service worker receives accurate off-screen count |
| BR-F-59 | When Comments Mode transitions to OFF, remove all pins and popovers from the DOM | Zero `accordo-*` elements remain in DOM |
| BR-F-60 | Right-click capture: record the element the user right-clicked and generate an `anchorKey` in format `{tagName}:{siblingIndex}:{textFingerprint}` | `anchorKey` is deterministic for the same element |
| BR-F-61 | `MutationObserver` monitors DOM for SPA navigation changes and triggers pin refresh | After DOM mutation, pins re-anchor to updated elements; orphaned pins removed |

### 3.5b Content Script — Comment Input & Popovers (M80-CS-INPUT)

| ID | Requirement | Acceptance Criteria |
|---|---|---|
| BR-F-51 | Clicking a pin opens a popover showing the thread: all non-deleted comments in chronological order, with author, timestamp, and body | Popover displays correct thread data |
| BR-F-52 | Popover includes a reply input field; submitting sends `reply-comment` message to service worker | Reply appears in thread after submission |
| BR-F-53 | Popover includes resolve/reopen button based on current thread status | Button label matches status; clicking sends correct message |
| BR-F-54 | Popover includes a delete button on each comment; clicking sends `delete-comment` message | Comment disappears from popover after soft-delete |
| BR-F-55 | When context menu "Add Comment" is triggered, show an inline comment input form near the right-clicked element | Form appears; escape or click-away dismisses it |
| BR-F-56 | Submitting the comment input form sends `create-comment` message to service worker and renders a new pin (via M80-CS-PINS) | New pin appears; storage updated |

### 3.6 Content Script Styles (M80-CSS)

| ID | Requirement | Acceptance Criteria |
|---|---|---|
| BR-F-65 | All CSS classes prefixed with `accordo-` to avoid host page conflicts | No unprefixed class names in stylesheet |
| BR-F-66 | Root container uses `all: initial` to reset inherited styles from host page | Container element has `all: initial` in computed style |
| BR-F-67 | Pin and popover have `z-index: 2147483646` to appear above host page content | z-index set correctly |
| BR-F-68 | Light/dark mode via `prefers-color-scheme` media query — no `--vscode-*` variables | No `--vscode-` prefixed variables in any CSS rule |
| BR-F-69 | Pin states: default (numbered badge), hover (slight scale), active/selected (highlight ring) | Visual distinction between states |

### 3.7 Export Layer (M80-EXPORT)

| ID | Requirement | Acceptance Criteria |
|---|---|---|
| BR-F-70 | `ClipboardExporter` formats threads as Markdown and copies to clipboard via `navigator.clipboard.writeText` | Clipboard contains valid Markdown after export |
| BR-F-71 | Markdown format includes: page URL, export timestamp, thread anchor, all non-deleted comments (author, time, body), thread status | All fields present in exported Markdown |
| BR-F-72 | JSON export option copies `ExportPayload` as JSON string to clipboard | Valid JSON in clipboard; round-trips through `JSON.parse` |
| BR-F-73 | Export excludes soft-deleted threads and comments by default | Deleted items absent from export payload |
| BR-F-74 | Full export (audit mode) includes soft-deleted threads and comments | All items present when `includeDeleted: true` |
| BR-F-75 | `Exporter` interface is extensible: new exporters can be registered without modifying existing code | Array-based registry; adding an exporter requires only `implements Exporter` and push to registry |

### 3.8 Screenshot Capture (M80-SCREEN)

| ID | Requirement | Acceptance Criteria |
|---|---|---|
| BR-F-80 | Capture visible tab screenshot on export trigger via `chrome.tabs.captureVisibleTab()` | Screenshot stored in `chrome.storage.local` as `ScreenshotRecord` |
| BR-F-81 | Screenshot stored as JPEG at quality 0.7, keyed by `"screenshot:{normalizedUrl}"` with shape `{ dataUrl: string, capturedAt: number, width: number, height: number }` | Storage key correct; JPEG quality setting applied; record shape matches `ScreenshotRecord` |
| BR-F-82 | One screenshot per URL — each capture overwrites the previous record for that URL | After two captures for same URL, only one record exists; `capturedAt` reflects latest capture |
| BR-F-83 | Retrieve stored screenshot by URL for MCP handler consumption | `getScreenshot(url)` returns the `ScreenshotRecord` or `undefined` if none exists |
| BR-F-84 | Warn at 8MB total storage usage; auto-purge oldest screenshot (by `capturedAt`) at threshold | Warning logged at 8MB; one screenshot purged per cycle until under threshold |

### 3.9 MCP Handler Layer (M80-MCP)

| ID | Requirement | Acceptance Criteria |
|---|---|---|
| BR-F-90 | `handleGetScreenshot` accepts `McpToolRequest<GetScreenshotArgs>` and returns `McpToolResponse<GetScreenshotResult>` | Return type matches; function signature matches architecture doc §6.2 |
| BR-F-91 | `handleGetScreenshot` reads real screenshot data from `chrome.storage.local` and returns it when available | If `ScreenshotRecord` exists for URL, response has `success: true` and `data` populated with `dataUrl`, `capturedAt`, `pageUrl`, `viewport` |
| BR-F-92 | `handleGetScreenshot` returns `{ success: false, error: "no-screenshot-available" }` when no screenshot exists for the requested URL | Error case handled gracefully; no throw |
| BR-F-93 | `handleGetComments` accepts `McpToolRequest<GetCommentsArgs>` and returns `McpToolResponse<GetCommentsResult>` | Return type matches; function signature matches architecture doc §6.2 |
| BR-F-94 | `handleGetComments` reads real comment data from `chrome.storage.local`, respecting `status` and `includeDeleted` filters | Filtered results match expected threads from storage |
| BR-F-95 | `handleGetComments` returns `{ success: false, error: "no-comments-found" }` for URLs with no comments | Error case handled gracefully; no throw |
| BR-F-96 | MCP handlers are wired into service worker message router under a `mcp:` message namespace | Messages with `type: "mcp:get_screenshot"` and `type: "mcp:get_comments"` route to handlers |
| BR-F-97 | MCP handler module exports functions individually with typed signatures; no side effects on import; v2 relay integration requires only adding a transport module — handler logic is unchanged | Functions are exported; import has no side effects; handler logic reads from storage (not stubbed) |

### 3.10 Popup UI (M80-POP)

| ID | Requirement | Acceptance Criteria |
|---|---|---|
| BR-F-100 | Popup displays a list of all active (non-deleted) threads for the current tab's URL | Thread list matches storage for current URL |
| BR-F-101 | Each thread item shows: anchor description, comment count, status (open/resolved), last activity time | All fields visible |
| BR-F-102 | Clicking a thread item in popup sends a `scroll-to-thread` message to the content script | Content script scrolls anchor element into view |
| BR-F-103 | Popup has "Copy as Markdown" button that triggers clipboard export | Button visible; click triggers `ClipboardExporter` with Markdown format |
| BR-F-104 | Popup has "Copy as JSON" button that triggers clipboard export | Button visible; click triggers `ClipboardExporter` with JSON format |
| BR-F-105 | Popup has a Comments Mode toggle (switch/checkbox) reflecting current state | Toggle state matches `settings.commentsMode` |
| BR-F-106 | Popup shows off-screen comment count when Comments Mode is ON | Count displayed; matches badge count |
| BR-F-107 | Popup shows user name from settings with option to change it | User name displayed; edit saves to `settings.userName` |
| BR-F-108 | Popup shows "No comments on this page" when the current URL has no threads | Empty state message displayed |

### 3.11 Manifest & Build (M80-MANIFEST)

| ID | Requirement | Acceptance Criteria |
|---|---|---|
| BR-F-110 | `manifest.json` declares Manifest V3 with all required permissions | Extension loads in Chrome without permission errors |
| BR-F-111 | Content script matches `http://*/*` and `https://*/*` only (no `chrome://`, `file://`, extension pages) | Content script does not inject on excluded URLs |
| BR-F-112 | Build produces 3 entry points via esbuild: `service-worker.js`, `content-script.js`, `popup.js` | All 3 files exist in `dist/` after build |
| BR-F-113 | Build copies `manifest.json`, icons, and `popup.html` to `dist/` | All static assets present in build output |
| BR-F-114 | Extension side-loads in Chrome via `chrome://extensions` → "Load unpacked" pointing to `dist/` | Extension appears in Chrome with correct name and icon |
| BR-F-115 | `commands` section declares `toggle-comments-mode` with `Ctrl+Shift+A` / `Cmd+Shift+A` | Keyboard shortcut appears in `chrome://extensions/shortcuts` |
| BR-F-116 | `packages/browser-extension/package.json` MUST NOT list `@accordo/comment-sdk` as a dependency (enforces DD-07) | Neither `dependencies` nor `devDependencies` contains `@accordo/comment-sdk` |

---

## 4. Non-Functional Requirements

### 4.1 Performance

| ID | Requirement | Acceptance Criteria |
|---|---|---|
| BR-NF-01 | Comments Mode toggle latency < 100ms from trigger to UI state change | Content script pins show/hide within 100ms of message receipt |
| BR-NF-02 | Pin repositioning on scroll/resize uses `requestAnimationFrame` — no layout thrashing | Scroll handler batches DOM reads and writes into single rAF callback |
| BR-NF-03 | Content script injection does not block page load (`run_at: "document_idle"`) | Page fully loaded before content script executes |
| BR-NF-04 | Export (clipboard copy) completes in < 500ms for up to 100 threads | Export tested with 100 threads; timing < 500ms |
| BR-NF-05 | Service worker cold-start (re-initialize from storage) < 200ms | Worker reads settings + current page store within 200ms |

### 4.2 Storage

| ID | Requirement | Acceptance Criteria |
|---|---|---|
| BR-NF-10 | Total `chrome.storage.local` usage stays under 10MB (Chrome quota) | Storage usage tracked; warning at 8MB |
| BR-NF-11 | Screenshot JPEG quality capped at 0.7 to limit file size (~200KB per screenshot) | JPEG quality parameter verified in `captureVisibleTab` options |
| BR-NF-12 | Only latest screenshot per URL stored — no screenshot history accumulation | Storage for a URL has at most one screenshot record |

### 4.3 Security

| ID | Requirement | Acceptance Criteria |
|---|---|---|
| BR-NF-20 | No data leaves the browser in v1 — all storage is local, all export is clipboard | No network requests from extension code (verified by code audit) |
| BR-NF-21 | Content script DOM manipulation uses DOM APIs (no `innerHTML` with user-provided content) | No `innerHTML` assignments with unsanitized input |
| BR-NF-22 | Comment body is plain text only in v1 — no HTML/Markdown rendering in pins or popovers | Text content displayed via `textContent` property, not `innerHTML` |
| BR-NF-23 | CSP nonce generation uses `crypto.getRandomValues()` if any nonces are needed | No `Math.random()` for security-sensitive values |

### 4.4 Compatibility

| ID | Requirement | Acceptance Criteria |
|---|---|---|
| BR-NF-30 | Chrome 120+ supported (Manifest V3 stable APIs) | Extension loads and functions on Chrome 120+ |
| BR-NF-31 | Content script styles isolated from host page via `all: initial` + `accordo-` prefix | No visual interference with host page styles |
| BR-NF-32 | Extension excluded from `chrome://`, `file://`, and other extension pages | Content script does not inject on excluded URLs |

### 4.5 Resilience

| ID | Requirement | Acceptance Criteria |
|---|---|---|
| BR-NF-40 | Service worker termination (MV3 lifecycle) does not lose state — all state in `chrome.storage.local` | Worker restart reads state from storage; no data loss |
| BR-NF-41 | DOM mutations on the page (SPA navigation) trigger a pin refresh via `MutationObserver` | Pins re-anchor after DOM changes |
| BR-NF-42 | Anchor keys are session-scoped — re-anchoring across page reloads is a known v1 limitation, documented in popup | Popup shows a note when anchors may be stale |

### 4.6 Build & Development

| ID | Requirement | Acceptance Criteria |
|---|---|---|
| BR-NF-50 | TypeScript `strict: true` in `tsconfig.json` | Compilation succeeds with strict mode |
| BR-NF-51 | Zero `any` in source code | `grep ": any" src/` returns no results |
| BR-NF-52 | esbuild bundles each entry point with tree-shaking and source maps | Source maps present in `dist/`; unused code eliminated |
| BR-NF-53 | `pnpm test` runs all unit tests (Vitest) and passes | Zero failures, zero skipped |

---

## 5. Module Summary

| Module ID | Name | File(s) | Est. LOC | Dependencies |
|---|---|---|---|---|
| M80-TYP | Shared Types | `src/types/comment-types.ts` | ~120 | None |
| M80-SM | Comments Mode State Machine | `src/background/comments-mode.ts` | ~100 | Chrome APIs |
| M80-STORE | Comment Storage Manager | `src/background/comment-store.ts` | ~180 | Chrome APIs, M80-TYP |
| M80-SW | Background Service Worker | `src/background/service-worker.ts` | ~150 | M80-SM, M80-STORE, M80-SCREEN, M80-MCP |
| M80-CS-PINS | Content Script: Pin Rendering | `src/content/pin-renderer.ts` | ~130 | M80-TYP, M80-STORE, M80-SM, M80-CSS |
| M80-CS-INPUT | Content Script: Input & Popovers | `src/content/comment-input.ts` | ~150 | M80-TYP, M80-STORE, M80-SM, M80-CS-PINS, M80-CSS |
| M80-CSS | Content Script Styles | `src/content/content-styles.css` | ~200 | None |
| M80-EXPORT | Export Layer | `src/content/export.ts` | ~120 | M80-TYP |
| M80-SCREEN | Screenshot Capture | `src/background/screenshot.ts` | ~60 | Chrome APIs, M80-TYP |
| M80-MCP | MCP Handler Layer | `src/mcp/mcp-types.ts` + `src/mcp/mcp-handlers.ts` | ~100 | M80-TYP, M80-STORE, M80-SCREEN |
| M80-POP | Popup UI | `src/popup/popup.html` + `src/popup/popup.ts` | ~180 | M80-TYP, M80-EXPORT |
| M80-MANIFEST | Manifest & Build | `manifest.json` + `esbuild.config.ts` | ~60 | None |

**Total estimated LOC:** ~1,550

---

## 6. Requirement-to-Module Traceability

| Module | Functional Reqs | Non-Functional Reqs |
|---|---|---|
| M80-TYP | BR-F-01 through BR-F-06 | BR-NF-50, BR-NF-51 |
| M80-SM | BR-F-10 through BR-F-15 | BR-NF-01, BR-NF-40 |
| M80-STORE | BR-F-20 through BR-F-30 | BR-NF-10, BR-NF-40 |
| M80-SW | BR-F-40 through BR-F-45 | BR-NF-05, BR-NF-40 |
| M80-CS-PINS | BR-F-50, BR-F-57, BR-F-58, BR-F-59, BR-F-60, BR-F-61 | BR-NF-01, BR-NF-02, BR-NF-03, BR-NF-31, BR-NF-41 |
| M80-CS-INPUT | BR-F-51 through BR-F-56 | BR-NF-01, BR-NF-31 |
| M80-CSS | BR-F-65 through BR-F-69 | BR-NF-31 |
| M80-EXPORT | BR-F-70 through BR-F-75 | BR-NF-04, BR-NF-20 |
| M80-SCREEN | BR-F-80 through BR-F-84 | BR-NF-10, BR-NF-11, BR-NF-12 |
| M80-MCP | BR-F-90 through BR-F-97 | BR-NF-20, BR-NF-50 |
| M80-POP | BR-F-100 through BR-F-108 | BR-NF-01, BR-NF-30 |
| M80-MANIFEST | BR-F-110 through BR-F-115 | BR-NF-30, BR-NF-32, BR-NF-52 |

---

## 7. Out of Scope for v1

See architecture doc §11 for the full out-of-scope list. Key exclusions:

- WebSocket relay to VS Code (`accordo-browser` VSCode extension)
- CSS selector re-anchoring across page reloads
- Cross-device sync
- `@accordo/comment-sdk` integration
- Firefox extension
- Chrome Web Store publication
- Agent-initiated comments (push to Chrome)
- Rich text / Markdown in comments
- Multi-workspace Chrome switcher

---

## 8. Open Questions

1. **User name default:** Prompt on first install or default to "User"? (Affects M80-POP, M80-TYP)
2. **Export format preference:** Default clipboard format — Markdown or JSON? (Affects M80-EXPORT)
3. **Screenshot quality/size:** JPEG at 0.7 (~200KB each) — acceptable? (Affects M80-SCREEN)
4. **Keyboard shortcut conflict:** `Ctrl+Shift+A` may conflict — alternative shortcut? (Affects M80-SM)
5. **Comment character limit:** Cap body at 2000 chars? (Affects M80-STORE, M80-TYP)
