/**
 * STT (Speech-to-Text) provider abstraction.
 *
 * Any STT engine (Whisper.cpp, VS Code Speech, etc.) implements this interface.
 * No VS Code dependency — fully testable in isolation.
 *
 * @module stt-provider
 */

/** Cancellation signal passed to long-running provider calls. */
export interface CancellationToken {
  readonly isCancellationRequested: boolean;
  onCancellationRequested(handler: () => void): void;
}

/**
 * Input to a transcription request.
 * M50-SP-02
 */
export interface SttTranscriptionRequest {
  /** Raw PCM audio bytes (16-bit signed integer, little-endian). */
  audio: Uint8Array;
  /** Sample rate in Hz. Defaults to 16000 if omitted. */
  sampleRate?: number;
  /** BCP-47 language code (e.g. "en-US"). */
  language: string;
}

/**
 * Result of a successful transcription.
 * M50-SP-03
 */
export interface SttTranscriptionResult {
  /** The transcribed text. */
  text: string;
}

/**
 * STT provider interface.
 * M50-SP-01
 */
export interface SttProvider {
  readonly kind: "stt";
  /** Unique identifier for this provider (e.g. "whisper.cpp"). */
  readonly id: string;
  /** Returns true if the underlying engine binary/model is available. */
  isAvailable(): Promise<boolean>;
  /**
   * Transcribe audio to text.
   * @param request  Audio bytes + metadata.
   * @param token    Optional cancellation token.
   */
  transcribe(
    request: SttTranscriptionRequest,
    token?: CancellationToken,
  ): Promise<SttTranscriptionResult>;
}
