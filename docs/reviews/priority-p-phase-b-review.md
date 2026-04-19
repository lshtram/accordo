## Review — priority-p — Phase B Re-Review

### Scope reviewed

- `packages/browser/src/__tests__/comment-relay-contract.test.ts`
- `packages/browser/src/__tests__/relay-comment-dispatch.test.ts`
- `packages/browser-extension/tests/sw-comment-sync-contract.test.ts`
- Phase A stubs/contracts:
  - `packages/browser/src/comment-relay-contract.ts`
  - `packages/browser/src/relay-comment-dispatch.ts`
  - `packages/browser-extension/src/sw-comment-sync-contract.ts`

### Execution evidence

- Ran `pnpm test -- --run` in `packages/browser`:
  - `Test Files  2 failed | 39 passed (41)`
  - `Tests  22 failed | 1120 passed (1142)`
  - Failures are expected red-state failures from `Error("not implemented")` in Phase A stubs.

- Ran `pnpm test -- --run` in `packages/browser-extension`:
  - `Test Files  1 failed | 50 passed (51)`
  - `Tests  10 failed | 1256 passed (1266)`
  - Failures are expected red-state failures from `Error("not implemented")` in Phase A stubs.

---

### Verification of previously reported issues

1. ✅ `delete_thread` routing fixed
   - `relay-comment-dispatch.test.ts` now expects `delete_thread -> comment_delete`.

2. ✅ Timeout mismatch removed
   - No out-of-contract timeout argument test remains for `dispatchBrowserCommentAction`.

3. ✅ BR-F-146-08 strict unknown-action contract
   - `sw-comment-sync-contract.test.ts` now uses strict `expect(doEncode).toThrow(Error("not implemented"))`.

4. ✅ BR-F-145-01 / BR-F-145-02 strengthened
   - Success case checks wrapper shape with `success`, `requestId`, and `data.threads`.
   - Error case checks exact discriminator value (`browser-not-connected`).

5. ✅ BR-F-145-03 clarified to requestId stability
   - Same action tested for stable requestId.
   - Different actions tested for distinct requestIds.

6. ✅ BR-F-146-05 deepened validation
   - Now validates nested fields including `thread.anchor.uri` and `thread.comments[0].author.name`.

7. ✅ BR-F-144-PARITY-01 clarification added
   - Test now explicitly documents contract-level simulated fixture scope.

---

### New issues check

- No new critical issues found.
- Tests are importable and execute (failures are implementation-stub failures, not wiring/import failures).
- No shared mutable-state coupling observed across these new test files.

## Gate decision

## **PASS**

All 7 previously reported issues are resolved in the updated tests, and no new blocking issues were introduced.

**Signal to project-manager:** Phase B re-review for Priority P is complete and passes; proceed to Phase C implementation.
