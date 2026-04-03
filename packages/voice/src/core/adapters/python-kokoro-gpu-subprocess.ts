import * as cp from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { TtsProvider, TtsSynthesisRequest, TtsSynthesisResult } from "../providers/tts-provider.js";
import type { CancellationToken } from "../providers/stt-provider.js";

export type PythonWorkerSpawnFn = () => cp.ChildProcess;

interface WorkerResponse {
  id: string;
  type: "ready" | "audio" | "error";
  pcmBase64?: string;
  sampleRate?: number;
  message?: string;
}

type PendingCb = (result: TtsSynthesisResult | Error) => void;

export interface PythonKokoroGpuSubprocessAdapterOptions {
  pythonPath?: string;
  repoId?: string;
  spawnFn?: PythonWorkerSpawnFn;
  existsFn?: (p: string) => boolean;
}

function defaultPythonPath(): string {
  return path.join(os.homedir(), ".accordo", "kokoro-gpu-exp", "bin", "python");
}

const WORKER_SCRIPT = String.raw`
import base64
import json
import sys

pipeline = None

def send(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()

def init_pipeline(repo_id):
    global pipeline
    import torch
    from kokoro import KPipeline
    if not torch.cuda.is_available():
        raise RuntimeError("CUDA is not available in this Python environment")
    pipeline = KPipeline(lang_code='a', device='cuda', repo_id=repo_id)
    send({"id": "init", "type": "ready"})

def synthesize(req):
    global pipeline
    if pipeline is None:
        send({"id": req.get("id", "?"), "type": "error", "message": "engine not initialized"})
        return
    import numpy as np
    text = req.get("text", "")
    voice = req.get("voice") or "af_sarah"
    speed = req.get("speed", 1.0)
    try:
        result = next(iter(pipeline(text, voice=voice, speed=speed)))
        audio = np.asarray(result.audio)
        pcm = np.clip(audio, -1.0, 1.0)
        pcm16 = (pcm * 32767.0).astype('<i2')
        send({
            "id": req.get("id", "?"),
            "type": "audio",
            "pcmBase64": base64.b64encode(pcm16.tobytes()).decode("ascii"),
            "sampleRate": 24000,
        })
    except Exception as e:
        send({"id": req.get("id", "?"), "type": "error", "message": str(e)})

for raw in sys.stdin:
    line = raw.strip()
    if not line:
        continue
    try:
        req = json.loads(line)
    except Exception:
        continue
    if req.get("type") == "init":
        try:
            init_pipeline(req.get("repoId") or "hexgrad/Kokoro-82M")
        except Exception as e:
            send({"id": "init", "type": "error", "message": str(e)})
    elif req.get("type") == "synthesize":
        synthesize(req)
`;

export class PythonKokoroGpuSubprocessAdapter implements TtsProvider {
  readonly kind = "tts" as const;
  readonly id = "python-kokoro-gpu-subprocess";

  private readonly _pythonPath: string;
  private readonly _repoId: string;
  private readonly _spawnFn: PythonWorkerSpawnFn;
  private readonly _exists: (p: string) => boolean;
  private _available: boolean | undefined = undefined;
  private _worker: cp.ChildProcess | null = null;
  private _workerReady = false;
  private _initPromise: Promise<void> | null = null;
  private _initResolve: (() => void) | null = null;
  private _initReject: ((err: Error) => void) | null = null;
  private _pending = new Map<string, PendingCb>();
  private _reqId = 0;
  private _stdoutBuf = "";

  constructor(opts: PythonKokoroGpuSubprocessAdapterOptions = {}) {
    this._pythonPath = opts.pythonPath ?? defaultPythonPath();
    this._repoId = opts.repoId ?? "hexgrad/Kokoro-82M";
    this._exists = opts.existsFn ?? ((p) => fs.existsSync(p));
    this._spawnFn = opts.spawnFn ?? (() => cp.spawn(this._pythonPath, ["-u", "-c", WORKER_SCRIPT], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    }));
    this._available = this._exists(this._pythonPath);
  }

  async isAvailable(): Promise<boolean> {
    if (this._available !== undefined) return this._available;
    this._available = this._exists(this._pythonPath);
    return this._available;
  }

  async synthesize(request: TtsSynthesisRequest, _token?: CancellationToken): Promise<TtsSynthesisResult> {
    await this._ensureWorker();
    return new Promise<TtsSynthesisResult>((resolve, reject) => {
      if (this._worker === null) {
        reject(new Error("PythonKokoroGpuSubprocessAdapter disposed"));
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
      cb(new Error("PythonKokoroGpuSubprocessAdapter disposed"));
    }
    this._pending.clear();
  }

  private _ensureWorker(): Promise<void> {
    if (this._workerReady) return Promise.resolve();
    if (this._initPromise !== null) return this._initPromise;
    this._initPromise = new Promise<void>((resolve, reject) => {
      this._initResolve = resolve;
      this._initReject = reject;
      const worker = this._spawnFn();
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
      worker.stdin!.write(JSON.stringify({ id: "init", type: "init", repoId: this._repoId }) + "\n");
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
      cb({ audio: Uint8Array.from(Buffer.from(msg.pcmBase64, "base64")), sampleRate: msg.sampleRate ?? 24000 });
    } else {
      cb(new Error(msg.message ?? "worker synthesis failed"));
    }
  }
}
