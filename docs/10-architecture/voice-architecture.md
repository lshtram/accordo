# Accordo — Voice Modality Architecture v2.0

> **Status:** Current (2026-04-17) — TTS-only minimal implementation.
> Supersedes v1.0 which described the full STT+TTS voice extension.
> This is the authoritative architecture document.

**Package:** `accordo-voice` (VS Code extension)  
**Scope:** Minimal TTS read-aloud — single MCP tool, no STT/dictation/panel/status bar  
**Requirements:** [`docs/20-requirements/requirements-voice.md`](../20-requirements/requirements-voice.md)

---

## 1. Goal

`accordo-voice` gives the Accordo agent a minimal read-aloud capability via a single MCP tool (`accordo_voice_readAloud`). The agent calls it explicitly; there is no automatic narration by default.

**What it does:**
- Text-to-speech via `accordo_voice_readAloud` MCP tool
- Markdown/code cleaning before synthesis (deterministic, no LLM)
- Single-shot synthesize → play pipeline (no streaming/queue)
- VS Code command: read selection aloud (`Cmd+Alt+R`)

**What was removed from v1.0:**
- STT / dictation (WhisperCppAdapter, dictation tool, AudioFsm)
- Status bar, voice panel (WebviewView)
- Streaming TTS pipeline, audio queue
- Narration directives in Hub prompt engine (handled by OpenCode plugin instead)

---

## 2. TTS Backend Strategy

### ADR — External TTS preferred, Kokoro as fallback

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| External HTTP TTS (OpenAI-compatible) | Lightweight, no local model, consistent quality | Requires API key + endpoint config | **Preferred** |
| Kokoro ONNX (local) | Offline, no API cost | Heavy ONNX runtime, CPU load, process explosion risk | Fallback |

**Abstraction guarantee:** `TtsProvider` interface is the hot-swap point. Adding ElevenLabs, Azure, or Piper requires only a new adapter — no changes to tools or orchestration.

---

## 3. Narration Control Plane

### ADR — OpenCode plugin is the single narration control plane

Two prior candidates were creating double-trigger risk:

| Candidate | Mechanism | Problem |
|---|---|---|
| Hub prompt engine | System-prompt directive for `narrate-summary`/`narrate-everything` | Double-narration when combined with plugin |
| OpenCode narration plugin | `session.idle` event + `ACCORDO_NARRATION_MODE` env var | Correct approach |

**Resolution:** Hub prompt engine narration directives are removed. OpenCode narration plugin (`ACCORDO_NARRATION_MODE`) is the sole control plane. `accordo.voice.narrationMode` in VS Code settings is ignored by the Hub prompt — it only affects the `accordo_voice_readAloud` tool's effective mode when called directly.

**Control matrix:**

| ACCORDO_NARRATION_MODE | Hub directive | Plugin behaviour |
|---|---|---|
| unset / `"off"` | None | Silent — no narration |
| `"summary"` | None | Summarize via LLM, then readAloud |
| `"everything"` | None | ReadAloud with full response text |

---

## 4. System Overview

```
┌──────────────────────────────────────────────────────────────────┐
│  VS Code Extension Host                                          │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  accordo-voice  (extensionKind: ["workspace"])           │   │
│  │                                                              │   │
│  │  SessionFsm (policy holder — enabled/disabled)             │   │
│  │  NarrationFsm (idle → playing, tracks playback state)    │   │
│  │                                                              │   │
│  │  ┌──────────────────┐   ┌────────────────────────────┐   │   │
│  │  │ ExternalTtsAdapt │ / │ KokoroAdapter (fallback)  │   │   │
│  │  │ (HTTP TTS API)   │   │ (kokoro-js ONNX, local)  │   │   │
│  │  └──────────────────┘   └────────────────────────────┘   │   │
│  │         │                        │                        │   │
│  │  ┌──────▼───────────────────────────────────────────┐   │   │
│  │  │  MCP Tool: accordo_voice_readAloud                │   │   │
│  │  │  cleanTextForNarration → synthesize → playAudio   │   │   │
│  │  └────────────────────────┬──────────────────────────┘   │   │
│  │                           │ registerTools()                │   │
│  │  ┌────────────────────────▼──────────────────────────┐   │   │
│  │  │  accordo-bridge  (BridgeAPI)                      │   │   │
│  │  │  publishState('accordo-voice', { policy, ttsAvail })  │   │
│  │  └───────────────────────────────────────────────────┘   │   │
│  └──────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
                           │ WS /bridge
┌──────────────────────────▼──────────────────────────────────────┐
│  accordo-hub                                                         │
│  State cache: accordo-voice: { policy, ttsAvailable }               │
│  Prompt: ## Voice section (TTS availability only — no directives)    │
└───────────────────────────────────────────────────────────────────┘
                           │ MCP
┌──────────────────────────▼──────────────────────────────────────┐
│  AI Agent                                                             │
│  → accordo_voice_readAloud (explicit calls only)                    │
└───────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│  OpenCode Agent (separate process)                                │
│  → accordo narration plugin (session.idle)                         │
│  → ACCORDO_NARRATION_MODE=summary|everything|off                  │
│  → Calls accordo_voice_readAloud via Hub MCP endpoint              │
└──────────────────────────────────────────────────────────────────┘
```

---

## 5. Package Structure

```
packages/voice/
├── package.json              # accordo-voice VS Code extension
├── tsconfig.json
├── vitest.config.ts
└── src/
    ├── extension.ts          # activate / deactivate — minimal orchestration
    ├── voice-bootstrap.ts   # VS Code ceremony: config, policy, state sync
    ├── voice-adapters.ts    # TtsProvider factory (external vs Kokoro)
    ├── core/
    │   ├── providers/
    │   │   └── tts-provider.ts   # TtsProvider interface + CancellationToken
    │   ├── adapters/
    │   │   ├── external-tts.ts   # ExternalTtsAdapter (HTTP TTS API)
    │   │   └── kokoro.ts         # KokoroAdapter (local ONNX, fallback)
    │   ├── fsm/
    │   │   ├── types.ts           # VoicePolicy, SessionState, NarrationState
    │   │   ├── session-fsm.ts     # SessionFsm (policy holder)
    │   │   └── narration-fsm.ts   # NarrationFsm (playback state tracker)
    │   └── audio/
    │       ├── wav.ts             # buildWavBuffer
    │       └── playback.ts        # playPcmAudio, startPcmPlayback
    ├── text/
    │   ├── text-cleaner.ts        # cleanTextForNarration (markdown → speech)
    │   └── sentence-splitter.ts  # splitIntoSentences (for potential future streaming)
    └── tools/
        └── read-aloud.ts          # accordo_voice_readAloud MCP tool
```

---

## 6. TTS Provider Interface

```typescript
interface TtsProvider {
  readonly kind: "tts";
  readonly id: string;             // e.g. "external", "kokoro"
  isAvailable(): Promise<boolean>;
  synthesize(
    request: TtsSynthesisRequest,
    token?: CancellationToken,
  ): Promise<TtsSynthesisResult>;
  dispose(): Promise<void>;
}

interface TtsSynthesisRequest {
  text: string;
  language: string;
  speed?: number;   // 0.5–2.0
  voice?: string;   // provider-specific
}

interface TtsSynthesisResult {
  audio: Uint8Array;     // 16-bit signed PCM
  sampleRate?: number;   // Hz
}
```

---

## 7. FSM Design

### 7.1 SessionFsm

Manages policy only. No enable/disable flow in minimal mode (always available when TTS is available).

```
inactive ──enable()──► active
   ▲◄──disable()──────
```

### 7.2 NarrationFsm

Tracks playback state. Not used for queue management in minimal mode (each readAloud call is independent).

```
                 enqueue()       startProcessing()      audioReady()
idle ──────────────────► queued ───────────► processing ────────────► playing
  ◄──complete()/error()◄───────────────────────────────────────────────┘
```

---

## 8. Text Processing Pipeline

```
Raw text
   │
   ▼ cleanTextForNarration(text, mode)     [text-cleaner.ts]
Cleaned text (markdown stripped, code→spoken, etc.)
   │
   ▼ ttsProvider.synthesize()
PCM audio
   │
   ▼ playPcmAudio() (platform player: afplay/aplay/PowerShell)
Speaker output
```

---

## 9. VS Code Configuration

```json
{
  "accordo.voice.enabled": {
    "type": "boolean",
    "default": false,
    "description": "Enable voice session when TTS provider is available"
  },
  "accordo.voice.voice": {
    "type": "string",
    "default": "af_sarah",
    "description": "TTS voice"
  },
  "accordo.voice.speed": {
    "type": "number",
    "default": 1.0,
    "minimum": 0.5,
    "maximum": 2.0
  },
  "accordo.voice.narrationMode": {
    "type": "string",
    "default": "narrate-off",
    "enum": ["narrate-off", "narrate-everything", "narrate-summary"]
  },
  "accordo.voice.ttsEndpoint": {
    "type": "string",
    "default": "",
    "description": "External TTS HTTP API endpoint. When set, takes priority over Kokoro."
  },
  "accordo.voice.ttsAuthToken": {
    "type": "string",
    "default": "",
    "description": "Bearer token for external TTS endpoint"
  },
  "accordo.voice.ttsModel": {
    "type": "string",
    "default": "",
    "description": "Model name for external TTS (e.g. tts-1)"
  }
}
```

---

## 10. State Contribution

```typescript
bridge.publishState("accordo-voice", {
  policy: {
    enabled: true,
    narrationMode: "narrate-off",
    speed: 1.0,
    voice: "af_sarah",
    language: "en-US"
  },
  ttsAvailable: true,
});
```

**System prompt rendering (Hub):**

```markdown
## Voice
Status: TTS available
```

No narration directive in the Hub prompt — OpenCode plugin owns narration control.

---

## 11. Known TTS Adapters

| ID | Type | Technology | Default |
|---|---|---|---|
| `external` | TtsProvider | HTTP TTS API (OpenAI-compatible) | **Preferred** |
| `kokoro` | TtsProvider | kokoro-js ONNX (local) | Fallback |
