# Accordo — Voice Modality Architecture v1.0

**Status:** APPROVED  
**Date:** 2026-03-07  
**Scope:** Session 10 Voice modality (`accordo-voice`)  
**Requirements:** [`docs/20-requirements/requirements-voice.md`](../20-requirements/requirements-voice.md)

---

## 1. Goal

Give the Accordo agent a voice — both literal and figurative:

1. **TTS narration** — agent reads text, slide notes, and code walkthroughs aloud using local neural speech synthesis.
2. **STT dictation** — user speaks and the transcript appears at the cursor (or is returned to the agent).
3. **Scripted walkthroughs** — the agent pre-composes a complete multi-step narration script (speech + VS Code commands + delays + highlights) and hands it off for autonomous execution, without further MCP round-trips.
4. **Smart text cleaning** — pre-TTS pipeline strips markdown, code blocks, math, URLs, and formatting, replacing them with natural spoken equivalents ("There's a code snippet shown on screen").
5. **Status bar + voice panel** — VS Code UI reflects voice state in real time via a status bar item and a `WebviewView` with a ported waveform visualizer and mic button.

The modality is built as a standalone VS Code extension (`accordo-voice`) that registers tools with the Bridge and publishes state to the Hub. It is additive — no changes to existing extensions.

---

## 2. Technology Decisions

### ADR-01 — Use Whisper.cpp + Kokoro as primary STT/TTS engines

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| **Whisper.cpp + Kokoro** | Local/offline, high quality, no API keys, already integrated in theia-openspace, voice-core codebase available to port | Requires local binary + npm package installed | **Chosen** |
| VS Code Speech API | Built-in, zero install | Cloud-dependent, quality/latency variance, less control over model, not available in all VS Code builds; weaker than whisper/kokoro for technical vocabulary | Not chosen as primary |
| ElevenLabs / OpenAI TTS | High quality | Cloud, API key, per-character cost, privacy concerns, offline-incompatible | Not chosen as primary |
| Piper | Fully open, fast | Less established pipeline, no existing port | Deferred (available via abstraction layer) |

**Abstraction guarantee:** All providers sit behind `SttProvider` / `TtsProvider` interfaces. Swapping to VS Code Speech API, Piper, or ElevenLabs requires writing a new adapter only — zero changes to tools, FSMs, commands, or UI.

### ADR-02 — Copy voice-core into packages/voice (no external dependency)

The `@openspace-ai/voice-core` package provides `SttProvider`/`TtsProvider` interfaces, `WhisperCppAdapter`, `KokoroAdapter`, FSMs, and WAV utilities. Rather than taking an npm dependency on an external package that is maintained in a separate repository, the source code is ported directly into `packages/voice/src/core/`.

**Rationale:**
- The port already requires adaptation (module system, build config, testing).
- Eliminates a cross-repo dependency that could drift or become unavailable.
- All Accordo packages are self-contained in the monorepo.

### ADR-03 — Summary narration: agent-driven, no LLM in voice extension

For summary mode, the agent is the summarizer. When `narrationMode === 'narrate-summary'` is published in voice state, the Hub's system prompt includes a directive telling the agent to call `accordo_voice_readAloud` with a concise spoken summary after each response.

| Option | Verdict |
|---|---|
| Agent generates summary inline, sends to `readAloud` via system-prompt directive | **Chosen** — zero added infrastructure, agent has full context, ~7% token overhead |
| Voice extension calls LLM directly to summarize (ADR-04 original) | Not chosen — duplicates agent context, adds LLM dependency + config, doubles output tokens |
| Hooks/plugins per agent client for response interception | Not chosen — not portable across agent clients (Copilot, Claude, OpenCode) |

**Why the agent is the best summarizer:** It already has the full response context. A separate LLM call would duplicate the content (doubling output tokens) and add latency. The system-prompt approach is universal across all MCP-capable agents.

**Compliance model:** The instruction in the system prompt is clear and positioned prominently. Agent compliance is ~95%+ for well-structured directives. Missing a summary degrades UX but doesn't break anything — the text response is always visible.

### ADR-04 — Voice-only scope: scripting lives elsewhere

> **⚠️ ADR-04 status [2026-04-16]:** The built-in scripting engine (`NarrationScript`, `ScriptRunner`, `accordo_script_run`) has been removed. This ADR is historical — the decision was implemented in Session 10D and then reverted.

Scripted walkthroughs (the `NarrationScript` format, `ScriptRunner`, and `accordo_script_run` tool) were **not part of the voice extension** (they lived in `packages/hub/src/script/` and `packages/script/`).

| Option | Verdict |
|---|---|
| Scripting as a separate module (Bridge extension or standalone) | ~~**Chosen**~~ — implemented in Session 10D |
| Scripting inside voice extension (original plan) | Not chosen |

**Note:** External script authoring via Python skill + NarrationScript remains available as a replacement approach.

### ADR-05 — Voice panel: port Theia waveform widget as WebviewView

The `theia-openspace` voice extension ships a canvas-based waveform overlay (`VoiceWaveformOverlay`) and a React mic button widget (`VoiceInputWidget`). These are adapted into a single VS Code `WebviewView` appearing in the panel area.

**Why WebviewView rather than TreeView:**
- Waveform is a canvas animation — only possible in a WebView.
- Mic button requires focus/click state not expressible in TreeView.
- Panel position keeps it visible alongside the editor (unlike a sidebar that may be hidden).

---

## 3. System Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  VS Code Extension Host                                                     │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  accordo-voice  (extensionKind: ["workspace"])                      │   │
│  │                                                                     │   │
│  │  ┌─────────────┐  ┌──────────────────┐  ┌──────────────────────┐   │   │
│  │  │ SessionFsm  │  │  WhisperCppAdapt │  │  KokoroAdapter       │   │   │
│  │  │ AudioFsm    │  │  (SttProvider)   │  │  (TtsProvider)       │   │   │
│  │  │ NarrationFsm│  └────────┬─────────┘  └──────────┬───────────┘   │   │
│  │  └──────┬──────┘           │                        │               │   │
│  │         │                  │ transcribe()           │ synthesize()  │   │
│  │  ┌──────▼──────────────────▼────────────────────────▼───────────┐   │   │
│  │  │  MCP Tools: discover / readAloud / dictation / setPolicy     │   │   │
│  │  │                                                              │   │   │
│  │  └────────────────────────┬────────────────────────────────────┘   │   │
│  │                           │ registerTools()                         │   │
│  │  ┌────────────────────────▼────────────────────────────────────┐   │   │
│  │  │  accordo-bridge  (BridgeAPI)                                │   │   │
│  │  │  publishState('accordo-voice', ...)                         │   │   │
│  │  └────────────────────────┬────────────────────────────────────┘   │   │
│  │                           │ WebSocket                               │   │
│  │  ┌────────────────────────▼────────────────────────────────────┐   │   │
│  │  │  VS Code UI layer                                           │   │   │
│  │  │  • VoiceStatusBar (StatusBarItem)                           │   │   │
│  │  │  • VoicePanelProvider (WebviewView — waveform + mic)        │   │   │
│  │  │  • VS Code commands: startDictation, readAloud, stop, etc.  │   │   │
│  │  └──────────────────────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                           │ WS  /bridge
┌──────────────────────────▼──────────────────────────────────────────────────┐
│  accordo-hub                                                                │
│  • State cache: accordo-voice: { session, narration, audio, policy, ... }  │
│  • Prompt: ## Voice section auto-generated from state                       │
└─────────────────────────────────────────────────────────────────────────────┘
                           │ MCP
┌──────────────────────────▼──────────────────────────────────────────────────┐
│  AI Agent                                                                   │
│  → accordo_voice_discover, accordo_voice_readAloud,                        │
│    accordo_voice_dictation, accordo_voice_setPolicy                         │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Package Structure

```
packages/voice/
├── package.json              # accordo-voice VS Code extension
├── tsconfig.json
├── vitest.config.ts
└── src/
    ├── extension.ts          # activate / deactivate
    ├── core/                 # Voice engine — ported from theia-openspace voice-core
    │   ├── providers/
    │   │   ├── stt-provider.ts     # SttProvider interface + types
    │   │   └── tts-provider.ts     # TtsProvider interface + types
    │   ├── adapters/
    │   │   ├── whisper-cpp.ts      # WhisperCppAdapter (SttProvider)
    │   │   └── kokoro.ts           # KokoroAdapter (TtsProvider)
    │   ├── fsm/
    │   │   ├── types.ts            # State/Trigger enums, VoicePolicy, VoiceFsmError
    │   │   ├── session-fsm.ts      # SessionFsm (inactive ↔ active ↔ suspended)
    │   │   ├── audio-fsm.ts        # AudioFsm (idle → listening → processing → idle)
    │   │   └── narration-fsm.ts    # NarrationFsm (idle → queued → processing → playing ↔ paused)
    │   └── audio/
    │       ├── wav.ts              # buildWavBuffer (44-byte WAV header)
    │       └── playback.ts         # playPcmAudio — afplay / aplay / PowerShell
    ├── text/                       # Text processing pipeline (deterministic, no LLM)
    │   ├── text-cleaner.ts         # cleanTextForNarration — markdown → spoken equivalents
    │   ├── sentence-splitter.ts    # splitIntoSentences — for incremental TTS
    │   └── vocabulary.ts           # VoiceVocabulary — user word replacement table
    ├── tools/                      # MCP tool definitions (ExtensionToolDefinition)
    │   ├── discover.ts             # accordo_voice_discover
    │   ├── read-aloud.ts           # accordo_voice_readAloud
    │   ├── dictation.ts            # accordo_voice_dictation
    │   └── set-policy.ts           # accordo_voice_setPolicy
    ├── commands/                   # VS Code command handlers
    │   ├── dictation-command.ts    # Push-to-talk command
    │   └── read-aloud-command.ts   # Read selection aloud command
    ├── ui/
    │   ├── status-bar.ts           # VoiceStatusBar (StatusBarItem)
    │   └── voice-panel.ts          # VoicePanelProvider (WebviewView)
    └── __tests__/                  # All test files co-located
```

---

## 5. Provider Abstraction

Both `SttProvider` and `TtsProvider` are pure TypeScript interfaces with no VS Code dependency. Any STT or TTS engine can be swapped in by implementing the interface and registering the adapter in `extension.ts`.

```typescript
interface SttProvider {
  readonly kind: 'stt';
  readonly id: string;
  isAvailable(): Promise<boolean>;
  transcribe(request: SttTranscriptionRequest, token?: CancellationToken): Promise<SttTranscriptionResult>;
}

interface TtsProvider {
  readonly kind: 'tts';
  readonly id: string;
  isAvailable(): Promise<boolean>;
  synthesize(request: TtsSynthesisRequest, token?: CancellationToken): Promise<TtsSynthesisResult>;
  dispose(): Promise<void>;
}
```

**Provider registry (future):** A `VoiceProviderRegistry` can hold multiple adapters and select based on availability or policy. For Session 10A, a single STT and single TTS adapter are instantiated directly in `extension.ts`.

### Known Adapters

| ID | Interface | Technology | Status |
|---|---|---|---|
| `whisper.cpp` | SttProvider | whisper.cpp binary (GGML models) | Session 10A |
| `kokoro` | TtsProvider | kokoro-js ONNX (82M model) | Session 10A |
| `vscode-speech` | SttProvider + TtsProvider | VS Code Speech API | Future (easy swap) |
| `piper` | TtsProvider | Piper TTS (ONNX) | Future |
| `elevenlabs` | TtsProvider | ElevenLabs HTTP API | Future (paid) |

---

## 6. FSM Design

Three finite state machines manage the voice lifecycle. They are synchronous, in-memory, and have no VS Code dependencies — fully testable in isolation.

### 6.1 SessionFsm

Controls whether voice is globally available.

```
         enable()           pushToTalkStart()
inactive ─────────► active ─────────────────► suspended
         ◄─────────         ◄─────────────────
         disable()           pushToTalkEnd()
```

Holds `VoicePolicy`: `{ enabled, narrationMode, speed, voice, language }`.

### 6.2 AudioFsm

Controls microphone capture and STT processing pipeline.

```
idle ──startCapture()──► listening ──stopCapture()──► processing ──transcriptReady()──► idle
                                                              │
                                                         error() ──► error ──reset()──► idle
```

### 6.3 NarrationFsm

Controls the TTS playback queue.

```
                enqueue()           startProcessing()      audioReady()
idle ──────────────────────► queued ─────────────► processing ─────────────► playing
 ◄─── complete() (empty)                                                        │
                                             ◄── complete() (more in queue)     │ pause() / resume()
                                                                               paused
                              ◄── error() (from any active state) ──────────────┘
```

`NarrationFsm` also holds a queue. When `complete()` is called and the queue is non-empty, the FSM transitions back to `queued` with the next request, enabling sequential sentence playback.

### 6.4 State Interaction

The `VoiceStatusBar` and `VoicePanelProvider` receive all three state values on every change and compute the displayed UI from the combination:

| session | audio | narration | Status bar display |
|---|---|---|---|
| inactive | — | — | `$(mute) Voice: Off` |
| active | idle | idle | `$(unmute) Voice: Ready` |
| active | listening | — | `$(record) Voice: Recording…` (red) |
| active | processing | — | `$(loading~spin) Voice: Transcribing…` |
| active | idle | playing | `$(play) Voice: Narrating…` |
| active | idle | paused | `$(debug-pause) Voice: Paused` |
| * | error | — | `$(error) Voice: Error` |

---

## 7. Text Processing Pipeline

All text passes through this pipeline before TTS synthesis:

```
Raw text
   │
   ▼  cleanTextForNarration(text, mode)          [text-cleaner.ts]
Cleaned text
   │
   ▼  splitIntoSentences(text)                   [sentence-splitter.ts]
Sentence array
   │
   ▼  vocabulary.process(sentence)               [vocabulary.ts] (applied per sentence)
Final sentence array → TTS synthesis (one sentence at a time)
```

### 7.1 TextCleaner rules (deterministic, Session 10A)

| Input | Output |
|---|---|
| ` ```js\nconst x = 1\n``` ` | `There's a code snippet shown on screen.` |
| `` `shortRef` `` | `shortRef` (kept if ≤ 20 chars) |
| `` `this is a long code reference` `` | `a code reference` |
| `$E = mc^2$` | `There's a mathematical expression shown on screen.` |
| `https://example.com/path` | `there's a link shown on screen` |
| `[click here](https://...)` | `click here` |
| `**bold**`, `_italic_` | `bold`, `italic` (markers stripped) |
| `<span>html</span>` | `` (stripped) |
| `# Section Title` | `Section: Section Title` |
| `- item`, `* item`, `1. item` | `item` (bullet stripped) |
| `😊 emoji` | ` emoji` (emoji stripped) |

**Headings-only mode** (`narrate-headings`): extracts heading text + first sentence after each heading for a structural overview narration.

**Summary mode** (Session 10B): When `narrationMode === 'narrate-summary'`, the Hub system prompt includes a directive telling the agent to call `readAloud` with a 2-3 sentence spoken summary after each response. The agent is the summarizer — no LLM call from the voice extension.

---

## 8. Summary Narration Design (Session 10B)

### 8.1 System prompt directive

When `narrationMode === 'narrate-summary'` is published in voice state, the Hub prompt engine appends a directive to the `## Voice` section:

```markdown
## Voice
Status: Active (Whisper STT + Kokoro TTS)
Mode: narrate-summary, speed 1.0×, voice af_sarah (en-US)

**Narration directive:** After each response, call `accordo_voice_readAloud` with a 2-3 sentence
spoken summary of your answer. Keep it concise and natural for spoken delivery.
Do not repeat the full response — summarize the key points.
```

For `narrate-everything` mode, the directive changes to:
```markdown
**Narration directive:** After each response, call `accordo_voice_readAloud` with your full response text.
The text cleaning pipeline will handle markdown/code conversion to spoken form.
```

When `narrate-off`, no directive is included.

### 8.2 Flow

```
Agent generates response → Agent calls readAloud(summary) → voice extension:
   cleanTextForNarration(summary) → splitIntoSentences →
   for each sentence: synthesize → play (streaming pipeline, 10B)
```

Token overhead: ~100-150 tokens for the summary tool call on a typical response. This is ~7% overhead vs. the original plan of re-narrating the entire response through a separate LLM call (which would have doubled output tokens).

### 8.3 Streaming TTS pipeline (M51-STR)

For longer text (> 1 sentence), the streaming pipeline reduces perceived latency:

```
streamingSpeak(cleanedText):
   sentences = splitIntoSentences(cleanedText)
   for i in range(sentences):
     audio[i] = synthesize(sentences[i])     ← starts immediately
     if i > 0: await playback(audio[i-1])    ← plays previous while synthesizing current
   await playback(audio[last])
```

First audio plays after synthesizing only the first sentence (~200-300ms with Kokoro), not the entire text.

### 8.4 Graceful degradation

| Condition | Behaviour |
|---|---|
| Agent doesn't call `readAloud` after a response | Silent — user still sees the text response. No error. |
| TTS provider unavailable | `readAloud` returns error result. Agent sees the error. |
| `narrationMode` set to `narrate-off` | No directive in system prompt. Agent doesn't call `readAloud` unless explicitly asked. |

---

## 9. VS Code UI Integration

### 9.1 StatusBar

`VoiceStatusBar` creates a `StatusBarItem` on the right side (priority 100). It is the primary visible indicator of voice state. Click action changes contextually: `configure` when idle, `stopNarration` when playing.

The status bar item tooltip shows the current policy summary: voice name, speed, narration mode, language.

### 9.2 WebviewView — Voice Panel

`VoicePanelProvider` implements `vscode.WebviewViewProvider` and registers for view ID `accordo-voice-panel` (shown in the panel area, alongside Terminal/Problems/Output).

**Waveform (ported from theia-openspace `VoiceWaveformOverlay`):**
- Canvas element, 32 bars, smooth animation (lerp to target heights)
- **Recording mode:** blue bars, driven by real-time volume data (`postMessage({ type: 'volumeData', data: number[] })`)
- **Speaking mode:** white bars on blue background, driven by synthetic TTS playback animation
- **Waiting mode:** 3 pulsing green dots (CSS animation, no canvas data needed)
- **Idle mode:** flat gray bars

**Controls:**
- Circular mic button (push-to-talk). Red pulsing border during recording. Click sends `{ type: 'micDown' }` / `{ type: 'micUp' }` to the extension.
- Stop button (visible during narration). Sends `{ type: 'stopNarration' }`.
- Status label below controls.

**CSP:** Inline scripts are nonce-gated. No external script sources.

### 9.3 Commands and Keybindings

| Command | Keybinding | When |
|---|---|---|
| `accordo.voice.startDictation` | `Cmd+Alt+V` | `editorFocus` |
| `accordo.voice.readAloud` | `Cmd+Alt+R` | `editorHasSelection` |
| `accordo.voice.stopNarration` | `Escape` | `accordo.voice.narrating` |

Context key `accordo.voice.narrating` is set via `vscode.commands.executeCommand('setContext', ...)` during narration playback.

---

## 10. State Contribution

Voice state is published to the Hub at every FSM state change:

```typescript
bridge.publishState('accordo-voice', {
  session:  'active',          // 'inactive' | 'active' | 'suspended'
  narration: 'playing',        // 'idle' | 'queued' | 'processing' | 'playing' | 'paused'
  audio:    'idle',            // 'idle' | 'listening' | 'processing' | 'error'
  policy: {
    enabled: true,
    narrationMode: 'narrate-everything',
    speed: 1.0,
    voice: 'af_sarah',
    language: 'en-US'
  },
  sttAvailable: true,
  ttsAvailable: true,
});
```

**System prompt rendering (Hub):**

```markdown
## Voice
Status: Active (Whisper STT + Kokoro TTS)
Mode: narrate-summary, speed 1.0×, voice af_sarah (en-US)
Directive: After each response, call accordo_voice_readAloud with a 2-3 sentence spoken summary.
```

When `session === 'inactive'` or no voice state is published, the `## Voice` section is omitted from the system prompt (standard Hub token budget behaviour).

---

## 11. Bridge Integration

The voice extension integrates with Bridge using the same patterns as all other modality extensions:

**Tool registration:**
```typescript
const bridge: BridgeAPI = vscode.extensions.getExtension('accordo.accordo-bridge')?.exports;
if (bridge) {
  bridge.registerTools([discoverDef, readAloudDef, dictationDef, setPolicyDef]);
}
```

**State publication:**
```typescript
// Called on every FSM state change:
bridge?.publishState('accordo-voice', currentState);
```

**Graceful degradation:** If Bridge is not installed, `bridge` is `undefined`. Tools are not registered, but all VS Code commands and UI still work. The extension activates normally and shows voice controls — it just cannot take tool calls from the agent.

---

## 12. Cross-Modality Integration

The voice extension integrates with other modalities through the `readAloud` tool. When an agent is working with presentations, comments, or code, it can call `readAloud` with any text to speak it aloud. The voice extension does not need to know about the source modality.

**Examples of agent-driven narration:**
- Agent calls `accordo.presentation.generateNarration` to get slide notes, then `readAloud` with the result
- Agent reads a comment thread and calls `readAloud` with a summary
- Agent explains code and calls `readAloud` with the explanation

> **Scripted multi-step walkthroughs** (interleaving speech with file navigation, slide transitions, highlights, and delays) are a **separate scripting module** (future session). The voice extension may be consumed by the scripting module as a TTS provider, but it does not own or execute scripts.

---

## 13. Deployment and System Requirements

### 13.1 Required on the host machine

| Requirement | Purpose | Detection |
|---|---|---|
| `whisper.cpp` binary (in PATH or configured path) | STT transcription | `WhisperCppAdapter.isAvailable()` |
| Whisper GGML model file (e.g. `ggml-base.en.bin`) | STT model | Path existence check |
| `kokoro-js` npm package | TTS synthesis | `require.resolve('kokoro-js')` |
| `sox` / `rec` / `arecord` (platform) | Microphone capture via node-record-lpcm16 | Runtime error on first dictation attempt |
| `afplay` (macOS) / `aplay` (Linux) / PowerShell (Windows) | Audio playback | Platform-detected |

### 13.2 Graceful degradation

| Missing component | Behaviour |
|---|---|
| Bridge not installed | Extension activates, VS Code commands work, tools not registered |
| whisper.cpp not found | STT tools return error, dictation command disabled, status bar shows warning |
| kokoro-js not installed | TTS tools return error, read-aloud disabled, narration mode degraded |
| Both STT and TTS missing | Status bar shows `$(error) Voice: Unavailable`, message with install instructions |
| LLM endpoint not configured (10B) | Not applicable — summary narration is agent-driven via system prompt, no LLM config in voice extension |

### 13.3 Extension manifest activationEvents

```json
"activationEvents": [
  "onStartupFinished",
  "onView:accordo-voice-panel",
  "onCommand:accordo.voice.startDictation",
  "onCommand:accordo.voice.readAloud",
  "onCommand:accordo.voice.stopNarration"
]
```

`onStartupFinished` ensures `accordo-voice` activates shortly after VS Code startup and registers MCP tools with the Bridge immediately — without requiring a user action. This is the same pattern used by `accordo-editor` and other modality extensions that need agent-first tool availability.

---

## 14. Session Scope Summary

| Session | Modules | Key deliverable |
|---|---|---|
| **10A** | M50-SP, M50-WA, M50-KA, M50-FSM, M50-WAV, M50-TC, M50-SS, M50-VC, M50-DT, M50-RA, M50-DI, M50-POL, M50-SB, M50-VP, M50-EXT | Voice extension with 4 MCP tools, status bar, waveform panel, ~198 tests |
| **10B** | M51-SN, M51-STR | Summary narration prompt (Hub update), streaming TTS pipeline, ~25 tests |

**Test baseline to preserve:** 1418 existing tests across Hub/Bridge/Editor/Comments/SDK/md-viewer/slidev. New `packages/voice` adds ~198 tests (10A) and ~25 tests (10B).

---

## 15. Source Code Reference

The following theia-openspace files are the authoritative source for the ported components:

| Accordo target | Theia-openspace source |
|---|---|
| `src/core/providers/` | `packages/voice-core/src/providers/stt-provider.ts`, `tts-provider.ts` |
| `src/core/adapters/whisper-cpp.ts` | `packages/voice-core/src/adapters/whisper-cpp.adapter.ts` |
| `src/core/adapters/kokoro.ts` | `packages/voice-core/src/adapters/kokoro.adapter.ts` |
| `src/core/fsm/` | `packages/voice-core/src/fsm/session-fsm.ts`, `audio-fsm.ts`, `narration-fsm.ts` |
| `src/core/audio/wav.ts` | `packages/voice-core/src/utils/wav.ts` |
| `src/core/audio/playback.ts` | `openspace-voice-vscode/src/audio/playback.ts` |
| `src/text/text-cleaner.ts` | `extensions/openspace-voice/src/common/text-cleanup.ts` (enhanced) |
| `src/text/sentence-splitter.ts` | `extensions/openspace-voice/src/common/sentence-splitter.ts` |
| `src/ui/voice-panel.ts` (waveform) | `extensions/openspace-voice/src/browser/voice-waveform-overlay.ts` |
| `src/ui/voice-panel.ts` (mic button) | `extensions/openspace-voice/src/browser/voice-input-widget.tsx` |
