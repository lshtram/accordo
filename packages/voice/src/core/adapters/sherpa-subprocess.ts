/**
 * SherpaSubprocessAdapter — TTS provider that runs sherpa-onnx-node in a
 * standalone child process to work around VS Code extension host's
 * "External buffers are not allowed" sandboxing restriction.
 *
 * The worker (`sherpa-worker.js`) runs in plain Node.js where native addons
 * can use external ArrayBuffers freely. The adapter communicates with the
 * worker via newline-delimited JSON over stdin/stdout.
 *
 * M50-SP
 */

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import * as cp from "node:child_process";
import type { TtsProvider, TtsSynthesisRequest, TtsSynthesisResult } from "../providers/tts-provider.js";
import type { CancellationToken } from "../providers/stt-provider.js";

const _cjsRequire = createRequire(import.meta.url);

// ---------------------------------------------------------------------------
// Injectable seams
// ---------------------------------------------------------------------------

/** Factory function that spawns the worker subprocess. Injectable for tests. */
export type WorkerSpawnFn = (workerPath: string) => cp.ChildProcess;

export interface SherpaSubprocessAdapterOptions {
  /** Override model directory (default: ~/.accordo/models/kokoro-en-v0_19). */
  modelDir?: string;
  /** ONNX inference threads (default: 4). */
  numThreads?: number;
  /** Override module resolution (for testing availability check). */
  resolveFn?: (id: string) => string;
  /** Override file existence check (for testing availability check). */
  existsFn?: (p: string) => boolean;
  /** Override worker script path (the compiled sherpa-worker.js). */
  workerPath?: string;
  /** Override subprocess spawn (inject a fake worker in tests). */
  spawnFn?: WorkerSpawnFn;
  /** Override Node.js binary path (for testing). */
  nodePath?: string;
}

// ---------------------------------------------------------------------------
// Find a real (non-Electron) Node.js binary
// ---------------------------------------------------------------------------

/**
 * Locate a system Node.js binary that is NOT the Electron binary.
 *
 * Why: `process.execPath` inside VS Code points to the Electron binary.
 * Even with `ELECTRON_RUN_AS_NODE=1`, Electron's V8/NAPI layer still blocks
 * `napi_create_external_arraybuffer` ("External buffers are not allowed"),
 * which sherpa-onnx-node relies on.  We need a real Node.js binary.
 *
 * Strategy:
 *   1. `which node` — respects the user's PATH, works on macOS/Linux
 *   2. Well-known install locations (Homebrew, nvm, fnm, Volta, system)
 *   3. Fallback to `process.execPath` (will use ELECTRON_RUN_AS_NODE=1)
 */
export function findSystemNode(): string {
  // 1. `which node` — fast and portable
  try {
    const result = execFileSync("which", ["node"], {
      encoding: "utf8",
      timeout: 3000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (result && fs.existsSync(result)) return result;
  } catch { /* not found or timed out */ }

  // 2. Well-known paths (macOS / Linux)
  const candidates = [
    "/opt/homebrew/bin/node",               // Homebrew ARM Mac
    "/usr/local/bin/node",                  // Homebrew Intel Mac / system install
    path.join(os.homedir(), ".nvm/current/bin/node"),
    path.join(os.homedir(), ".local/share/fnm/aliases/default/bin/node"),
    path.join(os.homedir(), ".volta/bin/node"),
    "/usr/bin/node",                        // System package manager
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }

  // 3. Fallback — Electron with ELECTRON_RUN_AS_NODE=1 (may still fail for
  //    native addons that use external buffers, but it's better than nothing)
  return process.execPath;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface WorkerResponse {
  id: string;
  type: "ready" | "audio" | "error";
  pcmBase64?: string;
  sampleRate?: number;
  message?: string;
}

type PendingCb = (result: TtsSynthesisResult | Error) => void;

// ---------------------------------------------------------------------------
// Default helpers
// ---------------------------------------------------------------------------

function defaultModelDir(): string {
  return (
    process.env["SHERPA_KOKORO_MODEL_DIR"] ??
    path.join(os.homedir(), ".accordo", "models", "kokoro-en-v0_19")
  );
}

// ---------------------------------------------------------------------------
// SherpaSubprocessAdapter — M50-SP-01
// ---------------------------------------------------------------------------

/** M50-SP-01 */
export class SherpaSubprocessAdapter implements TtsProvider {
  readonly kind = "tts" as const;
  readonly id = "sherpa-subprocess";

  private readonly _modelDir: string;
  private readonly _numThreads: number;
  private readonly _resolve: (id: string) => string;
  private readonly _exists: (p: string) => boolean;
  private readonly _workerPath: string;
  private readonly _spawnFn: WorkerSpawnFn;
  private readonly _nodePath: string;

  /** M50-SP-02 — cached availability */
  private _available: boolean | undefined = undefined;

  // Worker lifecycle
  private _worker: cp.ChildProcess | null = null;
  private _workerReady = false;
  private _initPromise: Promise<void> | null = null;
  private _initResolve: (() => void) | null = null;
  private _initReject: ((err: Error) => void) | null = null;

  // Pending synthesis requests, keyed by request ID string
  private _pending = new Map<string, PendingCb>();
  private _reqId = 0;

  // Incomplete stdout line buffer
  private _stdoutBuf = "";

  constructor(opts: SherpaSubprocessAdapterOptions = {}) {
    this._modelDir   = opts.modelDir   ?? defaultModelDir();
    this._numThreads = opts.numThreads ?? 4;
    this._resolve    = opts.resolveFn  ?? ((id) => _cjsRequire.resolve(id));
    this._exists     = opts.existsFn   ?? ((p) => fs.existsSync(p));
    this._workerPath = opts.workerPath ??
      fileURLToPath(new URL("sherpa-worker.js", import.meta.url));
    this._nodePath = opts.nodePath ?? findSystemNode();
    this._spawnFn = opts.spawnFn ??
      ((wp) => cp.spawn(this._nodePath, [wp], {
        stdio: ["pipe", "pipe", "pipe"],
        // ELECTRON_RUN_AS_NODE is a no-op when _nodePath is real Node.js,
        // but harmless — and needed if findSystemNode() fell back to Electron.
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      }));

    // Eagerly cache availability (sync) so isAvailable() hot-path is instant
    try {
      this._resolve("sherpa-onnx-node");
      this._available = this._exists(path.join(this._modelDir, "model.onnx"));
    } catch {
      this._available = false;
    }
  }

  /** M50-SP-02 — is sherpa-onnx-node installed AND model present? */
  async isAvailable(): Promise<boolean> {
    if (this._available !== undefined) return this._available;
    try {
      this._resolve("sherpa-onnx-node");
      this._available = this._exists(path.join(this._modelDir, "model.onnx"));
    } catch {
      this._available = false;
    }
    return this._available;
  }

  /** M50-SP-03 — synthesize via worker subprocess */
  async synthesize(
    request: TtsSynthesisRequest,
    _token?: CancellationToken,
  ): Promise<TtsSynthesisResult> {
    await this._ensureWorker();

    return new Promise<TtsSynthesisResult>((resolve, reject) => {
      // Worker may have been disposed between _ensureWorker() and here
      if (this._worker === null) {
        reject(new Error("SherpaSubprocessAdapter disposed"));
        return;
      }
      const id = String(++this._reqId);
      this._pending.set(id, (result) => {
        if (result instanceof Error) reject(result);
        else resolve(result);
      });
      const msg =
        JSON.stringify({
          id,
          type: "synthesize",
          text: request.text,
          voice: request.voice,
          speed: request.speed ?? 1.0,
        }) + "\n";
      this._worker!.stdin!.write(msg);
    });
  }

  /** M50-SP-04 — dispose: close worker stdin, reject pending requests */
  async dispose(): Promise<void> {
    if (this._worker !== null) {
      this._worker.stdin?.end();
      this._worker = null;
    }
    this._workerReady = false;
    this._initPromise = null;
    this._initResolve = null;
    this._initReject = null;
    for (const [, cb] of this._pending) {
      cb(new Error("SherpaSubprocessAdapter disposed"));
    }
    this._pending.clear();
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  /** Ensure the worker is spawned and initialized. Concurrent callers share the same promise. */
  private _ensureWorker(): Promise<void> {
    if (this._workerReady) return Promise.resolve();
    if (this._initPromise !== null) return this._initPromise;

    this._initPromise = new Promise<void>((resolve, reject) => {
      this._initResolve = resolve;
      this._initReject = reject;

      const worker = this._spawnFn(this._workerPath);
      this._worker = worker;

      // Parse stdout line-by-line
      worker.stdout!.on("data", (chunk: Buffer | string) => {
        this._stdoutBuf += typeof chunk === "string" ? chunk : chunk.toString("utf8");
        const lines = this._stdoutBuf.split("\n");
        this._stdoutBuf = lines.pop()!;
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            this._handleMsg(JSON.parse(line) as WorkerResponse);
          } catch {
            // ignore malformed line
          }
        }
      });

      // Capture stderr so worker crashes produce useful diagnostics
      let stderrBuf = "";
      worker.stderr?.on("data", (chunk: Buffer | string) => {
        stderrBuf += typeof chunk === "string" ? chunk : chunk.toString("utf8");
        // Cap buffer to avoid unbounded growth on chatty workers
        if (stderrBuf.length > 4096) stderrBuf = stderrBuf.slice(-4096);
      });

      worker.on("error", (err: Error) => {
        this._initReject?.(err);
        this._clearInit();
        this._failAllPending(err);
      });

      worker.on("exit", (code) => {
        this._worker = null;
        this._workerReady = false;
        this._initPromise = null;
        this._clearInit();
        const detail = stderrBuf.trim();
        const msg = detail
          ? `sherpa worker exited (code ${code}): ${detail.slice(0, 300)}`
          : `sherpa worker exited unexpectedly (code ${code})`;
        this._failAllPending(new Error(msg));
      });

      // Send init message
      worker.stdin!.write(
        JSON.stringify({
          id: "init",
          type: "init",
          modelDir: this._modelDir,
          numThreads: this._numThreads,
        }) + "\n",
      );
    });

    return this._initPromise;
  }

  private _handleMsg(msg: WorkerResponse): void {
    if (msg.type === "ready" && msg.id === "init") {
      this._workerReady = true;
      this._initResolve?.();
      this._clearInit();
    } else if (msg.type === "error" && msg.id === "init") {
      const err = new Error(msg.message ?? "worker init failed");
      this._initReject?.(err);
      this._initPromise = null;
      this._clearInit();
    } else if (msg.type === "audio") {
      const cb = this._pending.get(msg.id);
      if (cb) {
        this._pending.delete(msg.id);
        const pcm = Buffer.from(msg.pcmBase64 ?? "", "base64");
        cb({ audio: new Uint8Array(pcm), sampleRate: msg.sampleRate ?? 24000 });
      }
    } else if (msg.type === "error") {
      const cb = this._pending.get(msg.id);
      if (cb) {
        this._pending.delete(msg.id);
        cb(new Error(msg.message ?? "synthesis failed"));
      }
    }
  }

  private _clearInit(): void {
    this._initResolve = null;
    this._initReject = null;
  }

  private _failAllPending(err: Error): void {
    for (const [, cb] of this._pending) cb(err);
    this._pending.clear();
  }
}
