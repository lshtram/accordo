# accordo-voice — Voice Modality Requirements Specification

**Package:** `accordo-voice` (new VS Code extension)  
**Type:** VS Code extension — STT, TTS, narration, scripted sequences  
**Session:** 10A (core + tools), 10B (scripted narration + text cleaning)  
**Date:** 2026-03-07  
**Source code reference:** `theia-openspace/openspace-voice-vscode/` + `theia-openspace/extensions/openspace-voice/` + `theia-openspace/packages/voice-core/`  
**Architecture reference:** [`docs/voice-architecture.md`](voice-architecture.md)

---

## 1. Purpose

`accordo-voice` is a VS Code extension that gives the Accordo agent a voice — both literal (TTS narration) and figurative (STT dictation). It ports and extends the voice infrastructure from theia-openspace into the Accordo monorepo, registering MCP tools so the agent can read text aloud, narrate presentations, execute scripted walkthroughs, and accept voice input.

**Technology stack:**
- **STT:** Whisper.cpp (local, offline) via `WhisperCppAdapter`
- **TTS:** Kokoro (local, neural) via `KokoroAdapter`
- **Abstraction:** All providers behind `SttProvider` / `TtsProvider` interfaces — hot-swappable

**Design principles:**
1. **Local-first:** All audio processing runs locally. No cloud dependency for core STT/TTS.
2. **Provider-agnostic:** Providers are behind interfaces. New providers (VS Code Speech API, ElevenLabs, Piper, etc.) can be added without changing tool/command code.
3. **Scriptable:** An agent can generate a complete narration script in one shot and hand it off for execution — no step-by-step MCP round-trips.
4. **Text-aware:** Pre-TTS cleaning is markdown/code-aware. Content that doesn't speak well (code blocks, math, URLs) is replaced with natural spoken equivalents.
5. **Integrated:** Voice tools compose with all existing Accordo commands — editor, presentation, comments, diagrams — enabling rich scripted walkthroughs.

**Session split:**
- **Session 10A:** voice-core port, provider abstraction, STT/TTS adapters, FSMs, Bridge registration, MCP tools (`voice.readAloud`, `voice.dictation`, `voice.setPolicy`, `voice.discover`), status bar, WebviewView voice panel. Text cleaning (deterministic) included here as it's needed by `readAloud`.
- **Session 10B:** Scripted narration runtime (`voice.narrate`), LLM-powered summary mode, sentence streaming, utterance library, integration tests with slidev/editor.

---

## 2. Package Structure

```
packages/voice/
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── src/
    ├── extension.ts                 # activate/deactivate
    ├── core/                        # Ported from voice-core + Theia extension
    │   ├── providers/
    │   │   ├── stt-provider.ts      # SttProvider interface
    │   │   └── tts-provider.ts      # TtsProvider interface
    │   ├── adapters/
    │   │   ├── whisper-cpp.ts       # WhisperCppAdapter
    │   │   └── kokoro.ts            # KokoroAdapter
    │   ├── fsm/
    │   │   ├── types.ts             # State/Trigger types, VoicePolicy
    │   │   ├── session-fsm.ts       # SessionFsm
    │   │   ├── audio-fsm.ts         # AudioFsm
    │   │   └── narration-fsm.ts     # NarrationFsm
    │   └── audio/
    │       ├── wav.ts               # buildWavBuffer
    │       └── playback.ts          # Platform-specific audio player
    ├── text/                        # Text processing pipeline
    │   ├── text-cleaner.ts          # Deterministic markdown→speech cleanup
    │   ├── sentence-splitter.ts     # Split text for incremental TTS
    │   └── vocabulary.ts            # User vocabulary (word replacements)
    ├── tools/                       # MCP tool definitions
    │   ├── discover.ts              # voice.discover
    │   ├── read-aloud.ts            # voice.readAloud
    │   ├── dictation.ts             # voice.dictation
    │   └── set-policy.ts            # voice.setPolicy
    ├── commands/                    # VS Code commands
    │   ├── dictation-command.ts     # Push-to-talk dictation
    │   └── read-aloud-command.ts    # Read selection aloud
    ├── ui/                          # Status bar + WebviewView panel
    │   ├── status-bar.ts            # StatusBarItem management
    │   └── voice-panel.ts           # WebviewView — waveform + controls
    └── __tests__/
        ├── whisper-cpp.test.ts
        ├── kokoro.test.ts
        ├── session-fsm.test.ts
        ├── audio-fsm.test.ts
        ├── narration-fsm.test.ts
        ├── text-cleaner.test.ts
        ├── sentence-splitter.test.ts
        ├── vocabulary.test.ts
        ├── discover.test.ts
        ├── read-aloud.test.ts
        ├── dictation.test.ts
        ├── set-policy.test.ts
        ├── status-bar.test.ts
        ├── voice-panel.test.ts
        ├── playback.test.ts
        └── extension.test.ts
```

---

## 3. Extension Manifest Contract

### 3.1 View Container

```json
"viewsContainers": {
  "panel": [
    {
      "id": "accordo-voice-container",
      "title": "Voice",
      "icon": "$(unmute)"
    }
  ]
}
```

### 3.2 View (WebviewView in the panel area)

```json
"views": {
  "accordo-voice-container": [
    {
      "id": "accordo-voice-panel",
      "name": "Voice",
      "type": "webview",
      "contextualTitle": "Accordo Voice"
    }
  ]
}
```

### 3.3 Commands

| Command ID | Title | Icon |
|---|---|---|
| `accordo.voice.startDictation` | Start Dictation | `$(record)` |
| `accordo.voice.readAloud` | Read Selection Aloud | `$(play)` |
| `accordo.voice.stopNarration` | Stop Narration | `$(debug-stop)` |
| `accordo.voice.pauseNarration` | Pause Narration | `$(debug-pause)` |
| `accordo.voice.resumeNarration` | Resume Narration | `$(play)` |
| `accordo.voice.configure` | Configure Voice | `$(gear)` |

### 3.4 Keybindings

| Command | Key | When |
|---|---|---|
| `accordo.voice.startDictation` | `Ctrl+Alt+V` (`Cmd+Alt+V` macOS) | `editorFocus` |
| `accordo.voice.readAloud` | `Ctrl+Alt+R` (`Cmd+Alt+R` macOS) | `editorHasSelection` |
| `accordo.voice.stopNarration` | `Escape` | `accordo.voice.narrating` |

### 3.5 Configuration

```json
"configuration": {
  "title": "Accordo Voice",
  "properties": {
    "accordo.voice.whisperPath": {
      "type": "string",
      "default": "whisper",
      "description": "Path to whisper.cpp binary"
    },
    "accordo.voice.whisperModelFolder": {
      "type": "string",
      "default": "/usr/local/share/whisper",
      "description": "Directory containing whisper model files"
    },
    "accordo.voice.whisperModel": {
      "type": "string",
      "default": "ggml-base.en.bin",
      "description": "Whisper model filename"
    },
    "accordo.voice.voice": {
      "type": "string",
      "default": "af_sarah",
      "enum": ["af_sarah", "am_adam", "af_bella", "af_nicole", "am_michael", "bf_emma", "bm_george"],
      "description": "Kokoro TTS voice"
    },
    "accordo.voice.speed": {
      "type": "number",
      "default": 1.0,
      "minimum": 0.5,
      "maximum": 2.0,
      "description": "TTS playback speed multiplier"
    },
    "accordo.voice.language": {
      "type": "string",
      "default": "en-US",
      "description": "BCP-47 language code for STT/TTS"
    },
    "accordo.voice.narrationMode": {
      "type": "string",
      "default": "narrate-off",
      "enum": ["narrate-off", "narrate-everything", "narrate-summary"],
      "description": "Default narration mode"
    },
    "accordo.voice.llmEndpoint": {
      "type": "string",
      "default": "",
      "description": "LLM API endpoint for summary narration mode (e.g. http://localhost:11434/v1)"
    },
    "accordo.voice.llmModel": {
      "type": "string",
      "default": "",
      "description": "LLM model name for summary mode (e.g. llama3, gpt-4)"
    }
  }
}
```

---

## 4. Module Specifications — Session 10A

---

### M50-SP — STT/TTS Provider Interfaces

**File:** `src/core/providers/stt-provider.ts`, `src/core/providers/tts-provider.ts`  
**Test file:** (interface-only — tested via adapters)

**Purpose:** Define the provider abstraction layer. Any STT or TTS engine implements these interfaces. No VS Code dependency.

| Requirement ID | Requirement |
|---|---|
| M50-SP-01 | Exports `SttProvider` interface with `kind: 'stt'`, `id: string`, `isAvailable(): Promise<boolean>`, `transcribe(request, token?): Promise<SttTranscriptionResult>` |
| M50-SP-02 | Exports `SttTranscriptionRequest` type: `{ audio: Uint8Array, sampleRate?: number, language: string }` |
| M50-SP-03 | Exports `SttTranscriptionResult` type: `{ text: string }` |
| M50-SP-04 | Exports `CancellationToken` interface: `{ isCancellationRequested: boolean, onCancellationRequested(handler: () => void): void }` |
| M50-SP-05 | Exports `TtsProvider` interface with `kind: 'tts'`, `id: string`, `isAvailable(): Promise<boolean>`, `synthesize(request, token?): Promise<TtsSynthesisResult>`, `dispose(): Promise<void>` |
| M50-SP-06 | Exports `TtsSynthesisRequest` type: `{ text: string, language: string, speed?: number, voice?: string }` |
| M50-SP-07 | Exports `TtsSynthesisResult` type: `{ audio: Uint8Array, sampleRate?: number }` |

---

### M50-WA — WhisperCppAdapter

**File:** `src/core/adapters/whisper-cpp.ts`  
**Test file:** `src/__tests__/whisper-cpp.test.ts`

**Purpose:** Implement `SttProvider` using the whisper.cpp CLI binary. Port from `voice-core/src/adapters/whisper-cpp.adapter.ts`.

| Requirement ID | Requirement |
|---|---|
| M50-WA-01 | Exports `class WhisperCppAdapter` implementing `SttProvider` |
| M50-WA-02 | Constructor accepts `binaryPath`, `modelFolder`, `modelFile`, `spawnFn` (all optional with sane defaults) |
| M50-WA-03 | `isAvailable()` spawns `binaryPath --help` and resolves `true` on exit code 0, `false` on error |
| M50-WA-04 | `transcribe()` writes audio to temp WAV file, invokes `whisper <model> -otxt -of <prefix> -f <wav>`, reads resulting `.txt` file, returns `{ text }` |
| M50-WA-05 | Temp WAV file and transcript file are cleaned up in `finally` block regardless of success/failure |
| M50-WA-06 | CancellationToken support: if `token.isCancellationRequested` during transcription, kills the child process and rejects |
| M50-WA-07 | Settled-guard pattern: once promise is settled, subsequent events (error/close/cancel) are no-ops |
| M50-WA-08 | `kind` is `'stt'`, `id` is `'whisper.cpp'` |

---

### M50-KA — KokoroAdapter

**File:** `src/core/adapters/kokoro.ts`  
**Test file:** `src/__tests__/kokoro.test.ts`

**Purpose:** Implement `TtsProvider` using kokoro-js for local neural TTS. Port from `voice-core/src/adapters/kokoro.adapter.ts`.

| Requirement ID | Requirement |
|---|---|
| M50-KA-01 | Exports `class KokoroAdapter` implementing `TtsProvider` |
| M50-KA-02 | `isAvailable()` attempts `require.resolve('kokoro-js')` and returns true/false (cached after first check) |
| M50-KA-03 | `synthesize()` lazy-loads the Kokoro model on first call, caches the instance |
| M50-KA-04 | Lazy-load uses shared promise pattern — concurrent callers reuse the same loading promise |
| M50-KA-05 | Audio output is Float32Array → trimmed silence → converted to Int16 PCM → returned as `Uint8Array` |
| M50-KA-06 | `trimSilence()` exported as a standalone function; uses configurable `SILENCE_THRESHOLD` (0.001) and `SILENCE_PAD_SAMPLES` (240) |
| M50-KA-07 | `dispose()` clears the cached model instance, allowing garbage collection |
| M50-KA-08 | `kind` is `'tts'`, `id` is `'kokoro'` |

---

### M50-FSM — Voice FSMs

**File:** `src/core/fsm/types.ts`, `src/core/fsm/session-fsm.ts`, `src/core/fsm/audio-fsm.ts`, `src/core/fsm/narration-fsm.ts`  
**Test files:** `src/__tests__/session-fsm.test.ts`, `src/__tests__/audio-fsm.test.ts`, `src/__tests__/narration-fsm.test.ts`

**Purpose:** Three finite state machines managing voice lifecycle. Port from `voice-core/src/fsm/`.

#### M50-FSM Types

| Requirement ID | Requirement |
|---|---|
| M50-FSM-01 | Exports `AudioState = 'idle' \| 'listening' \| 'processing' \| 'error'` |
| M50-FSM-02 | Exports `AudioTrigger = 'startCapture' \| 'stopCapture' \| 'transcriptReady' \| 'sttError' \| 'reset'` |
| M50-FSM-03 | Exports `NarrationState = 'idle' \| 'queued' \| 'processing' \| 'playing' \| 'paused'` |
| M50-FSM-04 | Exports `NarrationTrigger = 'enqueue' \| 'startProcessing' \| 'audioReady' \| 'pause' \| 'resume' \| 'complete' \| 'error'` |
| M50-FSM-05 | Exports `SessionState = 'inactive' \| 'active' \| 'suspended'` |
| M50-FSM-06 | Exports `SessionTrigger = 'enable' \| 'disable' \| 'pushToTalkStart' \| 'pushToTalkEnd'` |
| M50-FSM-07 | Exports `NarrationMode = 'narrate-off' \| 'narrate-everything' \| 'narrate-summary'` and `NARRATION_MODES` const array |
| M50-FSM-08 | Exports `VoicePolicy` interface: `{ enabled, narrationMode, speed, voice, language }` with `DEFAULT_VOICE_POLICY` |
| M50-FSM-09 | Exports `class VoiceFsmError extends Error` with `.fsm`, `.from`, `.trigger` properties |

#### M50-FSM SessionFsm

| Requirement ID | Requirement |
|---|---|
| M50-FSM-10 | `SessionFsm` starts in `'inactive'` state |
| M50-FSM-11 | `enable()`: inactive → active (idempotent: active → active ok) |
| M50-FSM-12 | `disable()`: active → inactive, suspended → inactive (idempotent: inactive → inactive ok) |
| M50-FSM-13 | `pushToTalkStart()`: active → suspended |
| M50-FSM-14 | `pushToTalkEnd()`: suspended → active |
| M50-FSM-15 | Invalid transitions throw `VoiceFsmError` |
| M50-FSM-16 | `updatePolicy(partial)` merges partial into current policy |
| M50-FSM-17 | `get state`, `get policy` return current values (policy returns a copy) |

#### M50-FSM AudioFsm

| Requirement ID | Requirement |
|---|---|
| M50-FSM-20 | `AudioFsm` starts in `'idle'` state |
| M50-FSM-21 | `startCapture()`: idle → listening |
| M50-FSM-22 | `stopCapture()`: listening → processing |
| M50-FSM-23 | `transcriptReady()`: processing → idle |
| M50-FSM-24 | `error()`: processing → error |
| M50-FSM-25 | `reset()`: error → idle |
| M50-FSM-26 | Invalid transitions throw `VoiceFsmError` |

#### M50-FSM NarrationFsm

| Requirement ID | Requirement |
|---|---|
| M50-FSM-30 | `NarrationFsm` starts in `'idle'` state with empty queue |
| M50-FSM-31 | `enqueue(request)`: idle → queued, pushes request. If already non-idle, pushes without transition |
| M50-FSM-32 | `enqueue()` with `mode === 'narrate-off'` is a no-op |
| M50-FSM-33 | `startProcessing()`: queued → processing |
| M50-FSM-34 | `audioReady()`: processing → playing |
| M50-FSM-35 | `pause()`: playing → paused |
| M50-FSM-36 | `resume()`: paused → playing |
| M50-FSM-37 | `complete()`: shifts queue, returns next request if any (→ queued), or → idle if empty |
| M50-FSM-38 | `error()`: any active state → idle (queued/processing/playing/paused) |

---

### M50-WAV — WAV Utility + Playback

**File:** `src/core/audio/wav.ts`, `src/core/audio/playback.ts`  
**Test files:** `src/__tests__/playback.test.ts`

**Purpose:** WAV buffer construction and platform-specific audio playback. Port from voice-core `utils/wav.ts` and the VS Code extension `audio/playback.ts`.

| Requirement ID | Requirement |
|---|---|
| M50-WAV-01 | `buildWavBuffer(pcm16: Uint8Array, sampleRate: number, channels: number): Buffer` — writes valid 44-byte WAV header + PCM data |
| M50-WAV-02 | `playPcmAudio(pcm: Uint8Array, sampleRate: number): Promise<void>` — writes to temp WAV, plays, cleans up |
| M50-WAV-03 | Platform detection: macOS → `afplay`, Linux → `aplay`, Windows → PowerShell `SoundPlayer` |
| M50-WAV-04 | Temp file is cleaned up in `finally` block regardless of success/failure |
| M50-WAV-05 | Audio player errors are caught and re-thrown as descriptive Error messages |

---

### M50-TC — TextCleaner

**File:** `src/text/text-cleaner.ts`  
**Test file:** `src/__tests__/text-cleaner.test.ts`

**Purpose:** Deterministic pre-TTS text transformation pipeline. Markdown/code-aware. No LLM dependency.

| Requirement ID | Requirement |
|---|---|
| M50-TC-01 | Exports `cleanTextForNarration(text: string, mode: CleanMode): string` |
| M50-TC-02 | `CleanMode` type: `'narrate-full' \| 'narrate-headings'` (summary mode uses LLM and is deferred to 10B) |
| M50-TC-03 | **Fenced code blocks** (` ``` ... ``` `) → `"There's a code snippet shown on screen."` |
| M50-TC-04 | **Inline code** (`` `...` ``) → keeps content if ≤ 20 chars, otherwise `"a code reference"` |
| M50-TC-05 | **Math expressions** (`$...$` and `$$...$$`) → `"There's a mathematical expression shown on screen."` |
| M50-TC-06 | **URLs** (http/https) → `"there's a link shown on screen"` |
| M50-TC-07 | **Markdown links** `[text](url)` → keeps text, strips URL |
| M50-TC-08 | **Bold/italic markers** (`*`, `**`, `_`, `__`) → stripped, text preserved |
| M50-TC-09 | **HTML tags** → stripped entirely |
| M50-TC-10 | **Heading markers** (`# Foo`) → `"Section: Foo"` with natural pause |
| M50-TC-11 | **Bullet markers** (`-`, `*`, `+`, numbered) → stripped |
| M50-TC-12 | **Emoji** (Emoji_Presentation codepoints) → stripped |
| M50-TC-13 | **Multiple newlines** → collapsed to single pause marker |
| M50-TC-14 | **Multiple whitespace** → collapsed to single space |
| M50-TC-15 | `'narrate-headings'` mode: extracts only heading text + first sentence after each heading |
| M50-TC-16 | Returns trimmed result; empty input → empty string |
| M50-TC-17 | Pure function — no side effects, no async, highly testable |

---

### M50-SS — SentenceSplitter

**File:** `src/text/sentence-splitter.ts`  
**Test file:** `src/__tests__/sentence-splitter.test.ts`

**Purpose:** Split cleaned text into individual sentences for incremental TTS synthesis.

| Requirement ID | Requirement |
|---|---|
| M50-SS-01 | Exports `splitIntoSentences(text: string): string[]` |
| M50-SS-02 | Splits on sentence-ending punctuation (`[.!?]`) followed by whitespace |
| M50-SS-03 | Splits on newlines |
| M50-SS-04 | Trims each fragment and filters empty strings |
| M50-SS-05 | Empty input returns empty array |
| M50-SS-06 | Pure function — no side effects |

---

### M50-VC — Vocabulary

**File:** `src/text/vocabulary.ts`  
**Test file:** `src/__tests__/vocabulary.test.ts`

**Purpose:** User-configurable word replacement table. Applied to STT transcripts after recognition. Persisted in workspace state.

| Requirement ID | Requirement |
|---|---|
| M50-VC-01 | Exports `class VoiceVocabulary` |
| M50-VC-02 | Constructor accepts `vscode.Memento` (workspace state) for persistence |
| M50-VC-03 | `process(text: string): string` — applies all replacements: fix double spaces, punctuation spacing, then vocabulary entries (longest-first to avoid partial matches) |
| M50-VC-04 | `getEntries(): VocabularyEntry[]` — returns current list |
| M50-VC-05 | `addEntry(from: string, to: string): void` — upserts entry, persists |
| M50-VC-06 | `removeEntry(from: string): void` — removes and persists |
| M50-VC-07 | `setEntries(entries: VocabularyEntry[]): void` — replaces all, persists |
| M50-VC-08 | Persistence key: `"accordo.voice.vocabulary"` |
| M50-VC-09 | Loads from memento on construction; invalid data resets to empty |

---

### M50-DT — Discover Tool

**File:** `src/tools/discover.ts`  
**Test file:** `src/__tests__/discover.test.ts`

**Purpose:** MCP discover tool for the voice group. Returns available voice tools and current voice state.

| Requirement ID | Requirement |
|---|---|
| M50-DT-01 | Tool name: `accordo_voice_discover` |
| M50-DT-02 | Group: `"voice"` |
| M50-DT-03 | Description: `"Discover available voice tools and current voice state"` |
| M50-DT-04 | Input schema: empty object (no parameters) |
| M50-DT-05 | Returns JSON with: list of available tool names + descriptions, current session state, current policy, STT/TTS provider availability |
| M50-DT-06 | Danger level: `"safe"`, idempotent: `true` |

---

### M50-RA — ReadAloud Tool

**File:** `src/tools/read-aloud.ts`  
**Test file:** `src/__tests__/read-aloud.test.ts`

**Purpose:** MCP tool for the agent to read text aloud. Applies text cleaning, synthesizes with TTS provider, plays audio.

| Requirement ID | Requirement |
|---|---|
| M50-RA-01 | Tool name: `accordo_voice_readAloud` |
| M50-RA-02 | Group: `"voice"` |
| M50-RA-03 | Description: `"Read text aloud using text-to-speech. Cleans markdown/code before speaking."` |
| M50-RA-04 | Input schema: `{ text: string (required), cleanMode?: 'narrate-full' \| 'narrate-headings' \| 'raw', voice?: string, speed?: number }` |
| M50-RA-05 | If `text` is empty or whitespace-only, returns `{ spoken: false, reason: "empty text" }` |
| M50-RA-06 | If `cleanMode` is not `'raw'`, applies `cleanTextForNarration()` before synthesis |
| M50-RA-07 | Uses `voice` and `speed` from args, falling back to session policy defaults |
| M50-RA-08 | Enqueues narration via `NarrationFsm`, synthesizes via `TtsProvider`, plays via `playPcmAudio()` |
| M50-RA-09 | Returns `{ spoken: true, textLength: number, cleanedLength: number, voice: string }` on success |
| M50-RA-10 | If TTS provider is unavailable, returns error result (no throw) |
| M50-RA-11 | Updates status bar and voice panel during playback |
| M50-RA-12 | Danger level: `"safe"`, idempotent: `false` |

---

### M50-DI — Dictation Tool

**File:** `src/tools/dictation.ts`  
**Test file:** `src/__tests__/dictation.test.ts`

**Purpose:** MCP tool for the agent to start/stop voice dictation. Records audio, transcribes with STT, returns transcript.

| Requirement ID | Requirement |
|---|---|
| M50-DI-01 | Tool name: `accordo_voice_dictation` |
| M50-DI-02 | Group: `"voice"` |
| M50-DI-03 | Description: `"Record audio and transcribe speech-to-text. Returns the transcript."` |
| M50-DI-04 | Input schema: `{ action: 'start' \| 'stop' \| 'toggle', insertAtCursor?: boolean, language?: string }` |
| M50-DI-05 | `action: 'start'` — begins recording (microphone capture via `node-record-lpcm16`), returns `{ recording: true }` |
| M50-DI-06 | `action: 'stop'` — stops recording, transcribes via STT provider, returns `{ text: string }` |
| M50-DI-07 | `action: 'toggle'` — starts if idle, stops if recording |
| M50-DI-08 | If `insertAtCursor` is true on stop, inserts transcript at the active editor cursor position |
| M50-DI-09 | Applies vocabulary processing to transcript before returning |
| M50-DI-10 | If STT provider is unavailable, returns error result (no throw) |
| M50-DI-11 | Updates FSMs: `sessionFsm.pushToTalkStart()` on start, `audioFsm.startCapture()` → `stopCapture()` → `transcriptReady()` on lifecycle |
| M50-DI-12 | Danger level: `"safe"`, idempotent: `false` |

---

### M50-POL — SetPolicy Tool

**File:** `src/tools/set-policy.ts`  
**Test file:** `src/__tests__/set-policy.test.ts`

**Purpose:** MCP tool to update voice policy (enable/disable, narration mode, speed, voice, language).

| Requirement ID | Requirement |
|---|---|
| M50-POL-01 | Tool name: `accordo_voice_setPolicy` |
| M50-POL-02 | Group: `"voice"` |
| M50-POL-03 | Description: `"Update voice policy: enable/disable, narration mode, speed, voice, language"` |
| M50-POL-04 | Input schema: `{ enabled?: boolean, narrationMode?: NarrationMode, speed?: number, voice?: string, language?: string }` |
| M50-POL-05 | Merges provided fields into current `sessionFsm.policy` via `updatePolicy()` |
| M50-POL-06 | Validates speed (0.5–2.0), narrationMode (enum), voice (non-empty) — returns error for invalid values (no throw) |
| M50-POL-07 | If `enabled` changes, calls `sessionFsm.enable()` or `sessionFsm.disable()` accordingly |
| M50-POL-08 | Persists updated policy to VS Code settings via `workspace.getConfiguration().update()` |
| M50-POL-09 | Returns `{ policy: <new policy object> }` |
| M50-POL-10 | Updates status bar text to reflect new state |
| M50-POL-11 | Danger level: `"safe"`, idempotent: `true` |

---

### M50-SB — StatusBar

**File:** `src/ui/status-bar.ts`  
**Test file:** `src/__tests__/status-bar.test.ts`

**Purpose:** Manages VS Code status bar item reflecting current voice state.

| Requirement ID | Requirement |
|---|---|
| M50-SB-01 | Exports `class VoiceStatusBar` implementing `Disposable` |
| M50-SB-02 | Creates a `StatusBarItem` on the right side with priority 100 |
| M50-SB-03 | `update(session: SessionState, audio: AudioState, narration: NarrationState)` — updates text/icon/tooltip/color based on combined state |
| M50-SB-04 | State mapping: inactive → `$(mute) Voice: Off`, active+idle → `$(unmute) Voice: Ready`, listening → `$(record) Voice: Recording…` (red), processing → `$(loading~spin) Voice: Transcribing…`, playing → `$(play) Voice: Narrating…`, paused → `$(debug-pause) Voice: Paused`, error → `$(error) Voice: Error` |
| M50-SB-05 | Click command: `accordo.voice.configure` when idle; `accordo.voice.stopNarration` when playing |
| M50-SB-06 | Tooltip shows current policy summary (voice, speed, mode) |
| M50-SB-07 | `dispose()` disposes the `StatusBarItem` |

---

### M50-VP — VoicePanel (WebviewView)

**File:** `src/ui/voice-panel.ts`  
**Test file:** `src/__tests__/voice-panel.test.ts`

**Purpose:** A `WebviewViewProvider` for the voice panel. Shows waveform visualization during recording/playback, mic button, narration controls. Port of the Theia `VoiceWaveformOverlay` + `VoiceInputWidget` into a VS Code WebviewView.

| Requirement ID | Requirement |
|---|---|
| M50-VP-01 | Exports `class VoicePanelProvider` implementing `vscode.WebviewViewProvider` |
| M50-VP-02 | `resolveWebviewView()` sets up HTML with canvas-based waveform (32 bars, smoothed) and control buttons |
| M50-VP-03 | Webview HTML includes: mic button (circular, push-to-talk), stop narration button, status label, waveform canvas |
| M50-VP-04 | **Recording mode:** blue bars, waveform driven by volume data from audio capture. Red pulsing `● REC` label. Mic button turns red |
| M50-VP-05 | **Speaking mode:** white bars on blue background. Green `▶ Speaking` label. Stop button visible |
| M50-VP-06 | **Waiting mode:** green pulsing dots (CSS animation) |
| M50-VP-07 | **Idle mode:** flat bars, gray `Voice Ready` or `Voice Off` label |
| M50-VP-08 | `postMessage({ type: 'volumeData', data: number[] })` pushes real-time volume data to webview for waveform rendering |
| M50-VP-09 | `postMessage({ type: 'stateChange', session, audio, narration })` updates visual mode |
| M50-VP-10 | Webview → extension messages: `{ type: 'micDown' }`, `{ type: 'micUp' }`, `{ type: 'stopNarration' }` |
| M50-VP-11 | CSP policy restricts scripts to nonce-based inline scripts only |
| M50-VP-12 | `dispose()` cleans up webview resources |

---

### M50-EXT — Extension Integration

**File:** `src/extension.ts`  
**Test file:** `src/__tests__/extension.test.ts`

**Purpose:** Wire all voice components into the VS Code extension lifecycle. Register tools with BridgeAPI, set up status bar, voice panel, and VS Code commands.

| Requirement ID | Requirement |
|---|---|
| M50-EXT-01 | `activate(context)` reads configuration from `vscode.workspace.getConfiguration('accordo.voice')` |
| M50-EXT-02 | Creates `WhisperCppAdapter` and `KokoroAdapter` with configured paths |
| M50-EXT-03 | Creates `SessionFsm`, `AudioFsm`, `NarrationFsm` |
| M50-EXT-04 | Creates `VoiceVocabulary` with `context.workspaceState` |
| M50-EXT-05 | Registers `VoicePanelProvider` via `vscode.window.registerWebviewViewProvider('accordo-voice-panel', provider)` |
| M50-EXT-06 | Creates `VoiceStatusBar` and pushes to subscriptions |
| M50-EXT-07 | Checks provider availability in background (does not block activation) |
| M50-EXT-08 | If providers available: enables SessionFsm, updates status bar to Ready |
| M50-EXT-09 | If providers unavailable: shows warning with install instructions, status bar shows Error |
| M50-EXT-10 | Registers VS Code commands: `startDictation`, `readAloud`, `stopNarration`, `pauseNarration`, `resumeNarration`, `configure` |
| M50-EXT-11 | Acquires BridgeAPI via `vscode.extensions.getExtension('accordo.accordo-bridge')?.exports` |
| M50-EXT-12 | Registers MCP tools via `bridge.registerTools(toolDefinitions)` — tools: `accordo_voice_discover`, `accordo_voice_readAloud`, `accordo_voice_dictation`, `accordo_voice_setPolicy` |
| M50-EXT-13 | Publishes voice state via `bridge.publishState('accordo-voice', { ... })` on every FSM state change |
| M50-EXT-14 | State contribution shape: `{ session: SessionState, narration: NarrationState, audio: AudioState, policy: VoicePolicy, sttAvailable: boolean, ttsAvailable: boolean }` |
| M50-EXT-15 | Sets context key `accordo.voice.narrating` (boolean) for `when` clause on Escape keybinding |
| M50-EXT-16 | `deactivate()` disposes TTS adapter and all resources |
| M50-EXT-17 | Extension activates on `onView:accordo-voice-panel` and `onCommand:accordo.voice.*` activation events |
| M50-EXT-18 | Graceful degradation: extension activates even without Bridge (BridgeAPI may be null); tools not registered, but local commands still work |

---

## 5. Module Specifications — Session 10B (Preview)

These modules are defined here for architectural completeness but will be fully specified and implemented in Session 10B.

---

### M51-NR — Narration Script Runtime (Session 10B)

**File:** `src/narration/script-runner.ts`  
**Test file:** `src/__tests__/script-runner.test.ts`

**Purpose:** Execute a `NarrationScript` — a sequence of steps interleaving speech, VS Code commands, delays, and highlighting. The agent generates the full script in one shot; the runtime executes it without further MCP round-trips.

| Requirement ID | Requirement |
|---|---|
| M51-NR-01 | Exports `class ScriptRunner` with `execute(script: NarrationScript): Promise<ScriptResult>` |
| M51-NR-02 | `NarrationScript` type: `{ title: string, style?: NarrationStyle, steps: NarrationStep[] }` |
| M51-NR-03 | `NarrationStep` union type: `speak`, `speak-file`, `command`, `delay`, `await-speech`, `highlight`, `clear-highlight` |
| M51-NR-04 | `speak` step: cleans text (via TextCleaner), synthesizes with TTS, plays audio |
| M51-NR-05 | `speak-file` step: reads file URI content (optionally a line range), cleans, synthesizes, plays |
| M51-NR-06 | `command` step: calls `vscode.commands.executeCommand(command, ...args)` — any VS Code / Accordo command |
| M51-NR-07 | `delay` step: waits specified milliseconds |
| M51-NR-08 | `await-speech` step: blocks until current TTS playback finishes |
| M51-NR-09 | `highlight` step: calls `accordo_editor_highlight` or applies a temporary decoration on the specified range |
| M51-NR-10 | `clear-highlight` step: removes temporary decorations |
| M51-NR-11 | Steps execute sequentially; any step failure can be `skip` or `abort` per configurable error policy |
| M51-NR-12 | Cancellation: `cancel()` method stops playback and skips remaining steps |
| M51-NR-13 | Progress: emits `onProgress(stepIndex, totalSteps, stepType)` events |
| M51-NR-14 | Returns `ScriptResult`: `{ completed: boolean, stepsExecuted: number, totalSteps: number, durationMs: number, error?: string }` |

### M51-NT — Narrate Tool (Session 10B)

**File:** `src/tools/narrate.ts`

| Requirement ID | Requirement |
|---|---|
| M51-NT-01 | Tool name: `accordo_voice_narrate` |
| M51-NT-02 | Input: `{ script: NarrationScript }` (the full script object) |
| M51-NT-03 | Delegates to `ScriptRunner.execute(script)` |
| M51-NT-04 | Returns `ScriptResult` |
| M51-NT-05 | Only one script can execute at a time; calling while a script is running returns `{ error: "narration in progress" }` |

### M51-PP — Narration Preprocessor (Session 10B)

**File:** `src/narration/preprocessor.ts`

| Requirement ID | Requirement |
|---|---|
| M51-PP-01 | Exports `class NarrationPreprocessor` accepting `LlmCaller` function |
| M51-PP-02 | `process(text, mode)`: calls LLM with mode-specific prompt, parses response as `NarrationSegmentScript` |
| M51-PP-03 | Graceful fallback: if LLM call fails or returns invalid JSON, returns raw text as single speech segment |
| M51-PP-04 | Supports custom prompts per mode (everything, summary, custom styles) via `narrationPrompts` policy field |
| M51-PP-05 | LLM caller is injected — routes to configured endpoint (`accordo.voice.llmEndpoint`) via direct HTTP API call |

### M51-UL — Utterance Library (Session 10B)

**File:** `src/narration/utterance-library.ts`

| Requirement ID | Requirement |
|---|---|
| M51-UL-01 | Maps utterance IDs (`hmm`, `wow`, `nice`, `uh-oh`, `interesting`) to pre-recorded audio files |
| M51-UL-02 | Random variant selection when multiple files exist per utterance ID |
| M51-UL-03 | Returns file path or null if utterance ID unknown |

### M51-STR — Streaming Narration (Session 10B)

| Requirement ID | Requirement |
|---|---|
| M51-STR-01 | Splits cleaned text into sentences via `SentenceSplitter` |
| M51-STR-02 | Synthesizes sentences incrementally — starts playing sentence N while synthesizing N+1 |
| M51-STR-03 | Reduces perceived latency for long text narration |

---

## 6. State Contribution

Voice state is published to the Hub via `bridge.publishState('accordo-voice', state)`. Appears in the agent's system prompt under `## Voice`.

```typescript
interface VoiceStateSummary {
  session: SessionState;        // 'inactive' | 'active' | 'suspended'
  narration: NarrationState;    // 'idle' | 'queued' | 'processing' | 'playing' | 'paused'
  audio: AudioState;            // 'idle' | 'listening' | 'processing' | 'error'
  policy: {
    enabled: boolean;
    narrationMode: NarrationMode;
    speed: number;
    voice: string;
    language: string;
  };
  sttAvailable: boolean;
  ttsAvailable: boolean;
  /** Set when a script narration is in progress (Session 10B) */
  activeScript?: {
    title: string;
    currentStep: number;
    totalSteps: number;
  };
}
```

**System prompt rendering example:**
```markdown
## Voice
Status: Active (Whisper STT + Kokoro TTS)
Mode: narrate-everything, speed 1.0×, voice af_sarah
Narration: Playing (step 5/12 of "Architecture Overview")
```

---

## 7. Non-Requirements (Session 10A — explicitly out of scope)

- **No scripted narration runtime.** `ScriptRunner` and `accordo_voice_narrate` are Session 10B.
- **No LLM-powered summary mode.** Deterministic text cleaning only in 10A.
- **No streaming TTS.** Single-shot synthesis per text block. Streaming deferred to 10B (M51-STR).
- **No utterance library.** Pre-recorded audio files are Session 10B.
- **No auto-narration of agent responses.** Narrate-everything mode needs preprocessor (10B).
- **No recording from within the webview.** Audio capture uses Node.js `node-record-lpcm16`, not WebAudio API.
- **No language auto-detection.** Manual language selection only (matches whisper.cpp `--language` flag).
- **No changes to existing extensions** (`accordo-comments`, `accordo-editor`, `accordo-slidev`, etc.).
- **No changes to Hub or Bridge** beyond consuming existing `publishState()` and `registerTools()` APIs.

---

## 8. Test Coverage Summary

| Module | Test file | Requirement IDs | Approx. test count |
|---|---|---|---|
| M50-SP Providers | (covered by adapters) | M50-SP-01 → 07 | 0 (interface) |
| M50-WA Whisper | `whisper-cpp.test.ts` | M50-WA-01 → 08 | 12 |
| M50-KA Kokoro | `kokoro.test.ts` | M50-KA-01 → 08 | 12 |
| M50-FSM Session | `session-fsm.test.ts` | M50-FSM-10 → 17 | 12 |
| M50-FSM Audio | `audio-fsm.test.ts` | M50-FSM-20 → 26 | 10 |
| M50-FSM Narration | `narration-fsm.test.ts` | M50-FSM-30 → 38 | 14 |
| M50-WAV wav+play | `playback.test.ts` | M50-WAV-01 → 05 | 8 |
| M50-TC TextCleaner | `text-cleaner.test.ts` | M50-TC-01 → 17 | 22 |
| M50-SS Splitter | `sentence-splitter.test.ts` | M50-SS-01 → 06 | 8 |
| M50-VC Vocabulary | `vocabulary.test.ts` | M50-VC-01 → 09 | 12 |
| M50-DT Discover | `discover.test.ts` | M50-DT-01 → 06 | 6 |
| M50-RA ReadAloud | `read-aloud.test.ts` | M50-RA-01 → 12 | 14 |
| M50-DI Dictation | `dictation.test.ts` | M50-DI-01 → 12 | 14 |
| M50-POL SetPolicy | `set-policy.test.ts` | M50-POL-01 → 11 | 12 |
| M50-SB StatusBar | `status-bar.test.ts` | M50-SB-01 → 07 | 10 |
| M50-VP VoicePanel | `voice-panel.test.ts` | M50-VP-01 → 12 | 14 |
| M50-EXT Extension | `extension.test.ts` | M50-EXT-01 → 18 | 18 |
| **Total Session 10A** | | | **~198** |

---

## 9. Dependency Analysis

### 9.1 NPM Dependencies (new for `packages/voice`)

| Package | Purpose | Dev/Prod |
|---|---|---|
| `kokoro-js` | Neural TTS engine (Kokoro 82M ONNX) | prod (optional peer) |
| `node-record-lpcm16` | Cross-platform microphone capture | prod |
| `@accordo/bridge-types` | Shared types (workspace dep) | prod |

### 9.2 Cross-Package Dependencies

| Dependency | Direction | Notes |
|---|---|---|
| `accordo-voice` → `accordo-bridge` | Runtime (optional) | `getExtension().exports` — Bridge provides `registerTools()` and `publishState()` |
| `accordo-voice` → `@accordo/bridge-types` | Compile-time | Types: `ExtensionToolDefinition`, `ToolInputSchema`, `DangerLevel` |
| `accordo-voice` → `accordo-editor` | Indirect (10B) | ScriptRunner executes `accordo_editor_*` commands via `vscode.commands.executeCommand` |
| `accordo-voice` → `accordo-slidev` | Indirect (10B) | ScriptRunner executes `accordo_presentation_*` commands |

### 9.3 System Dependencies

| Dependency | Required for | Detection |
|---|---|---|
| `whisper.cpp` binary | STT transcription | `isAvailable()` check; graceful degradation if missing |
| `kokoro-js` npm package | TTS synthesis | `require.resolve()` check; graceful degradation if missing |
| `sox` / `arecord` / `rec` | Microphone capture (via node-record-lpcm16) | Runtime error if not installed |
| `afplay` / `aplay` / PowerShell | Audio playback | Platform-detected; error message if not found |
