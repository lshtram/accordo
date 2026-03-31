# Review — patch-handler-placeNodes — Phase B (Test Coverage)

**Date:** 2026-03-31  
**Module:** `patchHandler` + `placeNodes` integration (bug fix: F-7 / unplaced nodes not resolved in tool path)  
**Reviewer:** Reviewer agent  
**Status:** ❌ FAIL — test coverage for new behaviour is absent

---

## Summary

The implementation (`types.ts` + `reconciler.ts` + `diagram-tool-ops.ts`) is complete and all 515 existing tests pass. However, **no new tests were written for the new `placeNodes()` call in `patchHandler`**. The bugfix introduces new observable behaviour that is entirely uncovered by tests DT-01..DT-52.

---

## Test Existence Check

| Requirement | Expected test IDs | Found in test file? |
|---|---|---|
| New nodes added via `content` end up in `layout.nodes` (not `unplaced[]`) | DT-53 | ❌ Missing |
| `layout.unplaced[]` is empty in written `layout.json` after adding new nodes | DT-54 | ❌ Missing |
| Newly placed node does not overlap an existing positioned node | DT-55 | ❌ Missing |
| Two new nodes added in same patch do not overlap each other | DT-56 | ❌ Missing |
| Node with explicit `nodeStyles.x/y` override is NOT moved by `placeNodes()` | DT-57 | ❌ Missing |
| `layout.unplaced[]` is empty even when no node additions occur (no regression) | DT-58 | ❌ Missing |
| `reconcileResult.diagram` is a valid `ParsedDiagram` with correct node count | DT-59 | ❌ Missing |

---

## Coverage Gap Analysis

### Gap 1 — `unplaced[]` cleared in written layout (HIGH)

The core bug fix is that `unplaced[]` is no longer persisted to disk. Zero tests
verify that the written `layout.json` has `unplaced: []` after a patch that adds nodes.

**Closest existing test:** DT-30 checks `changes.nodesAdded` in the returned result —
but never reads the written `layout.json` to verify `unplaced`.

### Gap 2 — New nodes appear in `layout.nodes` with x/y/w/h (HIGH)

No test verifies that new nodes (those in `changes.nodesAdded`) appear in
`layout.nodes` with non-zero coordinates in the written `layout.json`. Without this,
a silent regression where `placeNodes` is skipped or fails would go undetected.

### Gap 3 — nodeStyles x/y + new node interaction (MEDIUM)

The `trueUnplaced` filter (line 339–341 in `diagram-tool-ops.ts`) is an edge-case fix
from the review doc (§3.1). It ensures that a node explicitly positioned via `nodeStyles`
while also being new (i.e., in `unplaced[]`) is not overwritten by `placeNodes()`.
This code path has zero test coverage.

### Gap 4 — `unplaced[]` cleared even when all unplaced were pre-positioned (MEDIUM)

The `else if (finalLayout.unplaced.length > 0)` branch (line 357–359) handles the case
where `trueUnplaced` is empty but `unplaced[]` is still non-empty (all were placed via
`nodeStyles`). This branch has zero test coverage.

### Gap 5 — `reconcileResult.diagram` threading (LOW)

The `diagram: ParsedDiagram` field added to `ReconcileResult` is now always populated.
One test confirming that `reconcile()` returns a `diagram` field with the correct node
count would guard against future type changes that accidentally make it optional.

---

## Error Path Coverage — Existing Tests

| Error path | Test | Status |
|---|---|---|
| `placeNodes` called with empty `trueUnplaced` → no-op | None | ❌ Missing (DT-58 needed) |
| `placeNodes` skipped when `reconcileResult.diagram` is present but `trueUnplaced` is empty | None | ❌ Missing |

---

## Verdict

❌ **FAIL** — Phase B test coverage is insufficient for the new behaviour.

**Required before Phase D2 can proceed:**

Tests DT-53 through DT-58 must be written and must **fail before the fix** (or at minimum
must fail against a version of `patchHandler` that does not call `placeNodes()`).

Since the implementation is already merged (the fix was applied before tests were written),
the test-builder must write tests that would fail if the `placeNodes()` block were removed
from `patchHandler`. This is an implementation-before-test exception, which requires the
reviewer sign-off that the tests adequately describe the expected contract.

### Minimum required tests

```
DT-53: patchHandler — new node added via 'content' appears in layout.nodes with x/y/w/h
DT-54: patchHandler — unplaced[] is empty in written layout.json after adding new nodes
DT-55: patchHandler — newly placed node does not overlap an existing positioned node
DT-56: patchHandler — two new nodes added together do not overlap each other
DT-57: patchHandler — nodeStyles x/y override for a new node is not overwritten by placeNodes
DT-58: patchHandler — unplaced[] is empty in written layout.json when no new nodes were added
```

DT-59 (`reconcileResult.diagram` threading) is optional — it tests internal reconciler
behaviour that is already indirectly covered by DT-53/DT-54 (which depend on `diagram`
being correctly threaded).

---

## Action Required

**test-builder:** Write DT-53..DT-58 in `packages/diagram/src/__tests__/diagram-tools.test.ts`.
Update the file header comment to list the new range.

Each test must:
1. Set up a diagram with an existing layout (at least one positioned node)
2. Patch with new content that adds one or more new nodes
3. Read the written `layout.json` and assert on the observable outcome

Return to reviewer after tests are written and `pnpm test` is green.
