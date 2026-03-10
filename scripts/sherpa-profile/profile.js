#!/usr/bin/env node
/**
 * profile.js — Benchmark Sherpa-ONNX Kokoro TTS
 *
 * Compares synthesis speed of the C++ Sherpa-ONNX runtime against our current
 * kokoro-js JS ONNX adapter.  Run from this directory:
 *
 *   cd scripts/sherpa-profile
 *   npm install            # one-time: downloads sherpa-onnx (~60MB)
 *   node profile.js        # downloads model (~330MB) on first run, then benchmarks
 *
 * Environment:
 *   SHERPA_SID=3           speaker ID (default 3 = af_sarah, same as KokoroJS default)
 *   SHERPA_THREADS=1,2,4   comma-separated thread counts to benchmark
 *   SHERPA_PLAY=1          play first sample with afplay after benchmark (macOS)
 */

'use strict';

const { execSync, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// ─── Config ──────────────────────────────────────────────────────────────────

const MODEL_DIR  = path.join(__dirname, 'kokoro-en-v0_19');
const MODEL_TAR  = path.join(__dirname, 'kokoro-en-v0_19.tar.bz2');
const MODEL_URL  = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-en-v0_19.tar.bz2';
const SAMPLE_WAV = path.join(__dirname, 'sherpa-sample.wav');

// Speaker ID map (kokoro-en-v0_19):
//   0=af_heart  1=af_bella  2=af_nicole  3=af_sarah   4=af_sky
//   5=am_adam   6=am_michael  7=bf_emma  8=bf_isabella  9=bm_george  10=bm_lewis
const SID     = parseInt(process.env.SHERPA_SID     ?? '3', 10);
const THREADS = (process.env.SHERPA_THREADS ?? '1,2,4').split(',').map(Number);
const PLAY    = (process.env.SHERPA_PLAY    ?? '0') !== '0';

const SENTENCES = [
  'The quick brown fox jumps over the lazy dog.',
  'Today as always, men fall into two groups: slaves and free men.',
  'Sherpa ONNX uses a C++ runtime which should be significantly faster than the JavaScript ONNX runtime.',
];

// ─── Model download ───────────────────────────────────────────────────────────

if (!fs.existsSync(MODEL_DIR)) {
  console.log('Downloading kokoro-en-v0_19 model (~330 MB)…');
  execSync(`curl -SL -o "${MODEL_TAR}" "${MODEL_URL}"`, { stdio: 'inherit' });
  execSync(`tar xf "${MODEL_TAR}" -C "${__dirname}"`, { stdio: 'inherit' });
  try { fs.unlinkSync(MODEL_TAR); } catch {}
  console.log('Model ready.\n');
} else {
  console.log(`Model: ${MODEL_DIR}  (already present)\n`);
}

// ─── Load sherpa-onnx ─────────────────────────────────────────────────────────

let sherpa_onnx;
try {
  sherpa_onnx = require('sherpa-onnx-node');
} catch (e) {
  console.error('sherpa-onnx-node not installed — run: npm install');
  process.exit(1);
}

// ─── WAV writer (Float32 → 16-bit PCM WAV) ───────────────────────────────────

function writeWav(filePath, floatSamples, sampleRate) {
  const numSamples    = floatSamples.length;
  const numChannels   = 1;
  const bitsPerSample = 16;
  const byteRate      = sampleRate * numChannels * bitsPerSample / 8;
  const blockAlign    = numChannels * bitsPerSample / 8;
  const dataSize      = numSamples * blockAlign;
  const buf = Buffer.allocUnsafe(44 + dataSize);

  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1,  20);   // PCM
  buf.writeUInt16LE(numChannels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(byteRate,  28);
  buf.writeUInt16LE(blockAlign, 32);
  buf.writeUInt16LE(bitsPerSample, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);

  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, floatSamples[i]));
    buf.writeInt16LE(s < 0 ? s * 32768 : s * 32767, offset);
    offset += 2;
  }
  fs.writeFileSync(filePath, buf);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// sherpa-onnx-node uses a different (nested) config shape than the WASM version
function makeConfig(numThreads) {
  return {
    model: {
      kokoro: {
        model:   path.join(MODEL_DIR, 'model.onnx'),
        voices:  path.join(MODEL_DIR, 'voices.bin'),
        tokens:  path.join(MODEL_DIR, 'tokens.txt'),
        dataDir: path.join(MODEL_DIR, 'espeak-ng-data'),
      },
      debug: false,
      numThreads,
      provider: 'cpu',
    },
    maxNumSentences: 1,
  };
}

function audioLenMs(audio) {
  // sherpa-onnx-node returns {samples: Float32Array, sampleRate: number}
  return Math.round((audio.samples.length / audio.sampleRate) * 1000);
}

function rtfStr(synthMs, lenMs) {
  return (synthMs / lenMs).toFixed(3);
}

// ─── Benchmark ───────────────────────────────────────────────────────────────

let sampleSaved = false;

console.log(`Speaker ID : ${SID}  (af_sarah=3, am_adam=5, am_michael=6)`);
console.log(`Thread counts: ${THREADS.join(', ')}`);
console.log('');
console.log('Reference (JS ONNX / KokoroJS on this machine):');
console.log('  synth ≈ 2000–9000 ms per sentence  RTF ≈ 0.5–2.5');
console.log('');

const results = [];   // [{threads, loadMs, rows:[{synthMs,lenMs}]}]

for (const numThreads of THREADS) {
  console.log('─'.repeat(64));
  console.log(`numThreads = ${numThreads}`);
  console.log('─'.repeat(64));

  const loadStart = Date.now();
  const tts = new sherpa_onnx.OfflineTts(makeConfig(numThreads));
  const loadMs = Date.now() - loadStart;

  console.log(`  load:        ${loadMs} ms`);
  console.log(`  sampleRate:  ${tts.sampleRate} Hz`);
  console.log(`  numSpeakers: ${tts.numSpeakers}`);

  const rows = [];

  for (let i = 0; i < SENTENCES.length; i++) {
    const text = SENTENCES[i];
    const t0 = Date.now();
    const audio = tts.generate({ text, sid: SID, speed: 1.0 });
    const synthMs = Date.now() - t0;
    const lenMs   = audioLenMs(audio);
    const rtf     = rtfStr(synthMs, lenMs);
    const marker  = synthMs > lenMs ? '  ← slower than real-time' : '  ✓';

    console.log(`  s${i}: synth=${synthMs} ms  audio=${lenMs} ms  RTF=${rtf}${marker}`);
    rows.push({ synthMs, lenMs });

    // Save a quality sample (first sentence, first time)
    if (!sampleSaved) {
      // Use built-in writeWave if available, otherwise our custom writer
      if (typeof sherpa_onnx.writeWave === 'function') {
        sherpa_onnx.writeWave(SAMPLE_WAV, audio);
      } else {
        writeWav(SAMPLE_WAV, audio.samples, audio.sampleRate);
      }
      sampleSaved = true;
      console.log(`       → saved to ${SAMPLE_WAV}`);
    }
  }

  results.push({ numThreads, loadMs, rows });
  if (typeof tts.free === 'function') tts.free();
}

// ─── Summary table ────────────────────────────────────────────────────────────

console.log('\n');
console.log('═'.repeat(64));
console.log('SUMMARY — RTF by thread count');
console.log('  (RTF < 1.0 = faster than real-time; lower is better)');
console.log('═'.repeat(64));
console.log(`${'threads'.padEnd(9)} ${'load ms'.padEnd(10)} ${'s0 RTF'.padEnd(9)} ${'s1 RTF'.padEnd(9)} ${'s2 RTF'.padEnd(9)}`);
console.log('─'.repeat(64));
for (const { numThreads, loadMs, rows } of results) {
  const rtfs = rows.map(r => rtfStr(r.synthMs, r.lenMs).padEnd(9));
  console.log(`${String(numThreads).padEnd(9)} ${String(loadMs).padEnd(10)} ${rtfs.join(' ')}`);
}
console.log('─'.repeat(64));

// ─── Playback ─────────────────────────────────────────────────────────────────

if (sampleSaved) {
  if (PLAY && process.platform === 'darwin') {
    console.log('\nPlaying sample with afplay…');
    spawnSync('afplay', [SAMPLE_WAV], { stdio: 'inherit' });
    console.log('Done.');
  } else {
    console.log(`\nTo hear the sample: afplay "${SAMPLE_WAV}"`);
    console.log('Or re-run with: SHERPA_PLAY=1 node profile.js');
  }
}
