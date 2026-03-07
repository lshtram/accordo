# Testing Guide — Session 10A: `accordo-voice` (M50-SP through M50-EXT)

**Date:** Session 10A + continuation  
**Package:** `packages/voice/` (`accordo-voice`)  
**Total automated tests:** 211  
**Commits:** `1136d65` → `789b506`

---

## 1. Automated Tests (CI Gate)

Run before any manual testing:

```bash
pnpm --filter accordo-voice test
```

Expected output: `Tests  211 passed (211)`. If any fail, do not proceed to manual verification.

---

## 2. Module: M50-SP — Provider Interfaces

**File:** `src/core/providers/stt-provider.ts`, `src/core/providers/tts-provider.ts`

### Manual checks
- Open both files and confirm the interfaces match the requirements.
- `SttProvider`: `kind: "stt"`, `id: string`, `isAvailable(): Promise<boolean>`, `transcribe(request, token?): Promise<SttTranscriptionResult>`
- `TtsProvider`: `kind: "tts"`, `id: string`, `isAvailable(): Promise<boolean>`, `synthesize(request, token?): Promise<TtsSynthesisResult>`, `dispose(): Promise<void>`

---

## 3. Module: M50-WA — WhisperCppAdapter

**File:** `src/core/adapters/whisper-cpp.ts`

### Manual checks
1. If `whisper` binary is installed: run `new WhisperCppAdapter().isAvailable()` from a scratch Node.js script — should resolve `true`.
2. Without binary: should resolve `false` (no throw).
3. To test transcription: provide a 16-bit PCM WAV file and call `transcribe()`.

### Regression tests (automated)
- 14 tests cover: `buildWav`, `isAvailable` (available/unavailable), `transcribe` full lifecycle, cleanup on error, cancellation.

---

## 4. Module: M50-KA — KokoroAdapter

**File:** `src/core/adapters/kokoro.ts`

### Manual checks
1. Without `kokoro-js` installed: `isAvailable()` should resolve `false`.
2. With `kokoro-js` installed: `isAvailable()` resolves `true`, `synthesize()` returns `{ audio: Uint8Array, sampleRate: number }`.
3. `dispose()` clears cached model — subsequent `synthesize()` triggers fresh load.

### Regression tests
- 15 tests cover: availability, lazy loading, synthesize, trim-silence correctness, dispose.

---

## 5. Module: M50-FSM — State Machines

**Files:** `src/core/fsm/`

### Manual checks — SessionFsm
- Start: state `"inactive"`.
- `enable()` → `"active"`. `enable()` again → still `"active"` (idempotent).
- `disable()` → `"inactive"`. `disable()` when inactive → no-op.
- `pushToTalkStart()` from `"active"` → `"suspended"`.
- `pushToTalkEnd()` from `"suspended"` → `"active"`.
- Invalid transitions throw `VoiceFsmError` with `fsm`, `from`, `trigger` fields.

### Manual checks — AudioFsm
- `"idle"` → `startCapture()` → `"listening"` → `stopCapture()` → `"processing"` → `transcriptReady()` → `"idle"`.
- `"processing"` → `error()` → `"error"` → `reset()` → `"idle"`.

### Manual checks — NarrationFsm
- `enqueue({ text, mode: "narrate-off" })` → no-op (mode-off).
- `enqueue(...)` from `"idle"` → `"queued"`. `startProcessing()` → `"processing"` → `audioReady()` → `"playing"` → `pause()` → `"paused"` → `resume()` → `"playing"` → `complete()` → `"idle"` (queue empty).
- `error()` from any active state → `"idle"`, queue cleared.

### Regression tests
- 36 tests (12 session + 10 audio + 14 narration).

---

## 6. Module: M50-WAV — WAV Utilities + Playback

**Files:** `src/core/audio/wav.ts`, `src/core/audio/playback.ts`

### Manual check
- On macOS: `playPcmAudio(pcm16Array, 22050)` should play audio via `afplay`.
- On Linux: uses `aplay`.
- On Windows: uses PowerShell `SoundPlayer`.
- Wrong exit code throws `"afplay exited with code N"`.

### Regression tests
- 12 tests (5 wav buffer + 7 playback lifecycle).

---

## 7. Module: M50-TC/SS/VC — Text Processing

**Files:** `src/text/text-cleaner.ts`, `src/text/sentence-splitter.ts`, `src/text/vocabulary.ts`

### Manual check — TextCleaner
```typescript
import { cleanTextForNarration } from "./src/text/text-cleaner.js";
console.log(cleanTextForNarration("# Hello\n```\ncode block\n```\n**bold** text", "narrate-full"));
// Expected: "Section: Hello\n There's a code snippet shown on screen.\nbold text"
```

### Manual check — SentenceSplitter
```typescript
import { splitIntoSentences } from "./src/text/sentence-splitter.js";
console.log(splitIntoSentences("Hello. World. How are you?"));
// Expected: ["Hello.", "World.", "How are you?"]
```

### Manual check — VoiceVocabulary
Create a `VoiceVocabulary` with a Memento, `addEntry("tf2", "TensorFlow 2")`, then `process("Using tf2")` → `"Using TensorFlow 2"`.

### Regression tests
- 40 tests (20 + 8 + 12).

---

## 8. Module: M50-DT — `accordo_voice_discover`

**File:** `src/tools/discover.ts`

### Manual check (VS Code + Bridge connected)
Ask the AI agent: "What voice tools are available?"  
Agent calls `accordo_voice_discover`.  
Expected response includes:
```json
{
  "tools": [...4 tools...],
  "sessionState": "inactive",
  "audioState": "idle",
  "narrationState": "idle",
  "policy": { "enabled": false, "narrationMode": "narrate-off", ... },
  "sttAvailable": true/false,
  "ttsAvailable": true/false
}
```

### Regression tests — 6 automated

---

## 9. Module: M50-RA — `accordo_voice_readAloud`

**File:** `src/tools/read-aloud.ts`

### Manual check (voice enabled)
```
AI: accordo_voice_readAloud({ "text": "# Hello World\n\nThis is a test.", "cleanMode": "narrate-full" })
```
Expected: VS Code plays audio. Returns `{ "spoken": true, "textLength": ..., "voice": "af_sarah" }`.

Edge cases:
- `{ "text": "" }` → `{ "spoken": false, "reason": "empty text" }`
- `{ "text": "...", "cleanMode": "raw" }` → no text cleaning applied
- With `"voice": "fr-fr"` → synthesizes with French voice

### Regression tests — 13 automated

---

## 10. Module: M50-DI — `accordo_voice_dictation`

**File:** `src/tools/dictation.ts`

### Manual check
```
AI: accordo_voice_dictation({ "action": "start" })
→ { "recording": true }   [microphone starts]

AI: accordo_voice_dictation({ "action": "stop" })
→ { "text": "hello world" }  [transcript returned]

AI: accordo_voice_dictation({ "action": "stop", "insertAtCursor": true })
→ inserts transcript at active editor cursor
```

Edge cases:
- `action: "toggle"` when idle → starts; when recording → stops
- STT unavailable → `{ "error": "STT provider is not available" }`

### Regression tests — 12 automated

---

## 11. Module: M50-POL — `accordo_voice_setPolicy`

**File:** `src/tools/set-policy.ts`

### Manual check
```
AI: accordo_voice_setPolicy({ "enabled": true, "narrationMode": "narrate-everything", "speed": 1.2 })
→ { "policy": { "enabled": true, "narrationMode": "narrate-everything", "speed": 1.2, ... } }
```

Validation cases:
- `{ "speed": 3.0 }` → `{ "error": "speed must be between 0.5 and 2.0, got 3" }`
- `{ "narrationMode": "invalid" }` → `{ "error": "Invalid narrationMode: invalid" }`
- `{ "voice": "" }` → `{ "error": "voice must not be empty" }`

### Regression tests — 13 automated

---

## 12. Module: M50-SB — VoiceStatusBar

**File:** `src/ui/status-bar.ts`

### Manual check (with extension loaded)
Verify status bar item appears on right side of VS Code status bar.

State transitions to observe:
| Action | Expected text |
|---|---|
| Extension loaded, inactive | `$(mute) Voice: Off` |
| `setPolicy({ enabled:true })` | `$(unmute) Voice: Ready` |
| Start dictation | `$(record) Voice: Recording…` |
| Transcribing | `$(loading~spin) Voice: Transcribing…` |
| Reading aloud | `$(play) Voice: Narrating…` |
| Narration paused | `$(debug-pause) Voice: Paused` |
| STT error | `$(error) Voice: Error` |

- Click status bar when idle → opens `accordo.voice.configure`
- Click when narrating → `accordo.voice.stopNarration`
- Hover shows tooltip with voice, speed, mode from policy

### Regression tests — 14 automated

---

## 13. Module: M50-VP — VoicePanelProvider

**File:** `src/ui/voice-panel.ts`

### Manual check (with extension loaded)
1. Open the Voice panel from the activity bar.
2. Verify waveform canvas is visible.
3. Verify mic button is present.
4. Press and hold mic button → `micDown` message sent → dictation starts.
5. Release mic button → `micUp` message → dictation stops, transcript returned.
6. During narration, stop button appears; clicking it fires `stopNarration`.
7. Volume data sent to webview drives animated waveform bars.

### Security
- View source of webview HTML: confirm CSP has `nonce-XXXX` and `<script nonce="...">` matches.
- No `unsafe-inline` or `unsafe-eval` in script-src.

### Regression tests — 16 automated

---

## 14. Module: M50-EXT — Extension Activation

**File:** `src/extension.ts`

### Manual check (clean VS Code window)
1. Install the `accordo-bridge` extension first.
2. Install `accordo-voice`.
3. Open Output → select "Accordo Voice" channel.
4. Observe: providers checked, status bar appears, tools registered in Bridge.
5. Open Accordo Voice panel (sidebar).

### With providers installed
- Status bar → `$(unmute) Voice: Ready`
- Agent can call `accordo_voice_discover` immediately.

### Without providers installed
- Warning notification appears: "providers not available. Install Whisper.cpp and kokoro-js."
- Status bar → `$(mute) Voice: Off`

### Without Bridge
- No errors, no tools registered.
- Status bar + commands still function for local use.

### Deactivation
- Reload window or disable extension.
- Verify KokoroAdapter model is released (memory freed).

### Regression tests — 14 automated (12 active + 2 export checks)

---

## 15. End-to-End Scenario

**Prerequisites:** Bridge connected, both providers installed.

1. Open a markdown file with `# Architecture` heading and code blocks.
2. Select a paragraph.
3. Right-click → "Read Selection Aloud" (or ask agent: `accordo_voice_readAloud`).
4. Verify: text is cleaned (code blocks replaced), synthesized, played.
5. Ask agent: `accordo_voice_dictation({ "action": "toggle" })` — speaks into mic.
6. Agent returns transcript; if `insertAtCursor: true`, inserts at cursor.
7. Ask agent: `accordo_voice_setPolicy({ "narrationMode": "narrate-headings", "speed": 1.5 })`.
8. Re-read the file — only headings + first sentence of each section spoken.

---

## 16. Test Coverage Summary

| Module | File(s) | Tests |
|---|---|---|
| M50-SP | stt-provider + tts-provider | (interfaces only) |
| M50-WA | whisper-cpp.ts | 14 |
| M50-KA | kokoro.ts | 15 |
| M50-FSM | session/audio/narration-fsm.ts | 36 |
| M50-WAV | wav.ts + playback.ts | 12 |
| M50-TC | text-cleaner.ts | 20 |
| M50-SS | sentence-splitter.ts | 8 |
| M50-VC | vocabulary.ts | 12 |
| M50-DT | tools/discover.ts | 6 |
| M50-RA | tools/read-aloud.ts | 13 |
| M50-DI | tools/dictation.ts | 12 |
| M50-POL | tools/set-policy.ts | 13 |
| M50-SB | ui/status-bar.ts | 14 |
| M50-VP | ui/voice-panel.ts | 16 |
| M50-EXT | extension.ts | 14 |
| **Total** | | **211** |
