/**
 * VoiceLogger — VS Code OutputChannel wrapper for Accordo Voice debug output.
 *
 * Usage: open "Accordo Voice" in the Output panel (View → Output).
 */

import * as vscode from "vscode";

export class VoiceLogger implements vscode.Disposable {
  private readonly _channel: vscode.OutputChannel;

  constructor() {
    this._channel = vscode.window.createOutputChannel("Accordo Voice");
  }

  log(msg: string): void {
    const ts = new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
    this._channel.appendLine(`[${ts}] ${msg}`);
  }

  /** Show the output channel panel immediately. */
  show(): void {
    this._channel.show(true);
  }

  dispose(): void {
    this._channel.dispose();
  }
}
