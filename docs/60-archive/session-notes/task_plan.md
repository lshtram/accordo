# Task Plan

## Goal
Implement TDD Phase 1 for the generic spatial diagram architecture groundwork in `packages/diagram` without rewriting the extension.

## Scope
- Type-system and schema groundwork for generic spatial diagram support
- Dynamic unsupported-type error messaging in Mermaid adapter
- Backward-compatible `LayoutStore` metadata support
- Sequence remains explicitly unsupported in this initiative

## Phases
- [x] Phase A — Architecture direction approved by user
- [ ] Phase B — Write failing tests for Phase 1 groundwork
- [ ] Phase B2 — Demonstrate failing tests and request approval
- [ ] Phase C/D — Implement minimal code to green
- [ ] Phase D3 — Testing guide
- [ ] Phase E — Present summary for approval

## Phase 1 Requirements
1. `ParsedDiagram.direction` supports omission for non-directional spatial types.
2. `NodeShape` explicitly includes `stateStart` and `stateEnd`.
3. `ExcalidrawElement.type` explicitly includes `line` and `freedraw`.
4. `LayoutStore` supports optional `metadata` without breaking v1.0 files.
5. Unsupported diagram-type error text is derived dynamically from registered parsers.
6. Sequence diagrams remain unsupported.

## Risks
- Type-level expectations may need runtime tests to lock in behavior.
- Existing tests may already assume current hardcoded unsupported-type message.
- Changes must not break current layout file round-tripping.
