# Test Plan — vscode-command-gateway selected-tool migration

**Module:** Selected first-class wrapper removals to `accordo_vscode_command_*`  
**Phase:** A design / Phase B-C execution plan  
**Requirements:** `M76-VCGM-*`, `M76-DGM-*`

---

## 1. Planned Phase B/C file touches

### Docs / planning

- `docs/00-workplan/workplan.md`
- `docs/10-architecture/architecture.md`
- `docs/10-architecture/diagram-architecture.md`
- `docs/20-requirements/requirements-editor.md`
- `docs/20-requirements/requirements-diagram.md`
- `docs/test-plan-vscode-command-gateway-migration.md`
- `skills/vscode-command-gateway/skill.md`
- `skills/diagrams/skill.md`

### Editor package

- `packages/editor/src/extension.ts`
- `packages/editor/src/tools/editor-definitions.ts`
- `packages/editor/src/tools/editor.ts`
- `packages/editor/src/tools/editor-handlers.ts`
- `packages/editor/src/tools/editor-handlers-m17.ts`
- `packages/editor/src/tools/layout.ts`
- `packages/editor/src/tools/command-shims.ts`
- `packages/editor/src/tools/vscode-command-policy.ts`
- `packages/editor/src/tools/vscode-command-tools.ts`
- `packages/editor/src/tools/vscode-command-executor.ts`
- `packages/editor/src/tools/vscode-command-contracts.ts` *(only if URI hydration contract is extracted as a formal dependency)*

### Diagram package

- `packages/diagram/src/extension.ts`
- `packages/diagram/src/tools/diagram-tool-definitions.ts`
- `packages/diagram/src/tools/diagram-tools.ts`
- `packages/diagram/src/tools/diagram-tool-ops.ts`

### Editor tests

- `packages/editor/src/__tests__/extension-register.test.ts`
- `packages/editor/src/__tests__/extension-composition.test.ts`
- `packages/editor/src/__tests__/extension-shims.test.ts`
- `packages/editor/src/__tests__/editor-definitions.test.ts`
- `packages/editor/src/__tests__/editor-handlers.test.ts`
- `packages/editor/src/__tests__/editor.test.ts`
- `packages/editor/src/__tests__/layout.test.ts`
- `packages/editor/src/__tests__/vscode-command-list-description.test.ts`
- `packages/editor/src/__tests__/vscode-command-execute-policy.test.ts`
- `packages/editor/src/__tests__/vscode-command-gateway.test.ts`

### Diagram tests

- `packages/diagram/src/__tests__/extension.test.ts`
- `packages/diagram/src/__tests__/diagram-tools.test.ts`

### Hub / runtime-doc parity

- `packages/hub/src/prompt-engine.ts`

---

## 2. Requirement → test traceability matrix

| Requirement ID | Planned verification | Phase B status |
|---|---|---|
| M76-VCGM-01 | editor tool definition/registration tests prove removed wrappers are absent | PASS-ELIGIBLE-IN-B |
| M76-VCGM-02 | layout tool definition/registration tests prove removed wrappers are absent | PASS-ELIGIBLE-IN-B |
| M76-VCGM-03 | skill/playbook snapshot test or doc assertion validates exact command IDs + sequences | PASS-ELIGIBLE-IN-B |
| M76-VCGM-04 | executor/adapter test validates path-envelope → `vscode.Uri` hydration for `revealInExplorer` | Phase C only |
| M76-VCGM-05 | migration workflow tests validate open-first sequencing for save/format path-targeted scenarios | Phase C only |
| M76-VCGM-06 | gateway policy tests validate allow vs confirm classification for migrated commands | PASS-ELIGIBLE-IN-B |
| M76-VCGM-07 | tool-description / prompt-instruction tests validate runtime-visible guidance presence | PASS-ELIGIBLE-IN-B |
| M76-VCGM-08 | command-list metadata tests validate no preferred retired wrappers remain for migrated command IDs | Phase C only |
| M76-VCGM-09 | extension composition + shim registration counts updated | PASS-ELIGIBLE-IN-B |
| M76-VCGM-10 | playbook/docs assertion validates explicit zen/fullscreen readback limitation note | PASS-ELIGIBLE-IN-B |
| M76-DGM-01 | diagram extension registration tests prove retired helper tools are absent | PASS-ELIGIBLE-IN-B |
| M76-DGM-02 | diagram extension tests prove create/patch/render remain registered | PASS-ELIGIBLE-IN-B |
| M76-DGM-03 | playbook/docs assertion validates “no direct gateway mapping” note for diagram removals | PASS-ELIGIBLE-IN-B |
| M76-DGM-04 | parser/script fallback test validates stable `{ source, type, nodes, edges, clusters, layout }` output | Phase C only |
| M76-DGM-05 | discovery fallback test validates stable `{ path, type, nodeCount }[]` output | Phase C only |
| M76-DGM-06 | runtime-doc / skill parity tests validate style-guide guidance survives tool removal | PASS-ELIGIBLE-IN-B |
| M76-DGM-07 | regression coverage keeps render precondition docs/tests intact | PASS-ELIGIBLE-IN-B |

---

## 3. PASS-ELIGIBLE-IN-B register

| Case | Why Phase B stub/removal work can satisfy it |
|---|---|
| Removed wrappers absent from tool arrays / registrations | Structural registration changes do not require live command execution |
| Policy classification for migrated command IDs | Classification is pure contract logic and can be validated against stubbed gateway deps |
| Skill/playbook contains exact command IDs, confirmation semantics, and caveats | Documentation contract is intentional Phase B/Phase A scope |
| Diagram helper tools absent while create/patch/render remain | Structural registration change only |
| Runtime descriptions / prompt text mention migration guidance | Static text assertions do not require VS Code behavior |

---

## 4. Phase C-only behavior

- `revealInExplorer` argument hydration to a real `vscode.Uri`
- Save/format path-targeted sequencing through active-editor focus
- Command-list metadata cleanup for retired `preferredTool` hints
- Stable parser/script fallback outputs for diagram discovery/introspection
- Real MCP/runtime parity across tool descriptions, prompt instructions, and operational docs

---

## 5. Done-when

1. Removed wrappers are gone from editor/diagram MCP registration and shim wiring.
2. Gateway policy/docs/playbook cover every removed scenario explicitly.
3. Diagram list/get/style-guide replacement path is documented as non-command-backed and validated.
4. Runtime-visible guidance is updated alongside the removals.
5. All affected editor + diagram package tests pass.
