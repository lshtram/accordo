# Testing Guide — M110-TC Phase 1: A11y States + Actionability + Health Tool

**Module:** GAP-C1 (a11y states) + GAP-F1 (actionability) + GAP-H1 (health tool)
**Date:** 2026-04-05
**Packages:** `browser-extension`, `accordo-browser`
**Feature IDs:** MCP-A11Y-002, MCP-INT-001, MCP-ER-004

---

## Section 1 — Automated Tests

### Run all tests

```bash
# browser-extension (a11y states + actionability)
pnpm --filter browser-extension test

# accordo-browser (health tool + error codes)
pnpm --filter accordo-browser test
```

**Expected:** All tests pass.

| Package | Test files | Tests | Status |
|---------|-----------|-------|--------|
| `browser-extension` | 45 | 955 | ✅ All pass |
| `accordo-browser` | 25 | 636 | ✅ 635 pass (1 pre-existing BR-F-123 port race) |

---

### New tests added by Phase 1

#### `tests/a11y-states.test.ts` — GAP-C1 (16 tests)

| Test ID | What it verifies |
|---------|----------------|
| `collectElementStates` — returns 'disabled' when input is disabled | HTMLInputElement.disabled=true → `["disabled"]` |
| `collectElementStates` — returns 'readonly' when input is readonly | HTMLInputElement.readOnly=true → `["readonly"]` |
| `collectElementStates` — returns 'required' when input is required | HTMLInputElement.required=true → `["required"]` |
| `collectElementStates` — returns 'checked' when checkbox is checked | HTMLInputElement.checked=true → `["checked"]` |
| `collectElementStates` — returns 'expanded' when aria-expanded='true' | aria-expanded="true" → `["expanded"]` |
| `collectElementStates` — returns 'collapsed' when aria-expanded='false' | aria-expanded="false" → `["collapsed"]` |
| `collectElementStates` — returns 'selected' when aria-selected='true' | aria-selected="true" → `["selected"]` |
| `collectElementStates` — returns 'pressed' when aria-pressed='true' | aria-pressed="true" → `["pressed"]` |
| `collectElementStates` — returns 'focused' when element is activeElement | document.activeElement === el → `["focused"]` |
| `collectElementStates` — returns 'hidden' when element has hidden attribute | el.hasAttribute("hidden") → `["hidden"]` |
| `collectElementStates` — returns [] when no states apply | plain div → `[]` |
| `collectElementStates` — returns multiple states when multiple apply | disabled+required → `["disabled", "required"]` |
| `collectElementStates` — is deterministic (same order every time) | Same input → Same output |
| `SemanticA11yNode` — includes states array when element has states | buildA11yTree → disabled button has `states: ["disabled"]` |
| `SemanticA11yNode` — omits states field when no states apply | buildA11yTree → plain div has no `states` property |
| `SemanticA11yNode` — omits states field when no states apply (integration) | Same as above, alternate form |

#### `tests/element-actionability.test.ts` — GAP-F1 (11 tests)

| Test ID | What it verifies |
|---------|----------------|
| `states field` — includes states when element has states | inspectElement disabled input → `states: ["disabled"]` |
| `states field` — omits states when none apply | inspectElement plain div → no `states` property |
| `hasPointerEvents` — returns true when pointerEvents is not 'none' | computedStyle.pointerEvents="auto" → `true` |
| `hasPointerEvents` — returns false when pointerEvents is 'none' | computedStyle.pointerEvents="none" → `false` |
| `isObstructed` — returns false when element is topmost | elementFromPoint returns el → `false` |
| `isObstructed` — returns true when another element is on top | elementFromPoint returns overlay → `true` |
| `isObstructed` — returns false when element has descendant at center | elementFromPoint returns child span → `false` (fixed with contains()) |
| `isObstructed` — guarded against JSDOM missing elementFromPoint | JSDOM: typeof elementFromPoint === "function" → skipped |
| `clickTargetSize` — returns bounding box dimensions | rect 100×40 → `{ width: 100, height: 40 }` |
| `clickTargetSize` — rounds float dimensions to integers | rect 200.3×150.9 → `{ width: 200, height: 151 }` |

#### `src/__tests__/health-tool.test.ts` — GAP-H1 (21 tests, up from 18)

| Test ID | What it verifies |
|---------|----------------|
| `buildHealthTool` — returns tool named 'browser_health' | tool.name === "browser_health" |
| `buildHealthTool` — description mentions health, errors, uptime | description matches /health/i |
| `buildHealthTool` — inputSchema is empty object | inputSchema.properties === {} |
| `buildHealthTool` — dangerLevel is 'safe' | dangerLevel === "safe" |
| `buildHealthTool` — idempotent is true | idempotent === true |
| `buildHealthTool` — handler is callable | handler() returns Promise |
| `HEALTH-001` — connected is true when relay connected | relay.isConnected()=true → connected=true |
| `HEALTH-001` — debuggerUrl is string when connected | → debuggerUrl="ws://localhost:9222" |
| `HEALTH-001` — uptimeSeconds > 0 | → uptimeSeconds > 0 |
| `HEALTH-001` — recentErrors is array | → Array.isArray(recentErrors) |
| `HEALTH-002` — connected is false when relay disconnected | relay.isConnected()=false → connected=false |
| `HEALTH-002` — debuggerUrl is undefined when disconnected | → debuggerUrl undefined |
| `HEALTH-003` — MAX_RECENT_ERRORS is 10 | constant === 10 |
| `HEALTH-003` — recentErrors is capped at MAX_RECENT_ERRORS | → length ≤ 10 |
| `HEALTH-004` — uptimeSeconds > 0 | uptime > 0 |
| `HEALTH-005a` — relay.onError populates recentErrors | onError("timeout") → recentErrors contains "timeout" |
| `HEALTH-005b` — recentErrors ordered most-recent-first | error-1, error-2 → ["error-2", "error-1"] |
| `HEALTH-005c` — oldest evicted when exceeding cap | 15 errors → 10 kept, error-0 evicted |
| `Handler behavior` — queries relay.isConnected() | isConnected called |
| `Handler behavior` — returns all required HealthResponse fields | has connected, uptimeSeconds, recentErrors |
| `Handler behavior` — disconnected shape | connected=false, debuggerUrl=undefined |

---

### Type checking

```bash
pnpm --filter browser-extension exec tsc --noEmit
pnpm --filter accordo-browser exec tsc --noEmit
```

**Expected:** Clean (0 errors) on both packages.

---

### Lint

```bash
pnpm --filter browser-extension exec eslint src/content/semantic-graph-helpers.ts src/content/element-inspector.ts
pnpm --filter accordo-browser exec eslint src/health-tool.ts src/relay-server.ts src/types.ts src/extension.ts
```

**Expected:** Clean (0 errors, 0 warnings on in-scope files).

---

### Deployed E2E — Live MCP verification

The MCP hub is running at port 3007 with token `8be88de3-55ff-4d67-886d-8277b0fd5104`.

**Prerequisites:**
- Chrome running with the browser extension active
- MCP hub at port 3007
- A tab open (e.g. `https://aistudio.google.com/spend` — tabId 918298510)

#### E2E 1 — `browser_health` tool

```bash
curl -s -X POST http://localhost:3007/tools/call \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer 8be88de3-55ff-4d67-886d-8277b0fd5104" \
  -d '{"name":"browser_health","arguments":{}}' | jq .
```

**Expected:** JSON with `connected`, `debuggerUrl`, `uptimeSeconds`, `recentErrors` fields.
```json
{
  "connected": true,
  "debuggerUrl": "ws://localhost:9222",
  "uptimeSeconds": 123,
  "recentErrors": []
}
```

#### E2E 2 — `inspect_element` returns states on disabled input

1. Open a page with a form (e.g. any page with `<input disabled>`)
2. Call `inspect_element` on the disabled input via MCP
3. **Expected:** `element.states` includes `"disabled"`

#### E2E 3 — `get_semantic_graph` returns states on disabled buttons

1. Open a page with disabled buttons
2. Call `get_semantic_graph` via MCP
3. **Expected:** SemanticA11yNode for each disabled button includes `states: ["disabled"]`

#### E2E 4 — `inspect_element` returns actionability fields

1. Call `inspect_element` on a visible button
2. **Expected:** `element.hasPointerEvents: true`, `element.clickTargetSize: { width: <n>, height: <n> }`

#### E2E 5 — Error codes return structured responses

Call any tool on a disconnected relay (stop Chrome first):
```bash
curl -s -X POST http://localhost:3007/tools/call \
  -H "Authorization: Bearer 8be88de3-55ff-4d67-886d-8277b0fd5104" \
  -d '{"name":"browser_navigate","arguments":{"tabId":999999999,"url":"https://example.com"}}' | jq .
```
**Expected:** `success: false` with an `error` field matching one of: `browser-not-connected`, `timeout`, `action-failed`, `navigation-interrupted`, `page-closed`, `invalid-request`.

---

## Section 2 — User Journey Tests

These scenarios are written for an AI agent using the MCP tools via the Accordo IDE copilot. The agent calls `browser_health`, `get_semantic_graph`, and `inspect_element` to verify accessibility and actionability before performing browser actions.

### Prerequisites

- VS Code with Accordo IDE extension loaded
- Chrome with the Accordo browser extension active
- MCP hub running (port 3007)
- AI agent connected to the hub (token: `8be88de3-55ff-4d67-886d-8277b0fd5104`)

---

### Journey 1 — Check browser health before acting

**Goal:** Agent verifies the browser relay is connected before attempting operations.

1. Agent calls `browser_health` (no arguments required).
2. **Expected response:** `connected: true`, `debuggerUrl: "ws://localhost:9222"`, `uptimeSeconds > 0`, `recentErrors: []` (or populated if previous errors occurred).
3. If `connected: false` — agent knows to retry connection or surface an error to the user instead of attempting browser actions.

---

### Journey 2 — Find all interactive disabled elements before form submission

**Goal:** Agent checks `get_semantic_graph` for elements with `states: ["disabled"]` to understand which form controls are inactive.

1. Agent navigates to a form page.
2. Agent calls `get_semantic_graph` to get the full accessibility tree.
3. Agent filters for nodes where `states` includes `"disabled"`.
4. **Expected:** Each disabled button/input appears with `states: ["disabled"]` (and any other applicable states like `"required"` or `"focused"`).
5. Agent avoids attempting to click disabled elements, instead reporting which fields are inactive.

---

### Journey 3 — Verify a button is clickable before attempting an action

**Goal:** Agent uses `inspect_element` to check `hasPointerEvents` and `isObstructed` before clicking.

1. Agent identifies a button by selector.
2. Agent calls `inspect_element` with that selector.
3. **Expected:** `hasPointerEvents: true` (button responds to pointer events).
4. **Expected:** `isObstructed: false` (button is not covered by another element).
5. **Expected:** `clickTargetSize` provides `{ width, height }` so agent knows the button has a reasonable size.
6. If any check fails, agent surfaces a warning before proceeding.

---

### Journey 4 — Detect and handle disconnected relay gracefully

**Goal:** Agent receives a structured error response when Chrome is disconnected.

1. Agent calls any browser tool (e.g. `browser_navigate`) while Chrome extension is disconnected.
2. **Expected:** Response has `success: false` and an `error` field containing a specific code (e.g., `browser-not-connected`, `timeout`).
3. Agent logs the error code to `recentErrors` via `browser_health`.
4. Agent retries or surfaces the error with the specific code rather than a generic message.

---

### Journey 5 — Confirm ARIA expanded/collapsed state for an accordion

**Goal:** Agent uses `get_semantic_graph` to determine accordion open state via `aria-expanded`.

1. Agent calls `get_semantic_graph` on a page with an accordion.
2. Agent finds the accordion button node.
3. **Expected:** Node has `states: ["expanded"]` when accordion is open, `states: ["collapsed"]` when closed.
4. Agent uses this to decide whether to click the accordion to open it.

---

### Journey 6 — Read accessible name of a heading to verify page structure

**Goal:** Agent reads `accessibleName` from the semantic graph to verify the page has expected headings.

1. Agent calls `get_semantic_graph` on a content page.
2. Agent filters for nodes with `role: "heading"`.
3. **Expected:** Each heading has a `name` field (from text content, aria-label, or title).
4. Agent verifies the heading hierarchy matches expectations (e.g., single h1, followed by h2s).

---

### Journey 7 — Check if an element has the hidden attribute

**Goal:** Agent detects invisible elements that might affect layout or interaction.

1. Agent calls `inspect_element` on an element suspected to be hidden.
2. **Expected:** If the element has the `hidden` attribute, `states` includes `"hidden"`.
3. Agent avoids interacting with hidden elements.
