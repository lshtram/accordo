# Phase B Review — stateDiagram-v2 Parser Tests

**Date**: 2026-04-04  
**Reviewer**: reviewer agent  
**Status**: CONDITIONAL PASS

---

## Summary

The Phase B test file (`state-diagram.test.ts`) covers all seven functional requirements (SD-R01..SD-R07) through 11 test groups containing 42 individual tests. The mock db structure correctly uses direct property access (`db.nodes`, `db.edges`) matching the verified Mermaid 11.4.1 API documented in §2.1. Tests fail at assertion level (not import/compile time) — confirmed by running `pnpm test` which shows 40 failures all of the form `expected false to be true` (the current adapter gate rejects `stateDiagram-v2`). One minor structural gap and one documentation ambiguity are noted below, but neither blocks Phase C.

---

## Requirement Coverage

| ID | Covered | Test Groups | Notes |
|---|---|---|---|
| SD-R01 | ✅ | SD-01, SD-07, SD-08, SD-11 | `rect → rounded` shape mapping + node extraction |
| SD-R02 | ✅ | SD-02, SD-07 | `root_start`/`root_end` nodes; `stateStart`/`stateEnd` shapes; empty label |
| SD-R03 | ✅ | SD-03, SD-07 | `isGroup===true` → cluster; `parentId` → `cluster` membership on children; composite absent from `nodes` map |
| SD-R04 | ✅ | SD-04 | Nested composite: inner cluster `parent === "active"`, outer cluster `parent === undefined` |
| SD-R05 | ✅ | SD-01, SD-05, SD-11 | `edge.label` preserved; empty-label transition; all required edge fields checked |
| SD-R06 | ✅ | SD-06, SD-09 | Parallel edges get ordinals 0/1/2; self-transition ordinal 0; declaration order preserved |
| SD-R07 | ✅ | SD-10, SD-11 | `parseMermaid()` with `stateDiagram-v2` source returns `valid:true` + correct `diagram.type`/`direction`; structure checked for downstream use |

---

## Findings

### [PASS] Finding 1: Correct failure mode — assertion level, not import level

Running `pnpm test` shows all 40 new tests fail with `expected false to be true` (the adapter gate at `adapter.ts:151` returns `valid:false` for non-flowchart types). No `TypeError`, no import failures, no TypeScript compile errors. The 2 error-handling tests (`parseMermaid — error handling`) pass correctly because they test the adapter's existing error path.

**Verdict:** ✅ All tests are appropriately red. Phase C can turn them green by implementing the parser and updating the dispatch.

---

### [PASS] Finding 2: Mock db structure matches architecture

The `MockStateDiagramDb` interface and helper functions (`makeStateNode`, `makeStateEdge`) use direct property access (`db.nodes: Array<StateNode>`, `db.edges: Array<StateEdge>`) — exactly matching the architecture's §2.1 "Critical finding" that debunks the getter-method speculation from the original architecture doc. All mock field names (`id`, `label`, `shape`, `cssClasses`, `isGroup`, `parentId`, `start`, `end`) align with the verified `StateNode`/`StateEdge` interfaces in §2.2.

---

### [PASS] Finding 3: Test structure follows established patterns

The file follows the same pattern as `parser.test.ts`:
- `vi.mock("mermaid", () => mermaidMock)` at module level
- `setMockDb()` helper called in `beforeEach` or inline per test
- Dynamic import of `parseMermaid` after `vi.mock` declaration to respect mock hoisting
- `if (!result.valid) return;` guard after the `valid` assertion (prevents misleading failure cascades)
- `describe("SD-XX: ...")` naming matches the Phase B test plan from §13

---

### [PASS] Finding 4: Assertion depth is adequate

Tests check all relevant fields documented in the requirements and architecture:
- **Node fields**: `id`, `label`, `shape`, `cluster`, `classes` (via node-classes group)
- **Edge fields**: `from`, `to`, `label`, `ordinal`, `type` (all checked in SD-11 full-fields test)
- **Cluster fields**: `id`, `label`, `members`, `parent`
- **Diagram fields**: `type`, `direction`, `nodes` (Map), `edges` (Array), `clusters` (Array), `renames` (Array)

The SD-11 tests are particularly thorough: they check `instanceof Map` for nodes, `Array.isArray` for edges/clusters/renames, and verify each required field on both a node and an edge.

---

### [PASS] Finding 5: Edge cases covered

- **Empty diagram** (SD-08): single state, no transitions → verifies nodes, empty edges, empty clusters
- **Self-transition** (SD-09): `active → active` → correct `from`/`to` identity, ordinal 0
- **Empty edge label** (SD-05, inline override): transition without label text → empty string, not undefined
- **Composite with no regular nodes** (SD-07, `roundedWithTitle` test): cluster-only diagram → nodes map empty, clusters length 1
- **Error handling**: `getDiagramFromText` throwing → `valid:false` with message and line number

---

### [PASS] Finding 6: Integration tests SD-10 and SD-11 present

`SD-10` tests the adapter integration path (correct `diagram.type` returned, `direction === "TD"`) and `SD-11` tests the full structural contract needed by downstream modules (layout, canvas-generator). The SD-11 "full pipeline" label is slightly aspirational — it tests the parsed output structure but not actual layout/canvas execution with live mermaid. This is correct and appropriate for Phase B; actual end-to-end execution is a Phase D concern.

---

### [CONDITIONAL] Finding 7: Two test groups lack SD-XX identifiers

The final two `describe` blocks — `"parseMermaid — edge type"` and `"parseMermaid — node classes"` — do not carry an `SD-XX` prefix in their describe label. These tests cover meaningful contract details (all edges are `"arrow"` type; `cssClasses` is split into an array). They are not redundant (no other test group makes the `type === "arrow"` assertion for edges, and no other group covers `classes` parsing on nodes).

**Impact**: Minor — the tests are valid and will correctly verify implementation. The gap is cosmetic: the Phase B test plan in `diagram-types-architecture.md §13` lists only SD-01..SD-11, yet the file includes additional unnamed groups. This is an additive improvement, not a deficiency.

**Recommendation**: The test-builder may optionally fold the edge-type assertion into SD-11's "parsed edges have all required fields" test (it already checks `edge.type === "arrow"`), and fold the node-classes tests into a new `SD-12` group or into SD-01/SD-11. This is a non-blocking cosmetic fix.

---

### [PASS] Finding 8: No shared mutable state between tests

Each test either uses `beforeEach(() => setMockDb(...))` for its group or calls `setMockDb()` inline at the start of the test before calling `parseMermaid()`. The module-level `_mockDb` is re-assigned (not mutated), and the mock's `getDiagramFromText` reads it by reference at call time. Tests are independent: no test's `setMockDb` call can affect another test's execution because `await parseMermaid(...)` resolves synchronously through the mock.

---

### [PASS] Finding 9: No TypeScript any-escapes or banned patterns

The test file is fully typed. `MockStateNode`, `MockStateEdge`, and `MockStateDiagramDb` interfaces are explicitly defined. No `: any`, no `// @ts-ignore`, no `TODO`/`FIXME` comments, no debug `console.log` calls.

---

## Gaps and Missing Coverage

| Gap | Severity | Notes |
|---|---|---|
| No test for `composite state that is a child of another composite being absent from nodes map` | Low | SD-03 tests the top-level composite is absent; SD-04 tests nesting but doesn't assert the inner composite is absent from `nodes`. Implementation will handle this correctly but test could be more explicit. |
| Pseudostate `stateStart`/`stateEnd` 30×30 dimension not tested | Low | Architecture §2.3 specifies 30×30 rendering. Shape map dimensions are a Phase C/D concern (shape-map.ts); the parser just emits the shape string. Not a test gap for Phase B. |
| `roundedWithTitle` shape string not explicitly asserted as absent from shape | Low | SD-03 and SD-07 verify `nodes.has("active") === false`, which is sufficient. The shape string is irrelevant once the node becomes a cluster. |

None of these gaps require fixes before Phase C proceeds.

---

## Recommendation

**APPROVED — Proceed to Phase C (implementation)**

The test suite provides complete coverage of all SD-R01..SD-R07 requirements and is correctly RED at assertion level. The two unnamed test groups (edge type, node classes) are additive value. The single conditional note (Finding 7) is cosmetic and non-blocking.

**Actions for test-builder (optional, non-blocking):**
1. Consider adding `"SD-12"` prefix to the `"parseMermaid — edge type"` and `"parseMermaid — node classes"` describe blocks, or fold their assertions into existing SD-11 tests, for consistency with the SD-XX naming scheme.

**Actions for developer (Phase C):**
1. Create `packages/diagram/src/parser/state-diagram.ts` implementing `parseStateDiagram(db: StateDiagramDb): ParsedDiagram`
2. Update `adapter.ts` line 151 gate to dispatch `stateDiagram-v2` → `parseStateDiagram`
3. Add `stateStart`/`stateEnd` entries to `shape-map.ts` and `SHAPE_DIMS` in `auto-layout.ts`
4. All 40 failing tests must turn green; the 2 passing error-handling tests must remain green
