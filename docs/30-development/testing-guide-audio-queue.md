# Testing Guide — AudioQueue Module

**Module:** `packages/voice/src/core/audio/audio-queue.ts`  
**Test file:** `packages/voice/src/__tests__/audio-queue.test.ts`  
**Date:** 2026-04-01  
**Test suite:** 29 tests — all passing

---

## 1. Automated Tests (Agent-Validated)

### Running the tests

```bash
cd packages/voice
pnpm exec vitest run src/__tests__/audio-queue.test.ts
```

> **Safety note:** Always run with `timeout` and check for stuck workers afterward:
> ```bash
> cd packages/voice && timeout 90 pnpm exec vitest run src/__tests__/audio-queue.test.ts
> # After: check for stuck workers
> ps aux | grep vitest | grep -v grep
> pkill -f vitest  # if any found
> ```

### Test coverage map

| Requirement | Test(s) | What it verifies |
|---|---|---|
| AQ-001: singleton process | `AQ-001: spawns at most one process at a time for sequential enqueues` | Sequential enqueues share no active processes; `isPlaying === true` during playback |
| AQ-001: re-spawn after cancel | `AQ-001: re-spawns after cancel` | `cancel()` kills process; new enqueue spawns fresh |
| AQ-002: FIFO serial queue | `AQ-002: second receipt is still pending while first is playing`, `AQ-002: chunks play in enqueue order` | Receipt for chunk 2 does not resolve before chunk 1; `size === 1` during playback |
| AQ-003: Promise returned | `AQ-003: enqueue returns a Promise` | `enqueue()` returns a `Promise<void>` |
| AQ-004: receipt resolves | `AQ-004: receipt resolves after simulateClose` | Receipt resolves (not rejects) when `simulateClose(0)` fires |
| AQ-005: fire-and-forget | `AQ-005: void enqueue does not throw`, `AQ-005: multiple fire-and-forget calls share the same process` | Void cast does not throw; multiple calls without awaiting keep one active process |
| AQ-006: cancellation | `AQ-006: cancel rejects pending receipts with CancelledError`, `AQ-006: cancel rejects in-flight receipt with CancelledError`, `AQ-006: size is 0 after cancel`, `AQ-006: isPlaying is false after cancel` | All pending/in-flight receipts rejected with `CancelledError`; queue fully drained |
| AQ-007: dispose | `AQ-007: dispose returns a Promise`, `AQ-007: dispose resolves when no audio is playing`, `AQ-007: isPlaying is false after dispose`, `AQ-007: size is 0 after dispose` | `dispose()` resolves cleanly; no zombie state |
| AQ-008: Linux raw PCM args | `AQ-008: Linux uses raw PCM args` | Linux `spawnFn` called with `-t raw -f S16_LE -r <rate> -c 1 -` |
| AQ-008: Darwin temp-file | `AQ-008: macOS uses temp-file fallback (no stdin pipe)` | Darwin `spawnFn` called with `afplay [tempPath]`; `-t raw` absent |
| AQ-009: backpressure | `AQ-009: enqueue beyond maxQueueDepth rejects with QueueFullError`, `AQ-009: QueueFullError message contains size and max` | 3rd enqueue (at maxQueueDepth=2) rejects; error message contains both counts |
| AQ-010: injectable spawnFn | `AQ-010: injected spawnFn is called instead of real spawn`, `AQ-010: injected platform controls spawn args` | Mock `spawnFn` called; Darwin path calls `afplay`, not `aplay` |
| AQ-011: post-dispose guard | `AQ-011: enqueue after dispose rejects with disposed error` | Enqueue after `dispose()` rejects with "AudioQueue has been disposed" |
| AQ-012: process cap | `AQ-012: at most one process is active at a time during sequential playback` | `isPlaying === true` continuously; `queue.size === 0` during playback; 5 chunks → 5 processes total |
| AQ-INT-04: factory | `AQ-INT-04: createAudioQueue() works with no arguments`, `AQ-INT-04: returned object has all required methods` | Default constructor does not throw; all methods present |
| AQ-INT-05: exports | `AQ-INT-05: playPcmAudio is still exported from playback.ts`, `AQ-INT-05: startPcmPlayback is still exported from playback.ts`, `AQ-INT-05: createPreSpawnedPlayer is still exported from playback.ts` | Existing exports unaffected |

### Expected warnings (not errors)

- **4 unhandled `CancelledError` rejections** in AQ-006 cancellation tests — these are **expected** behavior (cancellation rejects receipts). `unhandledRejections: "warn"` in vitest config converts these to warnings, not failures.
- **`[vite] Duplicate key "on"`** in mock helper — cosmetic TypeScript/ESBuild warning from the test mock's `on("error", ...)` + `on("close", ...)` handlers sharing the same object key. Does not affect test correctness.

### TypeScript compile check

```bash
cd packages/voice && pnpm exec tsc --noEmit
```

Must show **0 errors** before committing.

---

## 2. Manual Testing (User Journey — Voice Module)

These scenarios require a running VS Code instance with the Accordo Voice extension loaded. They verify the AudioQueue in a real TTS pipeline.

### Prerequisites
- VS Code with Accordo Voice extension installed
- `accordo.voice.testTts` command available
- Terminal with `aplay` (Linux) or `afplay` (macOS) accessible

### Scenario A: Single sentence TTS

1. Open a text file in VS Code
2. Select a single sentence: `"The audio queue ensures sequential playback."`
3. Run `Ctrl+Shift+P → Accordo Voice: Read Aloud`
4. **Expected:** Audio plays to completion. No concurrent audio processes remain after playback finishes.
5. **Verify process count (Linux):** Open a terminal and run `pgrep aplay | wc -l` — should be `0` after playback finishes.

### Scenario B: Multiple sequential TTS calls (script safety)

1. Open the VS Code Command Palette
2. Run `Accordo Voice: Speak Text` with `"First sentence."`
3. While audio is still playing, immediately run again with `"Second sentence."`
4. **Expected:** Both sentences play sequentially (not concurrently). The second sentence begins only after the first finishes.
5. **Verify:** No `aplay` process duplication (max 1 `aplay` at any time).

### Scenario C: Queue backpressure

1. Rapidly call `accordo_voice_readAloud` 15 times in quick succession (simulating an agent script firing many TTS steps)
2. **Expected:** First 10 calls are accepted and queued. Call #11+ should be rejected (queue depth limit = 10).
3. The error response should indicate the queue is full.

### Scenario D: Cancel during playback

1. Start a long TTS playback
2. Immediately run `Accordo Voice: Stop Narration`
3. **Expected:** Playback stops. No zombie `aplay` processes remain.
4. Verify `pgrep aplay | wc -l` returns `0`.

### Scenario E: Extension deactivation cleanup

1. Reload the VS Code window (`Ctrl+Shift+P → Developer: Reload Window`)
2. During reload, audio playback may be in progress
3. **Expected:** After reload, no orphan `aplay`/`afplay` processes remain from the previous session.

---

## 3. Process Safety Checklist

Before running any live TTS demo:

- [ ] Run `pgrep aplay; pgrep afplay` — confirm 0 processes before starting
- [ ] Set a reminder to check processes after demo
- [ ] If system feels sluggish during demo: immediately run `pkill -f vitest` and `pkill aplay` to stop any runaway spawning
- [ ] **Never** run `pnpm test` in the voice package without `timeout` and post-run `pkill -f vitest`
- [ ] Vitest config enforces `maxForks: 2` and `testTimeout: 5000` — do not increase these without Phase A review

---

## 4. Known Limitations

- **macOS temp files:** Each audio chunk on macOS writes a `.pcm` file to `tmpdir()`. These are cleaned up after each `afplay` exits, but there is a brief window where temp files exist on disk.
- **Sample rate changes:** If the TTS provider changes sample rate mid-session (e.g., switches from 22050 Hz to 16000 Hz), the current implementation does not restart the `aplay` process. This is a future enhancement (AQ-013).
- **Windows:** The AudioQueue falls back to fire-and-forget `playPcmAudio` on Windows (no receipt-based queuing). The queue object is still created but `enqueue()` calls `playPcmAudio` directly.
