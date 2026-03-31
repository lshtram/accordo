# Accordo IDE — Active Workplan (Open Items Only)

**Date:** 2026-03-31  
**Status:** Wave 1 + Priority 0 complete — 9 open items (4 browser, 3 editor/voice/script, 2 diagram), 4 later  
**Purpose:** this file tracks only pending work. Completed work moved to `docs/00-workplan/accomplished-tasks.md`.

---

## 1) Current Operating Priorities

### ~~Priority 0 — Critical fixes (D2 review gap — found via live E2E)~~ ✅ RESOLVED

`browser_diff_snapshots` action-failed cascade fixed via B2-CTX-000 (`2a20512`). Root cause was `browser_get_semantic_graph` content-script stub throwing "not implemented". Semantic graph now implemented via `collectSemanticGraph()`. Remaining item (D2-001: add "requires live E2E" flag to checklist) moved to Later queue.

---

### Priority A — Browser continuity for agents (MUST-HAVE)

**Problem:** current `browser_*` tools are active-tab scoped, so agent context can break when users switch tabs.  
**Requirement:** if a tab is open, agent must be able to keep reading/inspecting it without forcing user focus.

**Planned deliverables:**
1. ~~Add `browser_list_pages` + `browser_select_page` (prerequisite for all tab targeting)~~ ✅ **DONE** (`2a1cf9b`, `9c3fa9f`)
2. Add tab-scoped targeting contract: `tabId` on remaining understanding tools:
   - `browser_capture_region` — add `tabId` param
   - `browser_diff_snapshots` — add `tabId` param
   (7 tools already done in B2-CTX-001: `browser_wait_for`, `browser_get_text_map`, `browser_get_semantic_graph`, `browser_list_pages`, `browser_select_page`, `browser_inspect_element`, `browser_capture_region` has `pageId` only — needs `tabId`)
3. Verify non-active tab workflows: Chrome CDP routing for background tabs, Hub registration for `browser_get_text_map` + `browser_get_semantic_graph`, `diff_snapshots` internal state for background tabs.
4. Add E2E smoke tests for context continuity under tab switching.

**Success criteria:**
- Agent can keep operating on a previously selected tab while user works elsewhere.
- No `active tab required` failure for core read/understanding flows.

---

### ~~Priority B — Wave 1 modularity cleanup~~ ✅ FULLY COMPLETE

Phase 1 (bridge-types split) and Phase 2 (5 parallel agents: hub, bridge, voice/diagram/editor, comments, browser-extension) plus all P2 cleanup items are done. See `docs/00-workplan/accomplished-tasks.md` for details.

### Priority C — E2E evaluation follow-through

Reference: `docs/50-reviews/mcp-webview-evaluation-e2e-2026-03-29.md`

Current score: **26/45** (revised down after live E2E run found `diff_snapshots` completely broken).

Targeted upgrades:
1. Multi-tab targeting support (Priority A) — largest productivity impact.
2. Improve `browser_diff_snapshots` reliability for implicit DOM flows.
3. Add explicit geometry helpers (`leftOf/above/contains/overlap/distance`).
4. Add viewport + full-page screenshot APIs on `browser_*` surface.
5. Add explicit privacy/audit/retention controls on browser tool surface.

---

### Priority F — Diagram tool gaps (found during live testing, 2026-03-31)

| # | Gap | Priority | Status |
|---|---|---|---|
| F-1 | Style persistence: position changes are saved correctly ✅ | — | **FIXED** |
| F-2 | Style persistence: fill type (strokeStyle, fillStyle) not being saved | MEDIUM | **FIXED** (`abba06f`) |
| F-3 | Style persistence: font type (fontFamily) not being saved | MEDIUM | **FIXED** (`abba06f`) |
| F-4 | Style guide updates: added newline (`\\n`) and dark font color guidance | — | **DONE** |
| F-5 | Newline rendering: `normalizeLabel()` converts Mermaid `\\n` → actual newline for Excalidraw | — | **DONE** |
| F-6 | Ctrl+F search: works in built-in markdown preview but not in accordo markdown preview | MEDIUM | Open |

---

### Priority G — Comments bugs (found during live testing, 2026-03-31)

| # | Gap | Priority | Status |
|---|---|---|---|
| G-1 | Comments on .md files in accordo markdown preview not rendering | **HIGH** | Open |
| G-2 | Alt+click on diagram edges inconsistently opens comment dialog (shapes always work) | **HIGH** | Open |
| G-3 | Comment pins don't track diagram viewport movement (pins stay fixed when panning) | MEDIUM | Open |

**G-1 detail:** The accordo markdown preview does not show comment threads overlaid on the rendered markdown. The built-in VS Code markdown preview shows comments; our preview does not. Likely missing the comment overlay/renderer integration in `commentable-preview.ts`.

**G-2 detail:** Alt+click on diagram shapes always opens the comment dialog. Alt+click on edges only works sometimes — possibly a hit-testing issue where edges are rendered in an SVG layer that doesn't receive pointer events the same way as shapes.

**G-3 detail:** When panning the diagram canvas, comment pins stay at their original viewport coordinates instead of moving with the content. The pin positions should be relative to the diagram content, not the viewport.

**F-2 detail:** When user changes fill type (e.g., from hachure to solid), the change is not persisted to layout.json. Likely the `canvas:node-styled` message handler or `patchNode` not properly saving all style fields.

**F-3 detail:** When user changes font family (e.g., Excalifont to Nunito), the change is not persisted. Same root cause as F-2.

**Root cause hypothesis:** The `handleNodeStyled` in `panel-core.ts` patches `style` via `patchNode`, but only certain fields may be whitelisted or the reconciliation between canvas-generated styles and stored styles may be dropping changes.

---

### Priority E — Editor/Voice/Script feature gaps (found during live MCP testing)

**Source:** live E2E MCP tool testing session, 2026-03-30  
**Context:** after fixing Hub spawn, MCP config sync, and protocol contract issues (`6f1e6b0`), a full MCP interface sweep found these gaps.

| # | Gap | Priority | Status |
|---|---|---|---|
| E-1 | `voice_readAloud` missing `block` parameter — script narration cannot sequence steps | **HIGH** | Open |
| E-2 | `script_run` returns "Invalid JSON" error — tool completely non-functional | **HIGH** | Open |
| E-3 | No MCP tool to toggle markdown preview panel | MEDIUM | Done — auto-open .md in preview via `accordo_editor_open` (8cb86b1) |
| E-4 | `panel_toggle` only maps left sidebar — missing terminal/output/problems | MEDIUM | Done (superseded by E-6) |
| E-5 | No tool to toggle VS Code Copilot Chat panel | LOW | Open |
| E-6 | Bar tools redesign: single `accordo_layout_panel(area, view, action)` tool with `BarState` tracker (`unknown\|open\|closed`) — replaces E-4 toggle approach and original 6-tool design | **HIGH** | ✅ **DONE** — 55 tests pass, MCP + script runner both work; design: `docs/00-workplan/e-6-bar-tools.md` |

**E-1 detail:** `inputSchema` in `packages/voice/src/tools/read-aloud.ts` lacks `block` property. Script runner passes `block: true/false` to `speakText`, and `doSpeakText` handles it correctly, but the MCP tool has no way to receive it. Fix: add `block` (boolean, default: true) to inputSchema and handler.

**E-2 detail:** `accordo_script_run` returns "Invalid JSON" on valid NarrationScript input. Needs investigation in `packages/script/src/tools/run-script.ts` and `packages/script/src/script-types.ts`. Test with minimal: `{"steps":[{"type":"speak","text":"Hello"}]}`.

**E-3 detail:** `accordo_editor_*` tools cover file operations but not preview. VS Code has `markdown.showPreview` / `markdown.showPreviewToSide`. Need a new tool wrapping these commands.

**E-4 detail (superseded by E-6):** Initial implementation of bottom panel support in `panel_toggle` done. Superseded by E-6 redesign — explicit open/close semantics with state tracker replace toggle semantics.

**E-6 detail:** Single tool `accordo_layout_panel({ area, view?, action })`. Area-level open/close + optional view-level open. `BarState` tracker: `{ sidebar: "unknown"|"open"|"closed", panel: "...", rightBar: "..." }`. Unknown→close forces open then close. Free-string `view` with hardcoded fallback + heuristic for third-party views. Stubs in `packages/editor/src/tools/bar.ts` (handler throws "not implemented"). Design: `docs/00-workplan/e-6-bar-tools.md`.

**E-5 detail:** Would need `copilot.panel.focus` or similar. Requires Copilot extension installed. Low priority.

**Verified working tools (reference):**
`editor_open`, `editor_close`, `editor_scroll`, `editor_split`, `editor_focus`, `editor_reveal`, `editor_highlight`, `editor_clearHighlights`, `editor_save`, `editor_saveAll`, `editor_format`, `terminal_open`, `terminal_run`, `terminal_focus`, `terminal_list`, `terminal_close`, `panel_toggle` (sidebar only), `layout_zen`, `layout_fullscreen`, `layout_joinGroups`, `layout_evenGroups`, `layout_state`, `comment_*`, `diagram_*`, `presentation_*`, `voice_readAloud` (fire-and-forget only), `voice_dictation`, `voice_setPolicy`, `voice_discover`.

**Needs investigation:** `script_run`, `script_stop`, `script_status`, `script_discover`.

---

### Priority D — Cross-project backlog (non-browser, still open)

These items were pending in prior plans and remain in scope. They are not browser-only work and must stay visible in the active workplan.

#### ~~D1. Wave 1 modularity tasks outside browser stack~~ ✅ COMPLETE

All items completed in Phase 2 (B1–B5) and P2 cleanup:
1. ~~`packages/bridge/src/extension.ts` decomposition~~ ✅ B2
2. ~~`packages/hub/src/server.ts` decomposition~~ ✅ B1
3. ~~`packages/comments` hotspot decomposition~~ ✅ B4
4. ~~`packages/bridge-types/src/index.ts` domain split~~ ✅ MOD-P1-01
5. ~~Voice and diagram hotspot splits~~ ✅ B3

#### D2. Cross-cutting technical debt still open

1. **TD-CROSS-2 (uniform logging):**
   - VSCode packages to `LogOutputChannel`
   - Hub structured logger (`pino`)
   - consistent logger interface and test mocks

#### D3. Outstanding non-browser validation/documentation tasks

1. Session 11b D3 manual checklist completion (diagram comments bridge).
2. Voice deferred item: inter-sentence silence investigation/trim strategy.
3. Documentation reorganization closeout:
   - remove stale duplicate index references
   - keep active vs archive boundaries explicit
   - keep package/module map docs up to date

#### D4. Planned next non-browser product module

1. **M95-VA Visual Annotation Layer** (next queued product module from earlier plan baseline).

---

## 2) Execution Queue — Open Items Only

**Priority A — Browser continuity (tab-scoped targeting)**
1. **B2-CTX-002** — add `tabId` param to `browser_capture_region`.
2. **B2-CTX-003** — add `tabId` param to `browser_diff_snapshots`.
3. **B2-CTX-004** — verify CDP routing for background tabs, Hub registration for text_map + semantic_graph, `diff_snapshots` internal state for non-active tabs.
4. **B2-CTX-005** — E2E continuity tests under tab switching (Playwright or similar).

**Priority E — Editor/Voice/Script gaps (from live MCP testing)**
5. **E-1** — add `block` param to `voice_readAloud` MCP tool inputSchema + handler.
6. **E-2** — fix `script_run` "Invalid JSON" error — investigate handler + types.
7. **~~E-3~~** — ✅ **DONE** — `accordo_editor_open` auto-routes .md → preview, .mmd → diagram (8cb86b1)
8. **~~E-4~~** — ✅ **DONE (superseded by E-6)** — bottom panel support in `panel_toggle` implemented; replaced by E-6 redesign.

**Priority E (new) — Bar tools redesign**
9. **~~E-6~~** — ✅ **DONE** (`6d63faf`) — 55 tests, live demo verified; commit: `feat(editor): E-6 Bar Tools`

**Priority F — Diagram style persistence (from live testing)**
10. **~~F-2~~** — ✅ **FIXED** (`abba06f`) — fillStyle + strokeStyle detection + fillStyle passthrough
11. **~~F-3~~** — ✅ **FIXED** (`abba06f`) — fontFamily detection with REVERSE_FONT_FAMILY_MAP

**Later (not in current wave)**
14. **E-5** — VS Code Copilot Chat panel toggle (low priority, extension dependency).
15. **D2-001** — add "requires live E2E" flag to D2 checklist for CDP/DOM tools.
16. **TD-CROSS-2** — uniform logging migration.
17. **M95-VA** — visual annotation layer planning kickoff.

---

## 3) Guardrails

- Keep TDD phase gates and reviewer checkpoints mandatory.
- Keep this file forward-looking only; move completed items to `accomplished-tasks.md`.
- For each new module, attach requirement IDs + test evidence + review artifact.
