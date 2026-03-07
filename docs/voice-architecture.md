# Accordo — Voice Modality Architecture v1.0

**Status:** APPROVED  
**Date:** 2026-03-07  
**Scope:** Session 10 Voice modality (`accordo-voice`)  
**Requirements:** [`docs/requirements-voice.md`](requirements-voice.md)

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

### ADR-03 — Scripted narration: agent composes the full script, runtime executes it

Rather than having the agent call MCP tools step-by-step for a multi-step walkthrough (which requires N MCP round-trips and yields poor timing control), the agent generates a complete `NarrationScript` in one shot and passes it to `accordo_voice_narrate`. The `ScriptRunner` then executes the script autonomously.

**Why this is feasible:** Extension-registered VS Code commands (`accordo.presentation.*`, `accordo.commentsPanel.*`, `accordo.voice.*`, etc.) and built-in VS Code commands (`vscode.open`, `workbench.action.gotoLine`) are all callable via `vscode.commands.executeCommand()`. **Note:** MCP tool names (`accordo_editor_*`) are NOT VS Code commands — use the built-in equivalents in command steps.

**Example script (architecture walkthrough):**
```json
{
  "title": "Hub architecture walkthrough",
  "steps": [
    { "type": "speak", "text": "Let's look at how the Hub connects to the Bridge." },
    { "type": "command", "command": "vscode.open", "args": ["file:///workspace/docs/architecture.md"] },
    { "type": "delay", "ms": 800 },
    { "type": "highlight", "uri": "docs/architecture.md", "startLine": 43, "endLine": 60, "color": "yellow" },
    { "type": "speak", "text": "Here is the Bridge WebSocket client. It connects to the Hub on port 3000." },
    { "type": "await-speech" },
    { "type": "clear-highlight" }
  ]
}
```

**NarrationScript** has a `style` field (`informative`, `conversational`, `dramatic`, `whisper`) that controls the LLM narration prompt in 10B summary mode. Future: more styles, utterance library emotions.

### ADR-04 — LLM routing for summary mode: direct API call

For `narrate-summary` mode (Session 10B), the voice extension calls the configured LLM directly rather than routing through VS Code APIs or the Hub.

| Option | Verdict |
|---|---|
| Direct HTTP API call to configured `llmEndpoint`/`llmModel` | **Chosen** — same pattern as other local LLM integrations, works with any OpenAI-compatible endpoint |
| VS Code Language Model API (`vscode.lm`) | Not chosen as primary — constrains to extensions marketplace models, less flexible for local inference |
| Route via Hub | Not chosen — Hub is editor-agnostic compute layer; it should not own LLM credentials |

The LLM is optional and `narrate-summary` mode gracefully falls back to `narrate-full` (deterministic cleaning) if no endpoint is configured or the LLM call fails.

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
│  │  │  (Session 10B: + narrate)                                    │   │   │
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
│  → (10B) accordo_voice_narrate                                              │
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
    ├── narration/                  # Session 10B — scripted narration
    │   ├── script-runner.ts        # ScriptRunner.execute(NarrationScript)
    │   ├── preprocessor.ts         # NarrationPreprocessor (LLM summary)
    │   └── utterance-library.ts    # UtteranceLibrary (pre-recorded audio)
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

**Summary mode** (Session 10B, requires LLM): `NarrationPreprocessor` calls the configured LLM endpoint to produce a spoken-word summary, optionally as a structured `NarrationScript` with emotion/style markers.

### 7.2 LLM call contract (Session 10B)

```typescript
// POST accord.voice.llmEndpoint  (OpenAI-compatible)
{
  model: "accordo.voice.llmModel",
  messages: [
    { role: "system", content: NARRATION_SYSTEM_PROMPT[style] },
    { role: "user",   content: rawText }
  ]
}
// Response: NarrationScript JSON or plain text (fallback)
```

Fallback chain: LLM call fails → return raw text as single `speak` segment → `cleanTextForNarration` applied.

---

## 8. Scripted Narration Design (Session 10B)

### 8.1 NarrationScript Format

```typescript
type NarrationScript = {
  title: string;
  style?: 'informative' | 'conversational' | 'dramatic' | 'whisper';
  steps: NarrationStep[];
};

type NarrationStep =
  | { type: 'speak';           text: string; cleanMode?: 'narrate-full' | 'raw' }
  | { type: 'speak-file';      uri: string; startLine?: number; endLine?: number }
  | { type: 'command';         command: string; args?: unknown[] }
  | { type: 'delay';           ms: number }
  | { type: 'await-speech' }
  | { type: 'highlight';       uri: string; startLine: number; endLine: number; color?: string }
  | { type: 'clear-highlight' };
```

### 8.2 Execution model

```
ScriptRunner.execute(script)
   ├── for each step in script.steps:
   │     ├── speak:           cleanText → synthesize → play → await completion
   │     ├── speak-file:      readFile(uri, range) → cleanText → synthesize → play
   │     ├── command:         vscode.commands.executeCommand(cmd, ...args)
   │     ├── delay:           sleep(ms)
   │     ├── await-speech:    await current playback
   │     ├── highlight:       vscode.window.activeTextEditor.setDecorations(...)
   │     └── clear-highlight: remove decorations
   └── return ScriptResult { completed, stepsExecuted, totalSteps, durationMs }
```

**Cancellation:** `ScriptRunner.cancel()` interrupts the current playback and skips remaining steps. VS Code command `accordo.voice.stopNarration` calls this.

**Error policy:** each step can be configured to `skip` (continue to next step) or `abort` (throw). Default: `skip` for `command` steps, `abort` for `speak` steps if TTS unavailable.

### 8.3 Integration with Accordo commands

Any VS Code command is callable from a `command` step. Extension-registered commands (`accordo.presentation.*`, `accordo.commentsPanel.*`, etc.) and built-in VS Code commands both work.

> **Important:** `accordo_editor_*` names are MCP tool IDs — they are **not** registered VS Code commands and cannot be used in `command` steps. Use VS Code built-in commands or the Accordo extension commands listed below.

```jsonc
[
  // Open a file using VS Code built-in command (use a file URI)
  { "type": "command", "command": "vscode.open", "args": ["file:///workspace/src/main.ts"] },
  // Navigate to a specific line in the active editor
  { "type": "command", "command": "workbench.action.gotoLine" },
  // Open a presentation deck (accordo-slidev registered command)
  { "type": "command", "command": "accordo.presentation.open", "args": ["demo/my.deck.md"] },
  // Navigate to slide 3
  { "type": "command", "command": "accordo.presentation.goto", "args": [3] },
  // Open a diagram (accordo-diagram registered command, Session 11)
  { "type": "command", "command": "accordo.diagram.open", "args": ["docs/arch.mmd"] }
]
```

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
  // (Session 10B) present when a script is executing:
  activeScript: {
    title: 'Architecture Overview',
    currentStep: 5,
    totalSteps: 12
  }
});
```

**System prompt rendering (Hub):**

```markdown
## Voice
Status: Active (Whisper STT + Kokoro TTS)
Mode: narrate-everything, speed 1.0×, voice af_sarah (en-US)
Narration: Playing — step 5 of 12 "Architecture Overview"
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

### 12.1 Slidev (presentations)

The `accordo_voice_narrate` tool (Session 10B) can include `accordo.presentation.*` command steps, enabling the agent to narrate slide decks:

```json
{ "type": "command", "command": "accordo.presentation.goto", "args": [2] },
{ "type": "speak", "text": "Here we see the Hub architecture." }
```

The slidev extension also exposes `accordo.presentation.generateNarration` which returns per-slide narration text — the voice extension can consume this and assemble a full-deck script.

### 12.2 Comments

During a scripted narration, the agent can reference and navigate to comment threads:

```json
{ "type": "command", "command": "accordo.commentsPanel.navigateToAnchor", "args": [threadId] },
{ "type": "speak", "text": "There's a review comment here asking about the error handling." }
```

### 12.3 Editor tools

The most common integration pattern — open a file, narrate it, highlight specific lines:

```json
{ "type": "command", "command": "vscode.open", "args": ["file:///workspace/src/hub.ts"] },
{ "type": "highlight", "uri": "src/hub.ts", "startLine": 80, "endLine": 120, "color": "blue" },
{ "type": "speak", "text": "This is the WebSocket handler for Bridge connections." },
{ "type": "await-speech" },
{ "type": "clear-highlight" }
```

### 12.4 Diagrams (Session 11, future)

When the diagrams modality (Session 11) is implemented, scripted narrations will similarly be able to execute `accordo.diagram.*` commands to pan/zoom diagrams while narrating.

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
| LLM endpoint not configured (10B) | `narrate-summary` mode falls back to `narrate-full` |

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
| **10B** | M51-NR, M51-NT, M51-PP, M51-UL, M51-STR | Scripted narration, LLM summary mode, utterance library, streaming TTS |

**Test baseline to preserve:** 1418 existing tests across Hub/Bridge/Editor/Comments/SDK/md-viewer/slidev. New `packages/voice` adds ~198 tests (10A) and ~60 tests (10B estimate).

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
| `src/narration/preprocessor.ts` | `extensions/openspace-voice/src/node/narration-preprocessor.ts` |
| `src/narration/utterance-library.ts` | `extensions/openspace-voice/src/node/utterance-library.ts` |
