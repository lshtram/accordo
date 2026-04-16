# Review — hub-script-routing — Phase D2 (re-check after F-1/F-2 fixes)

**Module:** hub-script-routing (M52 — NarrationScript execution in Hub)  
**Date:** 2026-04-01  
**Reviewer:** Reviewer agent  
**Checklist basis:** `docs/30-development/coding-guidelines.md §3`  
**Prior review:** same file, initial pass — conditional, two blockers (F-1, F-2)

---

## Summary verdict

**CONDITIONAL — one new blocker introduced by the W-4 fix**

F-1 and F-2 are resolved. W-1 and W-4 were addressed, but the W-4 implementation introduced a new ESLint error (`no-floating-promises`) that now blocks Phase E. One-character fix required.

---

## Verification of prior findings

### F-1 — RESOLVED ✅

`_mergeCallbacks` arrow functions now carry explicit `: void` return types at lines 150, 154, 158, 162 of `script-runner.ts`. The four `explicit-function-return-type` errors are gone.

### F-2 — RESOLVED ✅

`run()` now accepts an optional `scriptId?: string` parameter. Line 121 seeds `scriptId: scriptId ?? this._status.scriptId` into `this._status` before `_execute` runs. `accordo_script_run` generates the UUID, passes it into `deps.runner.run(script, scriptId)`, and returns it to the caller. `accordo_script_status` now reflects the same ID.

### W-1 — RESOLVED ✅

`dangerLevel` for `accordo_script_run` is now `"moderate"` (line 47 of `script-tools.ts`), matching `architecture.md §13.3 line 891`. The three read-only tools (`stop`, `status`, `discover`) correctly remain `"safe"`.

### W-4 — PARTIALLY ADDRESSED — introduces new blocker

A JSDoc comment was added to explain the intentional promise discard. However, the `void` operator was **not** prepended to the call. ESLint's `no-floating-promises` rule (configured as `error`) requires **both** a comment and the `void` operator to mark intentional discard. Current code at `script-tools.ts` line 197:

```typescript
deps.runner.stop();   // ← floating promise — ESLint error
```

Required code:

```typescript
void deps.runner.stop();   // ← explicitly ignored per no-floating-promises
```

---

## Current lint/test/typecheck state

```
pnpm typecheck   → clean (0 errors)
pnpm test        → 517 passing, 0 failures (20 test files)
pnpm lint        → 1 error, 3 warnings
```

**Error (new, blocks Phase E):**

```
/packages/hub/src/script/script-tools.ts
  197:7  error  Promises must be awaited, end with a call to .catch, end with a call
                to .then with a rejection handler or be explicitly marked as ignored
                with the `void` operator
                @typescript-eslint/no-floating-promises
```

**Warnings (3, all pre-existing, not new):**

```
bridge-dispatch.ts  345:18  warning  Forbidden non-null assertion
prompt-engine.ts    107:18  warning  Forbidden non-null assertion
server.ts           257:9   warning  Forbidden non-null assertion
```

These three non-null assertions predate this module. They are not introduced by the script-routing work and are not blocking.

---

## FAIL — must fix before Phase E

### F-3 · Missing `void` operator on `deps.runner.stop()` call

**File:** `packages/hub/src/script/script-tools.ts` line 197  
**Rule:** `@typescript-eslint/no-floating-promises` (configured as `error`)

The comment correctly documents the intent, but the ESLint rule requires the `void` operator as the machine-readable signal. Change:

```typescript
// Before
deps.runner.stop();

// After
void deps.runner.stop();
```

No logic change — purely the `void` prefix to satisfy the linter.

---

## Remaining open items (W-2, W-3 — not blocking)

| # | Status | Note |
|---|--------|------|
| W-2 | Open | `accordo_subtitle_show` fire-and-forget still swallows errors silently. DEC-007 documents the gap. A `.catch()` warn log is recommended but not mandatory for Phase E. |
| W-3 | Open | `script-tools.ts` is 388 lines vs. the 200-line guideline (majority is schema `description` strings). Borderline — defer until the file grows further. |

---

## Path to Phase E

Fix F-3 (one line: add `void` prefix), run `pnpm lint` to confirm 0 errors, then signal for re-review. No code logic changes required — this is a one-character fix.
