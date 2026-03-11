/**
 * subtitle-bar.ts
 *
 * ScriptSubtitleBar: a VS Code StatusBarItem that displays subtitle text
 * produced by subtitle steps (and as a fallback when voice is unavailable).
 *
 * M52-SUB — Subtitle Bar
 */

import * as vscode from "vscode";

export class ScriptSubtitleBar {
  private _item: vscode.StatusBarItem;
  private _clearTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    this._item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 500);
    this._item.tooltip = "Accordo Script \u2014 subtitle";
  }

  /**
   * Show text in the status bar, auto-clearing after durationMs.
   *
   * M52-SUB-01 through M52-SUB-07
   */
  show(text: string, durationMs: number): void {
    if (this._clearTimer !== undefined) {
      clearTimeout(this._clearTimer);
      this._clearTimer = undefined;
    }
    this._item.text = `$(comment) ${text}`;
    this._item.show();
    this._clearTimer = setTimeout(() => {
      this._item.hide();
      this._clearTimer = undefined;
    }, durationMs);
  }

  /**
   * Immediately clear and hide the subtitle bar.
   */
  clear(): void {
    if (this._clearTimer !== undefined) {
      clearTimeout(this._clearTimer);
      this._clearTimer = undefined;
    }
    this._item.hide();
  }

  /** Release the underlying StatusBarItem. */
  dispose(): void {
    this.clear();
    this._item.dispose();
  }
}
