/**
 * AudioQueue — singleton audio player with receipt-based sequencing.
 *
 * Maintains a single persistent audio player process for the VS Code session.
 * PCM audio chunks are enqueued and played sequentially in FIFO order.
 * Each enqueue() returns a "receipt" Promise that resolves when that specific
 * chunk finishes playing — enabling precise step sequencing in scripts.
 *
 * AQ-001 through AQ-012, AQ-INT-01 through AQ-INT-05
 */

import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

// ── Constants ────────────────────────────────────────────────────────────────

/** AQ-009: Default maximum number of chunks allowed in the queue. */
export const DEFAULT_MAX_QUEUE_DEPTH = 10;

// ── Error classes ────────────────────────────────────────────────────────────

/**
 * AQ-006: Thrown when a pending enqueue receipt is rejected due to cancellation.
 */
export class CancelledError extends Error {
  constructor(message = "Audio playback was cancelled") {
    super(message);
    this.name = "CancelledError";
  }
}

/**
 * AQ-009: Thrown when the queue depth exceeds the configured limit.
 */
export class QueueFullError extends Error {
  constructor(currentSize: number, maxDepth: number) {
    super(`Audio queue is full (${String(currentSize)}/${String(maxDepth)} chunks)`);
    this.name = "QueueFullError";
  }
}

// ── Types ────────────────────────────────────────────────────────────────────

interface StdinObject {
  readonly write: (data: Buffer | Uint8Array) => boolean;
  readonly end: () => void;
  // eslint-disable-next-line @typescript-eslint/only-throw-error
  readonly on: (event: string, cb: (...args: unknown[]) => void) => void;
}

export interface SpawnedPlayerProcess {
  readonly stdin: StdinObject;
  readonly kill: (signal?: NodeJS.Signals | number) => boolean;
  // eslint-disable-next-line @typescript-eslint/only-throw-error
  readonly on: (event: string, cb: (...args: unknown[]) => void) => void;
  readonly tempPath?: string;
}

export type QueueSpawnFn = (
  cmd: string,
  args: string[],
  options: { stdio: "pipe" },
) => SpawnedPlayerProcess;

export interface AudioQueueOptions {
  platform?: NodeJS.Platform;
  spawnFn?: QueueSpawnFn;
  maxQueueDepth?: number;
  log?: (msg: string) => void;
}

interface QueuedItem {
  pcm: Uint8Array;
  sampleRate: number;
  resolve: () => void;
  reject: (err: Error) => void;
}

export interface AudioQueue {
  enqueue(pcm: Uint8Array, sampleRate: number): Promise<void>;
  cancel(): void;
  dispose(): Promise<void>;
  readonly size: number;
  readonly isPlaying: boolean;
}

// ── Platform spawners ─────────────────────────────────────────────────────────

/**
 * Linux spawner: spawns aplay in raw PCM stdin-pipe mode.
 * Synchronous — process is started before the function returns.
 */
function linuxSpawn(
  spawnFn: QueueSpawnFn,
  sampleRate: number,
): SpawnedPlayerProcess {
  return spawnFn("aplay", [
    "-t", "raw", "-f", "S16_LE",
    "-r", String(sampleRate), "-c", "1", "-",
  ], { stdio: "pipe" });
}

/**
 * Darwin spawner: writes PCM to a temp file synchronously, then spawns afplay.
 * Synchronous for the same reason as linux — needed so currentItem is set
 * before the enqueue function returns (prevents double-spawn in tight loops).
 */
function darwinSpawn(
  spawnFn: QueueSpawnFn,
  pcm: Uint8Array,
  _sampleRate: number,
): SpawnedPlayerProcess {
  const tempPath = join(tmpdir(), `accordo-${randomUUID()}.pcm`);
  writeFileSync(tempPath, Buffer.from(pcm)); // sync — throws immediately on failure
  return spawnFn("afplay", [tempPath], { stdio: "pipe" });
}

/**
 * Remove a temp file if it exists (fire-and-forget).
 * Used to clean up Darwin temp PCM files after afplay finishes.
 */
function tryRemoveTemp(tempPath: string): void {
  try {
    const { rmSync } = require("node:fs");
    rmSync(tempPath, { force: true });
  } catch {
    /* ignore — best effort */
  }
}

// ── Factory ──────────────────────────────────────────────────────────────────

export function createAudioQueue(options: AudioQueueOptions = {}): AudioQueue {
  const platform = options.platform ?? process.platform;
  const spawnFn = options.spawnFn;
  const maxQueueDepth = options.maxQueueDepth ?? DEFAULT_MAX_QUEUE_DEPTH;
  const log = options.log;

  let disposed = false;
  let currentProcess: SpawnedPlayerProcess | null = null;
  let currentItem: QueuedItem | null = null;
  const pending: QueuedItem[] = [];

  // ── startPlaying ──────────────────────────────────────────────────────────
  //
  // Starts playing an item that has already been shifted from pending.
  // For linux: spawns aplay and writes PCM to its stdin, then calls stdin.end()
  // so aplay finishes playing and fires the 'close' event (enabling receipt resolution).
  // For darwin: writes PCM to temp file (sync) and spawns afplay, which exits
  // after playing the file and fires the 'close' event.
  //
  // Sets currentItem and currentProcess BEFORE returning so that any
  // subsequent enqueue call sees currentItem !== null and does NOT spawn.
  //
  // F-C1 fix: calling stdin.end() on linux is required — without it, aplay -t raw
  // waits for EOF on stdin and never exits, so the 'close' event never fires and
  // the receipt promise never resolves. Each chunk therefore gets its own aplay
  // process (same as darwin), but the queue still provides FIFO ordering and
  // prevents concurrent processes.
  //
  function startPlaying(item: QueuedItem): void {
    const proc = platform === "darwin"
      ? darwinSpawn(
          spawnFn ?? ((cmd, args, opts) => {
            const child = spawn(cmd, args, opts);
            return { stdin: child.stdin, kill: child.kill.bind(child), on: child.on.bind(child), tempPath: args[0] };
          }),
          item.pcm,
          item.sampleRate,
        )
      : linuxSpawn(
          spawnFn ?? ((cmd, args, opts) => {
            const child = spawn(cmd, args, opts);
            return { stdin: child.stdin, kill: child.kill.bind(child), on: child.on.bind(child) };
          }),
          item.sampleRate,
        );

    const tempPath = proc.tempPath;

    currentProcess = proc;
    proc.stdin.write(Buffer.from(item.pcm));
    // F-C1 fix: end stdin so aplay knows to finish playing and exit.
    // Without this, aplay -t raw waits for EOF forever and 'close' never fires.
    proc.stdin.end();

    proc.on("close", ((code: number | null) => {
      // F-C3 fix: signal-killed processes (code = null) have also died.
      // 'disposed' is already checked; code = null means killed by SIGTERM/SIGKILL.
      const processDied = disposed || code !== 0;
      if (processDied) {
        currentProcess = null;
      }

      if (currentItem !== null) {
        if (code === 0 || code === null) {
          currentItem!.resolve();
        } else {
          currentItem!.reject(new Error(`Audio player exited with code ${String(code)}`));
        }
        currentItem = null;
      }

      // F-C2 fix: clean up the Darwin temp file after afplay exits.
      if (tempPath) {
        tryRemoveTemp(tempPath);
      }

      // Both linux and darwin: each process handles exactly one chunk.
      // After close, spawn the next process if items remain.
      if (!disposed && pending.length > 0) {
        const nextItem = pending.shift()!;
        currentItem = nextItem;
        startPlaying(nextItem);
      }
    }) as (...args: unknown[]) => void);
  }

  // ── dequeue ─────────────────────────────────────────────────────────────
  //
  // Picks the next item from pending and starts playing it.
  // MUST be called only when: currentItem === null && pending.length > 0.
  // Synchronous — needed so pending.length is decremented immediately after
  // enqueue() pushes an item, before any backpressure check runs.
  //
  function dequeue(): void {
    if (disposed || pending.length === 0 || currentItem !== null) {
      return;
    }
    const item = pending.shift()!;
    currentItem = item;
    startPlaying(item);
  }

  // ── Public API ──────────────────────────────────────────────────────────

  function enqueue(pcm: Uint8Array, sampleRate: number): Promise<void> {
    if (disposed) {
      return Promise.reject(new Error("AudioQueue has been disposed"));
    }

    // AQ-009 backpressure: reject immediately if at capacity.
    // currentItem counts as one in-flight slot (currently playing).
    const inFlight = pending.length + (currentItem !== null ? 1 : 0);
    if (inFlight >= maxQueueDepth) {
      return Promise.reject(new QueueFullError(inFlight, maxQueueDepth));
    }

    return new Promise<void>((resolve, reject) => {
      const item: QueuedItem = { pcm, sampleRate, resolve, reject };
      pending.push(item);

      if (currentItem === null) {
        void dequeue();
      }
    });
  }

  function cancel(): void {
    for (const item of pending) {
      item.reject(new CancelledError());
    }
    pending.length = 0;

    if (currentItem !== null) {
      currentItem.reject(new CancelledError());
      currentItem = null;
    }

    if (currentProcess !== null) {
      currentProcess.kill("SIGTERM");
      currentProcess = null;
    }
  }

  async function dispose(): Promise<void> {
    if (disposed) return;
    disposed = true;

    if (currentProcess !== null) {
      const proc = currentProcess;
      try { proc.stdin.end(); } catch { /* ignore */ }

      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          try { proc.kill("SIGKILL"); } catch { /* ignore */ }
          resolve();
        }, 3_000);
        proc.on("close", () => { clearTimeout(timeout); resolve(); });
      });
    }

    for (const item of pending) {
      item.reject(new CancelledError());
    }
    pending.length = 0;
    currentItem = null;
    currentProcess = null;
  }

  return {
    enqueue,
    cancel,
    dispose,
    get size(): number {
      return pending.length;
    },
    get isPlaying(): boolean {
      return currentItem !== null;
    },
  };
}
