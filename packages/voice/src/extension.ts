/**
 * accordo-voice — VS Code Extension entry point.
 *
 * Thin orchestration layer: reads config, wires providers/FSMs/UI, delegates
 * all logic to voice-adapters, voice-bootstrap, and voice-runtime.
 *
 * M50-EXT
 */

import * as vscode from "vscode";
import type { ExtensionToolDefinition } from "@accordo/bridge-types";
import type { SttProvider } from "./core/providers/stt-provider.js";
import type { TtsProvider } from "./core/providers/tts-provider.js";
import { SessionFsm } from "./core/fsm/session-fsm.js";
import { AudioFsm } from "./core/fsm/audio-fsm.js";
import { NarrationFsm } from "./core/fsm/narration-fsm.js";
import { VoiceVocabulary } from "./text/vocabulary.js";
import { VoiceStatusBar } from "./ui/status-bar.js";
import { VoicePanelProvider } from "./ui/voice-panel.js";
import { cleanTextForNarration } from "./text/text-cleaner.js";
import { playPcmAudio, startPcmPlayback, type PlaybackHandle } from "./core/audio/playback.js";
import { streamingSpeak } from "./core/audio/streaming-tts.js";
import { createDiscoverTool } from "./tools/discover.js";
import { createReadAloudTool } from "./tools/read-aloud.js";
import { createDictationTool } from "./tools/dictation.js";
import { createSetPolicyTool } from "./tools/set-policy.js";
import { startRecording, isRecordingAvailable } from "./core/audio/recorder.js";
import { VoiceLogger } from "./ui/logger.js";
import { createSttProvider, createTtsProvider } from "./voice-adapters.js";
import { loadPolicyFromConfiguration, syncUiAndState, publishVoiceState } from "./voice-bootstrap.js";
import { reconcileSessionState, doToggleDictation, buildInsertTextCallback, type VoiceRuntimeState } from "./voice-runtime.js";
import {
  doReadAloud, doTestTts, doTestStt, doSpeakText, doStopNarration, doPauseNarration, doResumeNarration,
  type NarrationDeps,
} from "./voice-narration.js";

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

// ── activate ──────────────────────────────────────────────────────────────────

/**
 * Called by VS Code when the extension activates.
 * M50-EXT-01 through M50-EXT-18
 */
export async function activate(
  context: vscode.ExtensionContext,
  deps?: VoiceActivateDeps,
): Promise<void> {
  const logger = new VoiceLogger();
  context.subscriptions.push(logger);
  logger.log("accordo-voice activating…");

  // ── M50-EXT-01: Read config ────────────────────────────────────────────────
  const cfg = vscode.workspace.getConfiguration("accordo.voice");
  const sttProviderName = cfg.get<string>("sttProvider", "faster-whisper-http");
  const whisperPath = cfg.get<string>("whisperPath", "whisper");
  const fasterWhisperUrl = cfg.get<string>("fasterWhisperUrl", "http://localhost:8280");
  const fasterWhisperModel = cfg.get<string>("fasterWhisperModel", "Systran/faster-whisper-small");

  // ── M50-EXT-02: Create providers ──────────────────────────────────────────
  const stt: SttProvider = deps?.sttProvider ?? createSttProvider(
    sttProviderName, (msg) => logger.log(msg),
    { whisperPath, fasterWhisperUrl, fasterWhisperModel,
      whisperModelFolder: cfg.get<string>("whisperModelFolder", ""),
      whisperModel: cfg.get<string>("whisperModel", "ggml-base.en.bin") },
  );
  const tts: TtsProvider = deps?.ttsProvider ?? await createTtsProvider((msg) => logger.log(msg));
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

  // ── Shared mutable state bags ─────────────────────────────────────────────
  let activeNarrationPlayback: PlaybackHandle | undefined;
  /** Bug #14: cancel handle for the active agent-initiated streamSpeak pipeline. */
  let activeStreamCancel: (() => void) | undefined;
  let ttsAvailable = false;
  let availabilityKnown = false;

  const runtimeState: VoiceRuntimeState = {
    dictState: { active: false },
    voiceInputTarget: "focus-text-input",
    recordingReadyChime: false,
    lastActiveEditor: vscode.window.activeTextEditor,
    micPreparing: false,
    sttAvailable: false,
  };

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor) runtimeState.lastActiveEditor = editor;
    }),
  );

  const bridge = vscode.extensions.getExtension<BridgeAPI>("accordo.accordo-bridge")?.exports;

  const doSyncUiAndState = (): void => {
    syncUiAndState(
      sessionFsm, audioFsm, narrationFsm, statusBar, panelProvider, bridge,
      availabilityKnown, runtimeState.micPreparing, runtimeState.sttAvailable, ttsAvailable,
      (msg) => logger.log(msg),
    );
  };

  const runtimeDeps = {
    sessionFsm, audioFsm,
    sttProvider: stt,
    vocabulary,
    startRecording: (sampleRate: number) => startRecording(sampleRate, (msg) => logger.log(`[rec] ${msg}`)),
    isRecordingAvailable,
    syncUiAndState: doSyncUiAndState,
    insertText: buildInsertTextCallback((msg) => logger.log(msg)),
    log: (msg: string) => logger.log(msg),
  };

  function doLocalLoadPolicy(): void {
    loadPolicyFromConfiguration(sessionFsm);
    const voiceCfg = vscode.workspace.getConfiguration("accordo.voice");
    runtimeState.voiceInputTarget = voiceCfg.get<"focus-text-input" | "agent-conversation">("inputTarget", "focus-text-input");
    runtimeState.recordingReadyChime = voiceCfg.get<boolean>("recordingReadyChime", false);
  }

  doLocalLoadPolicy();

  // ── M50-EXT-05: Register webview provider ─────────────────────────────────
  const panelProvider = new VoicePanelProvider({
    onMicToggle: () => { void doToggleDictation(runtimeDeps, runtimeState); },
    onStopNarration: () => { void doStopNarration(narrationDeps); },
    onTestTts: () => { void doTestTts(narrationDeps); },
    onTestStt: () => { void doTestStt(narrationDeps); },
  });
  context.subscriptions.push(vscode.window.registerWebviewViewProvider(VoicePanelProvider.VIEW_TYPE, panelProvider));

  const narrationDeps: NarrationDeps = {
    sessionFsm, narrationFsm, sttProvider: stt, ttsProvider: tts,
    cleanTextForNarration, playPcmAudio, startPcmPlayback,
    streamingSpeak: streamingSpeak as NarrationDeps["streamingSpeak"],
    log: (msg) => logger.log(msg), syncUiAndState: doSyncUiAndState,
    dictState: runtimeState.dictState,
    getActiveNarrationPlayback: () => activeNarrationPlayback,
    setActiveNarrationPlayback: (h) => { activeNarrationPlayback = h; },
    getActiveStreamCancel: () => activeStreamCancel,
    setActiveStreamCancel: (fn) => { activeStreamCancel = fn; },
  };

  // ── M50-EXT-10: Register commands ─────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("accordo.voice.startDictation", () => { void doToggleDictation(runtimeDeps, runtimeState); }),
    vscode.commands.registerCommand("accordo.voice.readAloud", () => { void doReadAloud(narrationDeps); }),
    vscode.commands.registerCommand("accordo.voice.testTts", () => { void doTestTts(narrationDeps); }),
    vscode.commands.registerCommand("accordo.voice.testStt", () => { void doTestStt(narrationDeps); }),
    vscode.commands.registerCommand("accordo.voice.stopNarration", () => { void doStopNarration(narrationDeps); }),
    vscode.commands.registerCommand("accordo.voice.pauseNarration", () => { void doPauseNarration(narrationDeps); }),
    vscode.commands.registerCommand("accordo.voice.resumeNarration", () => { void doResumeNarration(narrationDeps); }),
    vscode.commands.registerCommand("accordo.voice.configure", () => { void vscode.commands.executeCommand("workbench.action.openSettings", "@ext:accordo.accordo-voice"); }),
    vscode.commands.registerCommand("accordo.voice.speakText", (args: { text: string; voice?: string; speed?: number; block?: boolean }) => doSpeakText(narrationDeps, args)),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration("accordo.voice")) return;
      doLocalLoadPolicy(); logger.log("config: accordo.voice changed");
      if (availabilityKnown) { reconcileSessionState(runtimeDeps, runtimeState, runtimeState.sttAvailable, "config-change"); }
      else { doSyncUiAndState(); }
    }),
  );

  if (bridge) {
    try {
      // ── M50-EXT-12: Register MCP tools ──────────────────────────────────────
      const tools: ExtensionToolDefinition[] = [
        createDiscoverTool({ sessionFsm, audioFsm, narrationFsm, sttProvider: stt, ttsProvider: tts }),
        createReadAloudTool({
          sessionFsm, narrationFsm, ttsProvider: tts, cleanText: cleanTextForNarration,
          playAudio: (pcm, sampleRate) => playPcmAudio(pcm, sampleRate),
          streamSpeak: streamingSpeak, log: (msg) => logger.log(msg),
          onSpeakActive: (cancel) => { activeStreamCancel = cancel; }, // Bug #14
        }),
        createDictationTool({
          sessionFsm, audioFsm, sttProvider: stt, vocabulary,
          startRecording: (sampleRate) => startRecording(sampleRate, (msg) => logger.log(`[rec-tool] ${msg}`)),
          insertText: async (text) => { await runtimeDeps.insertText(text); },
        }),
        createSetPolicyTool({ sessionFsm, updateConfig: (key, value, target) => vscode.workspace.getConfiguration().update(key, value, target) }),
      ];
      context.subscriptions.push(bridge.registerTools("accordo.accordo-voice", tools));
      try { publishVoiceState(bridge, sessionFsm, audioFsm, narrationFsm, false, false); }
      catch (err) { logger.log(`bridge: initial publishVoiceState failed (transient) — ${String(err)}`); }
    } catch (err) {
      logger.log(`bridge: registerTools failed (transient) — ${String(err)}`);
      void vscode.window.showWarningMessage("Accordo Voice: bridge connection is not ready yet. Voice local controls remain available.");
    }
  }

  // ── M50-EXT-07: Background availability check ──────────────────────────────
  const runAvailabilityCheck = (label: string): void => {
    void Promise.all([stt.isAvailable(), tts.isAvailable()]).then(([sttAvailValue, ttsAvailValue]) => {
      runtimeState.sttAvailable = sttAvailValue;
      ttsAvailable = ttsAvailValue; availabilityKnown = true;
      logger.log(`availability${label}: stt=${String(sttAvailValue)} tts=${String(ttsAvailValue)}`);
      if (!sttAvailValue) {
        void vscode.window.showWarningMessage(`Accordo Voice: Whisper not found at "${whisperPath}". Set accordo.voice.whisperPath in settings.`);
      }
      if (ttsAvailValue) {
        logger.log(`tts: starting ONNX model pre-warm${label}`);
        void Promise.resolve(tts.synthesize({ text: ".", language: sessionFsm.policy.language, voice: sessionFsm.policy.voice, speed: 1.0 }))
          .then(() => { logger.log(`tts: ONNX model pre-warm complete${label}`); })
          .catch((err: unknown) => { logger.log(`tts: pre-warm failed (non-fatal${label}) — ${String(err)}`); });
      }
      reconcileSessionState(runtimeDeps, runtimeState, sttAvailValue, `availability-check${label}`);
    });
  };

  if (bridge) {
    runAvailabilityCheck("");
  } else {
    runAvailabilityCheck("-no-bridge");
  }
}

// ── deactivate ────────────────────────────────────────────────────────────────

/** M50-EXT-16 */
export async function deactivate(): Promise<void> {
  await _ttsProvider?.dispose();
  _ttsProvider = undefined;
}
