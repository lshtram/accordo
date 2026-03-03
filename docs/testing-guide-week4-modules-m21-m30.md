# Manual Testing Guide — Week 4 Modules (M21 / M22 / M24 / M25 / M26 / M27 / M29 / M30)

> **Goal:** Verify session error messages, protocol-version close codes, JSONL audit log, FIFO concurrency queue, agent config file generation with token rotation, stale-PID detection, and credential persistence end-to-end.
> Every command in this guide is a complete copy-paste line. No editing required except where noted.

---

---

## Fixes applied since last manual test run

| Issue reported | What was done | Retest needed? |
|---|---|---|
| Status bar showed nothing | Status bar not implemented. Guide now uses `/health` + Hub log throughout. | No |
| `~/.accordo/audit.jsonl` missing on M24-d | File created on first `tools/call`, not at startup. Guide updated (run M24-a first). | No |
| `opencode.json` used `mcpServers` / `type: "http"` | `buildOpencodeConfig` fixed to write `mcp` / `type: "remote"` per opencode docs. | **Yes — M26-a ⚠️** |
| M25-b queue counter hard to observe manually | Automated as §E2E-6.7 (`maxConcurrent=1`). | No — automated |

## Part 1 — Get everything running

**Step 1.** Open a terminal inside the project folder and build everything:
```
pnpm build
```
Wait until all four packages report `Done` with no errors.

**Step 2.** Press **F5** in VS Code to start a debug session.
Wait ~5 seconds, then open the Command Palette (`Cmd+Shift+P`) and run **Accordo: Show Hub Log**.
You should see a line like `[hub] Listening on 127.0.0.1:3000` and `[bridge] connected`.
If neither appears within 30 seconds, check the log for errors.

> **Note:** The Accordo extension does not (yet) show a status bar indicator. Use the Hub log and the `/health` endpoint to verify connection state.

**Step 3.** Confirm Hub is running and Bridge is connected:
```
curl -s http://localhost:3000/health
```
You must see both `"bridge":"connected"` and `"ok":true` before going further. Example:
```json
{"ok":true,"uptime":3.1,"bridge":"connected","toolCount":21,"protocolVersion":"2024-11-05","inflight":0,"queued":0}
```

**Step 4.** Read your token into a shell variable:
```
TOKEN=$(cat ~/.accordo/token)
echo $TOKEN
```
You should see a UUID like `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`.

**Step 5.** Start an MCP session and save the session ID:
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
Copy the UUID and save it:
```
SESSION=550e8400-e29b-41d4-a716-446655440000
```
(Replace with the UUID you actually got.)

**Step 6.** Complete the handshake:
```
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Mcp-Session-Id: $SESSION" \
  -d '{"jsonrpc":"2.0","method":"initialized","params":{}}'
```

> **Note:** `$TOKEN` and `$SESSION` must stay set for all steps below. If you open a new terminal, repeat Steps 4–6.

---

---

## Part 2A — Manual only

These tests require a live VS Code debug session. They cannot be automated because they depend on the VS Code extension lifecycle, SecretStorage, workspace file writes driven by the Bridge extension, or OS process spawning that only occurs inside VS Code.

---

### Module M26 — Agent config file generation

> When `accordo.agent.configureOpencode` or `accordo.agent.configureClaude` is `true`, Bridge writes `opencode.json` / `.claude/mcp.json` to the workspace root on Hub ready.

**Setup:** You need a workspace open in VS Code (a folder, not just loose files).

**Step A — Enable opencode config in VS Code settings:**

Open the Command Palette (`Cmd+Shift+P`) → **Preferences: Open User Settings (JSON)**.
Add or update:
```json
"accordo.agent.configureOpencode": true,
"accordo.agent.configureClaude": true
```
Save the file.

**Step B — Reload the debug session to pick up new settings:**

Press `Cmd+Shift+P` → **Developer: Reload Window** (or stop/restart F5 debug session).
Wait ~5 seconds, then confirm Hub is back:
```
curl -s http://localhost:3000/health | python3 -c "import sys,json; print('bridge:', json.load(sys.stdin)['bridge'])"
```
You should see `bridge: connected`.

**Test M26-a — opencode.json format is correct ⚠️ NEEDS RETEST**

> The format was wrong in the last test run (`mcpServers` / `type: "http"`).
> It is now fixed to `mcp` / `type: "remote"` (opencode docs spec). Re-run this test.

```
cat <your-workspace-root>/opencode.json
```
Replace `<your-workspace-root>` with the absolute path to your open workspace folder, e.g. `/Users/Shared/dev/accordo`.

What you should see:
```json
{
  "_accordo_schema": "1.0",
  "instructions_url": "http://localhost:3000/instructions",
  "mcp": {
    "accordo-hub": {
      "type": "remote",
      "url": "http://localhost:3000/mcp",
      "headers": {
        "Authorization": "Bearer <your-token-uuid>"
      }
    }
  }
}
```
**Pass:** File exists, top-level key is `"mcp"` (NOT `"mcpServers"`), `"type"` is `"remote"` (NOT `"http"`), and the `Authorization` header matches your `$TOKEN`.
**Fail:** File still shows `"mcpServers"` or `"type": "http"` — extension was not rebuilt. Run `pnpm build` and reload the window.

**Test M26-b — .claude/mcp.json is created in workspace root**

```
cat <your-workspace-root>/.claude/mcp.json
```
What you should see:
```json
{
  "_accordo_schema": "1.0",
  "mcpServers": {
    "accordo-hub": {
      "type": "http",
      "url": "http://localhost:3000/mcp",
      "headers": {
        "Authorization": "Bearer <your-token-uuid>"
      }
    }
  }
}
```
**Pass:** File exists with `"accordo-hub"` entry containing the Bearer token.

**Test M26-c — Both file paths appear in .gitignore**

```
grep -E "opencode\.json|.claude/mcp\.json" <your-workspace-root>/.gitignore
```
What you should see:
```
opencode.json
.claude/mcp.json
```
**Pass:** Both lines are present.
**Fail:** Lines are missing → credentials could be accidentally committed.

**Test M26-d — Both config files have mode 0600**

```
ls -la <your-workspace-root>/opencode.json <your-workspace-root>/.claude/mcp.json
```
What you should see — permissions showing `-rw-------` (owner-only):
```
-rw-------  1 <user>  <group>  ... opencode.json
-rw-------  1 <user>  <group>  ... .claude/mcp.json
```
**Pass:** Both files show `-rw-------`.
**Fail:** File has group or world read bits set.

---

---

### Module M27 — Agent config rewritten on token rotation (CFG-07)

> When Bridge rotates credentials (restart command), agent config files are rewritten with the new token.

**Setup:** Complete M26 tests first. Keep your workspace root path handy.

> **Note:** During restart the Bridge connection may flicker disconnected → connected in
> the Hub log for a few seconds. This is normal — Bridge reconnects automatically after
> the Hub process restarts. Wait up to 10 s for `/health` to stabilise.

**Step A — Record the current token in the config file:**

```
grep "Bearer" <your-workspace-root>/opencode.json
```
Note the token UUID — e.g. `Bearer aabbccdd-1111-2222-3333-444455556666`.

**Test M27-a — Restart command rewrites opencode.json with new bearer token**

Run the restart command from VS Code Command Palette (`Cmd+Shift+P`):
```
Accordo: Restart Hub
```
Wait 3 seconds for reconnection, then:
```
grep "Bearer" <your-workspace-root>/opencode.json
```
What you should see — a **different** UUID than the one you noted in Step A:
```
        "Authorization": "Bearer bbccddee-2222-3333-4444-555566667777"
```
**Pass:** The UUID has changed and matches the new `~/.accordo/token` file.

Verify the token file also changed:
```
cat ~/.accordo/token
grep "Bearer" <your-workspace-root>/opencode.json | grep -o "Bearer .*" | cut -d' ' -f2
```
Both outputs should be the same UUID.

**Pass:** Token in `opencode.json` exactly matches `~/.accordo/token`.
**Fail:** Token in opencode.json still shows the old UUID, or is blank.

**Test M27-b — .claude/mcp.json also has the new token**

```
grep "Bearer" <your-workspace-root>/.claude/mcp.json | grep -o "Bearer .*" | cut -d' ' -f2
cat ~/.accordo/token
```
**Pass:** Both lines show the same new UUID.

---

---

### Module M29 — Stale PID detection on activation

> On activation, Bridge reads `~/.accordo/hub.pid`. If the file exists but the process is not running (stale), Bridge skips the health check and spawns a fresh Hub.

**Test M29-a — PID file is written by Hub at startup**

```
cat ~/.accordo/hub.pid
```
What you should see — the Hub process ID (a number):
```
12345
```
**Pass:** File exists and contains a positive integer.

**Test M29-b — Bridge detects a stale PID and spawns a fresh Hub**

Stop the Hub process forcefully (simulates a crash with stale PID file):
```
kill -9 $(cat ~/.accordo/hub.pid)
```
The PID file now refers to a dead process. Reload VS Code window:

`Cmd+Shift+P` → **Developer: Reload Window**

Wait ~15 seconds, then poll health until Bridge reconnects:
```
curl -s http://localhost:3000/health | python3 -c "import sys,json; print('bridge:', json.load(sys.stdin)['bridge'])"
```
You should see `bridge: connected`.

After reconnecting:
```
cat ~/.accordo/hub.pid
```
What you should see — a **new** PID (different number):
```
12399
```
```
curl -s http://localhost:3000/health | python3 -c "import sys,json; print('ok:', json.load(sys.stdin)['ok'])"
```
What you should see:
```
ok: True
```
**Pass:** Hub restarted successfully, `/health` returns `"ok":true` with `"bridge":"connected"`, and `hub.pid` contains a new process ID.
**Fail:** `/health` still fails or shows `"bridge":"disconnected"` after 15 seconds — Hub did not restart cleanly.

---

---

### Module M30-bridge — Credential persistence to SecretStorage on restart

> After a successful restart, Bridge persists the new secret and token to VS Code's SecretStorage so they survive window reloads.

**Test M30-bridge-a — Credentials survive a window reload after restart**

Step 1 — Run restart:
```
Cmd+Shift+P → Accordo: Restart Hub
```
Wait ~10 seconds, then confirm reconnection:
```
curl -s http://localhost:3000/health | python3 -c "import sys,json; print('bridge:', json.load(sys.stdin)['bridge'])"
```
You should see `bridge: connected`.

Step 2 — Note the current token:
```
NEW_TOKEN=$(cat ~/.accordo/token)
echo "Token after restart: $NEW_TOKEN"
```

Step 3 — Reload window without stopping the Hub:
```
Cmd+Shift+P → Developer: Reload Window
```
Wait ~10 seconds.

Step 4 — Verify auth still works with stored credentials:
```
curl -s http://localhost:3000/health
```
What you should see — `"bridge":"connected"` (not disconnected):
```json
{"ok":true,"uptime":5.2,"bridge":"connected","toolCount":21,...}
```
**Pass:** Bridge reconnects after reload without regenerating new credentials (`"bridge":"connected"` in the health response), confirming the rotated credentials were persisted.
**Fail:** Health shows `"bridge":"disconnected"` after reload, or the Hub log shows an auth failure error on reconnect — meaning the old secret was used because persistence failed.

---

---

## Part 2B — Manual verification with automated E2E backing

These tests are also covered by the automated Hub e2e suite in `bridge-e2e.test.ts`.
Run the suite first to confirm the baseline is green:

```
pnpm --filter accordo-hub test
```

Then use the manual steps below to verify the same behaviour in a live deployment.

---

### Module M21 — Session error message

> **Automated coverage:** §E2E-6.1 in `bridge-e2e.test.ts`


> Hub returns `"Invalid or expired session"` (not `"Unknown session"`) when a client sends an unrecognised Mcp-Session-Id.

**Test M21-a — Unknown session ID returns the correct message**

Run:
```
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Mcp-Session-Id: 00000000-0000-0000-0000-000000000000" \
  -d '{"jsonrpc":"2.0","id":1,"method":"ping","params":{}}'
```
What you should see in the response:
```json
{"error":"Invalid or expired session"}
```
**Pass:** the word `"Invalid or expired session"` appears verbatim.
**Fail:** you see `"Unknown session"` or any other text.

---

---

### Module M22 — Protocol-version string in WebSocket close frame

> **Automated coverage:** §E2E-6.2 in `bridge-e2e.test.ts`


> When Bridge sends a `stateSnapshot` with the wrong `protocolVersion`, Hub sends WS close code 4002 with a message that includes both the expected and actual version strings.

**Setup:** This test requires sending a raw WebSocket message. Use the `wscat` tool (install once with `npm install -g wscat` if not already present).

First read the current bridge secret from Hub logs (printed at startup) or from Hub process environment. Since in the debug session it is a UUID stored in VS Code's SecretStorage, the easiest approach is to read it from the running Hub's environment via the log:

```
BRIDGE_SECRET=$(ps aux | grep "dist/index.js" | grep -v grep | head -1 | \
  sed 's/.*ACCORDO_BRIDGE_SECRET=\([^ ]*\).*/\1/')
echo $BRIDGE_SECRET
```

If that is empty, you can read it from the debug Hub log in VS Code's Output panel — it logs the secret at startup. Alternatively, use the demo token from `scripts/demo-bridge.mjs`.

**Test M22-a — Close frame contains expected and received version**

Connect with the correct secret, then send a stateSnapshot with a fake version:
```
echo '{"type":"stateSnapshot","protocolVersion":"1999-01-01","state":{}}' | \
  wscat -c "ws://localhost:3000/bridge" \
    -H "x-accordo-secret: $BRIDGE_SECRET" \
    --no-color 2>&1 | head -5
```
What you should see in the response (the close frame reason):
```
Protocol version mismatch: expected 2024-11-05, got 1999-01-01
```
**Pass:** both `"2024-11-05"` and `"1999-01-01"` appear in the close reason.
**Fail:** you see only `"Protocol version mismatch"` with no version numbers, or no close frame at all.

> **Note:** `wscat` may not be available everywhere. If unavailable, skip M22 here — the automated unit tests in `bridge-server.test.ts` verify it. This manual test is a belt-and-suspenders check.

---

---

### Module M24 — JSONL audit log

> **Automated coverage:** §E2E-6.3 (success + argsHash), §E2E-6.4 (error entry)


> Every `tools/call` completion writes one JSON line to `~/.accordo/audit.jsonl`. File rotates to `audit.1.jsonl` at 10 MB.

**Setup:** Make sure `$TOKEN` and `$SESSION` are set from Part 1.

**Test M24-a — Audit entry written after a successful tool call**

Make a tool call (use `accordo.editor.open` which is always registered):
```
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Mcp-Session-Id: $SESSION" \
  -d '{"jsonrpc":"2.0","id":10,"method":"tools/call","params":{"name":"accordo.editor.open","arguments":{"path":"/tmp/audit-test.txt"}}}'
```

Now inspect the audit log:
```
tail -1 ~/.accordo/audit.jsonl
```
What you should see — one JSON object (formatted here for readability, it will be on a single line):
```json
{
  "ts": "2026-03-03T16:05:00.123Z",
  "tool": "accordo.editor.open",
  "argsHash": "a3f1...",
  "sessionId": "550e8400-e29b-41d4-a716-446655440000",
  "result": "success",
  "durationMs": 42
}
```
**Pass:** A new line appeared in `audit.jsonl` with `"tool":"accordo.editor.open"`, a non-empty `"argsHash"` (64 hex chars), and `"result":"success"`.
**Fail:** No new line, or `argsHash` is empty or missing.

**Test M24-b — argsHash is a SHA-256 hex string (64 characters)**

```
tail -1 ~/.accordo/audit.jsonl | python3 -c \
  "import sys,json; e=json.loads(sys.stdin.read()); print(len(e['argsHash']), e['argsHash'])"
```
What you should see:
```
64 a3f1cc...
```
**Pass:** First number is `64`.
**Fail:** Any other length.

**Test M24-c — Audit entry written for a failed tool call**

Call a tool that will error (pass a directory path where a filename is expected):
```
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Mcp-Session-Id: $SESSION" \
  -d '{"jsonrpc":"2.0","id":11,"method":"tools/call","params":{"name":"accordo.editor.open","arguments":{"path":"/dev/null/__nonexistent__"}}}'
```
Check the audit log:
```
tail -1 ~/.accordo/audit.jsonl | python3 -c \
  "import sys,json; e=json.loads(sys.stdin.read()); print(e['result'], e.get('errorMessage',''))"
```
What you should see:
```
error  <some error message text>
```
**Pass:** `result` is `"error"` and `errorMessage` is non-empty.
**Fail:** `result` is `"success"`, or no new line appeared.

**Test M24-d — Audit log file exists in the correct directory**

> **Note (fix applied — was reported missing):** The file is created on the **first** `tools/call`,
> not at Hub startup. Running M24-a above already created it. This test is a side-effect confirmation:

```
ls -lh ~/.accordo/audit.jsonl
```
What you should see:
```
-rw-------  1 <user>  <group>  <size> Mar  3 16:05 /Users/<user>/.accordo/audit.jsonl
```
**Pass:** File exists and is readable. If absent, run M24-a first.
**Fail:** File is absent even after completing M24-a — Hub may not have `auditFile` wired to the default path.

---

---

### Module M25 — FIFO concurrency queue

> **Automated coverage:** §E2E-6.5 (queued field at idle), §E2E-6.7 (queued > 0 under load)


> When all 16 in-flight slots are taken, new requests are queued (up to 64) rather than dropped. They are dispatched in FIFO order as slots free up.

**Setup:** The `/health` endpoint always shows current `inflight` and `queued` values. This test fires multiple requests in the background and observes the queue counter climb before dropping back to zero.

**Test M25-a — `queued` counter appears in health response**

```
curl -s http://localhost:3000/health | python3 -c \
  "import sys,json; h=json.load(sys.stdin); print('inflight:', h['inflight'], 'queued:', h['queued'])"
```
What you should see at idle:
```
inflight: 0 queued: 0
```
**Pass:** Both keys are present and are integers.

**Test M25-b — Queue counter increments under load (optional — now automated)**

> §E2E-6.7 covers this deterministically (`maxConcurrent=1`, 2 simultaneous calls, asserts
> `queued: 1`). Skip this manual step if the automated suite is green; run it only for visual confirmation.

Open a second terminal. In that terminal, fire 20 simultaneous tool calls into the background:
```
for i in $(seq 1 20); do
  curl -s -X POST http://localhost:3000/mcp \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Mcp-Session-Id: $SESSION" \
    -d "{\"jsonrpc\":\"2.0\",\"id\":$i,\"method\":\"tools/call\",\"params\":{\"name\":\"accordo.editor.open\",\"arguments\":{\"path\":\"/tmp/load-test-$i.txt\"}}}" &
done
```
Immediately in your first terminal, poll health several times quickly:
```
for i in 1 2 3 4 5; do curl -s http://localhost:3000/health | python3 -c "import sys,json; h=json.load(sys.stdin); print('inflight:', h['inflight'], 'queued:', h['queued'])"; sleep 0.1; done
```
What you should see — at least one poll shows `queued` > 0, and all polls eventually return to `inflight: 0 queued: 0` once all calls complete.

**Pass:** `queued` is > 0 in at least one poll during the burst, then drops to 0.

**Test M25-c — Queue-full response returns code -32004 with correct message**

Configure a server with depth 0 by forcing the queue-full error. The easiest way is to call `/mcp` with `maxQueueDepth=0` mode, but since the Hub is configured at startup, use a targeted curl to a maxConcurrent=0 Hub. In practice for manual testing, you can verify this with:
```
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Mcp-Session-Id: $SESSION" \
  -d '{"jsonrpc":"2.0","id":99,"method":"tools/call","params":{"name":"accordo.editor.open","arguments":{"path":"/tmp/x.txt"}}}' \
  | python3 -c "import sys,json; r=json.load(sys.stdin); e=r.get('error',{}); print(e.get('code'), e.get('message',''))"
```
Under normal load this will succeed. To trigger -32004 in the live Hub, you can alternatively look at the automated test result output in `bridge-server.test.ts` — the `CONC-04: returns -32004 when queue is full` test verifies this with code and message.

> For a deterministic manual verification of the message text, run the test suite:
> ```
> pnpm --filter accordo-hub test 2>&1 | grep "CONC-04"
> ```
> You should see `✓ CONC-04` as a passing test.

---

---

### Module M30-hub — Token persistence to `~/.accordo/token` on reauth

> **Automated coverage:** §E2E-6.6 in `bridge-e2e.test.ts`


> When `/bridge/reauth` receives a new token, Hub writes it to `~/.accordo/token` so CLI agents can read the updated credential without restarting.

**Setup:** Note the current token file contents:
```
OLD_TOKEN=$(cat ~/.accordo/token)
echo "Old token: $OLD_TOKEN"
```

You need the current Bridge secret to call `/bridge/reauth`. Read the active secret from VS Code's Output panel (Accordo Hub log) or use the Hub Manager's `getSecret()`. For the debug session, the secret is logged in Accordo Hub output when Bridge connects.

Alternatively, use the restart flow (M30-hub is exercised automatically by M27-a). If you want to test it in isolation, run the following — replace `CURRENT_SECRET` with the secret from the log:

```
CURRENT_SECRET=<bridge-secret-from-accordo-hub-output>
NEW_TOKEN=$(uuidgen | tr '[:upper:]' '[:lower:]')
NEW_SECRET=$(uuidgen | tr '[:upper:]' '[:lower:]')

curl -s -X POST http://localhost:3000/bridge/reauth \
  -H "Content-Type: application/json" \
  -H "x-accordo-secret: $CURRENT_SECRET" \
  -d "{\"newToken\":\"$NEW_TOKEN\",\"newSecret\":\"$NEW_SECRET\"}"
```
What you should see in the response:
```
{}
```
Now check the token file was updated:
```
cat ~/.accordo/token
echo $NEW_TOKEN
```
**Pass:** Both lines show the same UUID (`NEW_TOKEN`).
**Fail:** `~/.accordo/token` still shows the old token.

> **Note:** Running this raw reauth call will put Hub and Bridge secrets out of sync. After this test, run `Accordo: Restart Hub` from the Command Palette to resync.

---

---

## Part 3 — Final check

**Step 1.** Run the full automated test suite:
```
pnpm test
```
Wait for all packages to complete. You must see:
```
Tests  311 passed (311)    ← accordo-hub
Tests  293 passed (293)    ← accordo-bridge
Tests  172 passed (172)    ← accordo-editor
```
Zero failures, zero skipped.

**Step 2.** Run a full build to confirm compilation is clean:
```
pnpm build
```
All four packages must report `Done` with no TypeScript errors.

**Step 3.** Open the VS Code Problems panel (`Cmd+Shift+M`).
You should see zero errors and zero TypeScript warnings in any of the four packages.

**Step 4.** Review the Accordo Hub output channel one more time:
`Cmd+Shift+P` → **Accordo: Show Hub Log**

Confirm:
- No unexpected `[ERROR]` lines
- No `[accordo] Warning:` lines from `writeAgentConfigs` (`configureOpencode` and `configureClaude` both default to `true`, so warnings should only appear if config fields were somehow missing)

---

---

## Quick reference — test coverage summary

**Part 2A — manual only** (tests that need VS Code)

| Test | Requirement | Status |
|---|---|---|
| M26-a | opencode.json — `mcp` key, `type: "remote"` | **⚠️ NEEDS RETEST** (format was wrong, now fixed) |
| M26-b | .claude/mcp.json — `mcpServers` / `type: "http"` | needs run |
| M26-c | Both paths in .gitignore | needs run |
| M26-d | Both files mode 0600 | needs run |
| M27-a | opencode.json rewritten with new token after restart | done |
| M27-b | .claude/mcp.json also rewritten | done |
| M29-a | hub.pid written at startup | needs run |
| M29-b | Stale PID → fresh Hub spawn on activation | needs run |
| M30-bridge-a | Rotated credentials survive window reload | needs run |

**Part 2B — manual + automated E2E** (`pnpm --filter accordo-hub test` for auto columns)

| Test | Requirement | Auto coverage | Status |
|---|---|---|---|
| M21-a | "Invalid or expired session" error text | §E2E-6.1 | done |
| M22-a | WS close 4002 contains both version strings | §E2E-6.2 | done |
| M24-a | Audit entry written on success | §E2E-6.3 | done |
| M24-b | argsHash is SHA-256 hex (64 chars) | §E2E-6.3 | done |
| M24-c | Audit entry written on error with errorMessage | §E2E-6.4 | done |
| M24-d | audit.jsonl exists (side-effect of M24-a) | §E2E-6.3 | done — was missing, now explained |
| M25-a | Health shows inflight/queued fields | §E2E-6.5 | done |
| M25-b | queued > 0 under load, drains after | §E2E-6.7 | automated (was hard to observe manually) |
| M25-c | -32004 when queue full | unit CONC-04 | automated |
| M30-hub | ~/.accordo/token updated after /bridge/reauth | §E2E-6.6 | done |
