# AudioQueue — Phase A Architecture & Design

**Date:** 2026-04-01  
**Module:** `packages/voice/src/core/audio/audio-queue.ts`  
**Author:** architect agent  
**Status:** Phase A complete (revised per review) — awaiting user review

> **Phase scope note:** Phase A delivers interfaces and stubs only. AQ-INT-01/02/03
> (routing `doSpeakText`, `doReadAloud`, and `streamingSpeak` through the queue) are
> **Phase C implementation tasks**. In Phase A, the `audioQueue` field is declared on
> `NarrationDeps` and `StreamingSpeakOptions` so the interface contract is locked, but
> no existing function body is modified to consume it. Existing playback via
> `playPcmAudio`/`startPcmPlayback` is unchanged until Phase C.

---

## 1. Problem Statement

The current audio playback in `packages/voice` spawns a **new OS audio player process for every sentence** (via `playPcmAudio` → `startPcmPlayback`). A 5-sentence paragraph produces 5 sequential `aplay` processes. When multiple `speak` steps run with `block:false` in a demo script, these multiply — causing **100% CPU on all cores and system instability**.

The root cause was partially addressed by removing the pre-spawn optimisation in `streaming-tts.ts` (see the "Design note — process safety" comment at the top of that file). However, the fundamental issue remains: every call to `playPcmAudio` still creates a new temp file, spawns a new process, waits for exit, and cleans up. Under concurrent fire-and-forget calls, this still produces O(N) simultaneous processes.

**User requirement (verbatim):**
> "there should be one audio process, and it should generate receipts for the caller on when it finished running so that only then the script will know that it can move on to the next command"

## 2. Decision: Singleton Audio Queue with Receipt-Based Promises

### Core design

A single persistent audio player process lives for the entire VS Code session. PCM audio chunks are enqueued into a FIFO queue and played sequentially through the same process. Each `enqueue()` call returns a `Promise<void>` ("receipt") that resolves only when that specific chunk finishes playing.

### How it works

**Linux (stdin pipe):** One `aplay -t raw -f S16_LE -r <rate> -c 1 -` process is spawned on first use. PCM chunks are written to its stdin as raw bytes — no headers, no framing. Between chunks, the process stays alive waiting for more stdin data. When `dispose()` is called, stdin is closed (EOF) causing `aplay` to exit gracefully.

> **Important detail:** `aplay -` (with WAV headers) only plays one WAV per invocation since the WAV header specifies a fixed data size. To keep a single process alive across multiple chunks, the queue uses `aplay -t raw -f S16_LE -r <rate> -c 1 -` (raw PCM mode) instead. This requires that all enqueued chunks share the same sample rate. If a chunk arrives with a different sample rate, the current process is terminated and a new one spawned with the new rate.

**macOS/Windows (temp file fallback):** `afplay` and PowerShell `SoundPlayer` cannot read from stdin pipes. On these platforms, the queue serialises playback (one temp file at a time) but still provides the receipt-based promise API. The queue guarantees FIFO ordering and no concurrent processes.

### Why raw PCM instead of WAV-with-single-process

The existing `playback.ts` uses WAV mode: `buildWavBuffer()` constructs a WAV header with a fixed `data` chunk size, then pipes the complete WAV to `aplay -`. WAV headers encode the total audio length in a 32-bit `chunkSize` field. This means `aplay` reads exactly that many bytes and then exits (or expects a new WAV header). You cannot keep a single `aplay -` process alive across multiple WAV-encoded chunks without it mis-interpreting the next WAV header as audio data.

**Raw PCM mode** (`aplay -t raw -f S16_LE -r <rate> -c 1 -`) tells `aplay` to interpret all stdin bytes as raw 16-bit signed LE mono audio at the specified sample rate. There are no headers, no chunk boundaries in the byte stream — `aplay` simply plays bytes as they arrive and waits for more when stdin is empty. This enables a single process to play an unlimited number of PCM chunks by writing them sequentially to stdin. The process stays alive between chunks (waiting on stdin), eliminating per-sentence spawn overhead.

**Exact `aplay` flags and their meaning:**
- `-t raw` — input format is raw PCM (no WAV/RIFF container)
- `-f S16_LE` — sample format: signed 16-bit little-endian
- `-r <rate>` — sample rate in Hz (e.g., `-r 22050`)
- `-c 1` — mono (one channel)
- `-` — read from stdin

**Constraint:** all chunks written to the same `aplay` process must share the same sample rate. If a chunk arrives with a different rate, the queue terminates the current process and spawns a new one with the updated `-r` flag. In practice, Kokoro TTS always outputs 22050 Hz, so process restarts are rare.

**Note:** The existing `createPreSpawnedPlayer()` function in `playback.ts` (WAV mode) is intentionally NOT reused for queue-based playback. It remains available for non-queue use cases (smoke tests, cached sounds).

### Receipt semantics

```
caller A:  const receiptA = queue.enqueue(pcm1, 22050);
caller B:  const receiptB = queue.enqueue(pcm2, 22050);
caller C:  const receiptC = queue.enqueue(pcm3, 22050);

Timeline: [--- pcm1 playing ---][--- pcm2 playing ---][--- pcm3 playing ---]
                                ^                      ^                     ^
                          receiptA resolves       receiptB resolves     receiptC resolves
```

Callers can `await` their receipt to block until their audio finishes (script sequencing), or fire-and-forget with `void queue.enqueue(...)` for narration overlays.

## 3. Alternatives Considered

| Alternative | Why rejected |
|---|---|
| **Named pipe (FIFO)** | `mkfifo` only works on Unix. Adds filesystem coordination complexity. `aplay` doesn't handle multiple writes to a FIFO cleanly (EOF between writes). |
| **Web Audio API** | Requires a browser context (webview). Voice runs in Node.js extension host — no Web Audio available. |
| **ffplay (ffmpeg)** | Heavier dependency than `aplay`/`afplay`. Not pre-installed on most systems. Would require users to install ffmpeg. |
| **Keep separate processes but limit concurrency** | Doesn't address the user's requirement ("one audio process"). Process spawn overhead (~5-10ms per sentence) still accumulates. |
| **PulseAudio `paplay` with stdin** | Linux-only (not all Linux distros have PulseAudio). `aplay` is more universal (ALSA). |

## 4. Consequences and Trade-offs

| Consequence | Impact |
|---|---|
| (+) **One process for entire session** | CPU usage drops from O(N) processes to 1. System instability eliminated. |
| (+) **Receipt-based sequencing** | Script runner can precisely sequence audio with other steps via `await`. |
| (+) **Backward compatible** | Existing `playPcmAudio` and `startPcmPlayback` are kept for non-queue use cases (smoke test, cached sounds). |
| (+) **Testable** | Same injectable `spawnFn` and `platform` pattern as existing `playback.ts`. |
| (-) **Sample rate constraint (Linux)** | All chunks in a contiguous sequence must share the same sample rate. A rate change requires process restart (~10ms). In practice, Kokoro TTS always outputs 22050 Hz. |
| (-) **macOS/Windows: no true singleton** | Temp-file platforms still create one process per chunk (sequentially). The queue serialises them, but doesn't eliminate spawn overhead. Future: investigate `sox`/`play` for stdin pipe on macOS. |
| (-) **Queue depth limit** | `enqueue()` rejects if queue exceeds configurable limit (default 10). Prevents unbounded memory growth from runaway callers. Callers must handle `QueueFullError`. |

## 5. Requirement ID Table

| ID | Requirement | Maps to |
|---|---|---|
| AQ-001 | Singleton player process: one `aplay` (Linux) / fallback (macOS/Windows) process per session, created on first use, kept alive between calls | `AudioQueue` constructor + `spawnPlayer()` |
| AQ-002 | Serial queue: audio chunks play in FIFO order, no concurrent playback | `enqueue()` + internal dequeue loop |
| AQ-003 | Enqueue with receipt: `enqueue(pcm, sampleRate)` returns `Promise<void>` that resolves when that chunk finishes playing | `enqueue()` return type |
| AQ-004 | Blocking support: `enqueue()` is `await`-able for step sequencing | Same as AQ-003 (caller `await`s the receipt) |
| AQ-005 | Non-blocking support: callers can fire-and-forget with `void queue.enqueue(...)` | Same as AQ-003 (caller discards the receipt) |
| AQ-006 | Cancellation: `cancel()` stops current chunk and drains pending; pending receipts reject with `CancelledError` | `cancel()` method + `CancelledError` class |
| AQ-007 | Graceful shutdown: `dispose()` finishes current chunk then kills process cleanly | `dispose()` method |
| AQ-008 | Cross-platform: Linux stdin pipe, macOS/Windows temp file fallback | `spawnPlayer()` platform switch |
| AQ-009 | Backpressure: configurable queue depth limit (default 10); exceeding rejects with `QueueFullError` | `maxQueueDepth` option + `QueueFullError` class |
| AQ-010 | Testability: injectable `spawnFn` and `platform` for deterministic testing | `AudioQueueOptions` interface |
| AQ-011 | Post-dispose guard: after `dispose()` is called, further `enqueue()` calls reject with `Error` (message: "AudioQueue has been disposed") | `enqueue()` guard check + `dispose()` flag |
| AQ-INT-01 | Integration: `streamingSpeak()` uses queue when `audioQueue` option is provided | **Phase C** — interface declared on `StreamingSpeakOptions.audioQueue`; call-site routing is implementation work |
| AQ-INT-02 | Integration: `doSpeakText()` uses queue via `NarrationDeps.audioQueue` | **Phase C** — interface declared on `NarrationDeps.audioQueue`; call-site routing is implementation work |
| AQ-INT-03 | Integration: `doReadAloud()` uses queue via `NarrationDeps.audioQueue` | **Phase C** — interface declared on `NarrationDeps.audioQueue`; call-site routing is implementation work |
| AQ-INT-04 | Integration: queue instance created once per extension activation and disposed on deactivation; scoped to extension lifecycle, not a process-global or cross-module singleton | `activate()` wiring + module-level `_audioQueue` for `deactivate()` access |
| AQ-012 | Process cap: at most one OS audio player process exists per `AudioQueue` instance at any time. If the implementation ever holds a reference to a spawned process, it MUST be the only one — previous processes must be confirmed dead (exit event received) before spawning a new one. | `spawnPlayer()` guard + state machine |
| AQ-INT-05 | Integration: existing `playPcmAudio` and `startPcmPlayback` kept for non-queue use cases | No deletion of existing exports |

## 6. Interface Summary

### New file: `packages/voice/src/core/audio/audio-queue.ts`

| Export | Kind | Purpose |
|---|---|---|
| `AudioQueueOptions` | interface | Constructor options (spawnFn, platform, maxQueueDepth, log) |
| `AudioQueue` | interface | Public API: `enqueue`, `cancel`, `dispose`, `readonly size`, `readonly isPlaying` |
| `CancelledError` | class | Error subclass thrown when a pending receipt is cancelled |
| `QueueFullError` | class | Error subclass thrown when queue depth exceeds limit |
| `createAudioQueue` | function | Factory returning an `AudioQueue` instance |
| `DEFAULT_MAX_QUEUE_DEPTH` | constant | Default queue depth limit (10) |

### Modified files (interface changes only)

| File | Change |
|---|---|
| `streaming-tts.ts` | `StreamingSpeakOptions.audioQueue?: AudioQueue` added |
| `voice-narration.ts` | `NarrationDeps.audioQueue: AudioQueue` added |

## 7. Coherence Check

- ✅ No circular imports: `audio-queue.ts` has **zero imports** — it is fully self-contained. `QueueSpawnFn` and `SpawnedPlayerProcess` are defined independently of the existing `SpawnFn` in `playback.ts` because the queue requires `stdin` access (pipe-based playback), which `SpawnFn` does not expose. Keeping them separate avoids widening `SpawnFn` and breaking existing callers.
- ✅ No `vscode` imports: `audio-queue.ts` is in `core/audio/` — editor-agnostic per architecture.
- ✅ Existing `playPcmAudio`, `startPcmPlayback`, `createPreSpawnedPlayer`, `createCachedSound` all remain unchanged.
- ✅ Existing tests in `streaming-tts.test.ts` and `speak-text.test.ts` compile unchanged — the new `audioQueue` field on `StreamingSpeakOptions` is optional.
- ✅ `NarrationDeps.audioQueue` is a new required field — but `extension.ts` (the only place `NarrationDeps` is constructed) will be updated to provide it.

## 8. Process Safety Guarantees

> **Context:** Two system crashes were caused by unconstrained process spawning — once at runtime (N×`aplay` processes from fire-and-forget `speak` calls) and once at test-time (vitest forks hanging indefinitely, each consuming 85-100% CPU). This section defines the structural guarantees that prevent recurrence.

### Vitest configuration (test-time safety)

The `packages/voice/vitest.config.ts` now includes:

| Setting | Value | Rationale |
|---|---|---|
| `testTimeout` | 5 000 ms | Audio mock tests resolve in <50 ms. 5 s is generous for slow CI but catches genuine hangs before resource damage. |
| `hookTimeout` | 5 000 ms | Setup/teardown hooks (queue creation, disposal) get the same budget. |
| `teardownTimeout` | 3 000 ms | If cleanup hangs (e.g. `dispose()` waiting on a never-exiting process), kill it quickly. |
| `pool` | `"forks"` | Full process isolation per test file. A hung fork is killed cleanly by vitest — no zombie workers. |
| `poolOptions.forks.maxForks` | 2 | Leaves 2+ cores free for OS, editor, and the real audio player process. Prevents CPU saturation on 4-core dev machines. |
| `poolOptions.forks.minForks` | 1 | At least one fork always runs — avoids zero-concurrency deadlocks. |

**Why `"forks"` over `"threads"`:** Worker threads share the same process. If one thread hangs on a synchronous operation (or an unmocked native call), the entire process — including vitest's test scheduler — hangs. Forks are fully isolated: vitest can kill a hung fork without losing its own event loop.

**Why NOT `bail: 1`:** Bail stops the entire suite on first failure. During Phase B (red tests), all tests are expected to fail initially. Bail would prevent seeing the full red-test inventory. Instead, the `testTimeout` ensures hung tests are killed individually. If we later want fail-fast in CI, we can add `bail` to a CI-specific config.

### G1 — Process cap (AQ-012)

**Guarantee:** At most one OS audio player process exists per `AudioQueue` instance at any time.

**Enforcement (implementation):**
- The queue holds a single `currentProcess: SpawnedPlayerProcess | null` field.
- `spawnPlayer()` checks `currentProcess !== null` — if it is non-null, it throws an internal error (this should never happen if the state machine is correct).
- Process spawn only occurs in two places: (1) first `enqueue()` after creation, and (2) after a sample-rate change forces a process restart. In case (2), the old process must be confirmed dead (its `close` event received and `currentProcess` set to `null`) before the new spawn.
- The state machine has exactly 3 states: `idle` (no process), `playing` (process alive, writing chunks), `draining` (waiting for current chunk to finish before process restart or dispose). There is no state where two processes can coexist.

**Enforcement (tests):**
- The mock `spawnFn` tracks call count. After each test, assert `spawnFn.mock.calls.length <= expectedCount` (usually 1).
- A dedicated test: "never holds two processes simultaneously" — enqueue multiple chunks including a sample-rate change, and verify via mock that at any point `spawnFn` is called only after the previous mock process has emitted `close`.

### G2 — Leak prevention on error

**Guarantee:** If `aplay` crashes (non-zero exit code, or `error` event), the process reference is cleared and the next `enqueue()` spawns fresh.

**Enforcement (implementation):**
- The `close` event handler always sets `currentProcess = null` regardless of exit code.
- The `error` event handler calls `kill()` on the process (if still alive) and sets `currentProcess = null`.
- The active chunk's receipt rejects with an `Error` containing the exit code.
- The dequeue loop checks `currentProcess` before writing — if null, it spawns a new process.

**Enforcement (tests):**
- Mock process emits `close` with code 1. Verify: receipt rejects, next `enqueue()` calls `spawnFn` again (fresh spawn), and that second enqueue's receipt resolves.

### G3 — Leak prevention on cancel

**Guarantee:** `cancel()` sends SIGTERM to the process AND waits for exit confirmation before resolving. The old process is confirmed dead before any new process can be spawned.

**Enforcement (implementation):**
- `cancel()` calls `currentProcess.kill("SIGTERM")`.
- `cancel()` returns `void` (synchronous), but internally sets a `cancelling` flag that prevents the dequeue loop from spawning a new process until the `close` event fires.
- All pending receipts are rejected with `CancelledError` immediately (synchronous — callers unblock).
- The `close` event handler clears `cancelling` and sets `currentProcess = null`.
- The dequeue loop, on seeing `cancelling === true`, waits (event-driven, no polling) for the flag to clear.

**Enforcement (tests):**
- Mock `cancel()` scenario: enqueue 3 chunks, cancel after first starts playing. Verify: all 3 receipts reject with `CancelledError`. Then enqueue a 4th chunk — verify `spawnFn` is called (fresh process) only after the mock process from the first batch emitted `close`.

### G4 — Extension deactivation and orphan prevention

**Guarantee:** `dispose()` kills the player process on extension deactivation. If the parent (VS Code extension host) dies unexpectedly, the child process is also killed.

**Enforcement (implementation):**
- `dispose()` calls `stdin.end()` (EOF → graceful aplay exit) and waits for the `close` event with a timeout (3 seconds). If the process doesn't exit within the timeout, `kill("SIGKILL")` is sent.
- The process is spawned with `detached: false` (the default). On Linux, this means the child is in the same process group as the parent — when the parent is killed, the child receives SIGHUP.
- Belt-and-suspenders: `process.on("exit", cleanup)` handler registered during `createAudioQueue()` that calls `currentProcess?.kill()`. This handles the case where Node's `exit` event fires but the child process hasn't been disposed yet.
- The `exit` handler is unregistered in `dispose()` to prevent leaks.

**Enforcement (tests):**
- Verify `dispose()` calls `stdin.end()` on the mock process.
- Verify that if the mock process doesn't emit `close` within timeout, `kill("SIGKILL")` is called.
- Verify the `process.on("exit")` handler is registered and calls `kill()`.

### G5 — Test isolation

**Guarantee:** Each test creates its own `AudioQueue` instance with a fresh mock `spawnFn`. Tests never share a queue instance or mock state.

**Enforcement (test structure):**
```typescript
// In every AudioQueue test file:
let queue: AudioQueue;
let spawnFn: ReturnType<typeof createMockSpawnFn>;

beforeEach(() => {
  spawnFn = createMockSpawnFn();
  queue = createAudioQueue({ spawnFn, platform: "linux" });
});

afterEach(async () => {
  await queue.dispose();
});
```

- `beforeEach` guarantees a fresh instance per test — no shared mutable state.
- `afterEach` always calls `dispose()` — cleans up any spawned mock process, preventing state leakage.
- The `createMockSpawnFn()` helper returns a new `vi.fn()` each time — call counts and mock state are test-scoped.
- **Rule for Phase B:** no `describe`-level queue or spawnFn variables that persist across tests. All queue state must live inside `beforeEach`/`afterEach`.

## 9. Mock Design Specification — `createMockSpawnFn()`

> **Audience:** test-builder agent (Phase B). This section specifies the mock helper that ALL AudioQueue tests must use. The helper must make it structurally impossible for a test to hang due to unmocked I/O.

### Design principles

1. **No real I/O.** The mock never spawns a real process, touches the filesystem, or blocks on a pipe.
2. **Immediate resolution.** All operations resolve synchronously or via `setImmediate` / `queueMicrotask` — never via `setTimeout` (which depends on real timers and can hang under `vi.useFakeTimers()`).
3. **Controllable lifecycle.** Tests can trigger `close` and `error` events on the mock process at will, simulating normal completion, crashes, and hangs.
4. **Call tracking.** The returned `spawnFn` is a `vi.fn()`, so tests can assert call counts, arguments, and ordering.

### Shape

```typescript
interface MockSpawnControl {
  /** The mock spawnFn to inject into AudioQueueOptions. */
  spawnFn: QueueSpawnFn;  // vi.fn() wrapping the mock

  /**
   * Returns the mock process created by the Nth call to spawnFn (0-indexed).
   * Throws if spawnFn hasn't been called that many times.
   */
  getProcess(callIndex?: number): MockPlayerProcess;

  /**
   * Shorthand: get the most recently created mock process.
   */
  get lastProcess(): MockPlayerProcess;
}

interface MockPlayerProcess extends SpawnedPlayerProcess {
  /**
   * Simulate the process exiting normally (code 0).
   * Triggers the 'close' event on the mock process.
   * The stdin.write() calls before this are recorded in `writtenChunks`.
   */
  simulateClose(code?: number | null): void;

  /**
   * Simulate a process error (e.g. spawn failure).
   * Triggers the 'error' event on the mock process.
   */
  simulateError(err: Error): void;

  /** All buffers written to stdin.write(), in order. */
  readonly writtenChunks: ReadonlyArray<Buffer | Uint8Array>;

  /** Whether stdin.end() has been called. */
  readonly stdinEnded: boolean;

  /** Whether kill() has been called, and with what signal. */
  readonly killed: { called: boolean; signal?: NodeJS.Signals | number };
}
```

### Behaviour specification

| Method | Behaviour |
|---|---|
| `spawnFn(cmd, args, opts)` | Creates and returns a new `MockPlayerProcess`. Does NOT trigger any events automatically — the test must call `simulateClose()` to advance the queue. This ensures tests explicitly control process lifecycle. |
| `stdin.write(data)` | Records `data` in `writtenChunks`. Returns `true` (no backpressure simulation by default). Does NOT trigger any async work. |
| `stdin.end()` | Sets `stdinEnded = true`. Does NOT automatically trigger `close` — the test must call `simulateClose()` explicitly. This prevents tests from accidentally resolving without asserting intermediate state. |
| `stdin.on("error", cb)` | Stores the callback. `simulateError()` invokes it (via `queueMicrotask` to match real Node.js behaviour). |
| `stdin.on("drain", cb)` | Stores the callback. Not invoked by default (write always returns `true`). A future `simulateBackpressure()` method can trigger it. |
| `kill(signal)` | Records signal in `killed`. Does NOT trigger `close` — the test must call `simulateClose()` after `kill()` to simulate process termination. This models real-world behaviour where `kill(SIGTERM)` is asynchronous. |
| `on("error", cb)` | Stores the callback. `simulateError()` invokes it. |
| `on("close", cb)` | Stores the callback. `simulateClose()` invokes it (via `queueMicrotask`). |
| `simulateClose(code)` | Invokes the stored `close` callback with `code` (default `0`) via `queueMicrotask`. This models real Node.js `ChildProcess` behaviour where `close` fires asynchronously after process exit. |
| `simulateError(err)` | Invokes both the process `error` callback and `stdin.error` callback via `queueMicrotask`. |

### Timer strategy

**Use real async (`await` + `queueMicrotask`), NOT `vi.useFakeTimers()`.** Rationale:

- The AudioQueue implementation uses event emitters and promises — no `setTimeout` or `setInterval`. Fake timers would add complexity with no benefit.
- `queueMicrotask` in mock events ensures callbacks fire in the correct microtask order (matching real Node.js `ChildProcess` event timing) without introducing any wall-clock delays.
- Tests advance state by calling `simulateClose()` / `simulateError()` and then `await`ing the next microtask tick (`await new Promise(r => queueMicrotask(r))`).
- If the implementation later adds timeouts (e.g. dispose timeout in G4), those specific tests can use `vi.useFakeTimers()` in isolation — but the default test setup uses real timers.

### Per-test timeout guard

Each test should NOT use `Promise.race` with a manual timeout. Instead, rely on the vitest `testTimeout: 5_000` configured in `vitest.config.ts`. Rationale:

- A manual `Promise.race` obscures the actual failure — the test reports "timeout" instead of the real hung promise.
- With `testTimeout`, vitest kills the entire test and reports which test hung, including the test name and file — much better diagnostics.
- The mock design ensures tests cannot hang if used correctly (all events are manually triggered). If a test hangs, it means the test forgot to call `simulateClose()` — the 5s timeout will catch this and the test name will point directly to the bug.

### Example test pattern

```typescript
it("AQ-003: enqueue resolves when chunk finishes playing", async () => {
  const receipt = queue.enqueue(new Uint8Array([1, 2, 3, 4]), 22050);

  // Queue should have spawned a process and written the chunk
  const proc = spawnFn.lastProcess;
  expect(proc.writtenChunks).toHaveLength(1);

  // Simulate the process finishing playback
  proc.simulateClose(0);

  // Receipt should resolve (no timeout needed — simulateClose fires via queueMicrotask)
  await receipt;
});
```

### Process-count regression guard (CI safeguard)

A global teardown hook (not per-test, but per test-file via `afterAll`) can assert that no real OS processes leaked:

```typescript
afterAll(async () => {
  // Safety net: if any test accidentally used a real spawnFn (not mock),
  // detect leftover aplay/afplay processes.
  const { execSync } = await import("node:child_process");
  try {
    const result = execSync("pgrep -c aplay", { encoding: "utf-8" }).trim();
    const count = parseInt(result, 10);
    if (count > 0) {
      // Kill them and fail the test file
      execSync("pkill aplay");
      throw new Error(`Process leak detected: ${String(count)} aplay processes found after tests`);
    }
  } catch (e: unknown) {
    // pgrep returns exit code 1 if no processes found — that's the happy path
    if (e instanceof Error && "status" in e && (e as NodeJS.ErrnoException & { status: number }).status === 1) {
      return; // No processes found — good
    }
    // Re-throw if it's a genuine process leak error
    if (e instanceof Error && e.message.includes("Process leak detected")) {
      throw e;
    }
    // Otherwise pgrep itself failed — ignore (e.g. pgrep not installed on macOS CI)
  }
});
```

This is a safety net, not a primary test. If all tests use `createMockSpawnFn()` (G5), this `afterAll` should never trigger. But if a regression introduces a real spawn call, this catches it before it crashes CI.
