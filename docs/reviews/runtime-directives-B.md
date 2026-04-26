## Review — runtime-directives — Phase B

### Scope reviewed

- `packages/hub/src/__tests__/mcp-dispatch-runtime-directives-handler.test.ts`
- `packages/hub/src/__tests__/mcp-dispatch-runtime-directives-initialize.test.ts`
- `packages/hub/src/__tests__/mcp-dispatch-runtime-directives-receipts.test.ts`
- `packages/hub/src/__tests__/prompt-engine-runtime-directives-bundle.test.ts`
- `packages/hub/src/__tests__/prompt-engine-runtime-directives-initialize.test.ts`
- `packages/hub/src/__tests__/prompt-engine-runtime-directives-instructions.test.ts`
- `packages/hub/src/__tests__/runtime-directives-contract-structure.test.ts`
- `packages/hub/src/__tests__/runtime-directives-contract-stub.test.ts`
- `packages/hub/src/__tests__/runtime-directives-contract-traceability.test.ts`
- `packages/hub/src/__tests__/runtime-directives-diagnostics-catalog.test.ts`
- `packages/hub/src/__tests__/runtime-directives-diagnostics-receipts.test.ts`
- `packages/hub/src/__tests__/runtime-directives-endpoints-auth.test.ts`
- `packages/hub/src/__tests__/runtime-directives-endpoints-publication.test.ts`
- `packages/hub/src/__tests__/runtime-directives-endpoints-diagnostics.test.ts`
- `packages/hub/src/__tests__/runtime-directives-parity-initialize.test.ts`
- `packages/hub/src/__tests__/runtime-directives-parity-tooldesc.test.ts`
- `packages/hub/src/__tests__/runtime-directives-parity-validate.test.ts`
- `packages/hub/src/__tests__/runtime-directives-fixtures.ts`
- `packages/editor/src/__tests__/runtime-directives-tool-description-parity-contradiction.test.ts`
- `packages/editor/src/__tests__/runtime-directives-tool-description-parity-references.test.ts`
- `packages/editor/src/__tests__/runtime-directives-tool-description-parity-reinforcement.test.ts`
- `packages/editor/src/__tests__/runtime-directives-fixtures.ts`

### Check summary

- Endpoint-suite split for auth/publication/diagnostics: PASS
- Missing/invalid auth exact 401 checks: PASS
- Valid-auth status strictness: FAIL
- Authenticated publication/diagnostics payload depth: FAIL
- Canonical-source-driven tool-description parity: FAIL
- Implemented-reference-set validation: FAIL
- Modularity (iron rule): FAIL

## FAIL

### Blockers — must fix before Phase C

- `packages/hub/src/__tests__/runtime-directives-fixtures.ts:1` — Modularity gate failed. This file is 229 lines and bundles multiple responsibilities (canonical clauses, publication fixtures, mock catalog, receipt fixtures, IDE fixture, implemented-doc set), which is an automatic blocker under the iron rule. — **Done when:** split this file into focused test-support modules, each `<=150` lines and single-responsibility (for example: canonical clauses/publication, mock catalog, receipt fixtures, implemented-doc references).

- `packages/hub/src/__tests__/runtime-directives-endpoints-publication.test.ts:109` and `packages/hub/src/__tests__/runtime-directives-endpoints-diagnostics.test.ts:109` — Y-07 valid-auth endpoint tests still allow `404` to pass via `expect([200, 404])`. That keeps missing routing from producing the required red failure on the publication/diagnostics seams. — **Done when:** authenticated success-path tests assert the exact required `200` status and fail immediately if routing is absent; no `[200, 404]` fallback remains.

- `packages/hub/src/__tests__/runtime-directives-endpoints-publication.test.ts:111` and `packages/hub/src/__tests__/runtime-directives-endpoints-diagnostics.test.ts:111` — Authenticated payload validation is still conditional and incomplete. Publication coverage only runs if status already happens to be `200`, only checks partial ownership, and does not assert canonical ordered clauses/parity as required by Y-07. Diagnostics coverage likewise only runs conditionally, allows a non-canonical `"diagnostics"` channel, and does not prove a deterministic receipt set with session/agent/channel/version/digest/timestamp parity. — **Done when:** the publication test unconditionally parses the successful `200` payload and asserts exact canonical publication content (bundle version, digest, ordered clause IDs/content, ownership). The diagnostics test unconditionally asserts the same publication payload plus deterministic receipt entries with exact expected fields and canonical delivery channels.

- `packages/editor/src/__tests__/runtime-directives-fixtures.ts:4`, `packages/editor/src/__tests__/runtime-directives-tool-description-parity-reinforcement.test.ts:17`, and `packages/editor/src/__tests__/runtime-directives-tool-description-parity-contradiction.test.ts:17` — Canonical-source-driven tool-description parity is still not in place. Editor parity tests rely on a mirrored local fixture (`"Minimal mirror of hub canonical clauses"`) instead of a single approved canonical seam, so hub/editor drift can still pass if both mirrors change together. The assertions also remain largely clause-existence / keyword checks rather than clause-target coverage against the tool descriptions themselves. — **Done when:** editor parity tests consume one shared canonical clause/reference source (or approved shared contract seam) used across packages, and assert requirement-linked coverage/mismatch for the declared tool-description parity targets rather than only checking for non-empty clauses or forbidden phrases.

- `packages/hub/src/__tests__/runtime-directives-parity-validate.test.ts:62` and `packages/editor/src/__tests__/runtime-directives-tool-description-parity-references.test.ts:30` — Implemented-reference-set validation is still not operational. The hub parity-validation test still accepts any mock-shaped report without asserting `ok:false` / `missing-reference` behavior for stale references, and the editor reference test only validates refs if any are present, so a zero-reference state still vacuously passes. — **Done when:** parity/reference tests construct explicit stale and missing `accordo://docs/*` cases against the implemented reference set, assert requirement-linked failures (`ok:false` with `missing-reference` or contradiction issues), and also prove that implemented references pass only when they are present in the canonical implemented set.

### Reviewer signal

Phase B is **not approved**.
