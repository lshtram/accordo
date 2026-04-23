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

function readAscii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(start, start + length));
}

function readU16Le(bytes: Uint8Array, start: number): number {
  return bytes[start] | (bytes[start + 1] << 8);
}

function readU32Le(bytes: Uint8Array, start: number): number {
  return (
    bytes[start]
    | (bytes[start + 1] << 8)
    | (bytes[start + 2] << 16)
    | (bytes[start + 3] << 24)
  ) >>> 0;
}

function decodePcmWav(audio: Uint8Array): { pcm: Uint8Array; sampleRate: number } | undefined {
  if (audio.length < 44 || readAscii(audio, 0, 4) !== "RIFF" || readAscii(audio, 8, 4) !== "WAVE") {
    return undefined;
  }

  let offset = 12;
  let sampleRate = 24000;
  let pcm: Uint8Array | undefined;

  while (offset + 8 <= audio.length) {
    const chunkId = readAscii(audio, offset, 4);
    const chunkSize = readU32Le(audio, offset + 4);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkSize;
    if (chunkEnd > audio.length) break;

    if (chunkId === "fmt ") {
      const audioFormat = readU16Le(audio, chunkStart);
      const channels = readU16Le(audio, chunkStart + 2);
      sampleRate = readU32Le(audio, chunkStart + 4);
      const bitsPerSample = readU16Le(audio, chunkStart + 14);
      if (audioFormat !== 1 || channels !== 1 || bitsPerSample !== 16) {
        throw new Error("ExternalTtsAdapter: unsupported WAV format");
      }
    }

    if (chunkId === "data") {
      pcm = audio.slice(chunkStart, chunkEnd);
      break;
    }

    offset = chunkEnd + (chunkSize % 2);
  }

  if (!pcm) {
    throw new Error("ExternalTtsAdapter: WAV response missing data chunk");
  }

  return { pcm, sampleRate };
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
    const body: Record<string, unknown> = {
      model: this._model,
      input: request.text,
      text: request.text,
      response_format: "wav",
    };
    // Only include voice when explicitly provided — Kokoro-like endpoints
    // reject unknown fields, while OpenAI-compatible providers require it.
    if (request.voice != null) {
      body.voice = request.voice;
      if (request.language) body.language = request.language;
      if (request.speed != null) body.speed = request.speed;
    }

    const response = await fetch(`${this._endpoint}/audio/speech`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: this._authHeader,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      // Try to read the response body for more context (e.g. API error message).
      let detail = "";
      try {
        const bodyText = await response.text();
        if (bodyText) detail = ` — ${bodyText.slice(0, 200)}`;
      } catch {
        // ignore body-read failure
      }
      const cause =
        response.status === 401 || response.status === 403
          ? "auth"
          : response.status === 404
            ? "endpoint-not-found"
            : response.status >= 500
              ? "server-error"
              : "client-error";
      throw new Error(
        `ExternalTtsAdapter: HTTP ${response.status} (${cause}) — ${response.statusText}${detail}`,
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    const audio = new Uint8Array(arrayBuffer);
    const wav = decodePcmWav(audio);
    if (wav) {
      return { audio: wav.pcm, sampleRate: wav.sampleRate };
    }

    return { audio, sampleRate: 24000 };
  }

  async dispose(): Promise<void> {
    // No resources to release for HTTP-based provider.
  }
}
