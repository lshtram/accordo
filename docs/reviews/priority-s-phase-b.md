# Phase B Re-Review — Priority S: Terminal Output Readback (S-TR-01..11)

**Result:** PASS (harness adequacy)

## Scope reviewed

- `docs/test-plan-terminal-readback.md`
- `packages/editor/src/__tests__/terminal-read-lifecycle.test.ts`
- `packages/editor/src/__tests__/terminal-read-cursor-continuity.test.ts`
- `packages/editor/src/__tests__/terminal-observe-preview.test.ts`
- `packages/editor/src/__tests__/terminal-observe-authority.test.ts`

## Current run

- Ran `pnpm vitest run src/__tests__/terminal-read-lifecycle.test.ts src/__tests__/terminal-read-cursor-continuity.test.ts src/__tests__/terminal-observe-preview.test.ts src/__tests__/terminal-observe-authority.test.ts` in `packages/editor`.
- Result: **4 files, 20 tests, 15 passing, 5 failing**.

## Decision summary

- **Phase A-TP adequacy:** PASS for the scoped proof-rule update.
- **Phase B harness adequacy:** PASS.
- **Reason:** the prior lifecycle proof defect is closed. The scoped tests now register the production lifecycle handler before firing the close event, and the remaining failures are assertion-level behavior failures consistent with the approved non-pass-eligible implementation gap set.

## Harness adequacy verdict

- No concrete harness defects found in the scoped files under the completion-defining proof rules.
- The lifecycle harness now exercises the required path `onDidCloseTerminal → registered close handler → buffer clear` via `registerTerminalLifecycle(mockContext)` in `packages/editor/src/__tests__/terminal-read-lifecycle.test.ts:165-166`, and `S-TR-05-01` proves the registered path can clear runtime buffer state.
- The other scoped tests remain focused on runtime cursor continuity / observe authority proof and fail at assertion level rather than import or setup level.

## Remaining implementation blockers (not harness defects)

- `packages/editor/src/__tests__/terminal-read-lifecycle.test.ts:221` — failing test `S-TR-05-02: stale cursor for a closed/reset terminal is rejected as error through real handler`
- `packages/editor/src/__tests__/terminal-read-cursor-continuity.test.ts:99` — failing test `S-TR-02-CONT-02: second read with cursor returns ONLY subsequent content (no duplicates)`
- `packages/editor/src/__tests__/terminal-read-cursor-continuity.test.ts:131` — failing test `S-TR-02-CONT-03: cursor format round-trip: encoder output is consumable by decoder`
- `packages/editor/src/__tests__/terminal-observe-preview.test.ts:147` — failing test `S-TR-09-CONT-01: terminal_run(observe) + terminal_read continuation via real cursor path`
- `packages/editor/src/__tests__/terminal-observe-authority.test.ts:92` — failing test `S-TR-11-RT-01: observe cursor from terminal_run continues through terminal_read (real runtime pipeline)`

These failures point to remaining implementation work in cursor continuation / stale-cursor invalidation, not to a missing or invalid proof harness.

## Signal to project-manager

- **PASS (harness adequacy)** — Priority S may proceed with implementation against the remaining failing behavior tests above.
