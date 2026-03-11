# Testing Guide — Session 10D: `accordo-script` (M52-FMT through M52-EXT)

**Date:** Session 10D  
**Package:** `packages/script/` (`accordo-script`)  
**Total automated tests:** 133  
**Modules:** M52-FMT, M52-SR, M52-SB, M52-TOOL-01, M52-TOOL-02, M52-TOOL-03, M52-EXT

---

## Part 1 — Automated Tests (CI Gate)

Run before any manual testing:

```bash
pnpm --filter accordo-script test
```

Expected output: `Tests  133 passed (133)`. If any fail, do not proceed to manual verification.

Full workspace regression:

```bash
pnpm test
```

Expected output: All 1,838 tests passing. Check that no pre-existing tests regressed.

---

## Part 2 — Setup for Manual Testing

### 2.1 Build the workspace

```bash
pnpm build
```

All packages should build without errors. Confirm `packages/script/dist/extension.js` exists:

```bash
ls packages/script/dist/extension.js
```

### 2.2 Launch the Extension Development Host

Press **F5** from the **root workspace** (not from inside a package folder). This uses `.vscode/launch.json` which loads Bridge, Editor, Comments, Md-Viewer, Slidev, Voice, **and Script** all together into a single Extension Development Host window.

- The launch configuration is named **"Launch Bridge + Editor + Voice (Extension Development Host)"**.
- A new VS Code window (the EDH) opens with this repo as its workspace.
- Wait ~3 seconds for all extensions to activate.

### 2.3 Verify the Script extension activated

In the EDH, open **View → Output** and select channel **"Accordo Script"** (if present) — no activation error should appear.

Alternatively, open the Command Palette (**Cmd+Shift+P**) and type `Accordo Script` — you should see the command:

> **Accordo Script: Stop Running Script**

If the command does not appear, the extension either failed to activate or `dist/extension.js` is missing.

### 2.4 Start the Hub

In a terminal in the **host** window (not the EDH):

```bash
ACCORDO_TOKEN=demo-token ACCORDO_BRIDGE_SECRET=demo-secret \
  node packages/hub/dist/index.js --port 3000
```

Confirm the Hub is up:

```bash
curl http://localhost:3000/health
```

Expected response: `{"status":"ok"}` (or similar status payload).

### 2.5 Confirm Bridge connected and script tools registered

In the EDH, open **View → Output** → **"Accordo Bridge"**. You should see:

- `[bridge] connected to hub`
- A log line listing the registered tool count — it should be 3 higher than it was without the script extension (now includes `accordo_script_run`, `accordo_script_stop`, `accordo_script_status`).

You can also verify via the Hub's tools list:

```bash
curl -H "Authorization: Bearer demo-token" http://localhost:3000/instructions | \
  grep -c "accordo_script"
```

Expected result: `3`

---

## Part 3 — Tool Tests

### Tool 1: `accordo_script_status`

**Purpose (M52-TOOL-03):** Read-only status query. Always safe; never changes state.

#### Test 3.1.1 — Idle state

With no script running, invoke:

```
Use accordo_script_status to check the current script state.
```

**Expected response:**

```json
{
  "state": "idle",
  "currentStep": -1,
  "totalSteps": 0
}
```

`errorMessage` should be absent (the field is only present on error).

#### Test 3.1.2 — Idempotent (call twice in a row)

Invoke `accordo_script_status` a second time immediately.

**Expected:** Identical response to Test 3.1.1. No side effects.

---

### Tool 2: `accordo_script_run`

**Purpose (M52-TOOL-01):** Validate and fire-and-forget start a NarrationScript.

#### Test 3.2.1 — Validation error: empty steps array

```
Run accordo_script_run with this script: { "steps": [] }
```

**Expected response:**

```json
{ "error": "Invalid script: steps must be an array of 1–200 steps" }
```

No visual change in VS Code. State remained `idle`.

#### Test 3.2.2 — Validation error: unknown step type

```
Run accordo_script_run with this script:
{
  "steps": [{ "type": "unknown-type", "text": "hello" }]
}
```

**Expected response:**

```json
{ "error": "Invalid script: step[0].type must be one of: speak, subtitle, command, delay, highlight, clear-highlights" }
```

#### Test 3.2.3 — Validation error: delay ms out of range

```
Run accordo_script_run with this script:
{
  "steps": [{ "type": "delay", "ms": 99999 }]
}
```

**Expected response:**

```json
{ "error": "Invalid script: step[0].ms must be between 1 and 30000" }
```

#### Test 3.2.4 — Successful start: subtitle step

```
Run accordo_script_run with this script:
{
  "label": "Hello World",
  "steps": [
    { "type": "subtitle", "text": "Hello from accordo-script!", "durationMs": 4000 },
    { "type": "delay", "ms": 500 },
    { "type": "clear-highlights" }
  ]
}
```

**Expected response** (within ~10 ms):

```json
{
  "started": true,
  "scriptId": "<some-id>",
  "steps": 3,
  "label": "Hello World"
}
```

**Expected in VS Code (EDH):**  
- The status bar bottom-left shows `$(comment) Hello from accordo-script!` for 4 seconds, then disappears.
- The script completes in the background; the tool responded before the steps ran (fire-and-forget confirmed).

#### Test 3.2.5 — Status query during a running script

Start a long-running script first:

```
Run accordo_script_run with this script:
{
  "steps": [
    { "type": "delay", "ms": 5000 },
    { "type": "delay", "ms": 5000 }
  ]
}
```

Immediately after (within ~1 second), query status:

```
Use accordo_script_status to check the current state.
```

**Expected response:**

```json
{
  "state": "running",
  "currentStep": 0,
  "totalSteps": 2
}
```

(Step index may be 0 or 1 depending on timing — the key assertion is `state: "running"`.)

#### Test 3.2.6 — Busy rejection

While the long-running script from Test 3.2.5 is still running (within the 10 s window):

```
Run accordo_script_run with this script:
{
  "steps": [{ "type": "subtitle", "text": "I should not start" }]
}
```

**Expected response:**

```json
{ "error": "Script already running — call accordo_script_stop first" }
```

#### Test 3.2.7 — Highlight step

```
Run accordo_script_run with this script:
{
  "steps": [
    { "type": "highlight", "file": "packages/script/src/script-types.ts", "startLine": 1, "endLine": 10 },
    { "type": "delay", "ms": 3000 },
    { "type": "clear-highlights" }
  ]
}
```

**Expected response:** `{ "started": true, ... }`

**Expected in VS Code (EDH):**
- The file `packages/script/src/script-types.ts` opens in the editor.
- Lines 1–10 are highlighted with a yellow/orange background (the `editor.findMatchHighlightBackground` theme colour).
- After 3 seconds the highlight vanishes.

#### Test 3.2.8 — Command step (run a VS Code command)

```
Run accordo_script_run with this script:
{
  "steps": [
    { "type": "command", "command": "workbench.action.showCommands" }
  ]
}
```

**Expected in VS Code (EDH):** The Command Palette opens. This verifies the `command` step correctly calls `vscode.commands.executeCommand`.

#### Test 3.2.9 — Speak step (voice installed)

*Prerequisites: accordo-voice extension is active and TTS providers are available.*

```
Run accordo_script_run with this script:
{
  "steps": [
    { "type": "speak", "text": "Script test complete.", "block": true }
  ]
}
```

**Expected in VS Code (EDH):** You hear "Script test complete." spoken aloud. The tool responds only after the speech finishes (`block: true`).

#### Test 3.2.10 — Speak fallback when voice unavailable

*To test this: temporarily disable the `accordo-voice` extension in the EDH, then reload.*

```
Run accordo_script_run with this script:
{
  "steps": [
    { "type": "speak", "text": "This is a fallback subtitle", "block": true }
  ]
}
```

**Expected in VS Code (EDH):** No audio plays. Instead, the subtitle bar shows `$(comment) This is a fallback subtitle` for at least 2 seconds (fallback duration = `Math.max(2000, wordCount * 250)` ms). The tool responds after that duration.

---

### Tool 3: `accordo_script_stop`

**Purpose (M52-TOOL-02):** Interrupt a running script. Idempotent.

#### Test 3.3.1 — Stop a running script

Start a long script:

```
Run accordo_script_run with this script:
{
  "steps": [
    { "type": "delay", "ms": 10000 },
    { "type": "subtitle", "text": "You should never see this" }
  ]
}
```

Immediately invoke:

```
Use accordo_script_stop to stop the running script.
```

**Expected response:**

```json
{ "stopped": true, "wasRunning": true }
```

**Expected in VS Code (EDH):** The subtitle bar (if showing anything) clears. No further steps execute.

Verify with status:

```
Use accordo_script_status to confirm the script stopped.
```

**Expected:** `state` is `"stopped"` or `"idle"` (the runner transitions to `stopped` after cancellation).

#### Test 3.3.2 — Stop when idle (idempotent)

With no script running:

```
Use accordo_script_stop.
```

**Expected response:**

```json
{ "stopped": true, "wasRunning": false }
```

No error. Calling stop when nothing is running is always safe.

#### Test 3.3.3 — VS Code command palette stop

While a script is running (start another long script first):

1. Open Command Palette (**Cmd+Shift+P**) in the EDH.
2. Type `Accordo Script: Stop Running Script` and press Enter.

**Expected:** The running script is cancelled. This verifies the `accordo.script.stop` VS Code command (separate from the MCP tool) also works.

---

## Part 4 — Edge Cases & Error Policy

#### Test 4.1 — errPolicy: "skip" continues past bad steps

```
Run accordo_script_run with this script:
{
  "errPolicy": "skip",
  "steps": [
    { "type": "subtitle", "text": "Step 1" },
    { "type": "command", "command": "this.command.does.not.exist.anywhere" },
    { "type": "subtitle", "text": "Step 3 — I should still run" }
  ]
}
```

**Expected in VS Code:** Status bar shows "Step 1" and later "Step 3 — I should still run". The failing command step in the middle is skipped, not aborted.

#### Test 4.2 — errPolicy: "abort" (default) stops at first error

```
Run accordo_script_run with this script:
{
  "steps": [
    { "type": "subtitle", "text": "Step 1" },
    { "type": "command", "command": "this.command.does.not.exist.anywhere" },
    { "type": "subtitle", "text": "Step 3 — I should NOT run" }
  ]
}
```

**Expected in VS Code:** Status bar shows "Step 1". After the command error, execution stops. "Step 3" subtitle never appears.

---

## Part 5 — Final Check

### 5.1 Automated tests (full suite)

```bash
pnpm test
```

Expected: All tests pass. No regressions anywhere in the workspace.

### 5.2 TypeScript — zero errors

```bash
pnpm typecheck
```

Expected: All packages report `Done` with zero errors.

### 5.3 VS Code Problems panel

In both the host window and the EDH, open **View → Problems** (**Cmd+Shift+M**). Confirm zero TypeScript or ESLint errors in `packages/script/`.

### 5.4 No banned patterns in new code

```bash
grep -r ": any" packages/script/src/ && echo "FOUND :any"
grep -r "console\." packages/script/src/ && echo "FOUND console"
grep -rE "TODO|FIXME" packages/script/src/ && echo "FOUND TODO/FIXME"
```

All three commands should produce no output (exit code 1 = "nothing found" = correct).

---

## Appendix — Modules Covered

| Module ID | Name | Tests | Status |
|---|---|---|---|
| M52-FMT | Script Format & Validation (`validateScript`) | 33 | ✅ |
| M52-SB | ScriptSubtitleBar | 15 | ✅ |
| M52-SR | ScriptRunner (state machine, steps, stop) | 50 | ✅ |
| M52-TOOL-01 | `accordo_script_run` MCP tool | 15 | ✅ |
| M52-TOOL-02 | `accordo_script_stop` MCP tool | 10 | ✅ |
| M52-TOOL-03 | `accordo_script_status` MCP tool | 10 | ✅ |
| M52-EXT | Extension wiring (`activate`) | —* | ✅ |

\* M52-EXT activation is validated manually via the EDH (Part 2.3 above) and by the TypeScript build.

---

## Appendix — Step Type Reference

| Step type | Key fields | Notes |
|---|---|---|
| `speak` | `text`, `voice?`, `speed?`, `block?` | Requires accordo-voice; falls back to subtitle + delay |
| `subtitle` | `text`, `durationMs?` | Status bar bottom-left; default 3000 ms |
| `command` | `command`, `args?` | Any VS Code command ID; extensibility hook for all future modalities |
| `delay` | `ms` (1–30 000) | Pure wait; no VS Code UI change |
| `highlight` | `file`, `startLine`, `endLine`, `durationMs?` | Opens file; applies `findMatchHighlightBackground` decoration |
| `clear-highlights` | *(none)* | Removes all decorations applied by `highlight` steps |
