/**
 * voice-bootstrap.ts — VS Code ceremony layer (minimal TTS-only).
 *
 * Allowed to import from `vscode`. Contains config reading,
 * policy loading, and bridge state publishing.
 *
 * M50-EXT (bootstrap — no STT/UI for minimal voice)
 */

import * as vscode from "vscode";
import type { SessionFsm } from "./core/fsm/session-fsm.js";
import type { BridgeAPI } from "./extension.js";
import type { TtsProvider } from "./core/providers/tts-provider.js";

// ── loadPolicyFromConfiguration ───────────────────────────────────────────────

/**
 * Reads voice policy config and calls sessionFsm.updatePolicy.
 */
export function loadPolicyFromConfiguration(sessionFsm: SessionFsm): void {
  const voiceCfg = vscode.workspace.getConfiguration("accordo.voice");
  sessionFsm.updatePolicy({
    enabled: voiceCfg.get<boolean>("enabled", false),
    voice: voiceCfg.get<string>("voice", "af_sarah"),
    speed: voiceCfg.get<number>("speed", 1.0),
    language: voiceCfg.get<string>("language", "en-US"),
    narrationMode: voiceCfg.get<"narrate-off" | "narrate-everything" | "narrate-summary">("narrationMode", "narrate-off"),
  });
}

// ── publishVoiceState ─────────────────────────────────────────────────────────

/**
 * Publishes minimal voice state to the bridge.
 */
export function publishVoiceState(
  bridge: BridgeAPI,
  sessionFsm: SessionFsm,
  ttsAvailable: boolean,
): void {
  bridge.publishState("accordo-voice", {
    policy: sessionFsm.policy,
    ttsAvailable,
  });
}

// ── syncUiAndState ────────────────────────────────────────────────────────────

/**
 * Synchronizes the VS Code context and bridge state.
 */
export function syncUiAndState(
  sessionFsm: SessionFsm,
  narrationFsm: { state: string },
  bridge: BridgeAPI | undefined,
  ttsProvider: TtsProvider,
  log?: (msg: string) => void,
): void {
  void vscode.commands.executeCommand(
    "setContext",
    "accordo.voice.narrating",
    narrationFsm.state === "playing" || narrationFsm.state === "paused",
  );

  if (bridge) {
    Promise.resolve(ttsProvider.isAvailable())
      .then((ttsAvail) => {
        try {
          publishVoiceState(bridge, sessionFsm, ttsAvail);
        } catch (err) {
          log?.(`bridge: publishVoiceState failed (transient) — ${String(err)}`);
        }
      })
      .catch(() => {/* best-effort */});
  }
}
