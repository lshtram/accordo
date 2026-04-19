## Review — priority-q — Phase B (Final Re-review)

### Scope reviewed

- `packages/comments/src/panel/__tests__/panel-commands.test.ts`
- `packages/comments/src/panel/__tests__/navigation-router.test.ts`

### Verification summary

1. **M45-CMD-02 / M45-CMD-05 forwarding assertions**
   - ✅ Verified in `panel-commands.test.ts`:
     - both tests now use a live spy on `navigateToThread`
     - both assert `toHaveBeenCalledWith(thread, navEnv, mockRegistry)`
     - both assert registry acquisition via `accordo_marp_internal_getNavigationRegistry`
   - ✅ These are now enforceable handler-contract tests (not commented placeholders).

2. **Current Phase B red-state**
   - ✅ Executed `pnpm test` in `packages/comments`.
   - ✅ Result: `Tests 2 failed | 499 passed (501)`.
   - ✅ Both failures are assertion-level contract gaps in `navigation-router.test.ts`:
     1. `Q-MD-01` — expected markdown preview args length `3`, received `2`
     2. `M45-NR-14` — expected route target `'slide'`, received `'text'`
   - ✅ `panel-commands.test.ts` passes, including **M45-CMD-02** and **M45-CMD-05**.

### Phase B gate assessment

- Requirements under review are represented by tests.
- Intended implementation gaps are exposed by targeted assertion failures.
- No import/runtime wiring failures are masking test intent.
- Handler forwarding behavior is now correctly and explicitly asserted.

## Gate decision

## **PASS**

**Signal to project-manager:** Priority Q Phase B is approved. Proceed to Phase C implementation with the two known contract-gap failures as the intended red targets.
