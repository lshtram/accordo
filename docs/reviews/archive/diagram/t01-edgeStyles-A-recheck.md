# Review — T-01 edgeStyles in `accordo_diagram_patch` — Phase A Re-check

**Date:** 2026-04-03  
**Reviewer:** Reviewer agent  
**Prior review:** `docs/reviews/t01-edgeStyles-A.md` — STATUS: REQUEST CHANGES (2 blocking, 2 minor)  
**This review:** Re-check after architect fixes  
**Status:** ✅ PASS — GREEN LIGHT for Phase B

---

## Verdict

**PASS. All 4 findings are resolved. Ready for user checkpoint before Phase B.**

---

## Finding-by-finding verification

### FINDING-1 (was BLOCKING): Tool description and style guide not updated

**Claimed fix:** Updated `accordo_diagram_patch` description in `diagram-tool-definitions.ts`;
added full `EDGE OVERRIDES` section to `stylingInstructions` in `diagram-tool-ops.ts`.

**Verified:**

`diagram-tool-definitions.ts` lines 93–98 now read:

```
"Update an existing .mmd file with new Mermaid source and reconcile the stored layout. " +
"Use the optional 'nodeStyles' argument to set per-node colours, fonts, fill patterns, " +
"roughness, and size overrides. Use 'edgeStyles' to set per-edge stroke colour, width, " +
"style, and routing. This is the ONLY correct way to style nodes and edges — " +
"never use Mermaid classDef directives (Accordo ignores them)."
```

`edgeStyles` is explicitly named alongside `nodeStyles`. ✅

`diagram-tool-ops.ts` lines 532–547 now contain a complete `EDGE OVERRIDES` section:
- Lists the edge-key format (`source->target:index`)
- Documents all four visual fields (`strokeColor`, `strokeWidth`, `strokeStyle`, `strokeDash`)
- Documents the `routing` field and its separation from `EdgeStyle`
- Notes `waypoints` exclusion (deferred to D-04)
- Includes a concrete example: `edgeStyles: { 'A->B:0': { strokeColor: '#E74C3C', strokeStyle: 'dashed', strokeWidth: 2 } }`
- States the merge semantics: "edgeStyles merges into existing styles"

An agent calling `accordo_diagram_style_guide` will see this section and know exactly how to use `edgeStyles`. ✅

**Result: FINDING-1 RESOLVED.**

---

### FINDING-2 (was BLOCKING): Missing style-field preservation test

**Claimed fix:** Added DT-66 — two-step patch proving `strokeColor` survives a subsequent
`strokeWidth`-only patch.

**Verified** (`diagram-tools.test.ts` lines 1213–1245):

```
Step 1: patchHandler with edgeStyles: { "A->B:0": { strokeColor: "#f00" } }
Step 2: patchHandler with edgeStyles: { "A->B:0": { strokeWidth: 2 } }
Assert: edges["A->B:0"].style.strokeColor === "#f00"   ← was NOT wiped
Assert: edges["A->B:0"].style.strokeWidth === 2
```

The test correctly exercises the exact shallow-merge trap identified in the original
review. It is a two-step patch, not a single-step assertion, so it genuinely proves
that the second write does not clobber the first. ✅

**Test state confirmed by running `pnpm test`:**
- DT-66 fails at assertion level with `Error: not implemented` (line 345) — not an import
  error or syntax error. It will flip GREEN when the stub is implemented in Phase C. ✅

**Result: FINDING-2 RESOLVED.**

---

### FINDING-3 (was MINOR): Deep-merge requirement not written explicitly

**Claimed fix:** Added 4-line comment block explaining the deep-merge requirement and the
`patchEdge` shallow-spread trap.

**Verified** (`diagram-tool-ops.ts` lines 337–342):

```typescript
// Apply edgeStyles overrides (visual style fields + routing).
// IMPORTANT: Handler must read `existing.style ?? {}` and produce
// `style: { ...existing.style, ...styleFields }` before calling patchEdge.
// Do NOT pass raw `styleFields` as the `style` value — patchEdge does a
// shallow spread which would wipe existing style properties (deep-merge requirement).
// waypoints is intentionally excluded — deferred to D-04.
```

The comment immediately precedes the stub. Any developer implementing the handler will
read it before writing a single line. The note is explicit: it names `patchEdge`'s
shallow-spread behaviour, the correct fix (`{ ...existing.style, ...styleFields }`), and
the consequence of getting it wrong. ✅

**Result: FINDING-3 RESOLVED.**

---

### FINDING-4 (was MINOR): `waypoints` exclusion not documented

**Claimed fix:** Added "waypoints intentionally excluded — deferred to D-04" to the schema
description and the style guide.

**Verified:**

`diagram-tool-definitions.ts` line 146 (inside `edgeStyles` schema description):
```
"Note: waypoints is intentionally excluded — deferred to D-04."
```

`diagram-tool-ops.ts` line 541 (inside `stylingInstructions` EDGE OVERRIDES section):
```
"  Note: waypoints is intentionally excluded — deferred to D-04."
```

Both the schema (visible to agents via MCP `tools/list`) and the style guide (visible
via `accordo_diagram_style_guide`) carry the annotation. A future developer adding
`waypoints` to the schema prematurely will see the deferred-decision note. ✅

**Result: FINDING-4 RESOLVED.**

---

## Additional checks

### Handler stub correctness

`diagram-tool-ops.ts` lines 337–346:

```typescript
// Apply edgeStyles overrides (visual style fields + routing).
// IMPORTANT: ...deep-merge comment...
const rawEdgeStyles = args.edgeStyles as Record<string, Record<string, unknown>> | undefined;
if (rawEdgeStyles !== undefined && typeof rawEdgeStyles === "object") {
  throw new Error("not implemented");
}
```

The stub is structured correctly:
- Routing guard (`rawEdgeStyles !== undefined && typeof rawEdgeStyles === "object"`) matches
  the pattern used by `rawNodeStyles` (line 280) and `rawClusterStyles` (line 314). ✅
- The `throw new Error("not implemented")` is inside the guard, so absent `edgeStyles`
  falls through cleanly — this is why DT-63 passes already. ✅
- The stub is correctly positioned after `rawClusterStyles` and before `placeNodes`. ✅
- The deep-merge comment gives the Phase C developer precise implementation guidance. ✅

### DT-59..DT-66 fail at assertion level (not import/syntax errors)

`pnpm test` output confirmed:
- 7 tests fail with `Error: not implemented` (all at `ops.ts:345`)
- 1 test passes: DT-63 (absent `edgeStyles` → no error)
- 551 other tests pass
- No import errors, no syntax errors, no type errors ✅

Failure mode is correct for Phase B: tests are RED by throwing at the stub, not by
structural test defects.

### Type checker clean

`tsc --noEmit` produces zero output (zero errors). ✅

### DEC-011 decision record

`docs/decisions.md` lines 239–254 contain DEC-011 with:
- Decision 1: deep-merge style fields (with the precise code pattern)
- Decision 2: exclude `waypoints` (D-04 deferred)
- Consequences that reference DT-66 as the guard test

The decision record meets the "design decisions are recorded" requirement. ✅

### Schema consistency

The `edgeStyles` schema in `diagram-tool-definitions.ts` (lines 139–158) follows the
established pattern from `nodeStyles` and `clusterStyles`:
- Outer `type: "object"`, `description`, `additionalProperties: { type: "object", ... }`
- Inner object has `additionalProperties: false` — unknown fields rejected by the MCP
  transport layer before reaching the handler ✅
- `routing` is typed as `enum: ["auto", "orthogonal", "direct", "curved"]` — this is a
  correct narrowing (string-typed at the storage level, enum at the schema level for
  agent guidance) ✅

### Style guide sufficiency

An agent calling `accordo_diagram_style_guide` and reading the returned `stylingInstructions`
array will find:
1. A clear header: `EDGE OVERRIDES (use the 'edgeStyles' argument, NOT nodeStyles)`
2. The edge-key format explained
3. All visual fields listed with types
4. The routing field distinguished from style fields
5. The `waypoints` deferral noted
6. A concrete usage example
7. Merge semantics stated

This is sufficient for an agent to use `edgeStyles` correctly on first attempt. ✅

---

## Checklist (full re-run)

| # | Item | Status |
|---|---|---|
| 1 | All 4 findings resolved | ✅ PASS |
| 2 | Tool description mentions `edgeStyles` | ✅ PASS |
| 3 | Style guide has complete EDGE OVERRIDES section with example | ✅ PASS |
| 4 | DT-66 tests two-step partial-style preservation | ✅ PASS |
| 5 | Deep-merge requirement written in code comment before stub | ✅ PASS |
| 6 | `waypoints` exclusion noted in schema description and style guide | ✅ PASS |
| 7 | DEC-011 decision record present and complete | ✅ PASS |
| 8 | Handler stub correctly gated so DT-63 passes | ✅ PASS |
| 9 | DT-59..DT-65, DT-66 fail at "not implemented" — no structural test defects | ✅ PASS |
| 10 | `tsc --noEmit` clean | ✅ PASS |
| 11 | 551 tests passing, 7 new tests correctly RED | ✅ PASS |
| 12 | Schema follows established `nodeStyles`/`clusterStyles` pattern | ✅ PASS |
| 13 | `routing` correctly separated from `EdgeStyle` in schema and comment | ✅ PASS |

---

## Summary

All blocking and minor findings from the first review are genuinely resolved. The design
is complete, the stub is correctly structured, the test suite is comprehensive, and the
documentation is sufficient for agents and developers alike.

**→ GREEN LIGHT. Ready for user checkpoint before Phase B.**
