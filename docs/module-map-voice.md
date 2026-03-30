# Module Map: `@accordo/voice`

## Purpose
VSCode extension providing voice input (STT via Whisper) and audio output (TTS via Sherpa/Kokoro) with three finite state machines governing session lifecycle, audio capture, and narration playback. Registers MCP tools for AI agents to discover voice capabilities, trigger read-aloud, and control dictation.

## Composition Root
`extension.ts` — `activate()` reads configuration, creates STT/TTS providers, initialises three FSMs (SessionFsm, AudioFsm, NarrationFsm), registers the voice panel webview provider, registers VS Code commands, registers 4 MCP tools with the Bridge, and starts background availability checks.

`voice-bootstrap.ts` — VSCode ceremony layer (allowed to import `vscode`); reads voice config, loads policy into SessionFsm, synchronises status bar/panel/bridge state, publishes voice state to Bridge.

`voice-adapters.ts` — Pure adapter/utility layer (no `vscode` imports); creates STT/TTS provider instances and synthesises a ready chime PCM sample.

`voice-runtime.ts` — Core runtime functions (no `vscode` imports); handles dictation start/stop/toggle, text insertion, and session reconciliation based on provider availability.

## Key Modules

| File | Responsibility | Public API |
|------|---------------|------------|
| `extension.ts` | VSCode entry point; owns activation, provider creation, FSM setup, tool registration, command registration, availability checks | `activate()`, `deactivate()`, `BridgeAPI` interface, `VoiceActivateDeps` |
| `voice-bootstrap.ts` | VSCode ceremony: config reading, policy loading, status bar update, panel sync, Bridge state publishing | `readVoiceConfig()`, `loadPolicyFromConfiguration()`, `syncUiAndState()`, `publishVoiceState()` |
| `voice-adapters.ts` | Pure adapter layer: creates STT/TTS providers, generates ready chime PCM | `createSttProvider()`, `createTtsProvider()`, `buildReadyChimePcm()` |
| `voice-runtime.ts` | Core dictation runtime: start/stop/toggle dictation, text insertion, session reconciliation | `doToggleDictation()`, `doStartDictation()`, `doStopDictation()`, `insertDictationText()`, `reconcileSessionState()`, `VoiceRuntimeState`, `VoiceRuntimeDeps` |
| `voice-narration.ts` | Read-aloud and narration FSM operations (doReadAloud, doTestTts, doTestStt, doSpeakText, doStopNarration, doPauseNarration, doResumeNarration) | `doReadAloud()`, `NarrationDeps` interface |
| `voice-ui-adapter.ts` | VSCode UI adapter (workspace, window, commands) for testability | `VoiceUiAdapter` interface, `createVsCodeUiAdapter()` |
| `tools/discover.ts` | MCP tool: voice_discover — lists available STT/TTS providers and their status | `createDiscoverTool()` |
| `tools/read-aloud.ts` | MCP tool: voice_read_aloud — triggers TTS playback of selected text | `createReadAloudTool()` |
| `tools/dictation.ts` | MCP tool: voice_dictation_start/stop — toggles dictation mode | `createDictationTool()` |
| `tools/set-policy.ts` | MCP tool: voice_set_policy — updates voice session policy at runtime | `createSetPolicyTool()` |
| `core/fsm/session-fsm.ts` | Session state machine (inactive → active → suspended); transitions driven by policy and availability | `SessionFsm` class |
| `core/fsm/audio-fsm.ts` | Audio capture state machine; tracks recording, transcript-ready, error, reset states | `AudioFsm` class |
| `core/fsm/narration-fsm.ts` | Narration playback state machine (idle → playing ↔ paused); manages TTS stream lifecycle | `NarrationFsm` class |
| `core/fsm/types.ts` | FSM types: VoicePolicy, SessionState, AudioState, NarrationState | All FSM state/policy types |
| `core/providers/stt-provider.ts` | STT provider interface; concrete implementations: FasterWhisperHttpAdapter, WhisperCppAdapter | `SttProvider` interface |
| `core/providers/tts-provider.ts` | TTS provider interface; concrete implementations: SherpaSubprocessAdapter, KokoroAdapter | `TtsProvider` interface |
| `core/adapters/faster-whisper-http.ts` | HTTP client for faster-whisper server | `FasterWhisperHttpAdapter` class |
| `core/adapters/whisper-cpp.ts` | Subprocess adapter for whisper.cpp binary | `WhisperCppAdapter` class |
| `core/adapters/kokoro.ts` | ONNX-based TTS via kokoro-js | `KokoroAdapter` class |
| `core/adapters/sherpa-subprocess.ts` | Subprocess adapter for sherpa-kokoro C++ binary | `SherpaSubprocessAdapter` class |
| `core/audio/recorder.ts` | Audio recording via sox subprocess; exposes startRecording(), isRecordingAvailable() | `startRecording()`, `RecorderHandle` |
| `core/audio/playback.ts` | PCM audio playback via sox subprocess | `playPcmAudio()`, `startPcmPlayback()` |
| `core/audio/streaming-tts.ts` | Streaming TTS via Kokoro HTTP API | `streamingSpeak()` |
| `text/vocabulary.ts` | Voice vocabulary processing (applies find/replace rules to transcribed text) | `VoiceVocabulary` class |
| `text/text-cleaner.ts` | Text normalisation for TTS input | `cleanTextForNarration()` |
| `ui/status-bar.ts` | VSCode status bar item management | `VoiceStatusBar` class |
| `ui/voice-panel.ts` | Webview panel for voice controls | `VoicePanelProvider` class |
| `ui/logger.ts` | Output channel logger for voice events | `VoiceLogger` class |

## Extension Points

- **`VoiceUiAdapter`** interface: Abstracted VSCode UI operations (executeCommand, activeTextEditor, insertAtEditor, showWarningMessage, showErrorMessage). Allows voice-runtime to be tested without a VSCode host.
- **`SttProvider`/`TtsProvider` interfaces: Allows swapping STT/TTS backends. New providers implement these interfaces and are instantiated in `createSttProvider()`/`createTtsProvider()`.
- **`VoiceRuntimeDeps`**: Dependency injection bag passed to all voice-runtime functions. Any new runtime dependency is added here.
- **`BridgeAPI`**: The minimal interface (registerTools, publishState) consumed from extension.ts to wire voice tools and state to the Bridge.
- **`NarrationDeps`**: Dependency bag for narration FSM operations. Includes TTS provider, playback functions, and logging.
- **MCP tools**: Four tools registered with the Bridge — `voice_discover`, `voice_read_aloud`, `voice_dictation_start`, `voice_dictation_stop`, `voice_set_policy`. Adding a new tool follows the same pattern as existing tools.

## Internal Boundaries

- **`voice-bootstrap.ts`** is the only file that imports `vscode` besides `extension.ts` and `voice-ui-adapter.ts`. All other modules use dependency injection to receive VSCode operations.
- **`voice-runtime.ts`** has zero `vscode` imports — it uses `VoiceUiAdapter` and `VoiceRuntimeDeps` for all UI and external operations. This is the key architectural boundary enabling testability.
- **`voice-adapters.ts`** has zero `vscode` imports — it is the leaf adapter layer creating provider instances.
- **`tools/` subdirectory**: Each tool file (`discover.ts`, `read-aloud.ts`, `dictation.ts`, `set-policy.ts`) is internal to the tools layer. External packages access them only through `extension.ts`'s tool registration.
- **`core/fsm/`**: The three FSMs (SessionFsm, AudioFsm, NarrationFsm) manage state transitions but expose clean interfaces — other packages do not need to know their internals.
- **`core/providers/` and `core/adapters/`**: Internal implementation details of the STT/TTS abstraction. The public contract is the `SttProvider`/`TtsProvider` interfaces.
- **`ui/` subdirectory**: UI components (status bar, panel, logger) depend on `vscode` and are not re-exported from any public barrel.
