# Review — mermaid-parsing-fix — Phase A (Pre-execution plan review)

**Date:** 2026-04-02  
**Reviewer:** Reviewer agent  
**Scope:** Architect's plan for three mermaid parsing fixes (Issues 1–3)  
**Files inspected:** `parser/adapter.ts`, `parser/flowchart.ts`, `types.ts`,  
`__tests__/parser.test.ts`, `__tests__/types.test.ts`, `reconciler/placement.ts`,  
`__tests__/auto-layout.test.ts`, `__tests__/diagram-leaf-integration.test.ts`

---

## Overall verdict: PASS with two mandatory clarifications

The plan is technically sound and targets real bugs. All three issues are correctly
diagnosed. The proposed changes are minimal, well-scoped, and do not violate any
architecture constraint. Two items below need an explicit decision before execution
to prevent the developer from making the wrong call.

---

## PASS items

### Issue 1 — db access via `diag.db`

The diagnosis is correct. Line 197 of `adapter.ts`:

```ts
const db = diag.parser.parser?.yy ?? diag.parser.yy;
```

is fragile. `diag.db` is the documented mermaid 11.x public surface. The plan
correctly simplifies `MermaidDiagram` to `{ db: Record<string, unknown> }` and
removes the `parser.parser?.yy` chain. The mock update (`{ db: _mockDb }`) is
consistent and covers all test cases.

**No issues found.**

### Issue 3 — `v.text ?? v.label` field priority

`flowchart.ts` line 122 currently uses `v.label ?? v.text ?? ""`. The plan flips
this to `v.text ?? v.label ?? ""` because mermaid 11.x stores text in `.text`, not
`.label`. The interface comment update (`// primary field` / `// fallback`) is
accurate and improves readability.

The new test `"prefers vertex.text over vertex.label when both are present"` correctly
exercises the priority path.

**No issues found.**

---

## Items requiring clarification (mandatory before execution)

### Clarification 1 — Issue 2, `types.ts`: `"TB"` in the union is a code smell unless the normalization is optional

The plan adds `"TB"` to `ParsedDiagram.direction` **and** normalizes `"TB"` → `"TD"`
in `flowchart.ts`. These two changes are contradictory if they both ship: if
`flowchart.ts` always normalizes `"TB"` to `"TD"` before the value ever reaches
`ParsedDiagram`, then `"TB"` will **never** appear in a `ParsedDiagram.direction`
field at runtime. The union type becomes a lie — it documents a value that the
system itself guarantees will never be produced.

**Decision needed:** Choose one of:
- **Option A (recommended):** Normalize in `flowchart.ts` only. Do NOT add `"TB"` to
  `ParsedDiagram.direction`. The public type stays `"TD" | "LR" | "RL" | "BT"` (no
  `"TB"`). `types.test.ts` does NOT add `"TB"`. This is the clean approach: the
  internal mermaid quirk is hidden behind the adapter; callers never see `"TB"`.
- **Option B:** Add `"TB"` to the union but do NOT normalize. Let callers handle both.
  This exposes the mermaid implementation detail but is honest about what can appear.

The plan proposes Option A for `flowchart.ts` and `parser.test.ts` but Option B for
`types.ts` and `types.test.ts`. This is the worst of both worlds. Pick one.

> **Recommendation: Option A.** The entire purpose of `adapter.ts` + `flowchart.ts`
> is to hide mermaid internals. Normalize at the boundary, keep the public type clean.

### Clarification 2 — Issue 2, `placement.ts`: rankdirMap `TB: "TB"` is wrong

The plan adds `TB: "TB"` to `rankdirMap`. The existing map is:

```ts
const rankdirMap: Record<string, "TB" | "LR" | "RL" | "BT"> = {
  TD: "TB", BT: "BT", LR: "LR", RL: "RL"
};
```

`rankdirMap` converts a `ParsedDiagram.direction` value to a dagre `rankdir` string.
`"TB"` is a dagre rankdir value, not a ParsedDiagram direction value. If Clarification 1
is resolved as Option A (normalize `"TB"` → `"TD"` in the parser), then `placement.ts`
will never receive `"TB"` as input — adding `TB: "TB"` to the map is dead code. If
Clarification 1 resolves as Option B (no normalization), then `placement.ts` must
handle `"TB"` as an input, and `TB: "TB"` is correct. The two changes must be consistent.

Additionally: the plan says to add `"TB"` to the `direction` option union in `placement.ts`:

```ts
options?: { direction?: "TD" | "LR" | "BT" | "RL" | "TB"; ... }
```

The same logic applies: this is only correct under Option B. Under Option A it is
dead code and pollutes the API.

> **Recommendation:** Resolve Clarification 1 first. If Option A, make no changes
> to `placement.ts` at all (the existing `?? "TB"` fallback already handles the
> `undefined` case; `"TB"` will never appear as an explicit value).

---

## Minor observations (non-blocking)

### `flowchart.ts` direction cast loses the union

Current code (lines 81–85):

```ts
const direction = (db.getDirection as () => string)() as
  | "TD"
  | "LR"
  | "RL"
  | "BT";
```

After the fix this becomes `"TD" | "TB" | "LR" | "RL" | "BT"` (under either option).
The `as` cast is already justified — mermaid's return type is untyped. The developer
should update this cast consistently with whichever union option is chosen.

### `auto-layout.test.ts` and `diagram-leaf-integration.test.ts` helper signatures

The plan proposes using `ParsedDiagram["direction"]` in test helper signatures instead
of hardcoded unions. This is correct maintenance practice — it keeps tests in sync with
the type automatically. Non-blocking improvement; should be done.

### `parser.test.ts` direction test currently uses `as const`

Line 384:

```ts
it.each(["TD", "LR", "RL", "BT"] as const)("detects direction %s", ...)
```

After adding the new `"TB"` normalization test, the developer should NOT add `"TB"`
to this `as const` array (since the mock returning `"TB"` should produce `"TD"` in
the output — the existing test loop exercises the passthrough cases). The new test
must be a separate `it()` that sets `getDirection: () => "TB"` and asserts
`result.diagram.direction === "TD"`.

---

## Checklist pre-execution state

| # | Check | Pre-exec state |
|---|-------|---------------|
| 1 | `MermaidDiagram` simplified to `{ db }` | Planned — correct |
| 2 | `db` access uses `diag.db` | Planned — correct |
| 3 | Mock returns `{ db: _mockDb }` | Planned — correct |
| 4 | `ParsedDiagram.direction` union includes `"TB"` | **NEEDS CLARIFICATION 1** |
| 5 | `flowchart.ts` normalizes `"TB"` → `"TD"` | Planned — correct |
| 6 | `types.test.ts` updated | **DEPENDS ON CLARIFICATION 1** |
| 7 | New `"TB"` normalization test | Planned — correct |
| 8 | `placement.ts` changes | **DEPENDS ON CLARIFICATION 1** |
| 9 | `MermaidVertex.text` listed first with "primary" comment | Planned — correct |
| 10 | Label extraction is `v.text ?? v.label ?? ""` | Planned — correct |
| 11 | New test: text preferred over label | Planned — correct |
| 12 | Test helpers use `ParsedDiagram["direction"]` | Planned — correct |
| 13 | `pnpm test` green | Cannot pre-verify |
| 14 | `tsc --noEmit` clean | Cannot pre-verify |
| 15 | No `any` introduced | Plan appears clean |
| 16 | Comments accurate for mermaid 11.x | Planned — correct |

**Blocking before execution:** Clarifications 1 and 2 must be resolved. All other
items are correctly scoped.
