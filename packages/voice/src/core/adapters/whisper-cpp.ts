/**
 * WhisperCppAdapter — STT provider using whisper.cpp CLI binary.
 *
 * M50-WA
 */

import { access, mkdtemp, readdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, isAbsolute, resolve as resolvePath } from "node:path";
import { spawn as nodeSpawn } from "node:child_process";
import type { SttProvider, SttTranscriptionRequest, SttTranscriptionResult, CancellationToken } from "../providers/stt-provider.js";

/** Subset of child_process.spawn needed by the adapter (injectable for tests). */
export type SpawnFn = (
  cmd: string,
  args: string[],
  options: { stdio: "pipe" },
) => {
  kill(): void;
  stdout?: { on(event: "data", cb: (chunk: Buffer) => void): void };
  stderr?: { on(event: "data", cb: (chunk: Buffer) => void): void };
  on(event: "error", cb: (err: Error) => void): void;
  on(event: "close", cb: (code: number | null) => void): void;
};

export interface WhisperCppAdapterOptions {
  binaryPath?: string;
  modelFolder?: string;
  modelFile?: string;
  spawnFn?: SpawnFn;
  /** Optional logger — receives whisper CLI args, exit code, stderr, etc. */
  log?: (msg: string) => void;
  /**
   * Override model resolution for testing.
   * If provided, used instead of the built-in auto-discovery.
   * Return null to simulate "no model found".
   */
  resolveModelFn?: (folder: string, file: string, log: (msg: string) => void) => Promise<string | null>;
}

const DEFAULT_BINARY = "whisper";
const DEFAULT_MODEL_FOLDER = "";
const DEFAULT_MODEL_FILE = "ggml-base.en.bin";

/**
 * Directories to search for ggml model files when modelFolder is not configured.
 * Checked in order — first directory containing any *.bin file wins.
 */
function getModelSearchDirs(): string[] {
  const home = homedir();
  const dirs: string[] = [];

  if (process.platform === "win32") {
    // Windows: common hand-installed and Scoop locations
    const appData = process.env["APPDATA"] ?? join(home, "AppData", "Roaming");
    const localAppData = process.env["LOCALAPPDATA"] ?? join(home, "AppData", "Local");
    dirs.push(
      join(home, ".whisper", "models"),           // dotfile mirror for cross-platform scripts
      join(appData, "whisper", "models"),          // common hand-install location
      join(localAppData, "whisper", "models"),     // alternative hand-install location
      join(home, "scoop", "apps", "whisper-cpp", "current", "models"), // Scoop
      join(localAppData, "Programs", "whisper-cpp", "models"),  // installer-style
      join(tmpdir(), "whisper-models"),
    );
  } else {
    // macOS / Linux
    dirs.push(
      // VoiceInk ships whisper.cpp models here on macOS
      join(home, "Library", "Application Support", "com.prakashjoshipax.VoiceInk", "WhisperModels"),
      // Homebrew whisper-cpp (stable + versioned)
      "/opt/homebrew/share/whisper-cpp",
      "/opt/homebrew/Cellar/whisper-cpp/1.8.3/share/whisper-cpp",
      "/usr/local/share/whisper",
      "/usr/share/whisper",
      // Common XDG / home locations
      join(home, ".whisper", "models"),
      join(home, ".cache", "whisper"),
      join(tmpdir(), "whisper-models"),
    );
  }

  return dirs;
}

/** Resolve the absolute model path from config, or auto-discover from known dirs. */
async function resolveModelPath(
  modelFolder: string,
  modelFile: string,
  log: (msg: string) => void,
): Promise<string | null> {
  // 1. Explicit config — honor it if non-empty
  if (modelFolder.trim()) {
    const p = isAbsolute(modelFolder) ? join(modelFolder, modelFile) : resolvePath(modelFolder, modelFile);
    try {
      await access(p);
      log(`model: using configured path ${p}`);
      return p;
    } catch {
      log(`model: configured path not found: ${p}`);
    }
  }

  // 2. Auto-discover: look for any *.bin file in known dirs
  const searchDirs = getModelSearchDirs();
  for (const dir of searchDirs) {
    try {
      const files = await readdir(dir);
      const bins = files.filter((f) => f.endsWith(".bin"));
      if (bins.length > 0) {
        // Prefer exact modelFile name, otherwise take first found
        const preferred = bins.includes(modelFile) ? modelFile : bins[0]!;
        const p = join(dir, preferred);
        log(`model: auto-discovered ${p}`);
        return p;
      }
    } catch {
      // dir doesn't exist or not readable — skip
    }
  }

  log(
    `model: no model file found. Searched:\n` +
    searchDirs.map((d) => `  ${d}`).join("\n") +
    `\nSet accordo.voice.whisperModelFolder in VS Code settings, or download a model from https://huggingface.co/ggerganov/whisper.cpp`,
  );
  return null;
}

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
  private readonly _log: (msg: string) => void;
  private readonly _resolveModel: (folder: string, file: string, log: (msg: string) => void) => Promise<string | null>;

  /** M50-WA-02 */
  constructor(options: WhisperCppAdapterOptions = {}) {
    this._binaryPath = options.binaryPath ?? DEFAULT_BINARY;
    this._modelFolder = options.modelFolder ?? DEFAULT_MODEL_FOLDER;
    this._modelFile = options.modelFile ?? DEFAULT_MODEL_FILE;
    this._spawn = options.spawnFn ?? (nodeSpawn as unknown as SpawnFn);
    this._log = options.log ?? (() => { /* no-op */ });
    this._resolveModel = options.resolveModelFn ?? resolveModelPath;
  }

  /** M50-WA-03 */
  async isAvailable(): Promise<boolean> {
    // Check 1: binary on PATH
    const binaryOk = await new Promise<boolean>((resolve) => {
      let settled = false;
      const proc = this._spawn(this._binaryPath, ["--help"], { stdio: "pipe" });
      proc.on("error", (err) => {
        if (settled) return;
        settled = true;
        this._log(`isAvailable: binary "${this._binaryPath}" not found — ${String(err)}`);
        resolve(false);
      });
      proc.on("close", (code) => {
        if (settled) return;
        settled = true;
        if (code !== 0) this._log(`isAvailable: binary "${this._binaryPath}" --help exited ${String(code)}`);
        resolve(code === 0);
      });
    });

    if (!binaryOk) {
      const installHint = process.platform === "win32"
      ? "scoop install whisper-cpp then set accordo.voice.whisperPath to \"whisper-cli\""
      : process.platform === "darwin"
        ? "brew install whisper-cpp then set accordo.voice.whisperPath to \"whisper-cpp\""
        : "build from https://github.com/ggerganov/whisper.cpp or use your package manager";
    this._log(`isAvailable: FAIL — whisper binary not found at "${this._binaryPath}". ${installHint}.`);
      return false;
    }

    // Check 2: model file exists (or can be auto-discovered)
    const modelPath = await this._resolveModel(this._modelFolder, this._modelFile, this._log);
    if (!modelPath) {
      this._log(`isAvailable: FAIL — no whisper model file found. Download one at https://huggingface.co/ggerganov/whisper.cpp and set accordo.voice.whisperModelFolder.`);
      return false;
    }

    this._log(`isAvailable: OK — binary=${this._binaryPath} model=${modelPath}`);
    return true;
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

    this._log(`transcribe: audioBytes=${request.audio.byteLength} sampleRate=${request.sampleRate} lang=${request.language ?? "auto"}`);

    if (request.audio.byteLength === 0) {
      this._log("transcribe: audio is empty — skipping whisper, returning empty string");
      return { text: "" };
    }

    const modelPath = await this._resolveModel(this._modelFolder, this._modelFile, this._log);
    if (!modelPath) {
      throw new Error(
        `No whisper model file found. Download a model from https://huggingface.co/ggerganov/whisper.cpp ` +
        `and set accordo.voice.whisperModelFolder in VS Code settings.`,
      );
    }

    try {
      await writeFile(wavPath, buildWav(request.audio, request.sampleRate));

      this._log(`transcribe: wavPath=${wavPath} modelPath=${modelPath} prefix=${prefix}`);
      const text = await this._runWhisper(wavPath, modelPath, prefix, token);
      this._log(`transcribe: result="${text.slice(0, 120)}"`);  
      return { text };
    } finally {
      // M50-WA-05 — always clean up temp files
      await Promise.allSettled([unlink(wavPath), unlink(txtPath)]);
      await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
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
      const stderrChunks: Buffer[] = [];

      const args = ["-m", modelPath, "-otxt", "-of", prefix, "-f", wavPath];
      this._log(`whisper cmd: ${this._binaryPath} ${args.join(" ")}`);

      const proc = this._spawn(
        this._binaryPath,
        args,
        { stdio: "pipe" },
      );

      proc.stderr?.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
      token?.onCancellationRequested(() => {
        if (settled) return;
        settled = true;
        proc.kill();
        reject(new Error("Operation cancelled"));
      });

      /** M50-WA-06 — check token on close */
      const finish = (code: number | null): void => {
        if (settled) return; // M50-WA-07 — settled-guard

        const stderrText = Buffer.concat(stderrChunks).toString("utf8").trim();
        if (stderrText) this._log(`whisper stderr: ${stderrText.slice(0, 500)}`);
        this._log(`whisper exit code: ${String(code)}`);

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
        // whisper may write no output file when audio is silent/too short
        readFile(`${prefix}.txt`, "utf8")
          .then((text) => resolve(typeof text === "string" ? text.trim() : String(text).trim()))
          .catch((err: NodeJS.ErrnoException) => {
            if (err.code === "ENOENT") {
              this._log("whisper wrote no output.txt — treating as empty transcript");
              resolve("");
            } else {
              reject(err);
            }
          });
      };

      proc.on("error", (err) => {
        if (settled) return; // M50-WA-07
        settled = true;
        this._log(`whisper spawn error: ${String(err)}`);
        reject(err);
      });

      proc.on("close", finish);
    });
  }
}
