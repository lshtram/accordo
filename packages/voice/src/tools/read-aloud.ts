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

export type PlayAudioFn = (pcm: Uint8Array, sampleRate: number) => Promise<void>;

export interface ReadAloudToolDeps {
  sessionFsm: SessionFsm;
  narrationFsm: NarrationFsm;
  ttsProvider: TtsProvider;
  cleanText: (text: string, mode: CleanMode) => string;
  playAudio: PlayAudioFn;
}

/** M50-RA */
export function createReadAloudTool(deps: ReadAloudToolDeps): ExtensionToolDefinition {
  const { sessionFsm, narrationFsm, ttsProvider, cleanText, playAudio } = deps;

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
      const rawText = (args.text as string) ?? "";
      if (!rawText.trim()) {
        return { spoken: false, reason: "empty text" };
      }

      const available = await ttsProvider.isAvailable();
      if (!available) {
        return { error: "TTS provider is not available" };
      }

      const cleanMode = (args.cleanMode as CleanMode | "raw") ?? "narrate-full";
      const processedText = cleanMode === "raw" ? rawText : cleanText(rawText, cleanMode as CleanMode);

      const policy = sessionFsm.policy;
      const voice = (args.voice as string | undefined) ?? policy.voice;
      const speed = (args.speed as number | undefined) ?? policy.speed;

      narrationFsm.enqueue({ text: processedText, mode: policy.narrationMode });
      narrationFsm.startProcessing();

      const result = await ttsProvider.synthesize({
        text: processedText,
        language: policy.language,
        voice,
        speed,
      });

      narrationFsm.audioReady();
      await playAudio(result.audio, result.sampleRate ?? 22050);
      narrationFsm.complete();

      return {
        spoken: true,
        textLength: rawText.length,
        cleanedLength: processedText.length,
        voice,
      };
    },
  };
}
