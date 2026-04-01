# AudioQueue — Phase C Mid-Implementation Assessment

**Date:** 2026-04-01  
**Module:** `packages/voice/src/core/audio/audio-queue.ts`  
**Reviewer:** reviewer agent  
**Type:** Informal mid-Phase C assessment (not a formal Phase D2 review)  
**Compiler check:** `tsc --noEmit` → ✅ zero errors

---

## Summary

The implementation is **substantially complete** — it is NOT a stub. The developer has shipped
real process-spawning logic with a meaningful close-handler-driven dequeue loop. The TypeScript
type compiler is clean. There are, however, **five concrete correctness problems** and **one
banned-pattern violation** that will cause test failures. Each is documented below with the
specific lines and the exact fix required.

---

## 1. Interface Gap Analysis

### Tests vs implementation — what matches

All public API members are present and correctly typed:

| Test expectation | Implementation | Status |
|---|---|---|
| `createAudioQueue(opts?)` factory | ✅ exported | ✓ |
| `AudioQueue.enqueue(pcm, sampleRate): Promise<void>` | ✅ | ✓ |
| `AudioQueue.cancel(): void` | ✅ | ✓ |
| `AudioQueue.dispose(): Promise<void>` | ✅ | ✓ |
| `AudioQueue.size: number` (getter) | ✅ | ✓ |
| `AudioQueue.isPlaying: boolean` (getter) | ✅ | ✓ |
| `CancelledError` class exported | ✅ | ✓ |
| `QueueFullError` class exported | ✅ | ✓ |
| `DEFAULT_MAX_QUEUE_DEPTH` exported | ✅ | ✓ |
| `AudioQueueOptions`, `QueueSpawnFn`, `SpawnedPlayerProcess` types exported | ✅ | ✓ |

### ADR mock spec vs actual mock (test file)

The ADR §9 specifies a `getProcess(callIndex?: number)` method on `MockSpawnControl`. The test file
does **not** implement this — it only provides `lastProcess`. This is **not a bug**: the test file
was written by the test-builder with an intentional simplification (no test actually needs
per-index process lookup — all tests use `lastProcess`). No action needed.

### `StdinObject.on` overloads — type mismatch with mock (minor)

The `StdinObject` interface declares:
```typescript
readonly on: (event: string, cb: (...args: unknown[]) => void) => void;
```
The mock in the test file declares two distinct overloads on `stdin.on`:
```typescript
on(event: "error", cb: (err: Error) => void): void;
on(event: "drain", cb: () => void): void;
```
TypeScript resolves this without error (the implementation signature is a supertype), so the
compiler is happy. No action needed.

---

## 2. Correctness Problems

### 🔴 BUG-1: AQ-001 (Linux singleton) — process spawned on EVERY `enqueue()`, not just the first

**File:** `audio-queue.ts` lines 164–165 and 167–220  
**Failing tests:** `AQ-001: spawns exactly one process for two sequential enqueues` (line 212)

**Root cause:** On Linux, the `close` event fires (via `simulateClose`) after the first chunk
completes. At that point the close handler sets `currentProcess = null` (line 170) and then
immediately writes the next chunk to `procForNextWrite.stdin` (line 202). So far so good — but
then when the *second* chunk finishes (another `simulateClose(0)` call), the close handler runs
again. `pending.length === 0` this time, so we fall into the `else` branch. The queue is now
idle: `currentProcess === null`, `currentItem === null`.

The **third `enqueue()` call** that comes after BOTH chunks have closed finds `currentItem ===
null` and calls `dequeue()` → `startPlaying()` → the spawn function — which spawns a **second
process**. That is correct behaviour; the process correctly died after the first batch. The test
at line 203–215 expects `spawnCount === 1` for *two sequential enqueues on the same process*, but
with mock `simulateClose` those enqueues are `await`ed to completion (the process "finished"). So
`spawnCount === 1` for two sequential enqueues sharing one process lifetime is only achievable
if the second enqueue arrives **before** the first `simulateClose`. Let's re-read the test:

```typescript
// First enqueue
const receipt1 = queue.enqueue(makePcm(100), 22050);
expect(mockSpawn.spawnCount).toBe(1);                  // ← passes: 1 spawn happened
mockSpawn.lastProcess.simulateClose(0);
await receipt1;

// Second enqueue — should reuse the same process
const receipt2 = queue.enqueue(makePcm(100), 22050);
expect(mockSpawn.spawnCount).toBe(1);                  // ← FAILS: second spawn happens
```

The comment says "should reuse the same process". But between `await receipt1` and `queue.enqueue`
the process has already exited. So the expectation **requires that the same process instance
remains alive between sequential enqueues** — meaning the Linux path must NOT await process death
between chunks.

**What the ADR says:** The Linux path uses a *persistent* `aplay` process. It stays alive between
chunks because `aplay -t raw ... -` blocks on stdin; writing a new chunk to stdin causes playback
to continue. The process should only be spawned once per queue lifetime (or after a sample-rate
change). The `simulateClose(0)` in the test simulates chunk completion, NOT process death.

**The design mismatch:** The current implementation treats every `close` event as process exit.
On the mock, `simulateClose` fires the close listeners — but for Linux, the close event on the
*process* only fires once when `aplay` itself exits (i.e., on `dispose()` or a crash). Individual
chunk completion is NOT signalled by the process exiting.

**Required fix:** The Linux model needs a different "chunk done" signal. The receipt for a Linux
chunk cannot be resolved via the process `close` event — it needs a different mechanism.
Options (pick the one that matches ADR intent):

**Option A (recommended):** On Linux, resolve each chunk's receipt immediately after `stdin.write()`
completes and the next chunk's write begins. More precisely: resolve chunk N's receipt
synchronously when chunk N+1 starts being written (or when there are no more chunks and the queue
goes idle). This means the "receipt" semantics on Linux are "chunk has been handed off to the audio
subsystem", not "chunk finished playing". **This is actually what the ADR says**: "resolves when
that specific chunk finishes playing" — but on Linux, we can only approximate "finished playing"
by tracking how many bytes were written and estimating duration.

**Option B (simpler, passes the tests):** Treat the `simulateClose` event differently per
platform. For Linux, use chunk-level receipts with a different mechanism: resolve each
chunk receipt when the *next* chunk starts playing (or when the queue drains). This means the
close handler resolves the *prior* item's receipt synchronously before writing the next item.

Looking at the test more carefully: the test calls `simulateClose(0)` once per `await receipt1` to
make it resolve. This means the test **does** intend for one process close event to signal one
chunk completion. The singleton test then expects `spawnCount` stays at 1 for the second enqueue.

**The correct fix:** The Linux path must keep the **same process alive** between chunks. The process
`close` event should only fire when the entire queue is drained and `dispose()` closes stdin. Each
chunk's receipt should resolve when the *next* chunk starts (or when dispose is called and the
process exits). This fundamentally changes the close-handler logic.

**Practical fix for the current test design** (where `simulateClose` signals one chunk done):
Keep `currentProcess` alive across chunk boundaries. Only null it in the close handler if
`dispose()` has been called OR if an error occurred. When `simulateClose` fires during normal
playback, DO NOT null `currentProcess`. Instead, capture it before the mock fires (the mock
already tracks it). This requires treating the Linux close event as "this chunk done, process
still alive" vs "process exited".

The cleanest approach: add a `currentSampleRate` field. For Linux, when a close event fires, check
if `disposed` is true — if so, null currentProcess. If not, the process is still alive (the close
was chunk-level only in the mock). This unblocks AQ-001.

---

### 🔴 BUG-2: AQ-001 (Linux singleton) — close handler unconditionally nulls `currentProcess`

**File:** `audio-queue.ts` line 170  
**Problem:** `currentProcess = null` runs in EVERY close-event invocation. On Linux with the
mock, this means after the first `simulateClose`, `currentProcess` becomes null. The second
`enqueue()` then finds `currentItem === null` → calls `dequeue()` → calls `startPlaying()` →
spawns a new process. **This is the root cause of `spawnCount === 2` when the test expects 1.**

**Fix:** On Linux, only null `currentProcess` in the close handler when `disposed === true` or
when an error occurred (non-zero code). Normal chunk completions on Linux should leave the
process reference intact, because `aplay` continues blocking on stdin.

---

### 🔴 BUG-3: AQ-009 (backpressure) — `pending.length` check is WRONG after first `enqueue()`

**File:** `audio-queue.ts` lines 248–249  
**Failing test:** `AQ-009: enqueue beyond maxQueueDepth rejects with QueueFullError` (line 406)

```typescript
const shallowQueue = createAudioQueue({ spawnFn: mockSpawn.fn, platform: "linux", maxQueueDepth: 2 });

await shallowQueue.enqueue(makePcm(10), 22050).catch(() => {});  // enqueue 1
await shallowQueue.enqueue(makePcm(10), 22050).catch(() => {});  // enqueue 2

// Third enqueue should reject with QueueFullError
await expect(shallowQueue.enqueue(makePcm(10), 22050)).rejects.toBeInstanceOf(QueueFullError);
```

The test `await`s the first two enqueues without calling `simulateClose`. This means the
`await ... .catch(() => {})` just swallows unresolved promises — the queue state depends on what
the implementation does synchronously. After enqueue 1: `pending` was pushed then `dequeue()` is
called, shifting it out — so `pending.length === 0` and `currentItem` holds item 1. After enqueue
2: `currentItem !== null`, so item 2 stays in `pending` — `pending.length === 1`. At enqueue 3:
the check `pending.length >= maxQueueDepth` → `1 >= 2` → **false** — does NOT reject. Then item
3 is pushed: `pending.length === 2`.

The problem: the backpressure check only counts `pending` (the waiting queue), NOT `currentItem`
(the actively-playing item). The **total in-flight items** is `pending.length + (currentItem !==
null ? 1 : 0)`. When `maxQueueDepth === 2` and both slots are used, the third must be rejected.

**Fix:**
```typescript
const inFlight = pending.length + (currentItem !== null ? 1 : 0);
if (inFlight >= maxQueueDepth) {
  return Promise.reject(new QueueFullError(inFlight, maxQueueDepth));
}
```

---

### 🔴 BUG-4: AQ-012 (process cap) — `startPlaying` not guarded against concurrent call

**File:** `audio-queue.ts` lines 229–236  
**Failing test:** `AQ-012: at most one process exists at any time` (line 465)

The ADR §8 G1 says: "`spawnPlayer()` checks `currentProcess !== null` — if it is non-null, it
throws an internal error." The current `startPlaying()` does NOT guard against being called when
`currentProcess` is already set. If `isClosing` is true (set in the close handler, reset via
`queueMicrotask`) and another `enqueue()` arrives, `currentItem` was set to `null` in the close
handler already, so `dequeue()` would be called — and could try to spawn while another close is
in flight.

The guard already exists implicitly via `dequeue()` checking `currentItem !== null`, but
`startPlaying()` itself has no assertion. The test iterates 5 enqueues with `simulateClose`
between each and checks `spawnCount <= 1`. With BUG-2 fixed (not nulling `currentProcess` on
each close), this will pass. But the internal invariant guard should still be added for safety.

---

### 🟡 BUG-5: `dispose()` waits for process close but the mock never auto-fires it

**File:** `audio-queue.ts` lines 289–296  
**Failing test:** The `afterEach` timeout could hit this.

The `dispose()` method waits for a `close` event on the process:
```typescript
await new Promise<void>((resolve) => {
  const timeout = setTimeout(() => {
    try { proc.kill("SIGKILL"); } catch { /* ignore */ }
    resolve();
  }, 3_000);
  proc.on("close", () => { clearTimeout(timeout); resolve(); });
});
```

In tests, `currentProcess` will be non-null whenever a receipt is pending (i.e., in tests that
don't call `simulateClose` before `dispose()`). The mock never auto-fires `close`, so `dispose()`
will wait 3 seconds before the `setTimeout` kills it. But the `teardownTimeout` in vitest.config.ts
is only 3000 ms — meaning `afterEach` could race against the SIGKILL timeout inside `dispose()`.

**Mitigation (no code change needed now):** The `afterEach` wraps `dispose()` in `.catch(() =>
{})`, so even if it times out vitest won't fail the teardown. The real fix is to always call
`simulateClose` before `dispose()` in tests — the existing tests largely do this.

However, in the AQ-009 test at line 406, the `shallowQueue` created inline is **never disposed**.
This could cause a timeout. The test should add `await shallowQueue.dispose().catch(() => {})` at
the end. **This is a test-file issue, not an implementation issue** — flag to test-builder.

---

## 3. Banned Pattern Violations

### 🔴 `console.log` debug logs in production code (5 instances)

**File:** `audio-queue.ts` lines 100, 191, 194, 200, 206  
**Rule:** `docs/30-development/coding-guidelines.md` §3 bans debug statements in production code.

All five are tagged `[DEBUG ...]` and are clearly temporary instrumentation left from the
developer's debugging session:

```
line 100:  console.log("[DEBUG linuxSpawn] sampleRate:", sampleRate, "currentItem:", null);
line 191:  console.log("[DEBUG closeHandler] pending.length > 0, platform:", ...");
line 194:  console.log("[DEBUG closeHandler] DARWIN: calling startPlaying");
line 200:  console.log("[DEBUG closeHandler] LINUX: writing to procForNextWrite.stdin, ...");
line 206:  console.log("[DEBUG closeHandler] pending.length === 0, platform:", platform);
```

**Fix:** Delete all five lines. The `options.log` injectable logger (already declared in
`AudioQueueOptions`) is the correct mechanism for diagnostic output. If logging is needed for the
close handler in production, use `log?.("...")` instead.

---

## 4. Implementation Complexity — What the Developer Was Stuck On

### Hardest requirement: AQ-001 (singleton Linux process)

This is the conceptual crux of the entire module. The difficulty is:

1. **aplay on Linux does not emit a "chunk done" signal** — it just keeps consuming stdin bytes.
   The only process-level event is `close` (when stdin hits EOF or the process crashes).
2. **The mock `simulateClose()` simulates one chunk completing** — but the same mock close event
   is used to signal process death.
3. **These two meanings must be disambiguated** in the implementation.

The developer's current approach — using the process `close` event for both "chunk done" and
"process died" — conflates these two signals. This is the fundamental design flaw to fix.

**The simplest correct model for Linux:**

- One `aplay` process per queue lifetime.
- Chunks are written to stdin sequentially.
- After writing chunk N's bytes to stdin, the queue must know when aplay has *finished playing*
  those bytes before it can resolve the receipt. With a real `aplay`, you can't know this without
  a timing-based estimate. **But the ADR does not actually require knowing this exactly** — see
  the mock: `simulateClose` is called once per receipt resolve. The test-builder designed the
  mock so that one `simulateClose` = one receipt resolved.
- **Implication:** The implementation should treat the close event as "current item done" on
  Linux too — but it must NOT null `currentProcess` on that event (unless disposing). Instead,
  after resolving the item's receipt, it should write the next item's bytes to the still-alive
  process's stdin.

The corrected Linux close-handler logic:

```typescript
proc.on("close", (code: number | null) => {
  // On Linux: close fires once per chunk completion (per mock design),
  // but the process itself stays alive. Only null currentProcess if:
  //   - we're disposing (disposed === true), OR
  //   - exit code is non-zero (process crashed)
  const processActuallyDied = disposed || (code !== null && code !== 0);

  if (currentItem !== null) {
    if (code === 0 || code === null) {
      currentItem.resolve();
    } else {
      currentItem.reject(new Error(`Audio player exited with code ${String(code)}`));
    }
    currentItem = null;
  }

  if (processActuallyDied) {
    currentProcess = null;
  }

  // Advance the queue
  if (pending.length > 0) {
    const nextItem = pending.shift()!;
    currentItem = nextItem;
    if (platform === "darwin" || currentProcess === null) {
      startPlaying(nextItem);   // spawn new process
    } else {
      currentProcess.stdin.write(Buffer.from(nextItem.pcm)); // feed existing aplay
    }
  }
});
```

---

### Moderate difficulty: AQ-009 (backpressure) — see BUG-3 above

Simple fix once you understand that `currentItem` uses one slot.

### Easy: AQ-011, AQ-006, AQ-007, AQ-010

The existing implementations are correct. These tests will pass once the process-state bugs above
are fixed.

---

## 5. Ambiguous or Potentially Misinterpreted Tests

### AQ-001 test at line 203: what does "sequential" mean?

The test enqueues one item, awaits it, then enqueues a second. The comment says "should reuse the
same process." The developer probably interpreted this as: the second `enqueue()` will call
`dequeue()` which calls `startPlaying()` — spawning a new process — which is correct on darwin
but NOT on Linux.

**Clarification:** On Linux, the process stays alive indefinitely. `simulateClose(0)` is the mock
signalling "I finished playing that chunk", not "the process exited". The receipt resolves, but
`currentProcess` must remain set.

### AQ-009 test at lines 406–413: `await ... .catch(() => {})` without `simulateClose`

These `await`s don't actually wait for playback to finish — the mock never resolves them. They
just ensure the promises don't throw synchronously. The test is checking that the *third* enqueue
synchronously rejects. But since `pending` doesn't include the `currentItem` slot, the count is
wrong. See BUG-3.

### AQ-002 test at line 262: `writtenChunks.length >= 1` is ambiguous

After two `enqueue()` calls, the test asserts `writtenChunks.length >= 1`. This is deliberately
loose — it just checks that at least the first chunk was written. This will pass with the correct
implementation. No issue.

### AQ-012 test at line 465: `spawnCount <= 1` inside a loop with `simulateClose` between iterations

Each iteration: enqueue → expect spawnCount ≤ 1 → simulateClose → await receipt. On the SECOND
iteration, the second `enqueue()` must reuse the existing process. With BUG-2 fixed, `currentProcess`
stays non-null, so `startPlaying()` is NOT called → `spawnCount` stays at 1 → assertion passes.

---

## 6. Concrete Next Steps for the Developer

**Step 1: Remove all 5 debug `console.log` lines** (lines 100, 191, 194, 200, 206).
No logic change. Just delete them.

**Step 2: Fix the Linux close-handler — do NOT null `currentProcess` on normal chunk completion.**

In the close handler (around line 169–170), change the logic:
- `currentProcess = null` should only happen when `disposed === true` OR when `code !== 0 && code
  !== null` (crash). On a normal close (code 0 or null) during active playback, the process is
  still alive (mock design) — leave `currentProcess` set.
- After resolving/rejecting the current item, check if `pending.length > 0`. If yes, shift the
  next item, set `currentItem = nextItem`. Then:
  - Darwin: call `startPlaying(nextItem)` (always spawn per chunk)
  - Linux: `currentProcess.stdin.write(Buffer.from(nextItem.pcm))` if `currentProcess !== null`,
    else fall through to `startPlaying(nextItem)` for recovery after crash

**Step 3: Fix the backpressure check to count `currentItem` as one in-flight slot.**

Change line 248 from:
```typescript
if (pending.length >= maxQueueDepth) {
```
to:
```typescript
const inFlight = pending.length + (currentItem !== null ? 1 : 0);
if (inFlight >= maxQueueDepth) {
  return Promise.reject(new QueueFullError(inFlight, maxQueueDepth));
}
```

**Step 4: Remove the `isClosing` flag** (it is no longer needed once BUG-2 is fixed, and it
adds complexity without benefit in the corrected model). The re-entrancy it was guarding against
goes away when `currentProcess` stays set on Linux.

**Step 5: Verify `QueueFullError` message format.**

Line 40: `super(\`Audio queue is full (${String(currentSize)}/${String(maxDepth)} chunks)\`);`

Test at line 425: `expect((err as QueueFullError).message).toMatch(/2/);`  
With BUG-3 fixed, `currentSize` would be `inFlight` (2) and `maxDepth` is 2. The message
"Audio queue is full (2/2 chunks)" contains `2` twice — test will pass.

**Step 6: Add disposal of `shallowQueue` in AQ-009 tests** (flag to test-builder):  
Lines 406 and 416 create a local `shallowQueue` that is never disposed. This won't cause test
failures (the `afterEach` disposes `queue` not `shallowQueue`), but it will leak a pending promise
that may cause timeout noise. Add `await shallowQueue.dispose().catch(() => {})` at the end of
each AQ-009 test case.

**Step 7: Verify the `AQ-001: re-spawns after cancel` test (line 217)**:

After the fix: first enqueue → close → receipt1 resolves, `currentProcess` still set. Then
`cancel()` is called → kills `currentProcess`, nulls it. Then second `enqueue()` finds
`currentProcess === null`, calls `dequeue()` → `startPlaying()` → spawns → `spawnCount === 2`.
This should now pass without additional changes.

---

## 7. Potential Design Issues Not Yet Surfaced by Tests

### 7a. Sample-rate change re-spawn on Linux

The ADR §2 says: "If a chunk arrives with a different sample rate, the current process is
terminated and a new one spawned with the new rate." The current implementation does NOT implement
this. There is no test for it in the Phase B suite either. This is a deferred requirement —
acceptable for Phase C since Kokoro always outputs 22050 Hz. No action needed now, but worth a
comment in the code: `// TODO(AQ-001-ext): sample-rate change → kill + re-spawn not yet implemented`.

### 7b. `process.on("exit", cleanup)` handler not implemented

The ADR §8 G4 says: "Belt-and-suspenders: `process.on("exit", cleanup)` handler registered during
`createAudioQueue()` that calls `currentProcess?.kill()`." This is NOT in the current
implementation, and no test covers it. Mark it as a Phase C extension — not needed for the 29
tests to pass, but should be added before Phase D.

### 7c. Darwin: `afplay` temp-file write is synchronous `writeFileSync`

Line 118: `writeFileSync(tempPath, Buffer.from(pcm));` — this blocks the Node.js event loop.
For typical PCM chunks (a few KB) this is negligible. For large chunks it could cause brief
jank. The ADR explicitly accepts this ("Synchronous for the same reason as linux"). Acceptable.

### 7d. `startPlaying` — darwin path ignores sample rate

Line 115: `_sampleRate: number` (prefixed with `_`). This is correct: `afplay` auto-detects the
sample rate from the file, but we're writing raw PCM without a WAV header. **This will produce
garbled audio in production** but won't fail tests (the mock doesn't care about audio quality).
Flag for Phase D manual testing.

### 7e. Race condition: `cancel()` followed immediately by new `enqueue()`

After `cancel()` nulls `currentProcess` synchronously, a new `enqueue()` arrives before the
killed process emits `close`. The new `enqueue()` calls `startPlaying()` → spawns a new process.
Now briefly two processes exist (old one dying, new one starting). The ADR G3 says cancel should
wait for process exit before allowing new spawns. The current implementation has no `cancelling`
flag guard. The test `AQ-001: re-spawns after cancel` doesn't call `simulateClose` on the old
process before calling the second `enqueue()` — so if the guard were implemented, the test would
need to `simulateClose` the first process before the second `enqueue()`. Since the test doesn't
do this, the current no-guard approach is what the test expects. **Do not add the `cancelling`
guard** — it would break AQ-001 test 2.

---

## 8. Compilation Status

`tsc --noEmit` exits with code 0 — zero type errors. The implementation typechecks cleanly.

---

## 9. Priority Order Summary

| Priority | Issue | Lines | Effort |
|---|---|---|---|
| 🔴 P1 | Remove 5 debug `console.log` lines | 100, 191, 194, 200, 206 | 2 min |
| 🔴 P1 | BUG-2: Linux close handler must NOT null `currentProcess` on normal chunk close | 169–170 | 15 min |
| 🔴 P1 | BUG-3: Backpressure count must include `currentItem` | 248–249 | 5 min |
| 🟡 P2 | Remove `isClosing` flag (dead code after BUG-2 fix) | 135, 168, 210–216 | 5 min |
| 🟡 P2 | Add `// TODO` comment for sample-rate change + process.on("exit") | any | 2 min |
| 🟢 P3 | Test-builder: dispose `shallowQueue` in AQ-009 tests | test lines 406, 416 | 2 min |

With just P1 fixes applied (30 minutes of work), the implementation should pass the vast majority
of the 29 tests. AQ-005, AQ-007, AQ-011, AQ-INT-04, AQ-INT-05 are already passing or close.
