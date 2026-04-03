# Review — S-04 (Edge Key Migration) + S-05 (BT/RL Direction Support) — Phase D2 Re-check

**Date:** 2026-04-02  
**Reviewer:** Reviewer agent  
**Prior review:** `docs/reviews/s04-s05-D2.md` (FAIL — 5 blocking issues)  
**Files under review:**
- `packages/diagram/src/reconciler/reconciler.ts` (S-04)
- `packages/diagram/src/reconciler/placement.ts` (S-05)
- `packages/diagram/src/__tests__/reconciler.test.ts` (S-04 tests)
- `packages/diagram/src/__tests__/placement.test.ts` (S-05 tests)

---

## Re-check: All 5 Prior Blocking Issues

### [S-04-F1] Edge key migration tests — ✅ FIXED

Three tests added to `reconciler.test.ts` inside the `reconcile — @rename annotations` describe block:

| Test ID | What it covers | Result |
|---|---|---|
| `S-04-F1` | `@rename` migrates edge routing when oldId is the `from` end | ✅ PASS |
| `S-04-F2` | `@rename` migrates edge routing when oldId is the `to` end | ✅ PASS |
| `S-04-F3` | `@rename` migrates self-loop edge when oldId appears as both `from` and `to` | ✅ PASS |

Each test verifies: (a) new key exists, (b) old key absent, (c) routing/waypoints/style data fully preserved.

---

### [S-04-F2] `EdgeLayout` top-level import — ✅ FIXED

`reconciler.ts` line 18:
```typescript
import type { LayoutStore, ReconcileResult, NodeId, EdgeLayout } from "../types.js";
```
No inline `import(...)` in type annotations anywhere in the changed code.

---

### [S-05-F1] Type signature includes BT and RL — ✅ FIXED

`placement.ts` line 82:
```typescript
direction?: "TD" | "LR" | "BT" | "RL";
```

---

### [S-05-F2] JSDoc updated — ✅ FIXED

`placement.ts` line 34:
```typescript
 * @param options.direction   Flow direction — "TD" (default), "LR", "BT", or "RL".
```

---

### [S-05-F3] BT and RL placement tests — ✅ FIXED

Two tests added to `placement.test.ts`:

| Test ID | What it covers | Result |
|---|---|---|
| `S-05-F1` | BT direction → node placed above anchor (`pos.y < anchor.y`) | ✅ PASS |
| `S-05-F2` | RL direction → node placed left of anchor (`pos.x < anchor.x`) | ✅ PASS |

---

## Full D2 Checklist

### 1. Tests pass

```
Test Files  22 passed (22)
     Tests  548 passed (548)
  Duration  2.92s
```

Zero failures. Zero skipped. All 5 new fix tests (S-04-F1, S-04-F2, S-04-F3, S-05-F1, S-05-F2) individually confirmed passing.

### 2. Type checker

```
$ tsc --noEmit
(no output — zero errors)
```

### 3. Linter

The `accordo-diagram` package does not have an ESLint config (`eslint.config.mjs` is absent — pre-existing condition, not introduced by this change). No linter run possible for this package. The same limitation applied to the prior review.

Manual banned-pattern scan performed instead (see §9 below).

### 4. Coding guidelines compliance

Checked against `docs/30-development/coding-guidelines.md`.

### 5. Test completeness

All 5 prior blocking test gaps are closed. The new code paths now have explicit tests:
- **Edge key migration loop** (reconciler.ts lines 119–136): covered by S-04-F1, S-04-F2, S-04-F3.
- **BT/RL fallback heuristic** (placement.ts lines 186–190): covered by S-05-F1, S-05-F2 (dagre first-pass also exercises BT/RL rankdir).
- **BT/RL collision-avoidance vectors** (placement.ts lines 201–203): covered transitively by S-05-F1, S-05-F2 (collision-avoidance pass runs for every placed node).

The self-loop case (S-04-F3) is a valuable edge case: renameMap correctly handles `from === to === oldId` because both sides are looked up independently via `renameMap.get(e.from)` and `renameMap.get(e.to)`.

### 6. Banned patterns

| Pattern | Found? |
|---|---|
| `: any` | ✅ None |
| `type: ignore` / `@ts-ignore` | ✅ None |
| `console.log` / `console.debug` in production code | ✅ None |
| `TODO` / `FIXME` (new) | ✅ None |
| Commented-out code | ✅ None |
| Hardcoded values that should be config | ✅ None |

**Non-null assertions** — carried over from prior review (non-blocking observations, unchanged):

| Location | Pattern | Justification |
|---|---|---|
| `reconciler.ts:112` | `movedEntry!` | Guarded by `if (layout.nodes[oldId] !== undefined)` on line 110; destructure always succeeds |
| `reconciler.ts:131–132` | `renameMap.get(from)!` / `renameMap.get(to)!` | Guarded by `.has(from)` / `.has(to)` in the same ternary expression |

Both are logically safe. Missing inline comment per §1.1 is a **minor** style observation, not a blocker.

### 7. Architectural constraints

- No VSCode imports in changed files ✅
- `reconcile()` and `placeNodes()` are pure functions (no I/O, no side effects) ✅  
- Both consume typed interfaces from `../types.js` — no cross-package boundary violations ✅

### 8. Runtime exposure

S-04 and S-05 fix internal reconciler logic only — they are not new MCP tools and require no registration/wiring changes. Runtime discoverability is not applicable for this fix set.

### 9. Modularity

Function size:
- `reconcile()`: ~117 code lines — pre-existing violation of the ~40-line guideline (§3.4). Not introduced by S-04 (which added ~18 lines of edge-key migration). Noted as pre-existing in the prior review.
- `placeNodes()`: ~137 code lines — pre-existing violation. Not introduced by S-05 (which added ~10 lines net). Noted as pre-existing in the prior review.

No new cross-layer imports introduced. No cyclic dependencies.

### 10. Replaceability

No new global mutable state. The `renameMap` and `oldEdgesForMatch` are function-scoped locals. The `rankdirMap` is a local const. All changes are composable with existing callers.

---

## PASS items

| Item | Detail |
|---|---|
| S-04-F1: edge migration — from end | ✅ New key `A2->B:0` created; old key `A->B:0` absent; routing/waypoints/style preserved |
| S-04-F2: edge migration — to end | ✅ New key `A->B2:0` created; old key `A->B:0` absent; style preserved |
| S-04-F3: self-loop migration | ✅ `A->A:0` → `A2->A2:0`; routing preserved |
| S-04: migration runs AFTER matchEdges setup | ✅ `oldEdgesForMatch` is built after the edge-key migration; `matchEdges` receives renamed edges |
| S-04: routing preserved through preserved map | ✅ `matchEdges` `preserved` map uses `oldKey` from the renamed `layout.edges`, preserving data end-to-end |
| S-04: `EdgeLayout` top-level import | ✅ Line 18 |
| S-05: type signature `"BT" \| "RL"` | ✅ Line 82 |
| S-05: JSDoc updated | ✅ Line 34 |
| S-05: BT test pass | ✅ `pos.y < 200` confirmed |
| S-05: RL test pass | ✅ `pos.x < 300` confirmed |
| S-05: 4-direction switch correctness | ✅ TD(cross=+x,flow=+y), BT(cross=+x,flow=−y), LR(cross=+y,flow=+x), RL(cross=+y,flow=−x) |
| S-05: `rankdirMap` correctness | ✅ TD→"TB", BT→"BT", LR→"LR", RL→"RL", fallback `?? "TB"` |
| Zero regressions | ✅ 548/548 pass |
| Type check clean | ✅ `tsc --noEmit` — 0 errors |
| No banned patterns | ✅ |

---

## Summary

**Status: ✅ PASS — all 5 prior blocking issues resolved. Phase E may proceed.**

All prior FAIL items from `s04-s05-D2.md` have been correctly fixed:

| ID | Original Issue | Status |
|---|---|---|
| S-04-F1 | No test for edge key migration on rename | ✅ Fixed — 3 tests added (S-04-F1, F2, F3) |
| S-04-F2 | Inline `import(...)` in type annotation | ✅ Fixed — `EdgeLayout` in top-level import |
| S-05-F1 | `options.direction` type missing `"BT"` and `"RL"` | ✅ Fixed |
| S-05-F2 | JSDoc `@param options.direction` only mentioned TD/LR | ✅ Fixed |
| S-05-F3 | No tests for `direction: "BT"` or `direction: "RL"` | ✅ Fixed — 2 tests added (S-05-F1, F2) |

Minor observations from the prior review (non-blocking) remain unchanged:
- Non-null assertions at `reconciler.ts:112,131–132` are logically safe but lack inline `// why null is impossible` comments per §1.1.
- `placeNodes()` and `reconcile()` both exceed the 40-line guideline — pre-existing, not introduced by these fixes.
