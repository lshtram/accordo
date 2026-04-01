/**
 * Streaming TTS — sentence-level pipeline.
 *
 * Synthesizes sentences incrementally: starts playing sentence N while
 * synthesizing sentence N+1 to reduce perceived latency.
 *
 * M51-STR
 *
 * Design note — process safety (fix for CPU-spike / process explosion bug):
 *
 * The original implementation pre-spawned the NEXT audio player process before
 * the current sentence had finished playing. When multiple fire-and-forget
 * streamingSpeak() calls overlapped (e.g. from a demo script), this produced
 * O(N * sentences) audio player processes running concurrently, saturating all
 * CPU cores. The fix: synthesis of the next sentence still overlaps with
 * playback (valuable latency win), but the next PLAYER is only created after
 * the current sentence finishes. The marginal spawn cost (~5–10 ms on Linux)
 * is negligible compared to synthesis time.
 *
 * Cancellation: checked at three points —
 *   1. Before entering the loop (fast bail)
 *   2. After synthesis completes (before play starts)
 *   3. After play completes (before next iteration)
 * This ensures no orphaned player processes survive cancellation.
 */

import type { TtsProvider, TtsSynthesisRequest } from "../providers/tts-provider.js";
import type { CancellationToken } from "../providers/stt-provider.js";
import type { AudioQueue } from "./audio-queue.js";
import { splitIntoSentences } from "../../text/sentence-splitter.js";
import { playPcmAudio } from "./playback.js";

export interface StreamingSpeakOptions {
  language: string;
  voice?: string;
  speed?: number;
  cancellationToken?: CancellationToken;
  /** AQ-INT-02: Optional audio queue for receipt-based playback sequencing. */
  audioQueue?: AudioQueue;
  /** Optional logger — receives per-sentence timing lines for the output channel. */
  log?: (msg: string) => void;
}

/**
 * M51-STR-01: Speak text using a sentence-level streaming pipeline.
 *
 * Single sentence: single-shot synthesis → play.
 * Multiple sentences: synthesize N+1 while playing N, reducing perceived
 * latency to the time of the first sentence synthesis only.
 *
 * @param text - Cleaned text to speak
 * @param ttsProvider - TTS provider instance
 * @param options - Language, voice, speed, cancellation
 */
export async function streamingSpeak(
  text: string,
  ttsProvider: TtsProvider,
  options: StreamingSpeakOptions,
): Promise<void> {
  const { language, voice, speed, cancellationToken, audioQueue, log } = options;
  const t0 = Date.now();

  // M51-STR-02: split into sentences
  const sentences = splitIntoSentences(text);
  if (sentences.length === 0) return;
  log?.(`[stream] split: ${sentences.length} sentence(s) in ${Date.now() - t0}ms`);

  // M51-STR-05: bail immediately if already cancelled
  if (cancellationToken?.isCancellationRequested) return;

  const makeRequest = (sentence: string): TtsSynthesisRequest => ({
    text: sentence,
    language,
    voice,
    speed,
  });

  // M51-STR-06: single-sentence — single-shot (no overlap needed)
  if (sentences.length === 1) {
    const tSynth = Date.now();
    const result = await ttsProvider.synthesize(makeRequest(sentences[0]!), cancellationToken);
    const synthMs = Date.now() - tSynth;
    // Check cancellation after synthesis but before spawning a player process.
    if (cancellationToken?.isCancellationRequested) return;
    const tPlay = Date.now();
    // AQ-INT-01: when an AudioQueue is provided, enqueue the chunk for sequential
    // receipt-based playback instead of fire-and-forget playPcmAudio.
    if (audioQueue) {
      await audioQueue.enqueue(result.audio, result.sampleRate ?? 22050);
    } else {
      await playPcmAudio(result.audio, result.sampleRate ?? 22050);
    }
    const playMs = Date.now() - tPlay;
    log?.(`[stream] s0: synth=${synthMs}ms play=${playMs}ms total=${Date.now() - t0}ms`);
    return;
  }

  // M51-STR-03 + M51-STR-04: streaming pipeline
  //
  // SYNTHESIS overlaps with playback (latency win kept):
  //   synthesis of sentence i+1 starts while sentence i is playing.
  //
  // PLAYER SPAWN does NOT overlap (process-safety fix):
  //   the audio player for sentence i+1 is created only after sentence i
  //   finishes playing. This prevents concurrent player process accumulation
  //   when multiple overlapping fire-and-forget calls are in flight.
  const tFirstSynth = Date.now();
  let pendingSynthesis = ttsProvider.synthesize(makeRequest(sentences[0]!), cancellationToken);
  let pendingSynthStartMs = tFirstSynth;

  for (let i = 0; i < sentences.length; i++) {
    // Cancellation check 1: top of each iteration — before awaiting synthesis.
    if (cancellationToken?.isCancellationRequested) return;

    // Await the synthesis that was started in the previous iteration (or above).
    const tAwaitSynth = Date.now();
    const current = await pendingSynthesis;
    const synthMs = Date.now() - pendingSynthStartMs;
    const synthWaitMs = Date.now() - tAwaitSynth; // 0 if synth finished during prev play

    // Cancellation check 2: after synthesis completes — before spawning a player.
    if (cancellationToken?.isCancellationRequested) return;

    // Kick off synthesis of the NEXT sentence now, so it runs in parallel with
    // the current playback below (this is the latency-saving overlap).
    const nextSynthStart = Date.now();
    if (i + 1 < sentences.length && !cancellationToken?.isCancellationRequested) {
      pendingSynthesis = ttsProvider.synthesize(
        makeRequest(sentences[i + 1]!),
        cancellationToken,
      );
      pendingSynthStartMs = nextSynthStart;
    }

    // Play the current sentence. The player is created here (not before) so
    // only one player process exists at a time, regardless of how many
    // concurrent streamingSpeak() calls are in flight.
    // AQ-INT-01: when an AudioQueue is provided, enqueue the chunk for sequential
    // receipt-based playback instead of fire-and-forget playPcmAudio.
    const tPlay = Date.now();
    if (audioQueue) {
      await audioQueue.enqueue(current.audio, current.sampleRate ?? 22050);
    } else {
      await playPcmAudio(current.audio, current.sampleRate ?? 22050);
    }
    const playMs = Date.now() - tPlay;

    log?.(
      `[stream] s${i}: synth=${synthMs}ms (waited=${synthWaitMs}ms) play=${playMs}ms` +
      (synthWaitMs > 50 ? " ← GAP" : ""),
    );

    // Cancellation check 3: after play — before next iteration spawns another player.
    if (cancellationToken?.isCancellationRequested) return;
  }

  log?.(`[stream] done: total=${Date.now() - t0}ms`);
}
