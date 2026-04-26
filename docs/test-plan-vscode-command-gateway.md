# Test Plan — vscode-command-gateway (Phase B)

**Module:** `accordo_vscode_command_list` + `accordo_vscode_command_execute`
**Phase:** B (stubs only — no real VSCode/editor implementation)
**Location:** `packages/editor/src/__tests__/`, `packages/hub/src/__tests__/`

---

## 1. Editor Test Files (Unit — PASS-ELIGIBLE-IN-B)

All invoke `createVscodeCommandGateway` with mocked deps. Stub contract is the spec.

| File | Lines | Reqs |
|---|---|---|
| `vscode-command-list.test.ts` | 117 | M75-VCG-02/03/06 |
| `vscode-command-list-validation.test.ts` | 66 | M75-VCG-16 (list-side) |
| `vscode-command-list-description.test.ts` | 118 | M75-VCG-04/05/07/07a/17/18 |
| `vscode-command-execute-core.test.ts` | 106 | M75-VCG-08/09/16 |
| `vscode-command-execute-policy.test.ts` | 108 | M75-VCG-10/11 |
| `vscode-command-execute-confirm.test.ts` | 105 | M75-VCG-12 |
| `vscode-command-execute-results.test.ts` | 113 | M75-VCG-14 |
| `vscode-command-execute-audit.test.ts` | 94 | M75-VCG-15 |
| `vscode-command-execute-deny.test.ts` | 67 | M75-VCG-13 |
| `vscode-command-gateway.test.ts` | 87 | M75-VCG-01/08 (structural) |

## 2. Hub E2E Harness Files (not test files)

| File | Lines | Purpose |
|---|---|---|
| `vscode-command-e2e-harness.ts` | 31 | Server lifecycle + re-exports |
| `vscode-command-e2e-sim.ts` | 63 | VSCode sim catalog + response builders |
| `vscode-command-e2e-transport.ts` | 90 | StubBridge + McpSession |

## 3. Hub E2E Test Files (gated: ACCORDO_E2E_LIVE=1)

Default CI: all skipped. Phase C signals when run with `ACCORDO_E2E_LIVE=1`.

| File | Lines | Reqs |
|---|---|---|
| `vscode-command-list-e2e.test.ts` | 137 | E2E-VCG-01/02/03/04/05/06/16 |
| `vscode-command-execute-e2e.test.ts` | 124 | E2E-VCG-07/08/10/13/14/15 |
| `vscode-command-policy-e2e.test.ts` | 122 | E2E-VCG-09/11/12 |

---

## 4. Requirement Coverage Map

### Unit Tests — Editor Package

| ID | Requirement | Test File(s) | Phase B Status |
|---|---|---|---|
| M75-VCG-01 | list tool registered | `vscode-command-gateway.test.ts` | PASS-ELIGIBLE-IN-B |
| M75-VCG-02 | bounded, paginated list | `vscode-command-list.test.ts` | PASS-ELIGIBLE-IN-B |
| M75-VCG-03 | includeInternal filtering | `vscode-command-list.test.ts` | PASS-ELIGIBLE-IN-B |
| M75-VCG-04 | policy metadata per command | `vscode-command-list-description.test.ts` | PASS-ELIGIBLE-IN-B |
| M75-VCG-05 | preferredTool guidance | `vscode-command-list-description.test.ts` | PASS-ELIGIBLE-IN-B |
| M75-VCG-06 | auditable, returns auditId | `vscode-command-list.test.ts` | PASS-ELIGIBLE-IN-B |
| M75-VCG-07 | Runtime description — prefer first-class | `vscode-command-list-description.test.ts` | PASS-ELIGIBLE-IN-B |
| M75-VCG-07a | MCP-visible docs resources in description | `vscode-command-list-description.test.ts` | PASS-ELIGIBLE-IN-B |
| M75-VCG-08 | tool definitions align with catalog | `vscode-command-execute-core.test.ts` | PASS-ELIGIBLE-IN-B |
| M75-VCG-09 | executor called with command+args | `vscode-command-execute-core.test.ts` | PASS-ELIGIBLE-IN-B |
| M75-VCG-10 | policy classifies before execution | `vscode-command-execute-policy.test.ts` | PASS-ELIGIBLE-IN-B |
| M75-VCG-11 | deny blocks execution | `vscode-command-execute-policy.test.ts` | PASS-ELIGIBLE-IN-B |
| M75-VCG-12 | confirm requires matching payload | `vscode-command-execute-confirm.test.ts` | PASS-ELIGIBLE-IN-B |
| M75-VCG-13 | accordo_* denied with preferredTool | `vscode-command-execute-deny.test.ts` | PASS-ELIGIBLE-IN-B |
| M75-VCG-14 | result normalization | `vscode-command-execute-results.test.ts` | PASS-ELIGIBLE-IN-B |
| M75-VCG-15 | audit logging | `vscode-command-execute-audit.test.ts` | PASS-ELIGIBLE-IN-B |
| M75-VCG-16 | invalid args return INVALID_ARGUMENT | `vscode-command-list-validation.test.ts`, `vscode-command-execute-core.test.ts` | PASS-ELIGIBLE-IN-B |
| M75-VCG-17 | additive gateway — no replaces/deprecated | `vscode-command-list-description.test.ts` | PASS-ELIGIBLE-IN-B |
| M75-VCG-18 | server instructions point to MCP docs | `vscode-command-list-description.test.ts` | PASS-ELIGIBLE-IN-B |

### E2E Tests — Hub Package (LIVE-ONLY, ACCORDO_E2E_LIVE=1)

| ID | Requirement | Test File |
|---|---|---|
| E2E-VCG-01 | list tool registered via MCP | `vscode-command-list-e2e.test.ts` |
| E2E-VCG-02 | bounded pagination via MCP | `vscode-command-list-e2e.test.ts` |
| E2E-VCG-03 | includeInternal via MCP | `vscode-command-list-e2e.test.ts` |
| E2E-VCG-04 | policy metadata via MCP | `vscode-command-list-e2e.test.ts` |
| E2E-VCG-05 | preferredTool via MCP | `vscode-command-list-e2e.test.ts` |
| E2E-VCG-06 | auditId in list response | `vscode-command-list-e2e.test.ts` |
| E2E-VCG-07 | execute tool registered via MCP | `vscode-command-execute-e2e.test.ts` |
| E2E-VCG-08 | execute round-trip via WS bridge | `vscode-command-execute-e2e.test.ts` |
| E2E-VCG-09 | deny returns POLICY_DENIED, no bridge invoke | `vscode-command-policy-e2e.test.ts` |
| E2E-VCG-10 | accordo_* denied via MCP | `vscode-command-execute-e2e.test.ts` |
| E2E-VCG-11 | confirm without payload → POLICY_CONFIRMATION_REQUIRED | `vscode-command-policy-e2e.test.ts` |
| E2E-VCG-12 | confirm with confirmed:true allows execution | `vscode-command-policy-e2e.test.ts` |
| E2E-VCG-13 | structured result kind | `vscode-command-execute-e2e.test.ts` |
| E2E-VCG-14 | auditId in execute response | `vscode-command-execute-e2e.test.ts` |
| E2E-VCG-15 | missing command → INVALID_ARGUMENT | `vscode-command-execute-e2e.test.ts` |
| E2E-VCG-16 | invalid offset/limit → INVALID_ARGUMENT | `vscode-command-list-e2e.test.ts` |

---

## 5. PASS-ELIGIBLE-IN-B Rationale

All unit tests invoke the `createVscodeCommandGateway` factory with mocked dependencies.
The stub implements the contract deterministically — deny short-circuit, confirm payload check,
audit write, result normalization, arg validation — and these are verified in Phase B against
the stub. Phase C replaces the stub with a real implementation producing identical results.

The E2E tests are gated LIVE-ONLY and are skipped in default CI.

---

## 6. Determinism

All audit IDs use fixed string literals (e.g., `"audit-list-1"`, `"audit-exec-fixed"`) — no `Date.now()`.
Cross-test pollution prevented by per-test `bridge.clearInvokes()` and per-describe registration.

---

## 7. No Placeholder Tests

All tests contain real assertions. E2E gated via `describe.skip` when `ACCORDO_E2E_LIVE !== "1"`.
No `expect(true).toBe(true)` patterns remain.
