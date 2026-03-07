/**
 * Cross-platform audio playback utility.
 *
 * M50-WAV-02 through M50-WAV-05
 */

import { mkdtemp, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn as nodeSpawn } from "node:child_process";
import { buildWavBuffer } from "./wav.js";
import type { SpawnFn } from "../adapters/whisper-cpp.js";

export type { SpawnFn };

export interface PlaybackOptions {
  /** Override platform detection for testing. */
  platform?: NodeJS.Platform;
  /** Injectable spawn function for testing. */
  spawnFn?: SpawnFn;
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
export async function playPcmAudio(
  pcm: Uint8Array,
  sampleRate: number,
  options?: PlaybackOptions,
): Promise<void> {
  const spawn = options?.spawnFn ?? (nodeSpawn as unknown as SpawnFn);
  const platform = options?.platform ?? (process.platform as NodeJS.Platform);

  const tmpDir = await mkdtemp(join(tmpdir(), "accordo-wav-"));
  const wavPath = join(tmpDir, "output.wav");

  try {
    const wavBuf = buildWavBuffer(pcm, sampleRate, 1);
    await writeFile(wavPath, wavBuf);

    const { cmd, argsBuilder } = getPlayerCmd(platform);
    const args = argsBuilder(wavPath);

    await new Promise<void>((resolve, reject) => {
      const proc = spawn(cmd, args, { stdio: "pipe" });

      proc.on("error", (err) => {
        reject(new Error(`${cmd} spawn error: ${err.message}`));
      });

      proc.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`${cmd} exited with code ${String(code)}`));
        } else {
          resolve();
        }
      });
    });
  } finally {
    await unlink(wavPath).catch(() => undefined);
  }
}
