/**
 * M50-WAV — buildWavBuffer + playPcmAudio tests (Phase B — must FAIL before implementation)
 *
 * Coverage: M50-WAV-01 through M50-WAV-05
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SpawnFn } from "../core/audio/playback.js";

// ---------------------------------------------------------------------------
// fs/promises mock
// ---------------------------------------------------------------------------
vi.mock("node:fs/promises", () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  unlink: vi.fn().mockResolvedValue(undefined),
  mkdtemp: vi.fn().mockResolvedValue("/tmp/accordo-wav-xyz"),
}));
vi.mock("node:os", () => ({ tmpdir: vi.fn(() => "/tmp") }));

import { buildWavBuffer } from "../core/audio/wav.js";
import { playPcmAudio } from "../core/audio/playback.js";
import * as fsMock from "node:fs/promises";

/** Flush microtask queue so async chains resolve in tests. */
const flush = (): Promise<void> => new Promise<void>((r) => setImmediate(r));

// ---------------------------------------------------------------------------
// Fake spawn helper (reuse from whisper-cpp tests style)
// ---------------------------------------------------------------------------
class FakeProc {
  public spawnCmd = "";
  public spawnArgs: string[] = [];
  public killed = false;
  private closeCbs: Array<(code: number | null) => void> = [];
  private errorCbs: Array<(e: Error) => void> = [];

  kill(): void { this.killed = true; }
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
    const pcm = new Uint8Array(4);
    const result = buildWavBuffer(pcm, 16000, 1);
    expect(result.toString("ascii", 0, 4)).toBe("RIFF");
  });

  it("M50-WAV-01: contains WAVE format marker at offset 8", () => {
    const pcm = new Uint8Array(4);
    const result = buildWavBuffer(pcm, 16000, 1);
    expect(result.toString("ascii", 8, 12)).toBe("WAVE");
  });

  it("M50-WAV-01: contains data chunk marker at offset 36", () => {
    const pcm = new Uint8Array(4);
    const result = buildWavBuffer(pcm, 16000, 1);
    expect(result.toString("ascii", 36, 40)).toBe("data");
  });
});

// ---------------------------------------------------------------------------
// playPcmAudio tests — M50-WAV-02 through M50-WAV-05
// ---------------------------------------------------------------------------

describe("playPcmAudio", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fsMock.writeFile).mockResolvedValue(undefined);
    vi.mocked(fsMock.unlink).mockResolvedValue(undefined);
    vi.mocked(fsMock.mkdtemp).mockResolvedValue("/tmp/accordo-wav-xyz");
  });

  it("M50-WAV-02: writes temp WAV and invokes platform player", async () => {
    const { spawnFn, procs } = makeSpawn();
    const promise = playPcmAudio(new Uint8Array([0]), 16000, { platform: "darwin", spawnFn });
    await flush();
    expect(procs.length).toBe(1);
    expect(procs[0]!.spawnCmd).toBe("afplay");
    procs[0]!.emitClose(0);
    await promise;
    expect(fsMock.writeFile).toHaveBeenCalled();
  });

  it("M50-WAV-03: uses afplay on macOS", async () => {
    const { spawnFn, procs } = makeSpawn();
    const promise = playPcmAudio(new Uint8Array([0]), 16000, { platform: "darwin", spawnFn });
    await flush();
    expect(procs[0]!.spawnCmd).toBe("afplay");
    procs[0]!.emitClose(0);
    await promise;
  });

  it("M50-WAV-03: uses aplay on Linux", async () => {
    const { spawnFn, procs } = makeSpawn();
    const promise = playPcmAudio(new Uint8Array([0]), 16000, { platform: "linux", spawnFn });
    await flush();
    expect(procs[0]!.spawnCmd).toBe("aplay");
    procs[0]!.emitClose(0);
    await promise;
  });

  it("M50-WAV-03: uses powershell on Windows", async () => {
    const { spawnFn, procs } = makeSpawn();
    const promise = playPcmAudio(new Uint8Array([0]), 16000, { platform: "win32", spawnFn });
    await flush();
    expect(procs[0]!.spawnCmd.toLowerCase()).toBe("powershell");
    procs[0]!.emitClose(0);
    await promise;
  });

  it("M50-WAV-04: temp file is cleaned up after success", async () => {
    const { spawnFn, procs } = makeSpawn();
    const promise = playPcmAudio(new Uint8Array([0]), 16000, { platform: "darwin", spawnFn });
    await flush();
    procs[0]!.emitClose(0);
    await promise;
    expect(fsMock.unlink).toHaveBeenCalled();
  });

  it("M50-WAV-04: temp file is cleaned up after failure", async () => {
    const { spawnFn, procs } = makeSpawn();
    const promise = playPcmAudio(new Uint8Array([0]), 16000, { platform: "darwin", spawnFn });
    await flush();
    procs[0]!.emitClose(1);
    await expect(promise).rejects.toThrow();
    expect(fsMock.unlink).toHaveBeenCalled();
  });

  it("M50-WAV-05: player errors are re-thrown as descriptive Error messages", async () => {
    const { spawnFn, procs } = makeSpawn();
    const promise = playPcmAudio(new Uint8Array([0]), 16000, { platform: "darwin", spawnFn });
    await flush();
    procs[0]!.emitClose(1);
    await expect(promise).rejects.toThrow(/afplay/i);
  });
});
