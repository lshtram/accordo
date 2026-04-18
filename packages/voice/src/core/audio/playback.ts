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
