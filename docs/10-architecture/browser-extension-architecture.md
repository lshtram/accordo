# Accordo — Browser Extension Architecture v2.1

**Status:** ACTIVE — v1 shipped; v2a relay + SDK convergence in progress  
**Date:** 2026-03-21  
**Scope:** Chrome Manifest V3 browser extension + `accordo-browser` relay for agent actions  
**Supersedes:** `docs/browser-architecture.md` v1.0 (over-engineered; relay + VSCode extension removed from v1)  
**Requirements:** [`docs/20-requirements/requirements-browser-extension.md`](../20-requirements/requirements-browser-extension.md)

---

## 0. Current Status

- **v1 baseline (historical):** Standalone browser comments, local storage, clipboard export. Documented for context.
- **v2a (current):** Browser extension includes relay client/actions and SDK convergence. `accordo-browser` relay package exists and registers browser comment tools through Bridge. `VscodeRelayAdapter` is implemented (routes to `RelayBridgeClient.send()`) but `RelayBridgeClient` does not yet forward comment mutations to VS Code unified comment tools — see Priority P in workplan.
- Historical v1-only statements are explicitly marked as baseline/history throughout this doc.

---

## 1. Executive Summary

### What This Is (v2a current)

A Chrome Manifest V3 extension that lets a user place spatial comment pins on any web page element. Comments are stored locally in `chrome.storage.local`, exported to the clipboard, and exposed to Accordo agents via the local relay path (`accordo-browser` WebSocket relay). The extension imports `@accordo/comment-sdk` via monorepo workspace for shared UI/UX patterns.

The extension is **invisible by default**. A keyboard shortcut (`Alt+Shift+C`) or toolbar button toggles "Comments Mode", at which point the user can right-click any element to add a comment. This avoids interfering with normal browsing.

### Historical v1 baseline (for context)

- **No relay in v1 baseline.** Relay and Hub connectivity were deferred from initial release.
- **No external MCP transport in v1 baseline.** Handlers existed, transport did not.
- **Not a persistence layer across devices.** Comments live in `chrome.storage.local` — local to the browser profile. No sync, no cloud.
- **Not a CSS-selector-based anchoring system.** v1 anchors comments to the element the user right-clicked using a simple `data-block-id` approach. Robust CSS selector re-anchoring across page reloads is deferred.
- **Not integrated with `@accordo/comment-sdk`.** The SDK uses `--vscode-*` CSS variables that have no browser equivalent. v1 inlines its own comment UI directly.

### Package Location

```
packages/browser-extension/     Chrome Manifest V3 extension
├── scripts/
│   └── build.ts               esbuild config — produces 4 entry points
├── src/
│   ├── adapters/             CommentBackendAdapter implementations
│   │   └── comment-backend.ts  (VscodeRelayAdapter, LocalStorageAdapter)
│   ├── content/              Content script modules + comment UI
│   │   ├── comment-ui.ts       (pin/popover rendering)
│   │   ├── content-entry.ts    (esbuild entry for content-script.js IIFE)
│   │   ├── content-styles.css  (extension CSS, merged with SDK CSS at build)
│   │   ├── enhanced-anchor.ts  (strategy-prefixed anchor keys)
│   │   ├── element-inspector.ts
│   │   ├── message-handlers.ts
│   │   ├── page-map-collector.ts
│   │   ├── shadow-root-tracker.ts
│   │   └── shadow-tracker-entry.ts (esbuild entry for shadow-tracker.js)
│   ├── popup/
│   │   └── popup.html
│   ├── relay-bridge.ts        (WebSocket client → accordo-browser relay)
│   ├── relay-*.ts             (relay action handlers)
│   ├── service-worker.ts       (background entry)
│   ├── store.ts               (chrome.storage.local CRUD)
│   ├── mcp-handlers.ts
│   └── manifest.json
└── dist/                      Build output
```

---

## 2. Design Decisions

### DD-01: Comments Mode Toggle (Invisible by Default)

**Decision:** The extension is invisible by default. A keyboard shortcut (`Ctrl+Shift+A` / `Cmd+Shift+A`) or the extension toolbar button toggles "Comments Mode" on/off. Only while Comments Mode is active does the right-click context menu show "Add Comment" and are existing pins visible.

**Rationale:** Chrome extensions that modify every page's right-click menu are intrusive. Users browse thousands of pages but comment on few. The toggle ensures zero interference with normal browsing. The extension icon badge shows an indicator when Comments Mode is active.

**Scope:** Comments Mode is **tab-scoped** — each tab has independent ON/OFF state. Opening a new tab does not inherit Comments Mode from another tab. The service worker tracks `{ [tabId]: boolean }` in memory (re-derived from `chrome.storage.local` on worker wake). The keyboard shortcut and toolbar button affect only the active tab.

### DD-02: Right-Click Context Menu for Comment Creation (v1 Baseline — Historical)

**v1 baseline decision:** While in Comments Mode, right-clicking any page element shows a DOM-injected "Add Comment" option (a `data-accordo-context-menu` div in the body) and the user right-clicks to trigger. The anchor is captured via `generateAnchorKey()` which generates `{tagName}:{siblingIndex}:{textFingerprint}`.

**Note:** The actual implementation uses a DOM-injected context menu element, not the Chrome `contextMenus` API. The manifest declares `contextMenus` permission but the UI uses a DOM-rendered menu item triggered by the content script. The `show-comment-form-at-cursor` message triggers the inline comment form. Service worker context menu creation (`chrome.contextMenus.create`) is not used in the current implementation.

**v2a update:** Right-click comment creation opens the SDK-aligned composer via `openSdkComposerAtAnchor()` in `src/content/sdk-convergence.ts`, which routes through SDK callbacks to the service worker mutation handlers.

### DD-09: Simple Element Identification (v1 baseline — Historical)

**v1 baseline decision:** Elements are identified using a composite key: `{tagName}:{siblingIndex}:{textFingerprint}`. Stored as `anchorKey`. Not a full CSS selector path.

**v2a (current):** Enhanced anchor strategy uses strategy-prefixed keys: `"id:submit-btn"`, `"data-testid:login-form"`, `"aria:Submit/button"`, `"css:main>div>button"`, `"tag:button:3:submit"`, `"body:42%x63%"`. Resolution dispatches based on strategy prefix via `resolveAnchorKey()` in `enhanced-anchor.ts`. Backward compatibility: legacy keys without strategy prefix resolve through the existing `generateAnchorKey()` path.

### DD-10: MCP/Relay Layer — Real Handlers, Live Transport

**Decision:** Handler logic reads real storage data and mutation actions run through service-worker authority. In v2a, transport is active via local relay (`accordo-browser` <-> browser-extension) for agent-facing tools.

**Rationale:** Implementing the handlers against real storage in v1 means the v2 relay integration is purely additive — only a transport module (`relay-client.ts`) needs to be added. No handler logic changes, no type changes, no storage format migration. The handlers are tested against real storage operations from day one.

### DD-11: Data Stored Per-URL

**Decision:** Comments are keyed by page URL (origin + pathname, query params stripped). Each URL has an independent comment collection. Screenshots are keyed by `screenshot:{normalizedUrl}` — one record per URL, overwritten on each capture.

**Rationale:** URL is the natural partition key for web comments. Stripping query params avoids fragmentation (e.g., UTM tracking params creating separate comment collections for the same page).

---

## 3. Component Diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│  Chrome Browser                                                       │
│                                                                       │
│  ┌──────────────────────────────────────────────────────────────────┐ │
│  │  Background Service Worker  (background/service-worker.ts)        │ │
│  │                                                                   │ │
│  │  • Comments Mode state machine (OFF ↔ ON)                         │ │
│  │  • Context menu lifecycle (create/remove "Add Comment" item)      │ │
│  │  • Storage coordinator (chrome.storage.local CRUD)                │ │
│  │  • Screenshot capture (chrome.tabs.captureVisibleTab)             │ │
│  │  • Badge count updater                                            │ │
│  │  • MCP handler (get_screenshot, get_comments — real data)          │ │
│  │  • Message router (content script ↔ popup ↔ storage)              │ │
│  └────────────┬─────────────────────────┬────────────────────────────┘ │
│               │ chrome.runtime          │ chrome.runtime               │
│               │ .sendMessage            │ .sendMessage                 │
│  ┌────────────▼──────────────────┐  ┌───▼──────────────────────────┐  │
│  │  Content Script               │  │  Popup UI                    │  │
│  │  (content/content-script.ts)  │  │  (popup/popup.html+ts)       │  │
│  │                               │  │                              │  │
│  │  • Pin renderer (inline CSS)  │  │  • Comment list for page     │  │
│  │  • Popover renderer           │  │  • Export buttons (JSON/MD)  │  │
│  │  • Right-click anchor capture │  │  • Comments Mode toggle      │  │
│  │  • Comment input form         │  │  • Off-screen comment list   │  │
│  │  • Scroll/resize reposition   │  │  • Settings (future relay)   │  │
│  │  • Off-screen detection       │  │                              │  │
│  └───────────────────────────────┘  └──────────────────────────────┘  │
│                                                                       │
│  ┌──────────────────────────────────────────────────────────────────┐ │
│  │  MCP Handler Layer  (mcp/mcp-types.ts + mcp/mcp-handlers.ts)     │ │
│  │                                                                   │ │
│  │  • TypeScript types: McpToolRequest, McpToolResponse               │ │
│  │  • get_screenshot: reads real screenshot from storage              │ │
│  │  • get_comments: reads real comments from storage + applies filter │ │
│  │  • Future: WebSocket relay client connects here (transport only)   │ │
│  └──────────────────────────────────────────────────────────────────┘ │
│                                                                       │
│  ┌──────────────────────────────────────────────────────────────────┐ │
│  │  Export Layer  (content/export.ts)                                 │ │
│  │                                                                   │ │
│  │  interface Exporter { export(data: ExportPayload): Promise<void> } │ │
│  │  ├── ClipboardExporter   (v1 — copies JSON/Markdown)              │ │
│  │  ├── McpExporter         (v2 stub — sends via relay)              │ │
│  │  └── FileExporter        (future — downloads .json file)          │ │
│  └──────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘

                    │
                    │ Future v2: WebSocket to accordo-browser
                    │ VSCode extension relay → Bridge → Hub
                    ▼

┌──────────────────────────────────────────────────────────────────────┐
│  Accordo Hub  (NO CHANGES in v1)                                      │
│                                                                       │
│  Future: get_screenshot + get_comments registered as MCP tools        │
│  Future: browser comment state in system prompt                       │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 4. Comments Mode State Machine

```
                    ┌───────────────────────────────────────────────┐
                    │                                               │
                    ▼                                               │
┌──────────┐    Alt+Shift+C / toolbar click    ┌────┴─────┐
               │   OFF    │ ──────────────────────────────────► │    ON    │
              │          │                                     │          │
              │ No pins  │ ◄────────────────────────────────── │ Pins     │
              │ No menu  │    Ctrl+Shift+A / toolbar click     │ visible  │
              │ No badge │                                     │ Menu     │
              └──────────┘                                     │ active   │
                                                               │ Badge    │
                                                               └────┬─────┘
                                                                    │
                                                    Right-click element
                                                                    │
                                                                    ▼
                                                          ┌──────────────────┐
                                                          │  Context Menu:   │
                                                          │  "Add Comment"   │
                                                          └────────┬─────────┘
                                                                   │
                                                              User clicks
                                                                   │
                                                                   ▼
                                                          ┌──────────────────┐
                                                          │  Comment Input   │
                                                          │  (inline form)   │
                                                          └────────┬─────────┘
                                                                   │
                                                        Submit / Cancel
                                                                   │
                                                                   ▼
                                                          ┌──────────────────┐
                                                          │  ON (updated)    │
                                                          │  New pin visible │
                                                          │  Badge updated   │
                                                          └──────────────────┘
                                                                   │
                                                          Export (popup btn)
                                                                   │
                                                                   ▼
                                                          ┌──────────────────┐
                                                          │  Screenshot      │
                                                          │  captured +      │
                                                          │  Clipboard       │
                                                          │  filled          │
                                                          └──────────────────┘
```

**Transitions:**

| From | To | Trigger | Side Effects |
|---|---|---|---|
| OFF | ON | `Alt+Shift+C` / toolbar click / `chrome.commands` | Create context menu item; show pins for current URL; update badge |
| ON | OFF | `Alt+Shift+C` / toolbar click | Remove context menu item; hide all pins; clear badge |
| ON | ON (input) | Right-click element → "Add Comment" | Capture element reference; show inline comment form |
| ON (input) | ON | Submit comment | Store comment; render pin; update badge |
| ON (input) | ON | Cancel | Discard form; no state change |
| ON | ON (export) | Export button in popup | Capture screenshot; copy to clipboard |

---

## 5. Soft-Delete Data Model

### 5.1 Core Types

```typescript
/** A single comment on a web page element. */
interface BrowserComment {
  /** UUID v4 */
  id: string;
  /** Groups replies together. First comment's id === threadId. */
  threadId: string;
  /** ISO 8601 creation timestamp */
  createdAt: string;
  /** Comment author */
  author: {
    kind: "user";
    name: string;
  };
  /** Comment text (plain text, not Markdown in v1) */
  body: string;
  /** The anchor key identifying the DOM element */
  anchorKey: string;
  /** Page URL (origin + pathname, query stripped) */
  pageUrl: string;
  /** Status of this comment */
  status: "open" | "resolved";
  /** Resolution note (set when status → "resolved") */
  resolutionNote?: string;

  // ── Soft delete fields ──────────────────────────────────────
  /** ISO 8601 timestamp when soft-deleted. Undefined = not deleted. */
  deletedAt?: string;
  /** Who deleted it */
  deletedBy?: string;
}

/** A thread is a group of comments sharing the same threadId. */
interface BrowserCommentThread {
  id: string;
  anchorKey: string;
  pageUrl: string;
  status: "open" | "resolved";
  comments: BrowserComment[];
  createdAt: string;
  lastActivity: string;

  // ── Soft delete fields ──────────────────────────────────────
  /** If set, the entire thread is soft-deleted */
  deletedAt?: string;
  deletedBy?: string;
}

/** Per-URL storage record */
interface PageCommentStore {
  version: "1.0";
  url: string;
  threads: BrowserCommentThread[];
}

/** Per-URL screenshot record (stored separately, key: "screenshot:{normalizedUrl}") */
interface ScreenshotRecord {
  /** Base64-encoded JPEG data URL */
  dataUrl: string;
  /** Unix timestamp (ms) when captured */
  capturedAt: number;
  /** Viewport width at capture time */
  width: number;
  /** Viewport height at capture time */
  height: number;
}
```

### 5.2 Soft Delete Semantics

| Operation | What Happens | Data Impact |
|---|---|---|
| User "deletes" a comment | `comment.deletedAt` = `new Date().toISOString()` | Comment remains in storage; hidden from UI |
| User "deletes" a thread | `thread.deletedAt` = `new Date().toISOString()` | Thread + all comments remain; hidden from UI |
| Normal UI rendering | Filters: `thread.deletedAt === undefined` | Soft-deleted threads invisible |
| Normal export (clipboard) | Filters: `thread.deletedAt === undefined` | Soft-deleted excluded |
| Full export (audit) | No filter | All data including soft-deleted |
| Storage query | Always returns all records; caller filters | Single source of truth |

**Store-layer filtering:** Soft-delete filtering is enforced at the **store layer** (M80-STORE), not the UI. `getActiveThreads(url)` never returns threads where `deletedAt` is set, and filters out comments where `deletedAt` is set within active threads. The UI (M80-CS-PINS, M80-CS-INPUT, M80-POP) receives pre-filtered data and does not need to check `deletedAt`. The `getAllThreads(url)` method (for audit export) is the only code path that returns soft-deleted records.

### 5.3 Storage Layout in `chrome.storage.local`

```
Key: "comments:{normalizedUrl}"
Value: PageCommentStore (JSON)

Key: "screenshot:{normalizedUrl}"
Value: ScreenshotRecord  (one per URL, overwritten on each capture)

Key: "settings"
Value: { commentsMode: boolean, userName: string, ... }
```

URL normalization: `new URL(url)` → `origin + pathname` (no search, no hash).

---

## 6. MCP API Stub Specification

### 6.1 Types

```typescript
// ── MCP Tool Request/Response ────────────────────────────────────

/** Standard MCP tool call shape */
interface McpToolRequest<T = Record<string, unknown>> {
  tool: string;
  args: T;
  requestId: string;
}

/** Standard MCP tool response shape */
interface McpToolResponse<T = unknown> {
  requestId: string;
  success: boolean;
  data?: T;
  error?: string;
}

// ── get_screenshot ────────────────────────────────────────────────

interface GetScreenshotArgs {
  /** Page URL to get screenshot for. If omitted, uses active tab. */
  url?: string;
}

interface GetScreenshotResult {
  /** Base64-encoded JPEG data URL */
  dataUrl: string;
  /** Unix timestamp (ms) when captured */
  capturedAt: number;
  /** URL of the page */
  pageUrl: string;
  /** Viewport dimensions at capture time */
  viewport: {
    width: number;
    height: number;
  };
}

// ── get_comments ──────────────────────────────────────────────────

interface GetCommentsArgs {
  /** Page URL. Required. */
  url: string;
  /** Filter by status */
  status?: "open" | "resolved" | "all";
  /** Include soft-deleted */
  includeDeleted?: boolean;
}

interface GetCommentsResult {
  url: string;
  threads: BrowserCommentThread[];
  totalThreads: number;
  openThreads: number;
}
```

### 6.2 Handler Contract

```typescript
// mcp/mcp-handlers.ts

/**
 * MCP handler functions. Fully implemented in v1 — read real data from
 * chrome.storage.local. What is "stubbed" is only the transport: no external
 * agent can call these yet (the WebSocket relay does not exist in v1).
 *
 * In v2, a relay-client.ts module will forward incoming WebSocket messages
 * to these same handler functions — no logic changes required.
 */

/** Handle get_screenshot tool call */
async function handleGetScreenshot(
  request: McpToolRequest<GetScreenshotArgs>
): Promise<McpToolResponse<GetScreenshotResult>> {
  // v1: Read ScreenshotRecord from chrome.storage.local for the requested URL.
  //     If found → { success: true, data: { dataUrl, capturedAt, pageUrl, viewport } }
  //     If not found → { success: false, error: "no-screenshot-available" }
  // v2: Same logic — relay just exposes this handler over WebSocket.
}

/** Handle get_comments tool call */
async function handleGetComments(
  request: McpToolRequest<GetCommentsArgs>
): Promise<McpToolResponse<GetCommentsResult>> {
  // v1: Read PageCommentStore from chrome.storage.local for the requested URL.
  //     Apply status + includeDeleted filters.
  //     If found → { success: true, data: { url, threads, totalThreads, openThreads } }
  //     If not found → { success: false, error: "no-comments-found" }
  // v2: Same logic — relay just exposes this handler over WebSocket.
}
```

### 6.3 Future Relay Integration Path

```
v2 architecture (NOT built in v1):

Chrome Extension                     accordo-browser VSCode ext
     │                                         │
     │ ← WebSocket ─────────────────────────── │
     │   ws://localhost:3001/browser             │
     │                                          │
     │  MCP stub handlers                       │  BridgeAPI
     │  (mcp-stubs.ts)                          │  .registerTools()
     │     ↓                                    │     ↓
     │  Forward tool calls ───────────────────► │  Route to Hub
     │  via WebSocket                           │  via existing Bridge
     │                                          │
     │  Receive responses ◄──────────────────── │  Hub MCP response
     │  via WebSocket                           │

The MCP handler module has a clear integration seam:
1. mcp-handlers.ts exports handler functions with typed signatures
2. v1: handlers are called via service worker message router (mcp: namespace)
3. v2 adds a WebSocket client module (relay-client.ts)
4. relay-client.ts receives tool calls from the WebSocket and routes to the same handlers
5. Handler logic is unchanged — they already read real data from storage
6. Relay forwards responses back to accordo-browser VSCode ext → Bridge → Hub

No type changes required. No handler logic changes. Only a transport module is added.
```

---

## 7. Export Layer Abstraction

### 7.1 Exporter Interface

```typescript
/** Payload prepared for export */
interface ExportPayload {
  url: string;
  exportedAt: string;
  threads: BrowserCommentThread[];
  /** If screenshot was captured during this export */
  screenshot?: ScreenshotRecord;
}

/** Abstract exporter interface — clipboard is v1, others are additive */
interface Exporter {
  readonly name: string;
  export(payload: ExportPayload): Promise<ExportResult>;
}

interface ExportResult {
  success: boolean;
  error?: string;
  /** Human-readable description of what happened */
  summary: string;
}
```

### 7.2 ClipboardExporter (v1)

```typescript
class ClipboardExporter implements Exporter {
  readonly name = "clipboard";

  async export(payload: ExportPayload): Promise<ExportResult> {
    // Format as Markdown:
    // # Comments on {url}
    // Exported: {date}
    //
    // ## Thread: {anchorKey}
    // - **{author}** ({time}): {body}
    // - **{author}** ({time}): {body}
    // Status: {open|resolved}
    //
    // ---
    // Screenshot available via MCP get_screenshot tool

    const markdown = formatAsMarkdown(payload);
    await navigator.clipboard.writeText(markdown);
    return {
      success: true,
      summary: `Copied ${payload.threads.length} threads to clipboard`
    };
  }
}
```

### 7.3 Future Exporters (Not Built in v1)

| Exporter | When | Description |
|---|---|---|
| `McpExporter` | v2 | Sends payload via WebSocket relay → Hub → agent reads it |
| `FileExporter` | v2+ | Downloads as `.json` file via `chrome.downloads` API |
| `GithubIssueExporter` | Future | Creates a GitHub issue with comment content |

Adding a new exporter requires:
1. Implement `Exporter` interface
2. Register in the export registry (array in `export.ts`)
3. Add a button in the popup UI

No changes to comment storage, content script, or service worker.

---

## 8. Module List

### M80-TYP — Shared Types

**File:** `src/types/comment-types.ts`  
**Responsibility:** All TypeScript types for comments, threads, storage, export, and MCP stubs. No runtime code.  
**Estimated LOC:** ~120  
**Dependencies:** None  

### M80-SM — Comments Mode State Machine

**File:** `src/background/comments-mode.ts`  
**Responsibility:** Manages the OFF ↔ ON state for Comments Mode. Creates/removes context menu items. Updates extension icon badge and title. Handles keyboard shortcut and toolbar toggle.  
**Estimated LOC:** ~100  
**Dependencies:** Chrome APIs (`chrome.contextMenus`, `chrome.action`, `chrome.commands`)  

### M80-STORE — Comment Storage Manager

**File:** `src/background/comment-store.ts`  
**Responsibility:** CRUD operations on comments and threads in `chrome.storage.local`. Enforces soft-delete semantics. URL normalization. Provides filtered queries (active threads, all threads including deleted).  
**Estimated LOC:** ~180  
**Dependencies:** Chrome APIs (`chrome.storage.local`), M80-TYP  

### M80-SW — Background Service Worker

**File:** `src/background/service-worker.ts`  
**Responsibility:** Entry point for the background context. Wires together Comments Mode, storage, context menu handlers, screenshot capture, message routing between content scripts and popup. Handles `chrome.runtime.onInstalled` for first-run setup.  
**Estimated LOC:** ~150  
**Dependencies:** M80-SM, M80-STORE, M80-SCREEN, M80-MCP, Chrome APIs  

### M80-CS-PINS — Content Script: Pin Rendering & Positioning

**File:** `src/content/pin-renderer.ts`  
**Responsibility:** Injects pin markers into the DOM adjacent to anchored elements. Positions pins using element bounding rects. Repositions on scroll/resize via `requestAnimationFrame`. Monitors DOM mutations via `MutationObserver` to refresh pins on SPA navigation. Detects off-screen pins and reports count to service worker for badge update. Removes all pins when Comments Mode transitions to OFF.  
**Estimated LOC:** ~130  
**Dependencies:** M80-TYP, M80-STORE, M80-SM, M80-CSS, Chrome APIs (`chrome.runtime`)  

### M80-CS-INPUT — Content Script: Comment Input & Popovers

**File:** `src/content/comment-input.ts`  
**Responsibility:** Shows inline comment input form when context menu "Add Comment" is triggered. Renders thread popover on pin click (all non-deleted comments, reply field, resolve/reopen button, per-comment delete button). Generates `anchorKey` from right-clicked element. Sends `create-comment`, `reply-comment`, `resolve-thread`, `reopen-thread`, `delete-comment` messages to service worker. Communicates with M80-CS-PINS to trigger pin creation/update after mutations.  
**Estimated LOC:** ~150  
**Dependencies:** M80-TYP, M80-STORE, M80-SM, M80-CS-PINS, M80-CSS, Chrome APIs (`chrome.runtime`)  

### M80-CSS — Content Script Styles

**File:** `src/content/content-styles.css`  
**Responsibility:** All CSS for pins, popovers, input forms, and the overlay container. Uses browser-native styling with `prefers-color-scheme` for light/dark. No `--vscode-*` variables.  
**Estimated LOC:** ~200 (CSS)  
**Dependencies:** None  

### M80-EXPORT — Export Layer

**File:** `src/content/export.ts`  
**Responsibility:** `Exporter` interface, `ClipboardExporter` implementation, Markdown/JSON formatters, export payload builder. Called from popup UI.  
**Estimated LOC:** ~120  
**Dependencies:** M80-TYP  

### M80-SCREEN — Screenshot Capture

**File:** `src/background/screenshot.ts`  
**Responsibility:** Captures visible tab screenshot via `chrome.tabs.captureVisibleTab()`. Stores in `chrome.storage.local` keyed by normalized URL. Retrieves stored screenshots for MCP stub.  
**Estimated LOC:** ~60  
**Dependencies:** Chrome APIs (`chrome.tabs`), M80-TYP  

### M80-MCP — MCP Handler Layer

**File:** `src/mcp/mcp-types.ts` + `src/mcp/mcp-handlers.ts`  
**Responsibility:** TypeScript type definitions for `get_screenshot` and `get_comments` MCP tools. Fully implemented handler functions that read real data from `chrome.storage.local` — screenshots via M80-SCREEN, comments via M80-STORE. Returns data in the `McpToolResponse` shape. What is stubbed is only the transport: no external agent can invoke these handlers in v1. Clear integration seam for v2 relay (add `relay-client.ts`, wire to same handlers).  
**Estimated LOC:** ~100 (types: ~60, handlers: ~40)  
**Dependencies:** M80-TYP, M80-STORE, M80-SCREEN  

### M80-POP — Popup UI

**File:** `src/popup/popup.html` + `src/popup/popup.ts`  
**Responsibility:** Extension action popup. Shows comment list for the current page. Export buttons (Markdown to clipboard, JSON to clipboard). Comments Mode toggle. Off-screen comment count. Settings (user name, future relay config).  
**Estimated LOC:** ~180 (HTML: ~50, TS: ~130)  
**Dependencies:** M80-TYP, M80-EXPORT, Chrome APIs  

### M80-MANIFEST — Chrome Manifest & Build

**File:** `manifest.json` + `esbuild.config.ts`  
**Responsibility:** Manifest V3 declaration (permissions, content scripts, service worker, commands). Build configuration for esbuild (3 entry points: service-worker, content-script, popup).  
**Estimated LOC:** ~60 (manifest: ~40, build: ~20)  
**Dependencies:** None  

---

## 9. Module Dependency Graph

```
M80-TYP (types — no runtime)
    ▲
    │
    ├───────────────────┬──────────────────┬─────────────────┐
    │                   │                  │                 │
M80-STORE          M80-EXPORT        M80-SCREEN         M80-MCP
(storage)          (clipboard)       (screenshot)        (handlers)
    ▲                   ▲                  ▲                 │
    │                   │                  │          ┌──────┘
    │                   │                  │          │
    ├───────────────────┼──────────────────┼──────────┘
    │                   │                  │
M80-SM              M80-POP           M80-SW
(state machine)     (popup UI)        (service worker)
    ▲                                      │
    │                                      │
    └──────────────────────────────────────┘
                       │
                  M80-CS-PINS
                (pin rendering)
                       │
                  M80-CS-INPUT
              (input forms + popovers)
                       │
                    M80-CSS
                  (styles)
                       │
                 M80-MANIFEST
               (manifest + build)
```

---

## 10. LOC Summary

| Module | ID | Est. LOC | Type |
|---|---|---|---|
| Shared Types | M80-TYP | ~120 | TypeScript |
| Comments Mode State Machine | M80-SM | ~100 | TypeScript |
| Comment Storage Manager | M80-STORE | ~180 | TypeScript |
| Background Service Worker | M80-SW | ~150 | TypeScript |
| Content Script: Pin Rendering | M80-CS-PINS | ~130 | TypeScript |
| Content Script: Input & Popovers | M80-CS-INPUT | ~150 | TypeScript |
| Content Styles | M80-CSS | ~200 | CSS |
| Export Layer | M80-EXPORT | ~120 | TypeScript |
| Screenshot Capture | M80-SCREEN | ~60 | TypeScript |
| MCP Handler Layer | M80-MCP | ~100 | TypeScript |
| Popup UI | M80-POP | ~180 | TypeScript + HTML |
| Manifest & Build | M80-MANIFEST | ~60 | JSON + Config |
| **Total** | | **~1,550** | |

---

## 11. What Is Explicitly OUT OF SCOPE for v1

| Item | Reason for Deferral | When |
|---|---|---|
| WebSocket relay to VS Code | Requires `accordo-browser` VSCode extension (new package) | v2 |
| `accordo-bridge` changes | No Bridge integration in v1 | v2 |
| Full parity for all browser mutations (agent-driven create-thread UX parity) | Deferred in v1; delivered in Session 13 v2a via relay + SDK convergence | v2a |
| CSS selector re-anchoring across page reloads | Complex; requires full selector generator (old M67-CSS) | v2 |
| Cross-device sync | `chrome.storage.local` is per-profile | v2+ |
| `@accordo/comment-sdk` integration | Deferred from v1; delivered in Session 13 v2a via SDK adapter in content script | v2a |
| Firefox extension | Chrome-only for v1 | Future |
| Chrome Web Store publication | Side-load only in v1 | Post-v1 |
| Multi-workspace Chrome switcher | No VS Code connection in v1 | v2 |
| Agent-initiated comments (push to Chrome) | Deferred in v1; delivered in v2a for create/reply/resolve/reopen/delete through browser relay tools | v2a |
| Floating scroll-to arrows for off-screen comments | Badge only in v1 | v2 |
| Rich text / Markdown in comments | Plain text in v1 | v2 |
| Comment notifications | No push channel in v1 | v2 |

---

## 12. How This Fits Into Existing Accordo Architecture

### v1 Baseline Snapshot (Historical)

| Existing Package | Impact in v1 |
|---|---|
| `accordo-hub` | **No change.** Hub is unaware of browser extension. |
| `accordo-bridge` | **No change.** No relay, no tool registration. |
| `accordo-editor` | **No change.** No new tools. |
| `accordo-comments` | **No change.** No `getSurfaceAdapter` calls. |
| `@accordo/comment-sdk` | **No change.** Not imported by browser extension. |
| `@accordo/bridge-types` | **No change.** No new types added to shared package. |

### v2 Integration Path (Historical Plan)

```
v2 plan added:
1. packages/browser/ (accordo-browser VSCode extension)
   - WebSocket relay server (BrowserRelay)
   - BrowserCommentsBridge → CommentStore via getSurfaceAdapter
   - BrowserStateContribution → Hub via publishState
   - CssSelectorCoordinates type added to bridge-types

2. packages/browser-extension/ (updated)
   - relay-client.ts (WebSocket client to accordo-browser)
   - MCP handlers already work (forward to relay for external agent access)
   - CSS selector generator for cross-reload anchoring
   - Full two-way comment sync with CommentStore
```

The v1 extension was designed so that v2 integration would be **additive** — no breaking changes, no type renames, no storage format migration.

### 12.0 Current v2a Impact on Existing Packages

| Existing Package | Current Impact in v2a |
|---|---|
| `accordo-hub` | No protocol changes; browser tools now appear through existing bridge registration flow. |
| `accordo-bridge` | No protocol changes; new provider package registers tools via existing `registerTools`. |
| `accordo-editor` | No direct code changes required. |
| `accordo-comments` | No direct code changes required. |
| `@accordo/comment-sdk` | Imported by browser-extension for converged interaction behavior. |
| `@accordo/bridge-types` | Reused as-is for tool definitions; no new wire schema required for v2a slice. |

### 12.1 Session 13 (v2a) — Detailed Wiring Plan

Session 13 delivers two outcomes together:

1. **SDK convergence inside browser-extension** (single interaction engine)
2. **Accordo connectivity** (agent can list/get/create/reply/resolve/reopen/delete browser comments)

#### 12.1.1 Target runtime topology

```
Agent (MCP) -> accordo-hub -> accordo-bridge -> accordo-browser (new VS Code ext)
                                                |
                                                | local WS (token-auth)
                                                v
                                       browser-extension (Chrome MV3)
                                                |
                                                v
                                      chrome.storage.local + SDK UI
```

#### 12.1.2 New package: `packages/browser/` (`accordo-browser`)

- Runs inside VS Code extension host.
- Opens local WebSocket relay endpoint for Chrome extension.
- Authenticates extension client via shared token.
- Registers Bridge tools (which become Hub MCP tools):
  - `accordo_browser_getAllComments`
  - `accordo_browser_getComments`
  - `accordo_browser_createComment`
  - `accordo_browser_replyComment`
  - `accordo_browser_resolveThread`
  - `accordo_browser_reopenThread`
  - `accordo_browser_deleteComment`
  - `accordo_browser_deleteThread`
- Routes each tool call to extension over relay with correlation ID and timeout.

#### 12.1.3 Browser-extension updates (v2a)

- Add relay client module in service-worker context.
- Keep storage and existing read handlers; add/confirm mutation action handlers for reply/delete.
- Keep service-worker as the single mutation authority for storage.
- Ensure content script uses SDK callbacks for create/reply/resolve/reopen/delete (no parallel custom action path).
- Service-worker broadcasts `COMMENTS_UPDATED` to tabs so content script/popup refresh without manual page reload after agent mutations.

#### 12.1.4 Stable contracts

1. **Relay request envelope**
   - `{ requestId, action, payload }`
2. **Relay response envelope**
   - `{ requestId, success, data?, error? }`
3. **Action set (v2a)**
   - `get_all_comments`
   - `get_comments`
   - `create_comment`
   - `reply_comment`
   - `resolve_thread`
   - `reopen_thread`
   - `delete_comment`
   - `delete_thread`

#### 12.1.5 Failure model

- Browser not connected -> tool returns typed error (`browser-not-connected`).
- Auth mismatch -> relay rejects socket (`unauthorized`).
- Request timeout -> tool returns `timeout` with request ID.
- Extension storage mutation failure -> error propagated as `action-failed` with context.

#### 12.1.6 Security constraints

- Relay binds to localhost only.
- Token is configuration-driven (dev default token supported for local workflows) and should be persisted in VS Code secure storage/settings scope in hardened deployments; never log token values.
- No cross-origin browser content data is pushed automatically; only explicit tool invocations fetch/mutate comments.

#### 12.1.7 Why this is additive

- No migration of comment schema in `chrome.storage.local`.
- Existing extension read handlers stay valid.
- Hub/Bridge core protocol remains unchanged; browser functionality is introduced as another extension tool provider.

### 12.2 Session 14 (v2b) — Unified Comments Contract

Session 14 migrates browser comments from a browser-specific public tool family to the shared comments modality contract.

1. **Unified public MCP tools**
   - Browser operations are invoked via `accordo_comment_*` with `scope.modality = "browser"`.
   - `accordo_browser_*` tools remain temporary compatibility aliases only during migration.

2. **Panel unification**
   - Browser threads are projected into the same comments panel dataset used by text/diagram/slide/preview.
   - Navigation remains surface-aware via `surfaceType = "browser"`.

3. **Volatile browser retention + cleanup UX**
   - Browser threads carry retention metadata (`volatile-browser`) because anchors drift faster on live pages.
   - Comments Panel adds `Delete All Browser Comments` action with confirmation and deleted-count feedback.

4. **Architecture outcome**
   - One comment system and one public tool model across modalities.
   - Browser relay remains transport/adaptation infrastructure, not a separate comments API surface.

---

## 13. Risk Register

| Risk | Severity | Mitigation |
|---|---|---|
| `chrome.storage.local` quota (10MB) exceeded by screenshots | Medium | JPEG quality at 0.7; store only latest screenshot per URL; warn at 8MB and auto-purge oldest |
| Content script CSS conflicts with host page styles | Medium | All CSS classes prefixed with `accordo-`; use `all: initial` on root container; high z-index (2147483646) |
| Context menu "Add Comment" conflicts with other extensions | Low | Chrome handles menu item ordering; our item is namespaced under extension name |
| Service worker terminated by Chrome (MV3 lifecycle) | High | All state in `chrome.storage.local` (not in worker memory); worker re-initializes from storage on wake |
| Anchor keys invalid after DOM mutation (SPA navigation) | High | v1 anchors are session-scoped; document this limitation; MutationObserver refreshes pins on DOM change |
| Screenshot capture requires `activeTab` permission | Low | Already declared in manifest; user grants on install |
| Export to clipboard blocked by browser focus requirements | Low | `navigator.clipboard.writeText` requires document focus; popup has focus when export button is clicked |

---

## 14. Assumptions

1. **Chrome 120+** — Manifest V3 service worker, `chrome.storage.local`, `chrome.contextMenus`, `chrome.tabs.captureVisibleTab` are all stable.
2. **Single user per browser profile** — No multi-user conflict resolution needed.
3. **Pages are HTTP/HTTPS** — `chrome://`, `file://`, and extension pages are excluded from content script injection.
4. **English UI only** in v1 — Internationalization deferred.
5. **No content security policy conflicts** — The content script injects CSS and DOM elements. Pages with strict CSP may block injected styles. Mitigation: use `style` attribute on elements (inline) rather than injected `<style>` tags where possible.

---

## 15. Open Questions for PM

1. **User name default:** Should the extension prompt for a user name on first install, or default to "User"? (Affects M80-POP, M80-TYP)
2. **Export format preference:** Should the default clipboard format be Markdown or JSON? (Affects M80-EXPORT)
3. **Screenshot quality/size:** JPEG at quality 0.7 produces ~200KB per screenshot. Is this acceptable, or should we cap at a lower quality? (Affects M80-SCREEN)
4. **Keyboard shortcut conflict:** `Alt+Shift+C` may conflict with some systems (e.g. Linux window management). Should we use `Ctrl+Shift+A` or a chord (`Ctrl+Shift+A, C`)? The current manifest uses `Alt+Shift+C`. (Affects M80-SM)
5. **Comment character limit:** Should we cap comment body length? Suggested: 2000 chars. (Affects M80-STORE, M80-TYP)

---

## 16. Testability Notes

Mapping non-functional requirements to test strategies:

| NFR | Test Type | Approach |
|---|---|---|
| BR-NF-01: Toggle latency < 100ms | Integration test + manual benchmark | Fake timers in Vitest to assert message round-trip completes within threshold; manual `performance.now()` measurement in real Chrome |
| BR-NF-02: Pin repositioning via rAF | Unit test | Assert `requestAnimationFrame` is called (mock); assert no synchronous layout reads interleaved with writes |
| BR-NF-04: Export < 500ms for 100 threads | Unit test | Generate 100 mock threads; time `ClipboardExporter.export()`; assert < 500ms |
| BR-NF-05: Worker cold-start < 200ms | Integration test | Mock `chrome.storage.local` with realistic data; time initialization |
| BR-NF-10: Storage quota < 10MB | Unit test | Mock `chrome.storage.local.getBytesInUse`; verify warning triggered at 8MB; verify auto-purge |
| BR-NF-11/12: Screenshot one-per-URL | Unit test | Capture twice for same URL; assert only one `ScreenshotRecord` in storage |
| BR-NF-31: CSS isolation | Manual visual test | Load extension on Wikipedia, GitHub, Gmail; verify no visual interference |
| BR-NF-40: Worker termination resilience | Unit test | Simulate worker restart (fresh import); verify state re-initialized from storage |
| BR-NF-41: MutationObserver pin refresh | Unit test | Mutate mock DOM; assert pin refresh callback invoked |
