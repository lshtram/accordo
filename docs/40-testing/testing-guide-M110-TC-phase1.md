# Phase 1 E2E Testing Prompt — M110-TC GAP-C1 + GAP-F1 + GAP-H1

You are a testing agent. Your job is to **live-verify** the Phase 1 MCP browser tools by calling them through the Accordo MCP hub.

## Connection

- **Hub URL:** `http://localhost:3007`
- **Auth token:** `<TOKEN>`
- **Tool prefix:** `browser_` (e.g., `browser_health`, `browser_get_semantic_graph`, `browser_inspect_element`)

Use the `accordo_browser_*` MCP tools (not curl). The MCP tools are available to you directly — just call them by name.

## What to test

### GAP-H1: `browser_health`

**Test 1 — Returns correct shape when connected**
```
browser_health
```
Expected: `{ connected: true, debuggerUrl: "ws://localhost:9222", uptimeSeconds: <number>, recentErrors: [] }`

**Test 2 — Verify recentErrors can be populated**
Call any browser tool on a disconnected state, then call `browser_health` again and check `recentErrors` grew.

---

### GAP-C1: `browser_get_semantic_graph` — `states` field

**Test 3 — Find disabled buttons with states**
1. Call `browser_get_semantic_graph` on any page with form buttons
2. Search the returned tree for nodes where `role === "button"` and `states` includes `"disabled"`

**Test 4 — Find expanded/collapsed accordion buttons**
1. Call `browser_get_semantic_graph` on a page with an accordion or collapsible section
2. Find buttons where `states` includes `"expanded"` or `"collapsed"`

**Test 5 — Verify no states when element is plain**
1. Call `browser_get_semantic_graph`
2. Find a plain `<div>` or `<span>` with no attributes
3. Confirm it has no `states` property (not even `states: []`)

---

### GAP-F1: `browser_inspect_element` — actionability fields

**Test 6 — `hasPointerEvents` on a visible button**
1. Call `browser_inspect_element` on a visible button
2. Expected: `hasPointerEvents: true`

**Test 7 — `hasPointerEvents` on `pointer-events: none` element**
1. Inspect an element with `style="pointer-events: none"`
2. Expected: `hasPointerEvents: false`

**Test 8 — `clickTargetSize` returns integers**
1. Call `browser_inspect_element` on any element
2. Expected: `clickTargetSize.width` and `clickTargetSize.height` are integers (not floats)

**Test 9 — `isObstructed: false` on a visible element**
1. Call `browser_inspect_element` on a visible element
2. Expected: `isObstructed: false` (not covered by other elements)

**Test 10 — `states` on a disabled input**
1. Inspect a `<input disabled>` element
2. Expected: `states: ["disabled"]`

---

### Error taxonomy (GAP-H1 adjacent)

**Test 11 — Structured error on disconnected relay**
1. Stop the Chrome browser (or disable the extension)
2. Call `browser_navigate` with an invalid tab
3. Expected: `success: false` with a specific `error` string (one of: `browser-not-connected`, `timeout`, `action-failed`, `navigation-interrupted`, `page-closed`, `invalid-request`)

---

## How to call tools

Use the MCP tool calls directly. For example:

```
Call browser_health with arguments: {}
```

```
Call browser_get_semantic_graph with arguments: {"tabId": <activeTabId>}
```

```
Call browser_inspect_element with arguments: {"selector": "button", "tabId": <activeTabId>}
```

Start by listing pages to find an active tabId:
```
Call browser_list_pages with arguments: {}
```

## Success criteria

For each test, report:
- **PASS** or **FAIL**
- Actual response received
- Why it failed (if FAIL)

At the end, summarize: X/11 tests passed.

If any test fails, investigate and report what you found.
