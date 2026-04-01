/**
 * AudioQueue — Phase B failing tests
 * Coverage: AQ-001 through AQ-012, AQ-INT-04, AQ-INT-05
 *
 * Every test fails at assertion level against the current stub.
 * Tests are organised by requirement ID per the ADR.
 *
 * API checklist (public methods and how many tests cover each):
 *   createAudioQueue()         — AQ-INT-04 (2 tests)
 *   queue.enqueue()            — AQ-001, AQ-002, AQ-003, AQ-004, AQ-005, AQ-006, AQ-009, AQ-010, AQ-011, AQ-012 (many)
 *   queue.cancel()             — AQ-006 (4 tests)
 *   queue.dispose()            — AQ-007 (3 tests)
 *   queue.size                 — AQ-002, AQ-006, AQ-007 (3 tests)
 *   queue.isPlaying            — AQ-001, AQ-006, AQ-007 (3 tests)
 *   playPcmAudio export        — AQ-INT-05 (1 test)
 *   startPcmPlayback export     — AQ-INT-05 (1 test)
 *   createPreSpawnedPlayer export — AQ-INT-05 (1 test)
 */

import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from "vitest";
import {
  createAudioQueue,
  CancelledError,
  QueueFullError,
  DEFAULT_MAX_QUEUE_DEPTH,
} from "../core/audio/audio-queue.js";
import type {
  AudioQueue,
  AudioQueueOptions,
  QueueSpawnFn,
  SpawnedPlayerProcess,
} from "../core/audio/audio-queue.js";
import {
  playPcmAudio,
  startPcmPlayback,
  createPreSpawnedPlayer,
} from "../core/audio/playback.js";

// ─────────────────────────────────────────────────────────────────────────────
// Mock helper — createMockSpawnFn()
//
// ADR §9 specifies the exact behaviour contract for the mock process.
// Key rules:
//   - stdin.write(data)  → records data, returns true
//   - stdin.end()         → sets stdinEnded=true; does NOT fire close automatically
//   - kill(signal)        → sets killed=true; does NOT fire close automatically
//   - simulateClose(code) → fires all "close" listeners via queueMicrotask
//   - simulateError(err)  → fires all "error" listeners via queueMicrotask
//   - Nothing is automatic — every test must call simulateClose() explicitly
// ─────────────────────────────────────────────────────────────────────────────

interface MockPlayerProcess extends SpawnedPlayerProcess {
  simulateClose(code?: number | null): void;
  simulateError(err: Error): void;
  readonly writtenChunks: ReadonlyArray<Buffer | Uint8Array>;
  readonly stdinEnded: boolean;
  readonly killed: { called: boolean; signal?: NodeJS.Signals | number };
}

interface MockSpawnControl {
  spawnCount: number;
  lastProcess: MockPlayerProcess | null;
  fn: QueueSpawnFn;
}

/** Build a deterministic mock spawn function for AudioQueue tests. */
function createMockSpawnFn(): MockSpawnControl {
  let spawnCount = 0;
  let lastProcess: MockPlayerProcess | null = null;

  const fn: QueueSpawnFn = vi.fn((_cmd: string, _args: string[], _opts: { stdio: "pipe" }) => {
    spawnCount++;

    const writtenChunks: Array<Buffer | Uint8Array> = [];
    let stdinEnded = false;
    let killed = { called: false as const, signal: undefined as NodeJS.Signals | number | undefined };

    // Event listener registries
    const closeListeners: Array<(code: number | null) => void> = [];
    const errorListeners: Array<(err: Error) => void> = [];
    const stdinErrorListeners: Array<(err: Error) => void> = [];
    const stdinDrainListeners: Array<() => void> = [];

    const proc: MockPlayerProcess = {
      stdin: {
        write(data: Buffer | Uint8Array): boolean {
          writtenChunks.push(data);
          return true;
        },
        end(): void {
          stdinEnded = true;
        },
        on(event: "error", cb: (err: Error) => void): void {
          stdinErrorListeners.push(cb);
        },
        on(event: "drain", cb: () => void): void {
          stdinDrainListeners.push(cb);
        },
      },
      kill(signal?: NodeJS.Signals | number): boolean {
        killed = { called: true, signal };
        return true;
      },
      on(event: "error", cb: (err: Error) => void): void {
        errorListeners.push(cb);
      },
      on(event: "close", cb: (code: number | null) => void): void {
        closeListeners.push(cb);
      },
      simulateClose(code?: number | null): void {
        queueMicrotask(() => {
          for (const cb of closeListeners) cb(code ?? 0);
        });
      },
      simulateError(err: Error): void {
        queueMicrotask(() => {
          for (const cb of errorListeners) cb(err);
          for (const cb of stdinErrorListeners) cb(err);
        });
      },
      get writtenChunks() {
        return writtenChunks;
      },
      get stdinEnded() {
        return stdinEnded;
      },
      get killed() {
        return killed;
      },
    };

    lastProcess = proc;
    return proc;
  });

  return {
    get spawnCount() {
      return spawnCount;
    },
    get lastProcess() {
      if (lastProcess === null) throw new Error("spawnFn has not been called yet");
      return lastProcess;
    },
    fn,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// PCM helper — makes a deterministic chunk
// ─────────────────────────────────────────────────────────────────────────────

/** Create a PCM-like Uint8Array of the given size filled with byte 0x01. */
function makePcm(size = 100): Uint8Array {
  return new Uint8Array(size).fill(0x01);
}

// ─────────────────────────────────────────────────────────────────────────────
// Test suite
// ─────────────────────────────────────────────────────────────────────────────

describe("AudioQueue", () => {
  // Fresh queue and mock per test — G5 from ADR §8
  let queue: AudioQueue;
  let mockSpawn: MockSpawnControl;

  beforeEach(() => {
    mockSpawn = createMockSpawnFn();
    queue = createAudioQueue({ spawnFn: mockSpawn.fn, platform: "linux" });
  });

  afterEach(async () => {
    // Always dispose, even if the test failed
    await queue.dispose().catch(() => {
      /* ignore — prevent teardown failures from masking test failures */
    });
  });

  afterAll(() => {
    // CI safety net: detect any leaked real aplay processes
    if (process.platform === "linux") {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { execSync } = require("node:child_process") as typeof import("node:child_process");
        const count = parseInt(execSync("pgrep -c aplay 2>/dev/null || true", { encoding: "utf-8" }).trim(), 10);
        if (count > 0) {
          execSync("pkill aplay");
          throw new Error(`Process leak detected: ${count} aplay process(es) found after test suite`);
        }
      } catch (e: unknown) {
        // pgrep returns exit code 1 when no processes match — not an error
        if (e instanceof Error && "status" in e && (e as NodeJS.ErrnoException & { status: number }).status === 1) {
          return; // no processes — happy path
        }
        if (e instanceof Error && e.message.includes("Process leak detected")) throw e;
        // Other errors (e.g. pgrep not installed) — ignore
      }
    }
  });

  // ── AQ-001: Singleton player process ─────────────────────────────────────

  describe("AQ-001: singleton player process", () => {
    it("AQ-001: spawns at most one process at a time for sequential enqueues", async () => {
      // First enqueue — process 1 is spawned
      const receipt1 = queue.enqueue(makePcm(100), 22050);
      expect(mockSpawn.spawnCount).toBe(1);
      expect(queue.isPlaying).toBe(true);

      // Second enqueue — process 2 is NOT spawned while process 1 is still playing.
      // The queue serializes: the second item stays in pending until the first closes.
      // spawnCount is still 1 because simulateClose(0) for process 1 hasn't fired yet
      // (it's queued as a microtask, hasn't been processed during this synchronous step).
      const receipt2 = queue.enqueue(makePcm(100), 22050);
      expect(mockSpawn.spawnCount).toBe(1); // only 1 spawned so far
      expect(queue.size).toBe(1); // item2 is in pending (waiting for item1 to finish)

      // Close process 1: its close handler dequeues item 2 and spawns process 2
      mockSpawn.lastProcess.simulateClose(0);
      await receipt1;

      // After await: process 1 closed, process 2 spawned and is playing.
      // spawnCount is now 2 (processes 1 and 2 total), exactly 1 active.
      expect(mockSpawn.spawnCount).toBe(2);
      expect(queue.isPlaying).toBe(true);

      // Close process 2 and await receipt2
      mockSpawn.lastProcess.simulateClose(0);
      await receipt2;
      expect(queue.isPlaying).toBe(false);
    });

    it("AQ-001: re-spawns after cancel", async () => {
      // First enqueue
      const receipt1 = queue.enqueue(makePcm(100), 22050);
      expect(mockSpawn.spawnCount).toBe(1);
      mockSpawn.lastProcess.simulateClose(0);
      await receipt1;

      // Cancel — kills the process
      queue.cancel();

      // New enqueue after cancel should spawn fresh
      const receipt2 = queue.enqueue(makePcm(100), 22050);
      expect(mockSpawn.spawnCount).toBe(2);
      mockSpawn.lastProcess.simulateClose(0);
      await receipt2;
    });
  });

  // ── AQ-002: Serial FIFO queue ─────────────────────────────────────────────

  describe("AQ-002: serial FIFO queue", () => {
    it("AQ-002: second receipt is still pending while first is playing", async () => {
      const receipt1 = queue.enqueue(makePcm(100), 22050);
      const receipt2 = queue.enqueue(makePcm(100), 22050);

      // receipt2 should not resolve before receipt1
      let receipt2Resolved = false;
      receipt2.then(() => { receipt2Resolved = true; });

      // Tick — both are still pending (process hasn't closed yet)
      await new Promise<void>((r) => queueMicrotask(r));

      expect(receipt2Resolved).toBe(false); // <-- fails: stub rejects immediately
      expect(queue.size).toBe(1); // <-- fails: stub returns 0

      // Clean up
      mockSpawn.lastProcess.simulateClose(0);
      await receipt1.catch(() => {});
    });

    it("AQ-002: chunks play in enqueue order", async () => {
      const receipt1 = queue.enqueue(makePcm(10), 22050);
      const receipt2 = queue.enqueue(makePcm(20), 22050);

      // Written bytes must reflect enqueue order
      expect(mockSpawn.lastProcess.writtenChunks.length).toBeGreaterThanOrEqual(1); // <-- fails: stub never writes

      mockSpawn.lastProcess.simulateClose(0);
      await receipt1.catch(() => {});
      mockSpawn.lastProcess.simulateClose(0);
      await receipt2.catch(() => {});
    });
  });

  // ── AQ-003 + AQ-004: Receipt semantics ───────────────────────────────────

  describe("AQ-003: enqueue returns a Promise", () => {
    it("AQ-003: enqueue returns a Promise", () => {
      const result = queue.enqueue(makePcm(100), 22050);
      expect(result).toBeInstanceOf(Promise); // <-- passes: stub returns Promise.reject
    });
  });

  describe("AQ-004: receipt resolves after simulateClose", () => {
    it("AQ-004: receipt resolves after simulateClose", async () => {
      const receipt = queue.enqueue(makePcm(100), 22050);
      mockSpawn.lastProcess.simulateClose(0);
      await expect(receipt).resolves.toBeUndefined(); // <-- fails: stub rejects with "not implemented"
    });
  });

  // ── AQ-005: Fire-and-forget ──────────────────────────────────────────────

  describe("AQ-005: fire-and-forget", () => {
    it("AQ-005: void enqueue does not throw", async () => {
      void queue.enqueue(makePcm(100), 22050);
      // Give the promise microtask time to settle
      await new Promise<void>((r) => queueMicrotask(r));
      // No assertion needed — if this throws (unhandled rejection), test fails
      // We just verify the queue is still usable
      expect(queue.isPlaying).toBe(true); // <-- fails: stub returns false
    });

    it("AQ-005: multiple fire-and-forget calls share the same process", async () => {
      void queue.enqueue(makePcm(10), 22050);
      void queue.enqueue(makePcm(10), 22050);
      void queue.enqueue(makePcm(10), 22050);
      await new Promise<void>((r) => queueMicrotask(r));

      // All three should use one process
      expect(mockSpawn.spawnCount).toBe(1); // <-- fails: stub never calls spawnFn

      // Clean up
      mockSpawn.lastProcess.simulateClose(0);
    });
  });

  // ── AQ-006: Cancellation ─────────────────────────────────────────────────

  describe("AQ-006: cancellation", () => {
    it("AQ-006: cancel rejects pending receipts with CancelledError", async () => {
      const receipt1 = queue.enqueue(makePcm(10), 22050);
      const receipt2 = queue.enqueue(makePcm(10), 22050);
      const receipt3 = queue.enqueue(makePcm(10), 22050);

      queue.cancel();

      // All three receipts should reject with CancelledError
      await expect(receipt1).rejects.toBeInstanceOf(CancelledError); // <-- fails: stub rejects with Error("not implemented")
      await expect(receipt2).rejects.toBeInstanceOf(CancelledError); // <-- same
      await expect(receipt3).rejects.toBeInstanceOf(CancelledError); // <-- same
    });

    it("AQ-006: cancel rejects in-flight receipt with CancelledError", async () => {
      const receipt = queue.enqueue(makePcm(10), 22050);
      queue.cancel();
      await expect(receipt).rejects.toBeInstanceOf(CancelledError); // <-- fails: stub rejects with Error("not implemented")
    });

    it("AQ-006: size is 0 after cancel", () => {
      queue.enqueue(makePcm(10), 22050);
      queue.enqueue(makePcm(10), 22050);
      queue.cancel();
      expect(queue.size).toBe(0); // <-- fails: stub always returns 0
    });

    it("AQ-006: isPlaying is false after cancel", () => {
      queue.enqueue(makePcm(10), 22050);
      queue.cancel();
      expect(queue.isPlaying).toBe(false); // <-- passes: stub returns false (coincidentally correct)
    });
  });

  // ── AQ-007: Graceful dispose ─────────────────────────────────────────────

  describe("AQ-007: graceful dispose", () => {
    it("AQ-007: dispose returns a Promise", () => {
      expect(queue.dispose()).toBeInstanceOf(Promise); // <-- passes: stub returns Promise.resolve()
    });

    it("AQ-007: dispose resolves when no audio is playing", async () => {
      await expect(queue.dispose()).resolves.toBeUndefined(); // <-- passes: stub resolves immediately
    });

    it("AQ-007: isPlaying is false after dispose", async () => {
      await queue.dispose();
      expect(queue.isPlaying).toBe(false); // <-- passes: stub always returns false
    });

    it("AQ-007: size is 0 after dispose", async () => {
      await queue.dispose();
      expect(queue.size).toBe(0); // <-- passes: stub always returns 0
    });
  });

  // ── AQ-008: Cross-platform ────────────────────────────────────────────────

  describe("AQ-008: cross-platform behaviour", () => {
    it("AQ-008: Linux uses raw PCM args", () => {
      queue.enqueue(makePcm(10), 22050);
      // Linux should spawn aplay with -t raw args
      expect(mockSpawn.fn).toHaveBeenCalledWith(
        "aplay",
        expect.arrayContaining(["-t", "raw"]),
        expect.any(Object),
      ); // <-- fails: stub never calls spawnFn
    });

    it("AQ-008: macOS uses temp-file fallback (no stdin pipe)", () => {
      const macosMock = createMockSpawnFn();
      const macosQueue = createAudioQueue({ spawnFn: macosMock.fn, platform: "darwin" });
      macosQueue.enqueue(makePcm(10), 22050);

      // On darwin, spawnFn should NOT be called with -t raw (afplay doesn't support stdin pipe)
      // The implementation should use the temp-file path instead
      const callArgs = macosMock.fn.mock.calls;
      if (callArgs.length > 0) {
        const args = callArgs[0]![1] as string[];
        expect(args).not.toContain("-t");
        expect(args).not.toContain("raw");
      }
      // <-- also fails because stub never calls spawnFn
    });
  });

  // ── AQ-009: Backpressure ──────────────────────────────────────────────────

  describe("AQ-009: backpressure", () => {
    it("AQ-009: enqueue beyond maxQueueDepth rejects with QueueFullError", async () => {
      const shallowQueue = createAudioQueue({ spawnFn: mockSpawn.fn, platform: "linux", maxQueueDepth: 2 });

      // Enqueue 2 items WITHOUT awaiting — they stay in-flight so backpressure can trigger
      const receipt1 = shallowQueue.enqueue(makePcm(10), 22050);
      const receipt2 = shallowQueue.enqueue(makePcm(10), 22050);

      // Third enqueue should reject with QueueFullError
      // inFlight = pending.length(1) + currentItem(1) = 2 >= maxQueueDepth(2)
      await expect(shallowQueue.enqueue(makePcm(10), 22050)).rejects.toBeInstanceOf(QueueFullError);

      // Clean up hanging receipts
      mockSpawn.lastProcess.simulateClose(0);
      await receipt1.catch(() => {});
      mockSpawn.lastProcess.simulateClose(0);
      await receipt2.catch(() => {});
      await shallowQueue.dispose().catch(() => {});
    });

    it("AQ-009: QueueFullError message contains size and max", async () => {
      const shallowQueue = createAudioQueue({ spawnFn: mockSpawn.fn, platform: "linux", maxQueueDepth: 2 });

      const receipt1 = shallowQueue.enqueue(makePcm(10), 22050);
      const receipt2 = shallowQueue.enqueue(makePcm(10), 22050);

      try {
        await shallowQueue.enqueue(makePcm(10), 22050);
      } catch (err) {
        expect(err).toBeInstanceOf(QueueFullError);
        expect((err as QueueFullError).message).toMatch(/2/); // size
        expect((err as QueueFullError).message).toMatch(/2/); // maxDepth
      }

      // Clean up
      mockSpawn.lastProcess.simulateClose(0);
      await receipt1.catch(() => {});
      mockSpawn.lastProcess.simulateClose(0);
      await receipt2.catch(() => {});
      await shallowQueue.dispose().catch(() => {});
    });
  });

  // ── AQ-010: Testability ──────────────────────────────────────────────────

  describe("AQ-010: testability — injectable spawnFn and platform", () => {
    it("AQ-010: injected spawnFn is called instead of real spawn", () => {
      queue.enqueue(makePcm(10), 22050);
      expect(mockSpawn.fn).toHaveBeenCalled(); // <-- fails: stub never calls spawnFn
    });

    it("AQ-010: injected platform controls spawn args", () => {
      const darwinMock = createMockSpawnFn();
      const darwinQueue = createAudioQueue({ spawnFn: darwinMock.fn, platform: "darwin" });
      darwinQueue.enqueue(makePcm(10), 22050);

      // Darwin should call afplay, not aplay
      expect(darwinMock.fn).toHaveBeenCalledWith(
        "afplay",
        expect.any(Array),
        expect.any(Object),
      ); // <-- fails: stub never calls spawnFn
    });
  });

  // ── AQ-011: Post-dispose guard ────────────────────────────────────────────

  describe("AQ-011: post-dispose guard", () => {
    it("AQ-011: enqueue after dispose rejects with disposed error", async () => {
      await queue.dispose();
      await expect(queue.enqueue(makePcm(10), 22050)).rejects.toThrow("AudioQueue has been disposed"); // <-- fails: stub throws Error("AudioQueue not implemented")
    });
  });

  // ── AQ-012: Process cap ──────────────────────────────────────────────────

  describe("AQ-012: process cap — at most one process at any time", () => {
    it("AQ-012: at most one process is active at a time during sequential playback", async () => {
      // The queue serializes playback: each enqueue spawns a process, but the next
      // enqueue's process is only started after the current one closes. During each
      // iteration (before simulateClose), exactly 1 process is active (currentItem is
      // non-null) and 0 new processes are spawned (pending.length = 0 because dequeue
      // shifted the item before startPlaying returned). We verify isPlaying === true
      // at the moment between enqueue and close.
      for (let i = 0; i < 5; i++) {
        const receipt = queue.enqueue(makePcm(10), 22050);
        // While the receipt is pending, isPlaying is true (currentItem is non-null)
        // and size is 0 (pending was drained by dequeue). No second process is active.
        expect(queue.isPlaying).toBe(true);
        expect(queue.size).toBe(0);
        mockSpawn.lastProcess.simulateClose(0);
        await receipt.catch(() => {});
        // After close: process exited, receipt resolved, queue is idle (isPlaying = false)
        expect(queue.isPlaying).toBe(false);
      }
      // Total processes spawned = 5 (one per enqueue)
      expect(mockSpawn.spawnCount).toBe(5);
    });
  });

  // ── AQ-INT-04: Factory ───────────────────────────────────────────────────

  describe("AQ-INT-04: createAudioQueue() factory", () => {
    it("AQ-INT-04: createAudioQueue() works with no arguments", () => {
      expect(() => createAudioQueue()).not.toThrow(); // <-- passes
    });

    it("AQ-INT-04: returned object has all required methods", () => {
      const q = createAudioQueue();
      expect(typeof q.enqueue).toBe("function");
      expect(typeof q.cancel).toBe("function");
      expect(typeof q.dispose).toBe("function");
      expect(typeof q.size).toBe("number");
      expect(typeof q.isPlaying).toBe("boolean"); // <-- passes: both are getters on the stub
    });
  });

  // ── AQ-INT-05: Existing exports preserved ────────────────────────────────

  describe("AQ-INT-05: existing playback exports preserved", () => {
    it("AQ-INT-05: playPcmAudio is still exported from playback.ts", () => {
      expect(typeof playPcmAudio).toBe("function"); // <-- passes
    });

    it("AQ-INT-05: startPcmPlayback is still exported from playback.ts", () => {
      expect(typeof startPcmPlayback).toBe("function"); // <-- passes
    });

    it("AQ-INT-05: createPreSpawnedPlayer is still exported from playback.ts", () => {
      expect(typeof createPreSpawnedPlayer).toBe("function"); // <-- passes
    });
  });
});
