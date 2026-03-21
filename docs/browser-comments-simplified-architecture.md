# Accordo Browser Comments — Simplified Architecture v2.0

**Status:** PROPOSED — awaiting approval  
**Date:** 2026-03-19  
**Scope:** Standalone Chrome extension for ephemeral browser-surface commenting  
**Supersedes:** `browser-architecture.md` v1.0, `requirements-browser.md` — Session 12 plan is fully replaced

---

## 0. What This IS and IS NOT

### What it IS

A **standalone Chrome Manifest V3 extension** that lets a user place ephemeral comment annotations on any web page. When the user presses a keyboard shortcut, all comments are bundled with page context into a formatted text block and copied to the clipboard — ready to paste into any AI chat (Claude, ChatGPT, Copilot Chat, etc.).

### What it IS NOT

- **Not connected to VS Code.** No WebSocket relay, no `accordo-browser` VSCode extension, no Bridge, no Hub.
- **Not persistent.** Comments vanish on page refresh. No `chrome.storage`, no `.accordo/comments.json`.
- **Not an MCP tool provider.** No tool registration, no agent automation.
- **Not a DOM anchoring system.** No CSS selector paths, no text fingerprints, no `MutationObserver` re-tagging.
- **Not multi-page.** Comments exist only on the page where they were created in the current session.

### Why the simplification

The original Session 12 plan required 14 modules across 2 packages, a WebSocket relay, CSS selector anchoring, text fingerprinting, MutationObserver integration, and coordination with the Accordo `CommentStore`. That is architecturally interesting but overkill for the actual user need: **"I'm looking at a web page, I want to annotate it, and I want to send those annotations to an AI."**

The user's exact words: *"We don't need to make it persistent. So if the state changes... it's not so important because we are not going to keep them."*

---

## 1. Requirements

### 1.1 Functional Requirements

| ID | Requirement | Priority |
|---|---|---|
| FR-01 | User can create a comment on any web page by right-clicking an element and selecting "Accordo: Add Comment" from the context menu | Must |
| FR-02 | A floating textarea appears near the right-clicked element; user types comment and presses Enter/Cmd+Enter or clicks Submit | Must |
| FR-03 | After submission, a numbered pin appears at the element's position showing the comment exists | Must |
| FR-04 | User can click a pin to see the comment body in a popover | Must |
| FR-05 | Popover allows editing the comment body (replace text, resubmit) | Should |
| FR-06 | Popover allows deleting the comment | Must |
| FR-07 | Pressing `Ctrl+Shift+A` (Windows/Linux) or `Cmd+Shift+A` (macOS) bundles all comments with page context and copies to clipboard | Must |
| FR-08 | After clipboard copy, a brief toast notification confirms "N comments copied to clipboard" | Must |
| FR-09 | The export includes: page URL, page title, timestamp, and for each comment: the comment body and the context of the element it was placed on | Must |
| FR-10 | The "element context" in the export includes: the element's tag name, its visible text (first 120 chars), and its nearest heading ancestor (if any) | Must |
| FR-11 | Comments survive in-page navigation (SPA route changes) but NOT hard refreshes | Should |
| FR-12 | User can clear all comments on the current page via the extension popup "Clear All" button | Must |
| FR-13 | Pins reposition correctly when the page is scrolled or resized | Must |
| FR-14 | The overlay does not interfere with normal page interaction (clicking links, filling forms, scrolling) | Must |
| FR-15 | Extension popup shows: comment count on current tab, keyboard shortcut reminder, "Clear All" button | Must |
| FR-16 | The context menu item only appears when right-clicking on content elements (not on the extension's own UI) | Should |

### 1.2 Non-Functional Requirements

| ID | Requirement |
|---|---|
| NFR-01 | Chrome Manifest V3 compliant |
| NFR-02 | Zero external dependencies — everything bundled |
| NFR-03 | TypeScript, built with esbuild |
| NFR-04 | Tests in vitest with jsdom |
| NFR-05 | Extension bundle < 100KB (no heavy dependencies) |
| NFR-06 | Content script adds < 2ms to page load time (no DOM walk, no MutationObserver) |
| NFR-07 | CSS isolated via Shadow DOM on the overlay container |
| NFR-08 | No network requests from the extension (no telemetry, no external services) |
| NFR-09 | Comment text rendered via `textContent` only (no `innerHTML`, no XSS vector) |
| NFR-10 | Works on any `http://` or `https://` page (not `chrome://` or `chrome-extension://`) |
| NFR-11 | Permissions: `activeTab`, `contextMenus`, `clipboardWrite` — minimum viable |
| NFR-12 | All public TypeScript exports have explicit return types |

---

## 2. Design Decisions

### DD-01: Comment Anchoring — Element Reference via WeakRef (No DOM Tagger)

**Decision:** Comments are anchored to DOM elements via a `WeakRef<Element>` stored in the in-memory comment map. No `data-block-id` attributes. No CSS selectors. No DOM tagger.

**Rationale:**
- Comments are ephemeral — they don't need to survive page reload, so stable anchoring identifiers are unnecessary.
- The original plan's DOM tagger (M66-TAG) assigned `data-block-id` to ~30 element types, ran a `MutationObserver`, and debounced re-tagging — all infrastructure for persistence we don't need.
- `WeakRef<Element>` gives us a direct reference to the exact element the user right-clicked. If the element is removed from the DOM (SPA re-render), the `WeakRef` dereferences to `undefined` and the pin is hidden — correct ephemeral behaviour.
- For pin positioning, we call `element.getBoundingClientRect()` on the live element. No coordinate mapping, no `coordinateToScreen` callback needed.

**Consequence:** The existing `@accordo/comment-sdk` cannot be directly reused for pin management because it requires `data-block-id` attributes and a `coordinateToScreen` callback. We will build a simpler pin manager. However, we reuse the SDK's **CSS styling** (sdk.css) and **popover DOM structure patterns** as a design reference.

### DD-02: Comment Trigger — Context Menu (Not Alt+Click)

**Decision:** Create comments via Chrome's right-click context menu: "Accordo: Add Comment".

**Rationale:**
- Alt+click (the SDK's approach) conflicts with browser behaviours on many platforms (macOS: downloads link, Linux: window drag in some DEs, Windows: often captured by accessibility tools).
- Context menu is the standard Chrome extension interaction pattern — users expect extensions to add context menu items.
- No DOM tagging required — the context menu handler receives the target element directly via `info.targetElementId` (Manifest V3) or we can capture `document.activeElement` / the right-click target from the content script.
- The context menu item is registered in the service worker via `chrome.contextMenus.create()`.

**Alternative considered:** A floating action button (FAB) that appears on text selection. Rejected because it would interfere with page UX and many pages already have their own selection toolbars.

### DD-03: Export Destination — Clipboard (Formatted Markdown)

**Decision:** The keyboard shortcut copies all comments as formatted markdown to the clipboard. No VS Code connection, no Hub relay, no API calls.

**Rationale:**
- The user said "submitted" — in a standalone Chrome extension with no server connection, clipboard is the most universal "submit" target.
- Formatted markdown pastes cleanly into every major AI chat (Claude, ChatGPT, Copilot Chat, Gemini, Cursor, Windsurf).
- Zero configuration — no port, no token, no connection status to manage.
- Future enhancement: add an option to POST to a configurable endpoint (e.g., Accordo Hub) but that is explicitly NOT v1.

### DD-04: CSS Isolation — Shadow DOM

**Decision:** The overlay container uses Shadow DOM for CSS isolation from the host page.

**Rationale:**
- The original plan proposed `browser-theme.css` to remap `--vscode-*` variables. This works for variable-based styling but doesn't protect against host page CSS that might globally style `div`, `button`, `textarea`, `p`, etc.
- Shadow DOM provides true CSS isolation with zero risk of host page style leakage.
- We define all styles inside the Shadow DOM — the comment SDK's `--vscode-*` variable approach is replaced with direct CSS values (light/dark based on `prefers-color-scheme`).
- Performance: Shadow DOM has negligible overhead for a single overlay element.

### DD-05: Export Format — Structured Markdown

**Decision:** The export format is designed for AI consumption — structured, human-readable markdown with clear context.

**Format:**

```markdown
# Browser Comments — [Page Title]

**URL:** https://example.com/api/v2/docs
**Captured:** 2026-03-19 14:30:22
**Comments:** 3

---

## Comment 1
**On:** `<h2>` — "Authentication"
**Section:** (top-level heading)
> This API docs page shows the deprecated v1 endpoint — we need to update our client to use the /v2/auth route instead.

---

## Comment 2
**On:** `<p>` — "Rate limits are enforced at 100 requests per minute per API key..."
**Section:** under "Rate Limits"
> The rate limit is 100 req/min but our client assumes 1000 — this is a bug in our integration layer.

---

## Comment 3
**On:** `<div>` — "Error Handling"
**Section:** under "Error Handling"
> This entire section about retry logic is missing from our implementation. We need to add exponential backoff.
```

**Why this format:**
- `## Comment N` gives structure an AI can parse and reference back ("regarding Comment 2...")
- `**On:** \`<tag>\` — "text"` tells the AI exactly what DOM element the comment was placed on
- `**Section:**` gives hierarchical context (nearest ancestor heading) so the AI understands where on the page this comment lives
- The blockquote `>` clearly separates the user's annotation from the page context
- URL and title at the top let the AI know what page is being discussed

### DD-06: Reuse Strategy for `@accordo/comment-sdk`

**Decision:** We do NOT import the SDK as a dependency. We reuse its **design patterns and CSS aesthetics** but build a simpler pin/popover system inside the Chrome extension.

**What we reuse:**
- Pin visual design: 22px circle, state colors (blue/green), badge, hover scale
- Popover structure: header, body, actions bar, close button
- CSS class naming: `accordo-pin`, `accordo-popover`, `accordo-btn`
- Interaction patterns: click pin → popover, click outside → close, Cmd+Enter → submit

**What we DON'T reuse:**
- The `AccordoCommentSDK` class (requires `data-block-id`, `coordinateToScreen`, `SdkCallbacks`)
- The `SdkThread`/`SdkComment` types (oriented around threaded replies and persistence)
- The `postMessage` protocol (designed for VS Code webview ↔ extension host)
- Alt+click trigger (replaced by context menu)

**Rationale:** The SDK's abstraction layer (block IDs, coordinate callbacks, host message protocol) exists to support multiple heterogeneous surfaces (markdown preview, Slidev, diagrams). The browser extension is a single surface with direct DOM access. Wrapping DOM elements in a `data-block-id` layer only to immediately look them up again adds complexity without value. A 150-line pin manager that directly holds `WeakRef<Element>` is cleaner than adapting a system designed for mediated access.

### DD-07: No Threading — Single Comments Only

**Decision:** Each comment is a single annotation, not a thread. No replies, no resolve/reopen state machine.

**Rationale:**
- Comments are ephemeral and clipboard-exported. There is no "conversation" happening on the page — the user annotates, exports, and the comments disappear.
- The `accordo-comments` thread model (`open → resolved → open`, reply chains, `lastActivity` tracking) is designed for persistent collaborative review. None of that applies here.
- Simpler data model: `{ id, element, body, elementContext, createdAt }`.

---

## 3. Architecture

### 3.1 System Overview

```
┌─────────────────────────────────────────────────┐
│  Chrome Extension (Manifest V3)                  │
│                                                  │
│  ┌────────────────────────────────────────────┐  │
│  │  Background Service Worker                  │  │
│  │  • Context menu registration                │  │
│  │  • Keyboard shortcut handler (Cmd+Shift+A)  │  │
│  │  • Message routing between popup ↔ content  │  │
│  └──────────┬─────────────────────────────────┘  │
│             │ chrome.runtime messages             │
│  ┌──────────┴─────────────────────────────────┐  │
│  │  Content Script (per tab)                   │  │
│  │  • Comment store (in-memory Map)            │  │
│  │  • Shadow DOM overlay                       │  │
│  │  • Pin manager (create, position, remove)   │  │
│  │  • Popover manager (view, edit, delete)     │  │
│  │  • Context capture (element → export data)  │  │
│  │  • Export formatter (→ clipboard markdown)   │  │
│  └────────────────────────────────────────────┘  │
│                                                  │
│  ┌────────────────────────────────────────────┐  │
│  │  Popup (extension action)                   │  │
│  │  • Comment count display                    │  │
│  │  • Keyboard shortcut reminder               │  │
│  │  • "Clear All" button                       │  │
│  └────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
             │
    ┌────────┴────────┐
    │  Any Web Page    │
    │  (real Chrome)   │
    └─────────────────┘
```

### 3.2 Data Model (In-Memory)

```typescript
/** A single ephemeral comment on a page element. */
interface BrowserComment {
  id: string;                          // crypto.randomUUID()
  elementRef: WeakRef<Element>;        // direct reference to the DOM element
  body: string;                        // the user's annotation text
  elementContext: ElementContext;       // captured at creation time for export
  createdAt: number;                   // Date.now()
}

/** Captured context about the DOM element, frozen at comment creation time. */
interface ElementContext {
  tagName: string;                     // "P", "H2", "DIV", etc.
  textPreview: string;                 // element.textContent.trim().slice(0, 120)
  nearestHeading: string | null;       // text of the nearest ancestor/preceding h1-h6
  rect: DOMRect;                       // initial position (updated on scroll/resize)
}
```

**Storage:** A `Map<string, BrowserComment>` living in the content script's module scope. Dies with the page. No `chrome.storage`, no serialization.

### 3.3 Component Responsibilities

#### Service Worker (`background/service-worker.ts`)

| Responsibility | Detail |
|---|---|
| Register context menu | `chrome.contextMenus.create({ id: "accordo-add-comment", title: "Accordo: Add Comment", contexts: ["all"] })` |
| Handle context menu click | Forward `chrome.contextMenus.onClicked` → `chrome.tabs.sendMessage(tabId, { type: "create-comment" })` |
| Handle keyboard shortcut | `chrome.commands.onCommand` for `"export-comments"` → `chrome.tabs.sendMessage(tabId, { type: "export-comments" })` |
| Relay popup ↔ content | Popup asks for comment count → SW queries active tab's content script |
| Badge management | Update extension icon badge with comment count for active tab |

#### Content Script (`content/content-script.ts`)

| Responsibility | Detail |
|---|---|
| Comment store | `Map<string, BrowserComment>` — add, update, delete, getAll |
| Overlay creation | Shadow DOM container at `z-index: 2147483646`, `pointer-events: none` |
| Pin rendering | Create/position/remove pin elements inside Shadow DOM |
| Popover rendering | Show comment body, edit textarea, delete button |
| Scroll/resize | `requestAnimationFrame`-throttled repositioning of all pins |
| Context capture | On comment creation: extract tag, text, nearest heading from target element |
| Export | On `"export-comments"` message: format all comments as markdown → `navigator.clipboard.writeText()` |
| Toast | Brief notification overlay showing "N comments copied to clipboard" |

#### Popup (`popup/popup.html` + `popup/popup.ts`)

| Responsibility | Detail |
|---|---|
| Status display | Comment count for current tab |
| Shortcut reminder | "Cmd+Shift+A to export comments" |
| Clear All | Button → sends `{ type: "clear-all" }` to content script |

### 3.4 Message Protocol (Internal)

All messages flow via `chrome.runtime.sendMessage` / `chrome.tabs.sendMessage`.

**Service Worker → Content Script:**

| Type | Payload | Trigger |
|---|---|---|
| `create-comment` | `{}` | Context menu "Add Comment" clicked |
| `export-comments` | `{}` | Keyboard shortcut pressed |
| `clear-all` | `{}` | Popup "Clear All" clicked |
| `get-count` | `{}` | Popup opened, requests comment count |

**Content Script → Service Worker:**

| Type | Payload | Trigger |
|---|---|---|
| `count-update` | `{ count: number }` | After any comment add/delete, on `get-count` request |
| `export-done` | `{ count: number }` | After clipboard write completes |

### 3.5 User Interaction Flow

#### Creating a Comment

```
1. User right-clicks on a paragraph on https://example.com/docs
2. Chrome shows context menu with "Accordo: Add Comment"
3. User clicks it
4. Service worker sends { type: "create-comment" } to content script
5. Content script:
   a. Identifies the right-clicked element (stored from last contextmenu event)
   b. Captures element context: tag "P", text "Rate limits are enforced...", heading "Rate Limits"
   c. Shows floating textarea near the element (inside Shadow DOM overlay)
6. User types: "Bug — our client assumes 1000 req/min"
7. User presses Cmd+Enter or clicks Submit
8. Content script:
   a. Creates BrowserComment { id, elementRef: WeakRef(element), body, elementContext, createdAt }
   b. Stores in Map
   c. Renders pin at element position (getBoundingClientRect → top-right of element)
   d. Sends count-update to service worker → badge updates to "1"
```

#### Viewing/Editing a Comment

```
1. User clicks a pin
2. Content script opens popover (inside Shadow DOM):
   - Shows comment body
   - "Edit" button → switches body to editable textarea
   - "Delete" button → removes comment, closes popover
3. User edits text, presses Cmd+Enter → body updated in Map
4. Click outside popover → closes it
```

#### Exporting Comments

```
1. User presses Cmd+Shift+A
2. Chrome fires chrome.commands.onCommand("export-comments")
3. Service worker sends { type: "export-comments" } to active tab's content script
4. Content script:
   a. Iterates all comments in Map
   b. For each: checks WeakRef — if element is gone, marks as "[element removed]"
   c. Builds markdown string (see DD-05 format)
   d. Calls navigator.clipboard.writeText(markdown)
   e. Shows toast: "3 comments copied to clipboard"
   f. Sends { type: "export-done", count: 3 } to service worker
```

### 3.6 Permissions

```json
{
  "permissions": [
    "activeTab",
    "contextMenus",
    "clipboardWrite"
  ]
}
```

| Permission | Why |
|---|---|
| `activeTab` | Access the active tab's content to inject pins and read element context |
| `contextMenus` | Register the "Add Comment" context menu item |
| `clipboardWrite` | Write the exported markdown to clipboard |

**NOT requested:**
- `storage` — no persistence needed
- `scripting` — content script is declared in manifest, not injected dynamically
- `<all_urls>` host permission — `activeTab` is sufficient (activated on user gesture)
- `tabs` — not needed; we use `chrome.tabs.sendMessage` which works with `activeTab`

### 3.7 Shadow DOM Structure

```html
<!-- Injected by content script at document_idle -->
<div id="accordo-browser-comments" style="position:fixed; inset:0; z-index:2147483646; pointer-events:none;">
  #shadow-root (open)
    <style>
      /* All comment CSS lives here — fully isolated from host page */
      .accordo-pin { ... }
      .accordo-popover { ... }
      .accordo-toast { ... }
      .accordo-input-form { ... }
    </style>
    <!-- Pins rendered here -->
    <div class="accordo-pin" style="left:350px; top:200px; pointer-events:all;">
      <span class="accordo-pin__badge">1</span>
    </div>
    <!-- Popover rendered here (when open) -->
    <!-- Toast rendered here (when showing) -->
    <!-- Input form rendered here (when creating) -->
</div>
```

**Why open Shadow DOM:** We need to read `getBoundingClientRect()` on host page elements to position pins, but the Shadow DOM only encloses our overlay UI. The `open` mode is fine since we have no security secrets in the shadow tree — it's purely for CSS isolation.

---

## 4. Module Breakdown

### 4.1 File Structure

```
packages/browser-extension/
├── src/
│   ├── background/
│   │   └── service-worker.ts        — context menu, shortcut handler, badge
│   ├── content/
│   │   ├── content-script.ts        — entry point, wires everything together
│   │   ├── comment-store.ts         — Map<id, BrowserComment>, CRUD
│   │   ├── overlay.ts               — Shadow DOM container creation
│   │   ├── pin-manager.ts           — pin creation, positioning, scroll handler
│   │   ├── popover.ts               — view/edit/delete popover
│   │   ├── input-form.ts            — floating textarea for new comments
│   │   ├── context-capture.ts       — extract ElementContext from DOM element
│   │   ├── export-formatter.ts      — BrowserComment[] → markdown string
│   │   ├── toast.ts                 — brief notification overlay
│   │   └── styles.ts                — CSS string (embedded in Shadow DOM <style>)
│   ├── popup/
│   │   ├── popup.html               — minimal popup UI
│   │   └── popup.ts                 — popup logic
│   ├── types.ts                     — BrowserComment, ElementContext, Message types
│   └── manifest.json                — Manifest V3
├── __tests__/
│   ├── comment-store.test.ts
│   ├── context-capture.test.ts
│   ├── export-formatter.test.ts
│   ├── pin-manager.test.ts
│   ├── popover.test.ts
│   ├── input-form.test.ts
│   ├── overlay.test.ts
│   └── toast.test.ts
├── esbuild.config.ts
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

### 4.2 Module Details

| # | Module | File | Purpose | Estimated Lines | Estimated Tests |
|---|---|---|---|---|---|
| M80-TYP | Types | `types.ts` | `BrowserComment`, `ElementContext`, message union types | ~40 | 0 (types only) |
| M80-STR | Comment Store | `comment-store.ts` | `Map<string, BrowserComment>` CRUD, getAll, clear, count | ~50 | 8–10 |
| M80-CTX | Context Capture | `context-capture.ts` | Extract tag, text preview, nearest heading from Element | ~60 | 10–12 |
| M80-FMT | Export Formatter | `export-formatter.ts` | `BrowserComment[]` + page metadata → markdown string | ~70 | 8–10 |
| M80-OVL | Overlay | `overlay.ts` | Create Shadow DOM container, inject styles | ~40 | 4–5 |
| M80-PIN | Pin Manager | `pin-manager.ts` | Create/position/reposition/remove pins in Shadow DOM | ~100 | 10–12 |
| M80-POP | Popover | `popover.ts` | View comment, edit body, delete, close-on-outside-click | ~120 | 10–12 |
| M80-INP | Input Form | `input-form.ts` | Floating textarea for new comment creation, submit/cancel | ~80 | 6–8 |
| M80-TST | Toast | `toast.ts` | Brief notification, auto-dismiss after 2s | ~30 | 3–4 |
| M80-CSS | Styles | `styles.ts` | CSS string constant for Shadow DOM injection | ~150 | 0 (visual) |
| M80-CS | Content Script | `content-script.ts` | Entry point: create overlay, wire messages, handle scroll | ~100 | 6–8 |
| M80-SW | Service Worker | `service-worker.ts` | Context menu, shortcut handler, badge, message routing | ~70 | 6–8 |
| M80-PUP | Popup | `popup.ts` + `popup.html` | Comment count, shortcut hint, clear all | ~40 | 3–4 |

**Totals:** ~950 lines of implementation, ~70–90 tests

### 4.3 Module Dependency Graph

```
types.ts (no deps)
    ▲
    │
    ├── comment-store.ts (types)
    │       ▲
    │       ├── content-script.ts (store, overlay, pin-manager, popover, input-form, context-capture, export-formatter, toast)
    │       │
    ├── context-capture.ts (types)
    │
    ├── export-formatter.ts (types)
    │
    ├── overlay.ts (styles)
    │       ▲
    │       │
    ├── pin-manager.ts (types, overlay)
    │
    ├── popover.ts (types, overlay)
    │
    ├── input-form.ts (types, overlay)
    │
    ├── toast.ts (overlay)
    │
    └── styles.ts (no deps — pure CSS string)

service-worker.ts (no content deps — uses chrome.* APIs only)
popup.ts (no content deps — uses chrome.runtime.sendMessage)
```

---

## 5. Detailed Module Specifications

### M80-TYP — Types

**File:** `src/types.ts`

```typescript
/** A single ephemeral comment on a page element. */
export interface BrowserComment {
  readonly id: string;
  readonly elementRef: WeakRef<Element>;
  body: string;
  readonly elementContext: ElementContext;
  readonly createdAt: number;
}

/** Captured context about the DOM element. */
export interface ElementContext {
  readonly tagName: string;
  readonly textPreview: string;          // first 120 chars of textContent
  readonly nearestHeading: string | null;
}

/** Page-level metadata for export. */
export interface PageContext {
  readonly url: string;
  readonly title: string;
  readonly capturedAt: string;           // ISO 8601
}

/** Internal messages between service worker, content script, and popup. */
export type ContentMessage =
  | { type: "create-comment" }
  | { type: "export-comments" }
  | { type: "clear-all" }
  | { type: "get-count" };

export type BackgroundMessage =
  | { type: "count-update"; count: number }
  | { type: "export-done"; count: number };
```

---

### M80-STR — Comment Store

**File:** `src/content/comment-store.ts`

| Req ID | Requirement |
|---|---|
| M80-STR-01 | `add(comment: BrowserComment): void` — stores comment in Map by ID |
| M80-STR-02 | `get(id: string): BrowserComment \| undefined` — retrieves by ID |
| M80-STR-03 | `update(id: string, body: string): boolean` — updates body, returns false if not found |
| M80-STR-04 | `remove(id: string): boolean` — deletes comment, returns false if not found |
| M80-STR-05 | `getAll(): BrowserComment[]` — returns all comments (array, insertion order) |
| M80-STR-06 | `clear(): void` — removes all comments |
| M80-STR-07 | `count(): number` — returns current comment count |
| M80-STR-08 | `getLive(): BrowserComment[]` — returns only comments whose `elementRef.deref()` is not undefined (element still in DOM) |

---

### M80-CTX — Context Capture

**File:** `src/content/context-capture.ts`

| Req ID | Requirement |
|---|---|
| M80-CTX-01 | `captureElementContext(element: Element): ElementContext` — extracts tag name, text preview, nearest heading |
| M80-CTX-02 | `tagName` is `element.tagName` (uppercase, e.g. "P", "H2", "DIV") |
| M80-CTX-03 | `textPreview` is `element.textContent?.trim().slice(0, 120) ?? ""` |
| M80-CTX-04 | `nearestHeading` walks up the DOM tree from `element`, then searches preceding siblings, looking for the nearest `h1`–`h6`. Returns its `textContent?.trim()` or `null` if none found within 20 ancestor levels. |
| M80-CTX-05 | If the element itself is an `h1`–`h6`, `nearestHeading` is that element's own text |
| M80-CTX-06 | Pure function — no side effects, no DOM mutation |
| M80-CTX-07 | Handles elements with no `textContent` gracefully (empty string, not null/error) |

---

### M80-FMT — Export Formatter

**File:** `src/content/export-formatter.ts`

| Req ID | Requirement |
|---|---|
| M80-FMT-01 | `formatExport(comments: BrowserComment[], page: PageContext): string` — produces markdown string |
| M80-FMT-02 | Header contains: page title, URL, capture timestamp, comment count |
| M80-FMT-03 | Each comment rendered as `## Comment N` with element context and body |
| M80-FMT-04 | Element context shows: tag name in backtick code, text preview in quotes |
| M80-FMT-05 | Section context shows: `under "Heading Text"` when `nearestHeading` is present |
| M80-FMT-06 | Comment body rendered as blockquote (`> text`) |
| M80-FMT-07 | Comments with dead `WeakRef` (element removed) show `**On:** [element no longer on page]` |
| M80-FMT-08 | Comments ordered by creation time (oldest first) |
| M80-FMT-09 | Empty comments list produces a message: "No comments on this page." |
| M80-FMT-10 | Pure function — no side effects |
| M80-FMT-11 | Multi-line comment bodies are blockquoted line by line |

**Export format template:**
```
# Browser Comments — {title}

**URL:** {url}
**Captured:** {timestamp}
**Comments:** {count}

---

## Comment 1
**On:** `<{tag}>` — "{textPreview}"
**Section:** under "{nearestHeading}"
> {comment body}

---

## Comment 2
...
```

---

### M80-OVL — Overlay

**File:** `src/content/overlay.ts`

| Req ID | Requirement |
|---|---|
| M80-OVL-01 | `createOverlay(): { host: HTMLElement; shadow: ShadowRoot }` — creates and appends overlay to `document.body` |
| M80-OVL-02 | Host element: `id="accordo-browser-comments"`, `position:fixed`, `inset:0`, `z-index:2147483646`, `pointer-events:none` |
| M80-OVL-03 | Shadow root: `mode: "open"` |
| M80-OVL-04 | Injects `<style>` element with all comment CSS into shadow root |
| M80-OVL-05 | Returns existing overlay if `#accordo-browser-comments` already exists (idempotent) |
| M80-OVL-06 | `removeOverlay(): void` — removes the host element from DOM |

---

### M80-PIN — Pin Manager

**File:** `src/content/pin-manager.ts`

| Req ID | Requirement |
|---|---|
| M80-PIN-01 | `createPin(comment: BrowserComment, shadow: ShadowRoot): HTMLElement` — creates pin element inside shadow DOM |
| M80-PIN-02 | Pin positioned at `element.getBoundingClientRect()` — top-right corner of element, offset 8px right |
| M80-PIN-03 | Pin shows sequential number (1, 2, 3...) based on creation order |
| M80-PIN-04 | Pin has class `accordo-pin accordo-pin--open` and `pointer-events: all` |
| M80-PIN-05 | `repositionAllPins(comments: BrowserComment[], shadow: ShadowRoot): void` — recalculates all pin positions from live `getBoundingClientRect()` |
| M80-PIN-06 | Pins for comments with dead `WeakRef` are hidden (`display: none`) |
| M80-PIN-07 | `removePin(commentId: string, shadow: ShadowRoot): void` — removes pin element |
| M80-PIN-08 | `removeAllPins(shadow: ShadowRoot): void` — removes all pin elements |
| M80-PIN-09 | Scroll/resize handler: calls `repositionAllPins` via `requestAnimationFrame` (max 60fps) |
| M80-PIN-10 | Each pin has `data-comment-id` attribute for lookup |

---

### M80-POP — Popover

**File:** `src/content/popover.ts`

| Req ID | Requirement |
|---|---|
| M80-POP-01 | `showPopover(comment: BrowserComment, pinEl: HTMLElement, shadow: ShadowRoot, callbacks: PopoverCallbacks): void` — displays popover near pin |
| M80-POP-02 | Popover shows: comment body text, "Edit" button, "Delete" button, "Close" (×) button |
| M80-POP-03 | "Edit" switches body `<p>` to `<textarea>` pre-filled with current body; shows "Save" button |
| M80-POP-04 | "Save" (or Cmd+Enter in textarea) calls `callbacks.onEdit(comment.id, newBody)` and closes popover |
| M80-POP-05 | "Delete" calls `callbacks.onDelete(comment.id)` and closes popover |
| M80-POP-06 | Click outside popover → close (event listener on shadow root) |
| M80-POP-07 | Only one popover open at a time — showing a new one closes the previous |
| M80-POP-08 | `closePopover(shadow: ShadowRoot): void` — closes any open popover |
| M80-POP-09 | Popover is viewport-clamped (does not render off-screen) |
| M80-POP-10 | `PopoverCallbacks: { onEdit(id: string, body: string): void; onDelete(id: string): void }` |

---

### M80-INP — Input Form

**File:** `src/content/input-form.ts`

| Req ID | Requirement |
|---|---|
| M80-INP-01 | `showInputForm(position: { x: number; y: number }, shadow: ShadowRoot, onSubmit: (body: string) => void, onCancel: () => void): void` — displays floating textarea |
| M80-INP-02 | Textarea auto-focuses on creation |
| M80-INP-03 | Cmd+Enter (or Ctrl+Enter) submits the form |
| M80-INP-04 | "Add Comment" button submits the form |
| M80-INP-05 | "Cancel" button or Escape key dismisses the form |
| M80-INP-06 | Empty body submission is rejected (button disabled, Cmd+Enter no-ops) |
| M80-INP-07 | Only one input form open at a time — showing a new one closes the previous |
| M80-INP-08 | Form is viewport-clamped |
| M80-INP-09 | `closeInputForm(shadow: ShadowRoot): void` — closes any open input form |

---

### M80-TST — Toast

**File:** `src/content/toast.ts`

| Req ID | Requirement |
|---|---|
| M80-TST-01 | `showToast(message: string, shadow: ShadowRoot, durationMs?: number): void` — shows toast notification |
| M80-TST-02 | Default duration: 2000ms |
| M80-TST-03 | Toast appears at top-center of viewport |
| M80-TST-04 | Toast auto-dismisses after duration (fade-out animation) |
| M80-TST-05 | Only one toast at a time — showing a new one replaces the previous |

---

### M80-CSS — Styles

**File:** `src/content/styles.ts`

| Req ID | Requirement |
|---|---|
| M80-CSS-01 | Exports `const COMMENT_CSS: string` containing all CSS for Shadow DOM injection |
| M80-CSS-02 | Pin styles match `@accordo/comment-sdk` visual design: 22px circle, blue (#3794ff), white text, shadow, hover scale |
| M80-CSS-03 | Popover styles: dark background (#252526), rounded corners, shadow, max-width 320px |
| M80-CSS-04 | Button styles: primary (blue), secondary (gray), danger (red outline) |
| M80-CSS-05 | `@media (prefers-color-scheme: light)` provides light-theme overrides: white background, dark text |
| M80-CSS-06 | Toast styles: centered, semi-transparent dark background, white text, fade animation |
| M80-CSS-07 | Input form styles: consistent with popover (dark/light aware) |
| M80-CSS-08 | All styles use direct CSS values (no `--vscode-*` variables) |

---

### M80-CS — Content Script (Entry Point)

**File:** `src/content/content-script.ts`

| Req ID | Requirement |
|---|---|
| M80-CS-01 | On load: creates Shadow DOM overlay (M80-OVL) |
| M80-CS-02 | Stores last right-clicked element via `document.addEventListener("contextmenu", ...)` |
| M80-CS-03 | On `"create-comment"` message: captures context from stored element (M80-CTX), shows input form (M80-INP) |
| M80-CS-04 | On input form submit: creates `BrowserComment`, adds to store (M80-STR), creates pin (M80-PIN), sends `count-update` |
| M80-CS-05 | On pin click: shows popover (M80-POP) |
| M80-CS-06 | On popover edit: updates store and re-renders pin (body change only, no reposition) |
| M80-CS-07 | On popover delete: removes from store, removes pin, sends `count-update` |
| M80-CS-08 | On `"export-comments"` message: calls export formatter (M80-FMT), writes to clipboard, shows toast (M80-TST) |
| M80-CS-09 | On `"clear-all"` message: clears store, removes all pins, sends `count-update` |
| M80-CS-10 | On `"get-count"` message: responds with current `store.count()` |
| M80-CS-11 | Registers scroll/resize handlers that call `repositionAllPins` (M80-PIN) |
| M80-CS-12 | Does not initialize if `#accordo-browser-comments` already exists (idempotent injection guard) |

---

### M80-SW — Service Worker

**File:** `src/background/service-worker.ts`

| Req ID | Requirement |
|---|---|
| M80-SW-01 | Registers context menu item "Accordo: Add Comment" on install |
| M80-SW-02 | On context menu click: sends `{ type: "create-comment" }` to the active tab's content script |
| M80-SW-03 | Registers keyboard shortcut `export-comments` (declared in manifest `commands`) |
| M80-SW-04 | On shortcut: sends `{ type: "export-comments" }` to the active tab's content script |
| M80-SW-05 | On `count-update` message from content script: updates badge text on extension icon (`chrome.action.setBadgeText`) |
| M80-SW-06 | Badge text: shows count if > 0, empty string if 0 |
| M80-SW-07 | Badge background color: #3794ff (Accordo blue) |
| M80-SW-08 | On `get-count` from popup: forwards to active tab, relays response back |
| M80-SW-09 | On `clear-all` from popup: forwards to active tab's content script |

---

### M80-PUP — Popup

**File:** `src/popup/popup.ts` + `src/popup/popup.html`

| Req ID | Requirement |
|---|---|
| M80-PUP-01 | On open: queries comment count from active tab via service worker |
| M80-PUP-02 | Displays: "N comments on this page" (or "No comments yet") |
| M80-PUP-03 | Shows keyboard shortcut reminder: "⌘+Shift+A to export" (platform-aware) |
| M80-PUP-04 | "Clear All Comments" button → sends `{ type: "clear-all" }` via service worker |
| M80-PUP-05 | "Clear All" button disabled when count is 0 |
| M80-PUP-06 | Minimal styling, matches Accordo visual language (dark theme default, respects `prefers-color-scheme`) |

---

## 6. Manifest V3

```json
{
  "manifest_version": 3,
  "name": "Accordo Browser Comments",
  "version": "0.1.0",
  "description": "Place comment annotations on any web page, then export them for AI with one shortcut.",
  "permissions": [
    "activeTab",
    "contextMenus",
    "clipboardWrite"
  ],
  "background": {
    "service_worker": "service-worker.js",
    "type": "module"
  },
  "content_scripts": [
    {
      "matches": ["http://*/*", "https://*/*"],
      "js": ["content-script.js"],
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
  "commands": {
    "export-comments": {
      "suggested_key": {
        "default": "Ctrl+Shift+A",
        "mac": "Command+Shift+A"
      },
      "description": "Export all comments to clipboard"
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

## 7. What Changed vs the Original Plan

### Original Session 12 Plan (Eliminated)

| Original Component | Module Count | Status |
|---|---|---|
| `@accordo/bridge-types` additions (`CssSelectorCoordinates`, relay messages) | 1 (M60-BT) | **Eliminated** |
| `accordo-browser` VSCode extension (relay server, comments bridge, state contribution) | 4 (M61-M64, M65) | **Eliminated** |
| Chrome extension DOM tagger | 1 (M66-TAG) | **Eliminated** |
| Chrome CSS selector generator | 1 (M67-CSS) | **Eliminated** |
| Chrome text fingerprint | 1 (M68-FP) | **Eliminated** |
| Chrome service worker (WebSocket client) | 1 (M69-SW) | **Replaced** (simpler SW) |
| Chrome content script (SDK integration) | 1 (M70-CS) | **Replaced** (simpler CS) |
| Chrome popup | 1 (M71-POP) | **Replaced** (simpler popup) |
| Chrome theme CSS | 1 (M72-THM) | **Replaced** (Shadow DOM styles) |
| Automation documentation | 1 (M73-AUTO) | **Eliminated** |
| **Total original** | **14 modules across 2 packages** | |

### New Plan

| New Component | Module Count |
|---|---|
| Chrome extension (single package) | 13 modules (M80-TYP through M80-PUP) |
| **Total new** | **13 modules, 1 package** |

### Key Eliminations

| Eliminated | Why |
|---|---|
| `accordo-browser` VSCode extension | No VS Code connection needed. Comments go to clipboard, not CommentStore. |
| `BrowserRelay` WebSocket server | No relay needed. Chrome extension is self-contained. |
| `BrowserCommentsBridge` | No CommentStore integration. |
| `BrowserStateContribution` | No Hub state publishing. |
| `CssSelectorCoordinates` type | No persistent anchoring needed. WeakRef is sufficient for ephemeral. |
| CSS selector generator | No CSS selectors needed. Direct element references. |
| Text fingerprint (FNV-1a) | No fingerprinting needed. Elements are referenced directly. |
| DOM auto-tagger | No element tagging needed. Context menu targets the element directly. |
| MutationObserver integration | No re-tagging needed. Elements tracked by reference. |
| `@accordo/comment-sdk` dependency | SDK's abstraction layer (blockId, coordinateToScreen, postMessage) adds complexity without value for direct DOM access. |
| Playwright MCP documentation | Out of scope — this is a standalone annotation tool, not a browser automation bridge. |

### Complexity Comparison

| Metric | Original | New |
|---|---|---|
| Packages | 2 (`browser/`, `browser-extension/`) | 1 (`browser-extension/`) |
| Modules | 14 | 13 |
| Estimated implementation lines | ~2500 | ~950 |
| Estimated tests | ~150 | ~70–90 |
| External dependencies | `ws`, `@accordo/comment-sdk`, Chrome APIs | Chrome APIs only |
| VS Code integration | Full (BridgeAPI, publishState, getSurfaceAdapter) | None |
| Persistence | `.accordo/comments.json` via CommentStore | None (in-memory) |
| Anchoring complexity | CSS selector + FNV-1a fingerprint + MutationObserver | WeakRef<Element> |
| New bridge-types additions | 3 interfaces + 2 union types | None |
| Hub/Bridge changes | None (existing flows) | None (not connected) |

---

## 8. Risks and Mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| **Content Security Policy (CSP) blocks content script** | Medium | Manifest V3 content scripts are exempt from page CSP for script execution. However, inline styles in Shadow DOM may be restricted on some pages. Mitigation: if `<style>` injection fails, fall back to a `chrome.runtime.getURL("styles.css")` linked stylesheet (requires `web_accessible_resources`). Test on pages with strict CSP (GitHub, Google Docs). |
| **`WeakRef<Element>` deref returns undefined on SPA re-render** | Low | This is expected and correct behaviour — the pin hides. The export formatter already handles dead refs (M80-FMT-07). User loses comment anchoring if the SPA re-renders the target element, but the comment body text is preserved in the store. Acceptable for ephemeral use. |
| **`navigator.clipboard.writeText` requires page focus** | Medium | Chrome requires the page to be focused and the call to originate from a user gesture. The keyboard shortcut is a user gesture, so this should work. But if the focus is in the address bar or devtools, clipboard write may fail. Mitigation: wrap in try/catch, show error toast "Could not copy — click the page first". |
| **Context menu "target element" capture** | Low | Manifest V3's `chrome.contextMenus.onClicked` does not directly provide the right-clicked DOM element in the content script. The content script must listen for `"contextmenu"` DOM event and store the target, then use it when the `"create-comment"` message arrives. Race condition is unlikely (context menu click follows the contextmenu event synchronously). |
| **Shadow DOM `pointer-events` interaction** | Low | The overlay is `pointer-events: none` but pins/popovers are `pointer-events: all`. This pattern is well-tested in the existing `@accordo/comment-sdk` browser architecture. Edge case: pins over iframes won't receive clicks. Accept this limitation for v1. |
| **Keyboard shortcut conflict** | Low | `Cmd+Shift+A` may conflict with other extensions or browser defaults. Chrome allows users to rebind extension shortcuts at `chrome://extensions/shortcuts`. Document this in the popup. |
| **Content script injection on existing tabs** | Low | Manifest V3 content scripts declared in `content_scripts` only inject on NEW page loads after extension install. Existing open tabs won't have the content script until refreshed. This is standard Chrome behaviour and acceptable. |

---

## 9. Work Plan

### Phase 1: Foundation (types, store, utilities)

| Task | Module | Dependencies | Acceptance Criteria |
|---|---|---|---|
| Define types | M80-TYP | — | All interfaces compile, no runtime code |
| Comment store CRUD | M80-STR | M80-TYP | All 8 requirements pass tests |
| Context capture | M80-CTX | M80-TYP | Tag, text, heading extraction works in jsdom |
| Export formatter | M80-FMT | M80-TYP | Markdown output matches specified format exactly |

**Phase 1 gate:** All pure-logic modules tested. No DOM rendering yet.

### Phase 2: UI Components (overlay, pins, popover, input, toast)

| Task | Module | Dependencies | Acceptance Criteria |
|---|---|---|---|
| Shadow DOM overlay | M80-OVL | M80-CSS | Shadow root created, styles injected, idempotent |
| CSS styles | M80-CSS | — | All style constants defined, light/dark themes |
| Pin manager | M80-PIN | M80-TYP, M80-OVL | Pins created, positioned, repositioned on scroll, removed |
| Popover | M80-POP | M80-TYP, M80-OVL | View/edit/delete works, outside-click closes, viewport clamped |
| Input form | M80-INP | M80-OVL | Textarea, submit/cancel, Cmd+Enter, empty rejection |
| Toast | M80-TST | M80-OVL | Shows, auto-dismisses, replaces previous |

**Phase 2 gate:** All UI components render and function correctly in jsdom tests.

### Phase 3: Integration (content script, service worker, popup)

| Task | Module | Dependencies | Acceptance Criteria |
|---|---|---|---|
| Content script | M80-CS | All content modules | Full flow: context menu → input → store → pin → popover → export → clipboard |
| Service worker | M80-SW | — | Context menu registered, shortcut handled, badge updates |
| Popup | M80-PUP | — | Count display, shortcut hint, clear all |
| Manifest | — | — | Valid Manifest V3, all entries correct |
| Build config | — | — | esbuild produces 3 bundles (sw, content, popup), all < 100KB total |

**Phase 3 gate:** Extension loads in Chrome developer mode. End-to-end flow works manually. All tests green.

---

## 10. Open Questions for the User

### Q1: Should the export also capture a screenshot?

**Context:** Chrome extensions can capture the visible tab via `chrome.tabs.captureVisibleTab()` (requires `activeTab` permission, which we already request). This could be included as a base64 image or saved alongside the text export.

**Recommendation:** No for v1. Screenshots can't be pasted into most AI chat inputs alongside text. They'd need to be a separate file or a data URL, adding complexity. The text-based export with element context gives the AI enough to act on. **Add screenshot capture in v2 if users request it** — the permission is already granted.

### Q2: Should "export" have multiple destinations (clipboard, file, API)?

**Context:** The user said "submitted" — clipboard is the simplest universal target. But we could also offer: save to file (`.md`), or POST to a configurable URL (future: Accordo Hub endpoint).

**Recommendation:** Clipboard only for v1. Add a "Save to File" option in v2 (uses `chrome.downloads.download()`). API destination deferred to v3 when/if VS Code integration is desired.

### Q3: Should the right-click menu work on ALL elements or only "content" elements?

**Context:** The context menu currently fires on any right-click. The user could accidentally try to comment on a tiny decorative `<span>`, an invisible element, or the extension's own UI.

**Recommendation:** Allow all elements for v1 (the user intentionally right-clicked there). Skip only elements inside `#accordo-browser-comments` (our own overlay). The captured `ElementContext` will clearly show the user what they commented on. If the text preview is empty (decorative element), the export shows the tag name only — still useful.

### Q4: How should comment numbering work?

**Context:** Pins currently show sequential numbers (1, 2, 3...). If the user deletes comment #2, should the remaining comments renumber (1, 2) or keep their original numbers (1, 3)?

**Recommendation:** Renumber. Since comments are ephemeral and the numbers serve only as visual identifiers (they appear in the export as "Comment 1", "Comment 2"), renumbering after deletion keeps the export clean. The alternative (stable IDs) would create confusing gaps: "Comment 1, Comment 3" in the export with no explanation.

### Q5: Should there be a visual indicator showing which elements HAVE comments when scrolling?

**Context:** When a page is long and the user has placed comments above the fold, the pins may be off-screen. The user might forget they exist.

**Recommendation:** For v1, the extension badge (icon badge showing "3") is sufficient. For v2, consider a "comment minimap" or a scrollbar gutter indicator. Keeping v1 simple.

---

## 11. Assumptions

1. **Chrome-only.** No Firefox, Safari, or Edge-specific handling. (Edge uses Chromium and should work, but is not tested.)
2. **Single page per content script instance.** SPA route changes are tolerated (comments survive) but multi-tab coordination is out of scope.
3. **No i18n.** All strings are English.
4. **No accessibility.** ARIA attributes on pins/popovers deferred to v2.
5. **Developer mode only.** No Chrome Web Store submission for v1.
6. **The user pastes the clipboard content manually.** No direct integration with any AI chat API.
7. **`@accordo/comment-sdk` is NOT a build dependency.** We reference its design but the Chrome extension has zero imports from any Accordo package.

---

## 12. Alignment with Repository Conventions

| Convention | Compliance |
|---|---|
| TypeScript with `strict: true` | Yes — `tsconfig.json` with `strict: true` |
| Vitest with jsdom | Yes — `vitest.config.ts` with `environment: "jsdom"` |
| esbuild | Yes — `esbuild.config.ts` matching existing project patterns |
| Conventional commits | Yes — `feat(browser-ext): ...`, `test(browser-ext): ...` |
| TDD process (AGENTS.md §2.1) | Yes — Phases A→F, tests before implementation |
| File naming: kebab-case | Yes — `comment-store.ts`, `pin-manager.ts`, etc. |
| No `any` | Yes — `unknown` with narrowing where needed |
| Named exports only | Yes — no default exports |
| Coding guidelines §3 banned patterns | Clean — no `innerHTML`, no `as` casts without guards, no `any` |

---

Architect Signoff: NEEDS_REVISION

*(Awaiting user review of design decisions DD-01 through DD-07, export format (DD-05), and answers to open questions Q1–Q5 before approving for build.)*
