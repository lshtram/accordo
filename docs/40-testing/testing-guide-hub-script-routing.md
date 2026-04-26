# Testing Guide — Hub-Based Script Routing (`hub-script-routing`)

> **Archived [2026-04-16]:** The built-in scripting engine has been removed. This guide describes the now-removed Hub-based script routing architecture. External script authoring via `skills/script-authoring/accordo-run.py` is the replacement path.

> **ARCHIVED — 2026-04-16:** This testing guide applied to the now-removed built-in scripting engine. The `accordo_script_*` tools are no longer registered.

## What This Tests

The NarrationScript execution engine has been moved from the VS Code extension host into the Hub. Scripts are now executed by the Hub, and all tool calls from scripts (editor, voice, terminal, layout) route through `bridgeServer.invoke()` to the Bridge — the same path AI agents use.

This means:
- `accordo_script_run`, `accordo_script_stop`, `accordo_script_status`, `accordo_script_discover` are **Hub-native tools** — they execute inside the Hub process, not in the VS Code extension host
- When a running script calls `accordo_editor_open` or `accordo_voice_readAloud`, those go through Hub → Bridge → VS Code, exactly like an AI agent making the same call
- The Bridge has no knowledge that a script is running; it just sees tool calls

---

## Prerequisites

1. **Hub built:** `pnpm build` at workspace root
2. **Full system deployed:** Hub process running, Bridge connected (VS Code with Accordo extensions loaded), all modality extensions active
3. **MCP client connected** to the Hub (OpenCode, Claude Code, or any MCP client)

---

## Section 1 — Agent-Automated Tests

### 1a. Unit tests (Hub package)

```bash
cd /data/projects/accordo
pnpm --filter accordo-hub test
```

**Expected:** 517 tests pass. 0 failures.

Key test groups:
- `script-deps-adapter.test.ts` (16 tests) — `executeCommand` wraps `bridgeServer.invoke()`, throws on `success === false`, re-throws transport errors, `showSubtitle` is fire-and-forget
- `script-tools.test.ts` (27 tests) — 4 tool factories (`run`, `stop`, `status`, `discover`) return correct `HubToolRegistration` shape, `scriptId` is generated as UUID, input validation rejects bad scripts
- `tool-registry.test.ts` (31 tests) — dual-pool: `hubTools` persistent across Bridge re-registration, `bridgeTools` wiped and rebuilt, `list()` merges both, `get()` checks hub first
- `mcp-handler.test.ts` (50 tests) — `localHandler` short-circuit fires for Hub-native tools, `bridgeServer.invoke()` called for Bridge tools
- `bridge-e2e.test.ts` (35 tests) — full pipeline: Bridge registers tools, Hub dispatches, tool call round-trips back

### 1b. Unit tests (Script package — original extension, unchanged)

```bash
pnpm --filter accordo-script test
```

**Expected:** 133 tests pass. The old script extension is untouched by this refactor.

### 1c. Type checker

```bash
pnpm --filter accordo-hub build
```

**Expected:** `tsc -b` exits 0. Zero TypeScript errors.

### 1d. Linter

```bash
pnpm --filter accordo-hub lint
```

**Expected:** 0 errors. 3 pre-existing warnings (non-blocking `no-non-null-assertion` in `prompt-engine.ts`, `server.ts`).

### 1e. Deployed E2E verification

**What to verify:** The full pipeline — Hub → Bridge → VS Code extension.

**Setup:**
1. Start VS Code with all Accordo extensions loaded (Bridge, Editor, Voice, Script)
2. Start the Hub process (`pnpm start` in `packages/hub/`)
3. Connect an MCP client to the Hub

**Test script — `demo/accordo-intro.deck.md` walkthrough:**

Use the `accordo_script_run` tool via your MCP client:

```json
{
  "name": "accordo_script_run",
  "arguments": {
    "script": {
      "label": "Intro walkthrough",
      "errPolicy": "abort",
      "steps": [
        { "type": "command", "command": "accordo_presentation_goto", "args": { "index": 1 } },
        { "type": "speak", "text": "Welcome to Accordo IDE. Your AI co-pilot for VS Code.", "block": true },
        { "type": "delay", "ms": 3000 },
        { "type": "command", "command": "accordo_presentation_goto", "args": { "index": 2 } },
        { "type": "speak", "text": "Slide two. The problem: context switching kills developer flow.", "block": true },
        { "type": "delay", "ms": 3000 },
        { "type": "command", "command": "accordo_editor_open", "args": { "path": "docs/10-architecture/architecture.md", "line": 1 } },
        { "type": "speak", "text": "Here's the architecture overview.", "block": true }
      ]
    }
  }
}
```

**Expected observations:**
- `accordo_script_run` returns immediately with `{ started: true, scriptId: "<UUID>", steps: 8 }`
- Slide 1 appears in the presentation panel
- Speech plays for slide 1 narration
- After 3s delay, slide 2 appears
- Speech plays for slide 2 narration
- After 3s delay, `architecture.md` opens in the editor
- Final narration plays

**Poll for status:**
```json
{ "name": "accordo_script_status", "arguments": {} }
```

Returns:
```json
{ "state": "completed", "currentStep": 7, "totalSteps": 8, "scriptId": "<UUID>" }
```

### 1f. Stop mid-script (E2E)

Run a long script and stop it:

```json
{
  "name": "accordo_script_run",
  "arguments": {
    "script": {
      "steps": [
        { "type": "delay", "ms": 60000 },
        { "type": "speak", "text": "This should not play.", "block": true }
      ]
    }
  }
}
```

Immediately call:
```json
{ "name": "accordo_script_stop", "arguments": {} }
```

**Expected:** `accordo_script_stop` returns `{ stopped: true, wasRunning: true }`. The 60s delay is cancelled. No speech plays.

**Poll for status:**
```json
{ "name": "accordo_script_status", "arguments": {} }
```
Returns: `{ "state": "stopped", ... }`

---

## Section 2 — User Journey Tests

These are steps a human can follow in VS Code + an MCP-connected AI agent.

### SJ-1: Run a presentation narration with the AI agent

**What you'll do:** Ask the AI agent to narrate the first 3 slides of the demo deck using a script.

**Steps:**
1. Open VS Code with all Accordo extensions loaded
2. Connect your AI agent (OpenCode, Claude Code, etc.) to the Accordo Hub
3. Say to the agent: "Open the demo presentation deck and narrate the first 3 slides"
4. The agent will call `accordo_presentation_open` to open `demo/accordo-intro.deck.md`
5. The agent will call `accordo_script_run` with a script that navigates to slides and narrates each one
6. Watch the presentation panel — you should see slide 1, then slide 2, then slide 3
7. Listen — you should hear TTS narration for each slide
8. After slide 3, the agent's script completes

**What a pass looks like:** The slides appear in order. Each narration plays in sequence. No errors in the AI agent's output.

---

### SJ-2: Stop a running script

**What you'll do:** While a script is running, ask the agent to stop it.

**Steps:**
1. Have the agent start a long script (e.g., narrate all 13 slides of `accordo-intro.deck.md`)
2. While it's running, say: "Stop the narration"
3. The agent calls `accordo_script_stop`
4. The script stops — no more slides advance, no more narration

**What a pass looks like:** The presentation stops on the current slide. TTS stops. No errors.

---

### SJ-3: Script discovers available tools dynamically

**What you'll do:** Ask the agent what commands are available in a script.

**Steps:**
1. Say to the agent: "What tools can I use in a script step?"
2. The agent calls `accordo_script_discover`
3. The agent reads the `registeredCommandIds` section of the response — this lists every tool currently registered in the Hub

**What a pass looks like:** The response lists `accordo_editor_open`, `accordo_editor_highlight`, `accordo_presentation_goto`, `accordo_voice_readAloud`, etc. — all the tools that are currently registered by active extensions. If you install a new extension that registers more tools, they appear here automatically.

---

## Residual Risk — `accordo_subtitle_show`

The Hub adapter calls `bridgeServer.invoke("accordo_subtitle_show", ...)` for the `showSubtitle` step type. This requires a Bridge-side tool named `accordo_subtitle_show` to be registered and responding. That tool does not yet exist in the Bridge — it is tracked as a separate development task (the subtitle service).

If `showSubtitle` steps are used before that tool is implemented, the Bridge call will fail silently (fire-and-forget, errors swallowed) and the subtitle will not appear. This is a **known gap** with no current test coverage in the E2E scenarios above.

**Mitigation:** The subtitle service (`accordo_subtitle_show` Bridge tool) is required before `subtitle` steps can work in scripts.
