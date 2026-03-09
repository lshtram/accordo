/**
 * accordo_voice_readAloud — Read text aloud using TTS.
 *
 * M50-RA
 */

import type { ExtensionToolDefinition } from "@accordo/bridge-types";
import type { SessionFsm } from "../core/fsm/session-fsm.js";
import type { NarrationFsm } from "../core/fsm/narration-fsm.js";
import type { TtsProvider } from "../core/providers/tts-provider.js";
import type { CleanMode } from "../text/text-cleaner.js";
import type { StreamingSpeakOptions } from "../core/audio/streaming-tts.js";

export type PlayAudioFn = (pcm: Uint8Array, sampleRate: number) => Promise<void>;
export type StreamSpeakFn = (text: string, ttsProvider: TtsProvider, options: StreamingSpeakOptions) => Promise<void>;

export interface ReadAloudToolDeps {
  sessionFsm: SessionFsm;
  narrationFsm: NarrationFsm;
  ttsProvider: TtsProvider;
  cleanText: (text: string, mode: CleanMode) => string;
  playAudio: PlayAudioFn;
  /**
   * M51-STR: Optional streaming pipeline. When provided, audio starts after
   * the first sentence is synthesized (not the full text) and the tool call
   * returns immediately (fire-and-forget). When absent, falls back to the
   * original blocking single-shot path (used in tests).
   */
  streamSpeak?: StreamSpeakFn;
  /** Optional logger for per-sentence timing lines (voice output channel). */
  log?: (msg: string) => void;
}

/** M50-RA */
export function createReadAloudTool(deps: ReadAloudToolDeps): ExtensionToolDefinition {
  const { sessionFsm, narrationFsm, ttsProvider, cleanText, playAudio, streamSpeak, log } = deps;

  return {
    name: "accordo_voice_readAloud",
    description: "Read text aloud using text-to-speech. Cleans markdown/code before speaking.",
    group: "voice",
    dangerLevel: "safe",
    idempotent: false,
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Text to read aloud" },
        cleanMode: {
          type: "string",
          enum: ["narrate-full", "narrate-headings", "raw"],
          description: "How to pre-process the text",
        },
        voice: { type: "string", description: "Override voice from policy" },
        speed: { type: "number", description: "Override speed from policy (0.5–2.0)" },
      },
      required: ["text"],
    },
    handler: async (args: Record<string, unknown>) => {
      const t0 = Date.now();
      const rawText = (args.text as string) ?? "";
      if (!rawText.trim()) {
        return { spoken: false, reason: "empty text" };
      }

      const available = await ttsProvider.isAvailable();
      const t1 = Date.now();
      if (!available) {
        return { error: "TTS provider is not available" };
      }

      const cleanMode = (args.cleanMode as CleanMode | "raw") ?? "narrate-full";
      const processedText = cleanMode === "raw" ? rawText : cleanText(rawText, cleanMode as CleanMode);

      const policy = sessionFsm.policy;
      const voice = (args.voice as string | undefined) ?? policy.voice;
      const speed = (args.speed as number | undefined) ?? policy.speed;
      if (speed < 0.5 || speed > 2.0) {
        return { error: `Invalid speed: ${String(speed)} (expected 0.5-2.0)` };
      }
      const effectiveMode =
        policy.narrationMode === "narrate-off" ? "narrate-everything" : policy.narrationMode;

      narrationFsm.enqueue({ text: processedText, mode: effectiveMode });
      narrationFsm.startProcessing();

      if (streamSpeak) {
        // M51-STR: Fire-and-forget streaming — first sentence starts playing
        // after only its synthesis latency. Tool call returns immediately so
        // the MCP timeout does not cut off long texts.
        narrationFsm.audioReady();
        log?.(`[readAloud] handler: availMs=${t1 - t0} handlerMs=~${Date.now() - t0} chars=${rawText.length}`);
        void streamSpeak(processedText, ttsProvider, {
          language: policy.language,
          voice,
          speed,
          log,
        }).then(() => {
          narrationFsm.complete();
        }).catch(() => {
          narrationFsm.error();
        });
        return {
          speaking: true,
          textLength: rawText.length,
          voice,
          _handlerMs: Date.now() - t0,
          _availMs: t1 - t0,
        };
      }

      // Original blocking path — fallback when streamSpeak is not injected (used in tests)
      try {
        const result = await ttsProvider.synthesize({
          text: processedText,
          language: policy.language,
          voice,
          speed,
        });

        narrationFsm.audioReady();
        await playAudio(result.audio, result.sampleRate ?? 22050);
        narrationFsm.complete();
      } catch (err) {
        narrationFsm.error();
        return { error: `Read aloud failed: ${String(err)}` };
      }

      return {
        spoken: true,
        textLength: rawText.length,
        cleanedLength: processedText.length,
        voice,
      };
    },
  };
}
