/**
 * Streaming TTS — sentence-level pipeline.
 *
 * Synthesizes sentences incrementally: starts playing sentence N while
 * synthesizing sentence N+1 to reduce perceived latency.
 *
 * M51-STR
 */

import type { TtsProvider, TtsSynthesisRequest } from "../providers/tts-provider.js";
import type { CancellationToken } from "../providers/stt-provider.js";
import { splitIntoSentences } from "../../text/sentence-splitter.js";
import { playPcmAudio } from "./playback.js";

export interface StreamingSpeakOptions {
  language: string;
  voice?: string;
  speed?: number;
  cancellationToken?: CancellationToken;
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
  const { language, voice, speed, cancellationToken } = options;

  // M51-STR-02: split into sentences
  const sentences = splitIntoSentences(text);
  if (sentences.length === 0) return;

  // M51-STR-05: bail immediately if already cancelled
  if (cancellationToken?.isCancellationRequested) return;

  const makeRequest = (sentence: string): TtsSynthesisRequest => ({
    text: sentence,
    language,
    voice,
    speed,
  });

  // M51-STR-06: single-sentence falls back to single-shot (no overlap needed)
  if (sentences.length === 1) {
    const result = await ttsProvider.synthesize(makeRequest(sentences[0]!), cancellationToken);
    await playPcmAudio(result.audio, result.sampleRate ?? 22050);
    return;
  }

  // M51-STR-03 + M51-STR-04: streaming pipeline
  // Kick off the first synthesis before entering the loop so it starts
  // immediately. Each iteration plays the current result while the next
  // synthesis is already in flight.
  let pendingSynthesis = ttsProvider.synthesize(makeRequest(sentences[0]!), cancellationToken);

  for (let i = 0; i < sentences.length; i++) {
    // M51-STR-05: check cancellation at the top of each iteration
    if (cancellationToken?.isCancellationRequested) return;

    // Await the synthesis that was started in the previous iteration (or above)
    const current = await pendingSynthesis;

    // Kick off the next synthesis while we are about to play the current one
    if (i + 1 < sentences.length && !cancellationToken?.isCancellationRequested) {
      pendingSynthesis = ttsProvider.synthesize(
        makeRequest(sentences[i + 1]!),
        cancellationToken,
      );
    }

    // Play the current sentence
    await playPcmAudio(current.audio, current.sampleRate ?? 22050);
  }
}
