# Test Plan — Runtime Directives Source-of-Truth

**Module:** Priority Y — MCP Runtime Directives Source-of-Truth  
**Phase A status:** design/stubs only

---

## 1. Traceability matrix

| Requirement | Planned verification | Phase |
|---|---|---|
| Y-01 | bundle builder test proves exactly one canonical bundle source is exported | B/C |
| Y-02 | `initialize` test asserts stable `## Runtime Directives` section with bundle version/digest | B/C |
| Y-03 | `/instructions` test asserts same clause IDs/order/version/digest as initialize | B/C |
| Y-04 | prompt test proves mandatory clauses are present without requiring repo-local references | B/C |
| Y-05 | tool-description parity tests assert reinforcement language does not contradict canonical clauses | B/C |
| Y-06 | contract test validates version/digest surface in `/runtime-directives`, diagnostics JSON, and rendered prompt metadata | B/C |
| Y-07 | router/server tests validate authenticated `/runtime-directives` and `/runtime-directives/diagnostics` endpoint payloads, including ownership metadata and publication parity | B/C |
| Y-08 | delivery-receipt tests validate session/channel/version/digest/timestamp capture | B/C |
| Y-09 | parity checker test fails on missing clause across initialize/instructions/tool-description targets | B/C |
| Y-10 | parity checker test fails on unimplemented runtime-doc references | B/C |
| Y-11 | requirements-to-clause traceability snapshot test | B/C |
| Y-12 | regression suite proves no tool execution behavior change | C/D |
| Y-13 | parity/reference validation catches stale `accordo://docs/*` claims unless backed by implementation | B/C |

---

## 2. Planned test files

### Hub

- `packages/hub/src/__tests__/runtime-directives-contract.test.ts`
- `packages/hub/src/__tests__/runtime-directives-endpoints.test.ts`
- `packages/hub/src/__tests__/runtime-directives-parity.test.ts`
- `packages/hub/src/__tests__/runtime-directives-diagnostics.test.ts`
- `packages/hub/src/__tests__/prompt-engine-runtime-directives.test.ts`
- `packages/hub/src/__tests__/mcp-dispatch-runtime-directives.test.ts`

### Editor/runtime-doc reinforcement

- `packages/editor/src/__tests__/runtime-directives-tool-description-parity.test.ts`

---

## 3. PASS-ELIGIBLE-IN-B register

| Case | Why pass-eligible on stubs |
|---|---|
| Exported contract types compile and import cleanly | Phase A stubs intentionally provide typed interfaces without behavior. |
| Stub provider throws explicit `not implemented` error | This is the correct Phase A placeholder and proves the public method exists. |
| Requirements/test-plan traceability docs are present | Documentation existence is intentional Phase A output, not missing implementation. |

---

## 4. Planned endpoint/security cases

1. `GET /runtime-directives` returns 401 when `Authorization` is missing.
2. `GET /runtime-directives` returns 401 when bearer token is invalid.
3. `GET /runtime-directives` returns publication JSON with `bundle.version`, `bundle.digest`, ordered clauses, and ownership metadata.
4. `GET /runtime-directives` payload matches the directive metadata surfaced in `initialize.instructions` and `GET /instructions`.
5. `GET /runtime-directives/diagnostics` returns 401 when `Authorization` is missing.
6. `GET /runtime-directives/diagnostics` returns 401 when bearer token is invalid.
7. `GET /runtime-directives/diagnostics` returns the same publication payload as `GET /runtime-directives` plus delivery receipts.
8. Diagnostics receipts include session ID, agent hint, channel, bundle version, bundle digest, and timestamp.
9. Diagnostics parity checks fail when declared tool-description targets or runtime-doc references are missing or stale.
