/**
 * TTS latency profiler — measures bottlenecks in the synthesis + playback pipeline.
 *
 * Run with:  node packages/voice/scripts/profile-tts.mjs
 *
 * Measures:
 *  1. Kokoro model load time (once, cached after)
 *  2. Per-sentence synthesis time (5 test sentences)
 *  3. WAV buffer build time
 *  4. Temp file write time
 *  5. afplay spawn → first audio latency (estimated)
 *  6. Total perceived first-word delay (synthesis + play setup)
 */

import { performance } from "node:perf_hooks";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

// ── 0. Check kokoro-js is available ─────────────────────────────────────────
try {
  require.resolve("kokoro-js");
} catch {
  console.error("kokoro-js not found. Run from the voice extension host context or install it.");
  process.exit(1);
}

// ── Sentences to test ────────────────────────────────────────────────────────
const SENTENCES = [
  "This is the first sentence.",
  "Dream News has three main components.",
  "The RSS feed ingestion pipeline collects from fifty sources.",
  "Audio synthesis is now running through a streaming pipeline.",
  "Each sentence is synthesized while the previous one plays back.",
];

const VOICE = "am_adam";
const SPEED = 1.3;

// ── WAV header builder (inline to avoid import complexity) ──────────────────
function buildWavBuffer(pcm16, sampleRate, channels = 1) {
  const bitsPerSample = 16;
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  const dataSize = pcm16.byteLength;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(byteRate, 28);
  buf.writeUInt16LE(blockAlign, 32);
  buf.writeUInt16LE(bitsPerSample, 34);
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(dataSize, 40);
  Buffer.from(pcm16).copy(buf, 44);
  return buf;
}

// ── Float32 → Int16 ─────────────────────────────────────────────────────────
function float32ToInt16(samples) {
  const buf = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const c = Math.max(-1, Math.min(1, samples[i]));
    buf[i] = Math.round(c * 32767);
  }
  return new Uint8Array(buf.buffer);
}

// ── afplay via tempfile ──────────────────────────────────────────────────────
async function playViaTempFile(wavBuf) {
  const dir = await mkdtemp(join(tmpdir(), "prf-tmp-"));
  const f = join(dir, "out.wav");
  const t0 = performance.now();
  await writeFile(f, wavBuf);
  const tWrite = performance.now() - t0;

  const tSpawn = performance.now();
  await new Promise((resolve, reject) => {
    const proc = spawn("afplay", [f], { stdio: "ignore" });
    proc.on("error", reject);
    proc.on("close", resolve);
  });
  const tTotal = performance.now() - tSpawn;

  await rm(dir, { recursive: true, force: true });
  return { tWrite, tSpawn: tTotal };
}

// ── afplay via stdin pipe ────────────────────────────────────────────────────
async function playViaPipe(wavBuf) {
  const t0 = performance.now();
  await new Promise((resolve, reject) => {
    const proc = spawn("afplay", ["/dev/stdin"], { stdio: ["pipe", "ignore", "ignore"] });
    proc.on("error", reject);
    proc.on("close", resolve);
    proc.stdin.write(wavBuf);
    proc.stdin.end();
  });
  return performance.now() - t0;
}

// ── Main ─────────────────────────────────────────────────────────────────────
console.log("Loading kokoro-js model (this takes a while on first load)...\n");

const { KokoroTTS } = await import("kokoro-js");

const tLoad0 = performance.now();
const tts = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-ONNX", { dtype: "q8" });
const tLoad = performance.now() - tLoad0;
console.log(`Model load: ${tLoad.toFixed(0)} ms\n`);

// Warm-up pass (first call is slower due to JIT/ONNX init)
console.log("Warming up (first synthesis is always slower)...");
await tts.generate("Warm up.", { voice: VOICE, speed: SPEED });
console.log("Warm-up done.\n");

console.log("=".repeat(70));
console.log("Sentence synthesis timings:");
console.log("=".repeat(70));

const results = [];

for (const sentence of SENTENCES) {
  const words = sentence.split(/\s+/).length;

  const tSynth0 = performance.now();
  const { audio, sampling_rate } = await tts.generate(sentence, { voice: VOICE, speed: SPEED });
  const tSynth = performance.now() - tSynth0;

  const tWav0 = performance.now();
  const pcm = float32ToInt16(audio);
  const wavBuf = buildWavBuffer(pcm, sampling_rate);
  const tWav = performance.now() - tWav0;

  const audioDurationMs = (pcm.byteLength / 2 / sampling_rate) * 1000;

  results.push({ sentence, words, tSynth, tWav, audioDurationMs, sampleRate: sampling_rate, pcm, wavBuf });

  console.log(`\n"${sentence}"`);
  console.log(`  words=${words}  sampleRate=${sampling_rate}  audio=${audioDurationMs.toFixed(0)}ms`);
  console.log(`  synthesis: ${tSynth.toFixed(0)} ms  |  wav build: ${tWav.toFixed(1)} ms`);
}

console.log("\n" + "=".repeat(70));
console.log("Playback overhead comparison (one sentence):");
console.log("=".repeat(70));

const sample = results[2]; // medium-length sentence
console.log(`\nTest sentence: "${sample.sentence}" (${sample.audioDurationMs.toFixed(0)}ms audio)`);

// Method 1: temp file
const m1 = await playViaTempFile(sample.wavBuf);
console.log(`\nMethod A — temp file + afplay:`);
console.log(`  writeFile: ${m1.tWrite.toFixed(1)} ms`);
console.log(`  afplay (spawn→done): ${m1.tSpawn.toFixed(0)} ms`);
console.log(`  overhead before first audio: ~${(m1.tWrite + 20).toFixed(0)} ms`);

// Method 2: stdin pipe
const m2total = await playViaPipe(sample.wavBuf);
console.log(`\nMethod B — stdin pipe to afplay /dev/stdin:`);
console.log(`  total (spawn→done): ${m2total.toFixed(0)} ms`);
console.log(`  overhead before first audio: ~20 ms (spawn only, no file write)`);

console.log("\n" + "=".repeat(70));
console.log("Summary:");
console.log("=".repeat(70));

const avgSynth = results.reduce((s, r) => s + r.tSynth, 0) / results.length;
console.log(`\nAvg synthesis time: ${avgSynth.toFixed(0)} ms`);
console.log(`Temp file write:    ${m1.tWrite.toFixed(1)} ms  ← eliminatable`);
console.log(`afplay spawn:       ~20 ms              ← eliminatable with pre-spawn`);
console.log(`\nFirst-word delay (current):  synthesis + file_write + spawn ≈ ${(avgSynth + m1.tWrite + 20).toFixed(0)} ms`);
console.log(`First-word delay (optimized): synthesis + spawn ≈ ${(avgSynth + 20).toFixed(0)} ms  (pipe approach)`);
console.log(`\nGap between sentences (current): file_write + spawn ≈ ${(m1.tWrite + 20).toFixed(0)} ms`);
console.log(`Gap between sentences (pre-spawn): ~0 ms  (stdin ready before prev sentence ends)`);
