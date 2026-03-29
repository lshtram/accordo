## Review — page-understanding-capture-region — Phase A

### Scope Reviewed
- `docs/design/page-understanding-architecture.md`
- `docs/architecture.md` (§14, §15 and cross-references)
- `docs/requirements-browser-extension.md` (§3.18 + module/traceability tables)
- `docs/requirements-comments.md` (enhanced browser anchor note)
- `packages/browser-extension/src/types.ts`
- `packages/browser-extension/src/relay-actions.ts`
- `packages/browser/src/types.ts`
- `packages/browser/src/page-understanding-tools.ts`

### Result
## PASS

### Gate checks
1. **Architectural coherence + portability (VSCode-backed now, standalone MCP later):** PASS
   - Design and architecture docs are aligned on relay-first execution path now and adapter-based portability path later (`CommentBackendAdapter`, standalone MCP reservation).
   - No Hub/VSCode boundary violations were introduced in reviewed interfaces/stubs.

2. **Tool contract quality (4 tools):** PASS
   - All four tools are clearly defined in architecture/design docs with inputs, outputs, limits, and failure modes:
     - `browser_get_page_map`
     - `browser_inspect_element`
     - `browser_get_dom_excerpt`
     - `browser_capture_region`
   - Relay action union and browser relay action union include all required action names.

3. **Context-budget strategy:** PASS
   - Explicit token/size guidance exists in both design and architecture docs.
   - Anti-patterns + recommended flow are documented and coherent with the capture-region rationale.

4. **No implementation leakage (Phase A stubs only):** PASS
   - New page-understanding/capture handlers in:
     - `packages/browser-extension/src/relay-actions.ts`
     - `packages/browser/src/page-understanding-tools.ts`
     are stubbed with `throw new Error("not implemented")` as expected for Phase A.
   - Existing legacy actions remain implemented; only new actions are stubbed.

5. **Requirements/docs consistency + traceability:** PASS
   - `docs/architecture.md` includes §14 (page understanding) + §14.5 (capture region) and §15 future reservation, matching requirements and design refs.
   - `docs/requirements-browser-extension.md` includes §3.15 and §3.18 with module mapping for M90/M91/M92.
   - `docs/requirements-comments.md` includes enhanced-anchor acceptance note for browser anchors.

### Verification notes
- Type-check spot check ran clean for reviewed packages:
  - `packages/browser`: `pnpm exec tsc --noEmit`
  - `packages/browser-extension`: `pnpm exec tsc --noEmit`

### Non-blocking observations (can be cleaned in B/C)
- In `packages/browser-extension/src/relay-actions.ts`, inline requirement comments above new stubs use PU IDs that appear mismatched to the requirements table (comment-only traceability drift; no runtime impact).

### Approval for Phase B (test-builder)
- Approved to proceed with failing tests for:
  - Relay action routing/contract tests for `get_page_map`, `inspect_element`, `get_dom_excerpt`, `capture_region`
  - MCP tool registration + handler-forwarding tests for all 4 tools
  - Error contract tests (`browser-not-connected`, `timeout`, `action-failed`, structured capture-region errors)
  - Context-limit and bounds/size-limit behavior tests per §3.15/§3.18
