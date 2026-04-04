# M110-TC 45/45 Phase 1 — Design Document

**Date:** 2026-04-04  
**Phase:** A (Design + Stubs)  
**Scope:** GAP-C1 (a11y states) + GAP-F1 (actionability/eventability) + GAP-H1 (error taxonomy + health tool)  
**Score impact:** 31 → 36 (+5 points)  
**Plan reference:** [`M110-TC-45-45-plan.md`](M110-TC-45-45-plan.md) §4, Phase 1

---

## 1. Overview

Phase 1 addresses three gaps that share implementation (the `states` array) and one independent gap (error taxonomy + health tool):

| Gap | Categories | Score | Files Modified |
|---|---|---|---|
| GAP-C1 | C: 4→5 | +1 | `semantic-graph-types.ts`, `semantic-graph-a11y.ts`, `semantic-graph-helpers.ts` |
| GAP-F1 | F: 3→5 | +2 | `element-inspector.ts`, (shared states from C1) |
| GAP-H1 | H: 3→5 | +2 | `page-tool-types.ts`, new `health-tool.ts` |

---

## 2. GAP-C1 + GAP-F1: Element States and Actionability

### 2.1 Shared State Collection — `collectElementStates()`

A new helper function in `semantic-graph-helpers.ts` that both the a11y tree builder and element inspector use.

**Design decision:** `states` is `string[]`, not `Record<string, boolean>`.

- Sparse representation — only non-default states are included (e.g., if not disabled, no entry)
- Consistent with checklist wording ("states" as a list)
- Smaller payload — empty array omitted entirely from output
- Easier for agents to scan — `states.includes("disabled")` vs `states.disabled === true`

**State mapping table:**

| DOM/ARIA Source | State String | Condition |
|---|---|---|
| `(el as HTMLInputElement).disabled` | `"disabled"` | `=== true` (only on form elements) |
| `(el as HTMLInputElement).readOnly` | `"readonly"` | `=== true` (only on input/textarea) |
| `(el as HTMLInputElement).required` | `"required"` | `=== true` (only on form elements) |
| `(el as HTMLInputElement).checked` | `"checked"` | `=== true` (only on checkbox/radio) |
| `el.getAttribute("aria-expanded")` | `"expanded"` | `=== "true"` |
| `el.getAttribute("aria-expanded")` | `"collapsed"` | `=== "false"` |
| `el.getAttribute("aria-selected")` | `"selected"` | `=== "true"` |
| `el.getAttribute("aria-pressed")` | `"pressed"` | `=== "true"` |
| `document.activeElement === el` | `"focused"` | identity check |
| `el.hasAttribute("hidden")` | `"hidden"` | attribute presence |

**Function signature:**

```typescript
/** Collect accessibility/actionability states from a DOM element. */
export function collectElementStates(el: HTMLElement): string[];
```

**Return:** Array of state strings in the order checked (deterministic). Returns empty array `[]` if no states apply. Callers should only attach `states` to the output object when the array is non-empty.

### 2.2 SemanticA11yNode Changes

In `semantic-graph-types.ts`, add one optional field:

```typescript
export interface SemanticA11yNode {
  role: string;
  name?: string;
  level?: number;
  nodeId: number;
  children: SemanticA11yNode[];
  /** Accessibility states (disabled, checked, expanded, etc.). Only present when non-empty. */
  states?: string[];  // ← NEW
}
```

### 2.3 buildA11yNode Changes

In `semantic-graph-a11y.ts`, after setting `name` on the node (line 97), call `collectElementStates(el)` and attach if non-empty:

```typescript
import { collectElementStates } from "./semantic-graph-helpers.js";

// In buildA11yNode(), after: if (name !== undefined) node.name = name;
const states = collectElementStates(el);
if (states.length > 0) node.states = states;
```

### 2.4 ElementDetail Changes (GAP-F1)

In `element-inspector.ts`, extend `ElementDetail` with states + eventability fields:

```typescript
export interface ElementDetail {
  // ... existing fields unchanged ...

  /** Accessibility/actionability states (disabled, readonly, focused, etc.). Only present when non-empty. */
  states?: string[];                                    // ← NEW (F2)
  /** Whether pointer events are enabled (getComputedStyle pointerEvents !== "none"). */
  hasPointerEvents?: boolean;                           // ← NEW (F4)
  /** Whether another element is visually on top at the element's center point. */
  isObstructed?: boolean;                               // ← NEW (F4)
  /** Click target dimensions in CSS pixels (element bounding box width × height). */
  clickTargetSize?: { width: number; height: number };  // ← NEW (F4)
}
```

**Where computed:** In `buildDetail()`, after computing bounds:

- `states` — call `collectElementStates(el)`, include if non-empty
- `hasPointerEvents` — `getComputedStyle(el).pointerEvents !== "none"`
- `isObstructed` — use `document.elementFromPoint(centerX, centerY)` and check if returned element is `el` or a descendant of `el`
- `clickTargetSize` — `{ width: rect.width, height: rect.height }` (already computed from bounds)

### 2.5 Import Path

`collectElementStates` lives in `semantic-graph-helpers.ts` (already imported by `semantic-graph-a11y.ts`). `element-inspector.ts` will add a new import from `./semantic-graph-helpers.js`.

---

## 3. GAP-H1: Error Taxonomy + Health Tool

### 3.1 New Error Codes

Add three new error codes to `CaptureError` in `page-tool-types.ts`:

```typescript
export type CaptureError =
  | "element-not-found"
  | "element-off-screen"
  | "image-too-large"
  | "capture-failed"
  | "no-target"
  | "browser-not-connected"
  | "timeout"
  | "origin-blocked"
  | "redaction-failed"
  | "detached-node"         // ← NEW: stale element reference (node removed from DOM)
  | "blocked-resource"      // ← NEW: CORS/CSP blocked resource
  | "navigation-failed";    // ← NEW: page navigation error (already in NavigateResponse)
```

**Transient error classification update:**

```typescript
// In TRANSIENT_ERRORS record:
"detached-node": 1000,    // ← NEW: retryable — node may reappear after re-render
```

`"blocked-resource"` and `"navigation-failed"` are NOT transient — they are permanent failures.

### 3.2 browser_health Tool

A new MCP tool that reports connection health and recent error history. Lives in `packages/browser/src/health-tool.ts`.

**Interface:**

```typescript
/** Input for browser_health — no parameters required. */
export interface HealthArgs {
  // Empty — no parameters needed
}

/** Response from browser_health. */
export interface HealthResponse {
  /** Whether the browser relay is currently connected. */
  connected: boolean;
  /** WebSocket debugger URL if connected. */
  debuggerUrl?: string;
  /** Recent error messages (last 10, most recent first). */
  recentErrors: string[];
  /** Seconds since the relay server started. */
  uptimeSeconds: number;
}
```

**Design decisions:**

1. **No relay round-trip** — `browser_health` queries the relay server object directly (`relay.isConnected()`) rather than sending a message to the Chrome extension. This avoids the chicken-and-egg problem (if the relay is broken, we can't ask it if it's broken).

2. **Error ring buffer** — The relay server already logs events via `onEvent`. The health tool needs a small ring buffer (10 entries) to track recent errors. This buffer lives on the tool builder closure (not a new class), keeping the implementation minimal.

3. **`uptimeSeconds`** — Computed from `Date.now() - startTime` where `startTime` is captured when the tool is built.

4. **`debuggerUrl`** — Optional. The relay server doesn't currently expose this, so the stub returns `undefined`. Implementation will either pull it from Chrome's `chrome.debugger.getTargets` (via a lightweight relay action) or from the relay server's internal state.

**Tool registration pattern:**

```typescript
export function buildHealthTool(
  relay: BrowserRelayLike,
): ExtensionToolDefinition {
  // ... captures startTime and error buffer in closure ...
}
```

Follows the same pattern as `buildWaitForTool`, `buildTextMapTool`, etc. Returns a single `ExtensionToolDefinition` that gets added to `allBrowserTools` in `extension.ts`.

**Wire registration in extension.ts:**

```typescript
import { buildHealthTool } from "./health-tool.js";
// ...
const healthTool = buildHealthTool(relay);
const allBrowserTools = [
  ...pageUnderstandingTools,
  waitTool, textMapTool, semanticGraphTool, diffTool,
  healthTool,  // ← NEW
  ...buildControlTools(relay),
];
```

---

## 4. Requirements Traceability

| Requirement ID | Description | Interface Element |
|---|---|---|
| MCP-A11Y-002 | States collection in a11y tree | `SemanticA11yNode.states`, `collectElementStates()` |
| B2-SG-002 | A11y tree node structure (updated) | `SemanticA11yNode.states` |
| MCP-INT-001 | Eventability hints | `ElementDetail.hasPointerEvents`, `.isObstructed`, `.clickTargetSize` |
| MCP-ER-004 | Health tool | `HealthArgs`, `HealthResponse`, `buildHealthTool()` |
| MCP-ER-005 | Detached-node error code | `CaptureError` union extension |
| MCP-ER-006 | Progressive backoff | `TRANSIENT_ERRORS["detached-node"]` |

---

## 5. Files Changed Summary

| File | Change Type | What |
|---|---|---|
| `packages/browser-extension/src/content/semantic-graph-types.ts` | Modified | Add `states?: string[]` to `SemanticA11yNode` |
| `packages/browser-extension/src/content/semantic-graph-helpers.ts` | Modified | Add `collectElementStates()` function |
| `packages/browser-extension/src/content/semantic-graph-a11y.ts` | Modified | Call `collectElementStates()` in `buildA11yNode()` |
| `packages/browser-extension/src/content/element-inspector.ts` | Modified | Add states + eventability fields to `ElementDetail` and `buildDetail()` |
| `packages/browser/src/page-tool-types.ts` | Modified | Add 3 new error codes to `CaptureError` |
| `packages/browser/src/health-tool.ts` | **New** | `HealthArgs`, `HealthResponse`, `buildHealthTool()` stub |

---

## 6. Design Decisions

### DEC-020: Element states as `string[]` (not `Record<string, boolean>`)

See §2.1 above. Sparse array representation chosen for smaller payloads, easier agent consumption, and consistency with the 45/45 plan specification.

### DEC-021: Shared `collectElementStates()` helper

Both the a11y tree builder (GAP-C1) and element inspector (GAP-F1) need the same state collection logic. Rather than duplicating the code, a shared helper in `semantic-graph-helpers.ts` is used. This module is already imported by `semantic-graph-a11y.ts` and is a natural home for DOM inspection utilities.

### DEC-022: `browser_health` queries relay directly, not through relay

The health tool checks `relay.isConnected()` locally rather than sending a relay message to the Chrome extension. If the relay is disconnected, a relay message would fail — making it impossible to report the disconnected state. Local-only access is the only correct approach.

### DEC-023: Error ring buffer on tool builder closure

The health tool's error history uses a simple array (capped at 10 entries) captured in the `buildHealthTool()` closure. No new class needed. This follows the existing builder-closure pattern (see `buildWaitForTool`, `buildTextMapTool`).

---

## 7. What This Does NOT Include

- **Page map enrichment** — `states` on page map nodes (when `interactiveOnly: true`) is deferred to implementation. The interface design in this doc covers it (the `collectElementStates()` helper can be called from `page-map-collector.ts` during implementation).
- **Progressive backoff** — The exponential backoff logic (1000→2000→4000ms) is an implementation detail of `buildStructuredError()`. The interface already supports it via `retryAfterMs: number`.
- **Relay action for debuggerUrl** — Whether `browser_health` needs a new relay action to fetch `debuggerUrl` from Chrome is deferred to implementation. The stub returns `undefined`.
- **Error path audit** — Verifying every handler uses `buildStructuredError()` is implementation work, not interface design.

---

*Design document authored by Architect agent. No implementation code — stubs only.*
