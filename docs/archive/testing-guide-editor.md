# Manual Testing Guide — accordo-editor (Modules 16 + 17)

> **Goal:** Verify each of the 11 editor tools works end-to-end through VS Code.
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

**Step 3.** Open a second terminal and run this to confirm the Hub is running and the Bridge is connected:
```
curl -s http://localhost:3000/health
```
You must see `"bridge":"connected"` and `"toolCount":11` in the response before going further.
If `toolCount` is 0, wait 5 seconds and run the command again.

**Step 4.** In that same terminal, read your token into a variable:
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

**Step 7 (optional — confirm all tools are registered):**
```
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Mcp-Session-Id: $SESSION" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' | python3 -m json.tool
```
You should see all 11 tool names in the output.

> **Note:** `$TOKEN` and `$SESSION` must stay set in your terminal for all steps below.
> If you open a new terminal window you need to repeat Steps 4–6.

> **Note on file paths:** Replace every path starting with `/Users/you/project/` with a real path to a file in your open VS Code workspace.

---

## Part 2 — Test each tool

Each call below follows the same shape:
- Send a POST to `http://localhost:3000/mcp`
- The `name` field is the tool to call
- The `arguments` field is the input to the tool
- The response contains a `content` array — the `text` field inside it is the tool result

---

### Tool 1 of 11 — `accordo.editor.open`

Opens a file in the editor, optionally jumping to a specific line.

**Test 1a — open a file**

Run:
```
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Mcp-Session-Id: $SESSION" \
  -d '{"jsonrpc":"2.0","id":10,"method":"tools/call","params":{"name":"accordo.editor.open","arguments":{"path":"/Users/you/project/src/index.ts"}}}'
```
What you should see in the response:
```
{"opened":true,"path":"/Users/you/project/src/index.ts"}
```
What you should see in VS Code: the file opens in the editor.

**Test 1b — open a file and jump to a specific line**

Run:
```
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Mcp-Session-Id: $SESSION" \
  -d '{"jsonrpc":"2.0","id":11,"method":"tools/call","params":{"name":"accordo.editor.open","arguments":{"path":"/Users/you/project/src/index.ts","line":10,"column":5}}}'
```
What you should see: the file opens and the cursor is on line 10.

**Test 1c — use a relative path (should resolve to workspace root)**

Run:
```
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Mcp-Session-Id: $SESSION" \
  -d '{"jsonrpc":"2.0","id":12,"method":"tools/call","params":{"name":"accordo.editor.open","arguments":{"path":"src/index.ts"}}}'
```
What you should see: the file opens (same result as Test 1a).

**Test 1d — try to open a file outside the workspace (should fail)**

Run:
```
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Mcp-Session-Id: $SESSION" \
  -d '{"jsonrpc":"2.0","id":13,"method":"tools/call","params":{"name":"accordo.editor.open","arguments":{"path":"/etc/passwd"}}}'
```
What you should see in the response text:
```
{"error":"Path is outside workspace: /etc/passwd"}
```

---

### Tool 2 of 11 — `accordo.editor.close`

Closes a tab. If no path is given, closes the currently active tab.

**Setup:** Make sure `src/index.ts` and `src/util.ts` are both open in VS Code before running these tests.

**Test 2a — close the currently active tab**

Click on `src/util.ts` in VS Code so it is the active tab. Then run:
```
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Mcp-Session-Id: $SESSION" \
  -d '{"jsonrpc":"2.0","id":20,"method":"tools/call","params":{"name":"accordo.editor.close","arguments":{}}}'
```
What you should see in the response:
```
{"closed":true}
```
What you should see in VS Code: the `src/util.ts` tab disappears.

**Test 2b — close a specific file by path**

Re-open `src/util.ts` first (run Test 1a with `util.ts` path). Then run:
```
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Mcp-Session-Id: $SESSION" \
  -d '{"jsonrpc":"2.0","id":21,"method":"tools/call","params":{"name":"accordo.editor.close","arguments":{"path":"/Users/you/project/src/util.ts"}}}'
```
What you should see: `{"closed":true}` and the `util.ts` tab disappears.

**Test 2c — close when no tabs are open (should fail)**

Close all tabs in VS Code manually. Then run:
```
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Mcp-Session-Id: $SESSION" \
  -d '{"jsonrpc":"2.0","id":22,"method":"tools/call","params":{"name":"accordo.editor.close","arguments":{}}}'
```
What you should see:
```
{"error":"No active editor to close"}
```

**Test 2d — close a file that is not open (should fail)**

Run:
```
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Mcp-Session-Id: $SESSION" \
  -d '{"jsonrpc":"2.0","id":23,"method":"tools/call","params":{"name":"accordo.editor.close","arguments":{"path":"/Users/you/project/src/notopen.ts"}}}'
```
What you should see:
```
{"error":"File is not open: /Users/you/project/src/notopen.ts"}
```

---

### Tool 3 of 11 — `accordo.editor.scroll`

Scrolls the visible area of the active editor up or down.

**Setup:** Open a file with more than 50 lines so scrolling is visible.

**Test 3a — scroll down one page**

Run:
```
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Mcp-Session-Id: $SESSION" \
  -d '{"jsonrpc":"2.0","id":30,"method":"tools/call","params":{"name":"accordo.editor.scroll","arguments":{"direction":"down"}}}'
```
What you should see in VS Code: the file scrolls down. The response contains the new first visible line number, for example:
```
{"line":25}
```

**Test 3b — scroll up one page**

Run:
```
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Mcp-Session-Id: $SESSION" \
  -d '{"jsonrpc":"2.0","id":31,"method":"tools/call","params":{"name":"accordo.editor.scroll","arguments":{"direction":"up"}}}'
```
What you should see: the file scrolls back up.

**Test 3c — scroll down one line instead of a full page**

Run:
```
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Mcp-Session-Id: $SESSION" \
  -d '{"jsonrpc":"2.0","id":32,"method":"tools/call","params":{"name":"accordo.editor.scroll","arguments":{"direction":"down","by":"line"}}}'
```
What you should see: the file scrolls down exactly one line.

**Test 3d — no active editor (should fail)**

Close all tabs in VS Code. Then run:
```
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Mcp-Session-Id: $SESSION" \
  -d '{"jsonrpc":"2.0","id":33,"method":"tools/call","params":{"name":"accordo.editor.scroll","arguments":{"direction":"down"}}}'
```
What you should see:
```
{"error":"No active editor"}
```

---

### Tool 4 of 11 — `accordo.editor.highlight`

Adds a coloured background highlight to a range of lines.

**Setup:** Open `/Users/you/project/src/index.ts` in VS Code so it is visible on screen.

**Test 4a — highlight lines 3 to 7 in yellow (default colour)**

Run:
```
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Mcp-Session-Id: $SESSION" \
  -d '{"jsonrpc":"2.0","id":40,"method":"tools/call","params":{"name":"accordo.editor.highlight","arguments":{"path":"/Users/you/project/src/index.ts","startLine":3,"endLine":7}}}'
```
What you should see in VS Code: lines 3 to 7 get a yellow background.
What you should see in the response:
```
{"highlighted":true,"decorationId":"accordo-decoration-1"}
```
Write down the `decorationId` value — you will need it for Tool 5.

**Test 4b — highlight a single line in red**

Run:
```
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Mcp-Session-Id: $SESSION" \
  -d '{"jsonrpc":"2.0","id":41,"method":"tools/call","params":{"name":"accordo.editor.highlight","arguments":{"path":"/Users/you/project/src/index.ts","startLine":10,"endLine":10,"color":"rgba(255,0,0,0.4)"}}}'
```
What you should see: line 10 gets a red background.

**Test 4c — invalid range where start is after end (should fail)**

Run:
```
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Mcp-Session-Id: $SESSION" \
  -d '{"jsonrpc":"2.0","id":42,"method":"tools/call","params":{"name":"accordo.editor.highlight","arguments":{"path":"/Users/you/project/src/index.ts","startLine":10,"endLine":5}}}'
```
What you should see:
```
{"error":"startLine must be <= endLine"}
```

---

### Tool 5 of 11 — `accordo.editor.clearHighlights`

Removes highlights added by Tool 4.

**Setup:** Run Test 4a and Test 4b first so there are two highlights on screen.

**Test 5a — remove a specific highlight by its ID**

Replace `accordo-decoration-1` below with the ID you got from Test 4a:
```
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Mcp-Session-Id: $SESSION" \
  -d '{"jsonrpc":"2.0","id":50,"method":"tools/call","params":{"name":"accordo.editor.clearHighlights","arguments":{"decorationId":"accordo-decoration-1"}}}'
```
What you should see in VS Code: the yellow highlight on lines 3–7 disappears. The red one on line 10 stays.
What you should see in the response:
```
{"cleared":true,"count":1}
```

**Test 5b — remove all remaining highlights at once**

Run:
```
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Mcp-Session-Id: $SESSION" \
  -d '{"jsonrpc":"2.0","id":51,"method":"tools/call","params":{"name":"accordo.editor.clearHighlights","arguments":{}}}'
```
What you should see: all highlights disappear. Response:
```
{"cleared":true,"count":1}
```

**Test 5c — use an ID that does not exist (should fail)**

Run:
```
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Mcp-Session-Id: $SESSION" \
  -d '{"jsonrpc":"2.0","id":52,"method":"tools/call","params":{"name":"accordo.editor.clearHighlights","arguments":{"decorationId":"accordo-decoration-999"}}}'
```
What you should see:
```
{"error":"Decoration not found: accordo-decoration-999"}
```

---

---


---

### Tool 6 of 11 — `accordo.editor.split`

Splits the editor view into multiple side-by-side or stacked columns.

**Setup:** Close all extra editor groups so only one column is open.

**Test 6a — split right**

Run:
```
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Mcp-Session-Id: $SESSION" \
  -d '{"jsonrpc":"2.0","id":60,"method":"tools/call","params":{"name":"accordo.editor.split","arguments":{"direction":"right"}}}'
```
What you should see: a second editor column appears to the right. Response:
```
{"groups":2}
```

**Test 6b — split down**

Run:
```
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Mcp-Session-Id: $SESSION" \
  -d '{"jsonrpc":"2.0","id":61,"method":"tools/call","params":{"name":"accordo.editor.split","arguments":{"direction":"down"}}}'
```
What you should see: a third editor group appears below. Response:
```
{"groups":3}
```

---

### Tool 7 of 11 — `accordo.editor.focus`

Moves keyboard focus to a specific editor group (column) by number. Group 1 is the leftmost/topmost.

**Setup:** Run Tests 6a and 6b first so you have 3 groups open.

**Test 7a — focus group 1**

Run:
```
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Mcp-Session-Id: $SESSION" \
  -d '{"jsonrpc":"2.0","id":70,"method":"tools/call","params":{"name":"accordo.editor.focus","arguments":{"group":1}}}'
```
What you should see: the leftmost group gets the blue active-group border. Response:
```
{"focused":true,"group":1}
```

**Test 7b — focus group 2**

Run:
```
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Mcp-Session-Id: $SESSION" \
  -d '{"jsonrpc":"2.0","id":71,"method":"tools/call","params":{"name":"accordo.editor.focus","arguments":{"group":2}}}'
```
What you should see: the second group becomes active.

**Test 7c — focus a group that does not exist (should fail)**

Run:
```
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Mcp-Session-Id: $SESSION" \
  -d '{"jsonrpc":"2.0","id":72,"method":"tools/call","params":{"name":"accordo.editor.focus","arguments":{"group":5}}}'
```
What you should see:
```
{"error":"Editor group 5 does not exist (max: 3)"}
```

---

### Tool 8 of 11 — `accordo.editor.reveal`

Opens the Explorer sidebar and highlights a file in the file tree.

**Test 8a — reveal a file in the Explorer**

Run:
```
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Mcp-Session-Id: $SESSION" \
  -d '{"jsonrpc":"2.0","id":80,"method":"tools/call","params":{"name":"accordo.editor.reveal","arguments":{"path":"/Users/you/project/src/index.ts"}}}'
```
What you should see: the Explorer panel opens/focuses and the file is highlighted in the tree. Response:
```
{"revealed":true,"path":"/Users/you/project/src/index.ts"}
```

**Test 8b — reveal a file that does not exist on disk (should fail)**

Run:
```
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Mcp-Session-Id: $SESSION" \
  -d '{"jsonrpc":"2.0","id":81,"method":"tools/call","params":{"name":"accordo.editor.reveal","arguments":{"path":"/Users/you/project/src/ghost.ts"}}}'
```
What you should see:
```
{"error":"File not found: /Users/you/project/src/ghost.ts"}
```

---

### Tool 9 of 11 — `accordo.editor.save`

Saves a file. If no path is given, saves the currently active tab.

**Setup:** Open `/Users/you/project/src/index.ts`. Type any character so the tab title shows a dot (indicating unsaved changes).

**Test 9a — save the active tab**

Run:
```
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Mcp-Session-Id: $SESSION" \
  -d '{"jsonrpc":"2.0","id":90,"method":"tools/call","params":{"name":"accordo.editor.save","arguments":{}}}'
```
What you should see: the dot disappears from the tab title. Response:
```
{"saved":true,"path":"/Users/you/project/src/index.ts"}
```

**Test 9b — save a specific file by path**

Make `src/util.ts` dirty (type something in it). Then run:
```
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Mcp-Session-Id: $SESSION" \
  -d '{"jsonrpc":"2.0","id":91,"method":"tools/call","params":{"name":"accordo.editor.save","arguments":{"path":"/Users/you/project/src/util.ts"}}}'
```
What you should see: the dot disappears from `util.ts`.

**Test 9c — save when no tabs are open (should fail)**

Close all tabs. Then run:
```
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Mcp-Session-Id: $SESSION" \
  -d '{"jsonrpc":"2.0","id":92,"method":"tools/call","params":{"name":"accordo.editor.save","arguments":{}}}'
```
What you should see:
```
{"error":"No active editor to save"}
```

---

### Tool 10 of 11 — `accordo.editor.saveAll`

Saves all open files that have unsaved changes in one call.

**Setup:** Open 3 files and type something in each so all 3 show unsaved dots.

**Test 10a — save all dirty files**

Run:
```
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Mcp-Session-Id: $SESSION" \
  -d '{"jsonrpc":"2.0","id":100,"method":"tools/call","params":{"name":"accordo.editor.saveAll","arguments":{}}}'
```
What you should see: all three dots disappear from the tab titles. Response:
```
{"saved":true,"count":3}
```

**Test 10b — call saveAll when nothing is dirty**

With no unsaved changes, run the same command again:
```
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Mcp-Session-Id: $SESSION" \
  -d '{"jsonrpc":"2.0","id":101,"method":"tools/call","params":{"name":"accordo.editor.saveAll","arguments":{}}}'
```
What you should see:
```
{"saved":true,"count":0}
```

---

### Tool 11 of 11 — `accordo.editor.format`

Formats a file using VS Code’s built-in formatter (e.g. Prettier).

**Setup:** Make sure a formatter is installed and enabled for TypeScript files. Open a `.ts` file that has inconsistent indentation or spacing.

**Test 11a — format the active file**

Run:
```
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Mcp-Session-Id: $SESSION" \
  -d '{"jsonrpc":"2.0","id":110,"method":"tools/call","params":{"name":"accordo.editor.format","arguments":{}}}'
```
What you should see: the file reformats (spacing/indentation adjusts automatically). Response:
```
{"formatted":true,"path":"/Users/you/project/src/index.ts"}
```

**Test 11b — format a specific file by path**

Run:
```
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Mcp-Session-Id: $SESSION" \
  -d '{"jsonrpc":"2.0","id":111,"method":"tools/call","params":{"name":"accordo.editor.format","arguments":{"path":"/Users/you/project/src/util.ts"}}}'
```
What you should see: `util.ts` reformats.

**Test 11c — format when no tabs are open (should fail)**

Close all tabs. Then run:
```
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Mcp-Session-Id: $SESSION" \
  -d '{"jsonrpc":"2.0","id":112,"method":"tools/call","params":{"name":"accordo.editor.format","arguments":{}}}'
```
What you should see:
```
{"error":"No active editor to format"}
```

**Test 11d — format a file that is not open in the editor (should fail)**

Run:
```
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Mcp-Session-Id: $SESSION" \
  -d '{"jsonrpc":"2.0","id":113,"method":"tools/call","params":{"name":"accordo.editor.format","arguments":{"path":"/Users/you/project/src/notopen.ts"}}}'
```
What you should see:
```
{"error":"File is not open: /Users/you/project/src/notopen.ts. Open it first."}
```

---

## Part 3 — Final check

**Step 1.** In the terminal, run:
```
pnpm build
```
Should finish with no errors.

**Step 2.** Run:
```
cd packages/editor && npx vitest run
```
Should show `113 passed`.

**Step 3.** Back in VS Code, open the Problems panel (`Cmd+Shift+M`). There should be no new errors in `packages/editor/src/`.
