/**
 * M50-SP — SherpaSubprocessAdapter unit tests
 *
 * All subprocess I/O is injected via spawnFn — no real child process is
 * spawned during tests.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { PassThrough } from "node:stream";
import { EventEmitter } from "node:events";
import type * as cp from "node:child_process";
import {
  SherpaSubprocessAdapter,
} from "../core/adapters/sherpa-subprocess.js";
import type { WorkerSpawnFn } from "../core/adapters/sherpa-subprocess.js";

// ---------------------------------------------------------------------------
// Fake worker helpers
// ---------------------------------------------------------------------------

function fakePcmBase64(): string {
  const samples = new Int16Array([0, 1000, -1000, 2000]);
  return Buffer.from(samples.buffer).toString("base64");
}

interface FakeWorkerOpts {
  initFails?: boolean;
  synthFails?: boolean;
  /** Delay response by ms (0 = setImmediate) */
  delay?: number;
}

/**
 * Creates a fake cp.ChildProcess that auto-responds to the worker protocol
 * without spawning any real subprocess.
 */
function createFakeWorker(opts: FakeWorkerOpts = {}): cp.ChildProcess {
  const stdout = new PassThrough();

  const stdinWrite = vi.fn((data: string) => {
    const lines = data.trim().split("\n");
    for (const line of lines) {
      if (!line.trim()) continue;
      let req: { id: string; type: string };
      try { req = JSON.parse(line) as { id: string; type: string }; }
      catch { continue; }

      const respond = (msg: object) => {
        const send = () => stdout.push(JSON.stringify(msg) + "\n");
        if (opts.delay) setTimeout(send, opts.delay);
        else setImmediate(send);
      };

      if (req.type === "init") {
        if (opts.initFails) {
          respond({ id: req.id, type: "error", message: "mock init failure" });
        } else {
          respond({ id: req.id, type: "ready" });
        }
      } else if (req.type === "synthesize") {
        if (opts.synthFails) {
          respond({ id: req.id, type: "error", message: "mock synthesis failure" });
        } else {
          respond({ id: req.id, type: "audio", pcmBase64: fakePcmBase64(), sampleRate: 24000 });
        }
      }
    }
    return true;
  });

  const worker = new EventEmitter() as unknown as cp.ChildProcess;
  (worker as unknown as Record<string, unknown>).stdin = {
    write: stdinWrite,
    end: vi.fn(),
  };
  (worker as unknown as Record<string, unknown>).stdout = stdout;

  return worker;
}

function makeSpawnFn(opts: FakeWorkerOpts = {}): WorkerSpawnFn {
  return (_workerPath: string) => createFakeWorker(opts);
}

// ---------------------------------------------------------------------------
// isAvailable() tests
// ---------------------------------------------------------------------------

describe("SherpaSubprocessAdapter.isAvailable()", () => {
  it("M50-SP-02: returns false when sherpa-onnx-node not resolvable", async () => {
    const a = new SherpaSubprocessAdapter({
      resolveFn: () => { throw new Error("not found"); },
      existsFn: () => true,
    });
    expect(await a.isAvailable()).toBe(false);
  });

  it("M50-SP-02: returns false when model.onnx absent", async () => {
    const a = new SherpaSubprocessAdapter({
      resolveFn: () => "/ok",
      existsFn: () => false,
    });
    expect(await a.isAvailable()).toBe(false);
  });

  it("M50-SP-02: returns true when module resolvable AND model present", async () => {
    const a = new SherpaSubprocessAdapter({
      resolveFn: () => "/ok",
      existsFn: () => true,
    });
    expect(await a.isAvailable()).toBe(true);
  });

  it("M50-SP-02: result is memoised — resolveFn called only once", async () => {
    const resolveSpy = vi.fn(() => "/ok");
    const a = new SherpaSubprocessAdapter({ resolveFn: resolveSpy, existsFn: () => true });
    await a.isAvailable();
    const callsAfterFirst = resolveSpy.mock.calls.length;
    await a.isAvailable();
    expect(resolveSpy.mock.calls.length).toBe(callsAfterFirst);
  });
});

// ---------------------------------------------------------------------------
// synthesize() tests
// ---------------------------------------------------------------------------

describe("SherpaSubprocessAdapter.synthesize()", () => {
  let a: SherpaSubprocessAdapter;

  beforeEach(() => {
    a = new SherpaSubprocessAdapter({
      resolveFn: () => "/ok",
      existsFn: () => true,
      spawnFn: makeSpawnFn(),
    });
  });

  it("M50-SP-03: returns Uint8Array audio with correct sampleRate", async () => {
    const result = await a.synthesize({ text: "Hello", language: "en-US" });
    expect(result.audio).toBeInstanceOf(Uint8Array);
    expect(result.sampleRate).toBe(24000);
  });

  it("M50-SP-03: audio byte length is 2× sample count (Int16 PCM)", async () => {
    const result = await a.synthesize({ text: "Hi", language: "en-US" });
    // fakePcmBase64() encodes 4 Int16 samples → 8 bytes
    expect(result.audio.byteLength).toBe(8);
  });

  it("M50-SP-03: concurrent synthesize calls all resolve", async () => {
    const [r1, r2, r3] = await Promise.all([
      a.synthesize({ text: "one", language: "en-US" }),
      a.synthesize({ text: "two", language: "en-US" }),
      a.synthesize({ text: "three", language: "en-US" }),
    ]);
    expect(r1.audio).toBeInstanceOf(Uint8Array);
    expect(r2.audio).toBeInstanceOf(Uint8Array);
    expect(r3.audio).toBeInstanceOf(Uint8Array);
  });

  it("M50-SP-03: rejects when worker synthesis fails", async () => {
    const adapter = new SherpaSubprocessAdapter({
      resolveFn: () => "/ok",
      existsFn: () => true,
      spawnFn: makeSpawnFn({ synthFails: true }),
    });
    await expect(adapter.synthesize({ text: "Hi", language: "en-US" }))
      .rejects
      .toThrow("mock synthesis failure");
  });

  it("M50-SP-03: second synthesize reuses the same worker (no second init)", async () => {
    let spawnCount = 0;
    const adapter = new SherpaSubprocessAdapter({
      resolveFn: () => "/ok",
      existsFn: () => true,
      spawnFn: (_wp) => { spawnCount++; return createFakeWorker(); },
    });
    await adapter.synthesize({ text: "one", language: "en-US" });
    await adapter.synthesize({ text: "two", language: "en-US" });
    expect(spawnCount).toBe(1); // only one worker spawned
  });
});

// ---------------------------------------------------------------------------
// Worker init failure
// ---------------------------------------------------------------------------

describe("SherpaSubprocessAdapter — worker init failure", () => {
  it("M50-SP-03: synthesize rejects when init fails", async () => {
    const adapter = new SherpaSubprocessAdapter({
      resolveFn: () => "/ok",
      existsFn: () => true,
      spawnFn: makeSpawnFn({ initFails: true }),
    });
    await expect(adapter.synthesize({ text: "hi", language: "en-US" }))
      .rejects
      .toThrow("mock init failure");
  });
});

// ---------------------------------------------------------------------------
// dispose()
// ---------------------------------------------------------------------------

describe("SherpaSubprocessAdapter.dispose()", () => {
  it("M50-SP-04: dispose() rejects any still-pending synthesize calls", async () => {
    // Use a worker that never responds (delay >> test timeout would hang — use a manual worker)
    const stdout = new PassThrough();
    const worker = new EventEmitter() as unknown as cp.ChildProcess;
    (worker as unknown as Record<string, unknown>).stdin = {
      write: vi.fn(),  // never responds
      end: vi.fn(),
    };
    (worker as unknown as Record<string, unknown>).stdout = stdout;

    const adapter = new SherpaSubprocessAdapter({
      resolveFn: () => "/ok",
      existsFn: () => true,
      spawnFn: () => worker,
    });

    // Start init + synthesize but don't await — let dispose() interrupt
    const initWorker = adapter["_ensureWorker"](); // kick off init

    // Manually resolve the init so we can test synthesize rejection
    stdout.push(JSON.stringify({ id: "init", type: "ready" }) + "\n");
    await initWorker;

    const synthPromise = adapter.synthesize({ text: "hi", language: "en-US" });
    await adapter.dispose();

    await expect(synthPromise).rejects.toThrow("disposed");
  });
});

// ---------------------------------------------------------------------------
// Static exports
// ---------------------------------------------------------------------------

describe("SherpaSubprocessAdapter — static", () => {
  it("kind is 'tts' and id is 'sherpa-subprocess'", () => {
    const a = new SherpaSubprocessAdapter({
      resolveFn: () => { throw new Error("no"); },
      existsFn: () => false,
    });
    expect(a.kind).toBe("tts");
    expect(a.id).toBe("sherpa-subprocess");
  });
});
