# AudioQueue Phase A — Reviewer Assessment

- **Date:** 2026-04-01
- **Reviewer:** Reviewer Agent (independent gate)
- **Module:** `audio-queue` — `packages/voice`
- **Phase:** A (Architecture & Interface Design)
- **Status:** FAIL — REVISIONS REQUIRED

---

## Overall Verdict

**FAIL — REVISIONS REQUIRED**

Two critical issues block meaningful Phase B progress:

1. The `audioQueue` dependency is declared in the interfaces but **never consumed** in any function body. AQ-INT-01/02/03 claim integration is done — it isn't. Phase B tests written against these requirements will fail for the wrong reason (missing integration, not missing implementation).
2. The ADR's own coherence check (§7) is factually incorrect about what `audio-queue.ts` imports. A self-contradicting design document cannot serve as the authoritative spec for Phase B.

Both must be resolved before Phase B begins.

---

## Findings

### 🔴 Critical — Must Fix Before Phase B

#### C-1: `audioQueue` is wired but never consumed

**Files:** `packages/voice/src/voice-narration.ts`, `packages/voice/src/core/audio/streaming-tts.ts`

`NarrationDeps.audioQueue` is **required** (a breaking change) and `StreamingSpeakOptions.audioQueue` is **optional**, yet:

- `voice-narration.ts` — `doReadAloud`, `doSpeakText`, and `doStopNarration` still call `playPcmAudio` and `startPcmPlayback` directly. Not a single call to `deps.audioQueue.enqueue()` exists anywhere in the file.
- `streaming-tts.ts` — `streamingSpeak` declares `options.audioQueue` in its options type but never references `options.audioQueue` anywhere in the function body.

Requirements AQ-INT-01 ("doSpeakText uses AudioQueue"), AQ-INT-02 ("doReadAloud uses AudioQueue"), and AQ-INT-03 ("streamingSpeak uses AudioQueue") are listed as **done** in the ADR's integration table. They are not done. The existing `playPcmAudio` / `startPcmPlayback` call paths are entirely unchanged.

This means Phase B tests asserting queue-based playback behaviour (e.g., that `enqueue` is called instead of a direct spawn) will fail at assertion level for the wrong reason — the code literally doesn't route through the queue, not because the queue is unimplemented.

**Required fix:** Either (a) route the playback calls through `audioQueue.enqueue()` in Phase A stubs, or (b) remove AQ-INT-01/02/03 from the ADR's integration table and scope them to Phase C, updating the requirements table accordingly.

---

#### C-2: ADR coherence check §7 is factually incorrect

**File:** `docs/reviews/audio-queue-phase-a.md` (§7 "No circular imports")

The ADR states:

> ✅ No circular imports: `audio-queue.ts` imports only from `playback.ts` (for `SpawnFn` type reuse)

The actual `packages/voice/src/core/audio/audio-queue.ts` has **zero import statements**. It defines `QueueSpawnFn` independently — no import from `playback.ts` or anywhere else.

A Phase A document whose own coherence check is wrong cannot be trusted as the authoritative interface specification. Test-builders and developers reading this document will form incorrect assumptions about the dependency graph.

**Required fix:** Correct §7 to reflect the actual import graph. Add a note explaining why `QueueSpawnFn` and `SpawnFn` are kept separate (intentional — `QueueSpawnFn` requires `stdin`, `SpawnFn` does not).

---

### 🟠 Major — Should Fix Before Phase B

#### M-1: ADR aplay syntax conflicts with existing codebase approach

**Files:** `docs/reviews/audio-queue-phase-a.md` §2, `packages/voice/src/core/audio/playback.ts`

The ADR's "Chosen Solution" (§2) describes Linux playback as:

> `aplay -t raw -f S16_LE -r <rate> -c 1 -`

This is raw PCM mode. However, the existing production implementation in `createPreSpawnedPlayer` uses:

> `aplay -` (WAV stdin) — consuming a WAV-header buffer built by `buildWavBuffer`

These are two incompatible approaches. Raw PCM streaming (`-t raw`) enables multi-chunk streaming without restarting the process (the architectural goal). WAV-header mode requires knowing total audio size upfront (or restarting per sentence). The ADR is correct that raw PCM is the right approach for the queue design, but it fails to acknowledge the divergence from the existing code or state that `createPreSpawnedPlayer` will NOT be reused.

Phase C implementors reading both files will be confused about which approach to take.

**Required fix:** Add a paragraph to ADR §2 explicitly stating that `AudioQueue` will use raw PCM mode (`-t raw -f S16_LE -r <rate> -c 1 -`) and that `createPreSpawnedPlayer` (WAV mode) is intentionally NOT reused for queue-based playback.

---

#### M-2: AQ-INT-04 misleadingly states "not a global singleton"

**Files:** `docs/reviews/audio-queue-phase-a.md` (requirements table), `packages/voice/src/extension.ts` lines 56–57, 166–173

AQ-INT-04 is stated as:

> Not a global singleton — created by extension, injected via NarrationDeps

`extension.ts` declares:

```typescript
let _audioQueue: AudioQueue | undefined;
```

at module scope (line ~56). This IS a module-level singleton — one instance per extension activation, stored in module state. The requirement as worded ("not a global singleton") is technically vacuous: of course it is not a `global.audioQueue` — but the spirit of "no singleton" is violated.

**Required fix:** Reword AQ-INT-04 to: "Injected via `NarrationDeps` (not a process-global or cross-module singleton; one instance per extension activation)." This prevents Phase B test-builders from writing incorrect isolation tests.

---

#### M-3: `SpawnedPlayerProcess.stdin.on` is too narrow — missing `"drain"` event

**File:** `packages/voice/src/core/audio/audio-queue.ts` lines ~40–55

The interface defines:

```typescript
stdin: {
  write(chunk: Buffer): boolean;
  end(): void;
  on(event: "error", listener: (err: Error) => void): void;
};
```

`Writable.write()` returns `false` when the internal buffer is full (backpressure). The caller must then wait for the `"drain"` event before writing more. Typical TTS sentence audio is 50–200 KB of raw PCM. Writing this in a single `write()` call without honouring backpressure will silently lose audio data on slow systems.

Without `on(event: "drain", listener: () => void)` in the interface, Phase C implementors will be forced to either: (a) cast to `NodeJS.WritableStream`, violating the interface contract, or (b) ignore backpressure, introducing a silent data-loss bug.

**Required fix:** Add `"drain"` to the `on` overload:

```typescript
on(event: "error", listener: (err: Error) => void): void;
on(event: "drain", listener: () => void): void;
```

---

#### M-4: No requirement ID for post-`dispose()` `enqueue()` behaviour

**File:** `packages/voice/src/core/audio/audio-queue.ts` — `AudioQueue.dispose()` JSDoc

The JSDoc for `dispose()` states: _"further `enqueue()` calls reject"_. This is an important observable behaviour with no corresponding requirement ID in the ADR's table. Phase B will have no anchor for a test covering this contract.

**Required fix:** Add a requirement, e.g. AQ-012: "After `dispose()` is called, any subsequent `enqueue()` call rejects with a typed error."

---

### 🟡 Minor — Fix Before Phase D

#### N-1: `streamingSpeak: (...args: unknown[]) => unknown` in `NarrationDeps`

**File:** `packages/voice/src/voice-narration.ts` — `NarrationDeps` interface

The `streamingSpeak` field is typed as `(...args: unknown[]) => unknown`. This is an untyped escape hatch that:

- Violates `strict: true` / no-`any`-equivalent guidelines (coding-guidelines.md §3)
- Prevents the type checker from catching incorrect call sites
- Is inconsistent with every other field in `NarrationDeps`, which are all precisely typed

**Required fix:** Type `streamingSpeak` with its actual signature (matching the exported `streamingSpeak` function in `streaming-tts.ts`).

---

#### N-2: `cancel()` race condition undocumented

**File:** `packages/voice/src/core/audio/audio-queue.ts` — `AudioQueue.cancel()` JSDoc

`cancel()` returns `void` synchronously. There is no documented contract for what happens if `enqueue()` is called immediately after `cancel()` (before any async cancellation work completes). The ADR does not address this ordering.

**Required fix:** Either change `cancel()` to return `Promise<void>` (ensuring cancellation is complete before the caller proceeds) or add explicit JSDoc contract: e.g., "Enqueue calls concurrent with or immediately following `cancel()` are safe — they will be resolved normally against the re-initialised queue."

---

#### N-3: Sample-rate-change / process-restart strategy not captured in interface or requirements

**File:** `docs/reviews/audio-queue-phase-a.md` §2 (prose only)

The ADR mentions in prose: _"If a chunk arrives with a different sample rate, the current process is terminated and a new one spawned."_ This is a meaningful behavioural contract, but:

- No requirement ID captures it
- The `AudioQueue` interface has no JSDoc mentioning this on `enqueue()`
- Phase C implementors reading only the interface will miss it

**Required fix:** Add a requirement AQ-013 and a JSDoc note on `enqueue()` describing the sample-rate change behaviour.

---

#### N-4: `SpawnedPlayerProcess.stdin` should be `readonly`

**File:** `packages/voice/src/core/audio/audio-queue.ts`

The `stdin` property in `SpawnedPlayerProcess` is mutable. Since consumers should only call methods on `stdin` (never replace it), it should be declared `readonly stdin: { ... }` per the coding guidelines' "prefer `readonly` for injected dependencies" rule.

**Required fix:** Add `readonly` modifier to `stdin` in `SpawnedPlayerProcess`.

---

### ✅ Commendations

- **Zero VSCode imports** in `audio-queue.ts` — correctly editor-agnostic ✅
- **Full `node:` prefix compliance** — all Node built-ins use `node:` prefix ✅
- **Named exports only** — no default exports ✅
- **`UPPER_SNAKE_CASE`** for `DEFAULT_MAX_QUEUE_DEPTH` ✅
- **`interface` for shapes, typed error classes** — `QueueFullError` correctly extends `Error` with typed `currentSize` / `maxDepth` ✅
- **Lazy process spawn** — no process created until first `enqueue()` ✅
- **Injectable `spawnFn` and `platform`** — correct approach for deterministic testing ✅
- **Backward compatibility preserved** — `playPcmAudio` / `startPcmPlayback` untouched ✅
- **Stub does not break existing tests** — 339/339 passing, 0 failures ✅
- **TypeScript compiles clean** — `tsc --noEmit` → 0 errors ✅
- **`QueueFullError` typed correctly** — `currentSize` and `maxDepth` params ✅
- **File name** `audio-queue.ts` — correct kebab-case ✅

---

## Checklist

| Area | Item | Result | Notes |
|---|---|---|---|
| 1. Requirements | All AQ-xxx requirements have interface representation | ⚠️ PARTIAL | AQ-INT-01/02/03 listed as done but not implemented |
| 1. Requirements | All requirements have unique IDs | ✅ PASS | |
| 1. Requirements | Post-dispose enqueue behaviour has a requirement ID | ❌ FAIL | No AQ-xxx for this contract (M-4) |
| 1. Requirements | Sample-rate change behaviour has a requirement ID | ❌ FAIL | Prose-only in ADR (N-3) |
| 2. Interface | `enqueue()` signature complete and typed | ✅ PASS | |
| 2. Interface | `cancel()` return type appropriate | ⚠️ WARN | `void` — race condition undocumented (N-2) |
| 2. Interface | `dispose()` return type appropriate | ✅ PASS | `Promise<void>` |
| 2. Interface | `SpawnedPlayerProcess.stdin` covers all needed events | ❌ FAIL | Missing `"drain"` overload (M-3) |
| 2. Interface | `streamingSpeak` typed precisely in `NarrationDeps` | ❌ FAIL | `(...args: unknown[]) => unknown` (N-1) |
| 3. Integration | `doSpeakText` routes through queue | ❌ FAIL | Still calls `playPcmAudio` directly (C-1) |
| 3. Integration | `doReadAloud` routes through queue | ❌ FAIL | Still calls `startPcmPlayback` directly (C-1) |
| 3. Integration | `streamingSpeak` routes through queue | ❌ FAIL | `options.audioQueue` never referenced (C-1) |
| 3. Integration | Queue lifecycle wired in `extension.ts` | ✅ PASS | Created, injected, disposed correctly |
| 4. Architecture | No VSCode imports in `audio-queue.ts` | ✅ PASS | |
| 4. Architecture | External deps (spawn) behind abstraction | ✅ PASS | `QueueSpawnFn` injectable |
| 4. Architecture | ADR coherence check accurate | ❌ FAIL | §7 incorrectly states imports from `playback.ts` (C-2) |
| 5. Platform | aplay invocation approach documented clearly | ⚠️ WARN | Conflicts with existing `playback.ts` pattern (M-1) |
| 5. Platform | macOS / Windows paths acknowledged | ✅ PASS | `platform` injectable in factory |
| 6. Coding guidelines | Named exports only | ✅ PASS | |
| 6. Coding guidelines | `node:` prefix on builtins | ✅ PASS | |
| 6. Coding guidelines | No untyped escape hatches | ❌ FAIL | `(...args: unknown[]) => unknown` in NarrationDeps (N-1) |
| 6. Coding guidelines | `readonly` on injected props | ⚠️ WARN | `stdin` not readonly (N-4) |
| 7. Testability | `spawnFn` injectable | ✅ PASS | |
| 7. Testability | `platform` injectable | ✅ PASS | |
| 7. Testability | Stub rejects cleanly without side-effects | ✅ PASS | |
| 7. Testability | All existing tests still pass | ✅ PASS | 339/339 |
| 7. Testability | TypeScript compiles clean | ✅ PASS | 0 errors |

---

## Summary for Project Manager

**Phase B CANNOT begin** until Critical findings C-1 and C-2 are resolved:

- **C-1** must be resolved by either (a) actually routing `doSpeakText`, `doReadAloud`, and `streamingSpeak` through `audioQueue.enqueue()` in Phase A (even as a stub call), or (b) explicitly descoping AQ-INT-01/02/03 from Phase A and marking them as Phase C work in the ADR.
- **C-2** requires correcting the ADR's §7 coherence check to accurately describe the actual import graph.

Major findings M-1 through M-4 should be addressed before Phase B to avoid incorrect test assumptions. They are unlikely to cause test failures but will cause confusion and rework in Phase C.

Minor findings N-1 through N-4 can be deferred to Phase D provided they are tracked.

Return to the architect for fixes, then re-submit for re-review.

---

## Re-review — 2026-04-01

- **Re-reviewer:** Reviewer Agent (independent gate)
- **Trigger:** Architect addressed all 6 findings from the initial review
- **Re-review verdict:** PASS WITH NOTES

---

### Finding Status After Fixes

#### C-1 — `audioQueue` wired but dead → RESOLVED

**Verified:** The ADR now opens with an explicit Phase scope note (lines 8–13) and the requirements table marks AQ-INT-01, AQ-INT-02, and AQ-INT-03 as **"Phase C"** work with clear explanation. The `extension.ts` comment on line 165–167 now reads: _"Integration routing (AQ-INT-01/02/03) is Phase C."_ The function bodies in `voice-narration.ts` and `streaming-tts.ts` are correctly left unchanged — this is now the documented and intended state for Phase A.

The ADR's Phase scope note is unambiguous: Phase B test-builders will know these integration paths are deliberately untested in Phase A.

#### C-2 — ADR §7 coherence check incorrect → RESOLVED

**Verified:** ADR §7 now reads: _"`audio-queue.ts` has zero imports — it is fully self-contained."_ It also explains why `QueueSpawnFn` and `SpawnedPlayerProcess` are defined independently of `playback.ts` (queue needs `stdin` access that `SpawnFn` doesn't expose). The old false claim about importing from `playback.ts` is gone.

#### M-1 — aplay syntax conflicts with existing codebase → RESOLVED

**Verified:** ADR §2 now has a dedicated subsection "Why raw PCM instead of WAV-with-single-process" (lines 40–55) that:
- Explains exactly why WAV mode cannot keep a single process alive across multiple chunks
- Documents all five `aplay` flags and their meaning (`-t raw`, `-f S16_LE`, `-r <rate>`, `-c 1`, `-`)
- Explicitly states `createPreSpawnedPlayer()` (WAV mode) is "intentionally NOT reused for queue-based playback"

Phase C implementors now have a clear, unambiguous specification.

#### M-2 — AQ-INT-04 misleading "not a global singleton" → RESOLVED

**Verified:** AQ-INT-04 in the requirements table now reads: _"scoped to extension lifecycle, not a process-global or cross-module singleton."_ The `extension.ts` comment on line 165 mirrors this wording: _"one instance per extension activation, scoped to extension lifecycle (not a process-global singleton)."_ The wording accurately describes module-level `_audioQueue` as a lifecycle-scoped ref rather than a process-global.

#### M-3 — `SpawnedPlayerProcess.stdin` too narrow, missing `"drain"` → RESOLVED

**Verified:** `audio-queue.ts` line 56 now has:
```typescript
on(event: "drain", cb: () => void): void;
```
`stdin` is also declared `readonly` (line 52). Both the drain overload and the `readonly` modifier are confirmed in the actual file.

#### M-4 — No requirement ID for post-`dispose()` enqueue → RESOLVED

**Verified:** AQ-011 is present in the requirements table (line 107):
> _"Post-dispose guard: after `dispose()` is called, further `enqueue()` calls reject with `Error` (message: 'AudioQueue has been disposed')"_

The `enqueue()` JSDoc in the interface (line 120) references it:
> _"Rejects with `Error` ('AudioQueue has been disposed') after `dispose()` (AQ-011)"_

Phase B test-builders now have a named, anchored requirement to test against.

---

### Minor Findings Status

#### N-1 — `streamingSpeak: (...args: unknown[]) => unknown` → STILL OPEN (accepted deferral)

**Verified:** `voice-narration.ts` line 33 still reads `streamingSpeak: (...args: unknown[]) => unknown`. This was a minor finding in the first review with a recommended fix before Phase D. However, `extension.ts` line 174 now uses a cast to bridge the gap: `streamingSpeak: streamingSpeak as NarrationDeps["streamingSpeak"]`. The cast is isolated to the single construction site.

**Assessment:** This is a known technical debt. The cast suppresses a type mismatch that should be resolved by typing `streamingSpeak` precisely in `NarrationDeps`. It is acceptable as a Phase D fix **provided** it is tracked. Deferral is acknowledged. No new risk introduced vs. the prior state — the cast is the same pattern as before.

#### N-2 — `cancel()` race condition undocumented → STILL OPEN (minor, Phase D)

No change to `cancel()` return type or JSDoc. Acceptable for Phase A/B; document contract before Phase D.

#### N-3 — Sample-rate change / process-restart not in requirements → RESOLVED (partially)

**Verified:** ADR §2 now documents the sample-rate change behaviour in prose (line 53: _"If a chunk arrives with a different rate, the queue terminates the current process and spawns a new one"_) and in the trade-offs table (line 89). A formal requirement ID (AQ-013) was not added. This behaviour is now at least discoverable for Phase C implementors via the ADR. A Phase B test for rate-change behaviour would require a requirement ID — if the test-builder intends to write this test, AQ-013 should be added. Otherwise, deferral to Phase C documentation is acceptable.

#### N-4 — `stdin` not `readonly` → RESOLVED

**Verified:** Confirmed `readonly stdin:` at line 52 of `audio-queue.ts`. Fixed as part of M-3 resolution.

---

### New Issues Introduced by the Fixes

**One low-severity new observation:**

**N-5 — `extension.ts` line 174 uses a type cast that suppresses a real mismatch**

```typescript
streamingSpeak: streamingSpeak as NarrationDeps["streamingSpeak"],
```

Because `NarrationDeps["streamingSpeak"]` is `(...args: unknown[]) => unknown` and `streamingSpeak` is `(text: string, ttsProvider: TtsProvider, options: StreamingSpeakOptions) => Promise<void>`, this cast is currently safe at runtime (the real function is assigned). However, if `NarrationDeps.streamingSpeak` is ever called through the `deps` bag with mismatched arguments, TypeScript will not catch it. This is a consequence of N-1 still being open, not a new independent problem. It is tracked under N-1's deferral.

No other new issues were introduced by the fixes.

---

### Updated Checklist

| Area | Item | Result | Notes |
|---|---|---|---|
| 1. Requirements | AQ-INT-01/02/03 scope accurately documented | ✅ PASS | Explicitly Phase C in ADR and code comment |
| 1. Requirements | Post-dispose enqueue has a requirement ID (AQ-011) | ✅ PASS | Fixed (was M-4) |
| 1. Requirements | Sample-rate change has a requirement ID | ⚠️ NOTED | Prose-documented; no AQ-013 yet — acceptable if not tested in Phase B |
| 2. Interface | `SpawnedPlayerProcess.stdin` covers `"drain"` | ✅ PASS | Fixed (was M-3) |
| 2. Interface | `stdin` is `readonly` | ✅ PASS | Fixed (was N-4) |
| 2. Interface | `streamingSpeak` typed precisely in `NarrationDeps` | ⚠️ DEFERRED | Still `(...args: unknown[]) => unknown`; cast at call site; Phase D fix (N-1) |
| 3. Integration | AQ-INT-01/02/03 explicitly deferred to Phase C | ✅ PASS | Fixed (was C-1) |
| 3. Integration | Queue lifecycle wired in `extension.ts` | ✅ PASS | |
| 4. Architecture | ADR §7 coherence check accurate | ✅ PASS | Fixed (was C-2) |
| 5. Platform | aplay raw PCM approach documented, WAV exclusion stated | ✅ PASS | Fixed (was M-1) |
| 6. Coding guidelines | AQ-INT-04 singleton wording accurate | ✅ PASS | Fixed (was M-2) |
| 6. Coding guidelines | No untyped escape hatches (excluding N-1 deferral) | ⚠️ DEFERRED | N-1 still open; cast is isolated; Phase D |
| 7. Testability | All existing tests still pass | ✅ PASS | 339/339 |
| 7. Testability | TypeScript compiles clean | ✅ PASS | 0 errors |

---

### Re-review Summary for Project Manager

**PASS WITH NOTES — Phase B may proceed.**

All six critical and major findings (C-1, C-2, M-1, M-2, M-3, M-4) are genuinely resolved. The ADR is now internally consistent, the interface is complete and accurate, and the Phase A/C boundary is unambiguous.

**Two items remain open and must be addressed before Phase D2 review:**
- **N-1 / N-5** (deferred): type `streamingSpeak` precisely in `NarrationDeps` and remove the `as` cast in `extension.ts`.
- **N-2** (deferred): document `cancel()` ordering contract in JSDoc.

**One item the test-builder should be aware of:**
- **N-3 / AQ-013**: If Phase B tests are intended to cover the sample-rate-change / process-restart behaviour, a requirement ID must be added to the ADR before those tests are written. If this behaviour is deferred to Phase C, no action needed in Phase B.

Phase B test-builders should write tests anchored to: AQ-001 through AQ-011, AQ-INT-04, AQ-INT-05. AQ-INT-01, AQ-INT-02, AQ-INT-03 are Phase C — do not write integration-routing tests in Phase B.
