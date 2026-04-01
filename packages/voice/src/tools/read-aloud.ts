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
import type { CancellationToken } from "../core/providers/stt-provider.js";
import type { AudioQueue } from "../core/audio/audio-queue.js";

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
  /**
   * Bug #14 fix: Called whenever a new streamSpeak pipeline becomes active.
   * Receives a cancel() function that, when called, requests cancellation of
   * the active pipeline's CancellationToken. The extension stores this handle
   * so doStopNarration / doPauseNarration can reach agent-initiated playback.
   * Also: a new call automatically cancels any previous active token before
   * starting, preventing overlapping concurrent pipelines.
   */
  onSpeakActive?: (cancel: () => void) => void;
  /** AQ-INT-03: Optional audio queue for receipt-based playback sequencing. */
  audioQueue?: AudioQueue;
}

/** Simple mutable cancellation token — not a VS Code dependency. */
function makeCancellationToken(): CancellationToken & { cancel(): void } {
  let cancelled = false;
  const handlers: Array<() => void> = [];
  return {
    get isCancellationRequested() { return cancelled; },
    onCancellationRequested(handler: () => void) { handlers.push(handler); },
    cancel() {
      if (cancelled) return;
      cancelled = true;
      for (const h of handlers) h();
    },
  };
}

/** M50-RA */
export function createReadAloudTool(deps: ReadAloudToolDeps): ExtensionToolDefinition {
  const { sessionFsm, narrationFsm, ttsProvider, cleanText, playAudio, streamSpeak, log, onSpeakActive, audioQueue } = deps;

  // Bug #14: module-level token so each invocation can cancel the previous one.
  let activeToken: ReturnType<typeof makeCancellationToken> | null = null;

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
        // Bug #14 fix: cancel any in-flight pipeline before starting a new one.
        // This prevents overlapping concurrent streamSpeak calls.
        if (activeToken !== null) {
          activeToken.cancel();
        }
        const token = makeCancellationToken();
        activeToken = token;

        // Expose a cancel handle to the extension so doStopNarration can reach
        // this pipeline directly, not just the command-path activeNarrationPlayback.
        if (onSpeakActive) {
          onSpeakActive(() => { token.cancel(); });
        }

        // M51-STR: Fire-and-forget — delegate to the streaming pipeline which
        // handles sentence splitting, synthesis, and overlapped playback.
        // The tool call returns instantly so the agent is never blocked.
        // Mark audio as "playing" eagerly — the pipeline starts playback
        // as soon as the first sentence is synthesized.
        narrationFsm.audioReady();

        void streamSpeak(processedText, ttsProvider, {
          language: policy.language,
          voice,
          speed,
          cancellationToken: token,
          log,
          audioQueue,
        })
          .then(() => {
            if (activeToken === token) activeToken = null;
            narrationFsm.complete();
          })
          .catch((bgErr) => {
            if (activeToken === token) activeToken = null;
            log?.(`[readAloud] background playback failed: ${String(bgErr)}`);
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
