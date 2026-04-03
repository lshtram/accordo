import { describe, it, expect, vi } from "vitest";
import { PassThrough } from "node:stream";
import { EventEmitter } from "node:events";
import type * as cp from "node:child_process";
import { KokoroSubprocessAdapter } from "../core/adapters/kokoro-subprocess.js";
import type { WorkerSpawnFn } from "../core/adapters/kokoro-subprocess.js";

function fakePcmBase64(): string {
  const samples = new Int16Array([0, 1000, -1000, 2000]);
  return Buffer.from(samples.buffer).toString("base64");
}

function createFakeWorker(initFails = false, synthFails = false): cp.ChildProcess {
  const stdout = new PassThrough();
  const stdinWrite = vi.fn((data: string) => {
    const lines = data.trim().split("\n");
    for (const line of lines) {
      if (!line.trim()) continue;
      const req = JSON.parse(line) as { id: string; type: string };
      if (req.type === "init") {
        setImmediate(() => stdout.push(JSON.stringify(initFails
          ? { id: req.id, type: "error", message: "mock init failure" }
          : { id: req.id, type: "ready" }) + "\n"));
      } else if (req.type === "synthesize") {
        setImmediate(() => stdout.push(JSON.stringify(synthFails
          ? { id: req.id, type: "error", message: "mock synthesis failure" }
          : { id: req.id, type: "audio", pcmBase64: fakePcmBase64(), sampleRate: 24000 }) + "\n"));
      }
    }
    return true;
  });
  const worker = new EventEmitter() as unknown as cp.ChildProcess;
  (worker as unknown as Record<string, unknown>).stdin = { write: stdinWrite, end: vi.fn() };
  (worker as unknown as Record<string, unknown>).stdout = stdout;
  (worker as unknown as Record<string, unknown>).stderr = new PassThrough();
  return worker;
}

function makeSpawn(initFails = false, synthFails = false): WorkerSpawnFn {
  return () => createFakeWorker(initFails, synthFails);
}

describe("KokoroSubprocessAdapter", () => {
  it("returns true when kokoro-js is resolvable", async () => {
    const a = new KokoroSubprocessAdapter({ resolveFn: () => "/ok", spawnFn: makeSpawn() });
    expect(await a.isAvailable()).toBe(true);
  });

  it("returns false when kokoro-js is not resolvable", async () => {
    const a = new KokoroSubprocessAdapter({ resolveFn: () => { throw new Error("no"); }, spawnFn: makeSpawn() });
    expect(await a.isAvailable()).toBe(false);
  });

  it("synthesizes via worker", async () => {
    const a = new KokoroSubprocessAdapter({ resolveFn: () => "/ok", spawnFn: makeSpawn() });
    const r = await a.synthesize({ text: "hello", language: "en-US" });
    expect(r.audio).toBeInstanceOf(Uint8Array);
    expect(r.sampleRate).toBe(24000);
  });

  it("rejects when worker init fails", async () => {
    const a = new KokoroSubprocessAdapter({ resolveFn: () => "/ok", spawnFn: makeSpawn(true, false) });
    await expect(a.synthesize({ text: "hello", language: "en-US" })).rejects.toThrow("mock init failure");
  });

  it("rejects when worker synthesis fails", async () => {
    const a = new KokoroSubprocessAdapter({ resolveFn: () => "/ok", spawnFn: makeSpawn(false, true) });
    await expect(a.synthesize({ text: "hello", language: "en-US" })).rejects.toThrow("mock synthesis failure");
  });
});
