/**
 * M50-WAV — buildWavBuffer + playPcmAudio tests (Phase B — must FAIL before implementation)
 *
 * Coverage: M50-WAV-01 through M50-WAV-05
 * Note: createPreSpawnedPlayer and CachedSound removed in v2.0 simplification.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SpawnFn } from "../core/audio/playback.js";

// ---------------------------------------------------------------------------
// fs/promises mock
// ---------------------------------------------------------------------------
vi.mock("node:fs/promises", () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  rm: vi.fn().mockResolvedValue(undefined),
  mkdtemp: vi.fn().mockResolvedValue("/tmp/accordo-wav-xyz"),
}));
vi.mock("node:os", () => ({ tmpdir: vi.fn(() => "/tmp") }));

import { buildWavBuffer } from "../core/audio/wav.js";
import { playPcmAudio } from "../core/audio/playback.js";
import * as fsMock from "node:fs/promises";

/** Flush microtask queue so async chains resolve in tests. */
const flush = (): Promise<void> => new Promise<void>((r) => setImmediate(r));

// ---------------------------------------------------------------------------
// Fake spawn helper
// ---------------------------------------------------------------------------
class FakeProc {
  public spawnCmd = "";
  public spawnArgs: string[] = [];
  public killed = false;
  private closeCbs: Array<(code: number | null) => void> = [];
  private errorCbs: Array<(e: Error) => void> = [];

  kill(_signal?: NodeJS.Signals | number): boolean {
    this.killed = true;
    return true;
  }
  on(event: "close", cb: (code: number | null) => void): void;
  on(event: "error", cb: (e: Error) => void): void;
  on(event: string, cb: (arg: unknown) => void): void {
    if (event === "close") this.closeCbs.push(cb as (code: number | null) => void);
    if (event === "error") this.errorCbs.push(cb as (e: Error) => void);
  }
  emitClose(code: number | null): void { for (const cb of this.closeCbs) cb(code); }
  emitError(err: Error): void { for (const cb of this.errorCbs) cb(err); }
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
// buildWavBuffer tests — M50-WAV-01
// ---------------------------------------------------------------------------

describe("buildWavBuffer", () => {
  it("M50-WAV-01: returns a Buffer", () => {
    const pcm = new Uint8Array([0, 1, 2, 3]);
    const result = buildWavBuffer(pcm, 16000, 1);
    expect(result).toBeInstanceOf(Buffer);
  });

  it("M50-WAV-01: output length is 44 + pcm.byteLength", () => {
    const pcm = new Uint8Array(100);
    const result = buildWavBuffer(pcm, 16000, 1);
    expect(result.byteLength).toBe(44 + 100);
  });

  it("M50-WAV-01: starts with RIFF signature", () => {
    const pcm = new Uint8Array(100);
    const result = buildWavBuffer(pcm, 16000, 1);
    // RIFF = 0x52 0x49 0x46 0x46
    expect(result[0]).toBe(0x52); // R
    expect(result[1]).toBe(0x49); // I
    expect(result[2]).toBe(0x46); // F
    expect(result[3]).toBe(0x46); // F
  });

  it("M50-WAV-01: contains WAVE format marker at offset 8", () => {
    const pcm = new Uint8Array(100);
    const result = buildWavBuffer(pcm, 16000, 1);
    // WAVE = 0x57 0x41 0x56 0x45
    expect(result[8]).toBe(0x57);  // W
    expect(result[9]).toBe(0x41);  // A
    expect(result[10]).toBe(0x56); // V
    expect(result[11]).toBe(0x45); // E
  });

  it("M50-WAV-01: contains data chunk marker at offset 36", () => {
    const pcm = new Uint8Array(100);
    const result = buildWavBuffer(pcm, 16000, 1);
    // data = 0x64 0x61 0x74 0x61
    expect(result[36]).toBe(0x64);  // d
    expect(result[37]).toBe(0x61);  // a
    expect(result[38]).toBe(0x74);  // t
    expect(result[39]).toBe(0x61); // a
  });
});

// ---------------------------------------------------------------------------
// playPcmAudio tests — M50-WAV-02 through M50-WAV-05
// ---------------------------------------------------------------------------

describe("playPcmAudio", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fsMock.writeFile).mockResolvedValue(undefined);
    vi.mocked(fsMock.rm).mockResolvedValue(undefined);
    vi.mocked(fsMock.mkdtemp).mockResolvedValue("/tmp/accordo-wav-xyz");
  });

  it("M50-WAV-02: writes temp WAV and invokes platform player", async () => {
    const { spawnFn, procs } = makeSpawn();
    const p = playPcmAudio(new Uint8Array([0]), 16000, { platform: "linux", spawnFn });
    await flush();
    expect(fsMock.writeFile).toHaveBeenCalled();
    expect(procs.length).toBe(1);
    procs[0]!.emitClose(0);
    await p;
  });

  it("M50-WAV-03: uses afplay on macOS", async () => {
    const { spawnFn, procs } = makeSpawn();
    const p = playPcmAudio(new Uint8Array([0]), 16000, { platform: "darwin", spawnFn });
    await flush();
    expect(procs[0]!.spawnCmd).toBe("afplay");
    procs[0]!.emitClose(0);
    await p;
  });

  it("M50-WAV-03: uses aplay on Linux", async () => {
    const { spawnFn, procs } = makeSpawn();
    const p = playPcmAudio(new Uint8Array([0]), 16000, { platform: "linux", spawnFn });
    await flush();
    expect(procs[0]!.spawnCmd).toBe("aplay");
    procs[0]!.emitClose(0);
    await p;
  });

  it("M50-WAV-03: uses powershell on Windows", async () => {
    const { spawnFn, procs } = makeSpawn();
    const p = playPcmAudio(new Uint8Array([0]), 16000, { platform: "win32", spawnFn });
    await flush();
    expect(procs[0]!.spawnCmd).toBe("powershell");
    procs[0]!.emitClose(0);
    await p;
  });

  it("M50-WAV-04: temp file is cleaned up after success", async () => {
    const { spawnFn, procs } = makeSpawn();
    const p = playPcmAudio(new Uint8Array([0]), 16000, { platform: "linux", spawnFn });
    await flush();
    procs[0]!.emitClose(0);
    await p;
    expect(fsMock.rm).toHaveBeenCalled();
  });

  it("M50-WAV-04: temp file is cleaned up after failure", async () => {
    const { spawnFn, procs } = makeSpawn();
    const p = playPcmAudio(new Uint8Array([0]), 16000, { platform: "linux", spawnFn });
    await flush();
    procs[0]!.emitClose(1);
    await expect(p).rejects.toThrow();
    expect(fsMock.rm).toHaveBeenCalled();
  });

  it("M50-WAV-05: player errors are re-thrown as descriptive Error messages", async () => {
    const { spawnFn, procs } = makeSpawn();
    const p = playPcmAudio(new Uint8Array([0]), 16000, { platform: "darwin", spawnFn });
    await flush();
    procs[0]!.emitClose(1);
    await expect(p).rejects.toThrow(/afplay.*exit.*1/i);
  });
});
