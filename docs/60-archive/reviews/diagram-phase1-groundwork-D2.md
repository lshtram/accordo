## Review — diagram / Phase 1 Groundwork — Phase D2

**Date:** 2026-04-05  
**Reviewer:** Reviewer Agent  
**Files reviewed:** `packages/diagram/src/types.ts`, `packages/diagram/src/parser/adapter.ts`  
**Test files reviewed:** `types.test.ts`, `layout-store.test.ts`, `parser.test.ts`

---

### PASS

All mandatory checklist items pass. Details below.

---

### 1. Tests (§3.1)

```
Test Files  23 passed (23)
     Tests  625 passed (625)
  Start at  11:01:06
  Duration  2.89s
```

Targeted run (`types.test.ts`, `layout-store.test.ts`, `parser.test.ts`): ✅ all green.  
Full suite: ✅ zero failures, zero skipped.

---

### 2. Type Checker (§3.1)

```
tsc --noEmit && tsc -p tsconfig.webview.json --noEmit
```
Zero errors. ✅

---

### 3. Banned Patterns (§3.3, §3.1)

| Pattern | Result |
|---|---|
| `: any` in production code | ✅ None found |
| Non-null assertion `!` without comment | ✅ None found |
| `console.log` / `console.debug` in production | ✅ None found |
| New `TODO` / `FIXME` | ✅ None found |
| Hardcoded values that belong in config | ✅ None found |

---

### 4. Requirement Coverage

#### REQ-R1: `ParsedDiagram.direction` is optional
**Status:** ✅ PASS (pre-existing, re-verified)  
`types.ts:303` — `direction?: "TD" | "LR" | "RL" | "BT"` — was already optional before Phase C. Test confirms it.

#### REQ-R2: `NodeShape` includes `stateStart` | `stateEnd`
**Status:** ✅ PASS  
`types.ts:267-268` — both literals added after `"ellipse"` before the open `string` escape.  
Diff confirmed: previous version had only `"ellipse" | string` — `stateStart` and `stateEnd` are new additions.

#### REQ-R3: `ExcalidrawElement.type` includes `"line"` | `"freedraw"`
**Status:** ✅ PASS  
`types.ts:408` — full union is now `"rectangle" | "diamond" | "ellipse" | "arrow" | "text" | "line" | "freedraw"`.  
Test REQ-R3 uses `toEqualTypeOf` (exact match), confirming no extra members.  
Diff confirmed: previous was `"rectangle" | "diamond" | "ellipse" | "arrow" | "text"` only.

#### REQ-R4: `LayoutStore` has `metadata?: Record<string, unknown>`
**Status:** ✅ PASS  
`types.ts:94-95` — field added after `aesthetics`, marked optional with correct type.  
Diff confirmed: field was absent in last commit.  
Round-trip test (`REQ-R4` in `layout-store.test.ts:309`) writes and reads back a layout with populated `metadata`, confirms both raw JSON and parsed `LayoutStore` preserve the field.

#### REQ-R5: Unsupported spatial type error derived dynamically from `PARSERS` keys
**Status:** ✅ PASS  
`adapter.ts:199-204` — `Object.keys(PARSERS).join(", ")` is computed at call time from the live registry; the error template string interpolates `registered`.  
Previous commit had `'not supported in diag.1 (flowchart only)'` — that hardcoded text is completely gone.  
`PARSERS` is `const`-scoped inside `parseMermaid`, so its contents exactly reflect what is registered for that invocation with no stale-capture risk.  
Test REQ-R5 verifies: message contains `"classDiagram"`, `"flowchart"`, `"stateDiagram-v2"`, does NOT contain `"diag.1"` or `"flowchart and stateDiagram-v2 only"`. ✅

#### REQ-R6: Sequence error does not advertise non-registered types
**Status:** ✅ PASS  
Two-path logic is correct and safe:
1. `sequenceDiagram` → `detectDiagramType` returns `null` → `UNSUPPORTED_TYPE_RE` matches → early return with `"not supported by this extension"`. Never reaches `PARSERS` lookup. No registered-type list is emitted.
2. `classDiagram` (spatial but unimplemented) → `detectDiagramType` returns `"classDiagram"` → `PARSERS[type]` is undefined → dynamic `"Supported types: flowchart, stateDiagram-v2"` error.

`rg "erDiagram, mindmap, block-beta"` on adapter.ts → no results. ✅  
Test REQ-R6 verifies: message contains `"sequenceDiagram"`, `"not supported"`, does NOT contain `"erDiagram, mindmap, block-beta"`. ✅

---

### 5. Architecture Compliance (§3.5, AGENTS §4)

- **No `vscode` imports** in `types.ts` or `adapter.ts` — ✅
- `bridge-types` boundary not affected — ✅
- `PARSERS` is function-scoped `const`, not global mutable state — ✅
- `as unknown as { mermaidAPI: ... }` double-cast at `adapter.ts:168` is the pre-existing mermaid interop shim (present since original commit `4f3d29a`). Purpose is documented in the surrounding comment: Mermaid's TypeScript types do not export `mermaidAPI` at the default export level. This is a well-bounded adapter layer — no new unsafe casts introduced by Phase C.

---

### 6. Code Quality (§3.4)

- **`types.ts` (478 lines total, ~183 non-blank non-comment lines):** Guideline says "stubs + docs don't count". This file is entirely type declarations and JSDoc — no implementation code. Not a violation.
- **`parseMermaid` function (88 lines):** Exceeds the ~40-line guideline. This is **pre-existing** (79 lines at last commit `2f9cb32`). Phase C added 9 lines (the dynamic `registered` variable and updated error template). The function is a known complexity hotspot from earlier sessions. This is a pre-existing observation, not a new violation introduced by this phase.
- **`catch (e: unknown)` → `e as { message?:...; hash?:... }`:** Guideline §3.3 flags `as X` without a type guard. However the catch block use is idiomatic TypeScript for narrowing Mermaid's non-typed error objects (all-optional fields, used defensively with `??`). The only alternatives are either `instanceof` (Mermaid throws plain objects, not `Error` subclasses) or a full type predicate function — neither is materially safer for this pattern. Pre-existing in all previous commits. Not introduced by Phase C. Flagged as low-severity observation only.

---

### FINDINGS SUMMARY

| # | Severity | Location | Finding | Blocker? |
|---|---|---|---|---|
| F-1 | 🟡 LOW (pre-existing) | `adapter.ts:127–214` | `parseMermaid` is 88 lines, exceeds ~40-line guideline | No — pre-existing, 9 lines added by this phase |
| F-2 | 🟡 LOW (pre-existing) | `adapter.ts:176` | `e as { message?: string; hash?: { line?: number } }` lacks a type-guard function | No — pre-existing, idiomatic for Mermaid's untyped errors |
| F-3 | ℹ️ INFO | `adapter.ts:192` | `PARSERS` object is reconstructed on every `parseMermaid` call (no module-level cache) | No — no regression; diagram parsing is not a hot path |

All three findings are **pre-existing** or **informational only**. None are introduced by Phase C changes. None block Phase E.

---

### VERDICT: ✅ PASS

All five requirement changes (REQ-R2 through REQ-R6) are correctly implemented and match their tests exactly. Type checker is clean. No banned patterns introduced. Architecture constraints respected. Test suite: 625/625 passing.

**Phase E (user approval) may proceed.**
