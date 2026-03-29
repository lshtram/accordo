# Testing Guide — Session 10B: Summary Narration Prompt + Streaming TTS

**Date:** 2026-03-09  
**Packages:** `packages/hub/` (M51-SN) · `packages/voice/` (M51-STR)  
**Total automated tests added:** 25 (Hub: 10, Voice: 15)  
**New test totals:** Hub 356 · Voice 226  
**Commits:** `11d73c3` (M51-SN) · `97cda5b` (M51-STR)

---

## 1. What Was Built

### M51-SN — Narration Directive in Hub System Prompt

Before this session, the Hub's system prompt never mentioned voice. The agent had no idea it could call `accordo_voice_readAloud` after responding.

Now, when the voice extension publishes state with `policy.enabled = true`, the Hub renders a dedicated `## Voice` section in the system prompt it sends to every agent request. The section contains:

- A **status line**: which session state and providers are active.
- A **mode line**: narration mode, speed, and voice name.
- A **directive** (conditionally): exact instruction of *when* and *how* to call `readAloud`.

The directive adapts to the active `narrationMode`:

| `narrationMode` | Directive in prompt |
|---|---|
| `narrate-summary` | *"call accordo_voice_readAloud with a 2-3 sentence spoken summary … Do not repeat the full response"* |
| `narrate-everything` | *"call accordo_voice_readAloud with your full response text. The text cleaning pipeline will handle markdown/code"* |
| `narrate-off` | No directive — section shows status/mode only |

The `accordo-voice` modality is **excluded from the generic JSON Extension state** dump — it gets the dedicated section instead, so the agent sees structured readable text rather than raw JSON.

### M51-STR — Streaming TTS (Sentence-Level Pipeline)

Before this session, `readAloud` synthesised the entire text as one block before playing any audio. Long responses had high latency (full synthesis time before first sound).

Now `streamingSpeak` splits cleaned text into sentences (via the existing `splitIntoSentences`) and pipelines synthesis + playback:

- **Sentence N** starts playing the moment its synthesis finishes.
- **Sentence N+1** is already being synthesised in parallel while N plays.
- Result: the user hears the first sentence after synthesising only ~1 sentence (~200–300 ms with Kokoro), not the full response.
- Single-sentence text: direct single-shot (no overhead).
- Cancellation: checked at each iteration — in-progress playback finishes but no further sentences are synthesised.

---

## 2. Automated Test Results

Run the full suites before any manual testing:

```bash
pnpm --filter accordo-hub test
```

Expected: `Tests  356 passed (356)`

```bash
pnpm --filter accordo-voice test
```

Expected: `Tests  226 passed (226)`

If any test fails, do not proceed to manual testing.

---

## 3. Prerequisites

1. Build the workspace:
   ```bash
   pnpm build
   ```
2. Launch the Extension Development Host: press **F5** from the root workspace folder. This uses `.vscode/launch.json` → `"Launch Bridge + Editor + Voice (Extension Development Host)"`.  
   Do **not** press F5 from inside a package sub-folder — that loads only one extension.
3. Wait ~3 seconds for all extensions to activate.
4. Confirm the **Voice** status bar item appears at the bottom-right of the EDH window (`🔊 Voice: Ready`).
   > **Important:** If the status bar shows `🔇 Voice: Off`, go to **Settings** → search `accordo.voice.enabled` → **check the checkbox**. This setting defaults to `false` and gates the entire `## Voice` system prompt section.
5. Start the Hub in a terminal:
   ```bash
   ACCORDO_TOKEN=demo-token ACCORDO_BRIDGE_SECRET=demo-secret \
     node packages/hub/dist/index.js --port 3000
   ```
6. Connect your MCP client (Claude, Copilot, etc.) to `http://localhost:3000` with token `demo-token`.

---

## 4. Part 1 — Verify the System Prompt (M51-SN)

These tests confirm the Hub sends the correct Voice section to the agent depending on `narrationMode`.

### 4.1 Enable voice with narrate-summary

1. In the EDH, open **Settings** (`Cmd+,`) → search **`accordo.voice.enabled`** → **check the checkbox** (must be `true` or the `## Voice` section never appears).
2. In Settings, search `accordo.voice.narrationMode` → set it to **`narrate-summary`**.
3. Confirm the status bar shows `🔊 Voice: Ready` (not `🔇 Voice: Off`).
4. Ask the agent:
   > *"What is in your current system prompt about voice or narration?"*

**What the agent should say:**  
It should report seeing a `## Voice` section containing content similar to:

```
Status: Active (Whisper STT + Kokoro TTS)
Mode: narrate-summary, speed 1.0×, voice af_sarah
Directive: After each response, call accordo_voice_readAloud with a 2-3 sentence spoken summary …
```

The key phrases to look for in the agent's answer:
- `## Voice`
- `call accordo_voice_readAloud`
- `2-3 sentence spoken summary`
- `Do not repeat the full response`

**What you should NOT see:**  
A raw JSON blob like `{"isOpen":true,"session":"active","policy":{"narrationMode":"narrate-summary",...}}` — the voice state must appear as formatted text, not JSON.

---

### 4.2 Switch to narrate-everything

1. In Settings, set `accordo.voice.narrationMode` to **`narrate-everything`**.
2. Ask the agent the same question:
   > *"What does your system prompt say about voice?"*

**What the agent should say:**  
The directive should now mention:
- `call accordo_voice_readAloud with your full response text`
- `The text cleaning pipeline will handle markdown/code`

---

### 4.3 Switch to narrate-off — no directive

1. Set `accordo.voice.narrationMode` to **`narrate-off`**.
2. Ask:
   > *"Do you have any voice instructions in your system prompt?"*

**What the agent should say:**  
It may mention a `## Voice` section (status/mode is still shown), but it should report **no instruction to call `readAloud`**. It should not say anything about "2-3 sentence summary" or "full response text".

---

### 4.4 Verify the directive is followed automatically

1. Set `narrationMode` back to **`narrate-summary`**.
2. Ask the agent a factual question that produces a medium-length answer, e.g.:
   > *"What are the three main packages in this monorepo and what does each one do?"*

**What the agent should do:**  
At the end of its response, it should call `accordo_voice_readAloud` with a 2–3 sentence summary (not the full answer). You should hear the summary played through your speakers.

**What you should see in VS Code:**  
Status bar transitions: `🔊 Voice: Ready` → `▶ Voice: Narrating…` → back to `🔊 Voice: Ready`.

---

### 4.5 narrate-everything — full response spoken

1. Set `narrationMode` to **`narrate-everything`**.
2. Ask something short enough to be readable:
   > *"In one sentence, what does accordo-hub do?"*

**What the agent should do:**  
Call `readAloud` with the complete answer text. You should hear the full sentence spoken, not a summary.

---

### 4.6 narrate-off — agent stays silent

1. Set `narrationMode` to **`narrate-off`**.
2. Ask the same question:
   > *"In one sentence, what does accordo-hub do?"*

**What the agent should do:**  
Reply in text only. It should **not** call `readAloud`. No audio, status bar does not transition to Narrating.

---

## 5. Part 2 — Verify Streaming TTS (M51-STR)

These tests confirm the streaming pipeline is working: latency is low and playback order matches sentence order.

### 5.1 Short text — single sentence (single-shot path)

1. Set `narrationMode` to `narrate-off` (so the agent won't auto-narrate — you'll trigger `readAloud` manually).
2. Ask the agent:
   > *"Call accordo_voice_readAloud with the text: Hello world."*

**What you should hear:** A single spoken sentence — "Hello world."  
**Status bar:** `Ready` → `Narrating…` → `Ready`. No perceptible pipeline latency (single-shot, nothing to overlap).

---

### 5.2 Multi-sentence text — streaming pipeline

1. Ask the agent:
   > *"Call accordo_voice_readAloud with this text: The system prompt is rendered from the current IDE state. It includes workspace folders, open editors, and active modalities. Voice state appears as a dedicated section. Narration directives are adapted to the current mode."*

**What you should hear:** All four sentences spoken in order with no gap between them.  
**Latency check:** Audio should begin within roughly 0.3–0.5 seconds (time to synthesise only the first sentence), not after synthesising all four (~1–2 seconds total without streaming).

**What you should see in VS Code:**  
Status bar shows `▶ Voice: Narrating…` for the duration and returns to `🔊 Voice: Ready` when all sentences finish.

---

### 5.3 Sentence order is preserved

1. Ask the agent:
   > *"Call accordo_voice_readAloud with: First sentence. Second sentence. Third sentence."*

**What you should hear:**  
The sentences spoken in order: "First sentence." pause "Second sentence." pause "Third sentence."  
They must not be permuted or repeated.

---

### 5.4 Cancellation stops at sentence boundary

1. With `narrationMode` set to `narrate-summary`, ask the agent:
   > *"Explain how the sentence-level streaming TTS pipeline works, then read out your explanation."*

2. While the first sentence is playing, click the **Stop** button in the Voice panel (or send `accordo_voice_setPolicy` with `narrationMode: "narrate-off"` if no stop button is visible).

**What you should see:**  
The current sentence finishes playing. The remaining sentences are not spoken. Status bar returns to `🔊 Voice: Ready` promptly.

---

### 5.5 Markdown and code stripped before streaming

1. Ask the agent:
   > *"Call accordo_voice_readAloud with this text: Here is a code snippet. \`\`\`typescript\nconst x = 1;\n\`\`\` The code sets x to one. That completes the example."*

**What you should hear:**  
"Here is a code snippet. There's a code snippet shown on screen. The code sets x to one. That completes the example." (exact text-cleaner output may vary slightly — key point is the fenced code block is replaced with a spoken placeholder, not read as raw characters).

---

## 6. Part 3 — Regression Check

Verify the new features did not break existing voice behaviour.

### 6.1 readAloud still works without narration mode (direct invocation)

Set `narrationMode` to `narrate-off` and ask:  
> *"Read this aloud: This is a manual read-aloud test."*

Should play audio normally. No console errors in the Output channel.

### 6.2 Discover still shows correct state

Ask:  
> *"What is the current voice state?"*

Agent calls `accordo_voice_discover`. Response should include `ttsAvailable: true`, `sttAvailable: true`, and current `narrationMode` matching whatever is set in Settings.

### 6.3 Dictation unaffected

Press `Cmd+Alt+V` (Start Dictation) → speak a sentence → stop.  
Transcription should still work regardless of `narrationMode` setting.

---

## 7. Final Check

```bash
# Both suites green
pnpm --filter accordo-hub test
pnpm --filter accordo-voice test

# Type check clean
pnpm --filter accordo-hub typecheck
pnpm --filter accordo-voice typecheck
```

Open the **Problems** panel in VS Code after building — it must show zero errors and zero warnings in `packages/hub/` and `packages/voice/`.

---

## 8. Test Coverage Summary

### M51-SN (Hub prompt engine — Voice section)

| Test | Requirement | What it checks |
|---|---|---|
| `## Voice` section rendered when enabled | M51-SN-01 | Section appears when `policy.enabled = true` |
| No `## Voice` when modality absent | M51-SN-01 | Section absent with no voice state |
| No `## Voice` when `policy.enabled = false` | M51-SN-05 | Disabled policy suppresses section |
| narrate-summary directive — exact text | M51-SN-02 | "2-3 sentence spoken summary", "Do not repeat" |
| narrate-everything directive | M51-SN-04 | "full response text", "text cleaning pipeline" |
| narrate-off — no directive | M51-SN-03 | No `accordo_voice_readAloud` in prompt |
| Status line has session + providers | M51-SN-01 | "Active", "Whisper", "Kokoro" visible |
| Mode line in `## Voice` section (not JSON) | M51-SN-01 | narrationMode/speed/voice in formatted section |
| `accordo-voice` NOT in generic state JSON | M51-SN-05 | No raw JSON blob for voice modality |
| Token budget still respected | M51-SN-06 | Prompt within `PROMPT_TOKEN_BUDGET + 300` |

### M51-STR (Streaming TTS)

| Test | Requirement | What it checks |
|---|---|---|
| `streamingSpeak` exported as function | M51-STR-01 | Export exists + correct name |
| Returns a Promise | M51-STR-01 | Return type contract |
| Single sentence → 1 synthesize call | M51-STR-06 | Single-shot path (no overlap overhead) |
| 3-sentence text → 3 synthesize calls | M51-STR-02 | One synthesis per sentence |
| Empty text → no synthesis | M51-STR-02 | Empty string guard |
| Whitespace-only → no synthesis | M51-STR-02 | Whitespace guard |
| 3 sentences → 3 playback calls | M51-STR-03 | Each sentence played |
| First synth before first play | M51-STR-04 | Latency: first audio after 1st sentence only |
| Playback order matches sentence order | M51-STR-03 | Sentences played 0→1→2, not permuted |
| Cancellation stops mid-pipeline | M51-STR-05 | `cancel()` after sentence 1 → sentence 3 not synthesised |
| Pre-cancelled token → no synthesis | M51-STR-05 | Already-cancelled token is honoured immediately |
| language/voice/speed passed through | M51-STR-01 | Options forwarded to provider |
| CancellationToken passed to provider | M51-STR-01 | Token forwarded to each `synthesize` call |
| Synthesis error rejects promise | M51-STR | Error propagation |
| Playback error rejects promise | M51-STR | Error propagation |
