import { describe, it, expect, vi } from "vitest";
import { PassThrough } from "node:stream";
import { EventEmitter } from "node:events";
import type * as cp from "node:child_process";
import { PythonKokoroGpuSubprocessAdapter } from "../core/adapters/python-kokoro-gpu-subprocess.js";

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
          ? { id: req.id, type: "error", message: "gpu init failed" }
          : { id: req.id, type: "ready" }) + "\n"));
      } else if (req.type === "synthesize") {
        setImmediate(() => stdout.push(JSON.stringify(synthFails
          ? { id: req.id, type: "error", message: "gpu synth failed" }
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

describe("PythonKokoroGpuSubprocessAdapter", () => {
  it("is available when configured python exists", async () => {
    const adapter = new PythonKokoroGpuSubprocessAdapter({
      pythonPath: "/tmp/python",
      existsFn: () => true,
      spawnFn: () => createFakeWorker(),
    });
    expect(await adapter.isAvailable()).toBe(true);
  });

  it("is unavailable when configured python is missing", async () => {
    const adapter = new PythonKokoroGpuSubprocessAdapter({
      pythonPath: "/tmp/missing-python",
      existsFn: () => false,
      spawnFn: () => createFakeWorker(),
    });
    expect(await adapter.isAvailable()).toBe(false);
  });

  it("synthesizes audio through the Python worker", async () => {
    const adapter = new PythonKokoroGpuSubprocessAdapter({
      existsFn: () => true,
      spawnFn: () => createFakeWorker(),
    });
    const result = await adapter.synthesize({ text: "hello", language: "en-US" });
    expect(result.audio).toBeInstanceOf(Uint8Array);
    expect(result.sampleRate).toBe(24000);
  });

  it("rejects when worker init fails", async () => {
    const adapter = new PythonKokoroGpuSubprocessAdapter({
      existsFn: () => true,
      spawnFn: () => createFakeWorker(true, false),
    });
    await expect(adapter.synthesize({ text: "hello", language: "en-US" })).rejects.toThrow("gpu init failed");
  });

  it("rejects when worker synthesis fails", async () => {
    const adapter = new PythonKokoroGpuSubprocessAdapter({
      existsFn: () => true,
      spawnFn: () => createFakeWorker(false, true),
    });
    await expect(adapter.synthesize({ text: "hello", language: "en-US" })).rejects.toThrow("gpu synth failed");
  });
});
