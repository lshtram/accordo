# Review Packet — Priority S Terminal Output Readback + Observed Run Preview — Phase A

## Scope

Phase A only for Priority S (`accordo_terminal_read` plus optional observe fields on `accordo_terminal_run`): architecture/requirements updates, contract-hardening plan, and importable editor stubs.

## Artifacts prepared

- `docs/10-architecture/architecture.md`
- `docs/20-requirements/requirements-editor.md`
- `docs/00-workplan/workplan.md`
- `docs/test-plan-terminal-readback.md`
- `packages/editor/src/tools/terminal.ts`
- `packages/editor/src/tools/terminal/terminal-state.ts`
- `packages/editor/src/tools/terminal/terminal-lifecycle.ts`
- `packages/editor/src/tools/terminal/terminal-open.ts`
- `packages/editor/src/tools/terminal/terminal-run.ts`
- `packages/editor/src/tools/terminal/terminal-focus.ts`
- `packages/editor/src/tools/terminal/terminal-list.ts`
- `packages/editor/src/tools/terminal/terminal-close.ts`
- `packages/editor/src/tools/terminal/terminal-basic-tools.ts`
- `packages/editor/src/tools/terminal/terminal-run-tool.ts`
- `packages/editor/src/tools/terminal/terminal-tools.ts`
- `packages/editor/src/tools/terminal-read/index.ts`
- `packages/editor/src/tools/terminal-read/contracts.ts`
- `packages/editor/src/tools/terminal-read/stubs.ts`
- `packages/editor/src/tools/terminal-read/tools.ts`

## Reviewer focus

1. Confirm the hybrid boundary is explicit and consistent: `accordo_terminal_run` dispatches and may optionally preview, while `accordo_terminal_read` remains the authoritative incremental follow-up surface.
2. Confirm backward compatibility is explicit: omitted/zero `observeMaxLines` preserves the legacy `terminal_run` response shape and semantics.
3. Confirm the local abstraction boundary is sufficient for swapping the eventual VS Code terminal-output capture mechanism without changing MCP callers or creating a second observation pipeline.
4. Confirm validation precedence and public error vocabulary are specific enough for Phase B tests.
5. Confirm the active-terminal fallback and terminal-close reset semantics are unambiguous.
6. Confirm the modularity remediation is complete: touched production files stay under the file-size cap, and `terminalRunHandler` now delegates validation, resolution/adoption, and dispatch through focused helpers.

## Known Phase A risk

- The selected concrete VS Code terminal-output capture mechanism is intentionally deferred. Phase B/C must validate API availability/fidelity before implementation proceeds beyond the stub boundary.
- `accordo_terminal_run` now advertises an additive observe branch that is not implemented yet; reviewer should verify the PASS-ELIGIBLE register makes that temporary gap explicit rather than implicit.
