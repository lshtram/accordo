## Review — priority-s — Phase D2

### Scope
- Priority S only: `accordo_terminal_read` + observed `accordo_terminal_run`
- Reviewed implementation: `packages/editor/src/tools/terminal-read/**`, `packages/editor/src/tools/terminal/**`, `packages/editor/src/tools/terminal.ts`, `packages/editor/src/extension.ts`
- Reviewed tests/docs: Priority S terminal tests including `terminal-source-shell-integration.test.ts` and `terminal-public-boundary.test.ts`, `docs/test-plan-terminal-readback.md`, `docs/20-requirements/requirements-editor.md`, `docs/10-architecture/architecture.md`, `docs/30-development/coding-guidelines.md`

### Commands run
- `pnpm vitest run src/__tests__/terminal*.test.ts src/__tests__/terminal-source-shell-integration.test.ts src/__tests__/terminal-public-boundary.test.ts`
- `pnpm test`
- `pnpm typecheck`
- `pnpm lint`

### PASS
- Tests: targeted Priority S suite passed in `packages/editor` — **15 files, 103 tests, 103 passing, 0 failing**.
- Tests: full `pnpm test` passed in `packages/editor` — **38 files, 420 tests, 420 passing, 0 failing**.
- Type check: `pnpm typecheck` clean in `packages/editor`.
- Lint: `pnpm lint` clean in `packages/editor`.
- Same-call observe is now implemented in production code: `terminal_run` dispatches synchronously, then `collectObservePreview()` polls the shared read pipeline for a bounded shell-integration capture window before returning inline observe (`packages/editor/src/tools/terminal/terminal-run.ts:76-88,148-173`; constants in `packages/editor/src/tools/terminal-read/contracts.ts:14-15`).
- Same-call observe is now proven at the required public boundary: `terminal-public-boundary.test.ts` drives the registered `vscode.commands.executeCommand("accordo_terminal_run", ...)` path, wraps the mock terminal `sendText`, fires shell-execution output during that same invocation, and asserts that the returned response contains non-empty observed text and cursor (`packages/editor/src/__tests__/terminal-public-boundary.test.ts:120-155,193-223`).
- The public-boundary proof does **not** use `terminalOutputBuffer.test_only_append()` or pre-seeded buffer output in `terminal-public-boundary.test.ts`; it uses `shellEmitter.setChunks(...)` + `shellEmitter.wrapTerminal(...)` to drive the real shell-event capture path (`packages/editor/src/__tests__/terminal-public-boundary.test.ts:122-145,208-217,246-272,294-308`).
- `terminal_read` continuation from the observe cursor is proven through the registered command boundary: the test gets the cursor from `executeCommand("accordo_terminal_run", ...)`, fires a new shell execution, then continues with `executeCommand("accordo_terminal_read", { since: cursor })` (`packages/editor/src/__tests__/terminal-public-boundary.test.ts:251-276`).
- Real shell integration capture remains directly covered: `execution.read()` output flows through `vscodeTerminalOutputSource` into `terminalOutputBuffer.append()` and is then observed/redacted/continued by the shared runtime pipeline (`packages/editor/src/tools/terminal-read/vscode-terminal-source.ts:64-78,111-156`; `packages/editor/src/__tests__/terminal-source-shell-integration.test.ts:106-149,160-257`).
- Cursor continuity remains closed: the runtime buffer decodes the emitted `t-<terminalId>:<base64url(...)>` cursor format and passing continuity tests prove no duplicate replay on follow-up reads (`packages/editor/src/tools/terminal-read/runtime-buffer.ts:86-97`, `packages/editor/src/__tests__/terminal-read-cursor-continuity.test.ts`).
- Lifecycle close/reset remains covered through the registered close event path, clearing retained output and invalidating stale cursors (`packages/editor/src/tools/terminal/terminal-lifecycle.ts:7-23`, `packages/editor/src/__tests__/terminal-read-lifecycle.test.ts:191-255`).
- Legacy no-observe behavior, bounds/truncation, redaction, and precedence remain covered and passing (`terminal-observe-legacy.test.ts`, `terminal-read-bounds.test.ts`, `terminal-read-truncated.test.ts`, `terminal-read-redaction.test.ts`, `terminal-read-precedence.test.ts`).
- No `require(...)` / CommonJS globals found in the reviewed Priority S production runtime; `vscode-terminal-source.ts` uses ESM imports (`packages/editor/src/tools/terminal-read/vscode-terminal-source.ts:18-21`).
- No `console.log`, `TODO`, or `FIXME` markers were found in the reviewed Priority S production runtime (`packages/editor/src/tools/terminal-read/**`, `packages/editor/src/tools/terminal/**`).
- Modularity is within documented thresholds for touched production runtime files/functions: reviewed runtime files stay below the 300-line cap and touched executable functions reviewed stay within the 50-line cap (`docs/30-development/coding-guidelines.md:160-167`).

### FAIL — must fix before Phase E
- None.

### Notes
- Public-boundary Priority S proof now closes the prior blocker category; no new blocker categories were introduced in this re-review.

### Blocker-set completeness
- This is the full known blocker set for this patch based on current HEAD review evidence: no known blockers remain.
