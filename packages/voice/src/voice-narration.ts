/**
 * voice-narration.ts — Narration-control functions.
 *
 * Handles read-aloud, TTS/STT smoke tests, speak-text, stop/pause/resume
 * narration. Uses NarrationDeps for all external/UI interactions.
 *
 * M50-EXT (narration split)
 */

import * as vscode from "vscode";
import type { SessionFsm } from "./core/fsm/session-fsm.js";
import type { NarrationFsm } from "./core/fsm/narration-fsm.js";
import type { SttProvider } from "./core/providers/stt-provider.js";
import type { TtsProvider } from "./core/providers/tts-provider.js";
import type { PlaybackHandle } from "./core/audio/playback.js";
import type { AudioQueue } from "./core/audio/audio-queue.js";
import type { CleanMode } from "./text/text-cleaner.js";

// ── NarrationDeps ─────────────────────────────────────────────────────────────

/**
 * Dependency injection bag for narration-control functions.
 * Keeps vscode references out of callers.
 */
export interface NarrationDeps {
  sessionFsm: SessionFsm;
  narrationFsm: NarrationFsm;
  sttProvider: SttProvider;
  ttsProvider: TtsProvider;
  cleanTextForNarration: (text: string, mode: CleanMode) => string;
  playPcmAudio: (pcm: Uint8Array, sampleRate: number) => Promise<void>;
  startPcmPlayback: (pcm: Uint8Array, sampleRate: number) => Promise<PlaybackHandle>;
  streamingSpeak: (...args: unknown[]) => unknown;
  /** AQ-INT-01: Injected audio queue for receipt-based playback sequencing. */
  audioQueue: AudioQueue;
  log: (msg: string) => void;
  syncUiAndState: () => void;
  dictState: { active: boolean };
  getActiveNarrationPlayback: () => PlaybackHandle | undefined;
  setActiveNarrationPlayback: (h: PlaybackHandle | undefined) => void;
  getActiveStreamCancel: () => (() => void) | undefined;
  setActiveStreamCancel: (fn: (() => void) | undefined) => void;
}

// ── doReadAloud ───────────────────────────────────────────────────────────────

export async function doReadAloud(deps: NarrationDeps): Promise<void> {
  if (deps.getActiveNarrationPlayback()?.isPlaying()) {
    void vscode.window.showInformationMessage("Accordo Voice: narration is already playing."); return;
  }
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.selection.isEmpty) {
    void vscode.window.showInformationMessage("Accordo Voice: select text first to read aloud."); return;
  }
  const text = editor.document.getText(editor.selection);
  if (!text.trim()) return;
  if (!await deps.ttsProvider.isAvailable()) { void vscode.window.showWarningMessage("Accordo Voice: TTS provider not available."); return; }
  const policy = deps.sessionFsm.policy;
  const cleaned = deps.cleanTextForNarration(text, "narrate-full");
  const effectiveMode = policy.narrationMode === "narrate-off" ? "narrate-everything" : policy.narrationMode;
  deps.narrationFsm.enqueue({ text: cleaned, mode: effectiveMode });
  deps.narrationFsm.startProcessing();
  deps.syncUiAndState();
  try {
    const result = await deps.ttsProvider.synthesize({ text: cleaned, language: policy.language, voice: policy.voice, speed: policy.speed });
    deps.narrationFsm.audioReady(); deps.syncUiAndState();
    const handle = await deps.startPcmPlayback(result.audio, result.sampleRate ?? 22050);
    deps.setActiveNarrationPlayback(handle);
    await handle.waitForExit();
    deps.setActiveNarrationPlayback(undefined); deps.narrationFsm.complete();
  } catch (err) { deps.setActiveNarrationPlayback(undefined); deps.narrationFsm.error(); void vscode.window.showErrorMessage(`Accordo Voice: narration failed — ${String(err)}`); }
  deps.syncUiAndState();
}

// ── doTestTts ─────────────────────────────────────────────────────────────────

export async function doTestTts(deps: NarrationDeps): Promise<void> {
  deps.log("smoke: tts test invoked");
  if (deps.dictState.active) { void vscode.window.showWarningMessage("Accordo Voice: stop dictation before running TTS test."); return; }
  if (deps.getActiveNarrationPlayback()?.isPlaying()) { void vscode.window.showWarningMessage("Accordo Voice: narration already playing."); return; }
  if (!await deps.ttsProvider.isAvailable()) { void vscode.window.showWarningMessage("Accordo Voice: TTS provider not available."); return; }
  const policy = deps.sessionFsm.policy;
  try {
    const result = await deps.ttsProvider.synthesize({ text: "Accordo voice test. If you can hear this sentence, Kokoro playback is working.", language: policy.language, voice: policy.voice, speed: policy.speed });
    await deps.playPcmAudio(result.audio, result.sampleRate ?? 22050);
    void vscode.window.showInformationMessage("Accordo Voice: TTS smoke test passed.");
  } catch (err) { void vscode.window.showErrorMessage(`Accordo Voice: TTS smoke test failed — ${String(err)}`); }
}

// ── doTestStt ─────────────────────────────────────────────────────────────────

export async function doTestStt(deps: NarrationDeps): Promise<void> {
  deps.log("smoke: stt test invoked");
  if (deps.dictState.active) { void vscode.window.showWarningMessage("Accordo Voice: stop dictation before running STT test."); return; }
  if (deps.getActiveNarrationPlayback()?.isPlaying()) { void vscode.window.showWarningMessage("Accordo Voice: narration already playing."); return; }
  if (!await deps.sttProvider.isAvailable()) { void vscode.window.showWarningMessage("Accordo Voice: STT provider not available."); return; }
  if (!await deps.ttsProvider.isAvailable()) { void vscode.window.showWarningMessage("Accordo Voice: STT smoke test requires Kokoro to generate sample audio."); return; }
  const policy = deps.sessionFsm.policy;
  try {
    const ttsResult = await deps.ttsProvider.synthesize({ text: "This is a whisper smoke test generated by Kokoro.", language: policy.language, voice: policy.voice, speed: 1.0 });
    const sttResult = await deps.sttProvider.transcribe({ audio: ttsResult.audio, sampleRate: ttsResult.sampleRate ?? 22050, language: policy.language });
    const transcript = sttResult.text.trim();
    if (transcript.length === 0) { void vscode.window.showWarningMessage("Accordo Voice: STT test ran but transcript is empty."); }
    else { void vscode.window.showInformationMessage(`Accordo Voice: STT smoke test transcript: ${transcript}`); }
  } catch (err) { void vscode.window.showErrorMessage(`Accordo Voice: STT smoke test failed — ${String(err)}`); }
}

// ── doSpeakText ───────────────────────────────────────────────────────────────

export async function doSpeakText(deps: NarrationDeps, args: { text: string; voice?: string; speed?: number; block?: boolean }): Promise<void> {
  if (!await deps.ttsProvider.isAvailable()) return;
  const policy = deps.sessionFsm.policy;
  const cleaned = deps.cleanTextForNarration(args.text, "narrate-full");
  const play = async (): Promise<void> => {
    const result = await deps.ttsProvider.synthesize({ text: cleaned, language: policy.language, voice: args.voice ?? policy.voice, speed: args.speed ?? policy.speed });
    // AQ-INT-02: use AudioQueue for receipt-based sequential playback when available.
    if (deps.audioQueue) {
      await deps.audioQueue.enqueue(result.audio, result.sampleRate ?? 22050);
    } else {
      await deps.playPcmAudio(result.audio, result.sampleRate ?? 22050);
    }
  };
  if (args.block !== false) { await play(); } else { void play(); }
}

// ── doStopNarration ───────────────────────────────────────────────────────────

export async function doStopNarration(deps: NarrationDeps): Promise<void> {
  if (deps.getActiveNarrationPlayback()?.isPlaying()) {
    await deps.getActiveNarrationPlayback()!.stop();
    deps.setActiveNarrationPlayback(undefined);
  }
  const cancel = deps.getActiveStreamCancel();
  if (cancel) { cancel(); deps.setActiveStreamCancel(undefined); }
  deps.narrationFsm.error(); deps.syncUiAndState();
}

// ── doPauseNarration ──────────────────────────────────────────────────────────

export async function doPauseNarration(deps: NarrationDeps): Promise<void> {
  if (!deps.getActiveNarrationPlayback()?.isPlaying()) return;
  const paused = await deps.getActiveNarrationPlayback()!.pause();
  if (!paused) { void vscode.window.showInformationMessage("Accordo Voice: pause is not supported on this platform."); return; }
  deps.narrationFsm.pause(); deps.syncUiAndState();
}

// ── doResumeNarration ─────────────────────────────────────────────────────────

export async function doResumeNarration(deps: NarrationDeps): Promise<void> {
  // Bug #19 fix: guard on FSM state 'paused', not isPlaying()
  if (deps.narrationFsm.state !== "paused") return;
  if (!deps.getActiveNarrationPlayback()?.isPlaying()) return;
  const resumed = await deps.getActiveNarrationPlayback()!.resume();
  if (!resumed) { void vscode.window.showInformationMessage("Accordo Voice: resume is not supported on this platform."); return; }
  deps.narrationFsm.resume(); deps.syncUiAndState();
}
