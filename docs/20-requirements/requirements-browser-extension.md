# Browser Extension — Requirements Specification

**Package:** `packages/browser-extension` (Chrome Manifest V3 extension)  
**Type:** Chrome browser extension + local VS Code relay integration (v2a)  
**Version:** 0.1.0  
**Date:** 2026-03-19  
**Architecture:** [`docs/10-architecture/browser-extension-architecture.md`](../10-architecture/browser-extension-architecture.md) v2.1  
**Supersedes:** [`docs/20-requirements/requirements-browser.md`](requirements-browser.md) (over-engineered; relay + VSCode extension removed from v1)

**Current status note:** v1 baseline requirements remain documented here; Session 13 v2a relay + SDK convergence requirements are in §3.12 and are now active.

**Historical note on manifest contract:** The manifest example in §2 reflects the actual build output (`scripts/build.ts`). It may differ from the v1 baseline documented elsewhere. The build produces 4 entry points (service-worker.js, content-script.js, popup.js, shadow-tracker.js). The content script model uses two scripts: `shadow-tracker.js` injected at `document_start` (MAIN world) and `content-script.js` injected at `document_idle` with `all_frames: true`.

---

## 1. Purpose

A Chrome Manifest V3 extension that lets a user place spatial comment pins on any web page element. Comments are stored locally in `chrome.storage.local`, exported to clipboard as Markdown/JSON, and exposed to Accordo agents through `accordo-browser` relay tools in v2a.

The extension is **invisible by default**. A keyboard shortcut or toolbar button toggles "Comments Mode", at which point the user can right-click any element to add a comment. This avoids interfering with normal browsing.

---

## 2. Extension Manifest Contract

> **Note:** This example reflects the actual build output from `scripts/build.ts`. The v1 baseline (before v2a SDK convergence) had a different manifest. Key differences: (1) build produces **4** entry points (service-worker.js, content-script.js, popup.js, shadow-tracker.js), not 3; (2) content script model uses **two** scripts (shadow-tracker injected at `document_start` MAIN world, content-script at `document_idle` all_frames); (3) `commands` and `icons` sections are not present in the current manifest.

```json
{
  "manifest_version": 3,
  "name": "Accordo Comments",
  "version": "0.1.0",
  "description": "Place spatial comment pins on any web page. Export to clipboard as Markdown or JSON.",
  "permissions": [
    "activeTab",
    "tabs",
    "storage",
    "contextMenus",
    "scripting",
    "webNavigation",
    "debugger"
  ],
  "host_permissions": ["<all_urls>"],
  "background": {
    "service_worker": "service-worker.js",
    "type": "module"
  },
  "content_scripts": [
    {
      "matches": ["http://*/*", "https://*/*"],
      "js": ["shadow-tracker.js"],
      "run_at": "document_start",
      "world": "MAIN"
    },
    {
      "matches": ["http://*/*", "https://*/*"],
      "js": ["content-script.js"],
      "css": ["content-styles.css"],
      "run_at": "document_idle",
      "all_frames": true
    }
  ],
  "action": {
    "default_popup": "popup.html",
    "default_title": "Accordo Comments"
  },
  "commands": {
    "toggle-comments-mode": {
      "suggested_key": {
        "default": "Alt+Shift+C",
        "mac": "Alt+Shift+C"
      },
      "description": "Toggle Comments Mode on/off for the active tab"
    }
  },
  "web_accessible_resources": [
    {
      "resources": ["content-script.js", "content-styles.css"],
      "matches": ["http://*/*", "https://*/*"]
    }
  ]
}
```

---

## 3. Functional Requirements

### 3.1 Shared Types (M80-TYP)

| ID | Requirement | Acceptance Criteria |
|---|---|---|
| BR-F-01 | `BrowserComment` interface defines all fields: `id`, `threadId`, `createdAt`, `author`, `body`, `anchorKey`, `pageUrl`, `status`, `resolutionNote?`, `deletedAt?`, `deletedBy?` | TypeScript compiles with `strict: true`; all fields match architecture doc §5.1 |
| BR-F-02 | `BrowserCommentThread` interface groups comments by `threadId` with fields: `id`, `anchorKey`, `pageUrl`, `status`, `comments`, `createdAt`, `lastActivity`, `deletedAt?`, `deletedBy?` | Interface matches architecture doc §5.1 |
| BR-F-03 | `PageCommentStore` interface wraps threads per URL with `version`, `url`, and `threads[]` only | `version` field is literal `"1.0"`; screenshots are stored separately under `screenshot:{normalizedUrl}` |
| BR-F-04 | MCP types defined: `McpToolRequest<T>`, `McpToolResponse<T>`, `GetScreenshotArgs`, `GetScreenshotResult`, `GetCommentsArgs`, `GetCommentsResult` | All types match architecture doc §6.1 |
| BR-F-05 | `ExportPayload`, `Exporter`, `ExportResult` interfaces defined for the export layer | Interfaces match architecture doc §7.1 |
| BR-F-06 | All types are runtime-free (no executable code in types module) | Module has zero `function` or `class` declarations |

### 3.2 Comments Mode State Machine (M80-SM)

| ID | Requirement | Acceptance Criteria |
|---|---|---|
| BR-F-10 | Comments Mode defaults to OFF on extension install and browser launch | `chrome.storage.local` `settings.commentsMode` is `false` after `onInstalled` |
| BR-F-11 | `Alt+Shift+C` toggles Comments Mode between OFF and ON | Toggle flips storage value and notifies content script within 100ms |
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
| BR-F-115 | `commands` section declares `toggle-comments-mode` with `Alt+Shift+C` suggestion | Keyboard shortcut appears in `chrome://extensions/shortcuts` |
| BR-F-116 | **Historical v1 constraint — superseded by v2a:** v1 baseline required that `packages/browser-extension/package.json` MUST NOT list `@accordo/comment-sdk` as a dependency. In v2a, the extension imports `@accordo/comment-sdk` via a monorepo esbuild plugin; styles are merged at build time (see `scripts/build.ts`) | v1 branch state kept SDK out; v2a uses workspace import via monorepo plugin |

### 3.12 Session 13 v2a — SDK Convergence + Accordo Connectivity

| ID | Requirement | Acceptance Criteria |
|---|---|---|
| BR-F-117 | Browser comment interactions use a single SDK-driven UI path for create/reply/resolve/reopen/delete (no divergent custom mutation path) | New comment and existing-thread actions are routed via SDK callbacks/adapters to the same service-worker mutation handlers |
| BR-F-118 | Right-click comment creation opens SDK-aligned composer anchored to the clicked element context | Triggering "Add Comment" uses SDK UI flow and creates a thread at the clicked anchor |
| BR-F-119 | Browser extension exposes relay action handlers in service-worker for `get_all_comments`, `get_comments`, `create_comment`, `reply_comment`, `resolve_thread`, `reopen_thread`, `delete_comment`, and `delete_thread` | Relay action dispatch returns typed success/error envelopes and updates storage correctly |
| BR-F-120 | New `packages/browser` VS Code extension (`accordo-browser`) hosts a localhost WebSocket relay for Chrome extension connectivity | Relay starts on activation, accepts extension connection, and maintains client state |
| BR-F-121 | Relay authenticates extension connections using a configured token (dev default allowed) and rejects unauthorized clients | Missing/invalid token connections are refused; valid token connects successfully |
    | BR-F-122 | `accordo-browser` routes browser comment actions through the unified `comment_*` tool set via `onRelayRequest` interceptor; no `accordo_browser_*` tools are registered in the Bridge tool namespace | Browser comment relay actions (`get_comments`, `create_comment`, `reply_comment`, etc.) are dispatched by `browserActionToUnifiedTool` to `comment_list`, `comment_create`, `comment_reply`, etc.; Hub tool list contains unified `comment_*` tools only |
| BR-F-123 | Each browser comment tool call is forwarded over relay with `requestId` correlation and deterministic timeout handling | Timeouts return typed error; successful responses map to tool output without losing request correlation |
| BR-F-124 | End-to-end: agent can read, create, reply, resolve/reopen, and delete browser comments through Hub tools and see updated state on subsequent reads | Sequential tool calls reflect storage mutations in browser extension |
| BR-F-125 | Relay/tool response contract includes typed failure classes: `browser-not-connected`, `unauthorized`, `timeout`, `action-failed` | Errors are deterministic and asserted in tests for each failure mode |
| BR-F-126 | Relay reconnection is automatic for browser-extension disconnect/restart and recovers without VS Code reload | After reconnect, tool calls succeed without manual extension host restart |
| BR-F-127 | **v2a supersession of DD-07:** browser-extension converges on shared `@accordo/comment-sdk` interaction logic via adapter (workspace source or package import), avoiding duplicated mutation UI logic | Create/reply/resolve/reopen/delete are executed through SDK callback flow with no parallel custom mutation path |
| BR-F-128 | Browser relay `get_comments` defaults to the active tab URL when `url` is omitted | Tool call without `url` returns comments for active browser tab |
| BR-F-129 | Browser relay `get_all_comments` returns all commented page URLs sorted by `lastActivity` descending | Most recently worked-on pages appear first with thread/comment summary metadata |
| BR-F-130 | Browser UI updates without manual page refresh when relay/agent mutations occur | Service worker broadcasts update messages and content/popup refresh automatically |
| BR-F-131 | Browser create tool supports active-tab defaults when `url`/`anchor` are omitted | `accordo_browser_createComment` with `{ body }` creates a thread on active tab using fallback anchor when needed |

### 3.13 Session 14 — Unified Comments Tools + Panel Registration

| ID | Requirement | Acceptance Criteria |
|---|---|---|
| BR-F-132 | Browser comment actions are exposed through unified `accordo_comment_*` tools with `scope.modality = "browser"` instead of a browser-only public tool namespace | Agent can perform list/get/create/reply/resolve/reopen/delete for browser comments via `accordo-comments` tool set |
| BR-F-133 | Browser comments are mirrored into the shared comments store/panel projection path so they appear in the Accordo Comments Panel alongside text/diagram/slide comments | Browser-origin threads are visible in panel grouping/filtering with surfaceType `browser` |
| BR-F-134 | Browser-origin threads are marked as volatile retention class for cleanup UX | Panel indicates volatile browser threads and can filter them quickly |
| BR-F-135 | Comments Panel adds a bulk browser cleanup action (`Delete All Browser Comments`) with explicit confirmation | Trigger removes all browser threads and reports deleted count |
| BR-F-136 | Browser-specific public tools remain temporary aliases only during migration and are removed after parity validation | No net functionality loss during alias period; final tool list excludes `accordo_browser_*` |

### 3.15 Page Understanding + Visual Comment Placement (M90/M91)

| ID | Requirement | Acceptance Criteria |
|---|---|---|
| PU-F-01 | `get_page_map` relay action walks the visible DOM tree breadth-first and returns a structured `PageNode[]` array | Content script returns JSON array of `PageNode` objects with `ref`, `tag`, `role`, `name`, `text`, `attrs`, and optional `children` |
| PU-F-02 | `get_page_map` respects `maxDepth` parameter (default 4, max 8) — stops descending at depth limit | Tree with 10-level nesting returns only 4 levels when `maxDepth` is omitted; returns up to 8 when `maxDepth: 8` |
| PU-F-03 | `get_page_map` respects `maxNodes` parameter (default 200, max 500) — stops emitting nodes at count limit | Page with 1000 elements returns exactly 200 nodes when `maxNodes` is omitted; `truncated: true` is set |
| PU-F-04 | `get_page_map` excludes `<script>`, `<style>`, `<noscript>`, `<template>`, and `display: none` elements | Invisible/non-content elements are absent from result |
| PU-F-05 | `get_page_map` returns page metadata: `pageUrl`, `title`, `viewport`, `totalElements`, `truncated` | All metadata fields present and accurate |
| PU-F-06 | `get_page_map` optionally includes bounding box coordinates (`includeBounds: true`) | When enabled, each `PageNode` has `bounds: { x, y, width, height }` relative to viewport |
| PU-F-10 | `inspect_element` relay action accepts `ref` (from page map) or `selector` (CSS) and returns detailed element info | Element details returned when found; `{ found: false }` when not found |
| PU-F-11 | `inspect_element` generates an anchor key using the best available strategy (id → data-testid → aria → css-path → tag-sibling → viewport) | `anchorKey` and `anchorStrategy` present in response; strategy matches hierarchy priority |
| PU-F-12 | `inspect_element` returns element context: parent chain, sibling count/index, nearest landmark | `context` object populated with `parentChain`, `siblingCount`, `siblingIndex`, `nearestLandmark` |
| PU-F-13 | `inspect_element` returns all element attributes, computed visibility, accessible name, and test IDs | `element` object has `attributes`, `visible`, `accessibleName`, `testIds` fields |
| PU-F-14 | `inspect_element` returns bounding box coordinates | `element.bounds` has `x`, `y`, `width`, `height` |
| PU-F-15 | `inspect_element` ref-based lookup uses an ephemeral index built during `get_page_map` execution | Stale refs (from a previous page map) return `{ found: false }` rather than wrong element |
| PU-F-20 | `generateAnchorKey()` tries strategies in order: id → data-testid → aria → css-path → tag-sibling → viewport | Generated key uses the first available stable strategy |
| PU-F-21 | Anchor key format encodes strategy: `"id:submit-btn"`, `"data-testid:login-form"`, `"aria:Submit/button"`, `"css:main>div>button"`, `"tag:button:3:submit"`, `"body:42%x63%"` | Key prefix matches strategy used |
| PU-F-22 | `resolveAnchorKey()` dispatches resolution based on strategy prefix | Strategy-prefixed keys resolve using their specific strategy |
| PU-F-23 | `resolveAnchorKey()` for `id` strategy uses `document.getElementById()` | Element with matching `id` is returned |
| PU-F-24 | `resolveAnchorKey()` for `data-testid` strategy uses `document.querySelector('[data-testid="..."]')` | Element with matching `data-testid` is returned |
| PU-F-25 | `resolveAnchorKey()` falls back through the hierarchy if primary strategy fails | `id:removed-element` falls back to tag-sibling or viewport resolution |
| PU-F-26 | Backward compatibility: existing anchor keys without strategy prefix (e.g. `"button:3:submit"`) resolve through the existing `findAnchorElementByKey()` path | All existing comments continue to resolve correctly |
| PU-F-30 | `get_dom_excerpt` relay action returns sanitized HTML fragment for a CSS selector | Returned HTML contains only `id`, `class`, `role`, `aria-*` attributes; all other attributes stripped |
| PU-F-31 | `get_dom_excerpt` respects `maxDepth` (default 3) and `maxLength` (default 2000) | Excerpt truncated at limits; `truncated: true` when applicable |
| PU-F-32 | `get_dom_excerpt` returns plain text content alongside HTML | `text` field contains `textContent` of the subtree |
| PU-F-33 | `get_dom_excerpt` returns `{ found: false }` when selector matches no elements | No error thrown; graceful empty response |
| PU-F-40 | `CommentBackendAdapter` interface defines `listThreads`, `createThread`, `reply`, `resolve`, `reopen`, `delete`, `isConnected` | Interface compiles with `strict: true`; all methods are async except `isConnected` |
| PU-F-41 | `VscodeRelayAdapter` implements `CommentBackendAdapter` by delegating to `RelayBridgeClient.send()` | All operations route through relay WebSocket |
| PU-F-42 | `LocalStorageAdapter` implements `CommentBackendAdapter` using existing `store.ts` CRUD | All operations use `chrome.storage.local` |
| PU-F-43 | Adapter selection: prefer `VscodeRelayAdapter` when relay is connected, fall back to `LocalStorageAdapter` | When relay disconnects, operations use local storage; when relay reconnects, adapter switches back |
| PU-F-44 | `CommentBackendAdapter` is the single import for all comment operations in content/popup code | No direct `relay.send()` or `store.createThread()` calls outside the adapter layer |
| PU-F-45 | Future `StandaloneMcpAdapter` slot exists as a typed interface only (no implementation) | Type definition compiles; no runtime code |
| PU-F-50 | `browser_get_page_map` MCP tool registered via `bridge.registerTools()` in `packages/browser` | Tool appears in Hub `tools/list` response |
| PU-F-51 | `browser_inspect_element` MCP tool registered via `bridge.registerTools()` in `packages/browser` | Tool appears in Hub `tools/list` response |
| PU-F-52 | `browser_get_dom_excerpt` MCP tool registered via `bridge.registerTools()` in `packages/browser` | Tool appears in Hub `tools/list` response |
| PU-F-53 | MCP tool handlers forward to Chrome relay and return structured results | Agent receives typed JSON response from each tool |
| PU-F-54 | Tools return `{ error: "browser-not-connected" }` when Chrome extension is disconnected | Graceful error response without exception |
| PU-F-55 | Tools return `{ error: "timeout" }` when Chrome relay does not respond within deadline | Default timeout of 10s for page map, 5s for inspect/excerpt |
| PU-F-56 | `browserActionToUnifiedTool()` updated for new relay actions | New actions dispatch correctly through interceptor |
| PU-F-57 | Enhanced anchor keys produced by `inspect_element` are accepted by `comment_create` `anchor.anchorKey` field | Comment creation with `anchorKey: "id:submit-btn"` succeeds end-to-end |

### 3.16 Session 16 — Bidirectional Sync Remediation

| ID | Requirement | Acceptance Criteria |
|---|---|---|
| BR-F-140 | Reply `commentId` parity: when the browser creates a reply locally, the same `commentId` is forwarded to the Hub/VS Code CommentStore via the `reply_comment` relay payload and accepted by the `comment_reply` tool | After browser reply + relay forward, both local store and Hub have the same `commentId` for the reply |
| BR-F-141 | Comment-level tombstone suppression: `mergeLocalAndHubThread` excludes hub comments whose IDs match locally soft-deleted comments (comments with `deletedAt` set) | After local comment soft-delete, GET_THREADS merge does not resurrect deleted comments from hub data |
| BR-F-142 | Periodic sync rehydration: `checkAndSync()` loads comments-mode map from `chrome.storage.local` before iterating tabs, ensuring SW restart recovery detects tabs with Comments Mode ON | After SW restart, periodic sync refreshes tabs that have Comments Mode enabled in storage |
| BR-F-143 | Fallback pin stacking stability: `_fallbackStackIndex` is only reset at the start of `loadThreads`, not mid-render when anchored pins resolve, preventing overlapping fallback pins in mixed anchor sets | Mixed anchored + unanchored threads render with non-overlapping fallback pin positions |

### 3.17 Stable Page Identity (M114-PID)

| ID | Requirement | Acceptance Criteria |
|---|---|---|
| BR-F-150 | Every top-level document session exposes an opaque `pageId` in the `SnapshotEnvelope`; the value MUST be safe for `snapshotId` formatting (`{pageId}:{version}`), so it MUST NOT contain `:` | `pageId` is a non-empty string with no `:`; `snapshotId` continues to parse via the last-colon split contract |
| BR-F-151 | `pageId` is stable for repeated data-producing calls within the same document session | Sequential calls to `get_page_map`, `get_text_map`, `get_semantic_graph`, `get_dom_excerpt`, `inspect_element`, and `capture_region` on the same loaded page return the same `pageId` while `snapshotId` version increments |
| BR-F-152 | Different open tabs MUST NOT collide on `pageId`, even when they show the same URL | Two tabs opened to the same URL produce different `pageId` values; snapshots do not overwrite or interleave in extension/browser retention stores |
| BR-F-153 | A top-level navigation or full reload creates a new `pageId` and resets the snapshot version counter to `0` for the new page session | Call on page A returns `snapshotId` `x:0`; after reload/navigation the first data-producing call returns `snapshotId` `y:0` where `x !== y` |
| BR-F-154 | `pageId` is an internal page-session identity, not a routing handle; MCP tool routing continues to use `tabId`, while retention/diff logic keys by `pageId` from the response envelope | No public MCP tool replaces `tabId` with `pageId`; `SnapshotStore` and `SnapshotRetentionStore` store entries under the envelope's `pageId` |
| BR-F-155 | Implicit diff resolution (`browser_diff_snapshots`) MUST remain page-local: auto-resolved `from`/`to` snapshots are selected only within the matching `pageId` namespace | With snapshots from two tabs in memory, implicit diff on tab A never resolves a snapshot from tab B |
| BR-F-156 | `pageId` is opaque: callers MUST NOT infer URL, title, or tab identity from its format | Documentation and tests treat `pageId` as opaque; changing its internal generation strategy remains backward-compatible |

### 3.18 Region Capture (`browser_capture_region`) (M92-CR / M91-CR)

> **Status:** Phase A — interfaces and stubs only. Implementation in Phase C.  
> **Architecture ref:** [`docs/10-architecture/architecture.md`](../10-architecture/architecture.md) §14.5, [`docs/90-archive/research/page-understanding-architecture.md`](../90-archive/research/page-understanding-architecture.md) §4.4  
> **Depends on:** Page understanding (§3.15) relay + content script infrastructure; existing screenshot capture (§3.8)

| ID | Requirement | Acceptance Criteria |
|---|---|---|
| CR-F-01 | `browser_capture_region` MCP tool registered via `bridge.registerTools()` in `packages/browser` | Tool appears in Hub `tools/list` response |
| CR-F-02 | Tool accepts `anchorKey` input and resolves to element bounding box via content script | Element found → bounding box returned to service worker for cropping |
| CR-F-03 | Tool accepts `nodeRef` input (from `get_page_map`) and resolves to element bounding box | Same resolution path as `anchorKey` but via ephemeral page-map index |
| CR-F-04 | Tool accepts `rect` input (explicit viewport-relative rectangle) as fallback when no element target | `rect: { x, y, width, height }` used directly for cropping |
| CR-F-05 | Tool accepts optional `padding` (default 8, max 100 px) added around the resolved bounding box | Padding applied before crop; clamped to 0–100 range |
| CR-F-06 | Tool accepts optional `quality` (JPEG quality 1–100, default 70) clamped to 30–85 | Quality outside 30–85 clamped; applied to JPEG encoding |
| CR-F-07 | Capture uses `chrome.tabs.captureVisibleTab()` + `OffscreenCanvas` crop — no CDP screenshot APIs | Implementation uses existing `captureVisibleTab` infrastructure only |
| CR-F-08 | Cropped image returned as JPEG data URL with metadata: `width`, `height`, `sizeBytes`, `source` | Response includes all metadata fields |
| CR-F-09 | Max output dimension enforced: 1200 × 1200 px | Images exceeding limit are downscaled before encoding |
| CR-F-10 | Min output dimension enforced: 10 × 10 px | Degenerate rects below minimum return `{ success: false, error: "no-target" }` |
| CR-F-11 | Max data URL size enforced: 500 KB | If over: retry once at quality −10; if still over: `{ success: false, error: "image-too-large" }` |
| CR-F-12 | Failure modes return structured errors: `element-not-found`, `element-off-screen`, `image-too-large`, `capture-failed`, `no-target` | Each failure mode returns `{ success: false, error: "<code>" }` — no exceptions thrown |
| CR-NF-01 | Capture completes within 2 seconds including relay round-trip | End-to-end latency under 2s for typical elements |
| CR-NF-02 | Tool follows same security posture as existing page understanding tools (loopback + token auth) | Only accessible via authenticated relay path |
| CR-NF-03 | Tool marked `dangerLevel: "safe"` and `idempotent: true` | Read-only operation; no side effects |

---

### 3.17 Future — Visual Annotation Layer (RESERVED — Not In Current Scope)

> **Status:** FUTURE — Architectural reservation only. No implementation, stubs, or tests.  
> **Architecture ref:** [`docs/10-architecture/architecture.md`](../10-architecture/architecture.md) §15  
> **Depends on:** Page understanding (§3.15) complete and stable; enhanced anchor strategy battle-tested.

The following requirement IDs are **reserved** for a future Visual Annotation Layer that enables agents to visually mark page elements (lines, frames, circles, highlights, callouts) during conversation. These IDs must not be reused for other purposes.

| ID | Requirement (Future) | Notes |
|---|---|---|
| VA-F-01 | `browser_add_annotation` MCP tool accepts annotation primitive definition and returns `{ annotationId }` | Primitives: line, rectangle, circle, highlight, callout |
| VA-F-02 | `browser_update_annotation` MCP tool updates style or anchor of an existing annotation | Partial update; only supplied fields change |
| VA-F-03 | `browser_remove_annotation` MCP tool removes a single annotation by ID or all annotations on a tab | `{ annotationId? }` or `{ all: true }` |
| VA-F-04 | `browser_list_annotations` MCP tool returns all active annotations for the current or specified tab | Read-only; returns `Annotation[]` |
| VA-F-05 | Annotation overlay layer renders independently from comment pin layer | Separate `<div>` with SVG root; does not interfere with existing pins |
| VA-F-06 | Annotation primitives support configurable style: color, opacity, strokeWidth, dashArray, fill | `AnnotationStyle` interface |
| VA-F-07 | Annotations support TTL-based auto-dismiss (seconds) and manual dismiss via handle | `ttl: number \| null`; dismiss × icon |
| VA-F-08 | Annotations are click-through by default (`pointer-events: none` on overlay) | Interactive handles (dismiss, drag) opt in to `pointer-events: auto` |
| VA-F-09 | Annotations reuse the enhanced anchor strategy from §3.15 (PU-F-20..PU-F-26) for element targeting | Same `anchorKey` format, same `resolveAnchorKey()` resolution |
| VA-F-10 | Annotations are tab-scoped — never cross tab boundaries | Per-tab isolation |
| VA-F-11 | Max 50 annotations per tab; cap enforced at creation time | Returns error when limit reached |
| VA-F-12 | Rate limit: max 20 `browser_add_annotation` calls per minute per MCP session | Prevents agent annotation spam |
| VA-F-13 | Callout text limited to 500 characters | Prevents DOM bloat |
| VA-F-14 | Annotation tools follow the same relay transport path as page understanding tools | Agent → Hub → Bridge → accordo-browser → Chrome relay → content script |
| VA-F-15 | Annotation tools work via standalone MCP adapter (no VS Code required) when `AnnotationBackendAdapter` is connected directly to Hub | Portability parity with `CommentBackendAdapter` (PU-F-45) |
| VA-NF-01 | Annotation rendering latency < 50ms from tool call to visual appearance | SVG DOM insertion is fast |
| VA-NF-02 | Scroll/resize repositioning uses same rAF batching as comment pins | No layout thrashing |
| VA-NF-03 | Annotation layer CSS isolated with `accordo-annotation-*` prefix and `all: initial` | No host page interference |

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
| BR-NF-54 | Relay security hygiene: auth token is never logged and relay binds to localhost only | Code audit + tests verify host binding and token redaction |
| BR-NF-55 | Relay resilience: browser disconnect/reconnect does not require VS Code restart | After browser reconnect, tool calls resume successfully |

### 4.7 Page Understanding Performance

| ID | Requirement | Acceptance Criteria |
|---|---|---|
| PU-NF-01 | `get_page_map` completes within 200ms for pages with up to 5000 DOM elements | Timed execution stays under 200ms |
| PU-NF-02 | Page map JSON response stays under 50KB for default settings (maxDepth: 4, maxNodes: 200) | Serialized output size verified |
| PU-NF-03 | `inspect_element` completes within 50ms | Single-element inspection is fast |
| PU-NF-04 | Enhanced anchor resolution does not regress existing anchor resolution performance | `findAnchorElementByKey()` with strategy prefix adds <5ms overhead vs. existing path |
| PU-NF-05 | `CommentBackendAdapter` switching (relay → local) completes within one event loop tick | No user-visible delay during adapter failover |
| PU-NF-06 | Page understanding MCP tools have the same security posture as existing browser relay tools (loopback + token auth) | Tools only accessible via authenticated relay path |

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
| M81-SDK | SDK convergence adapter | `packages/browser-extension/src/content/*` | ~140 | M80-CS-PINS, M80-CS-INPUT, `@accordo/comment-sdk` |
| M82-RELAY | Browser relay server | `packages/browser/src/*` | ~240 | `accordo-bridge` API, ws |
| M83-BTOOLS | Browser bridge tools | `packages/browser/src/browser-tools.ts` | ~160 | M82-RELAY |
| M90-MAP | Page Map Collector | `packages/browser-extension/src/content/page-map-collector.ts` | ~150 | DOM APIs |
| M90-INS | Element Inspector | `packages/browser-extension/src/content/element-inspector.ts` | ~120 | M90-MAP, DOM APIs |
| M90-ANC | Enhanced Anchor | `packages/browser-extension/src/content/enhanced-anchor.ts` | ~180 | content-anchor.ts |
| M90-ACT | Relay Actions (page understanding) | `packages/browser-extension/src/relay-actions.ts` (extend) | ~80 | M90-MAP, M90-INS |
| M90-ADP | CommentBackendAdapter | `packages/browser-extension/src/adapters/comment-backend.ts` | ~100 | relay-bridge.ts, store.ts |
| M91-PU | Page Understanding MCP Tools | `packages/browser/src/page-understanding-tools.ts` | ~160 | relay, BridgeAPI |
| M91-EXT | Extension Wiring (extend) | `packages/browser/src/extension.ts` (modify) | ~40 | M91-PU |
| M92-CR | Region Capture (content script) | `packages/browser-extension/src/content/region-capture.ts` | ~120 | DOM APIs, OffscreenCanvas |
| M91-CR | Capture Region MCP Tool | `packages/browser/src/page-understanding-tools.ts` (extend) | ~40 | relay, BridgeAPI |
| M95-VA (**FUTURE**) | Visual Annotation Layer | TBD — `src/content/annotation-overlay.ts` + `src/content/annotation-renderer.ts` | ~400 est. | M90-ANC, M90-MAP, relay |

**Total estimated LOC:** ~2,250 (v1 + Session 13 v2a + capture region) + ~400 future (M95-VA)

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
| M81-SDK | BR-F-117, BR-F-118, BR-F-119, BR-F-127, BR-F-130 | BR-NF-01, BR-NF-31 |
| M82-RELAY | BR-F-120, BR-F-121, BR-F-123, BR-F-125, BR-F-126, BR-F-128, BR-F-129 | BR-NF-54, BR-NF-55 |
| M83-BTOOLS | BR-F-122, BR-F-124, BR-F-131 | BR-NF-50, BR-NF-55 |
| M84-UNIFIED | BR-F-132, BR-F-133, BR-F-134, BR-F-135, BR-F-136 | BR-NF-54, BR-NF-55 |
| M85-SYNC-FIX | BR-F-140, BR-F-141, BR-F-142, BR-F-143 | BR-NF-05 |
| M90-MAP | PU-F-01 through PU-F-06 | BR-NF-01, PU-NF-01, PU-NF-02 |
| M90-INS | PU-F-10 through PU-F-15 | BR-NF-01, PU-NF-01, PU-NF-03 |
| M90-ANC | PU-F-20 through PU-F-26 | PU-NF-04 |
| M90-ACT | PU-F-30 through PU-F-33 | PU-NF-01 |
| M90-ADP | PU-F-40 through PU-F-45 | PU-NF-05 |
| M91-PU | PU-F-50 through PU-F-55 | PU-NF-01, PU-NF-06 |
| M91-EXT | PU-F-56, PU-F-57 | PU-NF-06 |
| M92-CR | CR-F-02, CR-F-03, CR-F-04, CR-F-05, CR-F-07, CR-F-09, CR-F-10 | CR-NF-01 |
| M91-CR | CR-F-01, CR-F-06, CR-F-08, CR-F-11, CR-F-12 | CR-NF-01, CR-NF-02, CR-NF-03 |
| M95-VA (**FUTURE**) | VA-F-01 through VA-F-15 | VA-NF-01, VA-NF-02, VA-NF-03 |

---

## 7. Out of Scope for v1

See architecture doc §11 for the full out-of-scope list. Key exclusions:

- WebSocket relay to VS Code (`accordo-browser` VSCode extension)
- CSS selector re-anchoring across page reloads
- Cross-device sync
- Firefox extension
- Chrome Web Store publication
- Rich text / Markdown in comments
- Multi-workspace Chrome switcher
- **Visual Annotation Layer** — Agent visual marking of page elements (lines, frames, circles, highlights, callouts). Architecture reserved in §3.17 and `docs/10-architecture/architecture.md` §15. Depends on page understanding (§3.15) being stable. See roadmap note in `docs/00-workplan/workplan.md`.

---

## 8. Open Questions

1. **User name default:** Prompt on first install or default to "User"? (Affects M80-POP, M80-TYP)
2. **Export format preference:** Default clipboard format — Markdown or JSON? (Affects M80-EXPORT)
3. **Screenshot quality/size:** JPEG at 0.7 (~200KB each) — acceptable? (Affects M80-SCREEN)
4. **Keyboard shortcut conflict:** `Alt+Shift+C` may conflict on some systems — user can remap in `chrome://extensions/shortcuts`. (Affects M80-SM)
5. **Comment character limit:** Cap body at 2000 chars? (Affects M80-STORE, M80-TYP)
