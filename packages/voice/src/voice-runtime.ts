/**
 * voice-runtime.ts — Core runtime / dictation-control functions.
 *
 * No `vscode` imports. Uses dependency injection (VoiceRuntimeDeps) for all
 * UI interactions and external operations.
 *
 * M50-EXT (runtime split)
 */

import type { VoiceUiAdapter } from "./voice-ui-adapter.js";
import type { SessionFsm } from "./core/fsm/session-fsm.js";
import type { AudioFsm } from "./core/fsm/audio-fsm.js";
import type { SttProvider } from "./core/providers/stt-provider.js";
import type { RecorderHandle } from "./core/audio/recorder.js";

// ── DictationState ────────────────────────────────────────────────────────────

interface DictationState {
  /** Whether dictation recording is currently active. */
  active: boolean;
  /** Cancel the in-flight recording when command toggles off. */
  stop?: () => Promise<void>;
}

// ── VoiceRuntimeState ─────────────────────────────────────────────────────────

/**
 * Mutable state bag for the voice runtime.
 * Replaces implicit closure state in `activate()`.
 */
export interface VoiceRuntimeState {
  dictState: DictationState;
  voiceInputTarget: "focus-text-input" | "agent-conversation";
  recordingReadyChime: boolean;
  lastActiveEditor: null | unknown;
  micPreparing: boolean;
  sttAvailable: boolean;
}

// ── VoiceRuntimeDeps ──────────────────────────────────────────────────────────

/**
 * Dependency injection bag for all UI and external operations.
 * Voice-runtime never calls vscode directly; it calls these callbacks.
 */
export interface VoiceRuntimeDeps {
  sessionFsm: SessionFsm;
  audioFsm: AudioFsm;
  sttProvider: SttProvider;
  vocabulary: { process: (text: string) => string };
  startRecording: (sampleRate: number) => RecorderHandle;
  isRecordingAvailable: () => Promise<boolean>;
  syncUiAndState: () => void;
  insertText: (text: string) => Promise<boolean>;
  log: (msg: string) => void;
  /** Injected UI adapter (required in production; optional for test compatibility). */
  uiAdapter?: VoiceUiAdapter;
}

// ── reconcileSessionState ─────────────────────────────────────────────────────

/**
 * Enables or disables the session FSM based on sttAvailable + policy.
 * REQ-VR-01 through REQ-VR-04
 */
export function reconcileSessionState(
  deps: VoiceRuntimeDeps,
  _state: VoiceRuntimeState,
  sttAvailable: boolean,
  reason: string,
): void {
  const { sessionFsm, log } = deps;
  const shouldEnable = sttAvailable && sessionFsm.policy.enabled;

  if (shouldEnable) {
    if (sessionFsm.state === "inactive") {
      log(`session: enabling (${reason})`);
      sessionFsm.enable();
    }
  } else if (sessionFsm.state !== "inactive") {
    log(`session: disabling (${reason})`);
    sessionFsm.disable();
  }

  deps.syncUiAndState();
}

// ── insertDictationText ───────────────────────────────────────────────────────

/**
 * Inserts transcribed text into the appropriate target.
 * REQ-VR-05 through REQ-VR-09
 */
export async function insertDictationText(
  deps: VoiceRuntimeDeps,
  state: VoiceRuntimeState,
  text: string,
): Promise<boolean> {
  if (!text.trim()) return false;

  const { log } = deps;

  if (state.voiceInputTarget === "agent-conversation") {
    try {
      // Lazy vscode fallback: only used when uiAdapter is not injected (test compatibility).
      // Production code must provide uiAdapter via VoiceRuntimeDeps.
      if (deps.uiAdapter) {
        await deps.uiAdapter.executeCommand("workbench.action.chat.open", {
          query: text,
          autoSend: true,
          isPartialQuery: false,
          mode: "agent",
          preserveFocus: true,
        });
      } else {
        const vscode = await import("vscode");
        await vscode.commands.executeCommand("workbench.action.chat.open", {
          query: text,
          autoSend: true,
          isPartialQuery: false,
          mode: "agent",
          preserveFocus: true,
        });
      }
      log("dictation: sent to agent conversation");
      return true;
    } catch (err) {
      log(`dictation: insert failed (mode=${state.voiceInputTarget}) — ${String(err)}`);
      const warnMsg = "Accordo Voice: couldn't send directly to chat conversation. Focus chat input manually or switch input target to focused text input.";
      if (deps.uiAdapter) {
        void deps.uiAdapter.showWarningMessage(warnMsg);
      } else {
        const vscode = await import("vscode");
        void vscode.window.showWarningMessage(warnMsg);
      }
      return false;
    }
  }

  return deps.insertText(text);
}

// ── doStartDictation ──────────────────────────────────────────────────────────

/**
 * Starts dictation recording.
 * REQ-VR-10 through REQ-VR-12
 */
export async function doStartDictation(
  deps: VoiceRuntimeDeps,
  state: VoiceRuntimeState,
): Promise<void> {
  const { sessionFsm, audioFsm, sttProvider, vocabulary, startRecording, log } = deps;
  const startTs = Date.now();

  if (sessionFsm.state !== "active") {
    if (!sessionFsm.policy.enabled) {
      const msg = "Accordo Voice: session inactive. Enable `accordo.voice.enabled` in settings.";
      if (deps.uiAdapter) void deps.uiAdapter.showWarningMessage(msg);
      else {
        const vscode = await import("vscode");
        void vscode.window.showWarningMessage(msg);
      }
    } else {
      const msg = "Accordo Voice: session inactive. Check STT provider availability.";
      if (deps.uiAdapter) void deps.uiAdapter.showWarningMessage(msg);
      else {
        const vscode = await import("vscode");
        void vscode.window.showWarningMessage(msg);
      }
    }
    return;
  }

  if (state.dictState.active) return; // already recording — no concurrent recordings
  state.dictState.active = true; // lock before any await

  log("dictation: starting…");

  const soxAvail = await deps.isRecordingAvailable();
  if (!soxAvail) {
    state.dictState.active = false;
    log("dictation: sox not found");
    const soxInstallHint =
      process.platform === "win32"
        ? "Install via `scoop install sox` (or download from https://sourceforge.net/projects/sox/)"
        : process.platform === "darwin"
          ? "Install via `brew install sox`"
          : "Install via `apt install sox` (or your distro package manager)";
    const msg = `Accordo Voice: sox not found. ${soxInstallHint}.`;
    if (deps.uiAdapter) void deps.uiAdapter.showWarningMessage(msg);
    else {
      const vscode = await import("vscode");
      void vscode.window.showWarningMessage(msg);
    }
    return;
  }

  let handle: RecorderHandle;
  try {
    state.micPreparing = true;
    deps.syncUiAndState();

    const soxStartTs = Date.now();
    handle = startRecording(16000);
    await handle.waitUntilReady();
    const readyMs = Date.now() - soxStartTs;
    log(`dictation: recorder ready after ${String(readyMs)}ms`);

    sessionFsm.pushToTalkStart();
    audioFsm.startCapture();
    state.micPreparing = false;
    deps.syncUiAndState();
    log(`dictation: recording started (total startup ${String(Date.now() - startTs)}ms)`);
  } catch (err) {
    state.micPreparing = false;
    state.dictState.active = false;
    deps.syncUiAndState();
    log(`dictation: failed to start recorder — ${String(err)}`);
    const msg = `Accordo Voice: failed to start recording — ${String(err)}`;
    if (deps.uiAdapter) void deps.uiAdapter.showErrorMessage(msg);
    else {
      const vscode = await import("vscode");
      void vscode.window.showErrorMessage(msg);
    }
    return;
  }

  state.dictState.stop = async (): Promise<void> => {
    if (!state.dictState.active) return;
    state.dictState.active = false;

    audioFsm.stopCapture();
    const pcm = await handle.stop();
    log(`dictation: recording stopped, pcmBytes=${pcm.byteLength}`);

    try {
      log("dictation: sending to whisper…");
      const result = await sttProvider.transcribe({
        audio: pcm,
        sampleRate: 16000,
        language: sessionFsm.policy.language,
      });
      audioFsm.transcriptReady();
      sessionFsm.pushToTalkEnd();

      const text = vocabulary.process(result.text);
      log(`dictation: transcript="${text.slice(0, 120)}"`);
      if (!text.trim()) {
        log("dictation: empty transcript — nothing inserted");
      } else {
        await insertDictationText(deps, state, text);
      }
    } catch (err) {
      log(`dictation: error — ${String(err)}`);
      audioFsm.error();
      audioFsm.reset();
      sessionFsm.pushToTalkEnd();
      const msg = `Accordo Voice: transcription failed — ${String(err)}`;
      if (deps.uiAdapter) void deps.uiAdapter.showErrorMessage(msg);
      else {
        const vscode = await import("vscode");
        void vscode.window.showErrorMessage(msg);
      }
    } finally {
      state.micPreparing = false;
      state.dictState.stop = undefined;
    }

    deps.syncUiAndState();
  };
}

// ── doStopDictation ───────────────────────────────────────────────────────────

/**
 * Stops dictation recording (if active).
 * REQ-VR-13
 */
export async function doStopDictation(
  _deps: VoiceRuntimeDeps,
  state: VoiceRuntimeState,
): Promise<void> {
  if (state.dictState.stop) await state.dictState.stop();
}

// ── doToggleDictation ─────────────────────────────────────────────────────────

/**
 * Toggles dictation: stops if active, starts if inactive.
 * REQ-VR-14 through REQ-VR-16
 */
export async function doToggleDictation(
  deps: VoiceRuntimeDeps,
  state: VoiceRuntimeState,
): Promise<void> {
  if (state.dictState.active) {
    await doStopDictation(deps, state);
  } else {
    await doStartDictation(deps, state);
  }
}

// ── buildInsertTextCallback ───────────────────────────────────────────────────

/**
 * Builds the `insertText` callback used by runtimeDeps.
 * Tries the VSCode "type" command first; falls back to editor cursor insertion.
 */
export function buildInsertTextCallback(
  uiAdapter: VoiceUiAdapter,
  log: (msg: string) => void,
): (text: string) => Promise<boolean> {
  return async (text: string): Promise<boolean> => {
    try {
      await uiAdapter.executeCommand("type", { text });
      log("dictation: inserted via focused input");
      return true;
    } catch (err) {
      log(`dictation: insert via type command failed — ${String(err)}`);
      const editor = uiAdapter.activeTextEditor();
      if (!editor) {
        void uiAdapter.showWarningMessage(
          "Accordo Voice: no target input found. Focus an input field or editor and try again.",
        );
        return false;
      }
      return uiAdapter.insertAtEditor(editor, text);
    }
  };
}
