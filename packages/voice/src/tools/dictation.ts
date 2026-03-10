/**
 * accordo_voice_dictation — Record audio and transcribe speech-to-text.
 *
 * M50-DI
 */

import type { ExtensionToolDefinition } from "@accordo/bridge-types";
import type { SessionFsm } from "../core/fsm/session-fsm.js";
import type { AudioFsm } from "../core/fsm/audio-fsm.js";
import type { SttProvider } from "../core/providers/stt-provider.js";
import type { VoiceVocabulary } from "../text/vocabulary.js";

/** Active recording session handle. */
export interface RecordingHandle {
  stop(): Promise<Uint8Array>;
}

/** Injectable factory for audio recording. */
export type StartRecordingFn = (sampleRate: number) => RecordingHandle;

/** Injectable text insertion (for insertAtCursor). */
export type InsertTextFn = (text: string) => Promise<void>;

export interface DictationToolDeps {
  sessionFsm: SessionFsm;
  audioFsm: AudioFsm;
  sttProvider: SttProvider;
  vocabulary: VoiceVocabulary;
  startRecording: StartRecordingFn;
  insertText?: InsertTextFn;
}

/** M50-DI */
export function createDictationTool(deps: DictationToolDeps): ExtensionToolDefinition {
  const { sessionFsm, audioFsm, sttProvider, vocabulary, startRecording, insertText } = deps;

  /** Tracks the active recording session across start/stop calls. */
  let _activeRecording: RecordingHandle | null = null;

  const DEFAULT_SAMPLE_RATE = 16000;

  async function doStart(): Promise<Record<string, unknown>> {
    if (_activeRecording) {
      return { recording: true };
    }

    const available = await sttProvider.isAvailable();
    if (!available) {
      return { error: "STT provider is not available" };
    }

    try {
      sessionFsm.pushToTalkStart();
      audioFsm.startCapture();
      _activeRecording = startRecording(DEFAULT_SAMPLE_RATE);
    } catch (err) {
      _activeRecording = null;
      return { error: `Failed to start recording: ${String(err)}` };
    }

    return { recording: true };
  }

  async function doStop(
    insertAtCursor?: boolean,
    languageOverride?: string,
  ): Promise<Record<string, unknown>> {
    if (!_activeRecording) {
      return { error: "No active recording" };
    }

    try {
      audioFsm.stopCapture();
      const pcm = await _activeRecording.stop();
      _activeRecording = null;

      const transcribeResult = await sttProvider.transcribe({
        audio: pcm,
        sampleRate: DEFAULT_SAMPLE_RATE,
        language: languageOverride ?? sessionFsm.policy.language,
      });

      audioFsm.transcriptReady();
      sessionFsm.pushToTalkEnd();

      const text = vocabulary.process(transcribeResult.text);

      if (insertAtCursor && insertText) {
        await insertText(text);
      }

      return { text };
    } catch (err) {
      _activeRecording = null;
      try {
        audioFsm.error();
        audioFsm.reset();
      } catch {
        // Ignore state-recovery errors and still return structured error result.
      }
      try {
        sessionFsm.pushToTalkEnd();
      } catch {
        // Ignore state-recovery errors and still return structured error result.
      }
      return { error: `Dictation failed: ${String(err)}` };
    }
  }

  return {
    name: "accordo_voice_dictation",
    description: "Record audio and transcribe speech-to-text. Returns the transcript.",
    group: "voice",
    dangerLevel: "safe",
    idempotent: false,
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["start", "stop", "toggle"],
          description: "Recording action to perform",
        },
        insertAtCursor: {
          type: "boolean",
          description: "Insert transcript at editor cursor on stop",
        },
        language: {
          type: "string",
          description: "BCP-47 language override for transcription",
        },
      },
      required: ["action"],
    },
    handler: async (args: Record<string, unknown>) => {
      const action = args.action as "start" | "stop" | "toggle";
      const insertAtCursor = args.insertAtCursor as boolean | undefined;
      const language = args.language as string | undefined;

      if (action === "start") return doStart();
      if (action === "stop") return doStop(insertAtCursor, language);
      if (action === "toggle") {
        return _activeRecording ? doStop(insertAtCursor, language) : doStart();
      }

      return { error: `Unknown action: ${String(action)}` };
    },
  };
}
