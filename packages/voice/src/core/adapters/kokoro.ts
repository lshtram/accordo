/**
 * KokoroAdapter — TTS provider using kokoro-js (ONNX runtime, local).
 *
 * M50-KA
 */

import type { TtsProvider, TtsSynthesisRequest, TtsSynthesisResult } from "../providers/tts-provider.js";
import type { CancellationToken } from "../providers/stt-provider.js";

// ---------------------------------------------------------------------------
// Injectable seams for testing
// ---------------------------------------------------------------------------

/** Injectable stand-in for `require.resolve` (availability check). */
export type ResolveFn = (id: string) => string;

/** Injectable stand-in for `import(id)` (lazy model loading). */
export type DynamicImportFn = (id: string) => Promise<unknown>;

export interface KokoroAdapterOptions {
  resolveFn?: ResolveFn;
  importFn?: DynamicImportFn;
}

// ---------------------------------------------------------------------------
// Internal Kokoro model shape
// ---------------------------------------------------------------------------

interface KokoroModel {
  generate(
    text: string,
    opts?: { voice?: string; speed?: number },
  ): Promise<{ audio: Float32Array; sampling_rate: number }>;
}

interface KokoroModule {
  KokoroTTS: {
    from_pretrained(
      modelId: string,
      opts?: { dtype?: string },
    ): Promise<KokoroModel>;
  };
}

const KOKORO_MODEL_ID = "onnx-community/Kokoro-82M-ONNX";
const KOKORO_DTYPE = "q8";

// ---------------------------------------------------------------------------
// Silence-trim helper — M50-KA-06
// ---------------------------------------------------------------------------

export const SILENCE_THRESHOLD = 0.001;
export const SILENCE_PAD_SAMPLES = 240;

/**
 * Trim leading/trailing silence from a Float32Array of audio samples.
 * Exported standalone per M50-KA-06.
 */
export function trimSilence(
  samples: Float32Array,
  threshold = SILENCE_THRESHOLD,
  padSamples = SILENCE_PAD_SAMPLES,
): Float32Array {
  let start = 0;
  while (start < samples.length && Math.abs(samples[start]!) <= threshold) {
    start++;
  }

  let end = samples.length - 1;
  while (end > start && Math.abs(samples[end]!) <= threshold) {
    end--;
  }

  if (start > end) {
    return new Float32Array(0);
  }

  const paddedStart = Math.max(0, start - padSamples);
  const paddedEnd = Math.min(samples.length - 1, end + padSamples);
  return samples.slice(paddedStart, paddedEnd + 1);
}

// ---------------------------------------------------------------------------
// Float32 → Int16 PCM conversion
// ---------------------------------------------------------------------------

function float32ToInt16Pcm(samples: Float32Array): Uint8Array {
  const buf = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]!));
    buf[i] = Math.round(clamped * 32767);
  }
  return new Uint8Array(buf.buffer);
}

// ---------------------------------------------------------------------------
// KokoroAdapter — M50-KA-01
// ---------------------------------------------------------------------------

/** M50-KA-01 */
export class KokoroAdapter implements TtsProvider {
  /** M50-KA-08 */
  readonly kind = "tts" as const;
  readonly id = "kokoro";

  private readonly _resolve: ResolveFn;
  private readonly _import: DynamicImportFn;

  /** M50-KA-02 — cached availability result */
  private _available: boolean | undefined = undefined;
  /** M50-KA-03 — cached model instance */
  private _modelInstance: KokoroModel | null = null;
  /** M50-KA-04 — shared loading promise */
  private _loadingPromise: Promise<KokoroModel> | null = null;

  /** M50-KA constructor */
  constructor(options: KokoroAdapterOptions = {}) {
    this._resolve = options.resolveFn ?? ((id) => require.resolve(id));
    this._import = options.importFn ?? ((id) => import(id));
  }

  /** M50-KA-02 — cached after first check */
  async isAvailable(): Promise<boolean> {
    if (this._available !== undefined) {
      return this._available;
    }
    try {
      this._resolve("kokoro-js");
      this._available = true;
    } catch {
      this._available = false;
    }
    return this._available;
  }

  /** M50-KA-03 + M50-KA-04 — lazy load with shared promise */
  async synthesize(
    request: TtsSynthesisRequest,
    _token?: CancellationToken,
  ): Promise<TtsSynthesisResult> {
    const model = await this._loadModel();

    const { audio, sampling_rate } = await model.generate(request.text, {
      voice: request.voice,
      speed: request.speed,
    });

    // M50-KA-05: Float32 → trim silence → Int16 PCM → Uint8Array
    const trimmed = trimSilence(audio);
    const pcm = float32ToInt16Pcm(trimmed);

    return { audio: pcm, sampleRate: sampling_rate };
  }

  /** M50-KA-07 — clear cached instance */
  async dispose(): Promise<void> {
    this._modelInstance = null;
    this._loadingPromise = null;
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private _loadModel(): Promise<KokoroModel> {
    if (this._modelInstance !== null) {
      return Promise.resolve(this._modelInstance);
    }

    // M50-KA-04 — shared loading promise for concurrent callers
    if (this._loadingPromise !== null) {
      return this._loadingPromise;
    }

    this._loadingPromise = this._import("kokoro-js").then((mod) => {
      const kokoroMod = mod as KokoroModule;
      return kokoroMod.KokoroTTS.from_pretrained(KOKORO_MODEL_ID, { dtype: KOKORO_DTYPE });
    }).then((model) => {
      this._modelInstance = model;
      this._loadingPromise = null;
      return model;
    });

    return this._loadingPromise;
  }
}
