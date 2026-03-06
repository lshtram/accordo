# Accordo — Browser Agentation Architecture v1.0

**Status:** PROPOSED  
**Date:** 2026-03-06  
**Scope:** Phase 6 browser modality (`accordo-browser` + Chrome extension)

---

## 1. Goal

Enable **human and agent to co-browse the web** and hold persistent, spatial comment threads anchored to specific elements on any web page—visible to both parties, managed through the Accordo comments infrastructure, and surfaced in the agent's system prompt.

The modality consists of two independent capabilities:

1. **Browser automation** — the agent navigates, clicks, types, and screenshots in a real browser. Delivered by an **off-the-shelf MCP server** (no Accordo code).
2. **Browser comments** — the human and agent place spatial comment pins on web pages via a **Chrome Manifest V3 extension** that communicates with a **VSCode relay extension**. Comment data flows through the established `CommentStore` → `SurfaceCommentAdapter` → Hub state pipeline.

These two capabilities are architecturally independent. The automation layer has no dependency on the comments layer and vice versa. Together, they enable a new interaction pattern: agent browses → user comments on what they see → agent reads comments and acts → both iterate on the live page.

---

## 2. Design Decisions

### ADR-01: Off-the-Shelf Browser Automation

**Decision:** Use `@anthropic/mcp-server-puppeteer` or `@playwright/mcp` (Microsoft's official Playwright MCP server) as the browser automation tool provider. No Accordo-maintained browser automation code.

**Rationale:**
- Multiple high-quality, actively maintained MCP browser servers exist (Playwright MCP, Puppeteer MCP, Browserbase).
- The agent already connects to MCP servers through the standard `opencode.json` / `.claude/mcp.json` mechanism.
- Building our own would duplicate effort without differentiation.
- The Accordo differentiator is the **comments overlay** and **collaborative annotation**, not the automation itself.

**Recommended server:** `@playwright/mcp` — same ecosystem as VS Code (Microsoft), supports all major browsers, exposes `browser_navigate`, `browser_click`, `browser_screenshot`, `browser_type`, `browser_evaluate` and more.

**Installation:** `npx @playwright/mcp@latest` added to the agent's MCP server configuration alongside `accordo-hub`. Zero coupling to Accordo internals.

### ADR-02: Chrome Extension for Comments (Not a Webview)

**Decision:** Deliver browser comments as a **Chrome Manifest V3 extension**, not a VS Code webview wrapping a browser.

**Rationale:**
- A Chrome extension works on the **real browser** the user actually uses—existing tabs, logged-in sessions, cookies, extensions.
- VS Code webviews are sandboxed and cannot access arbitrary web pages with full browser capabilities.
- The `@accordo/comment-sdk` is already framework-free vanilla JS/DOM—it can run in any browser context without modification.
- Agents like Claude and Cursor already launch real browsers via Playwright; having comments appear on those same pages requires a real browser extension.

### ADR-03: Relay via VSCode Extension (Not Direct to Hub)

**Decision:** The Chrome extension connects to a **local WebSocket relay** running inside a new `accordo-browser` VSCode extension, which then bridges to `CommentStore` via the existing `getSurfaceAdapter` command.

**Alternatives considered:**

| Approach | Pros | Cons | Verdict |
|---|---|---|---|
| Chrome → Hub directly | Fewer hops | Hub rejects browser origins (security); needs new auth flow; bypasses CommentStore | **Rejected** |
| Chrome → Hub via new endpoint | Could extend Hub protocol | Breaks "Hub is editor-agnostic" constraint; Hub should never know about Chrome | **Rejected** |
| Chrome → VSCode extension relay | Follows surface adapter pattern; Hub unchanged; Bridge unchanged; comments persist through existing store | Extra local WS server | **Chosen** |

**Why this is the right choice:**
- Every existing surface modality (md-viewer, slidev) goes through a VS Code extension bridge → `getSurfaceAdapter` → `CommentStore`. The browser surface follows the same pattern.
- The Hub's origin validation actively rejects browser `Origin` headers. Working around this would weaken security.
- The `CommentStore` is the single source of truth—all comment mutations must go through it for persistence and event propagation.

### ADR-04: CSS Selector + Text Fingerprint Anchoring

**Decision:** Anchor browser comments to DOM elements using stable CSS selector paths plus a text content fingerprint for resilience.

**Alternatives considered:**

| Approach | Pros | Cons | Verdict |
|---|---|---|---|
| Normalized coordinates (x, y 0..1) | Already in type system; simple | Breaks on any layout change, resize, or responsive design | **Rejected** as primary |
| CSS selector paths | Semantic; survives minor DOM changes | Can break on major restructuring | **Chosen** |
| XPath | More expressive | Verbose; not standard in CSS APIs | **Rejected** |
| Content hashing only | Survives restructuring | Ambiguous when duplicate text exists | Used as **supplement** |

**New coordinate type:** `CssSelectorCoordinates` added to `SurfaceCoordinates` union in `@accordo/bridge-types`.

---

## 3. System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│  Agent (Claude / Copilot / OpenCode / Cursor)                       │
│                                                                     │
│  ┌──────────────┐   ┌────────────────────────────────────────────┐  │
│  │ Playwright    │   │ Accordo Hub                                │  │
│  │ MCP Server    │   │  • tools/list includes comment tools       │  │
│  │ (off-the-shelf)│   │  • /instructions shows open browser threads│  │
│  │               │   │  • /state exposes browser tab info         │  │
│  │ browser_*     │   │                                            │  │
│  │ tools         │   │        ▲ WebSocket (existing)              │  │
│  └──────────────┘   └────────┼───────────────────────────────────┘  │
│                              │                                      │
│         MCP (separate)       │  MCP (existing)                      │
└─────────────────────────────────────────────────────────────────────┘
                               │
                    ┌──────────┴──────────┐
                    │   Accordo Bridge    │
                    │   (existing, no     │
                    │    changes)         │
                    └──────────┬──────────┘
                               │ BridgeAPI
                    ┌──────────┴──────────────────────────────────┐
                    │                                             │
          ┌─────────┴──────────┐              ┌──────────────────┴──┐
          │  accordo-comments  │              │  accordo-browser    │
          │  (existing, no     │◄─────────────│  (new VSCode ext)   │
          │   changes)         │  getSurface  │                     │
          │                    │  Adapter     │  • BrowserRelay     │
          │  CommentStore      │              │    (local WS server)│
          │  NativeComments    │              │  • BrowserComments  │
          │  StateContribution │              │    Bridge           │
          └────────────────────┘              │  • BrowserState     │
                                              │    Contribution     │
                                              └──────────┬──────────┘
                                                         │
                                              WebSocket (localhost:3001)
                                                         │
                                              ┌──────────┴──────────┐
                                              │  Chrome Extension   │
                                              │  (Manifest V3)      │
                                              │                     │
                                              │  • Background       │
                                              │    service worker    │
                                              │  • Content script   │
                                              │    (DOM auto-tagger  │
                                              │     + Comment SDK)   │
                                              │  • Popup UI         │
                                              └─────────────────────┘
                                                         │
                                                 ┌───────┴───────┐
                                                 │  Any Web Page  │
                                                 │  (real Chrome) │
                                                 └───────────────┘
```

### Data Flow: User Creates a Comment on a Web Page

```
1. User Alt+clicks a <p> element on https://example.com/docs
2. Content script: DOM auto-tagger already assigned data-block-id="css:p:nth-of-type(3)|fp:a1b2c3"
3. Content script: SDK shows inline textarea; user types "This API is deprecated"
4. Content script: SDK calls callbacks.onCreate(blockId, body)
5. Content script: chrome.runtime.sendMessage({
     type: "comment:create", blockId, body, tabUrl: "https://example.com/docs"
   })
6. Background SW: forwards via WebSocket → ws://localhost:3001/browser
7. accordo-browser extension (BrowserCommentsBridge):
   a. Parses blockId → CssSelectorCoordinates { type: "css-selector", selector: "p:nth-of-type(3)", textFingerprint: "a1b2c3" }
   b. Builds anchor: { kind: "surface", uri: "https://example.com/docs", surfaceType: "browser", coordinates }
   c. Calls surfaceAdapter.createThread({ uri, anchor, body })
8. accordo-comments (CommentStore):
   a. Persists thread to .accordo/comments.json
   b. Fires onChanged("https://example.com/docs")
9. StateContribution publishes updated summary → Hub → agent system prompt
10. BrowserCommentsBridge receives onChanged → pushes comments:load → WebSocket → Chrome → SDK re-renders pins
11. Agent sees in system prompt: "Open comment on https://example.com/docs: 'This API is deprecated'"
```

### Data Flow: Agent Resolves a Browser Comment

```
1. Agent calls accordo.comment.resolve({ threadId: "abc-123", resolutionNote: "Fixed in PR #42" })
2. Hub → Bridge → accordo-comments CommentTools handler
3. CommentStore updates thread status → fires onChanged
4. StateContribution publishes updated summary → Hub
5. BrowserCommentsBridge receives onChanged → pushes comments:load → WebSocket → Chrome
6. Content script: SDK.loadThreads() → pin changes from "open" (blue) to "resolved" (green)
```

---

## 4. Components

### 4.1 `accordo-browser` — VSCode Extension (New)

A workspace-scoped VSCode extension. No webview. No custom editor. Its sole purpose is relaying between the Chrome extension and the Accordo comments infrastructure.

**Files:**

| File | Purpose |
|---|---|
| `extension.ts` | Activation, dependency wiring, tool registration |
| `browser-relay.ts` | Local WebSocket server accepting Chrome extension connections |
| `browser-comments-bridge.ts` | Routes comment messages ↔ CommentStore via surface adapter |
| `browser-state.ts` | Publishes connected-tab state to Hub via Bridge |
| `selector-utils.ts` | CSS selector generation and blockId encoding/decoding |

**Dependencies:**
- `accordo-bridge` (for `BridgeAPI` — tool registration, state publishing)
- `accordo-comments` (for `getSurfaceAdapter` command — comment CRUD)
- `ws` (npm — WebSocket server; same library already used by the Hub)

**No dependency on:** Playwright, Puppeteer, or any browser automation library.

### 4.2 Chrome Extension — Manifest V3 (New)

A Chrome extension side-loaded during development. Communicates exclusively with the `accordo-browser` VSCode extension via local WebSocket.

**Files:**

| File | Purpose |
|---|---|
| `manifest.json` | Manifest V3: permissions, content script registration, service worker |
| `background/service-worker.ts` | WebSocket client to VS Code relay; message routing |
| `content/content-script.ts` | DOM auto-tagger + Comment SDK initialization |
| `content/dom-tagger.ts` | Assigns `data-block-id` attributes to meaningful DOM elements |
| `content/selector-generator.ts` | Generates minimal, unique CSS selector paths |
| `content/text-fingerprint.ts` | FNV-1a hash of element text content |
| `content/browser-theme.css` | Maps `--vscode-*` CSS variables to browser-appropriate values |
| `popup/popup.html` | Extension popup UI |
| `popup/popup.ts` | Popup logic: connection status, settings, toggle |

**Dependencies:**
- `@accordo/comment-sdk` (bundled into extension — zero additional runtime deps)
- Chrome Extension APIs (`chrome.runtime`, `chrome.tabs`, `chrome.storage`, `chrome.scripting`)

### 4.3 `@accordo/bridge-types` — Type Additions (Existing)

Minimal additions to the shared type package:

- `CssSelectorCoordinates` interface added to `SurfaceCoordinates` union
- `BrowserRelayMessage` discriminated union for relay protocol
- `BrowserTabInfo` interface for state contribution

### 4.4 Packages NOT Changed

| Package | Why no changes |
|---|---|
| `accordo-hub` | Hub is editor-agnostic. Browser state arrives via existing `publishState` flow. |
| `accordo-bridge` | Bridge's `BridgeAPI` is consumed as-is. No API changes. |
| `accordo-comments` | The `getSurfaceAdapter` already supports arbitrary surface types including `"browser"`. |
| `@accordo/comment-sdk` | SDK is callback-driven and framework-free. Used directly in Chrome content script. |

---

## 5. Relay Protocol (`BrowserRelayMessage`)

### 5.1 Transport

- **Server:** `accordo-browser` VSCode extension, listening on `ws://localhost:{port}/browser` (default port 3001, configurable via `accordo.browser.relayPort`)
- **Client:** Chrome extension background service worker
- **Auth:** `x-accordo-browser-token` header on WebSocket upgrade (token generated by VSCode extension, displayed in its status bar and Chrome popup settings)
- **Max connections:** Unlimited (one per Chrome tab that has the extension active)
- **Payload format:** JSON, max 512KB per message

### 5.2 Chrome → VSCode Messages

| Type | Payload | Description |
|---|---|---|
| `browser:connect` | `{ tabId, url, title }` | Tab with extension active has connected |
| `browser:navigate` | `{ tabId, url, title }` | User navigated to a new page in this tab |
| `browser:disconnect` | `{ tabId }` | Tab closed or extension deactivated |
| `comment:create` | `{ tabId, url, blockId, body, intent? }` | User created a comment via SDK |
| `comment:reply` | `{ tabId, url, threadId, body }` | User replied to a comment |
| `comment:resolve` | `{ tabId, url, threadId }` | User resolved a comment |
| `comment:reopen` | `{ tabId, url, threadId }` | User reopened a comment |
| `comment:delete` | `{ tabId, url, threadId, commentId? }` | User deleted a comment or thread |

### 5.3 VSCode → Chrome Messages

| Type | Payload | Description |
|---|---|---|
| `comments:load` | `{ url, threads: SdkThread[] }` | Full thread list for a URL (sent on connect + on every change) |
| `comments:add` | `{ url, thread: SdkThread }` | Single new thread added |
| `comments:update` | `{ url, threadId, partial }` | Thread updated (status change, new reply) |
| `comments:remove` | `{ url, threadId }` | Thread deleted |
| `comments:focus` | `{ url, threadId }` | Open popover for a specific thread (when user clicks in VS Code Comments panel) |
| `browser:auth-ok` | `{}` | Authentication accepted |
| `browser:auth-fail` | `{ reason }` | Authentication rejected |

### 5.4 Connection Lifecycle

```
Chrome background SW                            VSCode BrowserRelay
       │                                               │
       ├── ws://localhost:3001/browser ────────────────►│
       │   (x-accordo-browser-token header)            │
       │                                  auth check    │
       │◄──────────────── browser:auth-ok ─────────────┤
       │                                               │
       ├── browser:connect { tabId, url, title } ─────►│
       │                                               │
       │◄──────────── comments:load { url, threads } ──┤
       │                                               │
       │   ... comment messages flow bidirectionally ...│
       │                                               │
       ├── browser:disconnect { tabId } ──────────────►│
       │                                               │
       X   connection closed                           │
```

---

## 6. DOM Auto-Tagger

The DOM auto-tagger runs as part of the Chrome extension's content script. Its job is to assign `data-block-id` attributes to meaningful DOM elements so the Comment SDK can anchor pins to them.

### 6.1 Element Selection

Elements are tagged if they match any of these criteria:

| Priority | Selector | Rationale |
|---|---|---|
| 1 | `[id]` | Author-assigned IDs are the most stable anchors |
| 2 | `[data-testid]` | Test attributes are intentionally stable |
| 3 | `h1, h2, h3, h4, h5, h6` | Headings are semantic landmarks |
| 4 | `p` | Paragraphs are the primary text containers |
| 5 | `li` | List items carry discrete content |
| 6 | `td, th` | Table cells are data-bearing |
| 7 | `img, video, canvas` | Visual media elements |
| 8 | `pre, code` | Code blocks |
| 9 | `form, input, button, select, textarea` | Interactive elements |
| 10 | `section, article, main, aside, nav, header, footer` | Semantic landmarks |

### 6.2 Elements NOT Tagged

- `<script>`, `<style>`, `<meta>`, `<link>`, `<noscript>`
- Elements with `display: none` or `visibility: hidden`
- Elements smaller than 10×10 pixels
- Elements inside the Accordo overlay itself (`#accordo-overlay` and descendants)

### 6.3 BlockId Format

```
css:{selector}|fp:{fingerprint}
```

- **`selector`**: Minimal CSS selector path (see §6.4)
- **`fingerprint`**: 8-character hex FNV-1a hash of the element's trimmed `textContent` (first 100 characters)

Example: `css:#main>article>p:nth-of-type(3)|fp:8a3f2b1c`

### 6.4 CSS Selector Generator

Generates the shortest unique CSS selector for an element:

1. If element has a unique `id`: return `#{id}`
2. If element has a unique `data-testid`: return `[data-testid="{value}"]`
3. Build path from element to nearest ancestor with a unique `id` or `<body>`:
   - At each level: `tag:nth-of-type(n)` (more stable than `:nth-child` which is sensitive to sibling type changes)
   - Maximum depth: 5 levels (deeper elements use the closest 5-level prefix)
4. Validate: `document.querySelectorAll(selector).length === 1` — if not unique, extend path

### 6.5 Text Fingerprint

- Input: `element.textContent.trim().slice(0, 100)`
- Algorithm: FNV-1a 32-bit hash → 8-character hex string
- Purpose: Detect when a CSS selector now points to different content after a DOM restructure
- On mismatch: Pin renders with a "stale anchor" visual warning (faded, dashed border)

### 6.6 MutationObserver Integration

- Observe `document.body` with `{ childList: true, subtree: true }`
- On mutations: debounce 200ms → re-run tagger on new/changed subtrees only (not full page)
- Do NOT remove existing `data-block-id` attributes on mutation (stable across updates)

---

## 7. Comment SDK Integration in Chrome

### 7.1 Overlay Setup

The content script creates:
```html
<div id="accordo-overlay"
     style="position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            pointer-events: none; z-index: 2147483646;">
</div>
```

The SDK's pins receive `pointer-events: auto` so they're clickable while the overlay itself doesn't intercept page interactions.

### 7.2 Coordinate Resolver

```typescript
function coordinateToScreen(blockId: string): ScreenPosition | null {
  const selector = parseSelector(blockId);  // extract CSS selector from blockId
  const el = document.querySelector(selector);
  if (!el) return null;

  // Optional: verify text fingerprint
  const fp = parseFingerprint(blockId);
  if (fp && computeFingerprint(el) !== fp) {
    // Element exists but content changed — still return position but mark stale
    return { x: rect.left, y: rect.top, stale: true };
  }

  const rect = el.getBoundingClientRect();
  return { x: rect.right + 8, y: rect.top };  // pin appears to the right of the element
}
```

### 7.3 Scroll and Resize Handling

- `window.addEventListener("scroll", repositionPins, { passive: true })`
- `new ResizeObserver(repositionPins).observe(document.body)`
- `repositionPins` calls `coordinateToScreen` for each visible pin
- Debounced at 16ms (single animation frame via `requestAnimationFrame`)

### 7.4 CSS Theme Adaptation

The Comment SDK uses VS Code CSS variables. For the Chrome extension, a `browser-theme.css` file provides browser-appropriate values:

```css
:root {
  --vscode-editor-background: #ffffff;
  --vscode-editor-foreground: #1e1e1e;
  --vscode-button-background: #0066cc;
  --vscode-button-foreground: #ffffff;
  --vscode-input-background: #f5f5f5;
  --vscode-input-border: #cccccc;
  /* ... etc */
}
@media (prefers-color-scheme: dark) {
  :root {
    --vscode-editor-background: #1e1e1e;
    --vscode-editor-foreground: #d4d4d4;
    --vscode-button-background: #0e639c;
    /* ... etc */
  }
}
```

---

## 8. Browser Automation (Off-the-Shelf)

### 8.1 Recommended Setup

The `@playwright/mcp` server is configured alongside the Accordo Hub in the agent's MCP configuration:

**`opencode.json`:**
```json
{
  "mcp": {
    "accordo-hub": {
      "type": "remote",
      "url": "http://localhost:3000/mcp",
      "headers": { "Authorization": "Bearer <token>" }
    },
    "playwright": {
      "type": "stdio",
      "command": "npx",
      "args": ["@playwright/mcp@latest"]
    }
  }
}
```

**`.claude/mcp.json`:**
```json
{
  "mcpServers": {
    "accordo-hub": { "type": "http", "url": "http://localhost:3000/mcp", "headers": { "Authorization": "Bearer <token>" } },
    "playwright": { "command": "npx", "args": ["@playwright/mcp@latest"] }
  }
}
```

### 8.2 Tools the Agent Gets (from Playwright MCP)

These are standard Playwright MCP tools — not built or maintained by Accordo:

| Tool | Description |
|---|---|
| `browser_navigate` | Navigate to a URL |
| `browser_click` | Click an element |
| `browser_type` | Type text into an element |
| `browser_screenshot` | Capture a screenshot |
| `browser_evaluate` | Execute JavaScript in the page |
| `browser_go_back` / `browser_go_forward` | Navigation history |
| `browser_tab_list` / `browser_tab_new` / `browser_tab_close` | Tab management |
| `browser_wait_for_element` | Wait for an element to appear |

### 8.3 Interaction with Comments

The agent can:
1. Use `browser_navigate` to open a page
2. Use `browser_screenshot` to see what's there
3. Use `accordo.comment.create` (with `surfaceType: "browser"`, `uri: "https://..."`) to leave a comment
4. The comment appears as a pin in Chrome (if the user has the extension active on that URL)
5. User replies to the comment in Chrome → agent sees the reply in its next prompt

This works because the `commentStore` is shared. All comment tools already support `surfaceType: "browser"` — the only new piece is the visual rendering in Chrome via the extension.

---

## 9. State Contribution

`accordo-browser` publishes browser connection state to the Hub's system prompt via `bridge.publishState('accordo-browser', state)`.

### 9.1 State Shape

```typescript
interface BrowserConnectionState {
  isConnected: boolean;
  connectedTabs: BrowserTabInfo[];
  activeTabUrl: string | null;
  activeTabTitle: string | null;
}

interface BrowserTabInfo {
  tabId: number;
  url: string;
  title: string;
  commentCount: number;  // open threads on this URL
}
```

### 9.2 When State is Published

- On Chrome tab connect/disconnect/navigate
- On comment thread creation/resolution/deletion for a browser-anchored URL
- On extension activation (initial state: `{ isConnected: false, connectedTabs: [] }`)

### 9.3 System Prompt Rendering

The Hub's prompt engine sees `modalities["accordo-browser"]` and renders:

```markdown
## Browser

Connected tabs: 2
- https://docs.example.com/api (3 open comments)  
- https://github.com/org/repo/pull/42 (1 open comment)
```

This is automatic — the Hub's existing modality rendering logic handles it without changes.

---

## 10. Security

### 10.1 Relay Authentication

- The `accordo-browser` extension generates a random token on first activation (UUID v4)
- Token is stored in VS Code settings (`accordo.browser.relayToken`) and displayed in the status bar
- User copies token into the Chrome extension popup settings
- Token is sent as `x-accordo-browser-token` header on WebSocket upgrade
- On mismatch: connection rejected with close code 4001 (same convention as Bridge)

### 10.2 Localhost Only

- The relay WebSocket server binds to `127.0.0.1` only (not `0.0.0.0`)
- Chrome extension connects to `ws://localhost:{port}/browser` only
- No network exposure; no remote Chrome connections

### 10.3 Content Security

- Content script never executes code from the WebSocket — it only processes structured comment messages
- The Comment SDK renders user-authored text via `textContent` (not `innerHTML`) — no XSS vector
- Message payloads are validated against expected shapes before processing

### 10.4 Privacy Boundaries

- The Chrome extension only reads URLs and DOM structure — never cookies, passwords, or form data
- Page URLs stored in `.accordo/comments.json` are local to the workspace
- No telemetry or external network calls from the extension

---

## 11. Remote and Environment Constraints

### 11.1 SSH / Devcontainer / Codespaces

The `accordo-browser` extension runs in the **remote extension host** (workspace-scoped). The WebSocket relay listens on the remote machine's localhost. For local Chrome to reach it:

- VS Code auto-forwards ports listed in `forwardedPorts` or detected by port auto-forwarding
- The Chrome extension should be configurable to connect to `localhost:{forwarded-port}` instead of the default
- Alternatively, the relay port can be specified in `accordo.browser.relayPort` setting, and the user sets up manual forwarding

### 11.2 Multiple Workspaces

Each workspace runs its own `accordo-browser` relay on its own port. Chrome extension popup shows which workspace is connected and allows switching.

---

## 12. Build and Distribution

### 12.1 Chrome Extension

- Built with esbuild (matching the project's existing build tooling)
- Three entry points: `service-worker.ts`, `content-script.ts`, `popup.ts`
- `@accordo/comment-sdk` dist files (`sdk.js`, `sdk.css`) copied into the extension bundle
- `browser-theme.css` included alongside `sdk.css`
- Output: `packages/browser-extension/dist/` — loadable via `chrome://extensions` (developer mode)
- Future: Chrome Web Store publication (not in initial scope)

### 12.2 VSCode Extension

- Standard Accordo extension build: `tsc` → `dist/`
- Added to workspace `pnpm build` pipeline
- Published alongside other Accordo extensions

---

## 13. Testing Strategy

### 13.1 VSCode Extension (`packages/browser/`)

- Unit tests for `BrowserRelay`: connection lifecycle, auth accept/reject, multi-client, message routing
- Unit tests for `BrowserCommentsBridge`: blockId encoding/decoding, anchor construction, store integration, change propagation
- Unit tests for `BrowserStateContribution`: state shape, publication triggers
- Unit tests for `selector-utils`: encoding/decoding, edge cases

### 13.2 Chrome Extension (`packages/browser-extension/`)

- Unit tests for `dom-tagger`: element selection, skip rules, mutation handling
- Unit tests for `selector-generator`: uniqueness, depth limits, ID preference, nth-of-type
- Unit tests for `text-fingerprint`: determinism, hash distribution
- Unit tests for `service-worker` message routing (using mock WebSocket)
- Tests run in jsdom (matching `@accordo/comment-sdk` test environment)

### 13.3 Integration

- Simulated end-to-end: mock Chrome messages → relay → CommentStore → verify thread with correct `browser` surface anchor
- Manual smoke test: side-load extension → Alt+click element → comment in VS Code panel → agent visibility

---

## 14. Affected Packages

| Package | Change | Scope |
|---|---|---|
| `packages/browser/` | **New** | VSCode extension: relay, comments bridge, state contribution |
| `packages/browser-extension/` | **New** | Chrome Manifest V3 extension |
| `packages/bridge-types/` | **Updated** | Add `CssSelectorCoordinates`, `BrowserRelayMessage`, `BrowserTabInfo` types |
| `packages/hub/` | **No change** | Receives browser state via existing modality state flow |
| `packages/bridge/` | **No change** | BridgeAPI consumed as-is |
| `packages/comments/` | **No change** | `getSurfaceAdapter` already supports `"browser"` surface type |
| `packages/comment-sdk/` | **No change** | SDK used directly in Chrome content script (callback-driven, framework-free) |

---

## 15. Phase Boundaries

| Item | Phase 6 (this) | Future |
|---|---|---|
| Chrome extension with Comment SDK | ✅ | — |
| VSCode relay extension | ✅ | — |
| CSS selector + text fingerprint anchoring | ✅ | — |
| Browser state in agent prompt | ✅ | — |
| Playwright MCP setup documentation | ✅ | — |
| `CssSelectorCoordinates` type | ✅ | — |
| Chrome Web Store publication | — | When stable |
| Firefox extension port | — | Future demand |
| Agent-initiated comment pins (push to Chrome) | ✅ (via store→relay→SDK) | — |
| Screenshot annotation (draw on screenshot) | — | Future |
| Multi-workspace Chrome switcher UI | — | Future |
