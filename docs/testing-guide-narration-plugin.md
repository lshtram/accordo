# Testing Guide — Narration Plugin (session.idle)

## What This Tests

The `session.idle` narration plugin (`narration.ts`) automatically narrates agent responses via `readAloud` after every response. It lives in `.opencode/plugins/` and activates when OpenCode connects to Accordo Hub.

## Prerequisites

1. **Accordo Hub running** at `localhost:3000` with `accordo.voice.enabled: true` and `narrationMode: "narrate-summary"` (or `"narrate-full"`) in VS Code settings
2. **OpenCode connected to Accordo Hub** via MCP (`opencode.json` → `http://localhost:3000/mcp`)
3. **Gemini API key** set as `GEMINI_API_KEY` environment variable (for summarization in `narrate-summary` mode)
4. **Plugin installed** at `.opencode/plugins/narration.ts`

## Section 1 — Agent-Automated Tests

Run the unit test suite:

```bash
cd /data/projects/accordo
npx vitest run .opencode/plugins/narration.test.ts .opencode/plugins/narration.resolve-config.test.ts
```

**Expected:** 50/50 tests pass.

---

## Section 2 — User Journey Tests

These test the plugin in a live OpenCode session.

### Setup

1. Open a terminal with OpenCode connected to Accordo Hub
2. Ensure voice settings are correct: `accordo.voice.enabled: true`, `accordo.voice.narrationMode: "narrate-summary"`
3. Set `GEMINI_API_KEY` in your environment if testing `narrate-summary`

---

### M2-NARR-01: `narrate-summary` — response is summarized and narrated

**Steps:**
1. Ask the agent: "Give me a 3-paragraph summary of the history of the Roman Empire"
2. Wait for the agent to finish responding
3. Observe: `session.idle` fires → 1.5s debounce → Gemini summarizes → `readAloud` is called

**Expected:** You hear a 2-3 sentence spoken summary of the response. No `[TTS]` tag visible in the text. The summary plays while you're reading or right after.

**Pass criteria:** Audio narration starts within ~2-3 seconds of the agent finishing. The narration is a summary, not the full text.

---

### M2-NARR-02: `narrate-summary` — short responses narrated in full

**Steps:**
1. Ask the agent: "What is 2+2?"
2. Wait for the response

**Expected:** The short response ("4") is narrated directly (no Gemini summarization needed).

**Pass criteria:** You hear "4" narrated. No Gemini call is made for trivial responses.

---

### M2-NARR-03: `narrate-full` — full response is narrated

**Steps:**
1. Set `accordo.voice.narrationMode: "narrate-full"` in VS Code settings
2. Ask the agent: "What is the capital of France?"
3. Wait for the response

**Expected:** The full response is narrated (not summarized).

**Pass criteria:** You hear the complete agent response read aloud.

---

### M2-NARR-04: `narrate-off` — no narration

**Steps:**
1. Set `accordo.voice.narrationMode: "narrate-off"` in VS Code settings
2. Ask the agent: "What is 1+1?"
3. Wait for the response

**Expected:** No audio plays.

**Pass criteria:** Silence after the agent responds. No `readAloud` tool call fires.

---

### M2-NARR-05: Debounce — rapid subagent completions don't double-narrate

**Steps:**
1. Set `accordo.voice.narrationMode: "narrate-summary"`
2. Ask the agent a complex multi-step task: "Write a Python script that downloads 3 web pages in parallel"
3. Observe: The agent may call multiple sub-agents or tools in rapid succession

**Expected:** `session.idle` fires after each subagent, but only the final idle triggers narration (after the 1.5s debounce window).

**Pass criteria:** Exactly one narration audio plays after the final response. Not multiple overlapping narrations.

---

### M2-NARR-06: Error handling — `readAloud` failure is silent

**Steps:**
1. Disconnect the voice extension (or set `accordo.voice.enabled: false`)
2. Ask the agent: "What is the capital of Italy?"
3. Observe: Agent responds normally

**Expected:** No error message appears. The agent's text response is shown. No crash.

**Pass criteria:** Graceful degradation — text is always visible, narration is best-effort.

---

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---|---|---|
| No narration at all | `GEMINI_API_KEY` missing or invalid | Set valid key in environment |
| Narration says "undefined" | `accordo_voice_readAloud` not registered | Restart Hub, verify tool is listed in `tools/list` |
| Double narration | `narrate-mode` also set in Hub prompt AND plugin active | Set Hub prompt to `narrate-off` when using plugin |
| Audio plays over previous narration | `session.idle` fires while previous narration is still playing | Normal — new narration queues or replaces previous |
| Debounce too long | `debounceMs` is 1500ms | Edit `narration.ts` line 33 — reduce `debounceMs` |

## Quick Verification Commands

```bash
# Verify Hub is running and tools are registered
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' \
  | python3 -m json.tool | grep accordo_voice

# Verify voice settings
# In VS Code: Settings → accordo.voice.enabled = true
# Settings → accordo.voice.narrationMode = "narrate-summary"
```
