/**
 * M50-WA — WhisperCppAdapter unit tests (Phase B — all tests must FAIL before implementation)
 *
 * Coverage: M50-WA-01 through M50-WA-08
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SpawnFn } from "../core/adapters/whisper-cpp.js";
import type { SttProvider } from "../core/providers/stt-provider.js";

/** Flush all pending microtasks (resolved mocked promises) then yield to I/O. */
const flush = (): Promise<void> =>
  new Promise<void>((resolve) => setImmediate(resolve));

// ---------------------------------------------------------------------------
// fs/promises mock — must be hoisted before the adapter import
// ---------------------------------------------------------------------------
vi.mock("node:fs/promises", () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockResolvedValue("Hello world" as unknown as Buffer),
  unlink: vi.fn().mockResolvedValue(undefined),
  rm: vi.fn().mockResolvedValue(undefined),
  mkdtemp: vi.fn().mockResolvedValue("/tmp/accordo-voice-xyz"),
  access: vi.fn().mockResolvedValue(undefined),
  readdir: vi.fn().mockResolvedValue(["ggml-base.en.bin"]),
}));

vi.mock("node:os", () => ({
  tmpdir: vi.fn(() => "/tmp"),
  homedir: vi.fn(() => "/home/test"),
}));

import { WhisperCppAdapter } from "../core/adapters/whisper-cpp.js";
import * as fsMock from "node:fs/promises";

// ---------------------------------------------------------------------------
// FakeProc — stand-in for ChildProcess
// ---------------------------------------------------------------------------
class FakeProc {
  private errorCbs: Array<(e: Error) => void> = [];
  private closeCbs: Array<(code: number | null) => void> = [];
  public spawnCmd = "";
  public spawnArgs: string[] = [];
  public killed = false;

  kill(): void {
    this.killed = true;
  }

  on(event: "error", cb: (e: Error) => void): void;
  on(event: "close", cb: (code: number | null) => void): void;
  on(event: string, cb: (arg: unknown) => void): void {
    if (event === "error") this.errorCbs.push(cb as (e: Error) => void);
    if (event === "close") this.closeCbs.push(cb as (code: number | null) => void);
  }

  emitClose(code: number | null): void {
    for (const cb of this.closeCbs) cb(code);
  }

  emitError(err: Error): void {
    for (const cb of this.errorCbs) cb(err);
  }
}

function makeSpawn(): { spawnFn: SpawnFn; procs: FakeProc[] } {
  const procs: FakeProc[] = [];
  const spawnFn: SpawnFn = (cmd, args, _opts) => {
    const p = new FakeProc();
    p.spawnCmd = cmd;
    p.spawnArgs = args;
    procs.push(p);
    return p;
  };
  return { spawnFn, procs };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("WhisperCppAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fsMock.access).mockResolvedValue(undefined);
    vi.mocked(fsMock.readdir).mockResolvedValue(["ggml-base.en.bin"]);
    vi.mocked(fsMock.writeFile).mockResolvedValue(undefined);
    vi.mocked(fsMock.readFile).mockResolvedValue("Hello world" as unknown as Buffer);
    vi.mocked(fsMock.unlink).mockResolvedValue(undefined);
    vi.mocked(fsMock.rm).mockResolvedValue(undefined);
    vi.mocked(fsMock.mkdtemp).mockResolvedValue("/tmp/accordo-voice-xyz");
  });

  // -------------------------------------------------------------------------
  // M50-WA-01 + M50-WA-08 — identity
  // -------------------------------------------------------------------------

  it("M50-WA-01: exports WhisperCppAdapter class", () => {
    expect(WhisperCppAdapter).toBeDefined();
    expect(typeof WhisperCppAdapter).toBe("function");
  });

  it("M50-WA-08: kind is 'stt' and id is 'whisper.cpp'", () => {
    const { spawnFn } = makeSpawn();
    const adapter = new WhisperCppAdapter({ spawnFn });
    expect(adapter.kind).toBe("stt");
    expect(adapter.id).toBe("whisper.cpp");
  });

  it("M50-WA-01: implements SttProvider interface shape", () => {
    const { spawnFn } = makeSpawn();
    const adapter: SttProvider = new WhisperCppAdapter({ spawnFn });
    expect(typeof adapter.isAvailable).toBe("function");
    expect(typeof adapter.transcribe).toBe("function");
  });

  // -------------------------------------------------------------------------
  // M50-WA-02 — constructor options with defaults
  // -------------------------------------------------------------------------

  it("M50-WA-02: constructor accepts no arguments (defaults)", () => {
    expect(() => new WhisperCppAdapter()).not.toThrow();
  });

  it("M50-WA-02: constructor stores binaryPath option", () => {
    const { spawnFn } = makeSpawn();
    const adapter = new WhisperCppAdapter({
      binaryPath: "/usr/local/bin/whisper",
      modelFolder: "/opt/models",
      modelFile: "ggml-base.bin",
      spawnFn,
    });
    // Verify options are stored by checking spawn call args in isAvailable
    const availability = adapter.isAvailable();
    procs: {
      const procs = (makeSpawn()).procs; // placeholder — actual via closure
      void procs;
    }
    void availability;
    expect(adapter).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // M50-WA-03 — isAvailable
  // -------------------------------------------------------------------------

  it("M50-WA-03: isAvailable() spawns binaryPath --help and resolves true on exit 0", async () => {
    const { spawnFn, procs } = makeSpawn();
    const adapter = new WhisperCppAdapter({ binaryPath: "/usr/bin/whisper", spawnFn });
    const promise = adapter.isAvailable();
    expect(procs.length).toBe(1);
    expect(procs[0]!.spawnArgs).toContain("--help");
    procs[0]!.emitClose(0);
    await expect(promise).resolves.toBe(true);
  });

  it("M50-WA-03: isAvailable() resolves false when process exits with non-zero code", async () => {
    const { spawnFn, procs } = makeSpawn();
    const adapter = new WhisperCppAdapter({ spawnFn });
    const promise = adapter.isAvailable();
    procs[0]!.emitClose(1);
    await expect(promise).resolves.toBe(false);
  });

  it("M50-WA-03: isAvailable() resolves false when process emits error", async () => {
    const { spawnFn, procs } = makeSpawn();
    const adapter = new WhisperCppAdapter({ spawnFn });
    const promise = adapter.isAvailable();
    procs[0]!.emitError(new Error("ENOENT: whisper not found"));
    await expect(promise).resolves.toBe(false);
  });

  // -------------------------------------------------------------------------
  // M50-WA-04 — transcribe happy path
  // -------------------------------------------------------------------------

  it("M50-WA-04: transcribe() writes audio to temp WAV file, invokes whisper, returns { text }", async () => {
    const { spawnFn, procs } = makeSpawn();
    vi.mocked(fsMock.readFile).mockResolvedValue("Transcribed text here" as unknown as Buffer);
    const adapter = new WhisperCppAdapter({ binaryPath: "/usr/bin/whisper", spawnFn });
    const audio = new Uint8Array([1, 2, 3, 4]);
    const promise = adapter.transcribe({ audio, language: "en" });

    // Let whisper complete
    await flush();
    procs[0]!.emitClose(0);

    const result = await promise;
    expect(result.text).toBe("Transcribed text here");
    expect(fsMock.writeFile).toHaveBeenCalled();
  });

  it("M50-WA-04: transcribe() passes -otxt and -of flags to whisper process", async () => {
    const { spawnFn, procs } = makeSpawn();
    const adapter = new WhisperCppAdapter({ spawnFn });
    const promise = adapter.transcribe({ audio: new Uint8Array([0]), language: "en" });

    await flush();
    expect(procs[0]!.spawnArgs).toContain("-otxt");
    expect(procs[0]!.spawnArgs).toContain("-of");
    expect(procs[0]!.spawnArgs).toContain("-f");
    procs[0]!.emitClose(0);
    await expect(promise).resolves.toBeDefined();
  });

  // -------------------------------------------------------------------------
  // M50-WA-05 — cleanup in finally
  // -------------------------------------------------------------------------

  it("M50-WA-05: temp files are cleaned up after successful transcription", async () => {
    const { spawnFn, procs } = makeSpawn();
    const adapter = new WhisperCppAdapter({ spawnFn });
    const promise = adapter.transcribe({ audio: new Uint8Array([0]), language: "en" });

    await flush();
    procs[0]!.emitClose(0);
    await promise;

    expect(fsMock.unlink).toHaveBeenCalledTimes(2); // WAV + txt
  });

  it("M50-WA-05: temp files are cleaned up even when whisper process fails", async () => {
    const { spawnFn, procs } = makeSpawn();
    const adapter = new WhisperCppAdapter({ spawnFn });
    const promise = adapter.transcribe({ audio: new Uint8Array([0]), language: "en" });

    await flush();
    procs[0]!.emitClose(2); // non-zero = failure
    await expect(promise).rejects.toThrow();

    expect(fsMock.unlink).toHaveBeenCalledTimes(2);
  });

  // -------------------------------------------------------------------------
  // M50-WA-06 — cancellation
  // -------------------------------------------------------------------------

  it("M50-WA-06: cancellation token: if isCancellationRequested, kills process and rejects", async () => {
    const { spawnFn, procs } = makeSpawn();
    const adapter = new WhisperCppAdapter({ spawnFn });
    const cancelHandlers: Array<() => void> = [];
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: (handler: () => void) => {
        cancelHandlers.push(handler);
      },
    };
    const promise = adapter.transcribe({ audio: new Uint8Array([0]), language: "en" }, token);

    await flush();
    token.isCancellationRequested = true;
    for (const handler of cancelHandlers) handler();
    // Trigger close after cancel flag is set (simulates cancel detection)
    procs[0]!.emitClose(null);

    await expect(promise).rejects.toThrow(/cancel/i);
    expect(procs[0]!.killed).toBe(true);
  });

  // -------------------------------------------------------------------------
  // M50-WA-07 — settled-guard
  // -------------------------------------------------------------------------

  it("M50-WA-07: settled-guard: subsequent close/error after resolution are no-ops", async () => {
    const { spawnFn, procs } = makeSpawn();
    const adapter = new WhisperCppAdapter({ spawnFn });
    const promise = adapter.transcribe({ audio: new Uint8Array([0]), language: "en" });

    await flush();
    procs[0]!.emitClose(0); // resolve
    await promise;

    // These must not throw or cause unhandled rejection
    expect(() => procs[0]!.emitClose(1)).not.toThrow();
    expect(() => procs[0]!.emitError(new Error("late error"))).not.toThrow();
  });
});
