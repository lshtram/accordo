/**
 * TTS (Text-to-Speech) provider abstraction.
 *
 * Any TTS engine (Kokoro, VS Code Speech, Piper, ElevenLabs, etc.) implements
 * this interface. No VS Code dependency — fully testable in isolation.
 *
 * @module tts-provider
 */

/** Shared cancellation token used by both STT and TTS providers. */
export interface CancellationToken {
  readonly isCancellationRequested: boolean;
  onCancellationRequested(handler: () => void): void;
}

/**
 * Input to a synthesis request.
 * M50-SP-06
 */
export interface TtsSynthesisRequest {
  /** Text to synthesize. Should already be cleaned (no markdown/code). */
  text: string;
  /** BCP-47 language code (e.g. "en-US"). */
  language: string;
  /** Playback speed multiplier (0.5–2.0). Defaults to 1.0. */
  speed?: number;
  /** Provider-specific voice identifier (e.g. "af_sarah"). */
  voice?: string;
}

/**
 * Result of a successful synthesis.
 * M50-SP-07
 */
export interface TtsSynthesisResult {
  /** Synthesized audio as 16-bit signed PCM (Int16, little-endian). */
  audio: Uint8Array;
  /** Sample rate of the returned audio in Hz. */
  sampleRate?: number;
}

/**
 * TTS provider interface.
 * M50-SP-05
 */
export interface TtsProvider {
  readonly kind: "tts";
  /** Unique identifier for this provider (e.g. "kokoro"). */
  readonly id: string;
  /** Returns true if the underlying engine model/library is available. */
  isAvailable(): Promise<boolean>;
  /**
   * Synthesize text to audio.
   * @param request  Text + voice parameters.
   * @param token    Optional cancellation token.
   */
  synthesize(
    request: TtsSynthesisRequest,
    token?: CancellationToken,
  ): Promise<TtsSynthesisResult>;
  /** Release any held resources (loaded model, etc.). */
  dispose(): Promise<void>;
}
