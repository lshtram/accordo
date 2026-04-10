# Phase B Re-Review — classDiagram Parser Tests

**Date**: 2026-04-05 (re-review after mock API fixes)
**Reviewer**: reviewer agent
**Module**: `class-diagram` — `packages/diagram/src/__tests__/class-diagram.test.ts`
**Status**: **PASS — B2 clear**

---

## Test Run — Verified Output

```
pnpm --filter accordo-diagram test -- class-diagram.test.ts

 ❯ src/__tests__/class-diagram.test.ts (31 tests | 29 failed) 52ms
   × parseMermaid — classDiagram type detection [REQ-CD-01] > returns valid:true … → expected false to be true
   × parseMermaid — classDiagram class nodes [REQ-CD-02] > extracts all class IDs as node keys → expected false to be true
   … (25 more — all fail with `expected false to be true` at result.valid)
   ✓ parseMermaid — classDiagram error handling [REQ-CD-07] > returns valid:false when getDiagramFromText throws
   ✓ parseMermaid — classDiagram error handling [REQ-CD-07] > error result has a line number

 Test Files  1 failed (class-diagram.test.ts only)
       Tests  29 failed | 2 passed (31 total)
```

**Failure mode**: Every RED test fails with `expected false to be true` at `result.valid`. This is the correct assertion-level failure — `PARSERS` table in `adapter.ts` does not yet contain `"classDiagram"`, so `parseMermaid` returns `valid:false` without throwing. No import errors, no compile errors, no collection failures.

**GREEN tests**: Both error-handling tests (REQ-CD-07) correctly pass — they test the existing adapter catch path by throwing from `getDiagramFromText`.

---

## Mock API Fix Verification

The two blocking findings from the initial review are confirmed resolved:

### Finding 1 (was HIGH) — Mock API now uses direct properties ✅

```typescript
interface MockDb {
  classes: Map<string, MockClassNode>;   // ✅ was: getClasses?: () => Record<...>
  relations: MockRelation[];              // ✅ was: getRelationships?: () => ...
  notes: Map<string, MockNote>;           // ✅ was: getNotes?: () => ...
  direction: string;                      // ✅ was: getDirection?: () => string
}
```

All `setMockDb()` calls use direct Map/Array properties — e.g. `classes: new Map([...])`, `relations: [...]`, `notes: new Map([...])`. This matches the real mermaid 11.x ClassDB API (`db.classes`, `db.relations`, `db.notes`, `db.direction`).

### Finding 2 (was MEDIUM) — MockRelation now matches real ClassRelation structure ✅

```typescript
interface MockRelation {
  id1: string;          // ✅ was: start/id
  id2: string;          // ✅ was: end
  relation: {
    type1: 0|1|2|3|4;  // ✅ numeric enum from RELATION_TYPE
    type2: 0|1|2|3|4;
    lineType: 0|1;      // ✅ numeric enum from LINE_TYPE
  };
  title: string;        // ✅ was: text
  // ...
}
```

Both `RELATION_TYPE` and `LINE_TYPE` enum maps are defined in the test file (lines 75–87), matching the real mermaid values documented in `diagram-types-architecture.md §3.1`.

---

## One Structural Note — LOLLIPOP → "association" mapping

The test uses `RELATION_TYPE.LOLLIPOP` to model a plain association (line 298) and expects `e.type === "association"`. The architecture doc (`diagram-types-architecture.md` line 263) maps `LOLLIPOP + LINE → "arrow"` (fallback). The test expects `"association"` which is not listed as a named EdgeType in `types.ts` (lines 275–284) but is covered by `| string` (open union, line 284).

This is a design decision the developer must make during Phase C: either honour the architecture doc (`"arrow"`) or introduce `"association"` as a distinct edge type. The test encodes a valid and reasonable expectation. If the developer uses `"arrow"`, this test will fail and they will need to discuss the mapping with the architect. **This is not a blocking issue for B2** — it is a design-time choice that Phase C will resolve.

---

## Requirement Coverage (unchanged — all green)

| REQ ID | Requirement | Groups | Tests | Verdict |
|---|---|---|---|---|
| REQ-CD-01 | Type detection / parse success | `type detection` | 2 | ✅ |
| REQ-CD-02 | Class nodes: IDs, labels, shape | `class nodes` | 4 | ✅ |
| REQ-CD-03 | Annotations → `node.classes` | `attributes and methods` | 2 | ✅ |
| REQ-CD-04 | Relationship types, labels, ordinals | `relationships` | 10 | ✅ |
| REQ-CD-05 | Notes as clusters | `notes` | 3 | ✅ |
| REQ-CD-06 | Direction detection + TB→TD normalisation | `direction` | 5 | ✅ |
| REQ-CD-07 | Error returns valid:false + line | `error handling` | 2 | ✅ |
| — | Empty diagram edge cases | `empty diagram` | 3 | ✅ |

---

## Structure Quality Checks

| Check | Result |
|---|---|
| All failures are assertion-level (`valid:false`, not import/compile errors) | ✅ |
| 2 error-handling tests correctly GREEN | ✅ |
| `setMockDb()` called per-test or in `beforeEach` — no shared mutable state | ✅ |
| Mock db is a plain object reset each test — no cross-test pollution | ✅ |
| Dynamic import after `vi.mock()` declaration (correct mock hoisting) | ✅ |
| `if (!result.valid) return;` guard prevents misleading cascades | ✅ |
| No `: any` in test types | ✅ |
| No `toBeTruthy()` where exact value expected | ✅ |
| No `console.log`, no `TODO`/`FIXME` | ✅ |
| `it.each(["TD","LR","RL","BT"])` for direction parametrisation | ✅ |
| Numeric enum constants defined and used (not magic numbers) | ✅ |
| `notes` modelled as `Map<string, MockNote>` — matches real API | ✅ |

---

## Verdict

### **PASS — B2 clear**

Both blocking findings from the initial Phase B review are resolved. The mock now correctly models the real mermaid 11.x ClassDB API with direct Map/Array properties and numeric relation type enums. All 29 RED tests fail at assertion level for the right reason (parser not yet registered), and both GREEN tests remain green.

**Phase C (implementation) may proceed.**

The LOLLIPOP→"association" mapping question noted above is a Phase C design decision, not a test defect.
