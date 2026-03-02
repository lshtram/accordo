# Accordo Bridge — Manual Testing Guide

**Module:** `accordo-bridge` extension + `accordo-hub` server  
**Date:** 2026-03-02  
**Status:** Current — reflects state after Week 2 + bridge-server WS implementation + extension.ts

---

## Prerequisites

Before starting, make sure you are inside the repo:

```bash
cd /Users/Shared/dev/accordo
```

All commands below assume this is your current directory. Run them in your normal terminal (not inside VS Code's integrated terminal, unless stated).

---

## Step 1 — Build the Hub

The Hub is a standalone Node.js process. Build it first so its compiled output is available.

```bash
pnpm --filter accordo-hub build
```

Expected output:
```
> accordo-hub@0.1.0 build ...
> tsc -b
```

No errors. If you see errors, stop and fix them before continuing.

---

## Step 2 — Build the Bridge Extension

```bash
pnpm --filter accordo-bridge build
```

Expected output:
```
> accordo-bridge@0.1.0 build ...
> tsc -b
```

No errors. The compiled files land in `packages/bridge/dist/`.

---

## Step 3 — Open the Extension Development Host

This gives you a **second, isolated VS Code window** that runs your extension. Your current development window is completely unaffected.

**Option A — Keyboard shortcut (if you have function keys):**  
Press `F5`

**Option B — Via menu (no function keys required):**  
Menu bar → **Run** → **Start Debugging**

**Option C — Via Command Palette:**  
`Cmd+Shift+P` → type `Debug: Start Debugging` → Enter

**Which window to be in:**  
You must be in the VS Code window that has `/Users/Shared/dev/accordo` open — the one where you are reading this file. If you are not sure, look at the title bar: it should say `accordo`.

**What happens when you start:**
1. VS Code runs the `build-bridge` task automatically (you will see a brief terminal flash)
2. A new VS Code window opens — this is the **Extension Development Host (EDH)**
3. The EDH opens the `accordo` repo folder as its workspace
4. The `accordo-bridge` extension activates immediately inside the EDH
5. The extension reads credentials from secrets storage (empty on first run), generates a new token + secret, and tries to start/connect to the Hub

**How to tell it worked:**  
In the **EDH window**, open the Output panel:
- Menu bar → **View** → **Output**
- In the dropdown at the top-right of the Output panel, select **Accordo Hub**

You should see something like:
```
[accordo-bridge] Connected to Hub ✓
```

If you see `Accordo Hub failed to start` instead, go to Step 3a (troubleshooting).

---

### Step 3a — Troubleshooting: Hub Not Starting

The extension auto-spawns the Hub, but it needs to find the Hub entry point. On first run this path may need adjusting.

**In the EDH window**, open User Settings:
- `Cmd+Shift+P` → `Preferences: Open User Settings (JSON)`
- Add or check this entry:
```json
"accordo.hub.executablePath": ""
```
Leave it empty — this tells the extension to use the same Node.js that runs VS Code itself.

If the Hub still doesn't start, check the Output channel for the error. Common cause: `hubEntryPoint` path is wrong. In that case, run the Hub manually (Step 4 below) and let the extension connect to it rather than spawn it.

---

## Step 4 — Alternative: Run Hub Manually

If the auto-spawn is not working, or you want to control the Hub yourself, close the EDH and do this:

**Terminal 1 — Start the Hub:**
```bash
ACCORDO_TOKEN=demo-token ACCORDO_BRIDGE_SECRET=demo-secret \
  node packages/hub/dist/index.js --port 3000
```

Leave this running. You will see no output (that is normal — Hub is silent on startup).

**Then** start the EDH (Step 3) — but first tell the extension NOT to auto-spawn by adding this to your VS Code user settings (`Cmd+Shift+P` → `Preferences: Open User Settings (JSON)`):
```json
"accordo.hub.autoStart": false
```

Restart the EDH (`Cmd+Shift+P` → `Developer: Restart Extension Host`).

The extension will skip spawning and connect to your manually running Hub using the demo secret.

Wait — in this manual mode, the extension does not know the secret you used when you started the Hub manually. The extension generates its own secret. For them to agree, either:

- Use the extension's generated secret when starting the Hub (see Step 5 to find it), or
- Use the demo approach — just use `scripts/demo-bridge.mjs` to verify the Hub works independently, and use F5 for end-to-end with the real extension

The cleanest path remains Step 3 (F5) with auto-spawn. Use Step 4 only for debugging the Hub itself in isolation.

---

## Step 5 — Find the Bearer Token

The Hub writes the bearer token to `~/.accordo/token` on startup (mode 0600).

> **Important:** This only works if the Hub was started from the **compiled binary** after the fix in commit `f9848af`. If the file does not exist, the Hub binary is stale — rebuild and restart (see Step 1–3 again, then `Cmd+Shift+P → Accordo: Restart Hub` in the EDH).

**Read it in a terminal:**
```bash
cat ~/.accordo/token
```

Example output (a long hex string):
```
a1b2c3d4-e5f6-...
```

Use it inline in every curl command:
```bash
TOKEN=$(cat ~/.accordo/token)
```

---

## Step 6 — Verify Hub Health

In any terminal (not the one running the Hub, if you started it manually):

```bash
curl -s http://localhost:3000/health | python3 -m json.tool
```

Expected response:
```json
{
    "ok": true,
    "uptime": 4.2,
    "bridge": "connected",
    "toolCount": 0,
    "protocolVersion": "1",
    "inflight": 0,
    "queued": 0
}
```

Key things to verify:
- `"ok": true` — Hub is running
- `"bridge": "connected"` — the extension has a live WebSocket connection (**this is the key test**)
- `"toolCount": 0` — no tools yet (the `accordo-editor` extension has not been built yet)

If `"bridge": "disconnected"` — the extension is not connected. Go back to Step 3 and check the Output channel in the EDH.

---

## Step 7 — Read the System Prompt

This is what an AI agent would receive when it connects. It shows the live IDE state captured from the EDH window.

```bash
curl -s -H "Authorization: Bearer $(cat ~/.accordo/token)" \
  http://localhost:3000/instructions
```

You should see a markdown document. The interesting section is **Current IDE State**:

```markdown
## Current IDE State

**Workspace:** accordo

**Active file:** /Users/Shared/dev/accordo/docs/testing-guide-bridge.md (line 1, col 1)

**Open editors:**
- docs/testing-guide-bridge.md
- packages/bridge/src/extension.ts
...

**Workspace folders:**
- /Users/Shared/dev/accordo

**Active terminal:** zsh
```

The values here reflect what is actually open in the **EDH window**, not your development window.

**To see it update in real time:**
1. In the EDH window, open a different file (click any file in the explorer)
2. Run the curl command again
3. The `Active file` field changes

---

## Step 8 — Use the Bridge Status Command

In the **EDH window**, open the Command Palette:  
`Cmd+Shift+P` → type `Accordo: Show Connection Status` → Enter

A notification should appear in the bottom-right corner:
```
Accordo Bridge: Connected ✓
```

Other available commands:
- `Accordo: Show Hub Log` — opens the Output channel
- `Accordo: Restart Hub` — performs soft credential rotation and reconnect

---

## Step 9 — Query Raw IDE State

The Hub exposes a `/state` endpoint that returns the full IDE state as JSON. This is the raw data that feeds the `/instructions` prompt.

```bash
curl -s -H "Authorization: Bearer $(cat ~/.accordo/token)" \
  http://localhost:3000/state | python3 -m json.tool
```

Example output:
```json
{
    "activeFile": "/Users/Shared/dev/dream-news/docs/requirements/REQ-RSS-Collector.md",
    "activeFileLine": 42,
    "activeFileColumn": 1,
    "openEditors": [
        "/Users/Shared/dev/dream-news/docs/requirements/REQ-SmartDeduplication.md",
        "/Users/Shared/dev/dream-news/docs/requirements/REQ-RSS-Collector.md"
    ],
    "visibleEditors": [
        "/Users/Shared/dev/dream-news/docs/requirements/REQ-RSS-Collector.md"
    ],
    "workspaceFolders": [
        "/Users/Shared/dev/dream-news"
    ],
    "activeTerminal": "zsh",
    "workspaceName": "dream-news",
    "remoteAuthority": null,
    "modalities": {}
}
```

**Query specific fields with `jq`** (install with `brew install jq` if needed):

```bash
# Which file is active?
curl -s -H "Authorization: Bearer $(cat ~/.accordo/token)" \
  http://localhost:3000/state | jq '.activeFile'

# What line and column is the cursor on?
curl -s -H "Authorization: Bearer $(cat ~/.accordo/token)" \
  http://localhost:3000/state | jq '{line: .activeFileLine, col: .activeFileColumn}'

# Which files are open as editor tabs?
curl -s -H "Authorization: Bearer $(cat ~/.accordo/token)" \
  http://localhost:3000/state | jq '.openEditors'

# Which editors are visible (split panes)?
curl -s -H "Authorization: Bearer $(cat ~/.accordo/token)" \
  http://localhost:3000/state | jq '.visibleEditors'

# Active terminal name
curl -s -H "Authorization: Bearer $(cat ~/.accordo/token)" \
  http://localhost:3000/state | jq '.activeTerminal'

# Extension modality data (e.g. from registered extensions)
curl -s -H "Authorization: Bearer $(cat ~/.accordo/token)" \
  http://localhost:3000/state | jq '.modalities'
```

---

## Step 10 — Verify State Updates Flow

This confirms that editor events in the EDH are captured and streamed to the Hub in real time.

1. **Switch files in the EDH window**: click on any `.ts` file in the explorer
2. **Wait ~100ms** (the debounce)
3. **Query `/state` again**:
   ```bash
   curl -s -H "Authorization: Bearer $(cat ~/.accordo/token)" \
     http://localhost:3000/state | jq '{active: .activeFile, line: .activeFileLine}'
   ```
4. The `activeFile` should now show the file you just opened

You can automate a live watch:
```bash
watch -n1 "curl -s -H 'Authorization: Bearer \$(cat ~/.accordo/token)' \
  http://localhost:3000/state | python3 -m json.tool"
```
(`watch` may not be installed on macOS — install with `brew install watch` or use the `while` loop version):
```bash
while true; do
  curl -s -H "Authorization: Bearer $(cat ~/.accordo/token)" \
    http://localhost:3000/state | jq '{active: .activeFile, line: .activeFileLine}'
  sleep 1
done
```

---

## Step 11 — Stop the Test Session

1. **Close the EDH window** (click the red × on the title bar, or `Cmd+Q` with that window focused)
2. The extension deactivates — it closes the WebSocket to the Hub but **does NOT kill the Hub process** (by design — the Hub stays alive so CLI agents can keep using it)
3. If you started the Hub manually, stop it:
   - Find its PID: `cat ~/.accordo/hub.pid`
   - Kill it: `kill $(cat ~/.accordo/hub.pid)`
   - Or just `Ctrl+C` in the terminal where it is running

---

## Checklist Summary

| # | Check | Expected Result |
|---|---|---|
| 1 | `pnpm --filter accordo-hub build` | No errors |
| 2 | `pnpm --filter accordo-bridge build` | No errors |
| 3 | Start EDH (Run → Start Debugging) | Second VS Code window opens |
| 4 | Output → Accordo Hub in EDH | `Connected to Hub ✓` |
| 5 | `curl /health` | `"bridge": "connected"` |
| 6 | `curl /instructions` | Shows workspace, active file, open editors |
| 7 | `curl /state \| jq .activeFile` | Shows the file focused in EDH |
| 8 | Switch file in EDH, re-curl `/state` | `activeFile` and line change |
| 9 | Command Palette → `Accordo: Show Connection Status` | `Connected ✓` notification |

If all 9 checks pass, the real Bridge extension is working end-to-end.

---

## Appendix — Quick Reference Commands

```bash
# Build both packages
pnpm --filter accordo-hub build
pnpm --filter accordo-bridge build

# Read the token the extension wrote
cat ~/.accordo/token

# Health check
curl -s http://localhost:3000/health | python3 -m json.tool

# Full system prompt
curl -s -H "Authorization: Bearer $(cat ~/.accordo/token)" \
  http://localhost:3000/instructions

# Raw IDE state as JSON
curl -s -H "Authorization: Bearer $(cat ~/.accordo/token)" \
  http://localhost:3000/state | python3 -m json.tool

# Active file + cursor position
curl -s -H "Authorization: Bearer $(cat ~/.accordo/token)" \
  http://localhost:3000/state | jq '{file: .activeFile, line: .activeFileLine, col: .activeFileColumn}'

# Open editor tabs
curl -s -H "Authorization: Bearer $(cat ~/.accordo/token)" \
  http://localhost:3000/state | jq '.openEditors'

# Just the IDE state section from /instructions
curl -s -H "Authorization: Bearer $(cat ~/.accordo/token)" \
  http://localhost:3000/instructions \
  | awk '/## Current IDE State/,/## Registered Tools/'
```
