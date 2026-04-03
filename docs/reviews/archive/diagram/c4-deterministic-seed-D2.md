## Review — c4-deterministic-seed — Phase D2

**File reviewed:** `packages/diagram/src/webview/scene-adapter.ts`  
**Change scope:** Added `fnv1a32` helper; replaced `Math.random()` with deterministic hash for `seed` and `versionNonce`.  
**Reviewed by:** Reviewer  
**Date:** 2026-04-02

---

### PASS

All items below were verified.

---

#### 1. Tests — 543 passing, zero failures

```
Test Files  22 passed (22)
     Tests  543 passed (543)
  Duration  2.88s
```

All 8 tests in `scene-adapter.test.ts` pass, including the 7 SA-* requirement tests.

---

#### 2. Type checker

The type checker reports **one error in `comment-overlay.ts:386`** (`Property '__accordoRepositionPins' does not exist…`). This error is **pre-existing** — confirmed by stashing the `scene-adapter.ts` changes and re-running `pnpm typecheck`: the same error appears with identical location and message on the un-modified codebase. It is **not introduced by this change**.

The new code in `scene-adapter.ts` itself is type-clean:
- `fnv1a32(str: string): number` — explicit parameter and return type ✓
- `h >>> 0` returns `number` ✓
- No new type errors attributable to this diff

---

#### 3. FNV-1a 32-bit algorithm correctness — PASS

Verified against the three canonical FNV-1a 32-bit test vectors from the FNV specification:

| Input | Expected | Got |
|---|---|---|
| `""` (empty) | `0x811c9dc5` | `0x811c9dc5` ✓ |
| `"a"` | `0xe40c292c` | `0xe40c292c` ✓ |
| `"foobar"` | `0xbf9cf968` | `0xbf9cf968` ✓ |

Algorithm structure verified:
- Offset basis `0x811c9dc5` is the correct FNV-1a 32-bit offset basis ✓
- Prime `0x01000193` is the correct FNV-1a 32-bit prime ✓
- **XOR-then-multiply** ordering is correct for FNV-1a (FNV-1 uses multiply-then-XOR; this is the "a" variant) ✓
- `Math.imul(h, 0x01000193)` gives correct 32-bit truncated multiplication — `Math.imul` is the right tool, avoiding float precision loss ✓
- `h >>> 0` (unsigned right shift by 0) coerces the signed 32-bit result to an unsigned 32-bit integer, producing a non-negative `number` ✓

---

#### 4. Determinism — PASS

- `fnv1a32` is a pure function with no external state. Same string → same output on every call, every environment.
- `seed = fnv1a32(mermaidId ?? el.id)` — same element identity → same Rough.js seed → same hand-drawn stroke texture on every render.
- `versionNonce = fnv1a32((mermaidId ?? el.id) + ":nonce")` — distinct from `seed` for every input (confirmed: `2503977039 ≠ 2349470934` for `"auth"`), and also deterministic.

---

#### 5. Null safety — PASS

- `mermaidId ?? el.id` — `mermaidId` is `string | undefined` on `ExcalidrawElement`. The nullish coalescing fallback to `el.id` is safe: `el.id` is a required `string` field (present on every element, including text label elements that carry no `mermaidId`).
- **Label elements (text):** Their `el.id` is unique per element. Two label elements with no `mermaidId` will produce different seeds from their different `el.id` values — correct.
- **Shape elements sharing a mermaidId:** Would produce the same seed. This is the desired behaviour — consistent roughness texture for logically identical nodes across reloads.

---

#### 6. Overflow safety — PASS

- `Math.imul` returns a signed 32-bit integer (range −2³¹ to 2³¹−1).
- `>>> 0` converts it to an unsigned 32-bit integer (range 0 to 2³²−1 = 4 294 967 295).
- `4294967295 ≤ Number.MAX_SAFE_INTEGER (9007199254740991)` — fits perfectly in a JS `number`. Rough.js receives a valid non-negative integer. ✓

---

#### 7. Code quality — PASS

- `fnv1a32` is a pure function: no side effects, no I/O, no mutations, no closures over mutable state.
- No new external dependencies introduced.
- No `any`, no non-null assertions, no debug logs, no TODO/FIXME comments.
- Function length: `fnv1a32` is 7 lines (well under the 40-line guideline).
- `toExcalidrawPayload` is 59 lines — slightly over the ~40-line soft guideline; this is a **pre-existing condition** (the function body was already this length before the change). The diff adds zero lines to the function body (2 line-for-line replacements, no net additions).

---

#### 8. Linter

`pnpm lint` is configured as `echo 'no lint configured yet'` for this package — no linter output to evaluate.

---

#### 9. Architecture constraints — PASS

- `scene-adapter.ts` carries the comment "No VSCode import — pure Node.js module" and the diff introduces no new imports. The `fnv1a32` helper is a self-contained utility using only JS builtins. ✓
- No security-sensitive surface is touched (this is a rendering hint, not auth or serialization).

---

#### 10. Pre-existing issue noted (not blocking this change)

`comment-overlay.ts:386` — `Property '__accordoRepositionPins' does not exist on type 'Window & …'` — pre-existing typecheck failure unrelated to this diff. Recommend tracking in a separate issue.

---

### Verdict: **PASS**

The C4 deterministic seed change is correct, deterministic, overflow-safe, null-safe, pure, and dependency-free. All 543 tests pass. The implementation exactly matches the canonical FNV-1a 32-bit algorithm. Ready to commit.
