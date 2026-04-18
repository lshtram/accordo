/**
 * ExternalTtsAdapter — TTS provider via external HTTP API.
 *
 * The thinnest possible external TTS client abstraction.
 * Configured via accordo.voice.ttsEndpoint + auth token.
 *
 * This addresses the user intent: prefer external TTS service over heavy
 * local ONNX runtime (Kokoro). Kokoro remains available as a fallback
 * when no external endpoint is configured.
 */

import type {
  TtsProvider,
  TtsSynthesisRequest,
  TtsSynthesisResult,
  CancellationToken,
} from "../providers/tts-provider.js";

export interface ExternalTtsAdapterOptions {
  /** Base URL of the TTS API (e.g. "https://api.openai.com/v1") */
  endpoint: string;
  /** Authorization header value (e.g. "Bearer sk-...") */
  authToken: string;
  /** Override model name (optional) */
  model?: string;
}

function buildAuthHeader(token: string): string {
  return token.startsWith("Bearer ") ? token : `Bearer ${token}`;
}

function pcmToUint8Array(pcm: ArrayLike<number>): Uint8Array {
  if (pcm instanceof Uint8Array) return pcm;
  const buf = new Int16Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) {
    const v = Math.max(-1, Math.min(1, Number(pcm[i])));
    buf[i] = Math.round(v * 32767);
  }
  return new Uint8Array(buf.buffer);
}

export class ExternalTtsAdapter implements TtsProvider {
  readonly kind = "tts" as const;
  readonly id = "external";

  private readonly _endpoint: string;
  private readonly _authHeader: string;
  private readonly _model: string;

  constructor(options: ExternalTtsAdapterOptions) {
    this._endpoint = options.endpoint.replace(/\/$/, "");
    this._authHeader = buildAuthHeader(options.authToken);
    this._model = options.model ?? "tts-1";
  }

  async isAvailable(): Promise<boolean> {
    // External TTS is "available" when endpoint and token are non-empty.
    return this._endpoint.length > 0 && this._authHeader.length > 7;
  }

  async synthesize(
    request: TtsSynthesisRequest,
    _token?: CancellationToken,
  ): Promise<TtsSynthesisResult> {
    const response = await fetch(`${this._endpoint}/audio/speech`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: this._authHeader,
      },
      body: JSON.stringify({
        model: this._model,
        input: request.text,
        voice: request.voice ?? "alloy",
        speed: request.speed ?? 1.0,
        response_format: "pcm",
      }),
    });

    if (!response.ok) {
      throw new Error(`ExternalTtsAdapter: HTTP ${response.status} — ${response.statusText}`);
    }

    // Most external TTS APIs return MP3/OGG by default; we request PCM via response_format.
    // If the server ignores the format, it returns bytes we treat as raw PCM.
    const arrayBuffer = await response.arrayBuffer();
    const pcm = new Uint8Array(arrayBuffer);

    // If sample rate is not advertised by the server, assume 24000 (common for external TTS).
    return { audio: pcm, sampleRate: 24000 };
  }

  async dispose(): Promise<void> {
    // No resources to release for HTTP-based provider.
  }
}
