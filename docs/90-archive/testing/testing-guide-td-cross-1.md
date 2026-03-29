# Testing Guide — TD-CROSS-1: Open Tabs Capture + `accordo_layout_state` + Open Tabs Prompt

**Date:** 2026-03-15  
**Packages:** `accordo-bridge` (M74-OT) · `accordo-editor` (M74-LS) · `accordo-hub` (M74-PE)  
**Commits:** `fc0a227` (implementation) · `4e9807c` (reviewer fixes)

---

## 1. What Was Built

Three pieces compose this feature end-to-end:

### 1.1 Open Tabs Capture — `accordo-bridge`

`IDEState` previously only held `openEditors` (paths of text files). It is now extended with `openTabs: OpenTab[]`, which captures **all** open tabs — text files, webview panels (diagram canvas, presentations, browser), and anything else:

```
openTabs: [
  { label: "server.ts",       type: "text",    path: "/proj/server.ts", isActive: true,  groupIndex: 0 },
  { label: "arch.mmd",        type: "webview", viewType: "accordo.diagram",              isActive: false, groupIndex: 0 },
  { label: "Accordo Demo",    type: "webview", viewType: "accordo.presentation",          isActive: false, groupIndex: 1 },
]
```

Tabs are grouped by `groupIndex` (which editor split they belong to). The active tab per group has `isActive: true`.

### 1.2 `accordo_layout_state` Tool — `accordo-editor`

A new MCP tool that returns the complete current `IDEState` snapshot — including `openTabs` — directly from the Bridge's in-memory state. It requires no Hub network call; it reads local state and responds in under 5 ms.

Agents are instructed by its description to **call this tool at the start of every task** before taking any action.

### 1.3 Open Tabs Section in System Prompt — `accordo-hub`

The Hub's rendered system prompt now includes a `## Open Tabs` section so agents have visual-layout awareness without calling any tool:

```markdown
## Open Tabs

Group 0:
  - [active] server.ts
  - arch.mmd  (webview: accordo.diagram)

Group 1:
  - Accordo Demo  (webview: accordo.presentation)
```

The section is **budget-aware**: if the many open tabs would push the dynamic section over 1,350 tokens, background groups (highest group index first) are dropped. The active tab is always preserved.

---

## 2. Automated Tests — Run First

These must be green before any manual testing:

```bash
pnpm --filter accordo-hub test
```
Expected: `Tests  376 passed (376)` (or higher if other tests exist)

```bash
pnpm --filter accordo-bridge test
```
Expected: all bridge tests passing

```bash
pnpm --filter accordo-editor test
```
Expected: all editor tests passing

Or verify everything at once:

```bash
pnpm test
```

If any test fails, stop — do not proceed to manual testing.

---

## 3. Prerequisites

1. **Build:**
   ```bash
   pnpm build
   ```

2. **Launch the Extension Development Host:** press **F5** from the root workspace folder (`/Users/Shared/dev/accordo`).  
   This must use the launch configuration that starts **all three extensions** (bridge + editor + any modality extensions you want to test). Do not press F5 from inside a package subfolder.

3. In the Extension Development Host (EDH) window:
   - Open a project with several files across multiple editor splits.
   - Open at least one webview panel if you want to see webview tab capture (e.g. open a diagram or presentation).

4. **Start the Hub** in a terminal (choose one):

   ```bash
   # Option A — manual terminal
   ACCORDO_TOKEN=demo-token ACCORDO_BRIDGE_SECRET=demo-secret \
     node packages/hub/dist/index.js --port 3000

   # Option B — VSCode task (Ctrl+Shift+P → Run Task → "start-hub-dev")
   ```

5. **Verify the Bridge is connected:**
   ```bash
   curl -s http://localhost:3000/health | python3 -m json.tool
   ```
   Expected: `"bridge": "connected"` and `"toolCount"` > 0.

6. **Connect your MCP client** (GitHub Copilot, Claude Code, OpenCode, etc.) to the Hub at `http://localhost:3000/mcp` with bearer token `demo-token`.

---

## 4. Test Cases

### TC-01 — Open Tabs appear in `/state` endpoint

**Purpose:** Confirm that Bridge captures open tabs and pushes them to the Hub's state cache.

**Steps:**

1. In the EDH window, open 2–3 files spread across 2 editor splits (View → Editor Layout → Two Columns, then open different files in each split).
2. In your terminal:
   ```bash
   curl -s -H "Authorization: Bearer demo-token" \
     http://localhost:3000/state | python3 -m json.tool | grep -A 30 '"openTabs"'
   ```

**Expected output (example):**
```json
"openTabs": [
  {
    "label": "server.ts",
    "type": "text",
    "path": "/path/to/server.ts",
    "isActive": true,
    "groupIndex": 0
  },
  {
    "label": "index.ts",
    "type": "text",
    "path": "/path/to/index.ts",
    "isActive": false,
    "groupIndex": 0
  },
  {
    "label": "package.json",
    "type": "text",
    "path": "/path/to/package.json",
    "isActive": true,
    "groupIndex": 1
  }
]
```

**What to verify:**
- `openTabs` array is present (not empty or missing).
- Each tab has `label`, `type`, `isActive`, and `groupIndex`.
- Text-file tabs have `path`.
- The tab you last clicked has `isActive: true` in its group.
- Tabs in the right-hand split have `groupIndex: 1`.

---

### TC-02 — Active tab tracking updates live

**Purpose:** Confirm that clicking a different tab updates `openTabs` within a few hundred milliseconds.

**Steps:**

1. Note which tab is currently active (check `/state` — look for `isActive: true`).
2. Click a different file tab in the EDH window.
3. Wait ~300 ms, then re-fetch:
   ```bash
   curl -s -H "Authorization: Bearer demo-token" \
     http://localhost:3000/state | python3 -m json.tool | grep -A 5 '"isActive": true'
   ```

**Expected:** The `isActive: true` entry changes to reflect the newly clicked tab.

---

### TC-03 — Webview tabs are captured

**Purpose:** Confirm webview tabs (diagram, presentation, browser) appear in `openTabs` with correct `type` and `viewType`.

**Steps:**

1. Open an accordo diagram panel (via `accordo_diagram_create` or existing diagram file) in the EDH window.
2. Fetch state:
   ```bash
   curl -s -H "Authorization: Bearer demo-token" \
     http://localhost:3000/state | python3 -m json.tool | grep -B 1 -A 6 '"webview"'
   ```

**Expected:**
```json
{
  "label": "My Diagram",
  "type": "webview",
  "viewType": "accordo.diagram",
  "isActive": true,
  "groupIndex": 0
}
```

**What to verify:**
- `type: "webview"` (not `"text"`).
- `viewType` matches the panel's VS Code view type.
- No `path` field (webviews have no file path).

---

### TC-04 — `accordo_layout_state` tool returns `openTabs`

**Purpose:** Confirm that the new MCP tool works and returns the full state including `openTabs`.

**Steps:**

In your MCP client, call the tool:

```
call accordo_layout_state {}
```

**Expected response (abbreviated):**
```json
{
  "ok": true,
  "state": {
    "workspaceName": "accordo",
    "activeFile": "/path/to/current-file.ts",
    "openEditors": [...],
    "openTabs": [
      { "label": "current-file.ts", "type": "text", "isActive": true, "groupIndex": 0, ... },
      ...
    ],
    "modalities": { ... }
  }
}
```

**What to verify:**
- `ok: true` with no error.
- `state.openTabs` is present and populated.
- `state.modalities` contains any currently-publishing extensions (e.g. `accordo-comments`, `accordo-voice`).
- Response is near-instant (< 5 ms round trip from the agent's perspective — it is a local memory read).

---

### TC-05 — `## Open Tabs` section appears in system prompt

**Purpose:** Confirm the rendered system prompt includes the `## Open Tabs` section the agent sees on every request.

**Steps:**

```bash
curl -s http://localhost:3000/instructions
```

**Expected output (excerpt):**
```markdown
## Current IDE State

**Workspace:** accordo
**Active file:** /path/to/server.ts (line 1, col 1)
**Open editors:**
  - /path/to/server.ts
  - /path/to/index.ts

## Open Tabs

Group 0:
  - [active] server.ts
  - index.ts

Group 1:
  - package.json  (webview: accordo.diagram)

**Workspace folders:**
  - /path/to/accordo
```

**What to verify:**
- `## Open Tabs` section is present (before comment threads and extension state).
- Groups are numbered starting from 0.
- The active tab is prefixed with `[active]`.
- Webview tabs have `(webview: <viewType>)` annotation.
- Text tabs show filename only (not full path).

---

### TC-06 — Open Tabs section is absent when no tabs are open

**Purpose:** Confirm clean output when `openTabs` is empty.

**Steps:**

1. Close all files in the EDH window (Ctrl+Shift+W repeatedly, or `Close All Editors` command).
2. Fetch:
   ```bash
   curl -s http://localhost:3000/instructions | grep "Open Tabs"
   ```

**Expected:** No output (the section is omitted entirely, not rendered as an empty heading).

---

### TC-07 — Agent can see tab layout and act on it (end-to-end)

**Purpose:** Confirm the agent actually uses `openTabs` information to understand the workspace.

**Steps:**

1. Open two files in two separate splits in the EDH window.
2. Open a diagram in one of the splits.
3. In your MCP-connected agent, ask:
   > "What do I have open right now? Describe my editor layout."

**Expected agent behaviour:**
- The agent describes the groups and which files/panels are in each.
- It correctly identifies the active tab.
- It mentions the webview panel by type.
- It may optionally call `accordo_layout_state` to get the full snapshot.

**You do NOT need to mention `openTabs` or `layout_state` to the agent** — this information should flow naturally from the system prompt.

---

### TC-08 — `accordo_layout_state` is listed in `accordo_script_discover`

**Purpose:** Confirm the tool catalog lists the new tool (so agents can discover it).

**Steps:**

In your MCP client:
```
call accordo_script_discover {}
```

**Expected:** The returned catalog includes a `accordo_layout_state` entry with a description stating something about calling it at the start of tasks.

---

## 5. Cleanup

- Close the Extension Development Host window.
- Stop the Hub process (Ctrl+C in the terminal where it's running).

