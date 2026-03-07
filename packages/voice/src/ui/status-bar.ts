/**
 * VoiceStatusBar — VS Code status bar for voice state.
 *
 * M50-SB
 */

import * as vscode from "vscode";
import type { SessionState, AudioState, NarrationState, VoicePolicy } from "../core/fsm/types.js";

// ── State → display mapping ──────────────────────────────────────────────────

interface StatusDisplay {
  text: string;
  command: string;
  color?: string;
}

function resolveDisplay(
  session: SessionState,
  audio: AudioState,
  narration: NarrationState,
): StatusDisplay {
  if (session === "inactive") {
    return { text: "$(mute) Voice: Off", command: "accordo.voice.configure" };
  }

  if (audio === "error") {
    return { text: "$(error) Voice: Error", command: "accordo.voice.configure" };
  }

  if (audio === "listening") {
    return {
      text: "$(record) Voice: Recording\u2026",
      command: "accordo.voice.configure",
      color: "red",
    };
  }

  if (audio === "processing") {
    return { text: "$(loading~spin) Voice: Transcribing\u2026", command: "accordo.voice.configure" };
  }

  if (narration === "playing") {
    return { text: "$(play) Voice: Narrating\u2026", command: "accordo.voice.stopNarration" };
  }

  if (narration === "paused") {
    return { text: "$(debug-pause) Voice: Paused", command: "accordo.voice.stopNarration" };
  }

  // active + all idle
  return { text: "$(unmute) Voice: Ready", command: "accordo.voice.configure" };
}

// ── VoiceStatusBar ────────────────────────────────────────────────────────────

/** M50-SB-01 */
export class VoiceStatusBar implements vscode.Disposable {
  private readonly _item: vscode.StatusBarItem;

  /** M50-SB-02 */
  constructor() {
    this._item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this._item.show();
  }

  /**
   * Update status bar text/icon/tooltip/color/command from current FSM states.
   * M50-SB-03
   */
  update(
    session: SessionState,
    audio: AudioState,
    narration: NarrationState,
    policy?: VoicePolicy,
  ): void {
    const display = resolveDisplay(session, audio, narration);
    this._item.text = display.text;
    this._item.command = display.command;
    this._item.color = display.color;

    if (policy) {
      this._item.tooltip =
        `Voice: ${policy.voice} | Speed: ${policy.speed} | Mode: ${policy.narrationMode}`;
    }
  }

  /** M50-SB-07 */
  dispose(): void {
    this._item.dispose();
  }
}
