# Review — audio-queue — Phase D

**Date:** 2026-04-01  
**Reviewer:** reviewer agent  
**Module:** `packages/voice/src/core/audio/audio-queue.ts` (and integration points)  
**Review scope:** Phase D — post-implementation gate before Phase E (user approval)

---

## Verdict: **FAIL — must fix before Phase E**

3 critical bugs, 3 moderate issues, and 3 test coverage gaps must be resolved before this module can be approved. The TypeScript compiler is clean (`tsc --noEmit` → zero errors) and the unit tests pass in isolation, but the tests mask a fundamental Linux runtime defect (F-C1). The implementation is not safe to ship.

---

## Compilation check

```
cd packages/voice && npx tsc --noEmit
# → (no output) — ZERO errors
```

---

## CRITICAL — must fix before Phase E

### F-C1 · Linux receipt resolution is fundamentally broken

**File:** `packages/voice/src/core/audio/audio-queue.ts`, lines 143–216 (`startPlaying`)  
**Requirements:** AQ-003, AQ-004, AQ-002

**Issue:** On Linux, `startPlaying` spawns a single persistent `aplay -t raw` process and feeds PCM chunks to it via `stdin.write()`. The `close` event — which resolves each chunk's receipt (lines 185–205) — only fires when `stdin.end()` is called (i.e., at `dispose()`) or when the process is killed. It does **not** fire after individual `stdin.write()` calls, because `aplay` in streaming mode continuously reads more data from stdin until EOF.

Consequence: `await audioQueue.enqueue(chunk)` in `streaming-tts.ts` (lines 89 and 142) hangs forever after the first sentence on Linux. The `close` event that would resolve the receipt never arrives. Only calling `dispose()` or `cancel()` ever unblocks the await.

The test suite hides this defect entirely: `audio-queue.test.ts` calls `simulateClose(0)` manually after each enqueue, which short-circuits the real aplay lifecycle. In production, no such call is made.

**Options to fix:**
- **(a) Per-chunk aplay on Linux** — spawn a new `aplay` process per chunk (like Darwin). Loses process reuse (contradicts AQ-001 intent) but makes receipts work correctly.
- **(b) Duration-based receipt resolution** — after `stdin.write(pcm)`, calculate playback duration from byte count and sample rate (`duration = pcm.byteLength / (22050 * 2)` seconds), then resolve the receipt via `setTimeout(resolve, duration * 1000)`. Most faithful to AQ-003/AQ-004; preserves process reuse.
- **(c) Fire-and-forget Linux path** — accept that Linux is write-and-forget; remove `await` from `streaming-tts.ts` for the Linux path and document the limitation. Requires updating AQ-004.

Option (b) is recommended.

---

### F-C2 · Darwin temp files are never deleted — permanent leak

**File:** `packages/voice/src/core/audio/audio-queue.ts`, lines 116–118 (`darwinSpawn`); `cancel()` lines 267–282; `dispose()` lines 284–307

**Issue:** `darwinSpawn()` creates a `accordo-<UUID>.pcm` temporary file in `os.tmpdir()` via `writeFileSync`. The `SpawnedPlayerProcess.tempPath` field stores the path. However, no code path ever deletes this file:
- The `close` handler does not unlink after afplay exits.
- `cancel()` kills the process but does not clean up `tempPath`.
- `dispose()` ends stdin and calls `cancel()` but does not clean up `tempPath` either.

Every enqueued audio chunk on macOS permanently occupies disk space until the OS reclaims temp files (typically on reboot or disk pressure). In a typical TTS session with 10–30 sentences, this is 500 KB – 6 MB of leaked files per session.

**Fix:** In the `close` handler (around line 200), after afplay exits, delete the temp file:
```typescript
if (proc.tempPath) {
  void unlink(proc.tempPath).catch(() => {});
}
```
Also add the same cleanup inside `cancel()` for the currently-playing process. Import `unlink` from `node:fs/promises`.

---

### F-C3 · Signal-killed processes leave `currentProcess` stale on Linux

**File:** `packages/voice/src/core/audio/audio-queue.ts`, line 169

**Issue:**
```typescript
const processActuallyDied = disposed || (code !== null && code !== 0);
```
When a process is killed by a signal (SIGTERM, SIGKILL), Node.js fires the `close` event with `code = null`. The expression `code !== null && code !== 0` evaluates to `false` when `code` is `null`. Therefore `processActuallyDied = false`, and `currentProcess` is **not** set to null.

On Linux, a subsequent `enqueue()` at line 256 finds `currentProcess !== null` (truthy) and writes to the dead process's stdin — producing a silent broken pipe. The `close` handler may fire again unexpectedly, and `currentItem` could be resolved with a corrupted state.

**Fix:** Change line 169 to:
```typescript
const processActuallyDied = disposed || code !== 0;
```
`null !== 0` is `true` in JavaScript, so this correctly catches both signal kills (`null`) and non-zero exit codes.

---

## MODERATE — request changes before Phase E

### F-M1 · `startPlaying` exceeds size and complexity limits

**File:** `packages/voice/src/core/audio/audio-queue.ts`, lines 143–216  
**Guideline:** coding-guidelines.md §3.4 ("No function exceeds ~40 lines")

`startPlaying` is 73 total lines (51 code lines) with a cyclomatic complexity of 25 (limit: 10 per guidelines). The function handles five concerns in one body: platform branching, process spawning, PCM writing, the multi-branch close handler, and the dequeue-next-item microtask.

**Fix:** Extract the close event body into a named inner function `handleClose(code: number | null): void`. Extract the "advance to next pending item" logic into `advanceQueue(): void`. Each resulting function will be under 40 lines.

---

### F-M2 · `writeFileSync` in `darwinSpawn` blocks the event loop

**File:** `packages/voice/src/core/audio/audio-queue.ts`, line 117  
**Guideline:** coding-guidelines.md §6 ("Never block the event loop. All I/O must be async.")

```typescript
writeFileSync(tempPath, Buffer.from(pcm));  // sync — throws immediately on failure
```

A typical TTS audio chunk is 50–200 KB of PCM (1–5 seconds at 22050 Hz × 2 bytes). Synchronous writes of this size on a slow disk or network-mounted home directory can block the VS Code extension host for 50–200 ms, causing UI freezes. The comment "sync — throws immediately on failure" is a convenience justification, not a valid performance exception.

**Fix:** Make `darwinSpawn` async and use `writeFile` from `node:fs/promises`:
```typescript
async function darwinSpawn(pcm: ArrayBuffer, ...): Promise<SpawnedPlayerProcess> {
  await writeFile(tempPath, Buffer.from(pcm));
  // ...
}
```
Update `startPlaying` to `await darwinSpawn(...)`.

---

### F-M3 · Unsafe `as` cast on line 215 without a type guard

**File:** `packages/voice/src/core/audio/audio-queue.ts`, line 215  
**Guideline:** coding-guidelines.md §3.3 ("Zero unsafe `as X` casts without a type guard function")

```typescript
}) as (...args: unknown[]) => void)
```

This casts a `(code: number | null) => void` callback to `(...args: unknown[]) => void`. The root cause is that `SpawnedPlayerProcess.on` is typed with a single loose overload instead of discriminated event overloads.

**Fix:** Add discriminated overloads to the `SpawnedPlayerProcess` interface:
```typescript
interface SpawnedPlayerProcess {
  on(event: "close", cb: (code: number | null) => void): void;
  on(event: "error", cb: (err: Error) => void): void;
  on(event: string, cb: (...args: unknown[]) => void): void;
  // ...
}
```
The cast at line 215 then becomes unnecessary and can be removed.

---

### F-M4 · `NarrationDeps.streamingSpeak` typed as `(...args: unknown[]) => unknown` — effectively `any` for functions

**File:** `packages/voice/src/voice-narration.ts`, line 33; `packages/voice/src/extension.ts`, line 174  
**Guideline:** coding-guidelines.md §1.1 ("Never use `any`")

```typescript
// voice-narration.ts line 33
streamingSpeak: (...args: unknown[]) => unknown;
```

This is the functional equivalent of `any` for a function type — the caller passes any arguments and receives an untyped result. At `extension.ts` line 174, this triggers an unsafe as-cast to wire the real `streamingSpeak` function into the deps object (§3.3 violation).

**Fix:** Import and use the real function type:
```typescript
// voice-narration.ts
import type { streamingSpeak } from "./core/audio/streaming-tts.js";
// in NarrationDeps:
streamingSpeak: typeof streamingSpeak;
```
The cast at `extension.ts` line 174 then becomes unnecessary.

---

### F-M5 · `NarrationDeps.audioQueue` is required but guarded as if optional

**File:** `packages/voice/src/voice-narration.ts`, lines 35 and 117  
**Guideline:** Consistency / correctness

```typescript
// line 35 — required (no ?)
audioQueue: AudioQueue;

// line 117 — guarded as if optional
if (deps.audioQueue) {
```

If the field is truly always present, the guard at line 117 is misleading. If the field can legitimately be absent (e.g., in tests that do not pass an audioQueue), the interface must declare it optional.

**Fix:** Change line 35 to `audioQueue?: AudioQueue;` to match the guard, **or** remove the guard at line 117 if `audioQueue` is guaranteed present at every call site. Choose the option that matches the real usage.

---

## MINOR / INFORMATIONAL

### F-I1 · Test coverage gaps for AQ-INT-01, AQ-INT-02, AQ-INT-03

These integration requirements have code wired correctly but no tests exercising the `audioQueue` code path:

- **AQ-INT-01** (`streaming-tts.ts` calls `audioQueue.enqueue()` when provided): `streaming-tts.test.ts` only mocks `playPcmAudio` — no test constructs a mock `audioQueue` and verifies `enqueue()` is called instead.
- **AQ-INT-02** (routing in `doSpeakText`): `speak-text.test.ts` mocks the `audio-queue` module but does not assert that `enqueue()` is called in place of `playPcmAudio()` when `audioQueue` is present.
- **AQ-INT-03** (`read-aloud.ts` threads `audioQueue` into `streamSpeak` options): `read-aloud.test.ts` has no test case that injects an `audioQueue` and verifies it reaches `streamSpeak`.

These are not blocking for D2 but should be addressed before Phase E sign-off.

---

### F-I2 · `size` getter semantics are undocumented

**File:** `packages/voice/src/core/audio/audio-queue.ts`, line 313  

`size` returns `pending.length` — items waiting, not including the currently-playing item. Total queue depth = `size + (isPlaying ? 1 : 0)`. This is not documented on the `AudioQueue` interface.

**Recommendation:** Add a JSDoc comment:
```typescript
/** Number of items waiting in the queue, excluding the currently-playing item. */
readonly size: number;
```

---

### F-I3 · `as` casts in `read-aloud.ts` at MCP boundary — acceptable

**File:** `packages/voice/src/tools/read-aloud.ts`, lines 91, 102–103, 106–107

Casts such as `args.text as string` occur at the MCP tool handler boundary where `args: Record<string, unknown>`. Per coding-guidelines §1.4, validation at system boundaries is expected. These casts are not dangerous in this context (a Zod schema would be better, but not a hard requirement). No action required.

---

### F-I4 · Cancel race N-2 (from Phase A) — NOT a real issue

After thorough analysis: JavaScript is single-threaded. The `close` event handler and `cancel()` run on the same event loop thread and cannot interleave within a single tick. The scenario where `cancel()` fires between `pending.shift()` and `currentItem = nextItem` is impossible. **N-2 is resolved as a non-issue.**

---

### F-I5 · Vitest config — appropriate

`maxForks: 2`, `testTimeout: 5000`, `hookTimeout: 5000`, `teardownTimeout: 3000`, `pool: "forks"` — all justified by inline comments in `vitest.config.ts`. Process isolation via forks prevents hung audio tests from blocking the main process. Timeouts are appropriate for CI. No issues.

---

## Requirements compliance

| Requirement | Status | Notes |
|---|---|---|
| AQ-001 | ✓ | Singleton aplay process for Linux |
| AQ-002 | ⚠ mock only | Serial FIFO via pending array; broken in real Linux by F-C1 |
| AQ-003 | ✓ | `enqueue()` returns Promise |
| AQ-004 | ⚠ mock only | Receipt resolves in mock; real Linux broken by F-C1 |
| AQ-005 | ✓ | Fire-and-forget path works |
| AQ-006 | ✓ | `cancel()` rejects pending with `CancelledError` |
| AQ-007 | ✓ | `dispose()` resolves gracefully |
| AQ-008 | ✓ | Platform branching correct (linux=aplay stdin, darwin=afplay tempfile) |
| AQ-009 | ✓ | Backpressure: `inFlight >= maxQueueDepth` guard at line 237 |
| AQ-010 | ✓ | `spawnFn` and platform are injectable |
| AQ-011 | ✓ | Post-dispose guard at line 237 |
| AQ-012 | ⚠ mock only | At most 1 process; real Linux broken by F-C1 side effects |
| AQ-INT-01 | ✗ | Code wired; no test covers the `audioQueue` path in `streaming-tts.ts` |
| AQ-INT-02 | ✗ | Code wired; no test for routing in `doSpeakText` |
| AQ-INT-03 | ✗ | Code wired; no test for `audioQueue` threading in `readAloud` |
| AQ-INT-04 | ✓ | `createAudioQueue()` factory tested |
| AQ-INT-05 | ✓ | `playPcmAudio`, `startPcmPlayback`, `createPreSpawnedPlayer` still exported |

---

## Prioritised fix list

### Must fix (blocking — Phase E cannot start until resolved)

1. **F-C1** — Linux receipt hang: choose and implement one of the three fix options; update tests to test real receipt resolution (not via `simulateClose`).
2. **F-C2** — Darwin temp file leak: add `unlink` in close handler, `cancel()`, and `dispose()`.
3. **F-C3** — Signal-kill stale process: change `code !== null && code !== 0` → `code !== 0` on line 169.
4. **F-M3** — Unsafe as-cast: add discriminated overloads to `SpawnedPlayerProcess.on`.
5. **F-M4** — `streamingSpeak` typed as `unknown`: replace with `typeof streamingSpeak`.
6. **F-M5** — `audioQueue` required vs optional mismatch: reconcile interface and guard.

### Should fix (request changes, but not strictly blocking if justified)

7. **F-M1** — `startPlaying` size/complexity: extract `handleClose` and `advanceQueue`.
8. **F-M2** — `writeFileSync` blocks event loop: make `darwinSpawn` async.
9. **F-I1** — AQ-INT-01/02/03 test coverage: add three integration tests.

### Nice to have

10. **F-I2** — Document `size` getter semantics in JSDoc.

---

*Review written by the reviewer agent. Next step: return findings to developer for fixes, then re-review.*
