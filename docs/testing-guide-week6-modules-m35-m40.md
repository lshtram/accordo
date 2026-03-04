# Manual Testing Guide — Week 6 Modules (M35 / M36 / M37 / M38 / M39 / M40)

> **Goal:** Verify the `accordo-comments` VSCode extension end-to-end: the 6 MCP comment tools, gutter comment creation, thread persistence, staleness tracking, and modality state publishing to the system prompt.
> Every command in this guide is a complete copy-paste line. No editing required except where noted with `⚠`.

---

## Modules Covered

| # | Module | What to verify |
|---|---|---|
| 35 | `@accordo/bridge-types` comment types | `CommentThread`, `CommentAnchor`, tool schemas appear correctly in `tools/list` |
| 36 | `comment-store.ts` | CRUD round-trip, `.accordo/comments.json` survives reload |
| 37 | `native-comments.ts` | Gutter "+" icon visible on `.ts`/`.md` files, threads appear in panel |
| 38 | `comment-tools.ts` | 6 tools callable via MCP; rate limiting on `comment.create` |
| 39 | `state-contribution.ts` | Open threads appear in `GET /instructions` system prompt |
| 40 | `extension.ts` | Extension activates; inert without bridge; commands registered |

---

## Part 1 — Get Everything Running

**Step 1.** Open a terminal inside the project folder and build all packages:
```
pnpm build
```
Wait until all packages report `Done` with no TypeScript errors.

**Step 2.** Press **F5** in VS Code to start a debug session.
A new VS Code window opens (the Extension Development Host). Wait ~5 seconds, then in the *host window* open the Command Palette (`Cmd+Shift+P`) and run **Accordo: Show Hub Log**.
You should see lines like:
```
[hub] Listening on 127.0.0.1:3000
[bridge] connected
```
If `[bridge] connected` does not appear within 30 seconds, check that the `accordo-bridge` extension activated (look for any error in the Hub log).

**Step 3.** Confirm Hub is running and Bridge is connected:
```
curl -s http://localhost:3000/health
```
Expected output — both `"bridge":"connected"` and `"ok":true` must be present:
```json
{"ok":true,"uptime":3.1,"bridge":"connected","toolCount":28,"protocolVersion":"2024-11-05","inflight":0,"queued":0}
```
The `toolCount` should include the 6 comment tools (previous baseline was 22, so expect ≥ 28).

> If `toolCount` is still 22, the `accordo-comments` extension did not activate. Check the Extension Development Host for an error in the `accordo-comments` channel.

**Step 4.** Read your token into a shell variable:
```
TOKEN=$(cat ~/.accordo/token)
echo $TOKEN
```
You should see a UUID like `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`.

**Step 5.** Start an MCP session and capture the session ID:
```
curl -si -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"manual-test","version":"1.0"}}}' \
  | grep -i mcp-session-id
```
Copy the UUID and save it:
```
SESSION=<paste-uuid-here>
```

**Step 6.** Complete the MCP handshake:
```
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Mcp-Session-Id: $SESSION" \
  -d '{"jsonrpc":"2.0","method":"initialized","params":{}}'
```

> **Note:** `$TOKEN` and `$SESSION` must stay set throughout. If you open a new terminal, repeat Steps 4–6.

---

## Part 2 — Verify Comment Tools in tools/list

**Step 7.** List all tools and confirm the 6 comment tools are present:
```
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Mcp-Session-Id: $SESSION" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
  | python3 -c "import sys,json; tools=json.load(sys.stdin)['result']['tools']; [print(t['name']) for t in tools if 'comment' in t['name'].lower()]"
```
Expected output (6 lines):
```
accordo.comment.list
accordo.comment.get
accordo.comment.create
accordo.comment.reply
accordo.comment.resolve
accordo.comment.delete
```
If any tool is missing, the extension registration failed — check the Hub log.

---

## Part 3 — Test Each Tool

> All commands below build on each other. Run them in order. The `THREAD_ID` variable is set in Step 9.

### M38-a — accordo.comment.create

**Step 8.** Create a new comment thread on a file line.
> ⚠ Replace `file:///project/src/auth.ts` with a real file path from the open workspace if testing against a real project. For smoke testing, the URI does not need to exist.

```
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Mcp-Session-Id: $SESSION" \
  -d '{
    "jsonrpc":"2.0","id":10,"method":"tools/call",
    "params":{
      "name":"accordo.comment.create",
      "arguments":{
        "uri":"file:///project/src/auth.ts",
        "anchor":{"kind":"text","startLine":42},
        "body":"This login path skips 2FA for internal users — needs fixing.",
        "intent":"fix"
      }
    }
  }'
```
Expected response shape:
```json
{
  "jsonrpc": "2.0",
  "id": 10,
  "result": {
    "content": [{"type": "text", "text": "{\"created\":true,\"threadId\":\"<uuid>\",\"commentId\":\"<uuid>\"}"}]
  }
}
```
Save the `threadId`:
```
THREAD_ID=<paste-threadId-uuid-here>
```

### M38-b — accordo.comment.list

**Step 9.** List all open threads:
```
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Mcp-Session-Id: $SESSION" \
  -d '{
    "jsonrpc":"2.0","id":11,"method":"tools/call",
    "params":{
      "name":"accordo.comment.list",
      "arguments":{"status":"open"}
    }
  }'
```
Expected: result contains `threads` array with at least 1 entry. The thread created in Step 8 should appear with `status: "open"` and `intent: "fix"`.

### M38-c — accordo.comment.get

**Step 10.** Get the specific thread by ID:
```
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Mcp-Session-Id: $SESSION" \
  -d "{
    \"jsonrpc\":\"2.0\",\"id\":12,\"method\":\"tools/call\",
    \"params\":{
      \"name\":\"accordo.comment.get\",
      \"arguments\":{\"threadId\":\"$THREAD_ID\"}
    }
  }"
```
Expected: `thread.id` matches `$THREAD_ID`, `thread.status` is `"open"`, `thread.comments` has 1 entry with the body from Step 8.

### M38-d — accordo.comment.reply

**Step 11.** Add a reply to the thread:
```
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Mcp-Session-Id: $SESSION" \
  -d "{
    \"jsonrpc\":\"2.0\",\"id\":13,\"method\":\"tools/call\",
    \"params\":{
      \"name\":\"accordo.comment.reply\",
      \"arguments\":{
        \"threadId\":\"$THREAD_ID\",
        \"body\":\"Acknowledged. I will add the 2FA check to the internal path.\"
      }
    }
  }"
```
Expected: `{"replied":true,"commentId":"<uuid>"}`.

**Step 12.** Verify the reply was stored — get the thread again:
```
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Mcp-Session-Id: $SESSION" \
  -d "{
    \"jsonrpc\":\"2.0\",\"id\":14,\"method\":\"tools/call\",
    \"params\":{
      \"name\":\"accordo.comment.get\",
      \"arguments\":{\"threadId\":\"$THREAD_ID\"}
    }
  }"
```
Expected: `thread.comments` now has 2 entries.

### M38-e — accordo.comment.resolve

**Step 13.** Resolve the thread:
```
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Mcp-Session-Id: $SESSION" \
  -d "{
    \"jsonrpc\":\"2.0\",\"id\":15,\"method\":\"tools/call\",
    \"params\":{
      \"name\":\"accordo.comment.resolve\",
      \"arguments\":{
        \"threadId\":\"$THREAD_ID\",
        \"resolutionNote\":\"Added 2FA check in src/auth.ts line 42. PR #217.\"
      }
    }
  }"
```
Expected: `{"resolved":true,"threadId":"<uuid>"}`.

**Step 14.** Confirm the thread is now resolved:
```
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Mcp-Session-Id: $SESSION" \
  -d "{
    \"jsonrpc\":\"2.0\",\"id\":16,\"method\":\"tools/call\",
    \"params\":{
      \"name\":\"accordo.comment.get\",
      \"arguments\":{\"threadId\":\"$THREAD_ID\"}
    }
  }"
```
Expected: `thread.status` is `"resolved"`.

### M38-f — accordo.comment.delete

**Step 15.** Create a second thread to delete (so the resolved thread above is still verifiable):
```
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Mcp-Session-Id: $SESSION" \
  -d '{
    "jsonrpc":"2.0","id":17,"method":"tools/call",
    "params":{
      "name":"accordo.comment.create",
      "arguments":{
        "uri":"file:///project/src/auth.ts",
        "anchor":{"kind":"text","startLine":10},
        "body":"Temporary debug log — should be removed before merge.",
        "intent":"fix"
      }
    }
  }'
```
Save the second `threadId`:
```
THREAD_ID_2=<paste-second-threadId-here>
```

**Step 16.** Delete that thread:
```
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Mcp-Session-Id: $SESSION" \
  -d "{
    \"jsonrpc\":\"2.0\",\"id\":18,\"method\":\"tools/call\",
    \"params\":{
      \"name\":\"accordo.comment.delete\",
      \"arguments\":{\"threadId\":\"$THREAD_ID_2\"}
    }
  }"
```
Expected: `{"deleted":true}`.

**Step 17.** Confirm it is gone — get should return a not-found error:
```
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Mcp-Session-Id: $SESSION" \
  -d "{
    \"jsonrpc\":\"2.0\",\"id\":19,\"method\":\"tools/call\",
    \"params\":{
      \"name\":\"accordo.comment.get\",
      \"arguments\":{\"threadId\":\"$THREAD_ID_2\"}
    }
  }"
```
Expected: `error.message` contains `"Thread not found"`.

---

## Part 4 — Verify Rate Limiting (M38)

**Step 18.** Create 10 comment threads rapidly to hit the rate limit:
```
for i in $(seq 1 11); do
  curl -s -X POST http://localhost:3000/mcp \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Mcp-Session-Id: $SESSION" \
    -d "{\"jsonrpc\":\"2.0\",\"id\":$((20+i)),\"method\":\"tools/call\",\"params\":{\"name\":\"accordo.comment.create\",\"arguments\":{\"uri\":\"file:///project/src/util.ts\",\"anchor\":{\"kind\":\"file\"},\"body\":\"Rate limit test $i\",\"agentId\":\"rate-test-agent\"}}}" \
    | python3 -c "import sys,json; r=json.load(sys.stdin); print(f'call $i: ' + (r.get('result',{}).get('content',[{}])[0].get('text','') or str(r.get('error',''))))"
done
```
Expected: Calls 1–10 succeed with `"created":true`. Call 11 returns an error containing `"Rate limit exceeded"`.

---

## Part 5 — Modality State in System Prompt (M39)

**Step 19.** Create a fresh open thread (if all threads were deleted above):
```
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Mcp-Session-Id: $SESSION" \
  -d '{
    "jsonrpc":"2.0","id":30,"method":"tools/call",
    "params":{
      "name":"accordo.comment.create",
      "arguments":{
        "uri":"file:///project/src/api.ts",
        "anchor":{"kind":"text","startLine":88},
        "body":"This endpoint has no authentication — critical security issue.",
        "intent":"fix"
      }
    }
  }'
```

**Step 20.** Fetch the system prompt (instructions) and inspect the comments section:
```
curl -s http://localhost:3000/instructions \
  -H "Authorization: Bearer $TOKEN" \
  -H "Mcp-Session-Id: $SESSION" \
  | grep -A 30 -i "comment"
```
Expected: The instructions contain a section with `accordo-comments` modality data. It should show `isOpen: true`, `openThreadCount: 1` (or more), and a `summary` array with at least one entry.

> If the comments section is absent, check whether `startStateContribution` was called by looking at the Hub log for `[bridge] state update from accordo-comments`.

---

## Part 6 — Thread Persistence (M36)

**Step 21.** Verify comments were written to disk:
```
cat "$(pwd)/.accordo/comments.json"
```
> ⚠ Run this in the workspace folder that is open in the Extension Development Host, not in the `accordo` repo itself.

Expected: A valid JSON file with a `threads` object containing the threads you created. The file should be ≤ 2 MB.

**Step 22.** Simulate a reload — close and re-open the Extension Development Host window (or reload it with `Cmd+R` in the Host).

**Step 23.** After the reload, re-run `comment.list` (you will need to re-initialize a new session first — repeat Steps 5–6 with the new session, then):
```
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Mcp-Session-Id: $SESSION" \
  -d '{"jsonrpc":"2.0","id":40,"method":"tools/call","params":{"name":"accordo.comment.list","arguments":{}}}'
```
Expected: Threads from before the reload are still present. Content of `.accordo/comments.json` was restored.

---

## Part 7 — Gutter Workflow (M37)

**Step 24.** In the Extension Development Host, open any `.ts` or `.md` file.

**Step 25.** Hover over the left margin (gutter) next to a line number.
Expected: A `+` icon (blue) appears in the gutter, indicating the commenting range provider is active.

**Step 26.** Click the `+` icon to open the comment reply widget.
Type a comment and click **Save** (or press `Ctrl+Enter`).
Expected:
- A new comment widget appears inline in the editor.
- The comment panel (usually a tab in the panel area) shows the new thread.

**Step 27.** Right-click the comment widget — you should see context menu actions:
- **Resolve Thread** (`accordo.comments.resolveThread`)
- **Delete Thread** (`accordo.comments.deleteThread`)
- **Reopen Thread** (`accordo.comments.reopenThread`)
- **Delete Comment** (`accordo.comments.deleteComment`)

**Step 28.** Click **Resolve Thread**. The thread widget should update to show a resolved state (collapsed or greyed).

---

## Part 8 — Inert When Bridge Absent (M40)

This test verifies `extension.ts` §10.2: "Is inert when bridge is absent".

**Step 29.** In the Extension Development Host workspace, open the Extensions panel and **disable** `accordo-bridge` temporarily.

**Step 30.** Reload the window (`Cmd+R`).

**Step 31.** Open the Hub log. Expected: No errors from `accordo-comments`. The extension should silently deactivate without any thrown exceptions.

**Step 32.** Re-enable `accordo-bridge` and reload again to restore the normal state.

---

## Part 9 — Internal Commands (M40)

**Step 33.** From the Command Palette (`Cmd+Shift+P`), run **Developer: Run Command**. Type each internal command name and confirm it is registered (appears in the list):
- `accordo.comments.internal.getThreadsForUri`
- `accordo.comments.internal.createSurfaceComment`
- `accordo.comments.internal.resolveThread`

Expected: All three appear as registered commands (they are for inter-extension use).

---

## Final Check

**Step 34.** Run the full automated test suite one more time to confirm no regressions:
```
cd /Users/Shared/dev/accordo && pnpm test 2>&1 | grep -E "Tests|Test Files"
```
Expected:
```
packages/comments test:  Test Files  5 passed (5)
packages/comments test:       Tests  153 passed (153)
packages/editor test:  Test Files  4 passed (4)
packages/editor test:       Tests  172 passed (172)
packages/bridge test:  Test Files  6 passed (6)
packages/bridge test:       Tests  296 passed (296)
packages/hub test:  Test Files  14 passed (14)
packages/hub test:       Tests  329 passed (329)
```

**Total: 950 tests, 0 failures.**

---

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---|---|---|
| `toolCount` still 22 in `/health` | `accordo-comments` failed to activate | Check Extension Development Host output for `accordo-comments` errors |
| `Thread not found` on valid ID | Session reconnected, new extension host = fresh in-memory store | Re-run Step 8 to create a new thread |
| Gutter `+` icon not visible | `commentingRangeProvider` not set | Confirm `NativeComments.init()` was called; check Hub log |
| `.accordo/comments.json` not created | `store.load()` called with empty workspaceRoot | Open a workspace folder in the Extension Development Host before activating |
| Rate limit hits on call 1, not 11 | Wrong `agentId` — all calls sharing one rate-limit bucket | Pass distinct `agentId` values per test |
