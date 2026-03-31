# E-6 Bar Tools — Phase A Re-Review

## PASS

Phase A is now **ready for Phase B**. I re-reviewed:

- `docs/00-workplan/e-6-bar-tools.md`
- `packages/editor/src/tools/bar.ts`

All three previously blocking issues are resolved.

## Previously Blocking Issues — Status

1. **Panel view toggle safety** — ✅ **RESOLVED**
   - Added explicit focus-first design in `e-6-bar-tools.md` §2.3.2.
   - Handler flow now explicitly includes panel focus before panel view command in §2.4 step 5c.
   - Stub JSDoc in `bar.ts` lines 175–178 mirrors this behavior.
   - Test outline now includes focus-first verification (`§3.4.3` tests #2 and #5).

2. **`rightBar` + `view` ambiguity** — ✅ **RESOLVED**
   - Explicit error condition added in `e-6-bar-tools.md` §1.6:
     `"rightBar does not support the 'view' parameter..."`
   - Handler logic explicitly rejects this combination in §2.4 step 4.
   - Rule is reinforced again in the section narrative (§2.4, "rightBar + view rejection").
   - Stub JSDoc in `bar.ts` lines 179–180 is aligned.
   - Test outline includes dedicated validation case (`§3.4.1` test #6).

3. **Missing D2 gate in TDD plan** — ✅ **RESOLVED**
   - `e-6-bar-tools.md` §3.3 now separates:
     - D (Developer)
     - D2 (Reviewer gate)
     - D3 (PM)

## New Issues Introduced by Fixes

No new blocking issues found.

Minor clarity note (non-blocking):
- In §2.4 step 5b, wording still says "verify view belongs to the requested area (or omit area validation — see note)"; this "or omit" phrasing is less strict than the later explicit mismatch rule. The document still converges to a clear error-on-mismatch behavior, so this is not a gate blocker.

## Test Outline Consistency Check

The updated test outline is consistent with the fixes:

- Includes rightBar+view rejection (`§3.4.1 #6`)
- Includes panel focus-first sequencing and already-open panel safety (`§3.4.3 #2, #5`)
- Total count update (~36) is coherent with added cases

---

**Reviewer signal to project-manager:** Phase A re-review = **PASS**. E-6 is approved to proceed to **Phase B**.
