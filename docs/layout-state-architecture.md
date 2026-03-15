# Accordo — Layout State Awareness Architecture

**Status:** PROPOSAL — awaiting review  
**Date:** 2026-03-14  
**Scope:** Full-workspace visual state reporting: open tabs (text + webview), split groups, and the `accordo_layout_state` MCP tool  
**Author:** Copilot  
**Target session:** Session 12 (or appended to Session 11 as a sub-module)

---

## 1. Problem Statement

An AI agent in an Accordo session receives a snapshot of IDE state in the `instructions` field of the MCP `initialize` response. This snapshot **does not change mid-session** for most agent clients (VS Code Copilot, Claude Desktop). As a result:

- If the user opens a diagram panel after the agent session starts, the agent does not know it is open.
- If the user advances a presentation slide, the agent does not see the new slide.
- If the user opens a side-by-side split, the agent cannot reason about the layout.
- When the user asks "what does this look like?", the agent has no anchor to the currently visible surface.

The root cause is two-fold:

| Gap | Description |
|---|---|
| **Coverage gap** | `IDEState.openEditors` captures only text-file tabs. Webview panels (diagram canvas, presentation viewer, browser, script runner) are present in VS Code's `tabGroups` API but filtered out by `StatePublisher.deriveOpenEditors()`. |
| **Freshness gap** | Even when state is captured, it is only delivered to the agent at `initialize` time. No mid-session push mechanism exists for most agent clients. |

---

## 2. Solution Overview

Two orthogonal pieces, independently deliverable:

| Piece | What it does | Where it lives |
|---|---|---|
| **A — Structured tab capture** | Extend `IDEState` with `openTabs: OpenTab[]`. Bridge captures all tab types (text + webview) from `tabGroups` and pushes patches on every tab change. | `@accordo/bridge-types`, `accordo-bridge` |
| **B — `accordo_layout_state` tool** | New MCP tool in `accordo-editor` / `layout.ts`. Returns the live hub state on demand — agent calls it whenever it needs a fresh view of what is open. | `accordo-editor` |

Together they solve both gaps: **A** guarantees the data is available and accurate in hub state; **B** gives the agent a pull mechanism to get it at any time during a session.

---

## 3. Piece A — Structured Tab Capture

### 3.1 New type: `OpenTab`

Add to `@accordo/bridge-types/src/index.ts`:

```typescript
/**
 * A single open tab in VS Code — text file, webview panel, or other.
 *
 * Populated by StatePublisher from vscode.window.tabGroups.all.
 */
export interface OpenTab {
  /** Display label as shown in the VS Code tab strip */
  label: string;

  /** Tab kind discriminator */
  type: "text" | "webview" | "other";

  /**
   * Absolute path to the file (forward slashes).
   * Present only when type === "text".
   */
  path?: string;

  /**
   * Webview view-type identifier registered by the extension.
   * Present only when type === "webview".
   * Examples: "accordo-diagram", "accordo-slidev", "accordo-browser"
   */
  viewType?: string;

  /** True if this tab currently has focus (the active editor/panel). */
  isActive: boolean;

  /** 0-based index of the editor group (split pane) this tab belongs to. */
  groupIndex: number;
}
```

And extend `IDEState`:

```typescript
export interface IDEState {
  // ... existing fields unchanged ...

  /**
   * All open tabs across all editor groups, in group order.
   * Replaces the limited text-only picture from openEditors/visibleEditors.
   * Includes webview panels (diagram, presentation, browser, etc.).
   */
  openTabs: OpenTab[];
}
```

> **Backwards compatibility:** `openEditors` and `visibleEditors` are kept unchanged. `openTabs` is additive.

### 3.2 Bridge changes — `StatePublisher`

**New interface** in `state-publisher.ts`:

```typescript
/**
 * Matches vscode.TabInputWebview — present for all webview panel tabs.
 */
export interface TabInputWebview {
  viewType: string;
}

function isTabInputWebview(v: unknown): v is TabInputWebview {
  return (
    v !== null &&
    typeof v === "object" &&
    "viewType" in v &&
    typeof (v as Record<string, unknown>)["viewType"] === "string"
  );
}
```

**New method** `deriveOpenTabs()` replaces the tab-scanning logic inside `deriveOpenEditors()` and additionally captures webview tabs:

```typescript
private deriveOpenTabs(): OpenTab[] {
  const result: OpenTab[] = [];

  for (const [groupIndex, group] of this.vscode.window.tabGroups.all.entries()) {
    for (const tab of group.tabs) {
      // tab.isActive is used for all types — deriving it from path === activeFile
      // is wrong when the same file is open in multiple editor groups.
      const isActive = tab.isActive ?? false;

      if (isTabInputText(tab.input)) {
        result.push({
          label: tab.label,
          type: "text",
          path: normalizePath(tab.input.uri.fsPath),
          isActive,
          groupIndex,
        });
      } else if (isTabInputWebview(tab.input)) {
        result.push({
          label: tab.label,
          type: "webview",
          viewType: tab.input.viewType,
          isActive,
          groupIndex,
        });
      } else {
        result.push({
          label: tab.label,
          type: "other",
          isActive,
          groupIndex,
        });
      }
    }
  }
  return result;
}
```

> **Note:** `tab.isActive` is the VS Code tab API field (added to the `Tab` interface in §3.4 below). Using path equality (`path === activeFile`) would incorrectly mark multiple tabs active when the same file is open in multiple split groups.

`deriveOpenEditors()` is kept for the `openEditors` text-path list (used by prompt engine for its existing section). The two methods share the tab iteration but are kept separate to avoid changing the `openEditors` field semantics.

**Event hooks:** Both `onDidChangeTabGroups` and `onDidChangeTabs` already schedule a flush. The handlers now also call `this.currentState.openTabs = this.deriveOpenTabs()`.

### 3.3 Prompt engine rendering

`prompt-engine.ts` gains a new section rendered between the existing `visibleEditors` section and the comment threads section:

```
## Open Tabs

Group 0 (left):
  - [active] arch.mmd  (webview: accordo-diagram)
  - server.ts  (text)

Group 1 (right):
  - Session 3 — Accordo Demo  (webview: accordo-slidev)
```

Only rendered when `openTabs.length > 0`. Webview tabs show `viewType` in parentheses so the agent can correlate with modality state. The `isActive` marker gives the agent an immediate answer to "what is the user looking at?".

### 3.4 `VscodeApi` interface extension

The `Tab` interface in `state-publisher.ts` needs `label` and `isActive`. Extending it here is required for `deriveOpenTabs()` to work correctly — the `isActive` field is what VS Code sets on the tab that currently has focus, and it must be used for all tab types:

```typescript
export interface Tab {
  label: string;
  isActive?: boolean;   // true for the focused tab in each group
  input?: TabInputText | TabInputWebview | unknown;
}
```

---

## 4. Piece B — `accordo_layout_state` Tool

### 4.1 Purpose

A zero-argument read-only MCP tool that returns the current complete state snapshot from the hub. This is the **pull mechanism** — the agent calls it at the start of any task that involves visual surfaces, open files, or layout.

### 4.2 Handler location

Added to `packages/editor/src/tools/layout.ts` alongside the existing 5 layout tools.

```typescript
export async function layoutStateHandler(
  _args: Record<string, unknown>,
  getState: () => IDEState,
): Promise<{ ok: true; state: IDEState } | { ok: false; error: string }> {
  try {
    return { ok: true, state: getState() };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}
```

The `getState` dependency is injected via `BridgeAPI.getState()`. This is a **local read** from the Bridge's in-memory `StatePublisher.currentState` — it does not make a network call. The Bridge pushes this state to the Hub via WebSocket, so the two are equivalent in practice, but the call path is: `accordo_layout_state` → `bridge.getState()` → `StatePublisher.currentState`.

> **Note:** This is *not* the same as calling the Hub's `GET /state` HTTP endpoint, which applies additional shaping (e.g. comment thread summaries are injected by the Hub-side `StateCache`). The Bridge-local state contains all `IDEState` fields including `modalities` as pushed by extensions, but does not include Hub-only computed fields.  For the agent use case, Bridge-local state is sufficient and more direct.

**`BridgeAPI` interface update required in `accordo-editor/src/extension.ts`:**

```typescript
interface BridgeAPI {
  registerTools(extensionId: string, tools: ExtensionToolDefinition[]): vscode.Disposable;
  getState(): IDEState;   // ← add this
}
```

**`layoutTools` must become a factory** (option (a) from the previous open question, now decided):

```typescript
// Before (static array — cannot close over getState):
export const layoutTools: ExtensionToolDefinition[] = [ ... ];

// After (factory — receives getState at activate() time):
export function createLayoutTools(getState: () => IDEState): ExtensionToolDefinition[] {
  return [ ...existingFiveTools, layoutStateTool(getState) ];
}
```

This is consistent with `createDiagramTools(ctx)` in `accordo-diagram`.

### 4.3 Tool registration

```typescript
{
  name: "accordo_layout_state",
  group: "layout",
  description:
    "Return the current live IDE layout state: all open tabs (text files and webview panels such as " +
    "diagrams, presentations, browser), active file and cursor position, editor groups, active " +
    "terminal, and per-modality extension state (voice policy, open diagrams, current slide, etc.). " +
    "Call this at the start of any task involving panels, files, or layout to get a fresh snapshot — " +
    "not the potentially stale initialize-time snapshot. Returns Bridge-local state mirrored to Hub.",
  inputSchema: { type: "object", properties: {}, required: [] },
  dangerLevel: "safe",
  idempotent: true,
  handler: wrapHandler("accordo_layout_state", (args) => layoutStateHandler(args, getState)),
}
```

### 4.4 Return shape

```json
{
  "ok": true,
  "state": {
    "activeFile": "/workspace/packages/hub/src/server.ts",
    "activeFileLine": 42,
    "activeFileColumn": 7,
    "openTabs": [
      { "label": "server.ts",  "type": "text",    "path": "/workspace/packages/hub/src/server.ts", "isActive": true,  "groupIndex": 0 },
      { "label": "arch.mmd",   "type": "webview",  "viewType": "accordo.diagram",       "isActive": false, "groupIndex": 0 },
      { "label": "Slide 3",    "type": "webview",  "viewType": "accordo.presentation",  "isActive": false, "groupIndex": 1 }
    ],
    "openEditors": ["/workspace/packages/hub/src/server.ts"],
    "workspaceFolders": ["/workspace"],
    "activeTerminal": "zsh",
    "modalities": {
      "accordo-diagram": { "isOpen": true, "openPanels": ["test-diagrams/arch.mmd"] },
      "accordo-slidev":  { "currentSlide": 3, "totalSlides": 12, "deck": "accordo-demo.deck.md" },
      "accordo-voice":   { "session": "idle", "policy": { "enabled": true, "narrationMode": "narrate-all" } }
    }
  }
}
```

---

## 5. Data Flow

```
VSCode tab events
      │
      │  onDidChangeTabs / onDidChangeTabGroups
      ▼
StatePublisher.deriveOpenTabs()
      │
      │  currentState.openTabs = [...]
      │  scheduleFlush("tabs", 100ms)
      ▼
StatePublisher.flushPatch()
      │
      │  stateUpdate { openTabs: [...] }  (WebSocket)
      ▼
Hub StateCache.applyPatch()
      │
      ├──► GET /instructions    →  prompt engine renders ## Open Tabs section
      │
      ├──► POST /mcp initialize →  instructions field contains current snapshot
      │
      └──► accordo_layout_state tool call  →  returns live IDEState immediately
```

The modality detail layer (diagram open panels, current slide, voice policy) flows through the existing `bridge.publishState()` path unchanged — it feeds into `state.modalities` and is included in the `accordo_layout_state` response.

---

## 6. Agent Usage Pattern

The recommended agent workflow becomes:

```
[Start of any visually-anchored task]
  → call accordo_layout_state
  → read openTabs: identify what is visible (diagram, presentation, file)
  → read modalities: get per-surface rich detail
  → proceed with context-aware tool calls

[User says "this diagram"]
  → openTabs contains the single webview with viewType: "accordo.diagram"
  → modalities["accordo-diagram"].openPanels[0] = "test-diagrams/arch.mmd"
  → call accordo_diagram_get("test-diagrams/arch.mmd")

  [User says "the current slide"]
  → openTabs contains viewType: "accordo.presentation"  
  → modalities["accordo-slidev"].currentSlide = 3
  → call accordo_presentation_getCurrent()
```

The tool is especially valuable when the agent is used across-session (separate conversation from the one that opened the files). The `initialize` snapshot may be hours old; `accordo_layout_state` always returns current.

---

## 7. Affected Packages and Files

| Package | File | Change |
|---|---|---|
| `@accordo/bridge-types` | `src/index.ts` | Add `OpenTab` interface; add `openTabs: OpenTab[]` to `IDEState` |
| `accordo-bridge` | `src/state-publisher.ts` | Add `TabInputWebview` interface + guard; extend `Tab` with `label`/`isActive`; add `deriveOpenTabs()`; update event handlers; update `collectCurrentState()`; add `openTabs: []` to `emptyState()`; add `openTabs` diff branch to `computePatch()` |
| `accordo-bridge` | `src/__tests__/state-publisher.test.ts` | New tests for webview tab capture, `openTabs` diff patching, `emptyState()` initialization |
| `accordo-hub` | `src/state-cache.ts` | Add `openTabs: []` to `createEmptyState()` |
| `accordo-hub` | `src/prompt-engine.ts` | Render `## Open Tabs` section from `state.openTabs` |
| `accordo-hub` | `src/__tests__/prompt-engine.test.ts` | New snapshot tests for the Open Tabs section |
| `accordo-editor` | `src/tools/layout.ts` | Refactor `layoutTools` to `createLayoutTools(getState)` factory; add `layoutStateHandler` + `accordo_layout_state` tool definition |
| `accordo-editor` | `src/__tests__/layout.test.ts` | Tests for the new tool (registration + handler) |
| `accordo-editor` | `src/extension.ts` | Add `getState()` to local `BridgeAPI` interface; call `createLayoutTools(() => bridge.getState())` instead of static `layoutTools` |
| `accordo-script` | `src/tools/script-discover.ts` | Add `accordo_layout_state` entry to the layout tools section of the discover catalog |

---

## 8. What Changes for Existing Extensions

**Nothing.** Each extension continues to call `bridge.publishState(extensionId, {...})` exactly as today. The new `openTabs` field is populated automatically by the Bridge from VS Code's native tab API — extensions do not need to opt in.

The diagram extension's existing `publishState("accordo-diagram", { isOpen, openPanels })` (added in the previous session) remains valuable as the **detail layer** — it provides workspace-relative paths even when the `openTabs` webview entry has only the panel label. Both pieces of data are present in a `accordo_layout_state` response.

---

## 9. Design Decisions and Alternatives Considered

### 9.1 Why not replace `openEditors` with `openTabs`?

`openEditors` is a flat string array used in several existing prompt sections and tests. Replacing it would break backwards compatibility. `openTabs` is additive — it provides the richer structured view while `openEditors` remains for existing consumers.

### 9.2 Why not push state changes to agents via SSE?

The MCP SSE endpoint (`GET /mcp`) already exists and is used for `notifications/tools/list_changed`. We could push a `notifications/resources/updated` or a custom notification when `openTabs` changes. However:
- VS Code Copilot does not act on arbitrary MCP notifications mid-conversation.
- Claude Desktop restarts the session on re-initialize.
- OpenCode already re-fetches `/instructions` frequently.

The pull tool (`accordo_layout_state`) is simpler and universally effective across all agent clients.

### 9.3 Why not track `isActive` via the webview panel's own `onDidChangeViewState`?

Each modality extension could publish `isActive` via `publishState()`. But this requires every extension to opt in and handle the event. The `TabGroup` API already tracks which tab is active with `tab.isActive` — using that is centralized and requires no per-extension work.

### 9.4 `groupIndex` vs. `groupViewColumn`

VS Code exposes `viewColumn` on editors. For webview panels, `viewColumn` is available on the `WebviewPanel` object (from within the extension) but **not** from the `tabGroups` API tab entry. `groupIndex` (0-based index into `tabGroups.all`) is the reliable cross-type field available from a single API call.

---

## 10. Remaining Open Questions

*Points 1, 3 from the first-pass review are resolved above. Remaining questions:*

1. **Token budget** — The `## Open Tabs` prompt section could be verbose in workspaces with many open tabs. The prompt engine already has a `PROMPT_EFFECTIVE_TOKEN_BUDGET` guard — the OpenTabs renderer should count tokens and truncate (oldest/background groups first) if the budget is exceeded. Exact truncation strategy to be decided during implementation.

2. **`tab.label` for webview panels** — VS Code sets the tab label to the `WebviewPanel.title` property set by the extension (e.g. `"arch.mmd"` for a diagram panel). This is human-readable but not a stable identifier between sessions. The `viewType` (e.g. `"accordo.diagram"`) is stable. Exposing both is sufficient for the agent to correlate with modality state.

3. **`other` tab type** — Terminals opened as editors, notebooks, and diff views appear as tabs. They fall into `type: "other"`. Specific sub-types (`"notebook"`, `"diff"`) can be added in a follow-up if agents need to act on them. Not required for initial implementation.
