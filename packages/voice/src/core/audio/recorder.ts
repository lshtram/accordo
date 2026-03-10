/**
 * recorder.ts — Microphone capture via `sox` CLI.
 *
 * Uses `sox` (Sound eXchange) which ships with macOS via Homebrew and is
 * available on Linux. Falls back gracefully if not installed.
 *
 * M50-REC
 */

import { spawn } from "node:child_process";
import type { RecordingHandle } from "../../tools/dictation.js";

export interface RecorderHandle extends RecordingHandle {
  waitUntilReady(): Promise<void>;
}

// ── platform defaults ─────────────────────────────────────────────────────────

/** sox args differ slightly by platform. */
function buildSoxArgs(sampleRate: number): string[] {
  const platform = process.platform;

  if (platform === "darwin") {
    // macOS: use CoreAudio input (default device)
    return [
      "-t", "coreaudio", "default",
      "-r", String(sampleRate),
      "-c", "1",
      "-b", "16",
      "-e", "signed-integer",
      "-t", "raw",
      "-",
    ];
  }

  if (platform === "linux") {
    // Linux: use ALSA default device
    return [
      "-t", "alsa", "default",
      "-r", String(sampleRate),
      "-c", "1",
      "-b", "16",
      "-e", "signed-integer",
      "-t", "raw",
      "-",
    ];
  }

  // Windows: use waveaudio
  return [
    "-t", "waveaudio", "default",
    "-r", String(sampleRate),
    "-c", "1",
    "-b", "16",
    "-e", "signed-integer",
    "-t", "raw",
    "-",
  ];
}

// ── startRecording ────────────────────────────────────────────────────────────

/**
 * Start microphone capture using `sox`.
 * Returns a handle whose `stop()` kills the sox process and resolves
 * with the accumulated raw PCM bytes (signed 16-bit LE, mono).
 *
 * M50-REC-01
 */
export function startRecording(sampleRate = 16000, log?: (msg: string) => void): RecorderHandle {
  const _log = log ?? (() => { /* no-op */ });
  const chunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  const startTs = Date.now();

  const args = buildSoxArgs(sampleRate);
  _log(`sox start: sox ${args.join(" ")}`);

  const proc = spawn("sox", args, { stdio: ["ignore", "pipe", "pipe"] });
  let ready = false;
  let resolveReady: (() => void) | undefined;
  const readyPromise = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });
  const markReady = (): void => {
    if (ready) return;
    ready = true;
    resolveReady?.();
  };

  const readyTimer = setTimeout(() => {
    _log(`sox ready fallback timeout hit at ${String(Date.now() - startTs)}ms`);
    markReady();
  }, 260);

  proc.stdout?.on("data", (chunk: Buffer) => {
    if (!ready) {
      _log(`sox first pcm chunk at ${String(Date.now() - startTs)}ms`);
    }
    chunks.push(chunk);
    markReady();
  });
  proc.stderr?.on("data", (chunk: Buffer) => {
    stderrChunks.push(chunk);
  });
  proc.on("error", (err) => _log(`sox error: ${String(err)}`));
  proc.on("close", () => {
    clearTimeout(readyTimer);
    markReady();
  });

  let _stopped = false;

  return {
    async waitUntilReady(): Promise<void> {
      await readyPromise;
    },
    stop(): Promise<Uint8Array> {
      return new Promise<Uint8Array>((resolve) => {
        if (_stopped) {
          resolve(new Uint8Array(Buffer.concat(chunks)));
          return;
        }
        _stopped = true;

        const forceKillTimer = setTimeout(() => {
          if (proc.killed) return;
          try {
            proc.kill("SIGKILL");
          } catch {
            const buf = Buffer.concat(chunks);
            _log(`sox force-kill failed, pcmBytes so far=${buf.byteLength}`);
            resolve(new Uint8Array(buf));
          }
        }, 1500);

        proc.once("close", (code) => {
          clearTimeout(forceKillTimer);
          const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
          if (stderr) _log(`sox stderr: ${stderr.slice(0, 300)}`);
          const buf = Buffer.concat(chunks);
          _log(`sox stopped: exit=${String(code)} pcmBytes=${buf.byteLength}`);
          resolve(new Uint8Array(buf));
        });

        try {
          proc.kill("SIGTERM");
        } catch {
          const buf = Buffer.concat(chunks);
          _log(`sox kill failed, pcmBytes so far=${buf.byteLength}`);
          resolve(new Uint8Array(buf));
        }
      });
    },
  };
}

// ── isRecordingAvailable ──────────────────────────────────────────────────────

/**
 * Check if `sox` is on the PATH.
 * M50-REC-02
 */
export function isRecordingAvailable(): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const p = spawn("sox", ["--version"], { stdio: "ignore" });
    p.on("error", () => resolve(false));
    p.on("close", (code) => resolve(code === 0));
  });
}
