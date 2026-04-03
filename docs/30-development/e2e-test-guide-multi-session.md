# Multi-Session E2E Testing — Manual Verification

**Module:** Priority I — Multi-Session Ephemeral Hub  
**Date:** 2026-04-03  
**What you need:** VSCode with the accordo-bridge extension built, two terminal windows

---

## Step 1 — Build (done)

```bash
cd /data/projects/accordo
pnpm build
```

This compiles all packages including the VSIX extension.

---

## Step 2 — Open VSCode (starts the Hub)

```bash
code /data/projects/accordo
```

When VSCode opens:
- The `accordo-bridge` extension activates (`onStartupFinished`)
- Bridge checks if Hub is already running
- No → Bridge spawns a new `accordo-hub` node process
- Hub starts on port 3000 (or next free port)
- Hub prints `[hub] Listening on 127.0.0.1:<port>` to stderr
- Bridge polls `GET /health` until OK
- Bridge connects WebSocket to Hub
- Bridge writes `accordo/.opencode/opencode.json` with the port + Bearer token

---

## Step 3 — Verify Hub is Running

```bash
ps aux | grep accordo-hub | grep -v grep
```

You should see a node process. If not, check the VSCode Output panel → `accordo-bridge` for logs.

---

## Step 4 — Check opencode.json

The file is written to the **workspace root** as `opencode.json` (not `.opencode/opencode.json`):

```bash
cat /data/projects/accordo/opencode.json
```

Should contain:
```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "accordo": {
      "type": "remote",
      "url": "http://localhost:3000/mcp",
      "headers": {
        "Authorization": "Bearer <token>"
      }
    }
  }
}
```

> Note: The existing `.opencode/` directory in the repo is opencode's own config directory — the Bridge writes to `opencode.json` in the workspace root.
```

---

## Step 5 — Start First opencode Session (Terminal 1)

```bash
cd /data/projects/accordo
opencode
```

opencode reads `.opencode/opencode.json` and connects to the Hub.

**Test something:**
- Ask opencode: "what files are open?" or any question that exercises the Hub
- Or directly use an MCP tool call

---

## Step 6 — Start Second opencode Session (Terminal 2)

```bash
cd /data/projects/accordo
opencode
```

Now you have **two opencode sessions** connected to the **same Hub**.

**Test something:**
- In Session 1: open a file with `accordo_editor_open`
- In Session 2: ask about the open file — it should see the same state
- Both agents can work simultaneously through the same Hub

---

## Step 7 — Verify Multi-Session: One Agent Closes, Other Survives

1. Close Terminal 1 (one opencode session dies)
2. Terminal 2 (second opencode) should still be responsive — the Hub is still running
3. The Hub serves both sessions — losing one doesn't kill the Hub

---

## Step 8 — VSCode Closes → Hub Dies (Ephemeral Lifecycle)

1. Close VSCode entirely
2. Check: `ps aux | grep accordo-hub | grep -v grep` — should show NO hub process
3. The Hub died with VSCode (SIGTERM on deactivate)
4. `opencode.json` still has the old port/token — it's now stale

---

## Step 9 — Reopen VSCode → New Hub Starts

1. Reopen VSCode with `code /data/projects/accordo`
2. New Hub spawns (possibly on a different port if 3000 is reused)
3. `accordo/.opencode/opencode.json` is updated with the new port + token
4. opencode sessions need to reconnect (read the new opencode.json)

---

## Step 10 — Multi-Project (Two VSCode Windows)

Open a **second VSCode window** with a different project:

```bash
code ~/projects/other-project
```

This creates a **separate Hub** on a **different port** (e.g., 3001):
- Each project has its own `opencode.json` in its workspace root
- Each Hub only serves its own VSCode window
- They are fully isolated

---

## Debugging

| Symptom | Check |
|---|---|
| Hub not spawning | VSCode Output → accordo-bridge logs |
| opencode can't connect | Is the port in opencode.json correct? |
| opencode can't connect | Is the port in `opencode.json` correct? (`localhost:3000`) |
| opencode gets 401 | Token mismatch — restart VSCode to get fresh Hub |
| Two hubs on same port | Port collision — check `opencode.json` for correct port |
| Hub not dying with VSCode | `deactivate()` not killing Hub — check bridge logs |

---

## Check Audit Log

Tool calls are logged to `~/.accordo/audit.jsonl`:

```bash
tail -20 ~/.accordo/audit.jsonl | jq .
```

Look for `agentHint` field in each entry — proves MS-05 (agent attribution) works.
