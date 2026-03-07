/**
 * M50-KA — KokoroAdapter unit tests (Phase B — all tests must FAIL before implementation)
 *
 * Coverage: M50-KA-01 through M50-KA-08, plus trimSilence standalone
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DynamicImportFn, ResolveFn } from "../core/adapters/kokoro.js";
import type { TtsProvider } from "../core/providers/tts-provider.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeFakeModel(audioData?: Float32Array): FakeModel {
  return new FakeModel(audioData ?? new Float32Array([0.1, 0.2, 0.3, 0.0, 0.0]));
}

class FakeModel {
  public generateCalls: Array<{ text: string; opts: unknown }> = [];
  constructor(private readonly _audio: Float32Array) {}
  async generate(text: string, opts: unknown): Promise<{ audio: Float32Array; sampling_rate: number }> {
    this.generateCalls.push({ text, opts });
    return { audio: this._audio, sampling_rate: 24000 };
  }
}

function makeSuccessImport(model: FakeModel): DynamicImportFn {
  return async (_id: string) => ({
    KokoroTTS: {
      from_pretrained: async (_modelId: string, _opts?: unknown) => model,
    },
  });
}

function makeFailImport(err: Error): DynamicImportFn {
  return async (_id: string) => { throw err; };
}

const okResolve: ResolveFn = (_id) => "/some/path/kokoro-js/index.js";
const failResolve: ResolveFn = (_id) => { throw new Error("Cannot find module 'kokoro-js'"); };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

import {
  KokoroAdapter,
  trimSilence,
  SILENCE_THRESHOLD,
  SILENCE_PAD_SAMPLES,
} from "../core/adapters/kokoro.js";

describe("trimSilence", () => {
  it("M50-KA-06: exported as standalone function", () => {
    expect(typeof trimSilence).toBe("function");
  });

  it("M50-KA-06: SILENCE_THRESHOLD and SILENCE_PAD_SAMPLES are exported constants", () => {
    expect(SILENCE_THRESHOLD).toBe(0.001);
    expect(SILENCE_PAD_SAMPLES).toBe(240);
  });

  it("M50-KA-06: trims leading and trailing silence below threshold", () => {
    const silence = 0.0005; // below threshold
    const signal = 0.5;
    const samples = new Float32Array([silence, silence, signal, signal, silence, silence]);
    const trimmed = trimSilence(samples, 0.001, 0 /* no padding */);
    // Leading/trailing silence removed; result contains signal samples
    expect(trimmed.length).toBeLessThan(samples.length);
    expect(Array.from(trimmed)).toContain(signal);
  });

  it("M50-KA-06: preserves padding samples around speech", () => {
    const silence = new Float32Array(10).fill(0); // silent
    const speech = new Float32Array([0.5, 0.5]);
    const full = new Float32Array([...silence, ...speech, ...silence]);
    const trimmed = trimSilence(full, 0.001, 3); // pad 3 samples each side
    // Should be <= speech.length + 2 * pad
    expect(trimmed.length).toBeLessThanOrEqual(speech.length + 3 * 2);
  });

  it("M50-KA-06: returns empty array for fully-silent input", () => {
    const silent = new Float32Array(100).fill(0);
    const trimmed = trimSilence(silent, 0.001, 0);
    expect(trimmed.length).toBe(0);
  });
});

describe("KokoroAdapter", () => {
  // -------------------------------------------------------------------------
  // M50-KA-01 + M50-KA-08
  // -------------------------------------------------------------------------

  it("M50-KA-01: exports KokoroAdapter class", () => {
    expect(KokoroAdapter).toBeDefined();
    expect(typeof KokoroAdapter).toBe("function");
  });

  it("M50-KA-08: kind is 'tts' and id is 'kokoro'", () => {
    const adapter = new KokoroAdapter({ resolveFn: okResolve, importFn: makeSuccessImport(makeFakeModel()) });
    expect(adapter.kind).toBe("tts");
    expect(adapter.id).toBe("kokoro");
  });

  it("M50-KA-01: implements TtsProvider interface shape", () => {
    const adapter: TtsProvider = new KokoroAdapter({ resolveFn: okResolve, importFn: makeSuccessImport(makeFakeModel()) });
    expect(typeof adapter.isAvailable).toBe("function");
    expect(typeof adapter.synthesize).toBe("function");
    expect(typeof adapter.dispose).toBe("function");
  });

  // -------------------------------------------------------------------------
  // M50-KA-02 — isAvailable
  // -------------------------------------------------------------------------

  it("M50-KA-02: isAvailable() returns true when kokoro-js resolves", async () => {
    const adapter = new KokoroAdapter({ resolveFn: okResolve, importFn: makeSuccessImport(makeFakeModel()) });
    await expect(adapter.isAvailable()).resolves.toBe(true);
  });

  it("M50-KA-02: isAvailable() returns false when kokoro-js resolve throws", async () => {
    const adapter = new KokoroAdapter({ resolveFn: failResolve, importFn: makeSuccessImport(makeFakeModel()) });
    await expect(adapter.isAvailable()).resolves.toBe(false);
  });

  it("M50-KA-02: isAvailable() caches result — resolveFn called only once", async () => {
    const calls: string[] = [];
    const resolveFn: ResolveFn = (id) => { calls.push(id); return "/path"; };
    const adapter = new KokoroAdapter({ resolveFn, importFn: makeSuccessImport(makeFakeModel()) });
    await adapter.isAvailable();
    await adapter.isAvailable();
    expect(calls.length).toBe(1);
  });

  // -------------------------------------------------------------------------
  // M50-KA-03 + M50-KA-04 — lazy load + shared promise
  // -------------------------------------------------------------------------

  it("M50-KA-03: synthesize() loads model on first call and returns { audio, sampleRate }", async () => {
    const model = makeFakeModel();
    const adapter = new KokoroAdapter({ resolveFn: okResolve, importFn: makeSuccessImport(model) });
    const result = await adapter.synthesize({ text: "Hello", language: "en" });
    expect(result.audio).toBeInstanceOf(Uint8Array);
    expect(result.sampleRate).toBe(24000);
  });

  it("M50-KA-04: concurrent synthesize() calls reuse the same loading promise (importFn called once)", async () => {
    let importCount = 0;
    const model = makeFakeModel();
    const importFn: DynamicImportFn = async (_id) => {
      importCount++;
      return { KokoroTTS: { from_pretrained: async () => model } };
    };
    const adapter = new KokoroAdapter({ resolveFn: okResolve, importFn });
    await Promise.all([
      adapter.synthesize({ text: "Hello", language: "en" }),
      adapter.synthesize({ text: "World", language: "en" }),
    ]);
    expect(importCount).toBe(1);
  });

  // -------------------------------------------------------------------------
  // M50-KA-05 — Float32 → Int16 PCM
  // -------------------------------------------------------------------------

  it("M50-KA-05: audio output is Uint8Array with Int16 PCM encoding (2 bytes per sample)", async () => {
    const floatSamples = new Float32Array([0.5, -0.5, 0.1]);
    const model = makeFakeModel(floatSamples);
    const adapter = new KokoroAdapter({ resolveFn: okResolve, importFn: makeSuccessImport(model) });
    const result = await adapter.synthesize({ text: "test", language: "en" });
    // After trimming silence, the output length ≤ floatSamples.length * 2 (2 bytes per Int16 sample)
    expect(result.audio.byteLength % 2).toBe(0); // must be aligned to 2 bytes
  });

  // -------------------------------------------------------------------------
  // M50-KA-07 — dispose
  // -------------------------------------------------------------------------

  it("M50-KA-07: dispose() clears cached model instance", async () => {
    let importCount = 0;
    const model = makeFakeModel();
    const importFn: DynamicImportFn = async (_id) => {
      importCount++;
      return { KokoroTTS: { from_pretrained: async () => model } };
    };
    const adapter = new KokoroAdapter({ resolveFn: okResolve, importFn });
    await adapter.synthesize({ text: "Hello", language: "en" });
    expect(importCount).toBe(1);

    await adapter.dispose();

    // After dispose, a new synthesize call should re-import (load again)
    await adapter.synthesize({ text: "World", language: "en" });
    expect(importCount).toBe(2);
  });
});
