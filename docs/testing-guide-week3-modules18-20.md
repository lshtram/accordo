# Manual Testing Guide — accordo-editor (Modules 18 + 19 + 20)

> **Goal:** Verify all 13 terminal, workspace, and layout tools work end-to-end through VS Code.
> Every command in this guide is a complete copy-paste line. No editing required except replacing file paths with ones that exist on your machine.

---

## Part 1 — Get everything running

**Step 1.** Open a terminal inside the project folder and build everything:
```
pnpm build
```
Wait until you see the build finish with no errors.

**Step 2.** Press **F5** in VS Code to start a debug session.
Wait until the status bar at the bottom shows **Accordo: Connected**.
If you do not see that, open the Command Palette (`Cmd+Shift+P`) and run **Accordo: Show Hub Log** to see what went wrong.

**Step 3.** Open a second terminal and confirm the Hub is running with all tools registered:
```
curl -s http://localhost:3000/health
```
You must see `"bridge":"connected"` and `"toolCount":21` in the response before going further.
If `toolCount` is 0 or 11, wait 5 seconds and run the command again. A count of 11 means only the editor tools from the previous session loaded — restart the debug session with F5.

**Step 4.** Read your token into a variable:
```
TOKEN=$(cat ~/.accordo/token)
```
Verify it worked:
```
echo $TOKEN
```
You should see a UUID like `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`.

**Step 5.** Start an MCP session. Run this whole block at once:
```
curl -si -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"manual-test","version":"1.0"}}}' \
  | grep -i mcp-session-id
```
You will see a line like:
```
Mcp-Session-Id: 550e8400-e29b-41d4-a716-446655440000
```
Copy the UUID part and save it:
```
SESSION=550e8400-e29b-41d4-a716-446655440000
```
(Replace the UUID with the one you actually got.)

**Step 6.** Complete the handshake:
```
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Mcp-Session-Id: $SESSION" \
  -d '{"jsonrpc":"2.0","method":"initialized","params":{}}'
```

**Step 7 (optional — confirm all 13 new tools are registered):**
```
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Mcp-Session-Id: $SESSION" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
  | python3 -c "import sys,json; tools=json.load(sys.stdin)['result']['tools']; [print(t['name']) for t in tools]"
```
You should see all 21 tool names. The 10 new ones are:
`accordo.terminal.open`, `accordo.terminal.run`, `accordo.terminal.focus`,
`accordo.terminal.list`, `accordo.terminal.close`,
`accordo.panel.toggle`, `accordo.layout.zen`, `accordo.layout.fullscreen`,
`accordo.layout.joinGroups`, `accordo.layout.evenGroups`.

> **Note:** `$TOKEN` and `$SESSION` must stay set in your terminal for all steps below.
> If you open a new terminal window you need to repeat Steps 4–6.

---

## Part 2 — Test each tool

Each call sends a POST to `http://localhost:3000/mcp`. The tool result is in the `content[0].text` field of the response. Pipe through `python3 -m json.tool` to pretty-print when you want to inspect the full response.

---

## Module 18 — Terminal tools (5 tools)

---

### Tool 1 of 13 — `accordo.terminal.open`

Creates a new terminal panel in VS Code and returns a stable ID you can use in subsequent calls.

**Setup:** No VS Code state required.

**Test 1a — open a terminal with a custom name**

Run:
```
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Mcp-Session-Id: $SESSION" \
  -d '{"jsonrpc":"2.0","id":10,"method":"tools/call","params":{"name":"accordo.terminal.open","arguments":{"name":"my-test-terminal"}}}' \
  | python3 -m json.tool
```

What you should see in VS Code:
A new terminal tab named **my-test-terminal** appears in the terminal panel.

What you should see in the response:
```json
{"terminalId": "accordo-terminal-1", "name": "my-test-terminal"}
```

Save the ID:
```
TID=accordo-terminal-1
```

**Test 1b — open a terminal with a custom cwd**

Run:
```
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Mcp-Session-Id: $SESSION" \
  -d '{"jsonrpc":"2.0","id":11,"method":"tools/call","params":{"name":"accordo.terminal.open","arguments":{"name":"rooted","cwd":"/tmp"}}}' \
  | python3 -m json.tool
```

What you should see in VS Code:
A second terminal tab named **rooted** appears, and if you run `pwd` inside it you will see `/tmp`.

What you should see in the response:
```json
{"terminalId": "accordo-terminal-2", "name": "rooted"}
```

---

### Tool 2 of 13 — `accordo.terminal.run`

Executes a shell command in a terminal. Shows a confirmation warning in VS Code before running because this is a destructive operation.

**Setup:** At least one terminal must be open. Use `$TID` set in Test 1a above.

**Test 2a — run a command in a specific terminal**

Run:
```
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Mcp-Session-Id: $SESSION" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":20,\"method\":\"tools/call\",\"params\":{\"name\":\"accordo.terminal.run\",\"arguments\":{\"command\":\"echo hello-from-accordo\",\"terminalId\":\"$TID\"}}}" \
  | python3 -m json.tool
```

What you should see in VS Code:
1. A warning notification pops up showing **accordo.terminal.run: echo hello-from-accordo**.
2. The terminal prints `hello-from-accordo`.

What you should see in the response:
```json
{"sent": true, "terminalId": "accordo-terminal-1"}
```

**Test 2b — missing command returns an error**

Run:
```
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Mcp-Session-Id: $SESSION" \
  -d '{"jsonrpc":"2.0","id":21,"method":"tools/call","params":{"name":"accordo.terminal.run","arguments":{}}}' \
  | python3 -m json.tool
```

What you should see in the response:
```json
{"error": "Argument 'command' must be a non-empty string"}
```

**Test 2c — unknown terminalId returns an error**

Run:
```
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Mcp-Session-Id: $SESSION" \
  -d '{"jsonrpc":"2.0","id":22,"method":"tools/call","params":{"name":"accordo.terminal.run","arguments":{"command":"ls","terminalId":"accordo-terminal-99"}}}' \
  | python3 -m json.tool
```

What you should see in the response:
```json
{"error": "Terminal accordo-terminal-99 not found"}
```

---

### Tool 3 of 13 — `accordo.terminal.focus`

Brings the terminal panel into focus without creating a new terminal.

**Setup:** The terminal panel should already be open from the previous tests.

**Test 3a — focus the terminal panel**

Run:
```
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Mcp-Session-Id: $SESSION" \
  -d '{"jsonrpc":"2.0","id":30,"method":"tools/call","params":{"name":"accordo.terminal.focus","arguments":{}}}' \
  | python3 -m json.tool
```

What you should see in VS Code:
The cursor moves to the terminal panel.

What you should see in the response:
```json
{"focused": true}
```

---

### Tool 4 of 13 — `accordo.terminal.list`

Returns all currently open terminals with their stable IDs and which one is active.

**Setup:** Have at least the two terminals open from Tests 1a and 1b.

**Test 4a — list all terminals**

Run:
```
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Mcp-Session-Id: $SESSION" \
  -d '{"jsonrpc":"2.0","id":40,"method":"tools/call","params":{"name":"accordo.terminal.list","arguments":{}}}' \
  | python3 -m json.tool
```

What you should see in the response:
```json
{
  "terminals": [
    {"terminalId": "accordo-terminal-1", "name": "my-test-terminal", "isActive": false},
    {"terminalId": "accordo-terminal-2", "name": "rooted", "isActive": true}
  ]
}
```
The exact `isActive` values will reflect whichever terminal is currently focused. Any terminal you opened manually in VS Code (not via this tool) will show `"terminalId": "(untracked)"`.

---

### Tool 5 of 13 — `accordo.terminal.close`

Closes a terminal by its stable ID and removes it from the map.

**Setup:** Use `$TID` (accordo-terminal-1) from Test 1a.

**Test 5a — close a terminal**

Run:
```
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Mcp-Session-Id: $SESSION" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":50,\"method\":\"tools/call\",\"params\":{\"name\":\"accordo.terminal.close\",\"arguments\":{\"terminalId\":\"$TID\"}}}" \
  | python3 -m json.tool
```

What you should see in VS Code:
The **my-test-terminal** tab disappears from the terminal panel.

What you should see in the response:
```json
{"closed": true, "terminalId": "accordo-terminal-1"}
```

**Test 5b — close an already-closed terminal returns an error**

Run the same command again immediately after Test 5a:
```
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Mcp-Session-Id: $SESSION" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":51,\"method\":\"tools/call\",\"params\":{\"name\":\"accordo.terminal.close\",\"arguments\":{\"terminalId\":\"$TID\"}}}" \
  | python3 -m json.tool
```

What you should see in the response:
```json
{"error": "Terminal accordo-terminal-1 not found"}
```

**Test 5c — stale entry cleanup (close from VS Code, not via tool)**

1. Open a new terminal inside VS Code using the `+` button in the terminal panel.
2. Run `accordo.terminal.list` (Test 4a) — note the new terminal appears as `"(untracked)"`.
3. Close that terminal by clicking the trash icon in VS Code.
4. Run `accordo.terminal.list` again — the closed terminal should no longer appear in the list.

---

## Module 19 — Workspace tools (3 tools)

---

### Tool 6 of 13 — `accordo.workspace.getTree`

Returns the workspace file structure as a nested tree. Respects `.gitignore` and VS Code `files.exclude` settings.

**Setup:** Have a folder open in VS Code (the project folder is fine).

**Test 6a — get the tree with default depth**

Run:
```
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Mcp-Session-Id: $SESSION" \
  -d '{"jsonrpc":"2.0","id":60,"method":"tools/call","params":{"name":"accordo.workspace.getTree","arguments":{}}}' \
  | python3 -m json.tool
```

What you should see in the response:
```json
{
  "tree": [
    {"name": "docs", "type": "directory", "children": [...]},
    {"name": "packages", "type": "directory", "children": [...]},
    {"name": "package.json", "type": "file"},
    {"name": "pnpm-workspace.yaml", "type": "file"}
  ]
}
```
The tree goes 3 levels deep by default. The `node_modules` folder and any entries in `.gitignore` will not appear.

**Test 6b — get the tree for a subdirectory**

Run:
```
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Mcp-Session-Id: $SESSION" \
  -d '{"jsonrpc":"2.0","id":61,"method":"tools/call","params":{"name":"accordo.workspace.getTree","arguments":{"path":"docs"}}}' \
  | python3 -m json.tool
```

What you should see in the response:
```json
{
  "tree": [
    {"name": "architecture.md", "type": "file"},
    {"name": "dev-process.md", "type": "file"},
    {"name": "requirements-editor.md", "type": "file"},
    {"name": "workplan.md", "type": "file"}
  ]
}
```
Only the files inside `docs/` appear.

**Test 6c — get the tree with depth 1**

Run:
```
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Mcp-Session-Id: $SESSION" \
  -d '{"jsonrpc":"2.0","id":62,"method":"tools/call","params":{"name":"accordo.workspace.getTree","arguments":{"depth":1}}}' \
  | python3 -m json.tool
```

What you should see in the response:
The `children` arrays inside top-level directories will be empty (`[]`), because depth 1 only lists the root's direct children without recursing further.

**Test 6d — path outside workspace returns an error**

Run:
```
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Mcp-Session-Id: $SESSION" \
  -d '{"jsonrpc":"2.0","id":63,"method":"tools/call","params":{"name":"accordo.workspace.getTree","arguments":{"path":"/etc"}}}' \
  | python3 -m json.tool
```

What you should see in the response:
```json
{"error": "Path is outside workspace: /etc"}
```

---

### Tool 7 of 13 — `accordo.workspace.search`

Full-text search across workspace files. Returns matching lines with file path, 1-based line and column numbers.

**Setup:** Have the project folder open in VS Code.

**Test 7a — search for a string that exists**

Run:
```
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Mcp-Session-Id: $SESSION" \
  -d '{"jsonrpc":"2.0","id":70,"method":"tools/call","params":{"name":"accordo.workspace.search","arguments":{"query":"terminalMap"}}}' \
  | python3 -m json.tool
```

What you should see in the response:
```json
{
  "results": [
    {"path": "packages/editor/src/tools/terminal.ts", "line": 18, "column": 1, "text": "export const terminalMap = new Map..."},
    ...
  ]
}
```
Each result has a relative path from the workspace root, 1-based line and column numbers, and up to 200 characters of matching line text.

**Test 7b — search scoped to a glob pattern**

Run:
```
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Mcp-Session-Id: $SESSION" \
  -d '{"jsonrpc":"2.0","id":71,"method":"tools/call","params":{"name":"accordo.workspace.search","arguments":{"query":"describe","include":"**/*.test.ts","maxResults":5}}}' \
  | python3 -m json.tool
```

What you should see in the response:
```json
{"results": [...]}
```
All returned `path` values will end in `.test.ts` and there will be at most 5 results.

**Test 7c — search for something that does not exist**

Run:
```
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Mcp-Session-Id: $SESSION" \
  -d '{"jsonrpc":"2.0","id":72,"method":"tools/call","params":{"name":"accordo.workspace.search","arguments":{"query":"xyzzyNeverFoundInProject"}}}' \
  | python3 -m json.tool
```

What you should see in the response:
```json
{"results": []}
```

**Test 7d — missing query returns an error**

Run:
```
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Mcp-Session-Id: $SESSION" \
  -d '{"jsonrpc":"2.0","id":73,"method":"tools/call","params":{"name":"accordo.workspace.search","arguments":{}}}' \
  | python3 -m json.tool
```

What you should see in the response:
```json
{"error": "Argument 'query' must be a non-empty string"}
```

---

### Tool 8 of 13 — `accordo.diagnostics.list`

Returns language-server diagnostics (errors, warnings, hints) from VS Code's Problems panel.

**Setup:** Have a TypeScript file open that has at least one error — for example, introduce a deliberate type error in any `.ts` file and save it.

**Test 8a — list all diagnostics**

Run:
```
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Mcp-Session-Id: $SESSION" \
  -d '{"jsonrpc":"2.0","id":80,"method":"tools/call","params":{"name":"accordo.diagnostics.list","arguments":{}}}' \
  | python3 -m json.tool
```

What you should see in the response:
```json
{
  "diagnostics": [
    {
      "path": "/Users/you/project/packages/editor/src/tools/terminal.ts",
      "line": 5,
      "column": 3,
      "severity": "error",
      "message": "Type 'string' is not assignable to type 'number'."
    }
  ]
}
```
Paths are absolute. Line and column numbers are 1-based.

**Test 8b — filter to errors only**

Run:
```
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Mcp-Session-Id: $SESSION" \
  -d '{"jsonrpc":"2.0","id":81,"method":"tools/call","params":{"name":"accordo.diagnostics.list","arguments":{"severity":"error"}}}' \
  | python3 -m json.tool
```

What you should see in the response:
Only items with `"severity": "error"` appear. Warnings and hints are absent.

**Test 8c — filter to warnings (includes errors + warnings)**

Run:
```
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Mcp-Session-Id: $SESSION" \
  -d '{"jsonrpc":"2.0","id":82,"method":"tools/call","params":{"name":"accordo.diagnostics.list","arguments":{"severity":"warning"}}}' \
  | python3 -m json.tool
```

What you should see in the response:
Items with `"severity": "error"` and `"severity": "warning"` appear. Hints and information messages are absent. The `severity` filter is a minimum threshold — "warning" means "at least as severe as a warning".

**Test 8d — scope to a specific file**

Run (replace the path with an absolute path to any `.ts` file in your workspace):
```
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Mcp-Session-Id: $SESSION" \
  -d '{"jsonrpc":"2.0","id":83,"method":"tools/call","params":{"name":"accordo.diagnostics.list","arguments":{"path":"/Users/Shared/dev/accordo/packages/editor/src/tools/terminal.ts"}}}' \
  | python3 -m json.tool
```

What you should see in the response:
Only diagnostics for that file appear. Every result's `path` field matches the path you passed.

---

## Module 20 — Layout tools (5 tools)

---

### Tool 9 of 13 — `accordo.panel.toggle`

Toggles the visibility of a VS Code sidebar panel (Explorer, Search, Source Control, Run & Debug, or Extensions).

**Setup:** No special state required.

**Test 9a — toggle the Explorer panel**

Run:
```
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Mcp-Session-Id: $SESSION" \
  -d '{"jsonrpc":"2.0","id":90,"method":"tools/call","params":{"name":"accordo.panel.toggle","arguments":{"panel":"explorer"}}}' \
  | python3 -m json.tool
```

What you should see in VS Code:
The Explorer sidebar opens (or closes if it was already open).

What you should see in the response:
```json
{"visible": true, "panel": "explorer"}
```

**Test 9b — toggle each of the five panels in turn**

Run each command and watch the corresponding sidebar icon become active in VS Code:

Search panel:
```
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Mcp-Session-Id: $SESSION" \
  -d '{"jsonrpc":"2.0","id":91,"method":"tools/call","params":{"name":"accordo.panel.toggle","arguments":{"panel":"search"}}}' \
  | python3 -m json.tool
```

Source Control panel:
```
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Mcp-Session-Id: $SESSION" \
  -d '{"jsonrpc":"2.0","id":92,"method":"tools/call","params":{"name":"accordo.panel.toggle","arguments":{"panel":"git"}}}' \
  | python3 -m json.tool
```

Run and Debug panel:
```
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Mcp-Session-Id: $SESSION" \
  -d '{"jsonrpc":"2.0","id":93,"method":"tools/call","params":{"name":"accordo.panel.toggle","arguments":{"panel":"debug"}}}' \
  | python3 -m json.tool
```

Extensions panel:
```
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Mcp-Session-Id: $SESSION" \
  -d '{"jsonrpc":"2.0","id":94,"method":"tools/call","params":{"name":"accordo.panel.toggle","arguments":{"panel":"extensions"}}}' \
  | python3 -m json.tool
```

Each response will be:
```json
{"visible": true, "panel": "<panel-name>"}
```

**Test 9c — unknown panel returns an error**

Run:
```
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Mcp-Session-Id: $SESSION" \
  -d '{"jsonrpc":"2.0","id":95,"method":"tools/call","params":{"name":"accordo.panel.toggle","arguments":{"panel":"settings"}}}' \
  | python3 -m json.tool
```

What you should see in the response:
```json
{"error": "Unknown panel 'settings'. Valid panels: explorer, search, git, debug, extensions"}
```

---

### Tool 10 of 13 — `accordo.layout.zen`

Toggles Zen Mode — a distraction-free fullscreen view that hides all panels.

**Setup:** No special state required.

**Test 10a — enter Zen Mode**

Run:
```
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Mcp-Session-Id: $SESSION" \
  -d '{"jsonrpc":"2.0","id":100,"method":"tools/call","params":{"name":"accordo.layout.zen","arguments":{}}}' \
  | python3 -m json.tool
```

What you should see in VS Code:
VS Code enters Zen Mode — all sidebars and panels disappear, leaving only the editor.

What you should see in the response:
```json
{"active": true}
```

**Test 10b — exit Zen Mode**

Run the same command again:
```
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Mcp-Session-Id: $SESSION" \
  -d '{"jsonrpc":"2.0","id":101,"method":"tools/call","params":{"name":"accordo.layout.zen","arguments":{}}}' \
  | python3 -m json.tool
```

What you should see in VS Code:
VS Code exits Zen Mode and restores the normal layout.

What you should see in the response:
```json
{"active": true}
```

---

### Tool 11 of 13 — `accordo.layout.fullscreen`

Toggles fullscreen mode — expands the VS Code window to fill the entire screen.

**Setup:** No special state required.

**Test 11a — toggle fullscreen**

Run:
```
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Mcp-Session-Id: $SESSION" \
  -d '{"jsonrpc":"2.0","id":110,"method":"tools/call","params":{"name":"accordo.layout.fullscreen","arguments":{}}}' \
  | python3 -m json.tool
```

What you should see in VS Code:
The VS Code window expands to fill the entire screen (or returns to windowed mode if already fullscreen).

What you should see in the response:
```json
{"active": true}
```

Run it again to toggle back to windowed mode before continuing.

---

### Tool 12 of 13 — `accordo.layout.joinGroups`

Merges all open editor groups (splits) back into a single group.

**Setup:** Split the editor first. Press `Cmd+\` (macOS) or `Ctrl+\` (Windows/Linux) to create a second editor group, then open a file in it.

**Test 12a — merge all editor groups**

Run:
```
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Mcp-Session-Id: $SESSION" \
  -d '{"jsonrpc":"2.0","id":120,"method":"tools/call","params":{"name":"accordo.layout.joinGroups","arguments":{}}}' \
  | python3 -m json.tool
```

What you should see in VS Code:
All editor splits merge into one group. All previously split files are now tabs in the single remaining group.

What you should see in the response:
```json
{"groups": 1}
```

---

### Tool 13 of 13 — `accordo.layout.evenGroups`

Equalises the width and height of all editor groups so each gets the same amount of space.

**Setup:** Have at least two editor groups open (use `Cmd+\` to split, then resize one group by dragging the divider to make them unequal).

**Test 13a — equalise editor groups**

Run:
```
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Mcp-Session-Id: $SESSION" \
  -d '{"jsonrpc":"2.0","id":130,"method":"tools/call","params":{"name":"accordo.layout.evenGroups","arguments":{}}}' \
  | python3 -m json.tool
```

What you should see in VS Code:
The editor groups snap to equal widths.

What you should see in the response:
```json
{"equalized": true}
```

---

## Part 3 — Final check

**Step 1.** Rebuild to confirm everything compiles cleanly:
```
pnpm --filter accordo-editor build
```
No output means success.

**Step 2.** Run the full automated test suite:
```
pnpm --filter accordo-editor test
```
You must see:
```
Tests  208 passed (208)
```

**Step 3.** Open the VS Code Problems panel (`Cmd+Shift+M`). There must be zero errors and zero warnings in files under `packages/editor/src/tools/`.

**Step 4.** Confirm no banned patterns were introduced:
```
grep -r ": any" packages/editor/src/tools/
grep -r "console\.log" packages/editor/src/tools/
```
Both commands should return no output.
