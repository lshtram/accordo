## Review — diag.2.6-stateDiagram-v2-upstream-placement — Phase A

### Verdict: **FAIL**

Phase A artifacts are **not yet coherent enough** to pass the checkpoint.

### High severity — must fix before Phase B

1. **Cross-doc architecture coherence is missing for this batch**
   - `requirements-diagram.md` adds SUP-S01..SUP-S07 (`docs/20-requirements/requirements-diagram.md:217-230`), but corresponding design updates are not present in:
     - `docs/10-architecture/diagram-architecture.md` (no SUP-S/diag.2.6 section)
     - `docs/module-map-diagram.md` (no `layout-debug.ts` / `state-identity.ts` module ownership or boundary updates)
     - `docs/30-development/diagram-update-plan.md` (no explicit diag.2.6 Phase A plan/stub contract)
   - **Why this blocks A:** requirements exist without architecture-level placement and ownership updates, violating Phase A coherence expectations.
   - **Required change:** add explicit diag.2.6 design sections in those docs, including call graph and ownership boundaries (where state-specific matching hooks into existing mapper/engine pipeline).

2. **Interface coverage is incomplete for new requirements**
   - New stubs exist (`layout-debug.ts`, `state-identity.ts`), but the design contract does not yet show the integration point in the existing pipeline for state diagrams:
     - no Phase A contract in `element-mapper.ts` for dispatching to state-specific mapping
     - no Phase A contract in `excalidraw-engine.ts` / layout entrypoints documenting stateDiagram-v2 gate behavior path
   - **Why this blocks A:** not all SUP-S requirements have complete interface-level placement; signatures exist in isolation but integration contract is missing.
   - **Required change:** define and document explicit interface hooks (function signatures + dispatch conditions) in the existing engine/mapper modules, even if bodies remain `not implemented`.

### Medium severity — must tighten before checkpoint

1. **SUP-S07 is not test-ready as written**
   - Requirement text says: “SUPPORTED_TYPES includes any new shape types emitted by upstream for state diagrams” (`requirements-diagram.md:230`).
   - This is ambiguous/unbounded (“any new shape types”).
   - **Required change:** enumerate expected upstream shape types (for current pinned version) and define exact acceptance assertions.

2. **Debug instrumentation lifecycle is under-specified**
   - `layout-debug.ts` is safely gated and disabled by default (`debugEnabled = false`, `layoutDebug()` no-op unless enabled), which is good.
   - But it also embeds `// DEBUG:` and “remove before shipping” notes (`packages/diagram/src/layout/layout-debug.ts:11-14,52`), while SUP-S06 requires debug instrumentation.
   - **Required change:** clarify policy in requirements/plan: either (a) keep a permanent gated debug module, or (b) explicitly mark it temporary and define removal milestone.

### Pass checks (informational)

- `state-identity.ts` and `layout-debug.ts` are importable stubs (typed exports, no VSCode dependency leakage).
- Debug logging is currently scoped safely (default-off, structured payload, non-`console.log`).
- Stable identity model intent is preserved conceptually (state-specific pseudostate handling separated from generic label matching).

### Gate decision

**FAIL — do not proceed to Phase B yet.**

Must resolve the High items (and tighten Medium items) so Phase A has complete, testable, architecture-coherent contracts.
