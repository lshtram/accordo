/**
 * sherpa-worker.ts — TTS worker subprocess for SherpaSubprocessAdapter.
 *
 * Runs as a standalone Node.js child process (NOT inside VS Code's extension
 * host), so the "External buffers are not allowed" sandboxing restriction does
 * not apply here.
 *
 * Protocol (newline-delimited JSON on stdin / stdout):
 *
 *   stdin → worker:
 *     { "id": "init",  "type": "init",       "modelDir": "...", "numThreads": 4 }
 *     { "id": "1",     "type": "synthesize",  "text": "...", "voice": "am_adam", "speed": 1.3 }
 *
 *   stdout → parent:
 *     { "id": "init",  "type": "ready" }
 *     { "id": "1",     "type": "audio",  "pcmBase64": "...", "sampleRate": 24000 }
 *     { "id": "...",   "type": "error",  "message": "..." }
 */

import { createRequire } from "node:module";
import * as readline from "node:readline";

const _require = createRequire(import.meta.url);

// ---------------------------------------------------------------------------
// Speaker IDs (kokoro-en-v0_19 — 11 speakers)
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
const DEFAULT_SID = 3; // af_sarah

// ---------------------------------------------------------------------------
// sherpa-onnx-node type stubs
// ---------------------------------------------------------------------------

interface SherpaAudio {
  samples: Float32Array;
  sampleRate: number;
}

interface SherpaGenerateReq {
  text: string;
  sid: number;
  speed: number;
}

interface SherpaOfflineTts {
  generate(req: SherpaGenerateReq): SherpaAudio;
  generateAsync?: (req: SherpaGenerateReq) => Promise<SherpaAudio>;
  free?: () => void;
}

interface SherpaModule {
  OfflineTts: {
    new (config: object): SherpaOfflineTts;
    createAsync?: (config: object) => Promise<SherpaOfflineTts>;
  };
}

// ---------------------------------------------------------------------------
// Wire
// ---------------------------------------------------------------------------

function float32ToInt16Base64(samples: Float32Array): string {
  const buf = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const c = Math.max(-1, Math.min(1, samples[i]!));
    buf[i] = Math.round(c * 32767);
  }
  return Buffer.from(buf.buffer).toString("base64");
}

function send(obj: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

let engine: SherpaOfflineTts | null = null;

async function handleInit(id: string, modelDir: string, numThreads: number): Promise<void> {
  try {
    const m = _require("sherpa-onnx-node") as SherpaModule;
    const resolved = m as { default?: SherpaModule } & SherpaModule;
    const { OfflineTts } = resolved.default ?? resolved;
    const config = {
      model: {
        kokoro: {
          model:   `${modelDir}/model.onnx`,
          voices:  `${modelDir}/voices.bin`,
          tokens:  `${modelDir}/tokens.txt`,
          dataDir: `${modelDir}/espeak-ng-data`,
        },
        debug: false,
        numThreads,
        provider: "cpu",
      },
      maxNumSentences: 1,
    };
    engine =
      typeof OfflineTts.createAsync === "function"
        ? await OfflineTts.createAsync(config)
        : new OfflineTts(config);
    send({ id, type: "ready" });
  } catch (err) {
    send({ id, type: "error", message: String(err) });
  }
}

async function handleSynthesize(
  id: string,
  text: string,
  voice: string | undefined,
  speed: number,
): Promise<void> {
  if (!engine) {
    send({ id, type: "error", message: "engine not initialized" });
    return;
  }
  try {
    const sid = SPEAKER_IDS[voice ?? "af_sarah"] ?? DEFAULT_SID;
    const audio: SherpaAudio =
      typeof engine.generateAsync === "function"
        ? await engine.generateAsync({ text, sid, speed })
        : engine.generate({ text, sid, speed });
    send({
      id,
      type: "audio",
      pcmBase64: float32ToInt16Base64(audio.samples),
      sampleRate: audio.sampleRate,
    });
  } catch (err) {
    send({ id, type: "error", message: String(err) });
  }
}

// ---------------------------------------------------------------------------
// Main loop — read stdin line by line
// ---------------------------------------------------------------------------

interface WorkerRequest {
  id: string;
  type: string;
  modelDir?: string;
  numThreads?: number;
  text?: string;
  voice?: string;
  speed?: number;
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });

rl.on("line", (line: string) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let req: WorkerRequest;
  try {
    req = JSON.parse(trimmed) as WorkerRequest;
  } catch {
    return;
  }

  if (req.type === "init") {
    void handleInit(req.id, req.modelDir ?? "", req.numThreads ?? 4);
  } else if (req.type === "synthesize") {
    void handleSynthesize(req.id, req.text ?? "", req.voice, req.speed ?? 1.0);
  }
});

// Exit cleanly when parent closes stdin
rl.on("close", () => {
  if (typeof engine?.free === "function") {
    engine.free();
  }
  process.exit(0);
});
