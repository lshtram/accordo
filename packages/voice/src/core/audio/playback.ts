/**
 * Cross-platform audio playback utility.
 *
 * M50-WAV-02 through M50-WAV-05
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn as nodeSpawn } from "node:child_process";
import { buildWavBuffer } from "./wav.js";

export type SpawnFn = (
  cmd: string,
  args: string[],
  options: { stdio: "pipe" },
) => {
  kill(signal?: NodeJS.Signals | number): boolean;
  on(event: "error", cb: (err: Error) => void): void;
  on(event: "close", cb: (code: number | null) => void): void;
};

export interface PlaybackOptions {
  /** Override platform detection for testing. */
  platform?: NodeJS.Platform;
  /** Injectable spawn function for testing. */
  spawnFn?: SpawnFn;
}

export interface PlaybackHandle {
  stop(): Promise<void>;
  pause(): Promise<boolean>;
  resume(): Promise<boolean>;
  waitForExit(): Promise<void>;
  isPlaying(): boolean;
}

/**
 * Choose the audio player command for the given platform.
 * M50-WAV-03
 */
function getPlayerCmd(platform: NodeJS.Platform): { cmd: string; argsBuilder: (filePath: string) => string[] } {
  switch (platform) {
    case "darwin":
      return { cmd: "afplay", argsBuilder: (f) => [f] };
    case "linux":
      return { cmd: "aplay", argsBuilder: (f) => [f] };
    case "win32":
      return {
        cmd: "powershell",
        argsBuilder: (f) => ["-c", `(New-Object Media.SoundPlayer '${f}').PlaySync()`],
      };
    default:
      return { cmd: "afplay", argsBuilder: (f) => [f] };
  }
}

/**
 * Write PCM audio to a temp WAV file and play it via a platform-native player.
 * Temp file is cleaned up in a finally block.
 * M50-WAV-02 through M50-WAV-05
 */
export async function startPcmPlayback(
  pcm: Uint8Array,
  sampleRate: number,
  options?: PlaybackOptions,
): Promise<PlaybackHandle> {
  const spawn = options?.spawnFn ?? (nodeSpawn as unknown as SpawnFn);
  const platform = options?.platform ?? (process.platform as NodeJS.Platform);

  const tmpDir = await mkdtemp(join(tmpdir(), "accordo-wav-"));
  const wavPath = join(tmpDir, "output.wav");

  const wavBuf = buildWavBuffer(pcm, sampleRate, 1);
  await writeFile(wavPath, wavBuf);

  const { cmd, argsBuilder } = getPlayerCmd(platform);
  const args = argsBuilder(wavPath);
  const proc = spawn(cmd, args, { stdio: "pipe" });
  let playing = true;
  let stoppedByUser = false;

  const waitForExit = new Promise<void>((resolve, reject) => {
    proc.on("error", (err) => {
      if (!playing) return;
      playing = false;
      reject(new Error(`${cmd} spawn error: ${err.message}`));
    });

    proc.on("close", (code) => {
      if (!playing) return;
      playing = false;
      if (stoppedByUser || code === 0) {
        resolve();
      } else {
        reject(new Error(`${cmd} exited with code ${String(code)}`));
      }
    });
  }).finally(async () => {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  });

  return {
    async stop(): Promise<void> {
      if (!playing) return;
      stoppedByUser = true;
      try {
        proc.kill("SIGTERM");
      } catch {
        // Ignore kill errors; waitForExit handles cleanup and state.
      }
      await waitForExit;
    },
    async pause(): Promise<boolean> {
      if (!playing || platform === "win32") return false;
      try {
        return proc.kill("SIGSTOP");
      } catch {
        return false;
      }
    },
    async resume(): Promise<boolean> {
      if (!playing || platform === "win32") return false;
      try {
        return proc.kill("SIGCONT");
      } catch {
        return false;
      }
    },
    waitForExit: async (): Promise<void> => waitForExit,
    isPlaying: (): boolean => playing,
  };
}

export async function playPcmAudio(
  pcm: Uint8Array,
  sampleRate: number,
  options?: PlaybackOptions,
): Promise<void> {
  const handle = await startPcmPlayback(pcm, sampleRate, options);
  await handle.waitForExit();
}

// ── PreSpawnedPlayer (inter-sentence latency elimination) ────────────────────

/**
 * A player that was pre-spawned (process already running, waiting for stdin),
 * so there is zero spawn delay when it's time to play the audio.
 * Used by streamingSpeak to overlap sentence preparation with audio playback.
 */
export interface PreSpawnedPlayer {
  /**
   * Write the PCM data as a WAV stream to the already-running process and
   * wait for playback to complete.
   */
  play(pcm: Uint8Array, sampleRate: number): Promise<void>;
  /** Terminate the pre-spawned process without playing (cancellation path). */
  abort(): void;
}

/**
 * Pre-spawn a platform audio player with stdin open, ready to receive WAV
 * data when the next sentence finishes synthesis.
 *
 * - macOS: `afplay /dev/stdin`
 * - Linux: `aplay -`
 * - Windows / other: deferred — play() behaves like `playPcmAudio` (no pre-spawn)
 */
export function createPreSpawnedPlayer(options?: PlaybackOptions): PreSpawnedPlayer {
  const spawn = options?.spawnFn ?? (nodeSpawn as unknown as SpawnFn);
  const platform = options?.platform ?? (process.platform as NodeJS.Platform);

  // Only Linux aplay supports true streaming stdin-pipe (aplay -).
  // macOS afplay requires a seekable file descriptor — /dev/stdin is not
  // seekable, so afplay exits immediately with no audio. Windows / other
  // platforms also can't pipe, so all non-Linux paths use the deferred
  // temp-file approach via playPcmAudio.
  if (platform !== "linux") {
    return {
      play: (pcm, sampleRate) => playPcmAudio(pcm, sampleRate, options),
      abort: () => {
        /* nothing pre-spawned */
      },
    };
  }

  // Linux: aplay reads WAV from stdin when '-' is passed as the file argument.
  const cmd = "aplay";
  const args = ["-"];

  // Spawn immediately — the process blocks waiting for stdin data.
  const proc = spawn(cmd, args, { stdio: "pipe" }) as ReturnType<SpawnFn> & {
    stdin: { write(data: Buffer): void; end(): void };
  };

  // `done` becomes true the moment the process exits OR the caller aborts,
  // preventing double-kill and allowing idempotent abort() calls.
  let done = false;
  let exitResolve!: () => void;
  let exitReject!: (err: Error) => void;
  const waitForExit = new Promise<void>((res, rej) => {
    exitResolve = res;
    exitReject = rej;
  });

  proc.on("error", (err) => {
    if (done) return;
    done = true;
    exitReject(new Error(`${cmd} spawn error: ${err.message}`));
  });
  proc.on("close", (code) => {
    if (done) return;
    done = true;
    if (code === 0) {
      exitResolve();
    } else {
      exitReject(new Error(`${cmd} exited with code ${String(code)}`));
    }
  });

  return {
    async play(pcm: Uint8Array, sampleRate: number): Promise<void> {
      if (done) return;
      const wavBuf = buildWavBuffer(pcm, sampleRate, 1);
      proc.stdin.write(wavBuf);
      proc.stdin.end();
      await waitForExit;
    },
    abort(): void {
      if (done) return;
      done = true;
      // Resolve the promise so any pending play() awaiter unblocks cleanly.
      exitResolve();
      try {
        proc.kill("SIGTERM");
      } catch {
        /* ignore */
      }
    },
  };
}

// ── CachedSound (low-latency fire-and-forget playback) ───────────────────────

export interface CachedSound {
  /**
   * Play the cached sound.
   * Returns a Promise that resolves when the player process exits,
   * so callers can await completion before starting the next operation.
   */
  play(): Promise<void>;
  /** Clean up temp WAV file. */
  dispose(): Promise<void>;
}

/**
 * Pre-bake a PCM buffer to a temp WAV file for instant repeat playback.
 * Unlike `playPcmAudio`, calling `play()` spawns the player with no per-call
 * file I/O — just a process spawn on the already-written WAV.
 */
export async function createCachedSound(
  pcm: Uint8Array,
  sampleRate: number,
  options?: { platform?: NodeJS.Platform; log?: (msg: string) => void },
): Promise<CachedSound> {
  const platform = options?.platform ?? (process.platform as NodeJS.Platform);
  const _log = options?.log ?? (() => { /* no-op */ });

  const cachedDir = await mkdtemp(join(tmpdir(), "accordo-cached-"));
  const wavPath = join(cachedDir, "sound.wav");
  await writeFile(wavPath, buildWavBuffer(pcm, sampleRate, 1));
  _log(`cachedSound: wrote ${wavPath}`);

  const { cmd, argsBuilder } = getPlayerCmd(platform);
  const args = argsBuilder(wavPath);

  return {
    play(): Promise<void> {
      _log(`cachedSound: play() → ${cmd} ${args.join(" ")}`);
      return new Promise<void>((resolve, reject) => {
        const proc = nodeSpawn(cmd, args, { stdio: "ignore", detached: false });
        proc.on("error", (err) => {
          _log(`cachedSound: spawn error — ${String(err)}`);
          reject(err);
        });
        proc.on("close", (code) => {
          if (code !== 0 && code !== null) {
            _log(`cachedSound: ${cmd} exit=${String(code)}`);
          }
          // Resolve regardless of exit code — audio was attempted.
          resolve();
        });
      });
    },
    async dispose() {
      await rm(cachedDir, { recursive: true, force: true }).catch(() => undefined);
    },
  };
}
