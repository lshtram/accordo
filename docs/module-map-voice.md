# Module Map: `@accordo/voice` v2.0

> **Status:** Current (2026-04-17) — minimal TTS-only implementation.

## Purpose

VS Code extension providing TTS read-aloud via `accordo_voice_readAloud` MCP tool. External HTTP TTS is preferred (lightweight); Kokoro ONNX remains as fallback. No STT, no dictation, no panel, no status bar, no streaming, no audio queue.

---

## Composition Root

`extension.ts` — `activate()` reads configuration, creates TTS provider (external-first or Kokoro fallback), initialises SessionFsm + NarrationFsm, registers readAloud MCP tool and 2 VS Code commands (readAloud, stopNarration).

`voice-bootstrap.ts` — VS Code ceremony layer (allowed to import `vscode`); reads voice config, loads policy into SessionFsm, syncs context key + bridge state.

`voice-adapters.ts` — Pure adapter/utility layer (no `vscode` imports); creates TTS provider based on config (external HTTP vs Kokoro).

---

## Key Modules

| File | Responsibility | Public API |
|------|---------------|------------|
| `extension.ts` | VS Code entry point; owns activation, provider creation, FSM setup, tool/command registration | `activate()`, `deactivate()`, `BridgeAPI`, `VoiceActivateDeps` |
| `voice-bootstrap.ts` | VS Code ceremony: config reading, policy loading, context sync, Bridge state publishing | `readVoiceConfig()`, `loadPolicyFromConfiguration()`, `syncUiAndState()`, `publishVoiceState()` |
| `voice-adapters.ts` | TtsProvider factory: creates ExternalTtsAdapter or KokoroAdapter based on config | `createTtsProvider()` |
| `tools/read-aloud.ts` | MCP tool: accordo_voice_readAloud — single-shot TTS synthesize + play | `createReadAloudTool()` |
| `core/fsm/session-fsm.ts` | Session state machine (policy holder) | `SessionFsm` class |
| `core/fsm/narration-fsm.ts` | Narration playback state tracker (idle → playing) | `NarrationFsm` class |
| `core/fsm/types.ts` | FSM types: VoicePolicy, SessionState, NarrationState, NarrationMode | All FSM state/policy types |
| `core/providers/tts-provider.ts` | TTS provider interface | `TtsProvider`, `CancellationToken`, `TtsSynthesisRequest`, `TtsSynthesisResult` |
| `core/adapters/external-tts.ts` | External HTTP TTS (OpenAI-compatible) — preferred | `ExternalTtsAdapter` class |
| `core/adapters/kokoro.ts` | Kokoro ONNX TTS — fallback | `KokoroAdapter` class, `trimSilence()` |
| `core/audio/playback.ts` | PCM audio playback via afplay/aplay/PowerShell | `playPcmAudio()`, `startPcmPlayback()` |
| `text/text-cleaner.ts` | Markdown/code → spoken text transformation | `cleanTextForNarration()` |

---

## What Was Removed (v1 → v2)

| Removed | Reason |
|---|---|
| `streaming-tts.ts` | Not needed for minimal single-shot readAloud |
| `audio-queue.ts` | Not needed for minimal mode |
| `voice-narration.ts` | Inlined into extension.ts |
| `PreSpawnedPlayer` | Only used by streaming-tts.ts |
| `CachedSound` | Only used by streaming-tts.ts |
| `doResumeNarration()` | Not needed for minimal mode |
| WhisperCppAdapter, AudioFsm, dictation tool | STT removed |
| Status bar, voice panel | UI removed |
| Hub prompt narration directives | OpenCode plugin is sole control plane |

---

## Extension Points

- **`BridgeAPI`**: Minimal interface (`registerTools`, `publishState`) consumed from `extension.ts`.
- **`TtsProvider` interface**: Allows swapping TTS backends. New providers implement this interface and are instantiated in `voice-adapters.ts`.
- **`NarrationDeps`** (removed): Was the dependency injection bag. No longer needed — tool uses direct deps.

---

## Internal Boundaries

- **`voice-bootstrap.ts`** is the only file that imports `vscode` besides `extension.ts`. All other modules use dependency injection for UI operations.
- **`voice-adapters.ts`** has zero `vscode` imports — it is the leaf adapter layer creating provider instances.
- **`tools/` subdirectory**: Tool files are internal. External packages access them only through `extension.ts`'s tool registration.
- **`core/fsm/`**: The two FSMs manage state with clean interfaces — no circular dependencies.
- **`core/providers/` and `core/adapters/`**: Internal implementation of the TTS abstraction. Public contract is the `TtsProvider` interface.
