/**
 * voice-bootstrap.ts — VS Code ceremony layer.
 *
 * Allowed to import from `vscode` and `./ui/*`. Contains config reading,
 * policy loading, UI synchronization, and bridge state publishing.
 *
 * M50-EXT (bootstrap split)
 */

import * as vscode from "vscode";
import type { SessionFsm } from "./core/fsm/session-fsm.js";
import type { AudioFsm } from "./core/fsm/audio-fsm.js";
import type { NarrationFsm } from "./core/fsm/narration-fsm.js";
import type { VoicePolicy } from "./core/fsm/types.js";
import type { VoiceStatusBar } from "./ui/status-bar.js";
import type { VoicePanelProvider } from "./ui/voice-panel.js";
import type { BridgeAPI } from "./extension.js";

// ── VoiceBootstrapConfig ──────────────────────────────────────────────────────

export interface VoiceBootstrapConfig {
  enabled: boolean;
  voice: string;
  speed: number;
  language: string;
  narrationMode: VoicePolicy["narrationMode"];
  sttProvider: string;
  whisperPath: string;
  whisperModelFolder: string;
  whisperModel: string;
  fasterWhisperUrl: string;
  fasterWhisperModel: string;
  inputTarget: "focus-text-input" | "agent-conversation";
  recordingReadyChime: boolean;
}

// ── readVoiceConfig ───────────────────────────────────────────────────────────

/**
 * Reads all voice configuration from VS Code workspace settings.
 * REQ-VB-01, REQ-VB-02
 */
export function readVoiceConfig(
  _context: vscode.ExtensionContext,
): VoiceBootstrapConfig {
  const cfg = vscode.workspace.getConfiguration("accordo.voice");
  return {
    enabled: cfg.get<boolean>("enabled", false),
    voice: cfg.get<string>("voice", "af_sarah"),
    speed: cfg.get<number>("speed", 1.0),
    language: cfg.get<string>("language", "en-US"),
    narrationMode: cfg.get<VoicePolicy["narrationMode"]>("narrationMode", "narrate-off"),
    sttProvider: cfg.get<string>("sttProvider", "faster-whisper-http"),
    whisperPath: cfg.get<string>("whisperPath", "whisper"),
    whisperModelFolder: cfg.get<string>("whisperModelFolder", ""),
    whisperModel: cfg.get<string>("whisperModel", "ggml-base.en.bin"),
    fasterWhisperUrl: cfg.get<string>("fasterWhisperUrl", "http://localhost:8280"),
    fasterWhisperModel: cfg.get<string>("fasterWhisperModel", "Systran/faster-whisper-small"),
    inputTarget: cfg.get<"focus-text-input" | "agent-conversation">("inputTarget", "focus-text-input"),
    recordingReadyChime: cfg.get<boolean>("recordingReadyChime", false),
  };
}

// ── loadPolicyFromConfiguration ───────────────────────────────────────────────

/**
 * Reads voice policy config and calls sessionFsm.updatePolicy.
 * REQ-VB-03, REQ-VB-04
 */
export function loadPolicyFromConfiguration(sessionFsm: SessionFsm): void {
  const voiceCfg = vscode.workspace.getConfiguration("accordo.voice");
  sessionFsm.updatePolicy({
    enabled: voiceCfg.get<boolean>("enabled", false),
    voice: voiceCfg.get<string>("voice", "af_sarah"),
    speed: voiceCfg.get<number>("speed", 1.0),
    language: voiceCfg.get<string>("language", "en-US"),
    narrationMode: voiceCfg.get<VoicePolicy["narrationMode"]>("narrationMode", "narrate-off"),
  });
}

// ── updateStatusBar ───────────────────────────────────────────────────────────

/**
 * Updates the status bar from current FSM states.
 * REQ-VB-05
 */
export function updateStatusBar(
  statusBar: VoiceStatusBar,
  sessionFsm: SessionFsm,
  audioFsm: AudioFsm,
  narrationFsm: NarrationFsm,
  micPreparing: boolean,
): void {
  statusBar.update(
    sessionFsm.state,
    audioFsm.state,
    narrationFsm.state,
    sessionFsm.policy,
    micPreparing,
  );
}

// ── publishVoiceState ─────────────────────────────────────────────────────────

/**
 * Publishes current voice state to the bridge.
 * REQ-VB-11, REQ-VB-12
 */
export function publishVoiceState(
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

// ── syncUiAndState ────────────────────────────────────────────────────────────

/**
 * Synchronizes the status bar, panel, VS Code context, and bridge state.
 * REQ-VB-06 through REQ-VB-10
 */
export function syncUiAndState(
  sessionFsm: SessionFsm,
  audioFsm: AudioFsm,
  narrationFsm: NarrationFsm,
  statusBar: VoiceStatusBar,
  panelProvider: VoicePanelProvider,
  bridge: BridgeAPI | undefined,
  availabilityKnown: boolean,
  micPreparing = false,
  sttAvailable = false,
  ttsAvailable = false,
  log?: (msg: string) => void,
): void {
  updateStatusBar(statusBar, sessionFsm, audioFsm, narrationFsm, micPreparing);

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

  if (bridge && availabilityKnown) {
    try {
      publishVoiceState(bridge, sessionFsm, audioFsm, narrationFsm, sttAvailable, ttsAvailable);
    } catch (err) {
      log?.(`bridge: publishVoiceState failed (transient) — ${String(err)}`);
    }
  }
}
