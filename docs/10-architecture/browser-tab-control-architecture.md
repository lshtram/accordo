# Browser Tab Control — Architecture Design

**Status:** REVISED — Phase A design (post-review, all 3 blocking issues resolved)  
**Date:** 2026-04-01  
**Scope:** Agent-controlled browser navigation and interaction via Chrome DevTools Protocol  
**Depends on:** [`architecture.md`](architecture.md) §14, [`browser2.0-architecture.md`](browser2.0-architecture.md), [`browser-extension-architecture.md`](browser-extension-architecture.md)  
**Packages:** `packages/browser/` (Hub-side), `packages/browser-extension/` (Chrome extension)

---

## 1. Vision

### 1.1 Non-Technical Summary

**What problem does it solve?** Today, AI agents can *see* what's on a web page (read the DOM, take screenshots, wait for elements) but they cannot *do* anything — they can't click buttons, type into forms, navigate to URLs, or press keyboard shortcuts. This module gives agents the ability to interact with a user's browser tab, under explicit user control.

**What does it do?** It adds four new tools — `browser_navigate`, `browser_click`, `browser_type`, and `browser_press_key` — that let agents control a Chrome tab. Before any control action works, the user must explicitly grant permission via a toggle in the Chrome extension popup. A visible badge on the extension icon shows when a tab is under agent control.

**What can go wrong?** The main risks are: (a) the user doesn't understand that an agent is controlling their tab — mitigated by the mandatory permission gate and visible badge, (b) Chrome shows an intrusive "debugging" banner when `chrome.debugger` attaches — mitigated by clear UX guidance, (c) the agent performs unintended actions on the wrong tab — mitigated by tab-scoped permission and explicit `tabId` targeting.

**How do we know it works?** Each tool has a specific acceptance test: navigate must change the tab URL, click must trigger the target element's click handler, type must fill input fields, press_key must dispatch key events. Permission denial must return a structured `"control-not-granted"` error.

### 1.2 Technical Summary

This module extends the existing browser relay architecture with four new `BrowserRelayAction` values that route through the established Hub → Bridge → WebSocket → Service Worker path. The service worker uses Chrome's `chrome.debugger` API (not `--remote-debugging-port`) to attach to the target tab and send CDP (Chrome DevTools Protocol) commands for navigation and input synthesis.

A permission layer (`control-permission.ts`) gates every control action — the user must explicitly grant control per tab via the extension popup. A debugger lifecycle manager (`debugger-manager.ts`) handles `chrome.debugger.attach/detach` with cleanup on tab close or permission revocation.

**Key design decisions:**
- **`chrome.debugger` over content script injection:** Content scripts cannot synthesize trusted input events (browsers intentionally block `new MouseEvent()` from triggering form submission or navigation). CDP's `Input.dispatchMouseEvent` and `Input.dispatchKeyEvent` produce trusted events at the browser engine level.
- **Per-tab permission, not global:** Limits blast radius. An agent can only interact with tabs the user has explicitly approved.
- **Attach-on-first-use:** The debugger is not attached when permission is granted — it attaches lazily on the first control action. This avoids the Chrome debugging banner until the agent actually needs control.
- **All four tools are `moderate` danger level:** They mutate page state (navigation, clicks, typing). This is a step above `safe` (read-only tools) but below `destructive`.

---

## 2. Architecture Diagram

```
                    ┌─────────────┐
                    │  MCP Agent  │
                    └──────┬──────┘
                           │ MCP (stdio/SSE)
                    ┌──────┴──────┐
                    │ accordo-hub │
                    │  (MCP srv)  │
                    └──────┬──────┘
                           │ BridgeAPI
                    ┌──────┴──────┐
                    │accordo-     │
                    │bridge       │
                    └──────┬──────┘
                           │ registerTools()
                    ┌──────┴──────┐
                    │ accordo-    │
                    │ browser     │          New tools:
                    │ (relay srv) │          browser_navigate
                    │             │          browser_click
                    └──────┬──────┘          browser_type
                           │ WebSocket       browser_press_key
                           │ relay
                    ┌──────┴──────┐
                    │ Chrome ext  │
                    │ service     │
                    │ worker      │
                    │ ┌─────────┐ │
                    │ │ Control │ │  ← NEW
                    │ │Permission│ │  (grant/revoke per tab)
                    │ ├─────────┤ │
                    │ │Debugger │ │  ← NEW
                    │ │ Manager │ │  (attach/detach lifecycle)
                    │ ├─────────┤ │
                    │ │ Control │ │  ← NEW
                    │ │ Handlers│ │  (navigate, click, type, press_key)
                    │ └─────────┘ │
                    └──────┬──────┘
                           │ chrome.debugger
                           │ .sendCommand()
                    ┌──────┴──────┐
                    │ Chrome Tab  │  (CDP: Page.navigate,
                    │             │   Input.dispatchMouseEvent,
                    └─────────────┘   Input.dispatchKeyEvent,
                                      Input.insertText)
```

### 2.1 Data Flow (browser_click example)

1. **Agent** calls MCP tool `browser_click` with `{ uid: "btn-submit" }`.
2. **Hub** routes to Bridge via existing protocol.
3. **Bridge** dispatches to `accordo-browser` extension's registered handler.
4. **`control-tools.ts`** handler validates args, calls `relay.request("click", payload, timeoutMs)`.
5. **Relay server** forwards via WebSocket to Chrome extension service worker.
6. **Service worker** receives `RelayActionRequest` with `action: "click"`.
7. **`relay-actions.ts`** dispatch switch routes to `handleClick()` in `relay-control-handlers.ts`.
8. **`handleClick()`** checks permission via `controlPermission.isGranted(tabId)`.
   - If denied → returns `{ success: false, error: "control-not-granted" }`.
9. **`handleClick()`** ensures debugger is attached via `debuggerManager.ensureAttached(tabId)` (with MV3 recovery — §5.2).
10. **`handleClick()`** resolves element coordinates via `chrome.tabs.sendMessage(tabId, { type: "RESOLVE_ELEMENT_COORDS", uid: "btn-submit" })` (§5.5).
11. If `inViewport: false`, sends `DOM.scrollIntoViewIfNeeded` via CDP.
12. **`handleClick()`** sends CDP commands via `chrome.debugger.sendCommand()`:
    - `Input.dispatchMouseEvent` (type: `mouseMoved`, x, y)
    - `Input.dispatchMouseEvent` (type: `mousePressed`, button: `left`, clickCount: 1, x, y)
    - `Input.dispatchMouseEvent` (type: `mouseReleased`, button: `left`, clickCount: 1, x, y)
13. **Response** flows back: handler → `RelayActionResponse` → WebSocket → relay server → tool handler → MCP response.

---

## 3. New Tool Definitions

### 3.1 `browser_navigate`

Navigate a tab to a URL, or go back/forward/reload.

```typescript
/** Input for browser_navigate */
export interface NavigateArgs {
  /** B2-CTX-001: Optional tab ID to target; omit for active tab */
  tabId?: number;
  /** Navigation type. Default: "url" */
  type?: "url" | "back" | "forward" | "reload";
  /** Target URL (required when type is "url") */
  url?: string;
  /** Maximum wait time for navigation in ms (default: 15000, max: 30000) */
  timeout?: number;
}

/** Response from browser_navigate */
export interface NavigateResponse {
  success: boolean;
  /** Final URL after navigation */
  url?: string;
  /** Page title after navigation */
  title?: string;
  error?: "control-not-granted" | "invalid-url" | "navigation-failed"
    | "timeout" | "browser-not-connected";
}
```

**MCP tool registration:**
```typescript
{
  name: "browser_navigate",
  description: "Go to a URL, or back, forward, or reload. " +
    "Requires user-granted control permission on the target tab.",
  inputSchema: {
    type: "object",
    properties: {
      tabId: {
        type: "number",
        description: "B2-CTX-001: Optional tab ID to target; omit for active tab",
      },
      type: {
        type: "string",
        enum: ["url", "back", "forward", "reload"],
        description: "Navigation type. Default: 'url'",
      },
      url: {
        type: "string",
        description: "Target URL (required when type is 'url')",
      },
      timeout: {
        type: "number",
        description: "Maximum wait time for navigation in ms (default: 15000, max: 30000).",
      },
    },
  },
  dangerLevel: "moderate",
  idempotent: false,
}
```

**CDP commands used:**
- `Page.navigate` — for `type: "url"`
- `Page.goBackInHistory` / `Page.goForwardInHistory` — for `type: "back"` / `"forward"`
- `Page.reload` — for `type: "reload"`
- Wait for `Page.loadEventFired` or timeout.

---

### 3.2 `browser_click`

Click on an element identified by `uid` (from a page snapshot), CSS selector, or explicit coordinates.

```typescript
/** Input for browser_click */
export interface ClickArgs {
  /** B2-CTX-001: Optional tab ID to target; omit for active tab */
  tabId?: number;
  /** Element UID from a page snapshot (primary identifier) */
  uid?: string;
  /** CSS selector to find the element (alternative to uid) */
  selector?: string;
  /** Explicit viewport coordinates to click (alternative to uid/selector) */
  coordinates?: { x: number; y: number };
  /** Whether to double-click. Default: false */
  dblClick?: boolean;
}

/** Response from browser_click */
export interface ClickResponse {
  success: boolean;
  /** What was clicked (uid, selector, or coordinates) */
  target?: string;
  error?: "control-not-granted" | "element-not-found" | "element-off-screen"
    | "no-target" | "browser-not-connected" | "timeout" | "action-failed";
}
```

**MCP tool registration:**
```typescript
{
  name: "browser_click",
  description: "Click on a page element identified by uid (from snapshot), " +
    "CSS selector, or explicit coordinates. " +
    "Requires user-granted control permission on the target tab.",
  inputSchema: {
    type: "object",
    properties: {
      tabId: {
        type: "number",
        description: "B2-CTX-001: Optional tab ID to target; omit for active tab",
      },
      uid: {
        type: "string",
        description: "Element UID from a page snapshot (from take_snapshot or get_page_map)",
      },
      selector: {
        type: "string",
        description: "CSS selector to find the element (alternative to uid)",
      },
      coordinates: {
        type: "object",
        properties: {
          x: { type: "number" },
          y: { type: "number" },
        },
        required: ["x", "y"],
        description: "Explicit viewport coordinates to click",
      },
      dblClick: {
        type: "boolean",
        description: "Set to true for double clicks. Default: false",
      },
    },
  },
  dangerLevel: "moderate",
  idempotent: false,
}
```

**CDP commands used:**
1. **Resolve coordinates:** If `uid` or `selector` is provided, resolve to viewport coordinates via the content script `RESOLVE_ELEMENT_COORDS` message (see §5.5 below). If `coordinates` is provided, use directly.
2. **Scroll into view:** Send `DOM.scrollIntoViewIfNeeded` via CDP to ensure the element is visible before clicking. (Closes Open Question 3.)
3. **Click sequence:**
   - `Input.dispatchMouseEvent` — `type: "mouseMoved"`, x, y
   - `Input.dispatchMouseEvent` — `type: "mousePressed"`, button: `"left"`, clickCount: 1, x, y
   - `Input.dispatchMouseEvent` — `type: "mouseReleased"`, button: `"left"`, clickCount: 1, x, y
4. **For `dblClick: true`**, send the correct double-click CDP sequence:
   - `Input.dispatchMouseEvent` — `type: "mouseMoved"`, x, y
   - `Input.dispatchMouseEvent` — `type: "mousePressed"`, button: `"left"`, clickCount: 1, x, y
   - `Input.dispatchMouseEvent` — `type: "mouseReleased"`, button: `"left"`, clickCount: 1, x, y
   - `Input.dispatchMouseEvent` — `type: "mousePressed"`, button: `"left"`, clickCount: 2, x, y
   - `Input.dispatchMouseEvent` — `type: "mouseReleased"`, button: `"left"`, clickCount: 2, x, y

---

### 3.3 `browser_type`

Type text into a focused or specified input element.

```typescript
/** Input for browser_type */
export interface TypeArgs {
  /** B2-CTX-001: Optional tab ID to target; omit for active tab */
  tabId?: number;
  /** Text to type into the element */
  text: string;
  /** Element UID to focus before typing (from snapshot) */
  uid?: string;
  /** CSS selector to focus before typing (alternative to uid) */
  selector?: string;
  /** Whether to clear existing content before typing. Default: false */
  clearFirst?: boolean;
  /** Optional key to press after typing (e.g., "Enter", "Tab") */
  submitKey?: string;
}

/** Response from browser_type */
export interface TypeResponse {
  success: boolean;
  error?: "control-not-granted" | "element-not-found" | "element-not-focusable"
    | "no-target" | "browser-not-connected" | "timeout" | "action-failed";
}
```

**MCP tool registration:**
```typescript
{
  name: "browser_type",
  description: "Type text into a focused or specified input element. " +
    "Optionally focus an element first by uid or CSS selector. " +
    "Requires user-granted control permission on the target tab.",
  inputSchema: {
    type: "object",
    properties: {
      tabId: {
        type: "number",
        description: "B2-CTX-001: Optional tab ID to target; omit for active tab",
      },
      text: {
        type: "string",
        description: "The text to type",
      },
      uid: {
        type: "string",
        description: "Element UID to focus before typing (from snapshot)",
      },
      selector: {
        type: "string",
        description: "CSS selector to focus before typing (alternative to uid)",
      },
      clearFirst: {
        type: "boolean",
        description: "Clear existing content before typing. Default: false",
      },
      submitKey: {
        type: "string",
        description: 'Optional key to press after typing (e.g., "Enter", "Tab")',
      },
    },
    required: ["text"],
  },
  dangerLevel: "moderate",
  idempotent: false,
}
```

**CDP commands used:**
1. **Focus element** (if `uid` or `selector` provided): Resolve element via content script `RESOLVE_ELEMENT_COORDS` message (see §5.5), then use `Runtime.evaluate` through the debugger session to call `.focus()` on the resolved element.
2. **Clear existing content** (if `clearFirst: true`): `Input.dispatchKeyEvent` with `Control+A` then `Delete`.
3. **Type text:** `Input.insertText` — inserts the full string at once (handles Unicode, emoji, special characters).
4. **Submit key** (if `submitKey` provided): `Input.dispatchKeyEvent` with `keyDown` + `keyUp` for the specified key.

---

### 3.4 `browser_press_key`

Press a key or key combination (e.g., `Enter`, `Escape`, `Control+A`, `Control+Shift+R`).

```typescript
/** Input for browser_press_key */
export interface PressKeyArgs {
  /** B2-CTX-001: Optional tab ID to target; omit for active tab */
  tabId?: number;
  /** Key or key combination (e.g., "Enter", "Control+A", "Control+Shift+R") */
  key: string;
}

/** Response from browser_press_key */
export interface PressKeyResponse {
  success: boolean;
  /** The key that was pressed (echoed back) */
  key?: string;
  error?: "control-not-granted" | "invalid-key" | "browser-not-connected"
    | "timeout" | "action-failed";
}
```

**MCP tool registration:**
```typescript
{
  name: "browser_press_key",
  description: "Press a key or key combination. Supports modifiers: " +
    'Control, Shift, Alt, Meta. Examples: "Enter", "Control+A", "Control+Shift+R". ' +
    "Requires user-granted control permission on the target tab.",
  inputSchema: {
    type: "object",
    properties: {
      tabId: {
        type: "number",
        description: "B2-CTX-001: Optional tab ID to target; omit for active tab",
      },
      key: {
        type: "string",
        description: 'Key or key combination (e.g., "Enter", "Control+A", "Control+Shift+R"). ' +
          "Modifiers: Control, Shift, Alt, Meta",
      },
    },
    required: ["key"],
  },
  dangerLevel: "moderate",
  idempotent: false,
}
```

**CDP commands used:**
1. **Parse key combination:** Split on `+` to extract modifiers (`Control`, `Shift`, `Alt`, `Meta`) and the base key.
2. **Compute modifier bitmask:** Build the CDP `modifiers` bitmask field: Alt=1, Control=2, Meta=4, Shift=8. This bitmask must be set on **all** key events (modifier and base key) so the browser engine correctly interprets the combination (e.g., `Control+A` sends `A` with `modifiers: 2`).
3. **Modifier press:** For each modifier, send `Input.dispatchKeyEvent` with `type: "rawKeyDown"` and the current modifiers bitmask.
4. **Base key press:** `Input.dispatchKeyEvent` with `type: "keyDown"` (with full modifiers bitmask) then `type: "keyUp"`.
5. **Modifier release:** For each modifier (reverse order), send `Input.dispatchKeyEvent` with `type: "keyUp"` and decreasing modifiers bitmask.

Key code mapping uses a lookup table from key names (`"Enter"`, `"Tab"`, `"Escape"`, `"ArrowUp"`, etc.) to CDP `key`, `code`, `windowsVirtualKeyCode`, and `nativeVirtualKeyCode` values.

---

## 4. Permission State Machine

### 4.1 State Model

Permission is a simple per-tab boolean: **Denied** (default) or **Granted**.

```typescript
/**
 * Per-tab control permission state.
 *
 * Uses chrome.storage.session (session-scoped, not persisted across
 * browser restarts) to store granted tab IDs. Session storage is
 * preferred over local storage because control grants should not
 * survive browser restarts — the user should re-grant after restart.
 */
interface ControlPermissionState {
  /** Tab IDs that have been granted control */
  grantedTabs: number[];
}
```

### 4.2 State Transitions

```
                    ┌──────────┐
         ┌──────── │  DENIED  │ ◄─────────────┐
         │         │ (default)│                │
         │         └────┬─────┘                │
         │              │                      │
         │     User clicks "Grant              │
         │     Control" in popup               │
         │              │                      │
         │              ▼                      │
         │         ┌──────────┐         User clicks "Revoke
         │         │ GRANTED  │         Control" in popup
         │         │          │ ───────────────┘
         │         └────┬─────┘
         │              │
         │         Tab is closed
         │         (chrome.tabs.onRemoved)
         │              │
         └──────────────┘
```

| From | To | Trigger | Side Effects |
|---|---|---|---|
| DENIED | GRANTED | User clicks "Grant Control" in popup | Store tabId in `chrome.storage.session`; set badge |
| GRANTED | DENIED | User clicks "Revoke Control" in popup | Remove tabId from storage; detach debugger if attached; clear badge |
| GRANTED | DENIED | Tab is closed (`chrome.tabs.onRemoved`) | Remove tabId from storage; debugger auto-detaches |
| GRANTED | DENIED | Browser restarts | Session storage clears automatically |

### 4.3 Badge Management

When a tab has control granted:
- **Badge text:** `"CTL"` (3 characters, fits Chrome badge)
- **Badge color:** `#FF6600` (orange — distinct from the existing comment-mode badge)
- Uses `chrome.action.setBadgeText({ text: "CTL", tabId })` and `chrome.action.setBadgeBackgroundColor({ color: "#FF6600", tabId })`

When control is revoked:
- Clear the badge: `chrome.action.setBadgeText({ text: "", tabId })`

**Coexistence with Comments Mode badge:** The badge is tab-scoped via `tabId` parameter. If Comments Mode has its own badge on a different tab, they don't conflict. If both apply to the same tab, the control badge takes precedence (it indicates a more important state — the agent is actively controlling the tab).

---

## 5. CDP Command Routing Design

### 5.1 Debugger Manager (`debugger-manager.ts`)

The debugger manager is responsible for the `chrome.debugger` attach/detach lifecycle.

```typescript
/**
 * Manages chrome.debugger attachment lifecycle.
 *
 * Key responsibilities:
 * - Lazy attach: debugger attaches on first control action, not on permission grant
 * - Auto-detach: on permission revoke or tab close
 * - Single attachment: one chrome.debugger session per tab
 * - Protocol version: uses CDP protocol version "1.3"
 * - MV3 recovery: handles service worker restart by detecting
 *   "Another debugger is already attached" and recovering the session
 *   (see §5.2 for full recovery flow)
 */

/**
 * Ensure the debugger is attached to the given tab. No-op if already attached.
 *
 * MV3 recovery: If the service worker restarted and Chrome still has
 * a debugger session from the previous instance, catch the
 * "Another debugger is already attached" error and treat it as
 * a successful attach — add tabId to the internal Set and proceed.
 *
 * @throws Error with message "unsupported-page" if the tab cannot
 *   be attached to (chrome://, devtools://, etc.)
 */
export async function ensureAttached(tabId: number): Promise<void>;

/** Detach the debugger from a tab. No-op if not attached. */
export async function detach(tabId: number): Promise<void>;

/** Detach all active debugger sessions. Called on extension unload. */
export async function detachAll(): Promise<void>;

/** Check if the debugger is currently attached to a tab (in-memory tracking). */
export function isAttached(tabId: number): boolean;

/**
 * Send a CDP command to a tab's debugger session.
 * Throws if the debugger is not attached.
 */
export async function sendCommand<T>(
  tabId: number,
  method: string,
  params?: Record<string, unknown>,
): Promise<T>;
```

### 5.2 Attachment Flow (with MV3 Service Worker Recovery)

MV3 service workers are terminated by Chrome after ~30 seconds of inactivity. The `Set<number>` of attached tab IDs in `debugger-manager.ts` is lost on termination, but Chrome's debugger sessions persist at the browser level. On service worker restart, `isAttached()` returns `false` for tabs where Chrome still has an active debugger session, and a naive `chrome.debugger.attach()` throws `"Another debugger is already attached to the tab"`.

**Recovery strategy:** Wrap `chrome.debugger.attach()` in a try/catch. If the error message contains `"Another debugger is already attached"`, treat this as a successful attach — the debugger session from the previous SW instance is still active and usable. Add the `tabId` to the internal Set as if the attach succeeded. This is preferable to using `chrome.storage.session` for debugger state because: (a) the actual Chrome-level debugger state is the single source of truth, and (b) storage-based tracking would still drift if the debugger is detached externally (e.g., another DevTools session).

```
1. Control action arrives (e.g., handleClick)
2. Check controlPermission.isGranted(tabId) → must be true
3. Call debuggerManager.ensureAttached(tabId)
   a. If already in internal Set → no-op, return
   b. If not in internal Set:
      try {
        chrome.debugger.attach({ tabId }, "1.3")
        // Success: fresh attach
        Store tabId in internal Set<number>
        Register chrome.debugger.onDetach listener for this tab
      } catch (error) {
        if (error.message includes "Another debugger is already attached") {
          // Recovery: SW restarted but Chrome kept the session alive
          Store tabId in internal Set<number>
          Register chrome.debugger.onDetach listener for this tab
          // The session is usable — proceed normally
        } else if (error.message includes "Cannot attach to this target") {
          // Chrome internal page (chrome://, devtools://) — not attachable
          throw new Error("unsupported-page")
        } else {
          throw error  // Unknown error — propagate
        }
      }
4. Send CDP command via chrome.debugger.sendCommand()
5. Return result
```

**Verification:** After recovery, the handler sends the CDP command immediately. If the recovered session is somehow stale (e.g., tab was navigated to a `chrome://` page while SW was asleep), `chrome.debugger.sendCommand()` will throw, and the error is returned to the agent as `"action-failed"`. This is the correct behavior — the session was invalid, not just our tracking.

### 5.3 Detachment Triggers

| Trigger | Action |
|---|---|
| Permission revoked via popup | `debuggerManager.detach(tabId)` |
| Tab closed (`chrome.tabs.onRemoved`) | Clean up internal state (Chrome auto-detaches) |
| User clicks "Cancel" on Chrome's debugging bar | `chrome.debugger.onDetach` fires → clean up internal state, remove from permission |
| Extension unloaded | `debuggerManager.detachAll()` |

### 5.4 Chrome Debugging Banner

When `chrome.debugger.attach()` is called, Chrome displays an information bar: *"[Extension name] has started debugging this tab."* with a "Cancel" button. This is a Chrome security feature and **cannot be suppressed**.

**UX guidance:** The popup's "Grant Control" section should include a note: *"Chrome will show a debugging banner on controlled tabs. This is normal and expected."*

If the user clicks "Cancel" on the banner, `chrome.debugger.onDetach` fires with `reason: "canceled_by_user"`. The debugger manager handles this by:
1. Removing the tab from the attached set.
2. Removing the tab from control permission (auto-revoke).
3. Clearing the badge.

### 5.5 Element Resolution via Content Script (`RESOLVE_ELEMENT_COORDS`)

Control actions `browser_click` and `browser_type` need to resolve a `uid` (from a page snapshot) or CSS `selector` to viewport coordinates. The content script already has the infrastructure for this — `getElementByRef()` in `page-map-traversal.ts` resolves `ref` strings from the most recent page map, and `resolveAnchorKey()` in `enhanced-anchor.ts` resolves anchor keys to DOM elements. The existing `RESOLVE_ANCHOR_BOUNDS` message handler (in `content/message-handlers.ts`, line 100) resolves `anchorKey`/`nodeRef` to a bounding box but returns bounds suitable for screenshot capture (includes `scrollY` offset and padding), not the viewport center coordinates needed for CDP click/type.

**Design decision:** Add a new content script message type `RESOLVE_ELEMENT_COORDS` to the existing `message-handlers.ts` file. This keeps all message handling in one place (consistent with the existing pattern) and avoids creating a new content script file.

#### Message Contract

**Request** (service worker → content script via `chrome.tabs.sendMessage`):

```typescript
interface ResolveElementCoordsRequest {
  type: "RESOLVE_ELEMENT_COORDS";
  /** Element identifier — uid/ref from a page map snapshot */
  uid?: string;
  /** CSS selector — alternative to uid */
  selector?: string;
}
```

**Response** (content script → service worker):

```typescript
/** Success response */
interface ResolveElementCoordsSuccess {
  /** Center X coordinate in viewport pixels */
  x: number;
  /** Center Y coordinate in viewport pixels */
  y: number;
  /** Full bounding box for scroll-into-view decisions */
  bounds: { x: number; y: number; width: number; height: number };
  /** Whether the element is currently visible in the viewport */
  inViewport: boolean;
}

/** Error response */
interface ResolveElementCoordsError {
  error: "no-identifier" | "not-found" | "zero-size";
}
```

#### Resolution Logic (inside `message-handlers.ts`)

```
1. If uid is provided:
   a. Try getElementByRef(uid) from page-map-traversal.ts
   b. If not found, try resolveAnchorKey(uid) from enhanced-anchor.ts
   c. If still not found → return { error: "not-found" }
2. If selector is provided:
   a. document.querySelector(selector)
   b. If not found → return { error: "not-found" }
3. If neither uid nor selector → return { error: "no-identifier" }
4. Get bounding rect: element.getBoundingClientRect()
5. If width === 0 && height === 0 → return { error: "zero-size" }
6. Compute center: x = rect.left + rect.width / 2, y = rect.top + rect.height / 2
7. Check inViewport: x >= 0 && y >= 0 && x <= window.innerWidth && y <= window.innerHeight
8. Return { x, y, bounds: { x: rect.left, y: rect.top, width: rect.width, height: rect.height }, inViewport }
```

#### Usage from `relay-control-handlers.ts`

The `handleClick()` and `handleType()` handlers call `chrome.tabs.sendMessage(tabId, { type: "RESOLVE_ELEMENT_COORDS", uid, selector })` to get viewport coordinates. If the response contains `inViewport: false`, the handler sends `DOM.scrollIntoViewIfNeeded` via CDP before proceeding with the click/type sequence.

**Why not use `Runtime.evaluate` through the debugger?** The content script already maintains the `refIndex` map from the most recent `collectPageMap()` call. Using `Runtime.evaluate` through CDP would require re-implementing the ref lookup logic in an injected script string, which is fragile and duplicates code. The content script message is the correct abstraction.

---

## 6. Approval UX Design (Popup ↔ Service Worker)

### 6.1 Popup UI Additions

The extension popup gets a new section above the comments section:

```
┌──────────────────────────────────┐
│  🤖 Agent Control                │
│                                  │
│  Tab: "GitHub - accordo"         │
│  Status: ● Not Controlled        │
│                                  │
│  [ Grant Control ]               │
│                                  │
│  ⓘ Chrome will show a debugging  │
│    banner on controlled tabs.    │
└──────────────────────────────────┘
```

When control is granted:

```
┌──────────────────────────────────┐
│  🤖 Agent Control                │
│                                  │
│  Tab: "GitHub - accordo"         │
│  Status: ● Controlled (active)   │
│                                  │
│  [ Revoke Control ]              │
│                                  │
│  Agent can navigate, click,      │
│  type, and press keys.           │
└──────────────────────────────────┘
```

### 6.2 Popup ↔ Service Worker Messages

Two new message types added to `MESSAGE_TYPES`:

```typescript
// In constants.ts
export const MESSAGE_TYPES = {
  // ... existing ...
  GRANT_TAB_CONTROL: "GRANT_TAB_CONTROL",
  REVOKE_TAB_CONTROL: "REVOKE_TAB_CONTROL",
  GET_TAB_CONTROL_STATUS: "GET_TAB_CONTROL_STATUS",
} as const;
```

| Message | Direction | Payload | Response |
|---|---|---|---|
| `GRANT_TAB_CONTROL` | Popup → SW | `{ tabId: number }` | `{ success: boolean }` |
| `REVOKE_TAB_CONTROL` | Popup → SW | `{ tabId: number }` | `{ success: boolean }` |
| `GET_TAB_CONTROL_STATUS` | Popup → SW | `{ tabId: number }` | `{ granted: boolean }` |

The service worker's `createHandleMessage()` in `sw-router.ts` adds cases for these three message types, delegating to `controlPermission.grant()`, `controlPermission.revoke()`, and `controlPermission.isGranted()`.

---

## 7. Message Protocol Additions

### 7.1 New Relay Actions

**Type governance (see DEC-008):** `packages/browser/src/types.ts` is the **source of truth** for the relay action union. `packages/browser-extension/src/relay-definitions.ts` must mirror it exactly. Before adding new actions, the pre-existing divergence must be reconciled:

| Action | `BrowserRelayAction` (types.ts) | `RelayAction` (relay-definitions.ts) | Resolution |
|---|---|---|---|
| `"get_comments_version"` | ✅ Present (line 6) | ❌ Missing | Add to `RelayAction` |

**Pre-requisite for Phase B:** Add `"get_comments_version"` to the `RelayAction` union in `relay-definitions.ts` before adding any new actions. This is a one-line fix that brings the two unions back into sync.

Four new values added to **both** `BrowserRelayAction` (in `packages/browser/src/types.ts`) and `RelayAction` (in `packages/browser-extension/src/relay-definitions.ts`):

```typescript
// packages/browser/src/types.ts — source of truth
export type BrowserRelayAction =
  | /* existing 20 actions (including "get_comments_version") */
  | "navigate"
  | "click"
  | "type"
  | "press_key";

// packages/browser-extension/src/relay-definitions.ts — must mirror exactly
export type RelayAction =
  | /* existing 19 actions + "get_comments_version" reconciled */
  | "navigate"
  | "click"
  | "type"
  | "press_key";
```

Both unions must have exactly 24 members after this change (20 existing + reconciled `get_comments_version` + 4 new).

### 7.2 New Error Codes

Two new error codes added to `BrowserRelayResponse.error` and `RelayActionResponse.error`:

```typescript
// In packages/browser/src/types.ts (BrowserRelayResponse.error)
error?: /* existing codes */ | "control-not-granted" | "unsupported-page";

// In packages/browser-extension/src/relay-definitions.ts (RelayActionResponse.error)
error?: /* existing codes */ | "control-not-granted" | "unsupported-page";
```

- `"control-not-granted"` — the user has not granted agent control on the target tab.
- `"unsupported-page"` — the tab is a Chrome internal page (`chrome://`, `devtools://`, etc.) that cannot be attached to via `chrome.debugger`. (Closes Open Question 2.)

### 7.3 Timeout Constants

```typescript
/** Navigate can take time for page load (default: 15s, max: 30s) */
export const NAVIGATE_TIMEOUT_MS = 15_000;
export const NAVIGATE_MAX_TIMEOUT_MS = 30_000;
/** Relay must exceed max timeout */
export const NAVIGATE_RELAY_TIMEOUT_MS = 35_000;

/** Click, type, press_key are fast CDP commands */
export const CONTROL_ACTION_TIMEOUT_MS = 5_000;
```

---

## 8. Source Files — Create and Modify

### 8.1 New Files to Create

| File | Package | Purpose |
|---|---|---|
| `src/control-tool-types.ts` | `packages/browser/` | Input/response type interfaces for all 4 control tools. Timeout constants. |
| `src/control-tools.ts` | `packages/browser/` | 4 tool builder functions: `buildNavigateTool()`, `buildClickTool()`, `buildTypeTool()`, `buildPressKeyTool()`. Follows `buildWaitForTool()` pattern. |
| `src/relay-control-handlers.ts` | `packages/browser-extension/` | CDP-based handlers: `handleNavigate()`, `handleClick()`, `handleType()`, `handlePressKey()`. Each checks permission, ensures debugger attached, sends CDP commands. |
| `src/debugger-manager.ts` | `packages/browser-extension/` | `chrome.debugger` lifecycle: `ensureAttached()`, `detach()`, `detachAll()`, `isAttached()`, `sendCommand()`. Internal state: `Set<number>` of attached tab IDs. |
| `src/control-permission.ts` | `packages/browser-extension/` | Permission state management: `grant()`, `revoke()`, `isGranted()`, `getGrantedTabs()`. Storage: `chrome.storage.session`. Badge management. |
| `src/key-code-map.ts` | `packages/browser-extension/` | Lookup table mapping key names (`"Enter"`, `"Tab"`, `"ArrowUp"`, etc.) to CDP `Input.dispatchKeyEvent` parameters (`key`, `code`, `windowsVirtualKeyCode`, `nativeVirtualKeyCode`). |

### 8.2 Existing Files to Modify

| File | Package | Change |
|---|---|---|
| `src/types.ts` | `packages/browser/` | **(Source of truth — BLOCK-1)** Add 4 new values to `BrowserRelayAction` union: `"navigate"`, `"click"`, `"type"`, `"press_key"`. Add `"control-not-granted"` and `"unsupported-page"` to `BrowserRelayResponse.error` union. |
| `src/extension.ts` | `packages/browser/` | Import `buildControlTools()` from `control-tools.ts`. Add control tools to `allBrowserTools` array. |
| `manifest.json` | `packages/browser-extension/` | Add `"debugger"` to `permissions` array. Add `"minimum_chrome_version": "102"` (required for `chrome.storage.session`). |
| `src/relay-definitions.ts` | `packages/browser-extension/` | **(Must mirror types.ts — BLOCK-1)** First, add missing `"get_comments_version"` to reconcile existing divergence. Then add 4 new values to `RelayAction` union. Add `"control-not-granted"` and `"unsupported-page"` to `RelayActionResponse.error` union. |
| `src/relay-actions.ts` | `packages/browser-extension/` | Add 4 new cases to `handleRelayAction()` dispatch switch. Import handlers from `relay-control-handlers.ts`. |
| `src/relay-handlers.ts` | `packages/browser-extension/` | Add barrel re-export for `relay-control-handlers.ts`. |
| `src/constants.ts` | `packages/browser-extension/` | Add `GRANT_TAB_CONTROL`, `REVOKE_TAB_CONTROL`, `GET_TAB_CONTROL_STATUS` to `MESSAGE_TYPES`. |
| `src/sw-router.ts` | `packages/browser-extension/` | Add 3 new cases for control grant/revoke/status messages. `createHandleMessage()` gains a 5th injected dependency: `controlPermission` (the permission manager). This follows the existing injection pattern and avoids direct imports that could create circular dependencies with `sw-lifecycle.ts`. |
| `src/popup.ts` | `packages/browser-extension/` | Add Agent Control section UI with grant/revoke toggle. |
| `src/service-worker.ts` | `packages/browser-extension/` | Register `chrome.tabs.onRemoved` listener for permission cleanup. Register `chrome.debugger.onDetach` listener for auto-revoke on user cancel. |
| `src/content/message-handlers.ts` | `packages/browser-extension/` | **(BLOCK-2)** Add `RESOLVE_ELEMENT_COORDS` case to the `chrome.runtime.onMessage` switch. Uses existing `getElementByRef()` from `page-map-traversal.ts` and `resolveAnchorKey()` from `enhanced-anchor.ts` to resolve uid/selector to viewport center coordinates. See §5.5 for the full message contract. |

---

## 9. Hub Handler Signatures

Each tool builder function follows the established pattern from `wait-tool.ts`:

```typescript
// In packages/browser/src/control-tools.ts

import type { ExtensionToolDefinition } from "@accordo/bridge-types";
import type { BrowserRelayLike } from "./types.js";
import type { NavigateArgs, NavigateResponse, ClickArgs, ClickResponse,
  TypeArgs, TypeResponse, PressKeyArgs, PressKeyResponse } from "./control-tool-types.js";

export function buildNavigateTool(relay: BrowserRelayLike): ExtensionToolDefinition;
export function buildClickTool(relay: BrowserRelayLike): ExtensionToolDefinition;
export function buildTypeTool(relay: BrowserRelayLike): ExtensionToolDefinition;
export function buildPressKeyTool(relay: BrowserRelayLike): ExtensionToolDefinition;

/** Convenience: returns all 4 control tools as an array. */
export function buildControlTools(relay: BrowserRelayLike): ExtensionToolDefinition[];
```

Each handler internally:
1. Validates input args (e.g., `navigate` requires `url` when `type === "url"`).
2. Calls `relay.request(action, args, timeoutMs)`.
3. Maps relay response to typed response.
4. Catches relay errors via `classifyRelayError()`.

### Extension Handler Signatures (Service Worker Side)

```typescript
// In packages/browser-extension/src/relay-control-handlers.ts

import type { RelayActionRequest, RelayActionResponse } from "./relay-definitions.js";

export async function handleNavigate(request: RelayActionRequest): Promise<RelayActionResponse>;
export async function handleClick(request: RelayActionRequest): Promise<RelayActionResponse>;
export async function handleType(request: RelayActionRequest): Promise<RelayActionResponse>;
export async function handlePressKey(request: RelayActionRequest): Promise<RelayActionResponse>;
```

Each handler internally:
1. Resolves target tab ID via `resolveTargetTabId(request.payload)`.
2. Checks `controlPermission.isGranted(tabId)` → returns `"control-not-granted"` error if denied.
3. Calls `debuggerManager.ensureAttached(tabId)` (with MV3 recovery — §5.2). If `"unsupported-page"` error is thrown, returns `"unsupported-page"` error.
4. For `click` and `type`: resolves element coordinates via `chrome.tabs.sendMessage(tabId, { type: "RESOLVE_ELEMENT_COORDS", uid, selector })` (§5.5). If `inViewport: false`, sends `DOM.scrollIntoViewIfNeeded` via CDP first.
5. Sends CDP commands via `debuggerManager.sendCommand(tabId, method, params)`.
6. Returns structured `RelayActionResponse`.

---

## 10. Open Questions (Resolved)

1. ~~**Element resolution strategy for `click` and `type`:**~~ **RESOLVED (BLOCK-2).** Option (c) — reuse the existing content script element resolution via a new `RESOLVE_ELEMENT_COORDS` message type. The `uid` maps to a `ref` in the page map, which `getElementByRef()` in `page-map-traversal.ts` resolves. CSS selectors are resolved via `document.querySelector()`. Full contract specified in §5.5.

2. ~~**Handling `chrome://` and `devtools://` pages:**~~ **RESOLVED (NC-7).** Add `"unsupported-page"` as a new error code to both `BrowserRelayResponse.error` and `RelayActionResponse.error`. The `ensureAttached()` recovery logic (§5.2) catches `"Cannot attach to this target"` and throws `"unsupported-page"`.

3. ~~**Scroll-into-view for `click`:**~~ **RESOLVED.** Yes — send `DOM.scrollIntoViewIfNeeded` CDP command before the click sequence when `RESOLVE_ELEMENT_COORDS` returns `inViewport: false`. This matches real user behavior.

4. **Rate limiting:** Not in v1. CDP handles its own queueing. If performance issues arise, add rate limiting later.

5. **Navigation wait strategy for `browser_navigate`:** Wait for `Page.loadEventFired` by default, with the timeout acting as the upper bound. This matches user expectation of "page is loaded."

---

## 11. Architectural Decisions

### ADR-TC-01: `chrome.debugger` API over Content Script Events

**Decision:** Use `chrome.debugger` API (CDP) for all input synthesis, not content script `dispatchEvent()`.

**Context:** Content scripts can create `MouseEvent` and `KeyboardEvent` objects and dispatch them on DOM elements. However, these events are not "trusted" — the browser's `isTrusted` property is `false`, which means they are ignored by many security-sensitive handlers (form submissions, payment flows, CAPTCHA interactions). CDP's `Input.dispatchMouseEvent` and `Input.dispatchKeyEvent` produce trusted events at the browser engine level.

**Alternatives considered:**
1. *Content script `element.click()`* — Works for simple clicks but not for coordinates, drag, or complex interactions. `isTrusted` is implementation-dependent.
2. *Puppeteer/Playwright via CDP* — Would require bundling a large library. We only need a thin CDP command layer.

**Consequences:**
- (+) Trusted events — works with all page security measures
- (+) Pixel-precise coordinate targeting
- (+) Key combinations and modifier keys work correctly
- (-) Requires `"debugger"` Chrome permission — new permission dialog for users
- (-) Chrome shows debugging info bar (cannot be suppressed)

### ADR-TC-02: Per-Tab Permission with Session Storage

**Decision:** Control permission is tab-scoped and stored in `chrome.storage.session`, not `chrome.storage.local`.

**Context:** The permission gate must prevent accidental agent control. Storing in session storage means permissions are cleared when the browser restarts, requiring explicit re-grant. This is the safest default for a feature that allows page mutation.

**Alternatives considered:**
1. *`chrome.storage.local`* — Persists across restarts. Risk: user forgets a tab was granted and the agent controls it unexpectedly.
2. *In-memory only (service worker variable)* — Lost on service worker termination (MV3 lifecycle). Too aggressive — user would need to re-grant after every 5-minute idle.
3. *Global permission (not per-tab)* — Too broad. A single grant would allow control on all tabs.

**Consequences:**
- (+) Safe default — no persistent "always on" control
- (+) Survives service worker restarts within a session (unlike in-memory)
- (+) Automatically revoked on browser restart
- (-) User must re-grant after browser restart

### ADR-TC-03: Lazy Debugger Attach

**Decision:** The debugger attaches on the first control action after permission is granted, not at grant time.

**Context:** `chrome.debugger.attach()` immediately shows Chrome's debugging info bar. If the user grants permission but the agent doesn't send a control action for minutes (or ever), the bar is needlessly intrusive.

**Alternatives considered:**
1. *Attach at grant time* — Simpler code, but shows the info bar immediately even if no control actions are sent.
2. *Attach and immediately detach to "warm up"* — No benefit; Chrome shows the bar during attach regardless.

**Consequences:**
- (+) Info bar only appears when the agent actually needs control
- (+) Permission grant is instant (no async debugger.attach)
- (-) First control action has ~50ms extra latency for the attach call
- (-) If attach fails (e.g., Chrome internal page), the error surfaces on the first action rather than at grant time

---

## 12. Relation to Existing Architecture

| Existing Section | Relationship |
|---|---|
| [`architecture.md`](architecture.md) §14 | Tab control extends §14 with mutation capabilities. Read-only page understanding tools are unchanged. |
| [`browser2.0-architecture.md`](browser2.0-architecture.md) | Tab control is orthogonal to Browser 2.0's snapshot/diff/filter/visibility scope. The two can be developed independently. Tab control *benefits from* snapshot infrastructure (element UIDs from snapshots are used for click/type targeting). |
| [`browser-extension-architecture.md`](browser-extension-architecture.md) | Tab control adds new modules (debugger-manager, control-permission, control-handlers) alongside existing comment and page-understanding modules. No existing modules are modified beyond adding dispatch cases. |
| ADR-B2-05 | Browser 2.0 chose content script injection over CDP to *avoid* the debugging banner for read-only tools. Tab control takes the opposite stance — CDP is *required* for trusted input events, and the banner is an acceptable trade-off for mutation capabilities. |
