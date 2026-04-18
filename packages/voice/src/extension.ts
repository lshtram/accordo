/**
 * accordo-voice — VS Code Extension entry point (minimal TTS read-aloud).
 *
 * Thin orchestration layer: reads config, wires TTS provider, registers
 * readAloud tool, publishes minimal state.
 *
 * M50-EXT (simplified — no streaming/queue/stop/resume orchestration)
 */

import * as vscode from "vscode";
import type { ExtensionToolDefinition } from "@accordo/bridge-types";
import type { TtsProvider } from "./core/providers/tts-provider.js";
import { SessionFsm } from "./core/fsm/session-fsm.js";
import { NarrationFsm } from "./core/fsm/narration-fsm.js";
import { cleanTextForNarration } from "./text/text-cleaner.js";
import { playPcmAudio, startPcmPlayback, type PlaybackHandle } from "./core/audio/playback.js";
import { createReadAloudTool } from "./tools/read-aloud.js";
import { createTtsProvider } from "./voice-adapters.js";
import { loadPolicyFromConfiguration, syncUiAndState, publishVoiceState } from "./voice-bootstrap.js";

// ── BridgeAPI (minimal interface) ─────────────────────────────────────────────

export interface BridgeAPI {
  registerTools(extensionId: string, tools: ExtensionToolDefinition[]): vscode.Disposable;
  publishState(extensionId: string, state: Record<string, unknown>): void;
}

// ── Dependency injection seam (for testing) ───────────────────────────────────

export interface VoiceActivateDeps {
  ttsProvider?: TtsProvider;
  /** Injectable logger (defaults to console.log). */
  log?: (msg: string) => void;
}

// ── Module globals ───────────────────────────────────────────────────────────

let _ttsProvider: TtsProvider | undefined;

// ── activate ──────────────────────────────────────────────────────────────────

/**
 * Called by VS Code when the extension activates.
 * M50-EXT-01 through M50-EXT-10 (minimal TTS-only)
 */
export async function activate(
  context: vscode.ExtensionContext,
  deps?: VoiceActivateDeps,
): Promise<void> {
  /** No-op logger — voice emits no console output in production. */
  const log = deps?.log ?? ((): void => {});

  // ── M50-EXT-01: Read config ────────────────────────────────────────────────
  const cfg = vscode.workspace.getConfiguration("accordo.voice");

  // ── M50-EXT-02: Create TTS provider ───────────────────────────────────────
  const ttsEndpoint = cfg.get<string>("ttsEndpoint", "").trim();
  const ttsAuthToken = cfg.get<string>("ttsAuthToken", "").trim();
  const ttsModel = cfg.get<string>("ttsModel", "").trim();
  const tts: TtsProvider = deps?.ttsProvider ?? await createTtsProvider(log, ttsEndpoint, ttsAuthToken, ttsModel);
  _ttsProvider = tts;

  // ── M50-EXT-03: Create FSMs ───────────────────────────────────────────────
  const sessionFsm = new SessionFsm();
  const narrationFsm = new NarrationFsm();

  // Active playback handle for stop-narration cancellation
  let activePlayback: PlaybackHandle | undefined;

  const bridge = vscode.extensions.getExtension<BridgeAPI>("accordo.accordo-bridge")?.exports;

  const doSyncUiAndState = (): void => {
    syncUiAndState(sessionFsm, narrationFsm, bridge, tts, log);
  };

  // Ensure policy is loaded from VS Code settings
  loadPolicyFromConfiguration(sessionFsm);

  // ── M50-EXT-04: VS Code commands ─────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("accordo.voice.readAloud", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.selection.isEmpty) {
        void vscode.window.showInformationMessage("Accordo Voice: select text first to read aloud.");
        return;
      }
      const text = editor.document.getText(editor.selection);
      if (!text.trim()) return;
      if (!await tts.isAvailable()) {
        void vscode.window.showWarningMessage("Accordo Voice: TTS provider not available.");
        return;
      }
      const policy = sessionFsm.policy;
      const cleaned = cleanTextForNarration(text, "narrate-full");
      narrationFsm.enqueue({ text: cleaned, mode: policy.narrationMode });
      narrationFsm.startProcessing();
      doSyncUiAndState();
      try {
        const result = await tts.synthesize({
          text: cleaned,
          language: policy.language,
          voice: policy.voice,
          speed: policy.speed,
        });
        narrationFsm.audioReady();
        doSyncUiAndState();
        const handle = await startPcmPlayback(result.audio, result.sampleRate ?? 22050);
        activePlayback = handle;
        await handle.waitForExit();
        activePlayback = undefined;
        narrationFsm.complete();
      } catch (err) {
        activePlayback = undefined;
        narrationFsm.error();
        void vscode.window.showErrorMessage(`Accordo Voice: narration failed — ${String(err)}`);
      }
      doSyncUiAndState();
    }),

    vscode.commands.registerCommand("accordo.voice.stopNarration", async () => {
      if (activePlayback?.isPlaying()) {
        await activePlayback.stop();
        activePlayback = undefined;
      }
      narrationFsm.error();
      doSyncUiAndState();
    }),

    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration("accordo.voice")) return;
      loadPolicyFromConfiguration(sessionFsm);
    }),
  );

  // ── M50-EXT-05: Register MCP tool ─────────────────────────────────────────
  if (bridge) {
    try {
      const tools: ExtensionToolDefinition[] = [
        createReadAloudTool({
          sessionFsm,
          narrationFsm,
          ttsProvider: tts,
          cleanText: cleanTextForNarration,
          playAudio: playPcmAudio,
          log,
        }),
      ];
      context.subscriptions.push(bridge.registerTools("accordo.accordo-voice", tools));

      const ttsAvail = await tts.isAvailable();
      try {
        publishVoiceState(bridge, sessionFsm, ttsAvail);
      } catch (err) {
        log(`bridge: initial publishVoiceState failed — ${String(err)}`);
      }
    } catch (err) {
      log(`bridge: registerTools failed — ${String(err)}`);
    }
  }
}

// ── deactivate ────────────────────────────────────────────────────────────────

/** M50-EXT-06 */
export async function deactivate(): Promise<void> {
  await _ttsProvider?.dispose();
  _ttsProvider = undefined;
}
