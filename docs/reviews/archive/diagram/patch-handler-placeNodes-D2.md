# Review — patch-handler-placeNodes — Phase D2

**Date:** 2026-03-31  
**Module:** `patchHandler` + `placeNodes` integration  
**Files changed:**
- `packages/diagram/src/types.ts` — `ReconcileResult.diagram` field added
- `packages/diagram/src/reconciler/reconciler.ts` — `diagram: newDiagram` added to return
- `packages/diagram/src/tools/diagram-tool-ops.ts` — `placeNodes()` call inserted before `writeLayout()`  
**Reviewer:** Reviewer agent

---

## Review — patch-handler-placeNodes — Phase D2

### PASS

- **Tests:** 515 passing, zero failures (`pnpm test` output captured)
- **Type check:** `pnpm typecheck` — zero errors (both host and webview tsconfig)
- **Lint:** `pnpm lint` — echoes "no lint configured yet" (no linter configured for this package — pre-existing)
- **Banned patterns:** zero `any`, zero `@ts-ignore`/`@ts-nocheck`, zero `console.log`, zero new `TODO`/`FIXME` in changed lines
- **Non-null assertions:** none in changed code
- **Unsafe casts:** none — `as const` only (line 320, pre-existing), `as string` (pre-existing renderHandler code, not in scope)
- **Architecture constraints:** `placeNodes` is a pure function in `packages/diagram/` — no VSCode imports, no Hub boundary crossed. `diagram-tool-ops.ts` correctly imports from `"../reconciler/placement.js"`. No handler functions serialized.
- **Modularity:** the new block (lines 337–360) is 23 lines, well within the 40-line function guideline. `patchHandler` is 149 lines total which is above the soft 40-line guideline for functions — but this is pre-existing, the fix added only 23 lines and the function was already 126 lines before.
- **Replaceability:** `placeNodes` is behind its own module boundary. Swapping the placement algorithm requires only changes to `placement.ts`.

---

### FAIL — must fix before Phase E

#### F-1 (CRITICAL) — `reconcileResult.diagram` truthy guard is redundant but hides a type inconsistency

**File:** `packages/diagram/src/tools/diagram-tool-ops.ts:342`  
**Code:**
```typescript
if (trueUnplaced.length > 0 && reconcileResult.diagram) {
```

`ReconcileResult.diagram` is typed as `diagram: ParsedDiagram` (non-optional, line 379 of `types.ts`). The `&& reconcileResult.diagram` check is therefore always `true` and the TypeScript compiler silently accepts it. The problem is the *inconsistency*: if the type is non-optional, the guard adds dead code noise and suggests uncertainty about whether the field might be absent. If the intention is to keep a safety net for future changes, the field should be marked optional (`diagram?: ParsedDiagram`) — but that creates a different problem (callers must handle the undefined case).

**Fix:** Remove the `&& reconcileResult.diagram` guard. The condition should be:
```typescript
if (trueUnplaced.length > 0) {
  const placed = placeNodes(trueUnplaced, reconcileResult.diagram, finalLayout);
```
Since `ReconcileResult.diagram` is non-optional by the type contract, this is correct and type-safe. The defensive guard was appropriate when the field was optional (as it was in the review doc's proposed interface), but the final implementation made it required.

**Severity:** Low (no runtime impact, no correctness risk), but it violates the "no redundant truthy guard on non-nullable types" rule from coding-guidelines §1.1 and will confuse future readers.

---

#### F-2 (CRITICAL) — Tests DT-53..DT-58 are missing

**File:** `packages/diagram/src/__tests__/diagram-tools.test.ts`  
**Detail:** See `docs/reviews/patch-handler-placeNodes-B.md` for full gap analysis.

The new `placeNodes()` integration in `patchHandler` has zero dedicated tests. All six
required tests (DT-53..DT-58) are absent. The existing 515 tests do not exercise:

- That `layout.unplaced[]` is cleared in the written `layout.json` after adding nodes
- That new nodes appear in `layout.nodes` with valid x/y/w/h coordinates
- That the `trueUnplaced` filter correctly excludes nodes already positioned by `nodeStyles`
- That the `else if` branch clears `unplaced[]` when all unplaced nodes were pre-positioned

**Fix:** Write DT-53..DT-58 as described in `docs/reviews/patch-handler-placeNodes-B.md`.
Tests must pass with the current implementation and fail if the `placeNodes()` block
(lines 337–360 of `diagram-tool-ops.ts`) is removed.

**Severity:** High — the core bugfix is untested.

---

### Observations (non-blocking)

1. **`patchHandler` function length (149 lines):** Pre-existing issue. The new 23-line block did not push it over any hard limit but the function is long. A future refactor extracting `resolvePlacement(finalLayout, diagram)` would improve readability.

2. **`diagram-tool-ops.ts` file length (522 lines):** Over the 200-line soft guideline. Pre-existing. Not introduced by this change.

3. **`diagram-tool-ops.ts` imports `ParsedDiagram` from `../types.js`** (line 28) — this import was added but `ParsedDiagram` is not directly used in the new code (it's used indirectly through `ReconcileResult.diagram`). The import may be dead. Verify whether removing it causes a type error. If it does not, it should be removed.

---

### Checklist Summary

| Item | Status |
|---|---|
| Tests pass — 515/515 | ✅ PASS |
| Type checker clean | ✅ PASS |
| Linter clean (no linter configured) | ✅ N/A |
| Coding guidelines — no `any`, no debug logs, no hardcoded values | ✅ PASS |
| Test completeness — DT-53..DT-58 present | ❌ FAIL |
| Banned patterns scan — none found | ✅ PASS |
| Architecture constraints — no VSCode in hub, no handlers on wire | ✅ PASS |
| Runtime exposure — no new MCP tool, patch tool unchanged | ✅ N/A |
| Modularity — function/file size within limits | ⚠️ Pre-existing oversize (not introduced by this change) |
| Replaceability — `placeNodes` behind module boundary | ✅ PASS |
| Redundant truthy guard on non-nullable `diagram` field | ❌ FAIL (low severity) |

---

### Decision

**FAIL — return to developer/test-builder to fix F-1 and F-2 before Phase E.**

F-1 (remove redundant `&& reconcileResult.diagram` guard) — developer fix, 1 line.  
F-2 (write DT-53..DT-58) — test-builder fix, ~60 lines of tests.

Re-review after both fixes are applied and `pnpm test` is green.
