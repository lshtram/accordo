## Review — whole-project — D2 health check (pre-diagram)

Date: 2026-04-19  
Reviewer: reviewer agent (independent re-check)

---

## 1) Overall health verdict

**Verdict: AMBER**

- **P/Q/R delivery status:** functionally healthy in current code and tests.
- **Project-wide gates:** full test suite is green, but monorepo typecheck is not fully green (failure in `packages/bridge` tests), and there are unrelated debug-log instrumentation changes currently in the working tree.

---

## 2) Critical issues (blocking)

### C1 — Monorepo typecheck gate is currently red (outside P/Q/R scope)
- Command: `pnpm typecheck` at repo root
- Failure observed:
  - `packages/bridge/src/__tests__/hub-manager.test.ts(1371,28)` TS2345
  - `packages/bridge/src/__tests__/hub-manager.test.ts(1372,28)` TS2345
- Impact: whole-repo typecheck cannot be considered clean at this moment.
- Scope note: this is **not** in Priority P/Q/R implementation files, but it affects whole-project health.

### C2 — Priority P D sign-off chain requires one extra artifact to be legitimate
- Reviewed file `docs/reviews/priority-p-phase-d-review.md` is a **FAIL** review (TS2352 block).
- Priority P is only legitimately closed because `docs/reviews/priority-p-D2.md` records the re-review **PASS**.
- Impact: if someone reads only `priority-p-phase-d-review.md`, they get an incorrect completion impression.

---

## 3) Non-critical observations

### N1 — Priority P implementation spot-check found a likely envelope mismatch risk
- File: `packages/browser-extension/src/adapters/comment-backend.ts`
- `VscodeRelayAdapter.listThreads()` currently expects `res.data` to be an array (`Array.isArray(res.data)`), while Priority P standardized read payloads to canonical `{ threads }` envelope.
- Current behavior risk: if this method is exercised against canonical payloads, it may return `[]` unexpectedly.
- Severity: medium (latent; not currently proven to break active path during this check).

### N2 — Stale TODO in production path (already implemented behavior)
- File: `packages/browser/src/relay-lifecycle.ts:531`
- Comment says to replace inline shaping with `normalizeReadResult()`, but line 535 already uses `normalizeReadResult(result)`.
- Severity: low (documentation/code drift only).

### N3 — Unrelated debug instrumentation exists in diagram source files in current working tree
- Files include:
  - `packages/diagram/src/layout/upstream-direct.ts`
  - `packages/diagram/src/webview/panel-commands.ts`
  - `packages/diagram/src/webview/panel-core.ts`
- Pattern: `console.log("// DEBUG: ...")` in non-test code.
- Severity: medium (not a P/Q/R regression; should be removed before shipping diagram work).

### N4 — Architecture constraints spot-check passed
- No `vscode` imports found under `packages/hub`.
- No evidence in reviewed P/Q/R files of handler serialization across package boundaries.
- No obvious auth-bypass/input-injection issue observed in reviewed files.

---

## 4) Workplan accuracy check

Reviewed: `docs/00-workplan/workplan.md`

### Accurate
- Priority P and Q sections correctly describe delivered outcomes, requirement IDs, and testing guides.
- Priority R section correctly captures root-cause correction and implemented contracts.

### Minor discrepancies / hygiene
- Priority R appears twice in heading form (`line 219` + strikethrough heading at `line 221`), likely leftover duplication.
- P/Q/R sections describe Phase A/B/C/D completion but do not explicitly state **F** in section headings, while session summary says A/B/C/D/F complete.
- For Priority P, completion coherence depends on both docs:
  - `priority-p-phase-d-review.md` (FAIL)
  - `priority-p-D2.md` (PASS)

---

## 5) Test evidence check

### Commands run during this review
- `pnpm test -- --run` in:
  - `packages/browser` → **1142/1142 passing**
  - `packages/browser-extension` → **1271/1271 passing**
  - `packages/comments` → **509/509 passing**
  - `packages/marp` → **308/308 passing**
- `pnpm test -- --run` at repo root → completed successfully (full output captured).
- `pnpm typecheck` in above 4 packages → clean.
- `pnpm lint` in above 4 packages:
  - browser/browser-extension clean
  - comments/marp use `no lint configured yet` placeholder script

### Whole-repo caveat
- `pnpm typecheck` at repo root currently fails in `packages/bridge` test typing (see C1).

---

## Final recommendation before diagram work

Proceed with diagram planning/implementation only with this understanding:
1. **P/Q/R are operationally green** by tests and spot-check.
2. Clear or track the **root typecheck failure** (bridge tests) so whole-project gates are not silently assumed green.
3. Clean out **DEBUG console logging** in diagram source before merge/release.
4. Fix the minor workplan/review-document coherence notes to prevent sign-off confusion.
