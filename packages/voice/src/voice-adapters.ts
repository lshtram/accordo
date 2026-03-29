/**
 * voice-adapters.ts — Pure adapter/utility layer.
 *
 * No `vscode` imports. This is the leaf layer that creates STT/TTS providers
 * and provides pure utility functions.
 *
 * M50-EXT (adapter split)
 */

import type { SttProvider } from "./core/providers/stt-provider.js";
import type { TtsProvider } from "./core/providers/tts-provider.js";
import { WhisperCppAdapter } from "./core/adapters/whisper-cpp.js";
import { FasterWhisperHttpAdapter } from "./core/adapters/faster-whisper-http.js";
import { KokoroAdapter } from "./core/adapters/kokoro.js";
import { SherpaSubprocessAdapter, findSystemNode } from "./core/adapters/sherpa-subprocess.js";

// ── STT provider config ───────────────────────────────────────────────────────

export interface SttProviderConfig {
  sttProvider?: string;
  whisperPath?: string;
  whisperModelFolder?: string;
  whisperModel?: string;
  fasterWhisperUrl?: string;
  fasterWhisperModel?: string;
}

// ── createSttProvider ─────────────────────────────────────────────────────────

/**
 * Factory: creates the appropriate STT provider based on the given provider name.
 * REQ-VA-01, REQ-VA-02, REQ-VA-03
 */
export function createSttProvider(
  sttProviderName: string,
  log: (msg: string) => void,
  config?: SttProviderConfig,
): SttProvider {
  if (sttProviderName === "faster-whisper-http") {
    log(`stt: creating FasterWhisperHttpAdapter (provider=${sttProviderName})`);
    return new FasterWhisperHttpAdapter({
      baseUrl: config?.fasterWhisperUrl ?? "http://localhost:8280",
      model: config?.fasterWhisperModel ?? "Systran/faster-whisper-small",
      log: (msg) => log(`[faster-whisper] ${msg}`),
    });
  }

  log(`stt: creating WhisperCppAdapter (provider=${sttProviderName})`);
  return new WhisperCppAdapter({
    binaryPath: config?.whisperPath ?? "whisper",
    modelFolder: config?.whisperModelFolder ?? "",
    modelFile: config?.whisperModel ?? "ggml-base.en.bin",
    log: (msg) => log(`[whisper] ${msg}`),
  });
}

// ── createTtsProvider ─────────────────────────────────────────────────────────

/**
 * Factory: tries Sherpa (C++ subprocess) first; falls back to KokoroJS.
 * REQ-VA-04, REQ-VA-05
 */
export async function createTtsProvider(
  log: (msg: string) => void,
): Promise<TtsProvider> {
  const sherpa = new SherpaSubprocessAdapter();
  if (await sherpa.isAvailable()) {
    const nodeBin = findSystemNode();
    log(`tts: using sherpa-kokoro (C++ subprocess, node=${nodeBin})`);
    return sherpa;
  }
  log("tts: sherpa model not found — using kokoro-js (JS ONNX). To enable Sherpa: download kokoro-en-v0_19 to ~/.accordo/models/kokoro-en-v0_19");
  return new KokoroAdapter();
}

// ── buildReadyChimePcm ────────────────────────────────────────────────────────

/**
 * Synthesizes a short two-tone chime as raw PCM audio.
 * REQ-VA-06 through REQ-VA-10
 */
export function buildReadyChimePcm(
  sampleRate = 22050,
  durationMs = 140,
  frequencyHz = 880,
): Uint8Array {
  const totalSamples = Math.max(1, Math.floor((sampleRate * durationMs) / 1000));
  const data = new Int16Array(totalSamples);
  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate;
    const fade = Math.min(1, i / 260) * Math.min(1, (totalSamples - i) / 260);
    const secondTone = Math.sin(2 * Math.PI * (frequencyHz * 1.33) * t) * 0.35;
    const value = (Math.sin(2 * Math.PI * frequencyHz * t) + secondTone) * 0.28 * fade;
    data[i] = Math.round(value * 32767);
  }
  return new Uint8Array(data.buffer);
}
