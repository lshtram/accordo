## Review — browser redaction/privacy consistency — issue #4

### Findings

- High — `docs/20-requirements/requirements-browser-mcp.md:90-92` still says **all** `capture_region` responses must emit `redactionWarning: "screenshots-not-subject-to-redaction-policy"` whenever a `RedactionPolicy` exists, but `docs/20-requirements/requirements-browser-mcp.md:201-202` now says explicit `redactPII:false` suppresses screenshot redaction attempts and omits that warning. **Done when:** MCP-VC-005 and MCP-SEC-005 are reconciled so the requirements document expresses one capture-warning contract, including the explicit-`false` carveout if that is the intended behavior.

### Verification notes

- Runtime review of changed handlers shows the four pipeline-based read tools now gate redaction on `args.redactPII === true`:
  - `packages/browser/src/text-map-tool-handler.ts:75-84`
  - `packages/browser/src/page-tool-page-map-handler.ts:65-78`
  - `packages/browser/src/page-tool-inspect-handler.ts:47-56`
  - `packages/browser/src/page-tool-dom-excerpt-handler.ts:47-56`
- `packages/browser/src/page-tool-capture-handler.ts:31-35,71-73` now treats explicit `redactPII:false` as an intentional screenshot opt-out and no longer emits the screenshot-warning in that case.
- Focused test runs passed:
  - `packages/browser`: `pnpm test -- --run src/__tests__/read-tool-redaction-contract.test.ts src/__tests__/capture-redaction-warning.test.ts src/__tests__/security-tool-integration.test.ts src/__tests__/security-redaction.test.ts`
  - `packages/browser-extension`: `pnpm test -- --run tests/relay-privacy.test.ts`
- Additional typecheck note:
  - `packages/browser`: `pnpm typecheck` ✅
  - `packages/browser-extension`: `pnpm typecheck` ❌ due to unrelated pre-existing errors in `src/relay-tab-handlers.ts:42-51`

### Verdict

- Not approved for issue #4 yet because the requirements document still contains a contradictory capture-warning contract.
