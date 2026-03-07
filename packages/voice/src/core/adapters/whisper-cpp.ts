/**
 * WhisperCppAdapter — STT provider using whisper.cpp CLI binary.
 *
 * M50-WA
 */

import { mkdtemp, readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn as nodeSpawn } from "node:child_process";
import type { SttProvider, SttTranscriptionRequest, SttTranscriptionResult, CancellationToken } from "../providers/stt-provider.js";

/** Subset of child_process.spawn needed by the adapter (injectable for tests). */
export type SpawnFn = (
  cmd: string,
  args: string[],
  options: { stdio: "pipe" },
) => {
  kill(): void;
  on(event: "error", cb: (err: Error) => void): void;
  on(event: "close", cb: (code: number | null) => void): void;
};

export interface WhisperCppAdapterOptions {
  binaryPath?: string;
  modelFolder?: string;
  modelFile?: string;
  spawnFn?: SpawnFn;
}

const DEFAULT_BINARY = "whisper";
const DEFAULT_MODEL_FOLDER = join(tmpdir(), "whisper-models");
const DEFAULT_MODEL_FILE = "ggml-base.en.bin";

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

/** M50-WA-01 */
export class WhisperCppAdapter implements SttProvider {
  /** M50-WA-08 */
  readonly kind = "stt" as const;
  readonly id = "whisper.cpp";

  private readonly _binaryPath: string;
  private readonly _modelFolder: string;
  private readonly _modelFile: string;
  private readonly _spawn: SpawnFn;

  /** M50-WA-02 */
  constructor(options: WhisperCppAdapterOptions = {}) {
    this._binaryPath = options.binaryPath ?? DEFAULT_BINARY;
    this._modelFolder = options.modelFolder ?? DEFAULT_MODEL_FOLDER;
    this._modelFile = options.modelFile ?? DEFAULT_MODEL_FILE;
    this._spawn = options.spawnFn ?? (nodeSpawn as unknown as SpawnFn);
  }

  /** M50-WA-03 */
  async isAvailable(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const proc = this._spawn(this._binaryPath, ["--help"], { stdio: "pipe" });

      proc.on("error", () => {
        if (settled) return;
        settled = true;
        resolve(false);
      });

      proc.on("close", (code) => {
        if (settled) return;
        settled = true;
        resolve(code === 0);
      });
    });
  }

  /** M50-WA-04 */
  async transcribe(
    request: SttTranscriptionRequest,
    token?: CancellationToken,
  ): Promise<SttTranscriptionResult> {
    const tmpDir = await mkdtemp(join(tmpdir(), "accordo-voice-"));
    const wavPath = join(tmpDir, "input.wav");
    const prefix = join(tmpDir, "output");
    const txtPath = `${prefix}.txt`;

    try {
      await writeFile(wavPath, buildWav(request.audio, request.sampleRate));

      const modelPath = join(this._modelFolder, this._modelFile);
      const text = await this._runWhisper(wavPath, modelPath, prefix, token);
      return { text };
    } finally {
      // M50-WA-05 — always clean up temp files
      await Promise.allSettled([unlink(wavPath), unlink(txtPath)]);
    }
  }

  private _runWhisper(
    wavPath: string,
    modelPath: string,
    prefix: string,
    token?: CancellationToken,
  ): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      let settled = false;

      const proc = this._spawn(
        this._binaryPath,
        ["-m", modelPath, "-otxt", "-of", prefix, "-f", wavPath],
        { stdio: "pipe" },
      );

      /** M50-WA-06 — check token on close */
      const finish = (code: number | null): void => {
        if (settled) return; // M50-WA-07 — settled-guard

        if (token?.isCancellationRequested) {
          settled = true;
          proc.kill();
          reject(new Error("Operation cancelled"));
          return;
        }

        if (code !== 0) {
          settled = true;
          reject(new Error(`whisper exited with code ${String(code)}`));
          return;
        }

        settled = true;
        readFile(`${prefix}.txt`, "utf8")
          .then((text) => resolve(typeof text === "string" ? text.trim() : String(text).trim()))
          .catch(reject);
      };

      proc.on("error", (err) => {
        if (settled) return; // M50-WA-07
        settled = true;
        reject(err);
      });

      proc.on("close", finish);
    });
  }
}
