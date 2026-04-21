# Diagram Module Cleanup Plan

## A. Must update

### `docs/module-map-diagram.md`
- [ ] Rewrite the module map to match the actual current package layout
- [ ] Remove references to non-existent files such as:
  - `parser/types.ts`
  - `parser/reconcile.ts`
  - `parser/layout.ts`
  - `canvas/generator.ts`
  - `canvas/scene-adapter.ts`
  - `layout-store/types.ts`
  - `layout-store/v1.ts`
- [ ] Update the composition-root description to current reality
- [ ] Reconcile the command/tool inventory and VS Code integration story with current code
- [ ] Fix stale “only `webview/panel.ts` imports vscode” claims

### `docs/20-requirements/requirements-diagram.md`
- [ ] Update implementation-status totals to current reality (latest test count is 1015 passing)
- [ ] Remove stale “additional parsers not started” claims for already-implemented parser families
- [ ] Reconcile open-items section with actual shipped state:
  - state diagram parser exists
  - class diagram parser exists
- [ ] Review all “completed” evidence rows for stale test counts/commits where necessary
- [ ] Update architecture-reference wording if `v4.2` is no longer the canonical current version label

### `docs/20-requirements/README.md`
- [ ] Change package classification from `accordo-editor` (diagram module) to `accordo-diagram`
- [ ] Ensure the requirements index points to the correct package identity and scope

### `docs/10-architecture/diagram-architecture.md`
- [ ] Reconcile command list with current actual command ids and extension contributions
- [ ] Update any sections that still describe older panel/message flows or outdated file ownership
- [ ] Verify current focus-thread/navigation story is aligned with actual command constants and comments integration

### `docs/10-architecture/architecture.md`
- [ ] Reconcile diagram focus-thread command naming and ownership with current code/constants
- [ ] Ensure top-level architecture text matches the actual comments-router/diagram integration path

## B. High-priority code/comment cleanup

### `packages/diagram/src/extension.ts`
- [ ] Remove stale source references to archived docs (`diag_workplan.md`, `diag_arch_v4.2.md`)
- [ ] Replace them with current canonical requirements/architecture references
- [ ] Review the 2-second focus-thread wait path and document whether it is intended temporary synchronization strategy or a candidate for stronger event-driven coordination

### `packages/diagram/src/layout/layout-store.ts`
- [ ] Remove stale code comments pointing at archived architecture/workplan docs
- [ ] Ensure comments describe current layout-store behavior, not historical design phases

### `packages/diagram/src/webview/panel-state.ts`
- [ ] Remove/update stale references to archived diagram docs

### `packages/diagram/src/layout/layout-debug.ts`
- [ ] Remove any remaining `// DEBUG:` or “remove before shipping” notes if permanent instrumentation is now intended product behavior
- [ ] Clarify permanent gated-debug policy in comments/docs

## C. Real behavior / test follow-up candidates

### State upstream placement follow-up
- [ ] Address remaining issues called out in `diag-2-6-upstream-placement-D2.md` if still unfixed:
  - pseudostate identity reachability (`SUP-S02`)
  - cluster normalization convention mismatch (`SUP-S03`)
  - stronger assertion-level tests for pseudostate upstream coordinates

### Flowchart/state fidelity follow-up
- [ ] Revisit review findings around HTML decoding assertions and arrow-cross documentation if not yet reflected in source/tests
- [ ] Reconcile fidelity batch review findings with current test coverage and code status

### Comment focus / navigation path
- [ ] Confirm the current `accordo_diagram_focusThread` path is canonical and consistently documented across comments/capabilities/diagram docs
- [ ] Add or refresh regression coverage if diagram panel-open + thread-focus timing remains sensitive

## D. Test/doc cleanup

### Testing guides
- [ ] Refresh active testing guides to current counts and current paths:
  - `testing-guide-diagram-update-plan.md`
  - `testing-guide-diagram-state-upstream-placement.md`
  - `testing-guide-diagram-parser-placement-hardening.md`
  - `testing-guide-diagram-flowchart-fidelity-batch1.md`
  - `testing-guide-diagram-flowchart-fidelity-batch2.md`
  - `testing-guide-priority-p.md`
- [ ] Fix broken guide paths such as references to non-existent `packages/diagram/demo/`
- [ ] Decide which testing guides are still active vs historical batch artifacts

### Review/test wording cleanup
- [ ] Remove stale “not started / stub / phase-only” wording where code is now shipped
- [ ] Mark older batch reviews as historical once superseded by newer implementation status

## E. Tooling / repo hygiene

### `packages/diagram/package.json`
- [ ] Replace placeholder lint script with real linting
- [ ] Reconcile dependency pinning docs with actual package versions (e.g. Mermaid 11.12.3)

### Generated/package-local artifacts
- [ ] Confirm `packages/diagram/dist/**` is treated as generated output only
- [ ] Clean or ignore `tsconfig.tsbuildinfo`
- [ ] Clean or ignore package-local Vitest result artifacts under `node_modules/.vite/vitest/`

### Package scripts
- [ ] Review helper/debug scripts in `packages/diagram/scripts/` and document which are canonical developer utilities vs one-off research tools

## F. Documentation / archive cleanup

### Active docs to refresh or demote
- [ ] `docs/30-development/diagram-update-plan.md` — likely superseded by newer batch-specific plans
- [ ] `docs/testing-guide-diagram-update-plan.md` — likely paired to the older umbrella plan
- [ ] overlapping style-persistence reviews across active and archive trees should be clarified or consolidated

### Historical docs to archive harder or mark clearly
- [ ] old state/class diagram review chains in `docs/60-archive/`
- [ ] old architecture/workplan docs in `docs/90-archive/`
- [ ] historical handoff docs like `handoff-B3-voice-diagram-editor.md`

## G. Cross-module contract cleanup

### Diagram ↔ comments ↔ capabilities contract
- [ ] Align diagram focus-thread command naming and docs across:
  - `packages/diagram`
  - `packages/comments`
  - `packages/capabilities`
  - top-level architecture docs
- [ ] Ensure surface type / node-anchor terminology is consistent in bridge-types/comments/diagram docs

### Diagram package identity across repo
- [ ] Ensure all docs stop classifying diagram as part of `accordo-editor`
- [ ] Normalize package naming to `accordo-diagram` everywhere active docs mention it

## Recommended execution order
1. rewrite `module-map-diagram.md`
2. update `requirements-diagram.md`
3. fix package identity in requirements index and top-level architecture docs
4. remove stale archived-doc references from code comments
5. refresh active testing guides and broken path examples
6. review unresolved upstream-placement/fidelity findings
7. replace placeholder lint step and clean archive/review sprawl
