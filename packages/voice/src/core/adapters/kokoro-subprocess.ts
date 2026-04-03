import { fileURLToPath } from "node:url";
import * as cp from "node:child_process";
import { createRequire } from "node:module";
import type { TtsProvider, TtsSynthesisRequest, TtsSynthesisResult } from "../providers/tts-provider.js";
import type { CancellationToken } from "../providers/stt-provider.js";
import { findSystemNode } from "./sherpa-subprocess.js";

const _cjsRequire = createRequire(import.meta.url);

export type WorkerSpawnFn = (workerPath: string) => cp.ChildProcess;

interface WorkerResponse {
  id: string;
  type: "ready" | "audio" | "error";
  pcmBase64?: string;
  sampleRate?: number;
  message?: string;
}

type PendingCb = (result: TtsSynthesisResult | Error) => void;

export interface KokoroSubprocessAdapterOptions {
  resolveFn?: (id: string) => string;
  workerPath?: string;
  spawnFn?: WorkerSpawnFn;
  nodePath?: string;
}

export class KokoroSubprocessAdapter implements TtsProvider {
  readonly kind = "tts" as const;
  readonly id = "kokoro-subprocess";

  private readonly _resolve: (id: string) => string;
  private readonly _workerPath: string;
  private readonly _spawnFn: WorkerSpawnFn;
  private readonly _nodePath: string;
  private _available: boolean | undefined = undefined;
  private _worker: cp.ChildProcess | null = null;
  private _workerReady = false;
  private _initPromise: Promise<void> | null = null;
  private _initResolve: (() => void) | null = null;
  private _initReject: ((err: Error) => void) | null = null;
  private _pending = new Map<string, PendingCb>();
  private _reqId = 0;
  private _stdoutBuf = "";

  constructor(opts: KokoroSubprocessAdapterOptions = {}) {
    this._resolve = opts.resolveFn ?? ((id) => _cjsRequire.resolve(id));
    this._workerPath = opts.workerPath ?? fileURLToPath(new URL("kokoro-worker.js", import.meta.url));
    this._nodePath = opts.nodePath ?? findSystemNode();
    this._spawnFn = opts.spawnFn ??
      ((wp) => cp.spawn(this._nodePath, [wp], { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env } }));
    try {
      this._resolve("kokoro-js");
      this._available = true;
    } catch {
      this._available = false;
    }
  }

  async isAvailable(): Promise<boolean> {
    if (this._available !== undefined) return this._available;
    try {
      this._resolve("kokoro-js");
      this._available = true;
    } catch {
      this._available = false;
    }
    return this._available;
  }

  async synthesize(request: TtsSynthesisRequest, _token?: CancellationToken): Promise<TtsSynthesisResult> {
    await this._ensureWorker();
    return new Promise<TtsSynthesisResult>((resolve, reject) => {
      if (this._worker === null) {
        reject(new Error("KokoroSubprocessAdapter disposed"));
        return;
      }
      const id = String(++this._reqId);
      this._pending.set(id, (result) => {
        if (result instanceof Error) reject(result);
        else resolve(result);
      });
      const msg = JSON.stringify({
        id,
        type: "synthesize",
        text: request.text,
        language: request.language,
        voice: request.voice,
        speed: request.speed ?? 1.0,
      }) + "\n";
      this._worker.stdin!.write(msg);
    });
  }

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
      cb(new Error("KokoroSubprocessAdapter disposed"));
    }
    this._pending.clear();
  }

  private _ensureWorker(): Promise<void> {
    if (this._workerReady) return Promise.resolve();
    if (this._initPromise !== null) return this._initPromise;
    this._initPromise = new Promise<void>((resolve, reject) => {
      this._initResolve = resolve;
      this._initReject = reject;
      const worker = this._spawnFn(this._workerPath);
      this._worker = worker;
      worker.stdout!.on("data", (chunk: Buffer | string) => {
        this._stdoutBuf += typeof chunk === "string" ? chunk : chunk.toString("utf8");
        const lines = this._stdoutBuf.split("\n");
        this._stdoutBuf = lines.pop()!;
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            this._handleWorkerMessage(JSON.parse(line) as WorkerResponse);
          } catch {
            /* ignore malformed worker line */
          }
        }
      });
      worker.on("error", (err) => {
        if (this._initReject) {
          this._initReject(err);
          this._initReject = null;
          this._initResolve = null;
        }
        for (const [, cb] of this._pending) cb(err);
        this._pending.clear();
      });
      worker.stderr?.on("data", () => {
        /* worker reports protocol errors on stdout */
      });
      worker.stdin!.write(JSON.stringify({ id: "init", type: "init" }) + "\n");
    });
    return this._initPromise;
  }

  private _handleWorkerMessage(msg: WorkerResponse): void {
    if (msg.id === "init") {
      if (msg.type === "ready") {
        this._workerReady = true;
        this._initResolve?.();
      } else {
        this._initReject?.(new Error(msg.message ?? "worker init failed"));
      }
      this._initResolve = null;
      this._initReject = null;
      this._initPromise = null;
      return;
    }
    const cb = this._pending.get(msg.id);
    if (!cb) return;
    this._pending.delete(msg.id);
    if (msg.type === "audio" && msg.pcmBase64) {
      cb({ audio: Uint8Array.from(Buffer.from(msg.pcmBase64, "base64")), sampleRate: msg.sampleRate });
    } else {
      cb(new Error(msg.message ?? "worker synthesis failed"));
    }
  }
}
