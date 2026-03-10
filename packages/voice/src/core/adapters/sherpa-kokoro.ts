/**
 * SherpaKokoroAdapter — TTS provider using sherpa-onnx-node (C++ native addon).
 *
 * Benchmarks on Apple M1 (4 threads, kokoro-en-v0_19):
 *   KokoroAdapter (JS ONNX):   synth 2,000–9,200 ms/sentence  RTF 0.5–2.5
 *   SherpaKokoroAdapter:       synth   350–1,200 ms/sentence  RTF 0.35–0.43
 *
 * Model: kokoro-en-v0_19 (330 MB)
 *   Default location: ~/.accordo/models/kokoro-en-v0_19
 *   Override:         env SHERPA_KOKORO_MODEL_DIR
 *                     or constructor option modelDir
 *
 * M50-SK
 */

import { createRequire } from "node:module";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import type { TtsProvider, TtsSynthesisRequest, TtsSynthesisResult } from "../providers/tts-provider.js";
import type { CancellationToken } from "../providers/stt-provider.js";

/** CJS require scoped to this file — used only for availability check. */
const _cjsRequire = createRequire(import.meta.url);

// ---------------------------------------------------------------------------
// Injectable seams (for testing)
// ---------------------------------------------------------------------------

export type ResolveFn = (id: string) => string;
export type DynamicImportFn = (id: string) => Promise<unknown>;
export type ExistsFn = (p: string) => boolean;

export interface SherpaKokoroAdapterOptions {
  /** Override the kokoro-en-v0_19 model directory. */
  modelDir?: string;
  /** Number of ONNX inference threads. Sweet spot on M1 is 4. */
  numThreads?: number;
  resolveFn?: ResolveFn;
  importFn?: DynamicImportFn;
  existsFn?: ExistsFn;
}

// ---------------------------------------------------------------------------
// Speaker ID map — kokoro-en-v0_19 (11 speakers)
// ---------------------------------------------------------------------------

const SPEAKER_IDS: Record<string, number> = {
  af_heart:    0,
  af_bella:    1,
  af_nicole:   2,
  af_sarah:    3,
  af_sky:      4,
  am_adam:     5,
  am_michael:  6,
  bf_emma:     7,
  bf_isabella: 8,
  bm_george:   9,
  bm_lewis:   10,
};

export const DEFAULT_SPEAKER_ID = SPEAKER_IDS["af_sarah"]!; // 3
export const DEFAULT_NUM_THREADS = 4;

// ---------------------------------------------------------------------------
// Internal sherpa-onnx-node shape
// ---------------------------------------------------------------------------

interface SherpaAudio {
  samples: Float32Array;
  sampleRate: number;
}

interface SherpaGenerateRequest {
  text: string;
  sid: number;
  speed: number;
}

interface SherpaOfflineTts {
  readonly sampleRate: number;
  readonly numSpeakers: number;
  generate(req: SherpaGenerateRequest): SherpaAudio;
  generateAsync?: (req: SherpaGenerateRequest) => Promise<SherpaAudio>;
  free?: () => void;
}

interface SherpaModule {
  OfflineTts: {
    new (config: object): SherpaOfflineTts;
    createAsync?: (config: object) => Promise<SherpaOfflineTts>;
  };
}

// ---------------------------------------------------------------------------
// Default model directory
// ---------------------------------------------------------------------------

function defaultModelDir(): string {
  return (
    process.env["SHERPA_KOKORO_MODEL_DIR"] ??
    path.join(os.homedir(), ".accordo", "models", "kokoro-en-v0_19")
  );
}

// ---------------------------------------------------------------------------
// Float32 → Int16 PCM
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
// SherpaKokoroAdapter — M50-SK-01
// ---------------------------------------------------------------------------

/** M50-SK-01 */
export class SherpaKokoroAdapter implements TtsProvider {
  readonly kind = "tts" as const;
  readonly id = "sherpa-kokoro";

  private readonly _modelDir: string;
  private readonly _numThreads: number;
  private readonly _resolve: ResolveFn;
  private readonly _import: DynamicImportFn;
  private readonly _exists: ExistsFn;

  /** M50-SK-02 — cached availability */
  private _available: boolean | undefined = undefined;
  /** M50-SK-03 — cached engine */
  private _engine: SherpaOfflineTts | null = null;
  /** M50-SK-04 — shared loading promise */
  private _loadingPromise: Promise<SherpaOfflineTts> | null = null;

  constructor(options: SherpaKokoroAdapterOptions = {}) {
    this._modelDir   = options.modelDir   ?? defaultModelDir();
    this._numThreads = options.numThreads ?? DEFAULT_NUM_THREADS;
    this._resolve    = options.resolveFn  ?? ((id) => _cjsRequire.resolve(id));
    this._import     = options.importFn   ?? ((id) => import(id));
    this._exists     = options.existsFn   ?? ((p) => fs.existsSync(p));

    // Eagerly cache availability so isAvailable() hot-path is sync
    try {
      this._resolve("sherpa-onnx-node");
      const modelOnnx = path.join(this._modelDir, "model.onnx");
      this._available = this._exists(modelOnnx);
    } catch {
      this._available = false;
    }
  }

  /** M50-SK-02 — is sherpa-onnx-node installed AND model present? */
  async isAvailable(): Promise<boolean> {
    if (this._available !== undefined) return this._available;
    try {
      this._resolve("sherpa-onnx-node");
      const modelOnnx = path.join(this._modelDir, "model.onnx");
      this._available = this._exists(modelOnnx);
    } catch {
      this._available = false;
    }
    return this._available;
  }

  /** M50-SK-03 + M50-SK-04 — lazy load with shared promise, async synthesis */
  async synthesize(
    request: TtsSynthesisRequest,
    _token?: CancellationToken,
  ): Promise<TtsSynthesisResult> {
    const engine = await this._loadEngine();

    const sid   = SPEAKER_IDS[request.voice ?? "af_sarah"] ?? DEFAULT_SPEAKER_ID;
    const speed = request.speed ?? 1.0;

    // Prefer generateAsync (runs on libuv thread pool, non-blocking) if the
    // native addon exposes it; fall back to sync generate() on old versions or
    // when the VS Code extension host's thread pool is saturated (same root
    // cause as the createAsync timeout above).
    const sherpaAudio: SherpaAudio =
      typeof engine.generateAsync === "function"
        ? await Promise.race<SherpaAudio>([
            engine.generateAsync({ text: request.text, sid, speed }),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error("generateAsync timed out")), 2000)),
          ]).catch(() => engine.generate({ text: request.text, sid, speed }))
        : engine.generate({ text: request.text, sid, speed });

    const pcm = float32ToInt16Pcm(sherpaAudio.samples);
    return { audio: pcm, sampleRate: sherpaAudio.sampleRate };
  }

  /** M50-SK-05 — dispose engine */
  async dispose(): Promise<void> {
    if (this._engine !== null) {
      if (typeof this._engine.free === "function") {
        this._engine.free();
      }
      this._engine = null;
    }
    this._loadingPromise = null;
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private _loadEngine(): Promise<SherpaOfflineTts> {
    if (this._engine !== null) return Promise.resolve(this._engine);
    if (this._loadingPromise !== null) return this._loadingPromise;

    this._loadingPromise = this._import("sherpa-onnx-node").then(async (mod) => {
      // sherpa-onnx-node is a CJS module wrapped in an ESM default export —
      // OfflineTts lives on .default, not at the top level.
      const resolved = (mod as { default?: SherpaModule } & SherpaModule);
      const { OfflineTts } = resolved.default ?? resolved;
      const config = this._buildConfig();

      // Prefer createAsync() (non-blocking engine init using the libuv thread
      // pool). However, in VS Code's extension host the thread pool can be
      // saturated by VS Code's own internals, causing createAsync to never
      // resolve. Race against a 3 s deadline and fall back to the synchronous
      // constructor (brief main-thread block, but reliable).
      const engine: SherpaOfflineTts =
        typeof OfflineTts.createAsync === "function"
          ? await Promise.race<SherpaOfflineTts>([
              OfflineTts.createAsync(config),
              new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error("createAsync timed out")), 3000)),
            ]).catch(() => new OfflineTts(config) as SherpaOfflineTts)
          : new OfflineTts(config);

      this._engine = engine;
      this._loadingPromise = null;
      return engine;
    });

    return this._loadingPromise;
  }

  private _buildConfig(): object {
    return {
      model: {
        kokoro: {
          model:   path.join(this._modelDir, "model.onnx"),
          voices:  path.join(this._modelDir, "voices.bin"),
          tokens:  path.join(this._modelDir, "tokens.txt"),
          dataDir: path.join(this._modelDir, "espeak-ng-data"),
        },
        debug:      false,
        numThreads: this._numThreads,
        provider:   "cpu",
      },
      maxNumSentences: 1,
    };
  }
}
