# Browser Page Understanding + Visual Comment Placement — Architecture

**Status:** DRAFT — Phase A deliverable  
**Date:** 2026-03-26  
**Scope:** New MCP tools for AI agents to inspect live browser pages, reason about DOM elements, and place context-rich comments on specific UI elements  
**Depends on:** Session 14 unified comments contract (complete), `packages/browser` relay (complete), `packages/browser-extension` v2a (complete)

---

## 1. Executive Summary

Today's Accordo browser integration lets agents list, create, and manage comments on web pages — but the agent has **no ability to see the page**. Comments placed by agents land at fallback positions (`body:center` or viewport-percentage keys) because the agent cannot inspect the DOM, identify elements, or understand page layout.

This architecture introduces a **Page Understanding** capability: a set of MCP tools that let agents query the live page's DOM structure, inspect specific elements, and place comments on precisely identified UI elements with stable anchors.

### What problem it solves (non-technical)

When an AI agent needs to comment on something visible in your browser — like a button, a heading, or a data table — it currently has no way to know what's on the page. It's like trying to leave a sticky note in a room you've never entered. This architecture gives the agent "eyes" to see what's on the page (a structured map of all visible elements) and "hands" to point at exactly the right thing when placing a comment.

### What can go wrong

- Pages with heavy JavaScript frameworks may produce very large DOM trees that exceed tool response limits
- Dynamic pages (SPAs) may change between the time the agent reads the map and places a comment
- Elements identified by position may shift on resize or responsive layout changes
- The page understanding tools add round-trip latency through the relay WebSocket

### How we know it works

- Agent can call `browser_get_page_map` and receive a structured summary of the visible page
- Agent can call `browser_inspect_element` with a selector/node-ref and get full context
- Agent can call `comment_create` with a browser anchor derived from page understanding data
- Comments placed via page understanding land on the correct element (not fallback positions)
- All new code compiles cleanly with `strict: true` and imports without errors
- Existing 2,636 tests remain green — all changes are additive

---

## 2. Design Decisions

### ADR-PU-01: Page Map as Structured Tree, Not Screenshot

**Decision:** The primary page understanding tool returns a structured DOM summary (tag, role, text, bounding box) rather than a screenshot/image for visual reasoning.

**Rationale:**
- LLM vision capabilities vary across agents and add cost/latency
- A structured tree can be serialized as text/JSON within existing MCP response format
- Agents can reason about element identity (selectors, ARIA roles, text content) for precise comment placement
- Screenshots remain available via the existing `browser_get_screenshot` relay action for visual context

**Alternatives considered:**
- **Screenshot + vision model:** Higher fidelity but couples to specific LLM capabilities, much higher token cost, and doesn't provide DOM identity for anchoring
- **Accessibility tree only:** Misses non-accessible elements and visual layout information

### ADR-PU-02: Content Script Execution for DOM Queries

**Decision:** Page understanding queries execute as content script functions in the browser extension, invoked via the existing relay WebSocket path.

**Rationale:**
- The content script already has full DOM access for pin rendering and anchor resolution
- The relay path (Chrome extension ↔ `accordo-browser` ↔ unified tools) is proven and authenticated
- No new transport mechanism needed — reuse `BrowserRelayAction` dispatch
- Content script can access computed styles, bounding rects, ARIA attributes, and `textContent`

### ADR-PU-03: Enhanced Anchor Strategy with Fallback Hierarchy

**Decision:** Introduce a tiered anchor strategy that prefers stable identifiers over positional ones:

1. **`id` attribute** — most stable, survives page reloads
2. **`data-testid` / `data-*` attribute** — common in modern frameworks, stable by design
3. **ARIA label + role** — semantic, survives minor DOM restructuring
4. **CSS selector path** — generated from the DOM tree, moderately stable
5. **Current `tagName:siblingIndex:textFingerprint`** — existing format, session-scoped
6. **Viewport percentage** — least stable, last resort

The anchor key format is extended to encode the strategy used, so re-anchoring can try higher-tier strategies first.

**Rationale:**
- Current anchoring (`tagName:siblingIndex:textFingerprint`) is fragile — any DOM change breaks it
- Modern web apps use `data-testid` extensively for testing, making them ideal stable anchors
- The hierarchy allows graceful degradation: best available strategy is used, with fallback
- Backward compatible: existing anchor keys continue to work unchanged

### ADR-PU-04: Page Map Depth and Size Control

**Decision:** The page map tool accepts `maxDepth` (default 4) and `maxNodes` (default 200) parameters. The content script walks the visible DOM tree breadth-first, pruning at depth limit, and stops emitting nodes at the count limit. A `truncated` flag indicates whether the full tree was captured.

**Rationale:**
- Real web pages can have thousands of DOM nodes (Gmail: ~8000, GitHub PR: ~5000)
- MCP tool responses must stay within reasonable token budgets for agent consumption
- Breadth-first ensures top-level navigation/header/main/footer structure is always captured
- Agents can drill deeper into specific subtrees via `browser_inspect_element`

### ADR-PU-05: Tools Live in Browser Extension, Not Hub

**Decision:** Page understanding tools are relay actions executed by the browser extension's content script, dispatched through the existing `browserActionToUnifiedTool` → unified comment tool routing in `packages/browser/src/extension.ts`. They are NOT registered as standalone Hub MCP tools.

**Rationale:**
- Hub has zero VS Code dependency and zero browser dependency (AGENTS.md §4.1)
- The browser relay already handles bidirectional Chrome ↔ VS Code communication
- Adding new relay actions follows the established pattern from Session 13/14
- The tools need live DOM access, which only the content script has

**Update (design iteration):** Page understanding tools ARE distinct from comment tools — they don't map to `comment_*`. They are registered as new MCP tools (`browser_get_page_map`, `browser_inspect_element`, `browser_get_dom_excerpt`) via `bridge.registerTools()` in `packages/browser/src/extension.ts`, with handlers that forward to the Chrome relay. This follows the same pattern as how `accordo-browser` could register tools, but currently routes through `onRelayRequest` instead.

### ADR-PU-06: Portability Layer — `CommentBackendAdapter`

**Decision:** Define a `CommentBackendAdapter` interface that abstracts the comment storage backend. Today's adapter routes through the VS Code relay → `comment_*` tools. A future standalone adapter routes directly to an MCP server or local storage.

**Rationale:**
- The browser extension must eventually work without VS Code (standalone mode)
- The adapter boundary keeps the page understanding and comment placement logic backend-agnostic
- Today: `VscodeRelayAdapter` wraps `RelayBridgeClient` → `onRelayRequest` → `comment_*` tools
- Future: `StandaloneMcpAdapter` wraps a direct MCP client → Hub or local storage

---

## 3. System Architecture

### 3.1 Component Diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│  Chrome Browser                                                       │
│                                                                       │
│  ┌──────────────────────────────────────────────────────────────────┐ │
│  │  Content Script (existing + new modules)                          │ │
│  │                                                                   │ │
│  │  EXISTING:                                                        │ │
│  │  • Pin rendering, popovers, anchor resolution                    │ │
│  │  • content-anchor.ts (findAnchorElementByKey, parseAnchorKey)    │ │
│  │                                                                   │ │
│  │  NEW:                                                             │ │
│  │  • page-map-collector.ts — DOM tree walker, element summarizer   │ │
│  │  • element-inspector.ts — deep element inspection, context       │ │
│  │  • enhanced-anchor.ts — tiered anchor generation                 │ │
│  └────────────┬──────────────────────────────────────────────────────┘ │
│               │ chrome.runtime.sendMessage                            │
│  ┌────────────▼──────────────────────────────────────────────────────┐ │
│  │  Service Worker (existing + new relay actions)                     │ │
│  │                                                                   │ │
│  │  EXISTING: comment CRUD, mode toggle, screenshot, relay-actions  │ │
│  │                                                                   │ │
│  │  NEW relay actions:                                               │ │
│  │  • get_page_map — invokes page-map-collector in content script   │ │
│  │  • inspect_element — invokes element-inspector in content script │ │
│  │  • get_dom_excerpt — returns raw HTML fragment around element    │ │
│  └────────────┬──────────────────────────────────────────────────────┘ │
│               │ WebSocket (ws://127.0.0.1:40111)                      │
└───────────────┼──────────────────────────────────────────────────────┘
                │
┌───────────────▼──────────────────────────────────────────────────────┐
│  accordo-browser (VS Code extension)                                  │
│                                                                       │
│  EXISTING:                                                            │
│  • BrowserRelayServer on 127.0.0.1:40111                             │
│  • browserActionToUnifiedTool() → comment_* routing                  │
│  • onRelayRequest interceptor                                        │
│                                                                       │
│  NEW:                                                                 │
│  • New relay action handlers for page understanding                  │
│  • 3 MCP tools registered via bridge.registerTools():                │
│    - browser_get_page_map                                            │
│    - browser_inspect_element                                         │
│    - browser_get_dom_excerpt                                         │
│  • Enhanced anchor support in browserActionToUnifiedTool()           │
└───────────────┬──────────────────────────────────────────────────────┘
                │ BridgeAPI.registerTools() + BridgeAPI.invokeTool()
┌───────────────▼──────────────────────────────────────────────────────┐
│  accordo-bridge → accordo-hub                                         │
│                                                                       │
│  Hub exposes page understanding tools via MCP tools/list              │
│  Agent calls browser_get_page_map → Hub → Bridge → browser relay    │
│  Agent calls comment_create with enriched anchor → unified path      │
└──────────────────────────────────────────────────────────────────────┘
```

### 3.2 Data Flow — Agent Places a Comment on a Specific Element

```
Agent                    Hub              Bridge           accordo-browser         Chrome
  │                       │                │                │                       │
  │─── browser_get_page_map ──►            │                │                       │
  │                       │── invoke ──►   │                │                       │
  │                       │                │── relay req ──►│                       │
  │                       │                │                │── sendMessage ──►     │
  │                       │                │                │   (content script     │
  │                       │                │                │    walks DOM)         │
  │                       │                │                │◄── page map ─────    │
  │                       │                │◄── response ───│                       │
  │                       │◄── result ─────│                │                       │
  │◄── { nodes, meta } ───│                │                │                       │
  │                       │                │                │                       │
  │ (Agent reasons about page structure, identifies target element)                 │
  │                       │                │                │                       │
  │─── browser_inspect_element(ref) ──►    │                │                       │
  │                       │── invoke ──►   │                │                       │
  │                       │                │── relay req ──►│                       │
  │                       │                │                │── sendMessage ──►     │
  │                       │                │                │◄── element detail ── │
  │                       │                │◄── response ───│                       │
  │                       │◄── result ─────│                │                       │
  │◄── { anchor, ctx } ───│                │                │                       │
  │                       │                │                │                       │
  │─── comment_create({ scope: browser, anchor: { kind: "browser",                │
  │        anchorKey: "id:submit-btn" }, body: "..." }) ──►│                       │
  │                       │  (unified comment path — same as today)                │
  │◄── { created: true } ─│                │                │                       │
```

### 3.3 Data Flow — Agent Reads Page for Context (No Comment)

```
Agent                    Hub              Bridge           accordo-browser         Chrome
  │                       │                │                │                       │
  │─── browser_get_page_map({ maxDepth: 3, viewport: true }) ──►                  │
  │                       │── invoke ──►   │── relay ──►    │── content script ──► │
  │◄── { nodes[], truncated, pageUrl, title } ◄── ◄── ◄──  │                      │
  │                       │                │                │                       │
  │─── browser_get_dom_excerpt({ selector: "main > table", depth: 2 }) ──►        │
  │                       │── invoke ──►   │── relay ──►    │── content script ──► │
  │◄── { html, text, nodeCount } ◄── ◄──  │                │                      │
```

---

## 4. Tool Contracts

### 4.1 `browser_get_page_map`

**Purpose:** Returns a structured summary of the visible page's DOM tree, giving the agent a "bird's eye view" of what's on the page.

```typescript
// Input schema
interface BrowserGetPageMapArgs {
  /** Maximum DOM tree depth to walk (default: 4, max: 8) */
  maxDepth?: number;
  /** Maximum number of nodes to include (default: 200, max: 500) */
  maxNodes?: number;
  /** Include bounding box coordinates for each node (default: false) */
  includeBounds?: boolean;
  /** Filter to only visible elements in current viewport (default: false) */
  viewportOnly?: boolean;
}

// Output
interface BrowserGetPageMapResult {
  /** Page URL (normalized: origin + pathname) */
  pageUrl: string;
  /** Page title */
  title: string;
  /** Viewport dimensions */
  viewport: { width: number; height: number };
  /** Structured DOM tree */
  nodes: PageNode[];
  /** Total DOM element count (before truncation) */
  totalElements: number;
  /** Whether the result was truncated by maxDepth or maxNodes */
  truncated: boolean;
}

interface PageNode {
  /** Opaque reference for use with browser_inspect_element */
  ref: string;
  /** HTML tag name (lowercase) */
  tag: string;
  /** ARIA role if present */
  role?: string;
  /** Accessible name (aria-label, alt, title, or derived) */
  name?: string;
  /** Visible text content (truncated to 100 chars) */
  text?: string;
  /** Key attributes: id, class (first 3), href, src, type, data-testid */
  attrs?: Record<string, string>;
  /** Bounding box relative to viewport (if includeBounds=true) */
  bounds?: { x: number; y: number; width: number; height: number };
  /** Child nodes (recursive, up to maxDepth) */
  children?: PageNode[];
}
```

**Danger level:** `safe` (read-only)  
**Idempotent:** `true`  
**MCP tool name:** `browser_get_page_map`

### 4.2 `browser_inspect_element`

**Purpose:** Returns detailed information about a specific element, including computed styles, full attributes, surrounding context, and a generated anchor key for comment placement.

```typescript
// Input schema
interface BrowserInspectElementArgs {
  /** Element reference from page map (ref field), OR a CSS selector */
  ref?: string;
  /** CSS selector to find the element (alternative to ref) */
  selector?: string;
}

// Output
interface BrowserInspectElementResult {
  /** Whether the element was found */
  found: boolean;
  /** Generated anchor key using best available strategy */
  anchorKey?: string;
  /** Anchor strategy used (id | data-testid | aria | css-path | tag-sibling | viewport-pct) */
  anchorStrategy?: string;
  /** Element details */
  element?: {
    tag: string;
    id?: string;
    classList?: string[];
    role?: string;
    ariaLabel?: string;
    textContent?: string;
    /** All attributes */
    attributes: Record<string, string>;
    /** Bounding box */
    bounds: { x: number; y: number; width: number; height: number };
    /** Computed visibility */
    visible: boolean;
    /** Accessible name */
    accessibleName?: string;
    /** Data attributes (data-testid, data-cy, etc.) */
    testIds?: Record<string, string>;
  };
  /** Surrounding context for agent reasoning */
  context?: {
    /** Parent chain (tag#id.class, up to 3 ancestors) */
    parentChain: string[];
    /** Number of siblings */
    siblingCount: number;
    /** Position among siblings (0-indexed) */
    siblingIndex: number;
    /** Nearby landmarks (header, nav, main, footer, etc.) */
    nearestLandmark?: string;
  };
}
```

**Danger level:** `safe` (read-only)  
**Idempotent:** `true`  
**MCP tool name:** `browser_inspect_element`

### 4.3 `browser_get_dom_excerpt`

**Purpose:** Returns a raw HTML fragment and text content for a subtree rooted at a selector. Useful for agents that need to understand table data, form structure, or list content.

```typescript
// Input schema
interface BrowserGetDomExcerptArgs {
  /** CSS selector for the root element */
  selector: string;
  /** Maximum depth of the excerpt (default: 3) */
  maxDepth?: number;
  /** Maximum character length of the HTML output (default: 2000) */
  maxLength?: number;
}

// Output
interface BrowserGetDomExcerptResult {
  /** Whether the element was found */
  found: boolean;
  /** Sanitized HTML fragment (attributes stripped except id, class, role, aria-*) */
  html?: string;
  /** Plain text content */
  text?: string;
  /** Number of descendant elements in the excerpt */
  nodeCount?: number;
  /** Whether the excerpt was truncated */
  truncated?: boolean;
}
```

**Danger level:** `safe` (read-only)  
**Idempotent:** `true`  
**MCP tool name:** `browser_get_dom_excerpt`

### 4.4 `browser_capture_region`

**Purpose:** Returns a cropped screenshot of a specific page element or viewport region, avoiding full-viewport screenshots that bloat agent context windows. Conceptually a crop from `captureVisibleTab()` — no CDP screenshot APIs.

```typescript
// Input schema
interface BrowserCaptureRegionArgs {
  /** Anchor key identifying the target element (from inspect_element) */
  anchorKey?: string;
  /** Node ref from page map (ref field) */
  nodeRef?: string;
  /** Explicit viewport-relative rectangle (fallback when no element target) */
  rect?: { x: number; y: number; width: number; height: number };
  /** Padding around the element bounding box in px (default: 8, max: 100) */
  padding?: number;
  /** JPEG quality 1–100 (default: 70, clamped to 30–85) */
  quality?: number;
}

// Output
interface BrowserCaptureRegionResult {
  /** Whether the capture succeeded */
  success: boolean;
  /** Cropped image as JPEG data URL */
  dataUrl?: string;
  /** Actual dimensions of the cropped image */
  width?: number;
  height?: number;
  /** Size of the data URL in bytes */
  sizeBytes?: number;
  /** Which input resolved the target: "anchorKey" | "nodeRef" | "rect" | "fallback" */
  source?: string;
  /** Error when success=false */
  error?: "element-not-found" | "element-off-screen" | "image-too-large"
        | "capture-failed" | "no-target";
}
```

**Hard limits:**

| Limit | Value | Rationale |
|---|---|---|
| Max output dimension | 1200 × 1200 px | Caps image area; avoids context bloat |
| Min output dimension | 10 × 10 px | Rejects degenerate zero-area rects |
| JPEG quality range | 30–85 (default 70) | Clamped to prevent bloated or unusable output |
| Max data URL size | 500 KB | Hard reject; agent should use text-based tools instead |
| Max padding | 100 px | Prevents "padding the whole page" anti-pattern |

**Failure modes:**

| Failure | Behaviour |
|---|---|
| Target element not found | `{ success: false, error: "element-not-found" }` |
| Element entirely off-screen | `{ success: false, error: "element-off-screen" }` |
| Cropped image > 500 KB | Retry once at quality −10; if still over: `{ success: false, error: "image-too-large" }` |
| `captureVisibleTab` fails | `{ success: false, error: "capture-failed" }` |
| No input provided | `{ success: false, error: "no-target" }` |
| `rect` partially off-screen | Clamp to viewport; crop what's visible |

**Implementation approach:** Content script resolves the target to viewport-relative bounds. Service worker captures `captureVisibleTab()`, then crops using `OffscreenCanvas` + `createImageBitmap`. No CDP, no new browser API surface beyond `OffscreenCanvas`.

**Danger level:** `safe` (read-only)  
**Idempotent:** `true`  
**MCP tool name:** `browser_capture_region`

---

### 4.5 Context-Budget Guidance

Agents should choose the cheapest tool that answers their question:

| Tool | Token cost | Use when |
|---|---|---|
| `browser_get_page_map` | ~200–800 tokens | Orientation: what's on the page, where elements are |
| `browser_inspect_element` | ~50–150 tokens | Need anchor key, bounds, or ARIA context for one element |
| `browser_get_dom_excerpt` | ~100–500 tokens | Need raw structure of a subtree (table, form, list) |
| `browser_capture_region` | ~1–5 KB base64 | Need *visual* context (styling, color, charts) that DOM text can't convey |
| Full viewport screenshot | ~10–50 KB base64 | Almost never — prefer `capture_region` for focused areas |

**Anti-patterns:**
- `get_page_map` with `maxNodes: 500` on every turn → use `maxNodes: 50` and drill down
- Repeated full-viewport screenshots → use `capture_region` on the element of interest
- `get_dom_excerpt` with `maxLength: 10000` → keep at default 2000
- Capturing without page map first → always orient then target

**Recommended workflow:**
1. `browser_get_page_map({ maxDepth: 3, maxNodes: 100 })` — orientation
2. `browser_inspect_element({ ref: "..." })` — get anchor key
3. (Optional) `browser_capture_region({ anchorKey: "..." })` — visual confirmation
4. `comment_create({ scope: { modality: "browser" }, anchor: { anchorKey: "..." }, body: "..." })`

---

## 5. Enhanced Anchor Model

### 5.1 Anchor Strategy Hierarchy

```typescript
/** Anchor strategies in order of stability (most stable first) */
type AnchorStrategy =
  | "id"           // element has a unique id attribute
  | "data-testid"  // element has data-testid (or data-cy, data-test)
  | "aria"         // element has aria-label + role combination
  | "css-path"     // generated CSS selector path
  | "tag-sibling"  // existing tagName:siblingIndex:textFingerprint
  | "viewport-pct" // viewport percentage (least stable)
  ;

/** Extended anchor key format */
// Format: strategy:value[@offsetX,offsetY]
// Examples:
//   "id:submit-btn"
//   "data-testid:login-form"
//   "aria:Submit/button"
//   "css:main>div:nth-child(2)>button"
//   "tag:button:3:submit@120,45"
//   "body:42%x63%"
```

### 5.2 Anchor Generation

```typescript
interface AnchorGenerationResult {
  /** The generated anchor key */
  anchorKey: string;
  /** Which strategy was used */
  strategy: AnchorStrategy;
  /** Confidence: high (id, data-testid), medium (aria, css-path), low (tag-sibling, viewport) */
  confidence: "high" | "medium" | "low";
}

/**
 * Generate the best anchor key for an element.
 * Tries strategies in order: id → data-testid → aria → css-path → tag-sibling → viewport.
 */
function generateAnchorKey(element: Element): AnchorGenerationResult;
```

### 5.3 Anchor Resolution (re-anchoring)

```typescript
/**
 * Resolve an anchor key back to a DOM element.
 * Tries the encoded strategy first, then falls back through the hierarchy.
 *
 * For example, if "css:main>div>button" doesn't match (DOM changed),
 * falls back to tag-sibling fingerprint if text content is similar.
 */
function resolveAnchorKey(anchorKey: string): Element | null;
```

### 5.4 Backward Compatibility

- Existing `tagName:siblingIndex:textFingerprint` keys (without strategy prefix) are treated as `tag-sibling` strategy
- Existing `body:XX%xYY%` keys are treated as `viewport-pct` strategy
- The `parseAnchorKey()` function in `content-anchor.ts` is extended, not replaced
- `findAnchorElementByKey()` gains a strategy-aware dispatch before the existing two-pass lookup

---

## 6. Portability Architecture

### 6.1 `CommentBackendAdapter` Interface

```typescript
/**
 * Abstracts the comment storage/sync backend.
 * Today: VS Code relay → unified comment_* tools
 * Future: standalone MCP client → Hub or local IndexedDB
 */
interface CommentBackendAdapter {
  /** List comment threads for a URL */
  listThreads(url: string): Promise<CommentThreadSummary[]>;

  /** Create a new comment thread */
  createThread(params: {
    url: string;
    anchorKey: string;
    body: string;
    authorName?: string;
    commentId?: string;
    threadId?: string;
  }): Promise<{ threadId: string; commentId: string }>;

  /** Reply to an existing thread */
  reply(params: {
    threadId: string;
    body: string;
    commentId?: string;
    authorName?: string;
  }): Promise<{ commentId: string }>;

  /** Resolve a thread */
  resolve(threadId: string, resolutionNote?: string): Promise<void>;

  /** Reopen a resolved thread */
  reopen(threadId: string): Promise<void>;

  /** Delete a thread or comment */
  delete(threadId: string, commentId?: string): Promise<void>;

  /** Check backend connectivity */
  isConnected(): boolean;
}
```

### 6.2 Adapter Implementations

```typescript
/**
 * Routes comment operations through the VS Code relay WebSocket.
 * Used when the browser extension is connected to accordo-browser.
 */
class VscodeRelayAdapter implements CommentBackendAdapter {
  constructor(private relay: RelayBridgeClient) {}
  // Delegates to relay.send() for each operation
}

/**
 * Future: Routes comment operations directly to an MCP server.
 * Used in standalone mode (no VS Code, browser extension only).
 */
class StandaloneMcpAdapter implements CommentBackendAdapter {
  constructor(private mcpClient: McpClient) {}
  // Delegates to MCP tool calls directly
}

/**
 * Fallback: Stores comments in chrome.storage.local only.
 * Used when no backend is connected (offline mode).
 */
class LocalStorageAdapter implements CommentBackendAdapter {
  // Uses existing store.ts CRUD operations
}
```

### 6.3 Adapter Selection

```typescript
/**
 * Adapter selection priority:
 * 1. VscodeRelayAdapter — if relay WebSocket is connected
 * 2. StandaloneMcpAdapter — if standalone MCP config is present (future)
 * 3. LocalStorageAdapter — always available as fallback
 *
 * Selection is dynamic: if relay disconnects, falls back to local storage.
 * When relay reconnects, sync pending local changes to backend.
 */
```

---

## 7. Module Plan

### 7.1 New Modules in `packages/browser-extension/`

| Module ID | Name | File(s) | Dependencies | Est. LOC |
|---|---|---|---|---|
| M90-MAP | Page Map Collector | `src/content/page-map-collector.ts` | DOM APIs | ~150 |
| M90-INS | Element Inspector | `src/content/element-inspector.ts` | M90-MAP, DOM APIs | ~120 |
| M90-ANC | Enhanced Anchor | `src/content/enhanced-anchor.ts` | content-anchor.ts | ~180 |
| M90-ACT | Relay Actions (page understanding) | `src/relay-actions.ts` (extend) | M90-MAP, M90-INS | ~80 |
| M90-ADP | CommentBackendAdapter | `src/adapters/comment-backend.ts` | relay-bridge.ts, store.ts | ~100 |
| M92-CR | Region Capture | `src/content/region-capture.ts` | DOM APIs, OffscreenCanvas | ~120 |

### 7.2 New/Modified Modules in `packages/browser/`

| Module ID | Name | File(s) | Dependencies | Est. LOC |
|---|---|---|---|---|
| M91-PU | Page Understanding Tools | `src/page-understanding-tools.ts` | relay, BridgeAPI | ~160 |
| M91-CR | Capture Region MCP Tool | `src/page-understanding-tools.ts` (extend) | relay, BridgeAPI | ~40 |
| M91-EXT | Extension Wiring (extend) | `src/extension.ts` (modify) | M91-PU, M91-CR | ~40 |

### 7.3 Modified Existing Modules

| Module | File(s) | Changes |
|---|---|---|
| content-anchor.ts | `packages/browser-extension/src/content-anchor.ts` | Add strategy-aware parsing, extend `findAnchorElementByKey()` |
| relay-actions.ts | `packages/browser-extension/src/relay-actions.ts` | Add `get_page_map`, `inspect_element`, `get_dom_excerpt`, `capture_region` actions |
| types.ts | `packages/browser/src/types.ts` | Add new `BrowserRelayAction` values (including `capture_region`) |
| extension.ts | `packages/browser/src/extension.ts` | Register 4 MCP tools (3 page understanding + 1 capture region), handle new relay actions |

### 7.4 Requirement-to-Module Traceability

| Module | Functional Reqs | Non-Functional Reqs |
|---|---|---|
| M90-MAP | PU-F-01 through PU-F-06 | PU-NF-01, PU-NF-02 |
| M90-INS | PU-F-10 through PU-F-15 | PU-NF-01, PU-NF-03 |
| M90-ANC | PU-F-20 through PU-F-26 | PU-NF-04 |
| M90-ACT | PU-F-30 through PU-F-33 | PU-NF-01 |
| M90-ADP | PU-F-40 through PU-F-45 | PU-NF-05 |
| M91-PU | PU-F-50 through PU-F-55 | PU-NF-01, PU-NF-06 |
| M91-EXT | PU-F-56, PU-F-57 | PU-NF-06 |

---

## 8. Risks and Mitigations

| Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|
| Page map too large for agent context | Agent cannot reason about full page | High | `maxNodes` + `maxDepth` limits; `viewportOnly` filter; `truncated` flag signals need for drill-down |
| Dynamic pages change between map and comment | Comment lands on wrong element | Medium | Re-validate anchor at comment creation time; return error if element not found |
| CSS selector generation is fragile | Anchor breaks on minor DOM changes | Medium | CSS selector is tier 4 of 6; prefer id/data-testid/aria when available |
| Relay latency for DOM queries | Slow agent workflow | Low | DOM queries are fast (<50ms); relay overhead is constant (~10ms) |
| Content script size increase | Extension load time | Low | New modules are focused and small (~450 LOC total in content script) |

---

## 9. Open Questions

1. **~~Should `browser_capture_region` be included?~~** **RESOLVED — YES.** A tool to capture a screenshot of a specific element or region (not full viewport). Implemented as crop-from-viewport-screenshot (no CDP complexity). See `docs/architecture.md` §14.5. Input: `anchorKey | nodeRef | rect`, optional `padding`, `quality`. Output: cropped JPEG data URL + metadata. Hard limits: 1200×1200 px max, 500 KB byte cap. Module: M92-CR.

2. **Should page map include `<script>` and `<style>` elements?** These are not user-visible. **Recommendation:** Exclude `<script>`, `<style>`, `<noscript>`, `<template>`, and hidden elements by default.

3. **Should enhanced anchors be used for human-created comments too?** Today, human comments use the existing `tagName:siblingIndex:textFingerprint` format. **Recommendation:** Yes — apply enhanced anchoring to all new comments, regardless of creator. Existing comments retain their current format.

4. **MCP tool naming:** Should tools be `browser_get_page_map` or `browser_page_map`? **Recommendation:** Use verb prefix (`get`/`inspect`) for consistency with existing `comment_list`, `comment_get`, `comment_create` naming.

---

## 10. Future Extension: Visual Annotation Layer

> **Architectural reservation — not in current scope.** See `docs/architecture.md` §15 for the full design.

The page understanding infrastructure (DOM tree walking, element inspection, enhanced anchor strategy, relay transport) is intentionally designed to serve as the foundation for a future **visual annotation layer**. In this future capability, agents would visually mark page elements (lines, rectangles, circles, highlights, callouts) during conversation, making the page interactive for collaborative discussion.

### 10.1 How This Architecture Supports Annotations

| Page Understanding Component | Annotation Reuse |
|---|---|
| Enhanced anchor strategy (§5) | Annotation primitives anchor to elements using the same `anchorKey` format and `resolveAnchorKey()` resolution |
| `browser_inspect_element` tool | Agent uses this to identify target elements before calling `browser_add_annotation` |
| Relay transport path | Annotation tools (`browser_add_annotation`, `browser_update_annotation`, `browser_remove_annotation`, `browser_list_annotations`) follow the same Chrome relay → `accordo-browser` → Bridge path |
| Content script architecture | A second overlay `<div>` (with SVG root) renders annotation shapes alongside the existing pin container |
| `CommentBackendAdapter` pattern (§6) | An `AnnotationBackendAdapter` follows the same adapter pattern, enabling standalone MCP operation without VS Code |

### 10.2 Portability Note — Standalone MCP Server

The `CommentBackendAdapter` interface (§6.1) and the `StandaloneMcpAdapter` concept extend naturally to annotations. When the Hub runs as a standalone MCP server (no VS Code, no Bridge):

- **Page understanding tools** can be served by a standalone browser extension connecting directly to Hub via MCP
- **Annotation tools** (future) would use the same standalone path — the browser extension renders annotations locally and syncs state via `AnnotationBackendAdapter`
- The adapter selection logic (§6.3) generalises: relay adapter when connected to VS Code, standalone MCP adapter when connected to Hub directly, local-only adapter when offline

This ensures that neither comments nor annotations are architecturally locked to the VS Code relay path.
