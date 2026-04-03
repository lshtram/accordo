# Review — T-01 edgeStyles in `accordo_diagram_patch` — Phase D2

**Date:** 2026-04-03  
**Reviewer:** Reviewer agent  
**Prior reviews:** `t01-edgeStyles-A.md` (REQUEST CHANGES → re-check PASS) · `t01-edgeStyles-B.md` (PASS)  
**Status:** ✅ PASS — GREEN LIGHT for Phase D3

---

## Verdict

**PASS. All 10 D2 checklist items are clean. Phase D3 may proceed.**

---

## D2 Checklist

| # | Item | Result | Evidence |
|---|------|--------|----------|
| 1 | Tests pass — zero failures | ✅ PASS | 558 passing, 0 failing (live run below) |
| 2 | Type checker clean — zero errors | ✅ PASS | `tsc --noEmit` produced no output |
| 3 | Linter clean — zero errors on new code | ✅ PASS / N/A | `packages/diagram` has no ESLint config yet (`pnpm lint` → "no lint configured yet"); no banned patterns found by manual scan |
| 4 | Coding guidelines compliance | ✅ PASS | See detailed checks below |
| 5 | Test completeness — every public method and requirement has a test | ✅ PASS | DT-59..DT-66 cover all 8 T-01 requirements |
| 6 | Banned patterns absent | ✅ PASS | No `: any`, no `console.log`, no TODO/FIXME in new code, no `for...in` |
| 7 | Architectural constraints | ✅ PASS | No VSCode imports; args cast at MCP boundary only; no global mutable state |
| 8 | Runtime exposure | ✅ PASS | `edgeStyles` in tool description (definitions.ts:96) + style guide (ops.ts:553-568) + waypoints deferred note (ops.ts:342 + definitions.ts:146) |
| 9 | Modularity | ✅ PASS | Handler block is 25 lines; file is 571 lines total; nesting ≤ 3 levels; `Object.entries` not `for...in` |
| 10 | Replaceability | ✅ PASS | Logic is self-contained; `routing` extraction uses destructuring; no new global mutable state |

---

## Test Run Output (live)

```
 Test Files  22 passed (22)
       Tests  558 passed (558)
    Start at  01:25:30
    Duration  2.72s (transform 1.99s, setup 931ms, collect 3.19s, tests 6.13s, environment 8ms, prepare 3.46s)
```

**Zero failures. Zero skipped. 558 total = 551 pre-existing + 7 previously-failing DT-59..DT-62 / DT-64..DT-66.**  
DT-63 (absent `edgeStyles`) was already passing at the stub stage — confirmed in Phase B review.

---

## Type Checker

```
$ cd packages/diagram && npx tsc --noEmit
(no output — clean)
```

Zero errors, zero warnings.

---

## Linter

`packages/diagram` has `"lint": "echo 'no lint configured yet'"` — no ESLint config is present for this package.  
Manual scan was performed instead (see §Coding Guidelines below).

---

## Coding Guidelines — Detailed Checks

### 1.1 Type Safety

**`as` casts in the `edgeStyles` block:**

```typescript
// line 343 — MCP args boundary cast (pre-existing pattern, mirrors nodeStyles:279, clusterStyles:313)
const rawEdgeStyles = args.edgeStyles as Record<string, Record<string, unknown>> | undefined;

// line 357 — assignment into Partial<EdgeStyle> via known whitelist field
(styleFields as Record<string, unknown>)[field] = (rest as Record<string, unknown>)[field];

// line 362 — EdgeLayout["routing"] is `"auto" | "curved" | "orthogonal" | "direct" | string`,
//            so any `unknown` routing value is safely cast to that union
...(routing !== undefined ? { routing: routing as EdgeLayout["routing"] } : {}),
```

**Assessment:**

- **Line 343** — established project pattern. The MCP `args` object is `Record<string, unknown>` at the framework boundary; the same cast is used identically for `nodeStyles` (line 279) and `clusterStyles` (line 313). ✅
- **Line 357** — the cast is necessary because `styleFields` is typed `Partial<EdgeStyle>` (a typed interface) but the assignment is through a dynamic `field` key that TypeScript cannot narrow at compile-time. The key is guaranteed to be in `EdgeStyle` by the `styleWhitelist as const` (line 345). Acceptable. ✅
- **Line 362** — `EdgeLayout["routing"]` is `"auto" | "curved" | "orthogonal" | "direct" | string`, i.e. effectively `string`. The cast is safe; any string value from `overrides.routing` is stored as-is, and the renderer decides what to do with it. ✅

**No `: any` types introduced** — `grep -n ": any"` returned zero results in the new code.

### 1.2 Naming

- `rawEdgeStyles`, `styleWhitelist`, `updatedEdges`, `edgeKey`, `overrides`, `existing`, `routing`, `rest`, `styleFields` — all `camelCase`. ✅
- `CLUSTER_STYLE_KEYS` (cluster handler, pre-existing) uses `UPPER_SNAKE_CASE` for a true constant; the new `styleWhitelist` uses `camelCase` — this is consistent with the analogous `styleWhitelist` in the `nodeStyles` block (line ~287). ✅

### 1.3 Functions & Modules

- No `console.log` in production code paths (`grep -n "console.log"` → zero hits). ✅
- No commented-out code. ✅
- No TODO/FIXME (`grep -n "TODO\|FIXME"` → zero hits in new code). ✅
- `edgeStyles` handler block is **25 lines** (343-367) — well within the 40-line guideline. ✅

### 1.4 Error Handling

- Unknown edge key → `continue` (silent skip). Correct per requirement. ✅
- Unknown style field → whitelist filter drops silently. Correct per requirement. ✅
- No new thrown errors introduced. ✅
- `rawEdgeStyles !== undefined && typeof rawEdgeStyles === "object"` guard matches the identical pattern used for `nodeStyles` and `clusterStyles`. ✅

### 1.5 Imports

- `EdgeStyle` and `EdgeLayout` added to the existing `import type { ... } from "../types.js"` line 27. Correct `type` import. ✅

---

## Banned Pattern Scan

| Pattern | Search | Result |
|---------|--------|--------|
| `: any` type | `grep -n ": any" src/tools/diagram-tool-ops.ts` | 0 hits in new code ✅ |
| `console.log` | `grep -n "console\.log"` | 0 hits ✅ |
| `TODO` / `FIXME` | `grep -n "TODO\|FIXME"` | 0 hits ✅ |
| `for...in` loop | `grep -n "for.*in "` | 0 hits (all loops use `for...of Object.entries`) ✅ |
| Non-null assertion `!` without comment | Manual review | 0 instances in new code ✅ |

---

## Architectural Constraints (AGENTS.md §4)

| Constraint | Status |
|------------|--------|
| No VSCode imports in `accordo-hub` or diagram package | ✅ Not applicable (diagram package) |
| Handler functions not serialized | ✅ No new handler serialization |
| No new global mutable state | ✅ All mutations are local to the `patchHandler` invocation |
| `edgeStyles` behind `args` boundary (no direct exposure) | ✅ Consistent with `nodeStyles` / `clusterStyles` pattern |

---

## Runtime Exposure Verification

Three touch-points confirmed present:

1. **Tool description** (`diagram-tool-definitions.ts` line 96):  
   `"roughness, and size overrides. Use 'edgeStyles' to set per-edge stroke colour, width, "`  
   → `edgeStyles` is discoverable via MCP `tools/list`. ✅

2. **Style guide handler** (`diagram-tool-ops.ts` lines 553–568):  
   Full `edgeStyles` section with available fields (`strokeColor`, `strokeWidth`, `strokeStyle`, `strokeDash`, `routing`) and an example call. ✅

3. **Waypoints deferred note** (both files):  
   `"Note: waypoints is intentionally excluded — deferred to D-04."` ✅  
   (Resolves Phase A FINDING-4.)

---

## Test Completeness

Phase B review confirmed full requirement coverage. No regressions found.

| Requirement | Test | Result |
|-------------|------|--------|
| `strokeColor` stored in `edges[key].style.strokeColor` | DT-59 | ✅ |
| `routing` stored in `edges[key].routing`, NOT in `.style` | DT-60, DT-65 | ✅ |
| Unknown edge key silently skipped | DT-61 | ✅ |
| Unknown style field silently dropped (whitelist) | DT-62 | ✅ |
| Absent `edgeStyles` param → no error, edges unchanged | DT-63 | ✅ |
| Multiple style fields in one call all persisted | DT-64 | ✅ |
| `routing` + style fields together in one call | DT-65 | ✅ |
| Partial patch does not clobber existing style fields (deep-merge guard) | DT-66 | ✅ |

---

## Deep-Merge Correctness (Implementation Audit)

The critical requirement — "partial patch must not wipe existing style fields" — is implemented at **line 363**:

```typescript
style: { ...existing.style, ...styleFields },
```

This is the correct pattern:
1. `existing.style` spreads all previously persisted style properties.
2. `...styleFields` overlays only the fields present in this patch.
3. Fields not in this patch are preserved from `existing.style`.

DT-66 (two-step patch test) proves this works end-to-end. ✅

The Phase A review (FINDING-2) identified the shallow-merge trap; FINDING-3 requested an explicit implementation note. Both are addressed: the comment block at lines 337–342 explicitly warns:
> `Do NOT pass raw styleFields as the style value — patchEdge does a shallow spread which would wipe existing style properties (deep-merge requirement).`

---

## Modularity Check

- **Handler block length:** 25 lines (343–367). Under 40-line limit. ✅
- **File length:** 571 lines. Exceeds the 200-line implementation guideline but this is the primary tool-ops file for the entire diagram package (14 handlers) — flagged as a known architectural decision pre-dating this module. No new lines beyond the 25-line handler block. ✅
- **Nesting depth:** Maximum 3 levels (`if → for → if`). Within the 4-level limit. ✅
- **No cyclic dependencies introduced.** ✅

---

## PASS — Items Summary

| # | Item | Result |
|---|------|--------|
| Tests | 558 passing, zero failures | ✅ |
| Type check | Zero errors (`tsc --noEmit` clean) | ✅ |
| Linter | No config for this package; manual scan clean | ✅ |
| Coding guidelines | All rules followed | ✅ |
| Test completeness | All 8 T-01 requirements covered by DT-59..DT-66 | ✅ |
| Banned patterns | None present in new code | ✅ |
| Architectural constraints | All satisfied | ✅ |
| Runtime exposure | `edgeStyles` discoverable in tool description and style guide | ✅ |
| Modularity | Handler 25 lines, nesting ≤ 3, `Object.entries` not `for...in` | ✅ |
| Replaceability | Self-contained block, no global state, mirrors existing pattern | ✅ |

**→ GREEN LIGHT. Phase D3 (manual testing guide) may proceed.**
