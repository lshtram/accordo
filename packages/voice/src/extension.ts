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
import { SessionFsm } from "./core/fsm/session-fsm.js";
import { AudioFsm } from "./core/fsm/audio-fsm.js";
import { NarrationFsm } from "./core/fsm/narration-fsm.js";
import { VoiceVocabulary } from "./text/vocabulary.js";
import { VoiceStatusBar } from "./ui/status-bar.js";
import { VoicePanelProvider } from "./ui/voice-panel.js";
import { cleanTextForNarration } from "./text/text-cleaner.js";
import { playPcmAudio } from "./core/audio/playback.js";
import { createDiscoverTool } from "./tools/discover.js";
import { createReadAloudTool } from "./tools/read-aloud.js";
import { createDictationTool } from "./tools/dictation.js";
import { createSetPolicyTool } from "./tools/set-policy.js";

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
  // ── M50-EXT-01: Read config ────────────────────────────────────────────────
  const cfg = vscode.workspace.getConfiguration("accordo.voice");

  // ── M50-EXT-02: Create providers ──────────────────────────────────────────
  const stt: SttProvider = deps?.sttProvider ?? new WhisperCppAdapter({
    binaryPath: cfg.get<string>("whisperPath", "whisper"),
    modelFolder: cfg.get<string>("whisperModelFolder", ""),
    modelFile: cfg.get<string>("whisperModel", "ggml-base.en.bin"),
  });

  const tts: TtsProvider = deps?.ttsProvider ?? new KokoroAdapter();
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

  // ── M50-EXT-05: Register webview provider ─────────────────────────────────
  const panelProvider = new VoicePanelProvider({
    onMicDown: () => {
      if (sessionFsm.state === "active") sessionFsm.pushToTalkStart();
    },
    onMicUp: () => {
      if (sessionFsm.state === "suspended") sessionFsm.pushToTalkEnd();
    },
    onStopNarration: () => {
      narrationFsm.error();
    },
  });
  const panelDisposable = vscode.window.registerWebviewViewProvider(
    VoicePanelProvider.VIEW_TYPE,
    panelProvider,
  );
  context.subscriptions.push(panelDisposable);

  // ── M50-EXT-10: Register commands ─────────────────────────────────────────
  const commandDisposables = [
    vscode.commands.registerCommand("accordo.voice.startDictation", () => {
      // handled by dictation tool
    }),
    vscode.commands.registerCommand("accordo.voice.readAloud", () => {
      // handled by readAloud tool
    }),
    vscode.commands.registerCommand("accordo.voice.stopNarration", () => {
      narrationFsm.error();
    }),
    vscode.commands.registerCommand("accordo.voice.pauseNarration", () => {
      narrationFsm.pause();
    }),
    vscode.commands.registerCommand("accordo.voice.resumeNarration", () => {
      narrationFsm.resume();
    }),
    vscode.commands.registerCommand("accordo.voice.configure", () => {
      // open settings
    }),
  ];
  context.subscriptions.push(...commandDisposables);

  // ── M50-EXT-11: Acquire BridgeAPI ─────────────────────────────────────────
  const bridge = vscode.extensions.getExtension<BridgeAPI>("accordo.accordo-bridge")?.exports;

  if (bridge) {
    // ── M50-EXT-12: Register MCP tools ──────────────────────────────────────
    const tools: ExtensionToolDefinition[] = [
      createDiscoverTool({ sessionFsm, audioFsm, narrationFsm, sttProvider: stt, ttsProvider: tts }),
      createReadAloudTool({
        sessionFsm,
        narrationFsm,
        ttsProvider: tts,
        cleanText: cleanTextForNarration,
        playAudio: (pcm, sampleRate) => playPcmAudio(pcm, sampleRate),
      }),
      createDictationTool({
        sessionFsm,
        audioFsm,
        sttProvider: stt,
        vocabulary,
        startRecording: () => ({ stop: async () => new Uint8Array([]) }),
        insertText: async (text) => {
          const editor = vscode.window.activeTextEditor;
          if (editor) {
            await editor.edit((b) => b.insert(editor.selection.active, text));
          }
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

    // ── M50-EXT-07: Background availability check ─────────────────────────────
    void Promise.all([stt.isAvailable(), tts.isAvailable()]).then(
      ([sttAvail, ttsAvail]) => {
        if (sttAvail && ttsAvail) {
          // ── M50-EXT-08: Providers available ─────────────────────────────────
          sessionFsm.enable();
          statusBar.update(sessionFsm.state, audioFsm.state, narrationFsm.state, sessionFsm.policy);
        } else {
          // ── M50-EXT-09: Providers unavailable ───────────────────────────────
          vscode.window.showWarningMessage(
            "Accordo Voice: providers not available. Install Whisper.cpp and kokoro-js.",
          );
          statusBar.update("inactive", "idle", "idle");
        }

        // ── M50-EXT-15: Set context key ────────────────────────────────────
        void vscode.commands.executeCommand(
          "setContext",
          "accordo.voice.narrating",
          narrationFsm.state === "playing",
        );

        publishVoiceState(bridge, sessionFsm, audioFsm, narrationFsm, sttAvail, ttsAvail);
      },
    );
  } else {
    // ── M50-EXT-18: Graceful degradation ──────────────────────────────────────
    // No bridge — still wire commands, status bar, and webview.
    void Promise.all([stt.isAvailable(), tts.isAvailable()]).then(([sttAvail, ttsAvail]) => {
      if (!sttAvail || !ttsAvail) {
        vscode.window.showWarningMessage(
          "Accordo Voice: providers not available. Install Whisper.cpp and kokoro-js.",
        );
        statusBar.update("inactive", "idle", "idle");
      } else {
        sessionFsm.enable();
        statusBar.update(sessionFsm.state, audioFsm.state, narrationFsm.state, sessionFsm.policy);
      }
    });
  }
}

// ── deactivate ────────────────────────────────────────────────────────────────

/** M50-EXT-16 */
export async function deactivate(): Promise<void> {
  await _ttsProvider?.dispose();
  _ttsProvider = undefined;
}
