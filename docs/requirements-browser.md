# accordo-browser + Chrome Extension — Requirements Specification (Archived)

**Status:** ARCHIVED — superseded by `docs/requirements-browser-extension.md`  
**Packages:** `accordo-browser` (VSCode extension) + `packages/browser-extension` (Chrome Manifest V3)  
**Type:** VSCode extension + Chrome extension  
**Publisher:** `accordo`  
**Version:** 0.1.0  
**Date:** 2026-03-06

---

> Archive note: kept for historical reference. Use `docs/requirements-browser-extension.md` for current requirements and status.

---

## 1. Purpose

Accordo Browser enables spatial commenting on any web page, bridging the browser and VS Code through the Accordo comments infrastructure. A Chrome extension renders comment pins on live web pages using the `@accordo/comment-sdk`. A VS Code extension relays comment data between Chrome and the `CommentStore` via a local WebSocket. Browser automation is provided by an off-the-shelf MCP server (no Accordo code).

**Architecture reference:** [`docs/browser-architecture.md`](browser-architecture.md)

---

## 2. Extension Manifest Contracts

### 2.1 VSCode Extension (`accordo-browser`)

```json
{
  "name": "accordo-browser",
  "displayName": "Accordo Browser",
  "publisher": "accordo",
  "version": "0.1.0",
  "engines": { "vscode": "^1.100.0" },
  "extensionKind": ["workspace"],
  "activationEvents": ["onStartupFinished"],
  "extensionDependencies": [
    "accordo.accordo-bridge",
    "accordo.accordo-comments"
  ],
  "main": "./dist/extension.js",
  "contributes": {
    "configuration": {
      "title": "Accordo Browser",
      "properties": {
        "accordo.browser.relayPort": {
          "type": "number",
          "default": 3001,
          "description": "Port for the browser relay WebSocket server"
        },
        "accordo.browser.relayToken": {
          "type": "string",
          "description": "Authentication token for Chrome extension connections (auto-generated)"
        },
        "accordo.browser.enabled": {
          "type": "boolean",
          "default": true,
          "description": "Enable the browser comments relay"
        }
      }
    },
    "commands": [
      {
        "command": "accordo.browser.copyToken",
        "title": "Accordo: Copy Browser Token"
      },
      {
        "command": "accordo.browser.showConnections",
        "title": "Accordo: Show Browser Connections"
      }
    ]
  }
}
```

### 2.2 Chrome Extension (Manifest V3)

```json
{
  "manifest_version": 3,
  "name": "Accordo Comments",
  "version": "0.1.0",
  "description": "Spatial comments on any web page, connected to Accordo IDE",
  "permissions": ["activeTab", "storage", "scripting"],
  "host_permissions": ["<all_urls>"],
  "background": {
    "service_worker": "service-worker.js",
    "type": "module"
  },
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["content-script.js"],
      "css": ["sdk.css", "browser-theme.css"],
      "run_at": "document_idle"
    }
  ],
  "action": {
    "default_popup": "popup.html",
    "default_icon": {
      "16": "icons/icon-16.png",
      "48": "icons/icon-48.png",
      "128": "icons/icon-128.png"
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

## 3. Data Model Additions

### 3.1 CssSelectorCoordinates (bridge-types)

```typescript
export interface CssSelectorCoordinates {
  type: "css-selector";
  /** Minimal unique CSS selector path from document root */
  selector: string;
  /** FNV-1a hash of element textContent (first 100 chars) for drift detection */
  textFingerprint: string;
}
```

Added to the `SurfaceCoordinates` union in `@accordo/bridge-types`.

### 3.2 BlockId Encoding

Browser surface `blockId` format:
```
css:{selector}|fp:{fingerprint}
```

Example: `css:#main>article>p:nth-of-type(3)|fp:8a3f2b1c`

The separator `|fp:` is chosen because `|` is invalid in CSS selectors and `fp:` is a clear namespace.

### 3.3 Browser Relay Messages (bridge-types)

```typescript
/** Chrome → VSCode */
export type BrowserToRelayMessage =
  | { type: "browser:connect"; tabId: number; url: string; title: string }
  | { type: "browser:navigate"; tabId: number; url: string; title: string }
  | { type: "browser:disconnect"; tabId: number }
  | { type: "comment:create"; tabId: number; url: string; blockId: string; body: string; intent?: string }
  | { type: "comment:reply"; tabId: number; url: string; threadId: string; body: string }
  | { type: "comment:resolve"; tabId: number; url: string; threadId: string }
  | { type: "comment:reopen"; tabId: number; url: string; threadId: string }
  | { type: "comment:delete"; tabId: number; url: string; threadId: string; commentId?: string };

/** VSCode → Chrome */
export type RelayToBrowserMessage =
  | { type: "comments:load"; url: string; threads: SdkThread[] }
  | { type: "comments:add"; url: string; thread: SdkThread }
  | { type: "comments:update"; url: string; threadId: string; partial: Partial<SdkThread> }
  | { type: "comments:remove"; url: string; threadId: string }
  | { type: "comments:focus"; url: string; threadId: string }
  | { type: "browser:auth-ok" }
  | { type: "browser:auth-fail"; reason: string };

/** Union */
export type BrowserRelayMessage = BrowserToRelayMessage | RelayToBrowserMessage;
```

### 3.4 BrowserTabInfo (bridge-types)

```typescript
export interface BrowserTabInfo {
  tabId: number;
  url: string;
  title: string;
  commentCount: number;
}

export interface BrowserConnectionState {
  isConnected: boolean;
  connectedTabs: BrowserTabInfo[];
  activeTabUrl: string | null;
  activeTabTitle: string | null;
}
```

---

## 4. Module Specifications — VSCode Extension (`packages/browser/`)

### M60-BT — Bridge-Types Additions

**File:** `packages/bridge-types/src/index.ts`

| Requirement ID | Requirement |
|---|---|
| M60-BT-01 | `CssSelectorCoordinates` interface exported with fields `type: "css-selector"`, `selector: string`, `textFingerprint: string` |
| M60-BT-02 | `SurfaceCoordinates` union updated to include `CssSelectorCoordinates` |
| M60-BT-03 | `BrowserToRelayMessage` discriminated union exported with all Chrome→VSCode message types |
| M60-BT-04 | `RelayToBrowserMessage` discriminated union exported with all VSCode→Chrome message types |
| M60-BT-05 | `BrowserRelayMessage` union of both directions exported |
| M60-BT-06 | `BrowserTabInfo` and `BrowserConnectionState` interfaces exported |
| M60-BT-07 | No runtime code — types only |

---

### M61-REL — BrowserRelay

**File:** `src/browser-relay.ts`

**Purpose:** Local WebSocket server that accepts Chrome extension connections and routes messages between Chrome and the `BrowserCommentsBridge`.

| Requirement ID | Requirement |
|---|---|
| M61-REL-01 | Creates a WebSocket server bound to `127.0.0.1` on the configured port (default 3001) |
| M61-REL-02 | Authenticates connections via `x-accordo-browser-token` header on upgrade |
| M61-REL-03 | Rejects connections with invalid or missing token (close code 4001) |
| M61-REL-04 | Sends `browser:auth-ok` on successful connection |
| M61-REL-05 | Tracks connected clients by `tabId`; multiple tabs can connect simultaneously |
| M61-REL-06 | Parses incoming messages as JSON; validates `type` field against known message types |
| M61-REL-07 | Routes incoming `comment:*` and `browser:*` messages to registered message handler callback |
| M61-REL-08 | Provides `send(tabId, message)` to send a message to a specific Chrome tab |
| M61-REL-09 | Provides `broadcast(url, message)` to send a message to all tabs currently showing `url` |
| M61-REL-10 | Emits `onConnect(tabId, url, title)`, `onDisconnect(tabId)`, `onNavigate(tabId, url, title)` events |
| M61-REL-11 | Handles WebSocket errors gracefully (logs, does not crash extension) |
| M61-REL-12 | `dispose()` closes all connections and shuts down the server |
| M61-REL-13 | If the port is in use, logs an error and retries with port+1 up to 3 times |
| M61-REL-14 | Rate-limits incoming messages: 100 messages/second per connection |
| M61-REL-15 | Maximum message payload: 512KB; oversized messages are rejected |

---

### M62-CBR — BrowserCommentsBridge

**File:** `src/browser-comments-bridge.ts`

**Purpose:** Bridges comment messages between the Chrome extension (via BrowserRelay) and the `CommentStore` (via the generalized surface adapter). Follows the same pattern as `PresentationCommentsBridge` (slidev) and `PreviewBridge` (md-viewer).

| Requirement ID | Requirement |
|---|---|
| M62-CBR-01 | Obtains `SurfaceCommentAdapter` via `vscode.commands.executeCommand('accordo.comments.internal.getSurfaceAdapter')` |
| M62-CBR-02 | Handles `comment:create` → parses `blockId` → builds `CommentAnchorSurface` with `surfaceType: "browser"` and `CssSelectorCoordinates` → calls `adapter.createThread()` |
| M62-CBR-03 | Handles `comment:reply` → calls `adapter.reply({ threadId, body })` |
| M62-CBR-04 | Handles `comment:resolve` → calls `adapter.resolve({ threadId })` |
| M62-CBR-05 | Handles `comment:reopen` → calls `adapter.reopen({ threadId })` |
| M62-CBR-06 | Handles `comment:delete` → calls `adapter.delete({ threadId, commentId })` |
| M62-CBR-07 | Subscribes to `adapter.onChanged(uri)` → when URI matches a connected Chrome tab's URL, pushes `comments:load` with updated thread list |
| M62-CBR-08 | `toSdkThread(thread)` converts `CommentThread` to `SdkThread` format: extracts `blockId` from anchor coordinates, computes `hasUnread` from `lastActivity` timestamp |
| M62-CBR-09 | On `browser:connect` → pushes `comments:load` for the tab's URL (existing threads) |
| M62-CBR-10 | On `browser:navigate` → pushes `comments:load` for the new URL |
| M62-CBR-11 | Handles missing comments extension gracefully (no throw; comments disabled) |
| M62-CBR-12 | `encodeBlockId(coords: CssSelectorCoordinates)` → `"css:{selector}\|fp:{fingerprint}"` |
| M62-CBR-13 | `parseBlockId(blockId: string)` → `CssSelectorCoordinates \| null` |
| M62-CBR-14 | `dispose()` unsubscribes from adapter changes |

---

### M63-STATE — BrowserStateContribution

**File:** `src/browser-state.ts`

**Purpose:** Publishes browser connection state to the Hub so the agent knows which pages are open and where comments exist.

| Requirement ID | Requirement |
|---|---|
| M63-STATE-01 | Publishes state key `modalities["accordo-browser"]` via `bridge.publishState('accordo-browser', state)` |
| M63-STATE-02 | State includes `isConnected`, `connectedTabs`, `activeTabUrl`, `activeTabTitle` |
| M63-STATE-03 | Each tab entry includes `commentCount` (open threads for that URL) |
| M63-STATE-04 | Publishes on: tab connect, tab disconnect, tab navigate, comment thread create/resolve/delete |
| M63-STATE-05 | Publishes initial state on activation: `{ isConnected: false, connectedTabs: [], activeTabUrl: null, activeTabTitle: null }` |
| M63-STATE-06 | `dispose()` stops publishing |

---

### M64-SEL — Selector Utilities

**File:** `src/selector-utils.ts`

**Purpose:** Shared CSS selector and blockId encoding/decoding logic used by the bridge. Also published for Chrome extension consumption.

| Requirement ID | Requirement |
|---|---|
| M64-SEL-01 | `encodeBlockId(selector: string, fingerprint: string)` → `"css:{selector}\|fp:{fingerprint}"` |
| M64-SEL-02 | `parseBlockId(blockId: string)` → `{ selector: string; fingerprint: string } \| null` |
| M64-SEL-03 | `parseBlockId` returns `null` for malformed blockIds (no crash) |
| M64-SEL-04 | No runtime dependencies; pure functions only |
| M64-SEL-05 | Exported for use by both VSCode extension and Chrome extension (dual-build target) |

---

### M65-EXT — Extension Entry Point

**File:** `src/extension.ts`

| Requirement ID | Requirement |
|---|---|
| M65-EXT-01 | Activates Bridge dependency and acquires `BridgeAPI` exports |
| M65-EXT-02 | If Bridge unavailable, extension logs warning and deactivates cleanly |
| M65-EXT-03 | Generates relay token on first activation (UUID v4); stores in `accordo.browser.relayToken` setting |
| M65-EXT-04 | Creates `BrowserRelay` on configured port |
| M65-EXT-05 | Creates `BrowserCommentsBridge` wired to relay and comments surface adapter |
| M65-EXT-06 | Creates `BrowserStateContribution` wired to relay events and Bridge |
| M65-EXT-07 | Registers `accordo.browser.copyToken` command — copies relay token to clipboard |
| M65-EXT-08 | Registers `accordo.browser.showConnections` command — shows connected tabs in a quick pick |
| M65-EXT-09 | Shows relay port and token in status bar item |
| M65-EXT-10 | If comments extension unavailable, relay still starts but comment messages are ignored with a log warning |
| M65-EXT-11 | All disposables pushed to `context.subscriptions` |
| M65-EXT-12 | `deactivate()` exported (calls relay.dispose, bridge.dispose, state.dispose) |

---

## 5. Module Specifications — Chrome Extension (`packages/browser-extension/`)

### M66-TAG — DOM Auto-Tagger

**File:** `content/dom-tagger.ts`

**Purpose:** Walks the DOM and assigns `data-block-id` attributes to commentable elements.

| Requirement ID | Requirement |
|---|---|
| M66-TAG-01 | Tags elements matching: `[id]`, `[data-testid]`, `h1`–`h6`, `p`, `li`, `td`, `th`, `img`, `video`, `canvas`, `pre`, `code`, `form`, `input`, `button`, `select`, `textarea`, `section`, `article`, `main`, `aside`, `nav`, `header`, `footer` |
| M66-TAG-02 | Skips: `script`, `style`, `meta`, `link`, `noscript` elements |
| M66-TAG-03 | Skips: elements with `display: none` or `visibility: hidden` (computed style) |
| M66-TAG-04 | Skips: elements smaller than 10×10 pixels (bounding rect) |
| M66-TAG-05 | Skips: elements inside `#accordo-overlay` |
| M66-TAG-06 | Assigns `data-block-id` attribute with value `"css:{selector}\|fp:{fingerprint}"` |
| M66-TAG-07 | Does not overwrite existing `data-block-id` attributes (idempotent) |
| M66-TAG-08 | Runs on `document_idle` (initial page load) |
| M66-TAG-09 | Observes `document.body` with `MutationObserver({ childList: true, subtree: true })` |
| M66-TAG-10 | Debounces mutation-triggered re-tagging at 200ms |
| M66-TAG-11 | Re-tags only added/changed subtrees, not the full page |

---

### M67-CSS — CSS Selector Generator

**File:** `content/selector-generator.ts`

**Purpose:** Generates minimal, unique CSS selector paths for DOM elements.

| Requirement ID | Requirement |
|---|---|
| M67-CSS-01 | If element has a unique `id`, returns `#{id}` |
| M67-CSS-02 | If element has a unique `data-testid`, returns `[data-testid="{value}"]` |
| M67-CSS-03 | Otherwise builds a path using `tag:nth-of-type(n)` from element to nearest ancestor with unique `id` or `body` |
| M67-CSS-04 | Maximum selector depth: 5 levels |
| M67-CSS-05 | Validates uniqueness: `document.querySelectorAll(selector).length === 1` |
| M67-CSS-06 | If initial selector is not unique, extends path with additional ancestor levels |
| M67-CSS-07 | Returns `null` if unable to generate a unique selector within depth limits |
| M67-CSS-08 | Handles elements with special characters in IDs (escapes with `CSS.escape()`) |
| M67-CSS-09 | No runtime dependencies; pure DOM functions only |

---

### M68-FP — Text Fingerprint

**File:** `content/text-fingerprint.ts`

**Purpose:** Generates a short hash of an element's text content for drift detection.

| Requirement ID | Requirement |
|---|---|
| M68-FP-01 | Input: `element.textContent.trim().slice(0, 100)` |
| M68-FP-02 | Algorithm: FNV-1a 32-bit hash |
| M68-FP-03 | Output: 8-character lowercase hex string |
| M68-FP-04 | Deterministic: same input always produces same output |
| M68-FP-05 | Empty string input produces a valid hash (not null/undefined) |
| M68-FP-06 | No runtime dependencies; pure function |

---

### M69-SW — Background Service Worker

**File:** `background/service-worker.ts`

**Purpose:** Manages the WebSocket connection to the VSCode relay and routes messages between content scripts and the relay.

| Requirement ID | Requirement |
|---|---|
| M69-SW-01 | Connects to `ws://localhost:{port}/browser` with `x-accordo-browser-token` header on startup |
| M69-SW-02 | Port and token read from `chrome.storage.local` (defaults: port 3001, token empty) |
| M69-SW-03 | On successful connection, receives `browser:auth-ok`; sets internal `connected` state |
| M69-SW-04 | On auth failure (`browser:auth-fail` or close code 4001), sets `disconnected` state and does not auto-reconnect until settings change |
| M69-SW-05 | Reconnection on unexpected disconnect: exponential backoff 1s → 2s → 4s → 8s → 16s → 30s (cap) |
| M69-SW-06 | Routes `chrome.runtime.onMessage` from content scripts → WebSocket (adds `tabId` from sender) |
| M69-SW-07 | Routes incoming WebSocket messages → `chrome.tabs.sendMessage(tabId)` to the appropriate content script |
| M69-SW-08 | For `comments:load` messages (which carry `url` not `tabId`): sends to all tabs whose URL matches |
| M69-SW-09 | Tracks active tabs via `chrome.tabs.onUpdated` and `chrome.tabs.onRemoved` |
| M69-SW-10 | Sends `browser:connect` when a tab loads and the extension is active; sends `browser:disconnect` when tab closes |
| M69-SW-11 | Sends `browser:navigate` when a tab's URL changes |
| M69-SW-12 | Exposes connection status to popup via `chrome.runtime.onMessage` handler (responds to `status:get` with `{ connected, port, tabCount }`) |

---

### M70-CS — Content Script (SDK Integration)

**File:** `content/content-script.ts`

**Purpose:** Initializes the DOM auto-tagger, creates the comment overlay, and wires the Comment SDK to the background service worker.

| Requirement ID | Requirement |
|---|---|
| M70-CS-01 | Creates overlay div `#accordo-overlay` at `document_idle` (fixed position, full viewport, pointer-events: none, z-index: 2147483646) |
| M70-CS-02 | Runs DOM auto-tagger on the page |
| M70-CS-03 | Initializes `AccordoCommentSDK` with the overlay as container |
| M70-CS-04 | Provides `coordinateToScreen(blockId)` that parses CSS selector from blockId, calls `document.querySelector()`, returns `getBoundingClientRect()` position |
| M70-CS-05 | If text fingerprint mismatches (selector found but content changed), returns position with `stale: true` flag |
| M70-CS-06 | If selector returns no element, returns `null` (pin hidden) |
| M70-CS-07 | Wires SDK `callbacks.onCreate` → `chrome.runtime.sendMessage({ type: "comment:create", ... })` |
| M70-CS-08 | Wires SDK `callbacks.onReply` → `chrome.runtime.sendMessage({ type: "comment:reply", ... })` |
| M70-CS-09 | Wires SDK `callbacks.onResolve` → `chrome.runtime.sendMessage({ type: "comment:resolve", ... })` |
| M70-CS-10 | Wires SDK `callbacks.onReopen` → `chrome.runtime.sendMessage({ type: "comment:reopen", ... })` |
| M70-CS-11 | Wires SDK `callbacks.onDelete` → `chrome.runtime.sendMessage({ type: "comment:delete", ... })` |
| M70-CS-12 | Listens for `chrome.runtime.onMessage` from background: `comments:load` → `sdk.loadThreads()` |
| M70-CS-13 | Listens for `comments:add` → `sdk.addThread()` |
| M70-CS-14 | Listens for `comments:update` → `sdk.updateThread()` |
| M70-CS-15 | Listens for `comments:remove` → `sdk.removeThread()` |
| M70-CS-16 | Listens for `comments:focus` → `sdk.openPopover()` |
| M70-CS-17 | Registers scroll and resize listeners → repositions pins via `requestAnimationFrame` debounce (16ms) |
| M70-CS-18 | Does not initialize if `#accordo-overlay` already exists (prevents duplicate injection) |
| M70-CS-19 | Listens for `chrome.runtime.onMessage` with `{ type: "toggle" }` → shows/hides the overlay |

---

### M71-POP — Popup UI

**File:** `popup/popup.html` + `popup/popup.ts`

**Purpose:** Chrome extension action popup for configuration and status.

| Requirement ID | Requirement |
|---|---|
| M71-POP-01 | Shows connection status: green dot = connected, yellow = connecting, red = disconnected |
| M71-POP-02 | Shows relay port input (default: 3001); saved to `chrome.storage.local` on change |
| M71-POP-03 | Shows auth token input (password-masked); saved to `chrome.storage.local` on change |
| M71-POP-04 | Shows "Connect" / "Disconnect" button |
| M71-POP-05 | Shows count of active tabs with comments overlay |
| M71-POP-06 | Shows count of open comment threads on current tab |
| M71-POP-07 | Toggle switch: enable/disable comments overlay on current tab (sends `toggle` message to content script) |
| M71-POP-08 | Reconnects on settings change (port or token update triggers disconnect + reconnect) |

---

### M72-THM — Browser Theme CSS

**File:** `content/browser-theme.css`

**Purpose:** Provides CSS variable values that the Comment SDK expects (normally provided by VS Code).

| Requirement ID | Requirement |
|---|---|
| M72-THM-01 | Defines all `--vscode-*` CSS variables used by `sdk.css` with browser-appropriate values |
| M72-THM-02 | Supports light mode (default) and dark mode via `prefers-color-scheme: dark` media query |
| M72-THM-03 | Pin colors: open = blue, resolved = green, updated = orange (matching VS Code theme) |
| M72-THM-04 | Font: system-ui/sans-serif stack (not VS Code's monospace) |
| M72-THM-05 | Does not conflict with host page styles (all variables scoped under `#accordo-overlay`) |

---

## 6. Module Specifications — Browser Automation Setup

### M73-AUTO — Automation Documentation & Helper

**Purpose:** Document and optionally automate the setup of `@playwright/mcp` alongside Accordo Hub.

| Requirement ID | Requirement |
|---|---|
| M73-AUTO-01 | `docs/browser-automation-setup.md` documents: install command, `opencode.json` config, `.claude/mcp.json` config, available tools |
| M73-AUTO-02 | VSCode command `accordo.browser.setupPlaywright` auto-appends Playwright MCP config to `opencode.json` if not already present |
| M73-AUTO-03 | Does not modify any Accordo Hub or Bridge configuration |
| M73-AUTO-04 | Works with `@playwright/mcp@latest` as the recommended server |

---

## 7. Non-Functional Requirements

| Requirement ID | Requirement |
|---|---|
| M-NFR-01 | No `vscode` imports in Chrome extension code or `@accordo/bridge-types` |
| M-NFR-02 | No `chrome.*` imports in VSCode extension code |
| M-NFR-03 | Relay WebSocket binds to `127.0.0.1` only (no `0.0.0.0`) |
| M-NFR-04 | Content script does not read cookies, passwords, form values, or localStorage |
| M-NFR-05 | Comment body text rendered via `textContent` (never `innerHTML`) in Chrome context |
| M-NFR-06 | All messages validated against expected discriminated union shapes before processing |
| M-NFR-07 | Chrome extension bundle < 200KB (SDK + CSS + scripts) |
| M-NFR-08 | DOM auto-tagger adds < 5ms to page load on a typical page (< 500 elements) |
| M-NFR-09 | Pin repositioning runs at 60fps via `requestAnimationFrame` |
| M-NFR-10 | All public exports have explicit TypeScript return types |
| M-NFR-11 | Structured error returns from all tool/message handlers (no uncaught throws at boundary) |

---

## 8. Testing Requirements

| Requirement ID | Test Scope | Module |
|---|---|---|
| M-TST-01 | BrowserRelay: connection lifecycle (connect, auth, reject, disconnect) | M61-REL |
| M-TST-02 | BrowserRelay: multi-client routing, broadcast by URL | M61-REL |
| M-TST-03 | BrowserRelay: rate limiting and payload size rejection | M61-REL |
| M-TST-04 | BrowserCommentsBridge: blockId encoding/decoding roundtrip | M62-CBR |
| M-TST-05 | BrowserCommentsBridge: anchor construction from blockId | M62-CBR |
| M-TST-06 | BrowserCommentsBridge: comment:create → adapter.createThread flow | M62-CBR |
| M-TST-07 | BrowserCommentsBridge: adapter.onChanged → comments:load push to relay | M62-CBR |
| M-TST-08 | BrowserCommentsBridge: missing comments extension → graceful degradation | M62-CBR |
| M-TST-09 | BrowserStateContribution: state shape on connect/disconnect/navigate | M63-STATE |
| M-TST-10 | BrowserStateContribution: commentCount updates | M63-STATE |
| M-TST-11 | Selector utils: encode/decode roundtrip | M64-SEL |
| M-TST-12 | Selector utils: malformed input returns null | M64-SEL |
| M-TST-13 | DOM auto-tagger: correct elements tagged | M66-TAG |
| M-TST-14 | DOM auto-tagger: skipped elements not tagged | M66-TAG |
| M-TST-15 | DOM auto-tagger: mutation observer re-tags new elements | M66-TAG |
| M-TST-16 | DOM auto-tagger: does not overwrite existing blockIds | M66-TAG |
| M-TST-17 | CSS selector generator: prefers #id over path | M67-CSS |
| M-TST-18 | CSS selector generator: produces unique selectors | M67-CSS |
| M-TST-19 | CSS selector generator: respects depth limit | M67-CSS |
| M-TST-20 | CSS selector generator: handles special chars in IDs | M67-CSS |
| M-TST-21 | Text fingerprint: deterministic | M68-FP |
| M-TST-22 | Text fingerprint: empty input handled | M68-FP |
| M-TST-23 | Service worker: message routing content→relay | M69-SW |
| M-TST-24 | Service worker: message routing relay→content | M69-SW |
| M-TST-25 | Service worker: reconnection with backoff | M69-SW |
| M-TST-26 | Content script: SDK initialization and callback wiring | M70-CS |
| M-TST-27 | Content script: coordinateToScreen with valid/invalid/stale selectors | M70-CS |
| M-TST-28 | Extension entry: activation, token generation, wiring | M65-EXT |
| M-TST-29 | Integration: mock Chrome → relay → adapter → verify thread anchor shape | All |

---

## 9. Non-Requirements (explicitly out of scope)

- **No browser automation code** — `@playwright/mcp` is off-the-shelf; Accordo does not wrap or extend it
- **No Hub changes** — state arrives via existing `publishState` flow; comment CRUD via existing tools
- **No Bridge changes** — `BridgeAPI` is consumed as-is
- **No Comment SDK changes** — SDK is used directly; only CSS variables are remapped
- **No Firefox extension** — Chrome only for v0.1.0
- **No Chrome Web Store publication** — developer mode side-loading only for v0.1.0
- **No screenshot annotation** — spatial comments on live DOM only, not on screenshots
- **No cross-workspace Chrome connections** — one Chrome extension ↔ one VSCode workspace at a time

---

## 10. Affected Packages

| Package | Change | Modules |
|---|---|---|
| `packages/bridge-types/` | Updated — add `CssSelectorCoordinates`, relay messages, browser state types | M60-BT |
| `packages/browser/` | **New** — VSCode extension | M61-REL, M62-CBR, M63-STATE, M64-SEL, M65-EXT |
| `packages/browser-extension/` | **New** — Chrome Manifest V3 extension | M66-TAG, M67-CSS, M68-FP, M69-SW, M70-CS, M71-POP, M72-THM |
| `packages/hub/` | No change | — |
| `packages/bridge/` | No change | — |
| `packages/comments/` | No change | — |
| `packages/comment-sdk/` | No change | — |
