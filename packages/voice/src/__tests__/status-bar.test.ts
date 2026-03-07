/**
 * M50-SB — VoiceStatusBar tests (Phase B — must FAIL before implementation)
 * Coverage: M50-SB-01 through M50-SB-07
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as vscode from "vscode";
import { VoiceStatusBar } from "../ui/status-bar.js";
import { DEFAULT_VOICE_POLICY } from "../core/fsm/types.js";

describe("VoiceStatusBar", () => {
  let bar: VoiceStatusBar;

  beforeEach(() => {
    bar = new VoiceStatusBar();
  });

  it("M50-SB-01: VoiceStatusBar class is exported", () => {
    expect(typeof VoiceStatusBar).toBe("function");
  });

  it("M50-SB-02: constructor creates a StatusBarItem on Right side with priority 100", () => {
    expect(vscode.window.createStatusBarItem).toHaveBeenCalledWith(
      vscode.StatusBarAlignment.Right,
      100,
    );
  });

  it("M50-SB-02: constructor calls show() on the StatusBarItem", () => {
    const item = (vscode.window as unknown as { _getLastStatusBarItem: () => { show: () => void; text: string } })._getLastStatusBarItem();
    expect(item.show).toHaveBeenCalled();
  });

  it("M50-SB-04: inactive session → text '$(mute) Voice: Off'", () => {
    bar.update("inactive", "idle", "idle");
    const item = (vscode.window as unknown as { _getLastStatusBarItem: () => { text: string } })._getLastStatusBarItem();
    expect(item.text).toBe("$(mute) Voice: Off");
  });

  it("M50-SB-04: active session + idle states → text '$(unmute) Voice: Ready'", () => {
    bar.update("active", "idle", "idle");
    const item = (vscode.window as unknown as { _getLastStatusBarItem: () => { text: string } })._getLastStatusBarItem();
    expect(item.text).toBe("$(unmute) Voice: Ready");
  });

  it("M50-SB-05: active+idle → command is 'accordo.voice.configure'", () => {
    bar.update("active", "idle", "idle");
    const item = (vscode.window as unknown as { _getLastStatusBarItem: () => { command: string } })._getLastStatusBarItem();
    expect(item.command).toBe("accordo.voice.configure");
  });

  it("M50-SB-04: audio=listening → text '$(record) Voice: Recording…'", () => {
    bar.update("active", "listening", "idle");
    const item = (vscode.window as unknown as { _getLastStatusBarItem: () => { text: string } })._getLastStatusBarItem();
    expect(item.text).toBe("$(record) Voice: Recording\u2026");
  });

  it("M50-SB-04: audio=processing → text '$(loading~spin) Voice: Transcribing…'", () => {
    bar.update("active", "processing", "idle");
    const item = (vscode.window as unknown as { _getLastStatusBarItem: () => { text: string } })._getLastStatusBarItem();
    expect(item.text).toBe("$(loading~spin) Voice: Transcribing\u2026");
  });

  it("M50-SB-04: narration=playing → text '$(play) Voice: Narrating…'", () => {
    bar.update("active", "idle", "playing");
    const item = (vscode.window as unknown as { _getLastStatusBarItem: () => { text: string } })._getLastStatusBarItem();
    expect(item.text).toBe("$(play) Voice: Narrating\u2026");
  });

  it("M50-SB-05: narration=playing → command is 'accordo.voice.stopNarration'", () => {
    bar.update("active", "idle", "playing");
    const item = (vscode.window as unknown as { _getLastStatusBarItem: () => { command: string } })._getLastStatusBarItem();
    expect(item.command).toBe("accordo.voice.stopNarration");
  });

  it("M50-SB-04: narration=paused → text '$(debug-pause) Voice: Paused'", () => {
    bar.update("active", "idle", "paused");
    const item = (vscode.window as unknown as { _getLastStatusBarItem: () => { text: string } })._getLastStatusBarItem();
    expect(item.text).toBe("$(debug-pause) Voice: Paused");
  });

  it("M50-SB-04: audio=error → text '$(error) Voice: Error'", () => {
    bar.update("active", "error", "idle");
    const item = (vscode.window as unknown as { _getLastStatusBarItem: () => { text: string } })._getLastStatusBarItem();
    expect(item.text).toBe("$(error) Voice: Error");
  });

  it("M50-SB-06: tooltip includes voice, speed, narrationMode from policy", () => {
    const policy = { ...DEFAULT_VOICE_POLICY, voice: "fr-fr", speed: 1.5, narrationMode: "narrate-everything" as const };
    bar.update("active", "idle", "idle", policy);
    const item = (vscode.window as unknown as { _getLastStatusBarItem: () => { tooltip: string } })._getLastStatusBarItem();
    expect(item.tooltip).toContain("fr-fr");
    expect(item.tooltip).toContain("1.5");
    expect(item.tooltip).toContain("narrate-everything");
  });

  it("M50-SB-07: dispose() calls StatusBarItem.dispose()", () => {
    const item = (vscode.window as unknown as { _getLastStatusBarItem: () => { dispose: () => void } })._getLastStatusBarItem();
    bar.dispose();
    expect(item.dispose).toHaveBeenCalled();
  });
});
