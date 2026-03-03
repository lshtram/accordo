# Manual Testing Guide — accordo-editor (Modules 16 + 17)

This guide walks you through manually verifying each of the 11 editor tools
implemented in modules 16 and 17. All scenarios can be executed via any MCP
client connected to `accordo-hub`, or directly through the Hub REST API.

---

## Prerequisites

1. Build all packages: `pnpm build`
2. Start the Hub:
   ```
   ACCORDO_TOKEN=demo-token ACCORDO_BRIDGE_SECRET=demo-secret \
     node packages/hub/dist/index.js --port 3000
   ```
3. Open VS Code with the `accordo-bridge` extension installed and active  
   (status bar shows "Accordo: Connected").
4. Have a workspace folder open with at least one TypeScript file, for example:
   `/workspace/src/index.ts`  
   `/workspace/src/util.ts`

---

## Tool call format

Send a POST to `http://localhost:3000/tools/:toolName` with:
```json
{ "arguments": { ...args } }
```
Header: `Authorization: Bearer demo-token`

Or use the MCP client's tool-call interface directly.

---

## §4.1 `accordo.editor.open`

**Scenario 1 — open by absolute path**
```json
{ "path": "/workspace/src/index.ts" }
```
Expected: file opens in the editor.  
Response: `{ "opened": true, "path": "/workspace/src/index.ts" }`

**Scenario 2 — open with line and column**
```json
{ "path": "/workspace/src/index.ts", "line": 10, "column": 5 }
```
Expected: file opens with cursor on line 10, col 5.

**Scenario 3 — relative path**
```json
{ "path": "src/index.ts" }
```
Expected: resolved against workspace root and opened.

**Scenario 4 — outside workspace (error)**
```json
{ "path": "/etc/passwd" }
```
Expected response: `{ "error": "Path is outside workspace: /etc/passwd" }`

**Scenario 5 — file not found (error)**
```json
{ "path": "/workspace/nonexistent.ts" }
```
Expected response: `{ "error": "..." }` (showTextDocument rejects)

---

## §4.2 `accordo.editor.close`

**Setup:** open two files — `src/index.ts` and `src/util.ts`.

**Scenario 1 — close active editor (no path)**
```json
{}
```
Expected: the currently-focused tab closes.  
Response: `{ "closed": true }`

**Scenario 2 — close specific file by path**
```json
{ "path": "/workspace/src/util.ts" }
```
Expected: that tab closes; `src/index.ts` remains open.

**Scenario 3 — no active editor (error)**
Close all tabs, then:
```json
{}
```
Expected: `{ "error": "No active editor to close" }`

**Scenario 4 — file not open (error)**
```json
{ "path": "/workspace/src/notopen.ts" }
```
Expected: `{ "error": "File is not open: /workspace/src/notopen.ts" }`

---

## §4.3 `accordo.editor.scroll`

**Setup:** open a file longer than one screen.

**Scenario 1 — scroll down by page**
```json
{ "direction": "down" }
```
Expected: viewport scrolls down one page.  
Response: `{ "line": <new first visible line (1-based)> }`

**Scenario 2 — scroll up by page**
```json
{ "direction": "up" }
```
Expected: viewport scrolls up.

**Scenario 3 — scroll down by line**
```json
{ "direction": "down", "by": "line" }
```
Expected: scrolls exactly one line.

**Scenario 4 — no active editor (error)**
Close all tabs, then:
```json
{ "direction": "down" }
```
Expected: `{ "error": "No active editor" }`

---

## §4.4 `accordo.editor.highlight`

**Setup:** open `/workspace/src/index.ts` in a visible editor.

**Scenario 1 — highlight lines 3–7 (default yellow)**
```json
{ "path": "/workspace/src/index.ts", "startLine": 3, "endLine": 7 }
```
Expected: lines 3–7 get a yellow background highlight.  
Response: `{ "highlighted": true, "decorationId": "accordo-decoration-1" }`

**Scenario 2 — highlight with custom color**
```json
{
  "path": "/workspace/src/index.ts",
  "startLine": 10,
  "endLine": 10,
  "color": "rgba(255,0,0,0.4)"
}
```
Expected: line 10 gets a red background.

**Scenario 3 — startLine > endLine (error)**
```json
{ "path": "/workspace/src/index.ts", "startLine": 10, "endLine": 5 }
```
Expected: `{ "error": "startLine must be <= endLine" }`

**Scenario 4 — file not visible (error)**
```json
{ "path": "/workspace/src/notopen.ts", "startLine": 1, "endLine": 1 }
```
Expected: `{ "error": "File is not open: /workspace/src/notopen.ts. Open it first." }`

**Scenario 5 — line out of range (error)**
```json
{ "path": "/workspace/src/index.ts", "startLine": 1, "endLine": 9999 }
```
Expected: `{ "error": "Line 9999 is out of range (file has <N> lines)" }`

---

## §4.5 `accordo.editor.clearHighlights`

**Setup:** run §4.4 Scenario 1 and 2 so two decorations exist.

**Scenario 1 — clear specific decoration**
```json
{ "decorationId": "accordo-decoration-1" }
```
Expected: the yellow highlight on lines 3–7 disappears.  
Response: `{ "cleared": true, "count": 1 }`

**Scenario 2 — clear all**
```json
{}
```
Expected: all remaining highlights disappear.  
Response: `{ "cleared": true, "count": <N remaining> }`

**Scenario 3 — decoration not found (error)**
```json
{ "decorationId": "accordo-decoration-999" }
```
Expected: `{ "error": "Decoration not found: accordo-decoration-999" }`

---

## §4.6 `accordo.editor.split`

**Setup:** have one editor group open (one file visible).

**Scenario 1 — split right**
```json
{ "direction": "right" }
```
Expected: a second editor column appears to the right.  
Response: `{ "groups": 2 }`

**Scenario 2 — split down**
```json
{ "direction": "down" }
```
Expected: a third editor group appears below.  
Response: `{ "groups": 3 }`

---

## §4.7 `accordo.editor.focus`

**Setup:** have 3 editor groups open (from §4.6 above).

**Scenario 1 — focus group 1**
```json
{ "group": 1 }
```
Expected: leftmost/topmost group becomes active.  
Response: `{ "focused": true, "group": 1 }`

**Scenario 2 — focus group 2**
```json
{ "group": 2 }
```
Expected: second group becomes active.

**Scenario 3 — group does not exist (error)**
```json
{ "group": 5 }
```
Expected: `{ "error": "Editor group 5 does not exist (max: 3)" }`

---

## §4.8 `accordo.editor.reveal`

**Scenario 1 — reveal existing file**
```json
{ "path": "/workspace/src/index.ts" }
```
Expected: Explorer sidebar opens/focuses with the file highlighted.  
Response: `{ "revealed": true, "path": "/workspace/src/index.ts" }`

**Scenario 2 — file does not exist (error)**
```json
{ "path": "/workspace/src/ghost.ts" }
```
Expected: `{ "error": "File not found: /workspace/src/ghost.ts" }`

---

## §4.17 `accordo.editor.save`

**Setup:** open `/workspace/src/index.ts`, make an edit so it has unsaved changes.

**Scenario 1 — save active editor (no path)**
```json
{}
```
Expected: file saves (dirty indicator disappears).  
Response: `{ "saved": true, "path": "/workspace/src/index.ts" }`

**Scenario 2 — save by path**
Make another file dirty, then:
```json
{ "path": "/workspace/src/util.ts" }
```
Expected: that file saves.

**Scenario 3 — no active editor (error)**
Close all tabs, then:
```json
{}
```
Expected: `{ "error": "No active editor to save" }`

**Scenario 4 — file not open (error)**
```json
{ "path": "/workspace/src/notopen.ts" }
```
Expected: `{ "error": "File is not open: /workspace/src/notopen.ts" }`

---

## §4.18 `accordo.editor.saveAll`

**Setup:** open 3 files, make edits so all 3 show unsaved changes.

**Scenario 1 — save all**
```json
{}
```
Expected: all 3 files save simultaneously.  
Response: `{ "saved": true, "count": 3 }`

**Scenario 2 — nothing dirty**
With no unsaved changes:
```json
{}
```
Expected: `{ "saved": true, "count": 0 }`

---

## §4.19 `accordo.editor.format`

**Setup:** open a TypeScript file with a formatter configured (e.g., Prettier or ESLint).

**Scenario 1 — format active editor (no path)**
```json
{}
```
Expected: file reformats.  
Response: `{ "formatted": true, "path": "/workspace/src/index.ts" }`

**Scenario 2 — format by path (file already visible)**
```json
{ "path": "/workspace/src/util.ts" }
```
Expected: that file's editor is focused first, then reformatted.

**Scenario 3 — no active editor (error)**
Close all tabs:
```json
{}
```
Expected: `{ "error": "No active editor to format" }`

**Scenario 4 — file not visible (error)**
```json
{ "path": "/workspace/src/notopen.ts" }
```
Expected: `{ "error": "File is not open: /workspace/src/notopen.ts. Open it first." }`

---

## Regression quick-check

After all the above:

1. Run `pnpm build` — should exit 0
2. Run `npx vitest run` in `packages/editor` — should show `113 passed`
3. Check VS Code's Problems panel — should have no new errors in `packages/editor/src/`

---

## Automated test coverage reference

| Tool | Test file | Requirement IDs covered |
|---|---|---|
| `editor.open` | editor.test.ts §4.1 | OPEN-01..06, OPEN-R01 |
| `editor.close` | editor.test.ts §4.2 | CLOSE-01..04, CLOSE-R01 |
| `editor.scroll` | editor.test.ts §4.3 | SCROLL-01..04, SCROLL-R01 |
| `editor.highlight` | editor.test.ts §4.4 | HL-01..08 |
| `editor.clearHighlights` | editor.test.ts §4.5 | CLR-01..05 |
| `editor.split` | editor.test.ts §4.6 | SPLIT-01..02, SPLIT-R01 |
| `editor.focus` | editor.test.ts §4.7 | FOCUS-01..05, MAP-01..10, FOCUS-R01 |
| `editor.reveal` | editor.test.ts §4.8 | REVEAL-01..02 |
| `editor.save` | editor.test.ts §4.17 | SAVE-01..05, SAVE-R01..02 |
| `editor.saveAll` | editor.test.ts §4.18 | SAVEALL-01..03, SAVEALL-R01 |
| `editor.format` | editor.test.ts §4.19 | FMT-01..04, FMT-R01 |
| `util.resolvePath` | util.test.ts §5.1 | ABS-01..06, REL-01..04, EDGE-01..02 |
| `util.wrapHandler` | util.test.ts §5.2 | OK-01..02, ERR-01..02, SERIAL-01..02, ASYNC-01 |
