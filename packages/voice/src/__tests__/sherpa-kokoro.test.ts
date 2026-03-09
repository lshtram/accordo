/**
 * M50-SK — SherpaKokoroAdapter unit tests
 *
 * Coverage: M50-SK-01 through M50-SK-05
 * All sherpa-onnx-node I/O is injected via constructor seams — no native addon
 * is loaded during tests.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DynamicImportFn, ResolveFn, ExistsFn } from "../core/adapters/sherpa-kokoro.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeFakeAudio(samples?: Float32Array): FakeAudio {
  return { samples: samples ?? new Float32Array([0.1, 0.2, 0.3]), sampleRate: 24000 };
}

interface FakeAudio { samples: Float32Array; sampleRate: number; }

class FakeTts {
  public generateCalls: Array<{ text: string; sid: number; speed: number }> = [];
  private _audio: FakeAudio;
  constructor(audio: FakeAudio) { this._audio = audio; }
  get sampleRate() { return this._audio.sampleRate; }
  get numSpeakers() { return 11; }
  generate(req: { text: string; sid: number; speed: number }): FakeAudio {
    this.generateCalls.push(req);
    return this._audio;
  }
  async generateAsync(req: { text: string; sid: number; speed: number }): Promise<FakeAudio> {
    this.generateCalls.push(req);
    return this._audio;
  }
  free = vi.fn();
}

function makeSuccessImport(fakeTts: FakeTts): DynamicImportFn {
  return async (_id: string) => ({
    OfflineTts: class {
      static async createAsync(_config: unknown) { return fakeTts; }
    },
  });
}

function makeFailImport(err: Error): DynamicImportFn {
  return async (_id: string) => { throw err; };
}

const okResolve: ResolveFn = (_id) => "/fake/sherpa-onnx-node/index.js";
const failResolve: ResolveFn = (_id) => { throw new Error("Cannot find module 'sherpa-onnx-node'"); };
const modelExists: ExistsFn = (_p) => true;
const modelMissing: ExistsFn = (_p) => false;

// ---------------------------------------------------------------------------
// Import the adapter under test
// ---------------------------------------------------------------------------

import {
  SherpaKokoroAdapter,
  DEFAULT_SPEAKER_ID,
  DEFAULT_NUM_THREADS,
} from "../core/adapters/sherpa-kokoro.js";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SherpaKokoroAdapter — static exports", () => {
  it("M50-SK-01: exports SherpaKokoroAdapter class", () => {
    expect(typeof SherpaKokoroAdapter).toBe("function");
  });

  it("M50-SK-01: kind is 'tts' and id is 'sherpa-kokoro'", () => {
    const a = new SherpaKokoroAdapter({ resolveFn: failResolve, existsFn: modelMissing });
    expect(a.kind).toBe("tts");
    expect(a.id).toBe("sherpa-kokoro");
  });

  it("exports DEFAULT_SPEAKER_ID=3 and DEFAULT_NUM_THREADS=4", () => {
    expect(DEFAULT_SPEAKER_ID).toBe(3);
    expect(DEFAULT_NUM_THREADS).toBe(4);
  });
});

describe("SherpaKokoroAdapter.isAvailable()", () => {
  it("M50-SK-02: returns false when module not resolvable", async () => {
    const a = new SherpaKokoroAdapter({ resolveFn: failResolve, existsFn: modelExists });
    expect(await a.isAvailable()).toBe(false);
  });

  it("M50-SK-02: returns false when model.onnx does not exist", async () => {
    const a = new SherpaKokoroAdapter({ resolveFn: okResolve, existsFn: modelMissing });
    expect(await a.isAvailable()).toBe(false);
  });

  it("M50-SK-02: returns true when module resolvable AND model present", async () => {
    const a = new SherpaKokoroAdapter({ resolveFn: okResolve, existsFn: modelExists });
    expect(await a.isAvailable()).toBe(true);
  });

  it("M50-SK-02: result is memoised — resolveFn not called again on second call", async () => {
    const resolveSpy = vi.fn<[string], string>(() => "/ok/path");
    const a = new SherpaKokoroAdapter({ resolveFn: resolveSpy, existsFn: modelExists });
    await a.isAvailable();
    const callsAfterFirst = resolveSpy.mock.calls.length;
    await a.isAvailable(); // second call — should use cache
    expect(resolveSpy.mock.calls.length).toBe(callsAfterFirst); // no extra call
  });
});

describe("SherpaKokoroAdapter.synthesize()", () => {
  let fakeTts: FakeTts;

  beforeEach(() => {
    fakeTts = new FakeTts(makeFakeAudio());
  });

  it("M50-SK-03: synthesize returns Uint8Array audio and sampleRate", async () => {
    const a = new SherpaKokoroAdapter({
      resolveFn: okResolve,
      existsFn: modelExists,
      importFn: makeSuccessImport(fakeTts),
    });
    const result = await a.synthesize({ text: "Hello world", language: "en-US" });
    expect(result.audio).toBeInstanceOf(Uint8Array);
    expect(result.sampleRate).toBe(24000);
  });

  it("M50-SK-03: audio byte length is 2× sample count (Int16 PCM)", async () => {
    const samples = new Float32Array([0.0, 0.5, -0.5]);
    fakeTts = new FakeTts({ samples, sampleRate: 24000 });
    const a = new SherpaKokoroAdapter({
      resolveFn: okResolve,
      existsFn: modelExists,
      importFn: makeSuccessImport(fakeTts),
    });
    const result = await a.synthesize({ text: "x", language: "en-US" });
    expect(result.audio.byteLength).toBe(samples.length * 2);
  });

  it("M50-SK-03: prefers generateAsync over generate", async () => {
    const generateSpy  = vi.spyOn(fakeTts, "generate");
    const asyncSpy     = vi.spyOn(fakeTts, "generateAsync");
    const a = new SherpaKokoroAdapter({
      resolveFn: okResolve,
      existsFn: modelExists,
      importFn: makeSuccessImport(fakeTts),
    });
    await a.synthesize({ text: "test", language: "en-US" });
    expect(asyncSpy).toHaveBeenCalled();
    expect(generateSpy).not.toHaveBeenCalled();
  });

  it("M50-SK-03: falls back to sync generate if generateAsync absent", async () => {
    // Build a TTS without generateAsync
    const syncOnlyTts = {
      sampleRate: 24000,
      numSpeakers: 11,
      generate: vi.fn<[{ text: string; sid: number; speed: number }], FakeAudio>(() => ({
        samples: new Float32Array([0.1]),
        sampleRate: 24000,
      })),
    };
    const importFn: DynamicImportFn = async () => ({
      OfflineTts: class {
        static async createAsync() { return syncOnlyTts; }
      },
    });
    const a = new SherpaKokoroAdapter({ resolveFn: okResolve, existsFn: modelExists, importFn });
    await a.synthesize({ text: "test", language: "en-US" });
    expect(syncOnlyTts.generate).toHaveBeenCalled();
  });

  it("M50-SK-03: maps voice name to correct speaker ID", async () => {
    const a = new SherpaKokoroAdapter({
      resolveFn: okResolve,
      existsFn: modelExists,
      importFn: makeSuccessImport(fakeTts),
    });
    await a.synthesize({ text: "hi", language: "en-US", voice: "am_adam" });
    expect(fakeTts.generateCalls[0]?.sid).toBe(5); // am_adam = 5
  });

  it("M50-SK-03: uses DEFAULT_SPEAKER_ID (3=af_sarah) for unknown voice", async () => {
    const a = new SherpaKokoroAdapter({
      resolveFn: okResolve,
      existsFn: modelExists,
      importFn: makeSuccessImport(fakeTts),
    });
    await a.synthesize({ text: "hi", language: "en-US", voice: "unknown_voice" });
    expect(fakeTts.generateCalls[0]?.sid).toBe(DEFAULT_SPEAKER_ID);
  });

  it("M50-SK-04: shared loading promise — engine created only once for concurrent calls", async () => {
    let createCount = 0;
    const importFn: DynamicImportFn = async () => ({
      OfflineTts: class {
        static async createAsync() {
          createCount++;
          return fakeTts;
        }
      },
    });
    const a = new SherpaKokoroAdapter({ resolveFn: okResolve, existsFn: modelExists, importFn });
    await Promise.all([
      a.synthesize({ text: "a", language: "en-US" }),
      a.synthesize({ text: "b", language: "en-US" }),
      a.synthesize({ text: "c", language: "en-US" }),
    ]);
    expect(createCount).toBe(1);
  });

  it("M50-SK-03: passes speed to generateAsync", async () => {
    const a = new SherpaKokoroAdapter({
      resolveFn: okResolve,
      existsFn: modelExists,
      importFn: makeSuccessImport(fakeTts),
    });
    await a.synthesize({ text: "fast", language: "en-US", speed: 1.5 });
    expect(fakeTts.generateCalls[0]?.speed).toBe(1.5);
  });
});

describe("SherpaKokoroAdapter.dispose()", () => {
  it("M50-SK-05: dispose clears engine and calls free()", async () => {
    const a = new SherpaKokoroAdapter({
      resolveFn: okResolve,
      existsFn: modelExists,
      importFn: makeSuccessImport(new FakeTts(makeFakeAudio())),
    });
    // Force engine load
    const fakeTtsLocal = new FakeTts(makeFakeAudio());
    const b = new SherpaKokoroAdapter({
      resolveFn: okResolve,
      existsFn: modelExists,
      importFn: makeSuccessImport(fakeTtsLocal),
    });
    await b.synthesize({ text: "x", language: "en-US" });
    await b.dispose();
    expect(fakeTtsLocal.free).toHaveBeenCalled();
    // After dispose, isAvailable still works
    expect(await b.isAvailable()).toBe(true);
  });
});
