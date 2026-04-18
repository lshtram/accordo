# accordo-voice — Voice Modality Requirements Specification v2.0

> **Status:** Current (2026-04-17) — TTS-only minimal implementation.
> This is the authoritative requirements document.
> v1.0 (full STT+TTS) is archived.

**Package:** `accordo-voice` (VS Code extension)  
**Type:** VS Code extension — TTS read-aloud only, no STT/dictation  
**Date:** 2026-04-17  
**Architecture reference:** [`docs/10-architecture/voice-architecture.md`](../10-architecture/voice-architecture.md)

---

## 1. Purpose

`accordo-voice` is a minimal VS Code extension providing TTS read-aloud capability. It registers one MCP tool (`accordo_voice_readAloud`) that the agent calls explicitly. There is no automatic narration by default — the OpenCode narration plugin (`ACCORDO_NARRATION_MODE`) is the single narration control plane.

**Design principles:**
1. **External-first TTS:** Prefers external HTTP TTS API (lightweight, no local model) when configured. Kokoro ONNX remains as fallback when no external endpoint is set.
2. **Minimal orchestration:** Single-shot synthesize → play. No streaming pipeline, no audio queue, no complex FSM queue.
3. **Single control plane:** Narration is controlled exclusively by the OpenCode plugin. Hub prompt engine does NOT include automatic narration directives.
4. **Provider-agnostic:** `TtsProvider` interface is the hot-swap point. Any TTS engine (External, Kokoro, ElevenLabs, Azure) implements this interface.
5. **Text-aware:** Pre-TTS cleaning is markdown/code-aware. Code blocks, math, URLs, and formatting are replaced with natural spoken equivalents.

---

## 2. Package Structure

```
packages/voice/
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── src/
    ├── extension.ts                 # activate/deactivate — minimal orchestration
    ├── voice-bootstrap.ts           # VS Code ceremony: config, policy, state sync
    ├── voice-adapters.ts           # TtsProvider factory (external vs Kokoro)
    ├── core/
    │   ├── providers/
    │   │   └── tts-provider.ts      # TtsProvider interface + CancellationToken
    │   ├── adapters/
    │   │   ├── external-tts.ts      # ExternalTtsAdapter (HTTP TTS API)
    │   │   └── kokoro.ts           # KokoroAdapter (local ONNX, fallback)
    │   ├── fsm/
    │   │   ├── types.ts            # VoicePolicy, SessionState, NarrationState
    │   │   ├── session-fsm.ts       # SessionFsm (policy holder)
    │   │   └── narration-fsm.ts    # NarrationFsm (playback state tracker)
    │   └── audio/
    │       ├── wav.ts              # buildWavBuffer
    │       └── playback.ts         # Platform-specific audio player
    ├── text/
    │   ├── text-cleaner.ts         # Deterministic markdown→speech cleanup
    │   └── sentence-splitter.ts   # Split text into sentences
    └── tools/
        └── read-aloud.ts           # accordo_voice_readAloud MCP tool
```

---

## 3. Extension Manifest Contract

### 3.1 Commands

| Command ID | Title | Icon |
|---|---|---|
| `accordo.voice.readAloud` | Read Selection Aloud | `$(play)` |
| `accordo.voice.stopNarration` | Stop Narration | `$(debug-stop)` |

### 3.2 Keybindings

| Command | Key | When |
|---|---|---|
| `accordo.voice.readAloud` | `Ctrl+Alt+R` / `Cmd+Alt+R` | `editorTextFocus && editorHasSelection` |

### 3.3 Configuration

```json
{
  "configuration": {
    "title": "Accordo Voice",
    "properties": {
      "accordo.voice.enabled": {
        "type": "boolean",
        "default": false,
        "description": "Enable voice session when TTS provider is available"
      },
      "accordo.voice.voice": {
        "type": "string",
        "default": "af_sarah",
        "description": "TTS voice identifier"
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
        "description": "BCP-47 language code for TTS"
      },
      "accordo.voice.narrationMode": {
        "type": "string",
        "default": "narrate-off",
        "enum": ["narrate-off", "narrate-everything", "narrate-summary"],
        "description": "Narration mode for the readAloud tool (not used for auto-narration)"
      },
      "accordo.voice.ttsEndpoint": {
        "type": "string",
        "default": "",
        "description": "External TTS HTTP endpoint (e.g. https://api.openai.com/v1). Takes priority over Kokoro."
      },
      "accordo.voice.ttsAuthToken": {
        "type": "string",
        "default": "",
        "description": "Bearer token for external TTS endpoint"
      },
      "accordo.voice.ttsModel": {
        "type": "string",
        "default": "",
        "description": "Model name for external TTS (e.g. tts-1). Defaults to provider default."
      }
    }
  }
}
```

---

## 4. Module Specifications

---

### M50-SP — TtsProvider Interface

**File:** `src/core/providers/tts-provider.ts`  
**Test file:** (interface-only — tested via adapters)

| Requirement ID | Requirement |
|---|---|
| M50-SP-01 | Exports `CancellationToken` interface: `{ isCancellationRequested: boolean, onCancellationRequested(handler: () => void): void }` |
| M50-SP-02 | Exports `TtsSynthesisRequest` type: `{ text: string, language: string, speed?: number, voice?: string }` |
| M50-SP-03 | Exports `TtsSynthesisResult` type: `{ audio: Uint8Array, sampleRate?: number }` |
| M50-SP-04 | Exports `TtsProvider` interface with `kind: 'tts'`, `id: string`, `isAvailable(): Promise<boolean>`, `synthesize(request, token?): Promise<TtsSynthesisResult>`, `dispose(): Promise<void>` |

---

### M50-KA — KokoroAdapter (Fallback)

**File:** `src/core/adapters/kokoro.ts`  
**Test file:** `src/__tests__/kokoro.test.ts`

| Requirement ID | Requirement |
|---|---|
| M50-KA-01 | Exports `class KokoroAdapter` implementing `TtsProvider` |
| M50-KA-02 | `isAvailable()` attempts `require.resolve('kokoro-js')` and returns true/false (cached after first check) |
| M50-KA-03 | `synthesize()` lazy-loads the Kokoro model on first call, caches the instance |
| M50-KA-04 | Lazy-load uses shared promise pattern — concurrent callers reuse the same loading promise |
| M50-KA-05 | Audio output: Float32Array → trim silence → Int16 PCM → Uint8Array |
| M50-KA-06 | `trimSilence()` exported as standalone function with configurable threshold/pad |
| M50-KA-07 | `dispose()` clears the cached model instance |
| M50-KA-08 | `kind` is `'tts'`, `id` is `'kokoro'` |

---

### M50-ET — ExternalTtsAdapter (Preferred)

**File:** `src/core/adapters/external-tts.ts`  
**Test file:** (tested via TtsProvider interface contract)

| Requirement ID | Requirement |
|---|---|
| M50-ET-01 | Exports `class ExternalTtsAdapter` implementing `TtsProvider` |
| M50-ET-02 | Constructor accepts `{ endpoint: string, authToken: string, model?: string }` |
| M50-ET-03 | `isAvailable()` returns true when endpoint and authToken are non-empty |
| M50-ET-04 | `synthesize()` POSTs to `${endpoint}/audio/speech` with JSON body, accepts PCM response |
| M50-ET-05 | Auth header is constructed as `Bearer ${token}` when not already prefixed |
| M50-ET-06 | `dispose()` is a no-op (HTTP-based, no held resources) |
| M50-ET-07 | `kind` is `'tts'`, `id` is `'external'` |

---

### M50-FSM — Voice FSMs

**File:** `src/core/fsm/types.ts`, `src/core/fsm/session-fsm.ts`, `src/core/fsm/narration-fsm.ts`  
**Test files:** `src/__tests__/session-fsm.test.ts`, `src/__tests__/narration-fsm.test.ts`

#### M50-FSM Types

| Requirement ID | Requirement |
|---|---|
| M50-FSM-01 | Exports `NarrationState = 'idle' \| 'queued' \| 'processing' \| 'playing' \| 'paused'` |
| M50-FSM-02 | Exports `NarrationMode = 'narrate-off' \| 'narrate-everything' \| 'narrate-summary'` |
| M50-FSM-03 | Exports `VoicePolicy` interface: `{ enabled, narrationMode, speed, voice, language }` with `DEFAULT_VOICE_POLICY` |
| M50-FSM-04 | Exports `class VoiceFsmError extends Error` with `.fsm`, `.from`, `.trigger` properties |

#### M50-FSM SessionFsm

| Requirement ID | Requirement |
|---|---|
| M50-FSM-10 | `SessionFsm` starts in `'inactive'` state |
| M50-FSM-11 | `enable()`: inactive → active (idempotent) |
| M50-FSM-12 | `disable()`: active → inactive (idempotent) |
| M50-FSM-13 | `updatePolicy(partial)` merges partial into current policy |
| M50-FSM-14 | `get state`, `get policy` return current values (policy returns a copy) |

#### M50-FSM NarrationFsm

| Requirement ID | Requirement |
|---|---|
| M50-FSM-30 | `NarrationFsm` starts in `'idle'` state with empty queue |
| M50-FSM-31 | `enqueue(request)`: idle → queued, pushes request |
| M50-FSM-32 | `enqueue()` with `mode === 'narrate-off'` is a no-op |
| M50-FSM-33 | `startProcessing()`: queued → processing |
| M50-FSM-34 | `audioReady()`: processing → playing |
| M50-FSM-35 | `complete()`: shifts queue, → idle if empty |
| M50-FSM-36 | `error()`: any active state → idle, clears queue |

---

### M50-WAV — WAV Utility + Playback

**File:** `src/core/audio/wav.ts`, `src/core/audio/playback.ts`  
**Test file:** `src/__tests__/playback.test.ts`

| Requirement ID | Requirement |
|---|---|
| M50-WAV-01 | `buildWavBuffer(pcm16: Uint8Array, sampleRate: number, channels: number): Buffer` — writes valid 44-byte WAV header + PCM data |
| M50-WAV-02 | `playPcmAudio(pcm: Uint8Array, sampleRate: number): Promise<void>` — writes to temp WAV, plays, cleans up |
| M50-WAV-03 | Platform detection: macOS → `afplay`, Linux → `aplay`, Windows → PowerShell `SoundPlayer` |
| M50-WAV-04 | Temp file is cleaned up in `finally` block regardless of outcome |
| M50-WAV-05 | Audio player errors are caught and re-thrown with descriptive messages |

---

### M50-TC — TextCleaner

**File:** `src/text/text-cleaner.ts`  
**Test file:** `src/__tests__/text-cleaner.test.ts`

| Requirement ID | Requirement |
|---|---|
| M50-TC-01 | Exports `cleanTextForNarration(text: string, mode: CleanMode): string` |
| M50-TC-02 | `CleanMode` type: `'narrate-full' \| 'narrate-headings'` |
| M50-TC-03 | Fenced code blocks → `"There's a code snippet shown on screen."` |
| M50-TC-04 | Inline code ≤20 chars kept, longer → `"a code reference"` |
| M50-TC-05 | Math expressions → `"There's a mathematical expression shown on screen."` |
| M50-TC-06 | URLs → `"there's a link shown on screen"` |
| M50-TC-07 | Markdown links: keep text, strip URL |
| M50-TC-08 | Bold/italic markers stripped, text preserved |
| M50-TC-09 | HTML tags stripped entirely |
| M50-TC-10 | Heading markers (`# Foo`) → `"Section: Foo"` |
| M50-TC-11 | Bullet markers stripped |
| M50-TC-12 | Emoji stripped |
| M50-TC-13 | Multiple newlines collapsed to single pause |
| M50-TC-14 | Multiple whitespace collapsed to single space |
| M50-TC-15 | `'narrate-headings'` mode: extracts heading text + first sentence after each heading |
| M50-TC-16 | Returns trimmed result; empty input → empty string |
| M50-TC-17 | Pure function — no side effects, no async |

---

### M50-SS — SentenceSplitter

**File:** `src/text/sentence-splitter.ts`  
**Test file:** `src/__tests__/sentence-splitter.test.ts`

| Requirement ID | Requirement |
|---|---|
| M50-SS-01 | Exports `splitIntoSentences(text: string): string[]` |
| M50-SS-02 | Splits on sentence-ending punctuation followed by whitespace |
| M50-SS-03 | Splits on newlines |
| M50-SS-04 | Trims each fragment and filters empty strings |
| M50-SS-05 | Empty input returns empty array |
| M50-SS-06 | Pure function |

---

### M50-RA — ReadAloud Tool

**File:** `src/tools/read-aloud.ts`  
**Test file:** `src/__tests__/read-aloud.test.ts`

| Requirement ID | Requirement |
|---|---|
| M50-RA-01 | Tool name: `accordo_voice_readAloud` |
| M50-RA-02 | Group: `"voice"` |
| M50-RA-03 | Description: `"Read text aloud using text-to-speech. Cleans markdown/code before speaking."` |
| M50-RA-04 | Input schema: `{ text: string (required), cleanMode?: 'narrate-full' \| 'narrate-headings' \| 'raw', voice?: string, speed?: number }` |
| M50-RA-05 | If `text` is empty/whitespace: returns `{ spoken: false, reason: "empty text" }` |
| M50-RA-06 | If `cleanMode` is not `'raw'`, applies `cleanTextForNarration()` |
| M50-RA-07 | Uses `voice` and `speed` from args, falling back to session policy |
| M50-RA-08 | Speed validation: rejects if outside 0.5–2.0 range |
| M50-RA-09 | Synthesizes via `TtsProvider`, plays via `playPcmAudio()`, updates `NarrationFsm` |
| M50-RA-10 | Returns `{ spoken: true, textLength, cleanedLength, voice }` on success |
| M50-RA-11 | Returns error result (no throw) when TTS provider unavailable |
| M50-RA-12 | Danger level: `"safe"`, idempotent: `false` |

---

### M50-EXT — Extension Integration

**File:** `src/extension.ts`  
**Test file:** `src/__tests__/extension.test.ts`

| Requirement ID | Requirement |
|---|---|
| M50-EXT-01 | `activate(context)` reads configuration from `accordo.voice` settings |
| M50-EXT-02 | Creates TTS provider via `createTtsProvider()` (external-first, Kokoro fallback) |
| M50-EXT-03 | Creates `SessionFsm` and `NarrationFsm` |
| M50-EXT-04 | Registers VS Code commands: `readAloud`, `stopNarration` |
| M50-EXT-05 | Registers `accordo_voice_readAloud` MCP tool via BridgeAPI |
| M50-EXT-06 | Publishes voice state `{ policy, ttsAvailable }` on activation |
| M50-EXT-07 | Sets context key `accordo.voice.narrating` during playback |
| M50-EXT-08 | Responds to `accordo.voice` configuration changes |
| M50-EXT-09 | `deactivate()` disposes TTS provider |
| M50-EXT-10 | Graceful degradation: extension activates even without Bridge |

---

## 5. Non-Requirements (explicitly out of scope)

- **No automatic narration via Hub prompt.** Hub prompt engine does NOT include narration directives. OpenCode plugin is the sole narration control plane.
- **No STT/dictation.** WhisperCppAdapter, AudioFsm, dictation tool are removed.
- **No streaming TTS pipeline.** Sentence-level streaming with overlap is removed (future enhancement if needed).
- **No audio queue.** Sequential receipt-based playback sequencing is removed.
- **No status bar / voice panel UI.** These were removed in the v1→v2 simplification.
- **No LLM calls from voice extension.** Summary mode is handled by OpenCode plugin's Gemini summarization — not in-scope for the voice extension.
- **No scripted walkthroughs.** `ScriptRunner`, `NarrationScript` are not part of this module.

---

## 6. Dependency Analysis

### 6.1 NPM Dependencies

| Package | Purpose | Notes |
|---|---|---|
| `kokoro-js` | Neural TTS (optional fallback) | `peerDependencies` — only loaded when Kokoro is used |
| `@accordo/bridge-types` | Shared types | `workspace:*` |

### 6.2 System Dependencies

| Dependency | Required for | Detection |
|---|---|---|
| `kokoro-js` npm package | Kokoro TTS (fallback) | `require.resolve()` check; graceful if missing |
| `afplay` / `aplay` / PowerShell | Audio playback | Platform-detected; error if not found |
| External TTS API | External TTS (preferred) | Configured via `ttsEndpoint` + `ttsAuthToken` |
