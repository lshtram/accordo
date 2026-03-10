/**
 * accordo-voice — VS Code Extension entry point.
 *
 * M50-EXT
 */

import * as vscode from "vscode";
import type { ExtensionToolDefinition } from "@accordo/bridge-types";
import type { SttProvider } from "./core/providers/stt-provider.js";
import type { TtsProvider } from "./core/providers/tts-provider.js";
import type { VoicePolicy } from "./core/fsm/types.js";
import { WhisperCppAdapter } from "./core/adapters/whisper-cpp.js";
import { KokoroAdapter } from "./core/adapters/kokoro.js";
import { SherpaSubprocessAdapter } from "./core/adapters/sherpa-subprocess.js";
import { SessionFsm } from "./core/fsm/session-fsm.js";
import { AudioFsm } from "./core/fsm/audio-fsm.js";
import { NarrationFsm } from "./core/fsm/narration-fsm.js";
import { VoiceVocabulary } from "./text/vocabulary.js";
import { VoiceStatusBar } from "./ui/status-bar.js";
import { VoicePanelProvider } from "./ui/voice-panel.js";
import { cleanTextForNarration } from "./text/text-cleaner.js";
import { playPcmAudio, startPcmPlayback, createCachedSound, type PlaybackHandle, type CachedSound } from "./core/audio/playback.js";
import { streamingSpeak } from "./core/audio/streaming-tts.js";
import { createDiscoverTool } from "./tools/discover.js";
import { createReadAloudTool } from "./tools/read-aloud.js";
import { createDictationTool } from "./tools/dictation.js";
import { createSetPolicyTool } from "./tools/set-policy.js";
import { startRecording, isRecordingAvailable, type RecorderHandle } from "./core/audio/recorder.js";
import { VoiceLogger } from "./ui/logger.js";

// ── BridgeAPI (minimal interface) ─────────────────────────────────────────────

export interface BridgeAPI {
  registerTools(extensionId: string, tools: ExtensionToolDefinition[]): vscode.Disposable;
  publishState(extensionId: string, state: Record<string, unknown>): void;
}

// ── Dependency injection seam (for testing) ───────────────────────────────────

export interface VoiceActivateDeps {
  sttProvider?: SttProvider;
  ttsProvider?: TtsProvider;
}

// ── Module globals ────────────────────────────────────────────────────────────

let _ttsProvider: TtsProvider | undefined;

// ── Push-to-talk toggle state ─────────────────────────────────────────────────

interface DictationState {
  /** Whether dictation recording is currently active. */
  active: boolean;
  /** Cancel the in-flight recording when command toggles off. */
  stop?: () => Promise<void>;
  /** Preferred editor target to insert transcript into. */
  targetEditor?: vscode.TextEditor;
}

type VoiceInputTarget = "focus-text-input" | "agent-conversation";

function buildReadyChimePcm(sampleRate = 22050, durationMs = 140, frequencyHz = 880): Uint8Array {
  const totalSamples = Math.max(1, Math.floor((sampleRate * durationMs) / 1000));
  const data = new Int16Array(totalSamples);
  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate;
    const fade = Math.min(1, i / 260) * Math.min(1, (totalSamples - i) / 260);
    const secondTone = Math.sin(2 * Math.PI * (frequencyHz * 1.33) * t) * 0.35;
    const value = (Math.sin(2 * Math.PI * frequencyHz * t) + secondTone) * 0.28 * fade;
    data[i] = Math.round(value * 32767);
  }
  return new Uint8Array(data.buffer);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function publishVoiceState(
  bridge: BridgeAPI,
  sessionFsm: SessionFsm,
  audioFsm: AudioFsm,
  narrationFsm: NarrationFsm,
  sttAvailable: boolean,
  ttsAvailable: boolean,
): void {
  bridge.publishState("accordo-voice", {
    session: sessionFsm.state,
    audio: audioFsm.state,
    narration: narrationFsm.state,
    policy: sessionFsm.policy,
    sttAvailable,
    ttsAvailable,
  });
}

// ── activate ──────────────────────────────────────────────────────────────────

/**
 * Called by VS Code when the extension activates.
 * M50-EXT-01 through M50-EXT-18
 */
export async function activate(
  context: vscode.ExtensionContext,
  deps?: VoiceActivateDeps,
): Promise<void> {
  // ── Logger (output channel) ─────────────────────────────────────────────────
  const logger = new VoiceLogger();
  context.subscriptions.push(logger);
  logger.log("accordo-voice activating…");

  // ── M50-EXT-01: Read config ──────────────────────────────────────────
  const cfg = vscode.workspace.getConfiguration("accordo.voice");
  const whisperPath = cfg.get<string>("whisperPath", "whisper");
  const whisperModelFolder = cfg.get<string>("whisperModelFolder", "");
  const whisperModel = cfg.get<string>("whisperModel", "ggml-base.en.bin");
  logger.log(`config: whisperPath="${whisperPath}" modelFolder="${whisperModelFolder}" model="${whisperModel}"`);

  // ── M50-EXT-02: Create providers ────────────────────────────────────────
  const stt: SttProvider = deps?.sttProvider ?? new WhisperCppAdapter({
    binaryPath: whisperPath,
    modelFolder: whisperModelFolder,
    modelFile: whisperModel,
    log: (msg) => logger.log(`[whisper] ${msg}`),
  });

  // M50-SK: Try Sherpa (C++ runtime, ~3-6× faster) first; fall back to KokoroJS.
  let tts: TtsProvider;
  if (deps?.ttsProvider) {
    tts = deps.ttsProvider;
  } else {
    const sherpa = new SherpaSubprocessAdapter();
    if (await sherpa.isAvailable()) {
      tts = sherpa;
      logger.log("tts: using sherpa-kokoro (C++ subprocess — bypasses extension host buffer restriction)");
    } else {
      tts = new KokoroAdapter();
      logger.log("tts: sherpa model not found — using kokoro-js (JS ONNX). To enable Sherpa: download kokoro-en-v0_19 to ~/.accordo/models/kokoro-en-v0_19");
    }
  }
  _ttsProvider = tts;

  // ── M50-EXT-03: Create FSMs ────────────────────────────────────────────────
  const sessionFsm = new SessionFsm();
  const audioFsm = new AudioFsm();
  const narrationFsm = new NarrationFsm();

  // ── M50-EXT-04: Create vocabulary ─────────────────────────────────────────
  const vocabulary = new VoiceVocabulary(context.workspaceState);

  // ── M50-EXT-06: Create status bar ─────────────────────────────────────────
  const statusBar = new VoiceStatusBar();
  context.subscriptions.push(statusBar);

  // ── Shared dictation toggle (used by command AND mic button) ─────────────
  const dictState: DictationState = { active: false };
  let lastActiveEditor = vscode.window.activeTextEditor;
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor) {
        lastActiveEditor = editor;
      }
    }),
  );
  let activeNarrationPlayback: PlaybackHandle | undefined;
  let sttAvailable = false;
  let ttsAvailable = false;
  let availabilityKnown = false;
  let voiceInputTarget: VoiceInputTarget = "focus-text-input";
  let recordingReadyChime = true;
  let micPreparing = false;
  let recordingAvailableCache: boolean | undefined;
  let recorderReadyEstimateMs = 260;
  let readyChimeSound: CachedSound | undefined;
  context.subscriptions.push({ dispose: () => { void readyChimeSound?.dispose(); } });

  const bridge = vscode.extensions.getExtension<BridgeAPI>("accordo.accordo-bridge")?.exports;
  let bridgeUsable = bridge !== undefined;

  function loadPolicyFromConfiguration(): void {
    const voiceCfg = vscode.workspace.getConfiguration("accordo.voice");
    sessionFsm.updatePolicy({
      enabled: voiceCfg.get<boolean>("enabled", false),
      voice: voiceCfg.get<string>("voice", "af_sarah"),
      speed: voiceCfg.get<number>("speed", 1.0),
      language: voiceCfg.get<string>("language", "en-US"),
      narrationMode: voiceCfg.get<VoicePolicy["narrationMode"]>("narrationMode", "narrate-off"),
    });
    voiceInputTarget = voiceCfg.get<VoiceInputTarget>("inputTarget", "focus-text-input");
    recordingReadyChime = voiceCfg.get<boolean>("recordingReadyChime", false);
  }

  async function insertDictationText(text: string): Promise<boolean> {
    if (!text.trim()) return false;

    try {
      if (voiceInputTarget === "agent-conversation") {
        await vscode.commands.executeCommand("workbench.action.chat.open", {
          query: text,
          autoSend: true,
          isPartialQuery: false,
          mode: "agent",
          preserveFocus: true,
        });
        logger.log("dictation: sent to agent conversation");
        return true;
      }
      await vscode.commands.executeCommand("type", { text });
      logger.log(`dictation: inserted via focused input (mode=${voiceInputTarget})`);
      return true;
    } catch (err) {
      logger.log(`dictation: insert failed (mode=${voiceInputTarget}) — ${String(err)}`);
      if (voiceInputTarget === "agent-conversation") {
        void vscode.window.showWarningMessage(
          "Accordo Voice: couldn't send directly to chat conversation. Focus chat input manually or switch input target to focused text input.",
        );
        return false;
      }
    }

    const editor = dictState.targetEditor ?? vscode.window.activeTextEditor ?? lastActiveEditor;
    if (!editor) {
      void vscode.window.showWarningMessage(
        "Accordo Voice: no target input found. Focus an input field or editor and try again.",
      );
      return false;
    }
    await editor.edit((b) => b.insert(editor.selection.active, text));
    logger.log("dictation: inserted at editor cursor (fallback)");
    return true;
  }

  function reconcileSessionState(reason: string): void {
    const shouldEnable = sttAvailable && sessionFsm.policy.enabled;
    if (shouldEnable) {
      if (sessionFsm.state === "inactive") {
        logger.log(`session: enabling (${reason})`);
        sessionFsm.enable();
      }
    } else if (sessionFsm.state !== "inactive") {
      logger.log(`session: disabling (${reason})`);
      sessionFsm.disable();
    }
    syncUiAndState();
  }

  loadPolicyFromConfiguration();

  function syncUiAndState(): void {
    statusBar.update(sessionFsm.state, audioFsm.state, narrationFsm.state, sessionFsm.policy, micPreparing);
    panelProvider.postMessage({
      type: "stateChange",
      session: sessionFsm.state,
      audio: audioFsm.state,
      narration: narrationFsm.state,
    });
    void vscode.commands.executeCommand(
      "setContext",
      "accordo.voice.narrating",
      narrationFsm.state === "playing" || narrationFsm.state === "paused",
    );
    if (bridge && bridgeUsable && availabilityKnown) {
      try {
        publishVoiceState(bridge, sessionFsm, audioFsm, narrationFsm, sttAvailable, ttsAvailable);
      } catch (err) {
        bridgeUsable = false;
        logger.log(`bridge: publishState failed, disabling bridge integration — ${String(err)}`);
      }
    }
  }

  async function doStartDictation(): Promise<void> {
    const startTs = Date.now();
    if (sessionFsm.state !== "active") {
      if (!sessionFsm.policy.enabled) {
        void vscode.window.showWarningMessage("Accordo Voice: session inactive. Enable `accordo.voice.enabled` in settings.");
      } else {
        void vscode.window.showWarningMessage("Accordo Voice: session inactive. Check STT provider availability.");
      }
      return;
    }
    if (dictState.active) return; // already recording
    dictState.active = true; // lock before any await to block concurrent calls
    dictState.targetEditor = vscode.window.activeTextEditor ?? lastActiveEditor;
    logger.log("dictation: starting…");

    if (recordingAvailableCache === undefined) {
      const checkStart = Date.now();
      recordingAvailableCache = await isRecordingAvailable();
      logger.log(`dictation: sox availability check took ${String(Date.now() - checkStart)}ms`);
    }
    const soxAvail = recordingAvailableCache;
    if (!soxAvail) {
      dictState.active = false; // unlock — aborting
      logger.log("dictation: sox not found");
      void vscode.window.showWarningMessage("Accordo Voice: sox not found. Install via `brew install sox`.");
      return;
    }

    let handle: RecorderHandle;
    try {
      micPreparing = true;
      syncUiAndState();

      // 1. Play the ready chime BEFORE starting sox.
      //    This avoids any CoreAudio input/output session conflict and
      //    means no chime audio ever bleeds into the microphone capture.
      if (recordingReadyChime) {
        if (!readyChimeSound) {
          readyChimeSound = await createCachedSound(
            buildReadyChimePcm(), 22050,
            { log: (msg) => logger.log(msg) },
          );
        }
        await readyChimeSound.play();
        logger.log("dictation: chime done");
      }

      // 2. Start sox and wait until it's capturing.
      const soxStartTs = Date.now();
      handle = startRecording(16000, (msg) => logger.log(`[rec] ${msg}`));
      await handle.waitUntilReady();
      const readyMs = Date.now() - soxStartTs;
      logger.log(`dictation: recorder ready after ${String(readyMs)}ms`);
      recorderReadyEstimateMs = Math.round((recorderReadyEstimateMs * 0.7) + (readyMs * 0.3));
      logger.log(`dictation: recorder ready estimate updated to ${String(recorderReadyEstimateMs)}ms`);

      sessionFsm.pushToTalkStart();
      audioFsm.startCapture();
      micPreparing = false;
      syncUiAndState();
      logger.log(`dictation: recording started (total startup ${String(Date.now() - startTs)}ms)`);
    } catch (err) {
      micPreparing = false;
      dictState.active = false;
      dictState.targetEditor = undefined;
      syncUiAndState();
      logger.log(`dictation: failed to start recorder — ${String(err)}`);
      void vscode.window.showErrorMessage(`Accordo Voice: failed to start recording — ${String(err)}`);
      return;
    }
    dictState.stop = async () => {
      if (!dictState.active) return;
      dictState.active = false;

      audioFsm.stopCapture();
      const pcm = await handle.stop();
      logger.log(`dictation: recording stopped, pcmBytes=${pcm.byteLength}`);

      try {
        logger.log("dictation: sending to whisper…");
        const result = await stt.transcribe({ audio: pcm, sampleRate: 16000, language: sessionFsm.policy.language });
        audioFsm.transcriptReady();
        sessionFsm.pushToTalkEnd();

        const text = vocabulary.process(result.text);
        logger.log(`dictation: transcript="${text.slice(0, 120)}"`);
        if (!text.trim()) {
          logger.log("dictation: empty transcript — nothing inserted");
        } else {
          await insertDictationText(text);
        }
      } catch (err) {
        logger.log(`dictation: error — ${String(err)}`);
        audioFsm.error();
        audioFsm.reset();
        sessionFsm.pushToTalkEnd();
        void vscode.window.showErrorMessage(`Accordo Voice: transcription failed — ${String(err)}`);
      } finally {
        micPreparing = false;
        dictState.stop = undefined;
        dictState.targetEditor = undefined;
      }

      syncUiAndState();
    };
  }

  async function doStopDictation(): Promise<void> {
    if (dictState.stop) await dictState.stop();
  }

  async function doToggleDictation(): Promise<void> {
    if (dictState.active) {
      await doStopDictation();
    } else {
      await doStartDictation();
    }
  }

  async function doReadAloud(): Promise<void> {
    if (activeNarrationPlayback?.isPlaying()) {
      void vscode.window.showInformationMessage("Accordo Voice: narration is already playing.");
      return;
    }
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.selection.isEmpty) {
      void vscode.window.showInformationMessage("Accordo Voice: select text first to read aloud.");
      return;
    }
    const text = editor.document.getText(editor.selection);
    if (!text.trim()) return;

    const available = await tts.isAvailable();
    if (!available) {
      void vscode.window.showWarningMessage("Accordo Voice: TTS provider not available.");
      return;
    }

    const policy = sessionFsm.policy;
    const cleaned = cleanTextForNarration(text, "narrate-full");
    const effectiveMode =
      policy.narrationMode === "narrate-off" ? "narrate-everything" : policy.narrationMode;

    narrationFsm.enqueue({ text: cleaned, mode: effectiveMode });
    narrationFsm.startProcessing();
    syncUiAndState();

    try {
      const result = await tts.synthesize({ text: cleaned, language: policy.language, voice: policy.voice, speed: policy.speed });
      narrationFsm.audioReady();
      syncUiAndState();
      activeNarrationPlayback = await startPcmPlayback(result.audio, result.sampleRate ?? 22050);
      await activeNarrationPlayback.waitForExit();
      activeNarrationPlayback = undefined;
      narrationFsm.complete();
    } catch (err) {
      activeNarrationPlayback = undefined;
      narrationFsm.error();
      void vscode.window.showErrorMessage(`Accordo Voice: narration failed — ${String(err)}`);
    }

    syncUiAndState();
  }

  async function doTestTts(): Promise<void> {
    logger.log("smoke: tts test invoked");
    if (dictState.active) {
      void vscode.window.showWarningMessage("Accordo Voice: stop dictation before running TTS test.");
      return;
    }
    if (activeNarrationPlayback?.isPlaying()) {
      void vscode.window.showWarningMessage("Accordo Voice: narration already playing.");
      return;
    }
    const available = await tts.isAvailable();
    if (!available) {
      void vscode.window.showWarningMessage("Accordo Voice: TTS provider not available.");
      return;
    }

    const testSentence = "Accordo voice test. If you can hear this sentence, Kokoro playback is working.";
    const policy = sessionFsm.policy;
    logger.log("smoke: tts test starting");
    try {
      const result = await tts.synthesize({
        text: testSentence,
        language: policy.language,
        voice: policy.voice,
        speed: policy.speed,
      });
      await playPcmAudio(result.audio, result.sampleRate ?? 22050);
      logger.log("smoke: tts test completed");
      void vscode.window.showInformationMessage("Accordo Voice: TTS smoke test passed.");
    } catch (err) {
      logger.log(`smoke: tts test failed — ${String(err)}`);
      void vscode.window.showErrorMessage(`Accordo Voice: TTS smoke test failed — ${String(err)}`);
    }
  }

  async function doTestStt(): Promise<void> {
    logger.log("smoke: stt test invoked");
    if (dictState.active) {
      void vscode.window.showWarningMessage("Accordo Voice: stop dictation before running STT test.");
      return;
    }
    if (activeNarrationPlayback?.isPlaying()) {
      void vscode.window.showWarningMessage("Accordo Voice: narration already playing.");
      return;
    }
    const sttOk = await stt.isAvailable();
    if (!sttOk) {
      void vscode.window.showWarningMessage("Accordo Voice: STT provider not available.");
      return;
    }
    const ttsOk = await tts.isAvailable();
    if (!ttsOk) {
      void vscode.window.showWarningMessage("Accordo Voice: STT smoke test requires Kokoro to generate sample audio.");
      return;
    }

    const policy = sessionFsm.policy;
    const sampleText = "This is a whisper smoke test generated by Kokoro.";
    logger.log("smoke: stt test starting");
    try {
      const ttsResult = await tts.synthesize({
        text: sampleText,
        language: policy.language,
        voice: policy.voice,
        speed: 1.0,
      });
      const sttResult = await stt.transcribe({
        audio: ttsResult.audio,
        sampleRate: ttsResult.sampleRate ?? 22050,
        language: policy.language,
      });
      const transcript = sttResult.text.trim();
      logger.log(`smoke: stt test transcript="${transcript.slice(0, 120)}"`);
      if (transcript.length === 0) {
        void vscode.window.showWarningMessage("Accordo Voice: STT test ran but transcript is empty.");
      } else {
        void vscode.window.showInformationMessage(`Accordo Voice: STT smoke test transcript: ${transcript}`);
      }
    } catch (err) {
      logger.log(`smoke: stt test failed — ${String(err)}`);
      void vscode.window.showErrorMessage(`Accordo Voice: STT smoke test failed — ${String(err)}`);
    }
  }

  async function doStopNarration(): Promise<void> {
    if (activeNarrationPlayback?.isPlaying()) {
      await activeNarrationPlayback.stop();
      activeNarrationPlayback = undefined;
    }
    narrationFsm.error();
    syncUiAndState();
  }

  async function doPauseNarration(): Promise<void> {
    if (!activeNarrationPlayback?.isPlaying()) return;
    const paused = await activeNarrationPlayback.pause();
    if (!paused) {
      void vscode.window.showInformationMessage("Accordo Voice: pause is not supported on this platform.");
      return;
    }
    narrationFsm.pause();
    syncUiAndState();
  }

  async function doResumeNarration(): Promise<void> {
    if (!activeNarrationPlayback?.isPlaying()) return;
    const resumed = await activeNarrationPlayback.resume();
    if (!resumed) {
      void vscode.window.showInformationMessage("Accordo Voice: resume is not supported on this platform.");
      return;
    }
    narrationFsm.resume();
    syncUiAndState();
  }

  // ── M50-EXT-05: Register webview provider ─────────────────────────────────
  const panelProvider = new VoicePanelProvider({
    onMicToggle: () => { void doToggleDictation(); },
    onStopNarration: () => { void doStopNarration(); },
    onTestTts: () => { void doTestTts(); },
    onTestStt: () => { void doTestStt(); },
  });
  const panelDisposable = vscode.window.registerWebviewViewProvider(
    VoicePanelProvider.VIEW_TYPE,
    panelProvider,
  );
  context.subscriptions.push(panelDisposable);

  // ── M50-EXT-10: Register commands ─────────────────────────────────────────
  // startDictation toggles: first press starts, second press stops+transcribes.
  const commandDisposables = [
    vscode.commands.registerCommand("accordo.voice.startDictation", () => {
      void doToggleDictation();
    }),
    vscode.commands.registerCommand("accordo.voice.readAloud", () => {
      void doReadAloud();
    }),
    vscode.commands.registerCommand("accordo.voice.testTts", () => {
      void doTestTts();
    }),
    vscode.commands.registerCommand("accordo.voice.testStt", () => {
      void doTestStt();
    }),
    vscode.commands.registerCommand("accordo.voice.stopNarration", () => {
      void doStopNarration();
    }),
    vscode.commands.registerCommand("accordo.voice.pauseNarration", () => {
      void doPauseNarration();
    }),
    vscode.commands.registerCommand("accordo.voice.resumeNarration", () => {
      void doResumeNarration();
    }),
    vscode.commands.registerCommand("accordo.voice.configure", () => {
      void vscode.commands.executeCommand(
        "workbench.action.openSettings",
        "@ext:accordo.accordo-voice",
      );
    }),
  ];
  context.subscriptions.push(...commandDisposables);

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration("accordo.voice")) return;
      loadPolicyFromConfiguration();
      logger.log("config: accordo.voice changed");
      if (availabilityKnown) {
        reconcileSessionState("config-change");
      } else {
        syncUiAndState();
      }
    }),
  );

  if (bridge) {
    try {
      // ── M50-EXT-12: Register MCP tools ──────────────────────────────────────
      const tools: ExtensionToolDefinition[] = [
        createDiscoverTool({ sessionFsm, audioFsm, narrationFsm, sttProvider: stt, ttsProvider: tts }),
        createReadAloudTool({
          sessionFsm,
          narrationFsm,
          ttsProvider: tts,
          cleanText: cleanTextForNarration,
          playAudio: (pcm, sampleRate) => playPcmAudio(pcm, sampleRate),
          streamSpeak: streamingSpeak,
          log: (msg) => logger.log(msg),
        }),
        createDictationTool({
          sessionFsm,
          audioFsm,
          sttProvider: stt,
          vocabulary,
          startRecording: (sampleRate) => startRecording(sampleRate, (msg) => logger.log(`[rec-tool] ${msg}`)),
          insertText: async (text) => {
            await insertDictationText(text);
          },
        }),
        createSetPolicyTool({
          sessionFsm,
          updateConfig: (key, value, target) =>
            vscode.workspace.getConfiguration().update(key, value, target),
        }),
      ];

      const toolsDisposable = bridge.registerTools("accordo.accordo-voice", tools);
      context.subscriptions.push(toolsDisposable);

      // ── M50-EXT-13: Publish initial state ─────────────────────────────────────
      // Publish with placeholders first, then real values after availability check
      publishVoiceState(bridge, sessionFsm, audioFsm, narrationFsm, false, false);
    } catch (err) {
      bridgeUsable = false;
      logger.log(`bridge: registerTools failed, continuing without bridge integration — ${String(err)}`);
      void vscode.window.showWarningMessage("Accordo Voice: bridge connection is not ready yet. Voice local controls remain available.");
    }

    // ── M50-EXT-07: Background availability check ─────────────────────────────
    void Promise.all([stt.isAvailable(), tts.isAvailable()]).then(
      ([sttAvailValue, ttsAvailValue]) => {
        sttAvailable = sttAvailValue;
        ttsAvailable = ttsAvailValue;
        availabilityKnown = true;
        logger.log(`availability: stt=${String(sttAvailable)} tts=${String(ttsAvailable)}`);
        if (!sttAvailable) {
          logger.log("STT unavailable — session stays inactive");
          void vscode.window.showWarningMessage(
            `Accordo Voice: Whisper not found at "${whisperPath}". Set accordo.voice.whisperPath in settings.`,
          );
        } else if (!sessionFsm.policy.enabled) {
          logger.log("STT available but policy disabled — session stays inactive");
        }
        if (!ttsAvailable) {
          logger.log("TTS (kokoro) unavailable — read-aloud disabled");
        } else {
          // M50-EXT-07: Pre-load the ONNX model now so the first readAloud
          // tool call doesn't incur the 3-5 s model-load latency.
          logger.log("tts: starting ONNX model pre-warm");
          void Promise.resolve(
            tts.synthesize({
              text: ".",
              language: sessionFsm.policy.language,
              voice: sessionFsm.policy.voice,
              speed: 1.0,
            }),
          )
            .then(() => {
              logger.log("tts: ONNX model pre-warm complete");
            })
            .catch((err: unknown) => {
              logger.log(`tts: pre-warm failed (non-fatal) — ${String(err)}`);
            });
        }
        reconcileSessionState("availability-check");
      },
    );
  } else {
    // ── M50-EXT-18: Graceful degradation ──────────────────────────────────────
    // No bridge — still wire commands, status bar, and webview.
    void Promise.all([stt.isAvailable(), tts.isAvailable()]).then(([sttAvailValue, ttsAvailValue]) => {
      sttAvailable = sttAvailValue;
      ttsAvailable = ttsAvailValue;
      availabilityKnown = true;
      logger.log(`availability (no-bridge): stt=${String(sttAvailable)} tts=${String(ttsAvailable)}`);
      if (!sttAvailable) {
        void vscode.window.showWarningMessage(
          `Accordo Voice: Whisper not found at "${whisperPath}". Set accordo.voice.whisperPath in settings.`,
        );
      }
      if (ttsAvailable) {
        // Pre-load ONNX model so the first read-aloud command is instant.
        logger.log("tts: starting ONNX model pre-warm (no-bridge)");
        void Promise.resolve(
          tts.synthesize({
            text: ".",
            language: sessionFsm.policy.language,
            voice: sessionFsm.policy.voice,
            speed: 1.0,
          }),
        )
          .then(() => {
            logger.log("tts: ONNX model pre-warm complete (no-bridge)");
          })
          .catch((err: unknown) => {
            logger.log(`tts: pre-warm failed (non-fatal, no-bridge) — ${String(err)}`);
          });
      }
      reconcileSessionState("availability-check-no-bridge");
    });
  }
}

// ── deactivate ────────────────────────────────────────────────────────────────

/** M50-EXT-16 */
export async function deactivate(): Promise<void> {
  await _ttsProvider?.dispose();
  _ttsProvider = undefined;
}
