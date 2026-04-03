# Feature Gaps Discovered During MCP Tool Testing

**Date:** 2026-03-30
**Session:** End-to-end MCP interface testing

---

## Fixed This Session

### ✅ Diagram `<br>` line breaks not rendering in Excalidraw

**Impact:** Labels with `<br>` showed as single line instead of multi-line

**Fix:** Added `mermaidLabelToExcalidraw()` function in `canvas-generator.ts` to convert `<br>` and `<br/>` to `\n` for Excalidraw text elements.

**Files changed:**
- `packages/diagram/src/canvas/canvas-generator.ts`

---

## High Priority

### 1. `accordo_voice_readAloud` missing `block` parameter

**Impact:** CRITICAL for script runner - presentation narration cannot sequence steps properly

**Details:**
- `inputSchema` in `packages/voice/src/tools/read-aloud.ts` lacks `block` property
- Script runner (`packages/script/src/script-runner.ts`) passes `block: true/false` to `speakText`
- `doSpeakText` in `packages/voice/src/voice-narration.ts` handles `block` correctly
- But MCP tool `accordo_voice_readAloud` has no way to receive `block` from agent calls

**Fix needed:**
1. Add `block` to inputSchema (type: boolean, default: true)
2. When `block: true`, await `streamSpeak` promise instead of fire-and-forget
3. When `block: false`, keep current fire-and-forget behavior

**Files:**
- `packages/voice/src/tools/read-aloud.ts` - add `block` to inputSchema and handler

---

### 2. `accordo_script_run` returns "Invalid JSON" error

**Impact:** HIGH - script runner tool doesn't work

**Details:**
- Tool returns error when called with valid NarrationScript
- Needs investigation - may be schema validation issue or handler bug

**Investigation needed:**
- Check `packages/script/src/tools/run-script.ts` handler
- Check `packages/script/src/script-types.ts` validation
- Test with minimal script: `{"steps":[{"type":"speak","text":"Hello"}]}`

---

## Medium Priority

### 3. No MCP tool to toggle md-viewer preview panel

**Impact:** MEDIUM - cannot control markdown preview from agent

**Details:**
- `accordo_editor_*` tools cover file operations but not preview
- VS Code has `markdown.showPreview` and `markdown.showPreviewToSide` commands
- Need `accordo_md_preview_toggle(path)` or similar

**Suggested implementation:**
- Add new tool in `packages/editor/src/tools/` or new package
- Wrap `vscode.commands.executeCommand('markdown.showPreview', {resource: uri})`

---

### 4. Bottom panel not mapped in `accordo_panel_toggle`

**Impact:** MEDIUM - cannot toggle terminal/output/problems panels

**Details:**
- `PANEL_COMMANDS` in panel-toggle tool only maps left sidebar panels:
  - `explorer`, `search`, `git`, `debug`, `extensions`
- Bottom panels need different VS Code commands:
  - Terminal: `workbench.action.terminal.toggleTerminal`
  - Output: `workbench.action.output.toggleOutput`
  - Problems: `workbench.actions.view.problems`

**Files:**
- `packages/editor/src/tools/panel-toggle.ts`

---

## Low Priority

### 5. No tool to toggle VS Code Copilot Chat panel

**Impact:** LOW - nice to have for full IDE control

**Details:**
- Would need VS Code commands like `copilot.panel.focus`
- May require Copilot extension to be installed

---

## Testing Notes

### Tools Verified Working
- `accordo_editor_open` ✓
- `accordo_editor_close` ✓
- `accordo_editor_scroll` ✓
- `accordo_editor_split` ✓
- `accordo_editor_focus` ✓
- `accordo_editor_reveal` ✓
- `accordo_editor_highlight` ✓
- `accordo_editor_clearHighlights` ✓
- `accordo_editor_save` ✓
- `accordo_editor_saveAll` ✓
- `accordo_editor_format` ✓
- `accordo_terminal_open` ✓
- `accordo_terminal_run` ✓
- `accordo_terminal_focus` ✓
- `accordo_terminal_list` ✓
- `accordo_terminal_close` ✓
- `accordo_panel_toggle` ✓ (left sidebar panels only)
- `accordo_layout_zen` ✓
- `accordo_layout_fullscreen` ✓
- `accordo_layout_joinGroups` ✓
- `accordo_layout_evenGroups` ✓
- `accordo_layout_state` ✓
- `accordo_comment_*` tools ✓
- `accordo_diagram_*` tools ✓
- `accordo_presentation_*` tools ✓
- `accordo_voice_readAloud` ✓ (fire-and-forget only)
- `accordo_voice_dictation` ✓
- `accordo_voice_setPolicy` ✓
- `accordo_voice_discover` ✓

### Tools Needing Investigation
- `accordo_script_run` - "Invalid JSON" error
- `accordo_script_stop` - depends on script_run working
- `accordo_script_status` - depends on script_run working
- `accordo_script_discover` - should work, needs testing

---

## Session Context

This document was created during end-to-end MCP interface testing after fixing Hub startup issues:
1. Hub spawn (Node.js executable resolution)
2. MCP config sync (writeAgentConfigs never called)
3. Reauth contract drift (field name inconsistency)
4. Command ID mismatch (package.json vs code registration)
5. Hub entry guard (symlink path resolution)
6. dev-health.sh port reading

All fixes committed in: `6f1e6b0 fix: resolve Hub spawn, MCP config sync, and protocol contract issues`