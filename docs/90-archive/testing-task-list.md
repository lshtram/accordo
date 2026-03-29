# Accordo — Master Testing Task List

**Purpose:** A single, deduplicated checklist of every feature that can be verified.
Items are split into two tiers:

- **CLI / Node.js** — runs in a terminal with no VS Code Extension Development Host (EDH). You can do these now.
- **Manual (EDH required)** — requires the VS Code Extension Development Host loaded with one or more Accordo extensions.

Work through the CLI tier first, then start a real EDH session for the manual tier.

---

## Source Guides

| Guide file | Coverage |
|---|---|
| [testing-guide-week7.md](testing-guide-week7.md) | `comment-sdk` DOM library; `md-viewer` renderer, plugins, templates |
| [testing-guide-session8a.md](testing-guide-session8a.md) | `accordo-comments` surface-adapter command (M40-EXT-11) |
| [testing-guide-session8b.md](testing-guide-session8b.md) | `accordo-slidev` full presentation modality (M44) |
| [testing-guide-session9-m45-panel.md](testing-guide-session9-m45-panel.md) | Custom Comments Panel (M45) — filter, navigate, mutate |
| [testing-guide-session10b.md](testing-guide-session10b.md) | Hub voice system-prompt section (M51-SN); streaming TTS (M51-STR) |
| [testing-guide-voice-10a.md](testing-guide-voice-10a.md) | `accordo-voice` full extension — STT, TTS, FSM, MCP tools |
| [testing-guide-script-10d.md](testing-guide-script-10d.md) | `accordo-script` — run/stop/status tools, all step types |
| [testing-guide-diagram-diag1.md](testing-guide-diagram-diag1.md) | Diagram end-to-end: panel, file-watcher, all 6 MCP tools |
| [testing-guide-diagram-A4.md](testing-guide-diagram-A4.md) | Auto-layout (`computeInitialLayout`) — no HTTP surface |
| [testing-guide-diagram-A5-A9.md](testing-guide-diagram-A5-A9.md) | Parser, layout-store, edge-identity, placement, shape-map |
| [testing-guide-diagram-A14.md](testing-guide-diagram-A14.md) | Diagram tool handler REPL tests (6 tools, no panel needed) |
| [testing-guide-diagram-A15.md](testing-guide-diagram-A15.md) | `accordo-diagram` extension activation + panel open/close |
| [testing-guide-diagram-A16.md](testing-guide-diagram-A16.md) | File-watcher and canvas auto-refresh |
| [testing-guide-diagram-A18.md](testing-guide-diagram-A18.md) | Comment SDK integration in Excalidraw canvas |
| [testing-guide-diagram-A6v2-A10v2-A14v2.md](testing-guide-diagram-A6v2-A10v2-A14v2.md) | Edge-router, reconciler, canvas generator; style/drag E2E |
| [testing-guide-td-cross-1.md](testing-guide-td-cross-1.md) | Open-Tabs capture (M74); `accordo_layout_state` tool; Open Tabs system prompt section |

---

## Tier 1 — CLI / Node.js Tests

These require no EDH. Run them in any terminal with `pnpm build` having completed successfully.

### 1.A  Automated test suite (baseline gate)

- [x] **A-1** `pnpm test` passes with exit code 0 and all tests green
- [x] **A-2** `pnpm build` exits 0 in every package (no TypeScript errors)

---

### 1.B  Hub REST API

Start the Hub:
```powershell
$env:ACCORDO_TOKEN="demo-token"; $env:ACCORDO_BRIDGE_SECRET="demo-secret"
node packages/hub/dist/index.js --port 3000
```

- [x] **B-1** `GET /health` returns `{ ok:true, bridge:"disconnected", toolCount:0, protocolVersion:"1" }`
- [x] **B-2** `GET /state` without `Authorization` returns HTTP 401
- [x] **B-3** `GET /state` with `Authorization: Bearer demo-token` returns `{ openTabs:[], openEditors:[], commentThreads:[], modalities:{} }`
- [x] **B-4** `GET /instructions` returns HTTP 200 with `Content-Type: text/plain` and a body beginning with `# Accordo IDE` (actual header: `# Accordo IDE — AI Collaboration Assistant`)
- [x] **B-5** `GET /instructions` body contains `## Registered Tools` and `No active session` when bridge is disconnected
- [x] **B-6** `GET /instructions` body does **not** contain `## Open Tabs` section when no bridge is connected
- [x] **B-7** `POST /mcp` without auth returns HTTP 401
- [x] **B-8** `POST /mcp` `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"1","capabilities":{},"clientInfo":{"name":"test","version":"1"}}}` returns capabilities with `tools.listChanged:true`
- [x] **B-9** `GET /mcp` with `Accept: text/event-stream` returns HTTP 200, `Content-Type: text/event-stream`, and a `: accordo-hub SSE connected` preamble line

---

### 1.C  MCP JSON-RPC protocol (Hub running, no bridge)

- [x] **C-1** `tools/list` via `POST /mcp` returns an array with `accordo_layout_state` when the bridge has registered tools (confirmed: integration test shows 40 tools; `accordo_layout_state` existence verified in unit tests + `createLayoutTools`)
- [x] **C-2** `tools/list` returns 0 tools before any bridge connects
- [x] **C-3** MCP `initialize` response lists `tools` capability with `listChanged:true`

---

### 1.D  Integration smoke test (7 scenarios end-to-end)

```powershell
node scripts/integration-test.mjs
```

- [x] **D-1** Step 1 — Hub starts within 6 s; `/health` reports `ok:true`
- [x] **D-2** Step 2 — WebSocket bridge connects to `/bridge` with correct secret; 40-tool `toolRegistry` accepted
- [x] **D-3** Step 3 — `/health` reports `toolCount:40` and `bridge:connected`
- [x] **D-4** Step 4 — `/instructions` lists all 40 tool names including `accordo_presentation_open`
- [x] **D-5** Step 5 — MCP `tools/list` returns exactly 40 tools
- [x] **D-6** Step 6 — `mcp.json` at `%APPDATA%\Code\User\mcp.json` contains correct flat `{ servers:{accordo:{type:"http",...}} }` format (skip if file is empty — bridge extension not yet activated) ℹ skipped gracefully — file is empty placeholder
- [x] **D-7** Step 7 — SSE `notifications/tools/list_changed` is received within 2 s after a tool-registry update that changes the tool-name hash

---

### 1.E  Diagram tool handlers (no panel, no EDH — REPL via Node.js)

Run from `packages/diagram/` with `pnpm build` having completed. Use `node --input-type=module` heredoc snippets from [testing-guide-diagram-A14.md](testing-guide-diagram-A14.md) §Part 2.

- [x] **E-1** `styleGuideHandler({})` returns `ok:true`, palette with `primary:"#4A90D9"`, 6 conventions, `starterTemplate` starting `flowchart TD`
- [x] **E-2** `listHandler({}, ctx)` on a temp dir with one `.mmd` file returns `ok:true`, correct `path`, `type:"flowchart"`, `nodeCount`
- [x] **E-3** `listHandler({}, ctx)` on a dir with no `.mmd` files returns `ok:true`, empty `data` array
- [x] **E-4** `getHandler({path:"svc.mmd"},ctx)` returns `ok:true`, parsed nodes + edges, `layout:null` (no layout file yet)
- [x] **E-5** `getHandler({path:"missing.mmd"},ctx)` returns `ok:false`, `errorCode:"FILE_NOT_FOUND"`
- [x] **E-6** `getHandler({path:"../../etc/passwd"},ctx)` returns `ok:false`, `errorCode:"TRAVERSAL_DENIED"`
- [x] **E-7** `createHandler({path:"p.mmd",content:"flowchart LR\nA-->B\n"},ctx)` creates both `.mmd` and `.layout.json` on disk; returns `ok:true`, `nodeCount:2`
- [x] **E-8** `createHandler` called again on same path without `force` returns `ok:false`, `errorCode:"ALREADY_EXISTS"`
- [x] **E-9** `createHandler` with `force:true` overwrites and returns `ok:true`
- [x] **E-10** `createHandler` with invalid Mermaid returns `ok:false`, `errorCode:"PARSE_ERROR"`; file NOT created
- [x] **E-11** `patchHandler` adds a new node: `changes.nodesAdded` lists the new node ID
- [x] **E-12** `patchHandler` with `%% @rename: A -> Alpha` annotation: `changes.renamesApplied` listed; cleaned source returned
- [x] **E-13** `patchHandler` on non-existent file returns `ok:false`, `errorCode:"FILE_NOT_FOUND"`
- [x] **E-14** `renderHandler` with `getPanel: ()=>undefined` returns `ok:false`, `errorCode:"PANEL_NOT_OPEN"`

---

### 1.F  Auto-layout REPL (diagram — no HTTP surface)

From `packages/diagram/` with `node --input-type=module`. See [testing-guide-diagram-A4.md](testing-guide-diagram-A4.md) §Part 2.

- [x] **F-1** `computeInitialLayout` on a 3-node chain returns increasing `y` values for `TB` direction (A.y < B.y < C.y)
- [x] **F-2** `computeInitialLayout` on 3-node chain with `rankdir:"LR"` returns increasing `x` values, similar `y` values
- [x] **F-3** Cylinder node (`C`) gets `w:120, h:80` (not rectangle default `180/60`)
- [x] **F-4** `computeInitialLayout` with `type:"mindmap"` throws `UnsupportedDiagramTypeError`

---

### 1.G  md-viewer smoke test

```powershell
pnpm --filter accordo-md-viewer build
node packages/md-viewer/scripts/smoke-test.mjs
```

- [x] **G-1** 53/53 checks pass (one new PreviewBridge check added since guide was written — guide says 52; actual is 53)
- [x] **G-2** Exit code 0

---

### 1.H  Code quality gates

```powershell
# No :any in source
grep -rn ": any" packages/md-viewer/src packages/comment-sdk/src
# No console.log in source
grep -rn "console\.log" packages/md-viewer/src packages/comment-sdk/src packages/hub/src packages/bridge/src
```

- [x] **H-1** No `: any` hits in `md-viewer/src` or `comment-sdk/src`
- [x] **H-2** No `console.log` hits in source files (test files excluded)

---

## Tier 2 — Manual (EDH Required)

Start the Extension Development Host: press **F5** from the repo root using the  
**"Launch Bridge + Editor + Voice (Extension Development Host)"** launch configuration.  
Also start the Hub in a terminal before testing any agent-facing features.

---

### 2.A  Bridge connection and tool registration

- [ ] **MA-1** After EDH loads, `GET /health` shows `bridge:"connected"` and `toolCount` > 0
- [ ] **MA-2** `GET /instructions` includes `## Registered Tools` with all registered tool names
- [ ] **MA-3** VS Code status bar in EDH shows **Accordo Bridge ✓**

---

### 2.B  Open Tabs capture (TD-CROSS-1 §4)

- [ ] **MB-1** Open 2–3 files in two editor splits; `GET /state` returns `openTabs` array with correct `label`, `type`, `isActive`, `groupIndex` per tab
- [ ] **MB-2** Click a different tab; re-fetch `/state` within 300 ms; `isActive:true` moved to the newly clicked tab
- [ ] **MB-3** Open a diagram or presentation webview panel; `GET /state` includes an entry with `type:"webview"` and correct `viewType`
- [ ] **MB-4** `GET /instructions` includes `## Open Tabs` section listing groups and the `[active]` tab
- [ ] **MB-5** Close all editors; `GET /instructions | grep "Open Tabs"` returns no output (section omitted)
- [ ] **MB-6** MCP tool `accordo_layout_state {}` returns `ok:true`, `state.openTabs` populated, response < 5 ms perceived latency
- [ ] **MB-7** Ask agent: *"What do I have open right now?"* — it describes groups, active tab, and webview type from the system prompt without being told to

---

### 2.C  Editor tools (via agent)

- [ ] **MC-1** `accordo_editor_open` — agent opens a file; it appears as active tab in EDH
- [ ] **MC-2** `accordo_editor_scroll` — scrolls active editor to specified line
- [ ] **MC-3** `accordo_editor_highlight` — highlights lines with background colour; `accordo_editor_clearHighlights` removes it
- [ ] **MC-4** `accordo_editor_save` / `accordo_editor_saveAll` — saves dirty files
- [ ] **MC-5** `accordo_editor_split` — splits the editor pane
- [ ] **MC-6** `accordo_editor_format` — formats the active document

---

### 2.D  Terminal tools (via agent)

- [ ] **MD-1** `accordo_terminal_open` — new terminal appears in EDH
- [ ] **MD-2** `accordo_terminal_run` — command executes and output is returned
- [ ] **MD-3** `accordo_terminal_list` — lists open terminal names
- [ ] **MD-4** `accordo_terminal_close` — terminal is closed

---

### 2.E  Layout tools (via agent)

- [ ] **ME-1** `accordo_layout_zen` — toggles Zen Mode in EDH
- [ ] **ME-2** `accordo_panel_toggle` — toggles a sidebar panel
- [ ] **ME-3** `accordo_layout_joinGroups` — collapses editor splits

---

### 2.F  Comment threads (via agent + Comments panel)

- [ ] **MF-1** Agent calls `accordo_comment_create`; thread appears in Comments panel
- [ ] **MF-2** Agent calls `accordo_comment_reply`; reply appears in thread
- [ ] **MF-3** Agent calls `accordo_comment_resolve`; thread moves to Resolved group in panel
- [ ] **MF-4** Agent calls `accordo_comment_list`; all open threads returned
- [ ] **MF-5** Agent calls `accordo_comment_delete`; thread removed from panel
- [ ] **MF-6** `accordo.comments.internal.getSurfaceAdapter` command accessible from Debug Console; returns adapter with 7 methods (`createThread`, `delete`, `getThreadsForUri`, `onChanged`, `reopen`, `reply`, `resolve`)

---

### 2.G  Custom Comments Panel (M45, session9)

- [ ] **MG-1** Panel renders open threads under `🔴 Open (N)` group header and resolved under `✅ Resolved (N)`
- [ ] **MG-2** `accordo.commentsPanel.groupBy` → `by-file` — headers change to filenames
- [ ] **MG-3** `accordo.commentsPanel.groupBy` → `by-activity` — flat list sorted by most recent update
- [ ] **MG-4** Group-by mode persists after EDH reload (Ctrl+R)
- [ ] **MG-5** `accordo.commentsPanel.filterByStatus` → `open` — only open threads shown
- [ ] **MG-6** `accordo.commentsPanel.clearFilters` — all threads return
- [ ] **MG-7** Filter persists after EDH reload
- [ ] **MG-8** Single-click a thread item — VS Code opens the file and scrolls to the annotated line
- [ ] **MG-9** Right-click a thread → **Resolve** — input box appears; entering text resolves and moves thread
- [ ] **MG-10** Right-click a resolved thread → **Reopen** — thread returns to Open group

---

### 2.H  Markdown Preview (md-viewer, week7 §8)

- [ ] **MH-1** Open any `.md` file → **Open With… → Accordo Markdown Preview** — preview renders
- [ ] **MH-2** Syntax highlighting visible (Shiki github-dark theme)
- [ ] **MH-3** `$E=mc^2$` renders inline KaTeX math
- [ ] **MH-4** Mermaid fenced block renders diagram
- [ ] **MH-5** `:rocket:` renders as 🚀
- [ ] **MH-6** Headings have `data-block-id` attributes (inspect with DevTools)
- [ ] **MH-7** `<script>alert('xss')</script>` in markdown does NOT appear in rendered output
- [ ] **MH-8** Alt+click a paragraph → inline comment input form appears
- [ ] **MH-9** Submit a comment → thread visible in Comments panel; pin appears on block
- [ ] **MH-10** `⇧⌘V` toggles between preview and text editor

---

### 2.I  Presentation modality (accordo-slidev, session8b)

Prerequisites: `npm install -g @slidev/cli`, launch EDH with slidev extension.

- [ ] **MI-1** `accordo_presentation_discover` — returns list including `demo/accordo-demo.deck.md`
- [ ] **MI-2** `accordo_presentation_open` on the demo deck — WebviewPanel titled `accordo-demo.deck.md` opens; Slidev server starts on port 7788+
- [ ] **MI-3** `accordo_presentation_listSlides` — returns 6 slides with correct titles
- [ ] **MI-4** `accordo_presentation_getCurrent` — returns `{ index:0, title:"Accordo IDE" }`
- [ ] **MI-5** `accordo_presentation_next` — WebviewPanel advances to slide 2
- [ ] **MI-6** `accordo_presentation_goto {index:3}` — WebviewPanel shows slide 4 "Presentation Modality"
- [ ] **MI-7** `accordo_presentation_prev` — goes back one slide
- [ ] **MI-8** `accordo_presentation_generateNarration {index:2}` — returns plain text, no markdown symbols
- [ ] **MI-9** `accordo_presentation_generateNarration` (all slides) — returns 6 `{slideIndex, narrationText}` objects
- [ ] **MI-10** `accordo_presentation_goto {index:99}` — returns structured error `{ error: "... out of bounds ..." }`, no exception
- [ ] **MI-11** Open the same deck a second time — panel revealed, no new Slidev process spawned
- [ ] **MI-12** `accordo_presentation_close` — WebviewPanel closes, Slidev process killed
- [ ] **MI-13** After close, `/instructions` reports `isOpen:false`

---

### 2.J  Diagram panel + file-watcher (diag1 §4–§6)

Prerequisites: add diagram to launch config per [testing-guide-diagram-diag1.md](testing-guide-diagram-diag1.md) §2.1.

- [ ] **MJ-1** Command Palette → **Accordo: Open Diagram** → select `test-diagrams/arch.mmd` — Excalidraw canvas renders with 6 nodes
- [ ] **MJ-2** Run **Accordo: Open Diagram** a second time — no new panel; existing panel focused (idempotent)
- [ ] **MJ-3** Add `D --> G[Cache]` to `arch.mmd` and save — canvas refreshes within 1 s; new "Cache" node appears; existing nodes unchanged
- [ ] **MJ-4** Introduce syntax error in `.mmd` and save — red error overlay appears; fix it — overlay clears
- [ ] **MJ-5** Drag a node in the canvas — `arch.layout.json` is written/updated with new `x`/`y` for that node
- [ ] **MJ-6** After drag, save a trivial text change to `arch.mmd` — canvas refreshes but dragged node stays at new position

---

### 2.K  Diagram MCP tools via agent (diag1 §7)

Hub must be running and diagram extension active.

- [ ] **MK-1** `accordo_diagram_list {}` — returns entry for `test-diagrams/arch.mmd` with `type:"flowchart"` and correct `nodeCount`
- [ ] **MK-2** `accordo_diagram_get {path:"test-diagrams/arch.mmd"}` — returns source, type, nodes array, edges array, layout object
- [ ] **MK-3** `accordo_diagram_get {path:"test-diagrams/missing.mmd"}` — returns `errorCode:"FILE_NOT_FOUND"`
- [ ] **MK-4** `accordo_diagram_get {path:"../../etc/passwd"}` — returns `errorCode:"TRAVERSAL_DENIED"`
- [ ] **MK-5** `accordo_diagram_create` — creates new `.mmd` + `.layout.json` on disk; `ok:true`, correct `nodeCount`
- [ ] **MK-6** `accordo_diagram_create` on existing file without `force` — `errorCode:"ALREADY_EXISTS"`
- [ ] **MK-7** `accordo_diagram_create` with invalid Mermaid — `errorCode:"PARSE_ERROR"`; no file created
- [ ] **MK-8** `accordo_diagram_patch` — open panel auto-refreshes; `changes.nodesAdded` lists new node; layout preserved for old nodes
- [ ] **MK-9** `accordo_diagram_patch` with invalid Mermaid — `errorCode:"PARSE_ERROR"`; file NOT modified
- [ ] **MK-10** `accordo_diagram_render {format:"svg"}` with panel open — writes `arch.svg` to disk; `ok:true`
- [ ] **MK-11** `accordo_diagram_render` with no panel open — `errorCode:"NO_PANEL_OPEN"`
- [ ] **MK-12** `accordo_diagram_style_guide {}` — returns palette, starter template, 6 conventions

---

### 2.L  Diagram comment integration (A18)

Requires diagram panel open and `accordo-comments` active.

- [ ] **ML-1** Alt+click a node in the Excalidraw canvas — inline input overlay appears (not browser `prompt()`)
- [ ] **ML-2** Submit a comment — thread appears in Comments panel; pin visible on the node
- [ ] **ML-3** Click pin → popover appears with comment body; Reply / Resolve / Delete buttons work
- [ ] **ML-4** Escape or click-outside on empty overlay — no thread created
- [ ] **ML-5** Alt+click the same node a second time while overlay is open — doesn't duplicate overlay

---

### 2.M  Voice extension (session10a / session10b)

Prerequisites: `accordo-voice` loaded in EDH, Whisper.cpp and kokoro-js installed.

- [ ] **MM-1** EDH status bar shows `🔊 Voice: Ready`
- [ ] **MM-2** Click the status bar item while idle — VS Code Settings opens filtered to `accordo.voice`
- [ ] **MM-3** MCP tool `accordo_voice_readAloud {text:"Integration test."}` — audio plays via speakers
- [ ] **MM-4** While audio is playing, click **Stop** in Voice panel — playback stops immediately
- [ ] **MM-5** `accordo_voice_setPolicy {narrationMode:"narrate-summary"}` — Hub `/instructions` now contains `## Voice` section with `narrate-summary` directive
- [ ] **MM-6** `accordo_voice_setPolicy {narrationMode:"narrate-off"}` — `## Voice` section shows status/mode only, no directive
- [ ] **MM-7** `accordo_voice_setPolicy {narrationMode:"narrate-everything"}` — directive says to pass full response text to `readAloud`
- [ ] **MM-8** Ask agent a multi-sentence question with `narrate-summary` active — agent calls `readAloud` at the end with a 2–3 sentence summary
- [ ] **MM-9** With kokoro-js removed/renamed — EDH status bar shows `🔇 Voice: Off`; warning notification fires

---

### 2.N  Script extension (session10d)

Prerequisites: `accordo-script` loaded in EDH.

- [ ] **MN-1** `accordo_script_status {}` returns `{ state:"idle", currentStep:-1, totalSteps:0 }`
- [ ] **MN-2** `accordo_script_run {steps:[]}` returns `{ error:"Invalid script: steps must be an array of 1–200 steps" }`
- [ ] **MN-3** `accordo_script_run` with unknown step type returns validation error naming the bad type
- [ ] **MN-4** `accordo_script_run` with `delay.ms:99999` returns `{ error:"... must be between 1 and 30000" }`
- [ ] **MN-5** `accordo_script_run` with a `subtitle` step — status bar shows subtitle text for specified duration; tool responds within ~10 ms (fire-and-forget)
- [ ] **MN-6** `accordo_script_status` while script is running returns `{ state:"running", ... }`
- [ ] **MN-7** `accordo_script_run` while another script is running returns `{ error:"Script already running ..." }`
- [ ] **MN-8** `accordo_script_run` with `highlight` step — target file opens; lines highlighted; `clear-highlights` step removes them
- [ ] **MN-9** `accordo_script_run` with `command` step (`workbench.action.showCommands`) — Command Palette opens in EDH
- [ ] **MN-10** `accordo_script_stop {}` during a running script — script stops; subsequent `status` returns `idle`

---

## Progress Summary

| Tier | Total checks | Completed | Remaining |
|---|---|---|---|
| CLI / Node.js | 42 | 42 | 0 |
| Manual (EDH) | ~65 | 0 | ~65 |
| **Total** | **~107** | **42** | **~65** |

**CLI tier complete.** All 42 checks verified (session + automated). Ready for EDH manual tier.
