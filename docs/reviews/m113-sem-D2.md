## Review — M113-SEM — Phase D2 (Re-review)

### Verdict
**PASS**

### Resolution status for previous findings
- ✅ **Resolved (HIGH)** B2-SG-009 visibility filtering now applies to all sub-trees:
  - `collectSemanticGraph()` passes `visibleOnly` into `extractLandmarks`, `extractOutline`, `extractForms`.
  - Extractors enforce hidden filtering (`semantic-graph-landmarks.ts`, `semantic-graph-outline.ts`, `semantic-graph-forms.ts`).
- ✅ **Resolved (HIGH)** B2-SG-003 landmark role whitelist:
  - `LANDMARK_ROLES` allowlist introduced and enforced in `resolveLandmarkRole()`.
  - Non-landmark explicit roles are excluded.
- ✅ **Resolved (HIGH)** B2-SG-014 implicit role mapping:
  - `<search>` mapping added.
  - `<section>` maps to `region` only when labelled (`hasAccessibleLabel`).
- ✅ **Resolved (MEDIUM)** Tool type-safety hardening:
  - Added `narrowArgs()` and `narrowSemanticGraphResponse()` runtime guards.
  - Handler now narrows unknown input/payload before use.
- ✅ **Resolved (MEDIUM)** Code size/complexity:
  - Collector split into focused modules (`*-helpers`, `*-a11y`, `*-landmarks`, `*-outline`, `*-forms`, `*-types`).
- ✅ **Resolved (MEDIUM)** Lint gate coverage for scoped source files:
  - `browser-extension` lint now targets `src/content/semantic-graph-*.ts`.
  - `browser` lint now includes `src/semantic-graph-tool.ts`.
- ✅ **Resolved (MEDIUM)** Test adequacy gaps:
  - Added negative landmark-role tests (`role=button/dialog/alert` excluded).
  - Added visibility filtering tests for landmarks/outline/forms/hidden fields.
  - Added `<search>` and labelled/unlabelled/titled `<section>` mapping tests.

### Gate evidence (executed)
- **Tests**
  - `pnpm --filter browser-extension test -- tests/semantic-graph-collector.test.ts`
    - Result: **33 files, 751 tests passing, 0 failures** (includes `semantic-graph-collector.test.ts`: 87 passing)
  - `pnpm --filter accordo-browser test -- src/__tests__/semantic-graph-tool.test.ts`
    - Result: **16 files, 366 tests passing, 0 failures**

- **Typecheck**
  - `pnpm --filter browser-extension typecheck` ✅ clean
  - `pnpm --filter accordo-browser typecheck` ✅ clean

- **Lint (scoped files)**
  - `pnpm --filter browser-extension lint` ✅ clean (semantic-graph source files)
  - `pnpm --filter accordo-browser lint` ✅ includes `src/semantic-graph-tool.ts` (clean for scoped file; unrelated warnings exist in `src/eval-harness.ts`)

### Requirement coverage matrix (B2-SG-001..015)
| Requirement | Status | Evidence |
|---|---|---|
| B2-SG-001 Unified semantic graph response | ✅ | Collector returns `a11yTree/landmarks/outline/forms`; tests assert all present |
| B2-SG-002 Accessibility tree snapshot | ✅ | `semantic-graph-a11y.ts`; role/name/level/nodeId/children tests |
| B2-SG-003 Landmark extraction | ✅ | Landmark allowlist + positive/negative landmark tests |
| B2-SG-004 Document outline | ✅ | `semantic-graph-outline.ts`; heading order/levels/id tests |
| B2-SG-005 Form model extraction | ✅ | `semantic-graph-forms.ts`; field details/labels/required tests |
| B2-SG-006 Shared per-call nodeId scope | ✅ | `NodeIdRegistry`; cross-tree nodeId consistency tests |
| B2-SG-007 Snapshot envelope compliance | ✅ | Envelope capture + tool validation + retention tests |
| B2-SG-008 maxDepth | ✅ | Clamp/default/limit behavior tests |
| B2-SG-009 Visibility filtering | ✅ | Hidden exclusion tests across all four sub-trees |
| B2-SG-010 Performance budget | ✅ | Constant + ~5000-node completion test under 15s |
| B2-SG-011 Tool registration | ✅ | Name/schema/dangerLevel/idempotent tests |
| B2-SG-012 Backward compatibility | ✅ | Additive action/tool registration tests |
| B2-SG-013 Password redaction | ✅ | Exact `"[REDACTED]"` assertions |
| B2-SG-014 Implicit ARIA role mapping | ✅ | `search`, labelled/unlabelled section tests |
| B2-SG-015 Empty sub-trees | ✅ | Empty-page and no-form assertions (`[]`, never absent) |

### Test adequacy assessment
- Requirement-to-test traceability for B2-SG-001..015 is now complete.
- Edge/negative cases added for the previously uncovered behavior.
- Tests remain independent (`beforeEach/afterEach` reset DOM + globals).

### Constraints / residual risk note
- Full deployed cross-process E2E (`tools/list` + real live browser call through full stack) was not executed in this D2 run environment. Unit/integration-style runtime boundary tests are present and passing; residual risk is limited to deployment wiring/runtime environment differences.

### Security/static-analysis note
- `semgrep` and `codeql` CLIs are unavailable in this environment (`command not found`), so those deep scans could not be run in this review execution.
