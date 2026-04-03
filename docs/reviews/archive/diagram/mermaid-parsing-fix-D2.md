# Review — mermaid-parsing-fix — Phase D2

**Date:** 2026-04-03  
**Reviewer:** Reviewer agent  
**Scope:** Post-execution review of the three mermaid parsing fixes  
**Phase A review:** `docs/reviews/mermaid-parsing-fix-A.md`  
**Files reviewed:**
- `packages/diagram/src/parser/adapter.ts`
- `packages/diagram/src/parser/flowchart.ts`
- `packages/diagram/src/types.ts`
- `packages/diagram/src/reconciler/placement.ts`
- `packages/diagram/src/__tests__/parser.test.ts`
- `packages/diagram/src/__tests__/types.test.ts`

---

## PASS

### Tests: 548 passing, 0 failures

```
Test Files  22 passed (22)
     Tests  548 passed (548)
  Start at  00:13:52
  Duration  2.76s
```

All 22 test files pass. The 61 parser tests pass. The 40 types tests pass.

### Type checker: clean

`tsc --noEmit` exits 0 with no errors. All new types are fully typed.

### Linter: N/A

`packages/diagram` has no `eslint.config.mjs` (it is not listed among the packages
that have ESLint configured — verified by scanning the repo root). No linter
infrastructure exists for this package; this item is marked N/A rather than FAIL.

### `diag.db` access (Issue 1): PASS

`adapter.ts` correctly uses `diag.db` (line 197). `MermaidDiagram` is simplified to
`{ db: MermaidDb }` (lines 172–174). The `parser.parser?.yy` fragile chain is gone.
The mock in `parser.test.ts` returns `{ db: _mockDb }` consistently. No issues.

### Vertex text/label priority (Issue 3): PASS

`flowchart.ts` line 127 uses `v.text ?? v.label ?? ""`. The interface lists `text`
first with `// mermaid 11.x primary field` and `label` second with
`// fallback for older internal API shapes`. The test at line 599 of `parser.test.ts`
exercises the text-only case. See gap below for the both-present case.

### Subgraph/cluster extraction: PASS

Two-pass algorithm is correct. Parent derivation is explicit and handles nested
subgraphs. Tests cover: cluster count, label, member IDs, and `cluster` field on
nodes (test sections 6).

### Edge ordinals: PASS

Counter keyed by `"${start}:${end}"`, 0-based, incremented per edge in declaration
order. Section 5 of parser tests exercises exactly the 3-edge A→B case and asserts
ordinals `[0, 1, 2]`.

### Edge types: PASS

`EDGE_TYPE_MAP` maps `1→"arrow"`, `2→"dotted"`, `3→"thick"`. Tests cover all three
(parser test section 4, tests at lines 278–297).

### Node shapes: PASS

`SHAPE_MAP` covers `square→rectangle`, `round→rounded`, `diamond`, `circle`,
`stadium`, `cylinder`, `hexagon`. All seven are exercised in test section 3,
lines 202–215.

### Rankdir mapping in `placement.ts`: PASS (under Option A)

`rankdirMap` at line 98 of `placement.ts` correctly maps:
```ts
{ TD: "TB", BT: "BT", LR: "LR", RL: "RL" }
```
The developer did NOT add `TB: "TB"` — this is correct. Since `flowchart.ts`
normalizes `"TB"` → `"TD"` before the value ever reaches placement, `"TB"` will
never appear as a `direction` input at runtime. The map is clean.

The `direction` option union on `placeNodes()` remains `"TD" | "LR" | "BT" | "RL"`
(no `"TB"`) — also correct.

---

## Contradiction resolution: CONFIRMED Option A chosen correctly

The Phase A review flagged a mandatory clarification: the plan contradicted itself by
proposing to normalize `"TB"→"TD"` in `flowchart.ts` **and** add `"TB"` to
`ParsedDiagram.direction` in `types.ts`. The developer correctly chose **Option A**:

| Decision point | Expected (Option A) | Actual |
|---|---|---|
| `flowchart.ts`: normalize `"TB"` → `"TD"` | YES | ✅ line 89–90 |
| `types.ts`: `"TB"` in `ParsedDiagram.direction` union | NO | ✅ union is `"TD" \| "LR" \| "RL" \| "BT"` |
| `types.test.ts`: `"TB"` in direction union type test | NO | ✅ test asserts `"TD" \| "LR" \| "RL" \| "BT" \| undefined` |
| `placement.ts`: `TB: "TB"` in rankdirMap | NO | ✅ not present |
| `placement.ts`: `"TB"` in option union | NO | ✅ not present |

The contradiction is **fully resolved**. The internal mermaid quirk (`"TB"` vs `"TD"`)
is hidden at the adapter boundary. All downstream code sees only `"TD"`.

---

## FAIL — must fix before Phase E

### F-1: No test for TB normalization (highest priority)

The Phase A review explicitly required: _"a separate `it()` that sets `getDirection: () => "TB"` and asserts `result.diagram.direction === "TD"`."_

**The test does not exist.**

Section 7 of `parser.test.ts` (lines 383–396) tests directions with:
```ts
it.each(["TD", "LR", "RL", "BT"] as const)("detects direction %s", ...)
```
`"TB"` is not in this array (correct — `"TB"` should not appear in the output).
But there is **no separate test** asserting that when mermaid returns `"TB"`,
`ParsedDiagram.direction` is `"TD"`.

This is the most important behavioral change in the fix. Without a test, the
normalization in `flowchart.ts` lines 88–90 can be silently reverted by any
future refactor without any test turning red.

**Required fix:**
```ts
// In parser.test.ts, section 7, after the existing it.each:
it("normalizes mermaid 'TB' direction to 'TD'", async () => {
  setMockDb({
    getVertices: () => ({}),
    getEdges: () => [],
    getSubGraphs: () => [],
    getDirection: () => "TB", // mermaid 11.x returns "TB"
  });
  const result = await parseMermaid("flowchart TB");
  expect(result.valid).toBe(true);
  if (!result.valid) return;
  expect(result.diagram.direction).toBe("TD"); // must be normalized
});
```

**File:** `packages/diagram/src/__tests__/parser.test.ts`  
**After:** line 395 (end of direction `it.each`)

---

### F-2: No test for vertex label-fallback when both `text` and `label` present (medium priority)

Test section 14 (line 598) covers only the case where `vertex.label` is absent and
`vertex.text` is used. It does NOT test what happens when **both** `vertex.text` and
`vertex.label` are present — which is precisely the priority assertion. The fix
swapped the field priority (`v.text ?? v.label`) but the test only proves the
trivially-passing direction (text-only). A regression back to `v.label ?? v.text`
would not be caught by the existing test.

**Required fix:**
```ts
it("prefers vertex.text over vertex.label when both are present", async () => {
  setMockDb({
    getVertices: () => ({
      Y: { id: "Y", text: "TextValue", label: "LabelValue", type: "square", domId: "Y", classes: [] },
    }),
    getEdges: () => [],
    getSubGraphs: () => [],
    getDirection: () => "TD",
  });
  const result = await parseMermaid("flowchart TD\n  Y[TextValue]");
  expect(result.valid).toBe(true);
  if (!result.valid) return;
  expect(result.diagram.nodes.get("Y")?.label).toBe("TextValue"); // text wins
});
```

**File:** `packages/diagram/src/__tests__/parser.test.ts`  
**After:** line 613 (end of section 14)

---

## Completeness audit — mermaid flowchart notation

| Feature | Implementation | Test | Status |
|---|---|---|---|
| Direction: TD | `normalizedDirection` passthrough | Section 7 `it.each` | ✅ |
| Direction: LR | `normalizedDirection` passthrough | Section 7 `it.each` | ✅ |
| Direction: RL | `normalizedDirection` passthrough | Section 7 `it.each` | ✅ |
| Direction: BT | `normalizedDirection` passthrough | Section 7 `it.each` | ✅ |
| Direction: TB (mermaid internal) → normalized to TD | Lines 88–90 | **MISSING** | ❌ F-1 |
| Shape: rectangle (type=`square`) | `SHAPE_MAP` | Section 3 | ✅ |
| Shape: rounded (type=`round`) | `SHAPE_MAP` | Section 3 | ✅ |
| Shape: diamond | `SHAPE_MAP` | Section 3 | ✅ |
| Shape: circle | `SHAPE_MAP` | Section 3 | ✅ |
| Shape: stadium | `SHAPE_MAP` | Section 3 | ✅ |
| Shape: cylinder | `SHAPE_MAP` | Section 3 | ✅ |
| Shape: hexagon | `SHAPE_MAP` | Section 3 | ✅ |
| Edge type: arrow (type=1) | `EDGE_TYPE_MAP` | Section 4 line 278 | ✅ |
| Edge type: dotted (type=2) | `EDGE_TYPE_MAP` | Section 4 line 285 | ✅ |
| Edge type: thick (type=3) | `EDGE_TYPE_MAP` | Section 4 line 291 | ✅ |
| Edge ordinals per (from,to) pair | `ordinalCounter` | Section 5 | ✅ |
| Subgraphs/clusters | Two-pass algorithm | Section 6 | ✅ |
| Nested cluster parent derivation | Second pass lines 107–116 | Not tested | ⚠️ (non-blocking) |
| Node label from `vertex.text` | `v.text ?? v.label ?? ""` | Section 14 (text-only) | ⚠️ F-2 |
| Node label from `vertex.label` (fallback) | `v.text ?? v.label ?? ""` | Section 14 implicitly | ✅ |
| `vertex.text` priority over `vertex.label` | `v.text ?? v.label ?? ""` | **MISSING** | ❌ F-2 |
| classDef classes on nodes | `v.classes` spread | Section 9 | ✅ |
| `@rename` annotations | Regex in adapter | Section 10 | ✅ |
| Map vs plain-object vertex API | Lines 121–123 | Not directly tested | ⚠️ (non-blocking) |
| Error on syntax failure | try/catch in adapter | Section 12 | ✅ |
| Unsupported type rejection | Explicit check line 151 | Section 13 | ✅ |

**Summary:** 2 blocking gaps (F-1, F-2). 3 non-blocking observations noted below.

---

## Non-blocking observations

### N-1: No test for nested cluster parent derivation

`flowchart.ts` lines 107–116 derive `cluster.parent` when a subgraph contains
another subgraph's ID. No test exercises a nested subgraph scenario. The code is
not tested. This is not a regression (it existed before this fix) but it should
be tracked. **Non-blocking for Phase E.**

### N-2: No test for Map-typed `getVertices()` return

Lines 121–123 handle both `Map<string, MermaidVertex>` and plain-object returns.
The test always provides a plain object. The `Map` branch is untested. **Non-blocking.**

### N-3: `flowchart.ts` return spread comment is slightly stale

Line 150: `type: "flowchart", // overridden by adapter.ts spread with detected type`  
Line 153: `renames: [], // overridden by adapter.ts spread with parsed annotations`  
These comments are accurate and the spread in adapter.ts (line 201: `{ ...parsed, type, renames }`)
does override them. But the field is still produced with a dummy value inside
`parseFlowchart`. Consider omitting `type` and `renames` from `parseFlowchart`'s
return and having `adapter.ts` set them directly. **Non-blocking style suggestion.**

---

## Verdict

**FAIL — 2 tests must be added before Phase E.**

| Item | Status |
|---|---|
| All 548 tests pass | ✅ |
| `tsc --noEmit` clean | ✅ |
| Linter | N/A (no ESLint config in package) |
| TB contradiction resolved (Option A) | ✅ |
| TB normalization tested | ❌ F-1 |
| `vertex.text` priority over `vertex.label` tested | ❌ F-2 |
| All 4 rankdirs covered | ✅ |
| All 7 node shapes covered | ✅ |
| All 3 edge types covered | ✅ |
| Edge ordinals covered | ✅ |
| Subgraphs/clusters covered | ✅ |
| No banned patterns introduced | ✅ |
| Architecture constraints respected | ✅ |

**Required action:** Add the two test cases described in F-1 and F-2 above.
Re-run `pnpm test` to confirm green. Then signal D2 complete.
