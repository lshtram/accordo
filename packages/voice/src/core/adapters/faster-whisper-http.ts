/**
 * FasterWhisperHttpAdapter — STT provider using a Docker faster-whisper-server
 * (https://github.com/fedirz/faster-whisper-server).
 *
 * The server exposes an OpenAI-compatible REST API:
 *   GET  /v1/models                       — list loaded models
 *   POST /v1/audio/transcriptions         — multipart/form-data { file, model }
 *
 * M50-FWH
 */

import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import type {
  SttProvider,
  SttTranscriptionRequest,
  SttTranscriptionResult,
  CancellationToken,
} from "../providers/stt-provider.js";

// ---------------------------------------------------------------------------
// Dependency injection types (allows mocking in tests)
// ---------------------------------------------------------------------------

/** Minimal subset of the Fetch API needed by this adapter. */
export type FetchFn = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
    signal?: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

export interface FasterWhisperHttpAdapterOptions {
  /** Base URL of the faster-whisper-server. Defaults to "http://localhost:8280". */
  baseUrl?: string;
  /** Model name to send in the transcription request. Defaults to "Systran/faster-whisper-small". */
  model?: string;
  /** Optional logger. */
  log?: (msg: string) => void;
  /**
   * Injectable fetch implementation.
   * Defaults to the global `fetch` (available in Node 18+).
   */
  fetchFn?: FetchFn;
  /**
   * Timeout in milliseconds for the transcription HTTP request.
   * Defaults to 30 000 ms.
   */
  transcribeTimeoutMs?: number;
  /**
   * Timeout in milliseconds for the availability-check HTTP request.
   * Defaults to 3 000 ms.
   */
  availabilityTimeoutMs?: number;
}

// ---------------------------------------------------------------------------
// WAV builder (same as whisper-cpp adapter — avoids cross-adapter dep)
// ---------------------------------------------------------------------------

/** Build a minimal 44-byte WAV header + PCM data. */
function buildWav(pcm: Uint8Array, sampleRate = 16000): Buffer {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = pcm.byteLength;
  const buf = Buffer.alloc(44 + dataSize);

  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(numChannels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(byteRate, 28);
  buf.writeUInt16LE(blockAlign, 32);
  buf.writeUInt16LE(bitsPerSample, 34);
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(dataSize, 40);
  Buffer.from(pcm).copy(buf, 44);
  return buf;
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

/** M50-FWH-01 */
export class FasterWhisperHttpAdapter implements SttProvider {
  /** M50-FWH-08 */
  readonly kind = "stt" as const;
  readonly id = "faster-whisper-http";

  private readonly _baseUrl: string;
  private readonly _model: string;
  private readonly _log: (msg: string) => void;
  private readonly _fetch: FetchFn;
  private readonly _transcribeTimeoutMs: number;
  private readonly _availabilityTimeoutMs: number;

  /** M50-FWH-02 */
  constructor(options: FasterWhisperHttpAdapterOptions = {}) {
    this._baseUrl = (options.baseUrl ?? "http://localhost:8280").replace(/\/$/, "");
    this._model = options.model ?? "Systran/faster-whisper-small";
    this._log = options.log ?? (() => { /* no-op */ });
    this._fetch = options.fetchFn ?? (fetch as unknown as FetchFn);
    this._transcribeTimeoutMs = options.transcribeTimeoutMs ?? 30_000;
    this._availabilityTimeoutMs = options.availabilityTimeoutMs ?? 3_000;
  }

  /**
   * M50-FWH-03 — Availability check.
   *
   * Issues a GET /v1/models to the server. Returns true if the server
   * responds with HTTP 200, false on any error or non-200 status.
   */
  async isAvailable(): Promise<boolean> {
    const url = `${this._baseUrl}/v1/models`;
    let controller: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      controller = new AbortController();
      timer = setTimeout(() => controller!.abort(), this._availabilityTimeoutMs);
      const resp = await this._fetch(url, {
        method: "GET",
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!resp.ok) {
        this._log(`isAvailable: server responded ${resp.status} — marking unavailable`);
        return false;
      }
      this._log(`isAvailable: OK — ${this._baseUrl} is reachable`);
      return true;
    } catch (err) {
      if (timer !== undefined) clearTimeout(timer);
      this._log(`isAvailable: FAIL — cannot reach ${url}: ${String(err)}`);
      return false;
    }
  }

  /**
   * M50-FWH-04 — Transcribe audio via HTTP.
   *
   * Writes audio to a temp WAV file, then POSTs it as multipart/form-data.
   * The temp file is always cleaned up, even on error.
   */
  async transcribe(
    request: SttTranscriptionRequest,
    token?: CancellationToken,
  ): Promise<SttTranscriptionResult> {
    this._log(
      `transcribe: audioBytes=${request.audio.byteLength} sampleRate=${request.sampleRate ?? 16000} lang=${request.language}`,
    );

    if (request.audio.byteLength === 0) {
      this._log("transcribe: audio is empty — returning empty string");
      return { text: "" };
    }

    const tmpDir = await mkdtemp(join(tmpdir(), "accordo-fwh-"));
    const wavPath = join(tmpDir, "input.wav");

    try {
      const wavBuf = buildWav(request.audio, request.sampleRate ?? 16000);
      await writeFile(wavPath, wavBuf);
      this._log(`transcribe: wrote temp WAV ${wavPath} (${wavBuf.byteLength} bytes)`);

      const text = await this._postTranscription(wavBuf, request.language, token);
      this._log(`transcribe: result="${text.slice(0, 120)}"`);
      return { text };
    } finally {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async _postTranscription(
    wavBuf: Buffer,
    language: string,
    token?: CancellationToken,
  ): Promise<string> {
    const url = `${this._baseUrl}/v1/audio/transcriptions`;

    // M50-FWH-05 — Build multipart/form-data manually using FormData / Blob (Node 18+)
    const formData = new FormData();
    const blob = new Blob([wavBuf], { type: "audio/wav" });
    formData.append("file", blob, "input.wav");
    formData.append("model", this._model);
    if (language && language !== "auto") {
      // faster-whisper accepts BCP-47 but wants the 2-letter code
      const langCode = language.split("-")[0]!;
      formData.append("language", langCode);
    }
    formData.append("response_format", "json");

    // M50-FWH-06 — Abort controller ties together timeout + cancellation token
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this._transcribeTimeoutMs);

    const cancelDispose = token?.onCancellationRequested
      ? (() => { token.onCancellationRequested(() => controller.abort()); return undefined; })()
      : undefined;
    void cancelDispose; // only used for side-effect

    let response: Awaited<ReturnType<FetchFn>>;
    try {
      this._log(`transcribe: POST ${url} model=${this._model}`);
      response = await this._fetch(url, {
        method: "POST",
        body: formData as unknown as unknown,
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      if (token?.isCancellationRequested) {
        throw new Error("Operation cancelled");
      }
      throw new Error(`faster-whisper-server request failed: ${String(err)}`);
    }
    clearTimeout(timer);

    if (token?.isCancellationRequested) {
      throw new Error("Operation cancelled");
    }

    // M50-FWH-07 — Parse response
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `faster-whisper-server responded ${response.status}: ${body.slice(0, 300)}`,
      );
    }

    const json = await response.json() as Record<string, unknown>;
    const text = typeof json["text"] === "string" ? json["text"].trim() : "";
    return text;
  }
}
