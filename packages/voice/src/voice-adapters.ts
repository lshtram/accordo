/**
 * voice-adapters.ts — Pure TTS adapter/utility layer.
 *
 * No `vscode` imports. Configuration values are passed in by the caller
 * (extension.ts), keeping this leaf layer vscode-free.
 *
 * Resolution order:
 * 1. External HTTP TTS (ExternalTtsAdapter) — preferred when endpoint is configured
 * 2. Local Kokoro ONNX (KokoroAdapter) — fallback when no external endpoint
 *
 * M50-EXT (adapter split — TTS-only, external-first)
 */

import type { TtsProvider } from "./core/providers/tts-provider.js";
import { KokoroAdapter } from "./core/adapters/kokoro.js";
import { ExternalTtsAdapter } from "./core/adapters/external-tts.js";

// ── createTtsProvider ─────────────────────────────────────────────────────────

/**
 * Factory: creates the best available TTS provider.
 *
 * Prefers external HTTP TTS when `ttsEndpoint` and `ttsAuthToken` are non-empty.
 * Falls back to KokoroAdapter (local ONNX) when no external endpoint is set.
 * REQ-VA-04, REQ-VA-05
 */
export async function createTtsProvider(
  log: (msg: string) => void,
  ttsEndpoint: string,
  ttsAuthToken: string,
  ttsModel: string,
): Promise<TtsProvider> {
  const endpoint = ttsEndpoint.trim();
  const authToken = ttsAuthToken.trim();
  const model = ttsModel.trim();

  if (endpoint.length > 0 && authToken.length > 0) {
    log(`tts: using ExternalTtsAdapter (${endpoint})`);
    return new ExternalTtsAdapter({
      endpoint,
      authToken,
      model: model || undefined,
    });
  }

  log("tts: using KokoroAdapter (kokoro-js ONNX)");
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
