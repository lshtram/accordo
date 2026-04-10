## Review — parallel-edge-routing — Phase D2

**Date:** 2026-04-04  
**Reviewer:** Reviewer agent  
**Files reviewed:**
- `packages/diagram/src/canvas/edge-router.ts`
- `packages/diagram/src/canvas/canvas-generator.ts`
- `packages/diagram/src/layout/auto-layout.ts`
- `packages/diagram/src/__tests__/canvas-generator.test.ts`
- `packages/diagram/src/__tests__/edge-router.test.ts`

---

### PASS

- **Tests:** 613 passing, zero failures (`pnpm test` in `packages/diagram`)
- **Type check:** `tsc --noEmit` — zero errors
- **Linter:** No `eslint.config.mjs` exists in `packages/diagram` — linter is not configured for this package. No linting was performed. (Pre-existing gap, not introduced by this change.)
- **No `any`, no `type: ignore`, no debug logs in new code**
- **No TODO/FIXME added without justification**
- **Conventional commits style present in recent history**

---

### FAIL — must fix before Phase E

The following issues were found in the implementation. They are ordered by severity.

---

#### FAIL-1 — `edge-router.ts:242-243` — Perpendicular offset formula is geometrically wrong for the general case

**What is wrong:**

```typescript
const perpX = len > 0 ? Math.abs(dy) / len : 0; // always non-negative
const perpY = len > 0 ? Math.abs(dx) / len : 0; // always non-negative
```

The absolute-value trick is **only correct when the edge is axis-aligned (pure horizontal or pure vertical)**. For a diagonal edge between nodes A and B, the 90° CCW perpendicular of direction `(dx, dy)` is `(-dy, dx)`. For the reversed direction `(-dx, -dy)` the perpendicular is `(dy, -dx)`. These two perpendiculars point in **opposite geometric directions** — that is the correct geometric behaviour: they diverge from opposite sides.

The `Math.abs()` trick collapses both perpendiculars to `(|dy|, |dx|)`. For a purely horizontal edge `(dy=0)` this correctly produces `(0, 1)` and `(0, -1)` for the two signs, which is visually correct. For a purely vertical edge `(dx=0)` it produces `(1, 0)` for both — which means *both edges shift in the same direction* (the positive-x direction). That is also geometrically wrong for the vertical case.

For a diagonal edge at 45° with `dx = dy = L/√2`, `Math.abs(dy)/len = Math.abs(dx)/len = 1/√2`, so both components equal and the "perpendicular" vector is `(1/√2, 1/√2)` — which is actually the **same direction as the edge itself**, not perpendicular.

**The correct approach** to get a shared geometric perpendicular for both A→B and B→A is:

1. Canonicalize the direction before computing the perpendicular. Sort the two node IDs lexicographically and always compute `(dx, dy)` from the "lesser" node to the "greater" node regardless of which direction the specific edge runs.
2. Use the standard perpendicular `(-dy, dx)` of that canonical direction.
3. Apply `perpOffset` (which can be positive or negative per the existing sorting logic) to that single canonical perpendicular.

This guarantees both edges of a bidirectional pair get the same perpendicular vector, and the sign of `perpOffset` separates them on opposite sides.

**What the fix should be:**

```typescript
// Canonicalize direction so A→B and B→A both use the same perpendicular.
const canonFrom = edge.from < edge.to ? sc : tc;
const canonTo   = edge.from < edge.to ? tc : sc;
const cdx = canonTo[0] - canonFrom[0];
const cdy = canonTo[1] - canonFrom[1];
const clen = Math.sqrt(cdx * cdx + cdy * cdy);
// Standard 90° CCW perpendicular of the canonical direction.
const perpX = clen > 0 ? -cdy / clen : 0;
const perpY = clen > 0 ?  cdx / clen : 0;
```

Then apply `perpOffset` unchanged. The existing `side * magnitude * (PARALLEL_OFFSET / 2)` already produces the correct sign separation.

---

#### FAIL-2 — `canvas-generator.ts:371-372` — Label x,y placed at first-to-last midpoint, not the visual midpoint of a bent arrow

**What is wrong:**

```typescript
const midX = (pts[0]![0] + pts[pts.length - 1]![0]) / 2;
const midY = (pts[0]![1] + pts[pts.length - 1]![1]) / 2;
```

When a waypoint is inserted (3-point arrow: start, waypoint, end), the first-to-last midpoint is the geometric midpoint of the *span* of the path, not the midpoint along the *arc* of the path. For a bent arrow the visual center is the midpoint of total arc length. For the inserted label waypoint at `pts[1]`, the visual center is more accurately approximated by the waypoint itself (or the midpoint of segment 0→1 and segment 1→2).

More critically: the label is positioned relative to the **absolute** span, but the arrow origin `(ox, oy)` is `pts[0]` (line 295-296). The `relPoints` subtraction makes the arrow element start at `pts[0]` and the label `x, y` are in absolute coords. These can be inconsistent when the inserted waypoint causes the visible arc center to diverge significantly from the first-to-last midpoint.

For the bidirectional case specifically: both labels (A→B "go" and B→A "back") will be placed at the midpoint of the same geometric span (since start/end nodes are the same), so they will coincide at the same `(midX, midY)` unless the perpendicular shift in `computeLabelWaypoint()` moves them apart. The perpendicular shift in `computeLabelWaypoint` does move `mx` and `my` by `perpX * offset + horizShift`, but this computed position is discarded — the label uses the unshifted first-to-last midpoint. This means **the computed label waypoint shift has no effect on label position**; the two labels will still stack on top of each other.

**What the fix should be:**

Use the `labelWp` computed by `computeLabelWaypoint()` directly as the label position (it already has the correct perpendicular offset applied), instead of recomputing a separate unshifted midpoint:

```typescript
// In the edge label block:
const labelPos = labelWp ?? [midX, midY] as [number, number];
elements.push({
  ...
  x: labelPos[0],
  y: labelPos[1],
  ...
});
```

---

#### FAIL-3 — `canvas-generator.ts:310-315` — Waypoint inserted into already-offset path, causing double-offset

**What is wrong:**

```typescript
finalAbsPoints = [
  absPoints[0],
  labelWp,
  ...absPoints.slice(1),
];
```

`absPoints` already has both its start and end points shifted by `perpOffset` (from `routeAuto`). `labelWp` is computed from `absPoints[0]` and `absPoints[pts.length-1]` (which are the already-offset endpoints), then applies a *second* perpendicular shift. So the label waypoint is offset perpendicular **twice**: once because it is derived from the already-offset endpoints, and a second time by `perpX * offset`.

The inserted waypoint is then one of the three points of the arrow, affecting how Excalidraw renders the bend. For a 50px edge offset + 15px label offset the arrow will bend 15px extra away from the natural path. For opposing edges this is opposite extra-bends, making the visual curve asymmetric.

**What the fix should be:**

Compute `labelWp` from the **original unshifted** start/end (i.e., from `clampToBorder` outputs before `perpOffset` is applied) and apply only the label offset, OR accept the double-offset is intentional and document that the label waypoint is the visual midpoint of the already-offset arc (in which case FAIL-2 must be addressed separately).

---

#### FAIL-4 — `edge-router.ts:135-161` — Self-loop sibling detection uses wrong match condition

**What is wrong:**

```typescript
const selfLoopSiblings = allEdges.filter(
  (e) => e.from === edge.from && e.to === edge.to,
);
```

For a self-loop `edge.from === edge.to === "A"`. This filter correctly finds all `A→A` edges. However, `routeSelfLoop` is entered when `isSameBox(source, target)` is true, which is a **geometric** test (same bounding box coordinates), not a logical test (`edge.from === edge.to`). Two different nodes that happen to have the same layout position (e.g., overlapping stateStart markers) would be treated as a self-loop even if `edge.from !== edge.to`. In that case the sibling filter would return only edges between those specific node IDs, not all nodes sharing that box, which may produce the wrong `idx`.

This is a pre-existing latent defect that was not introduced by this change, but the refactoring of `routeSelfLoop` to accept `EdgeInfo` makes it worth noting.

**Severity:** Low / pre-existing. No fix required for this review cycle, but should be tracked.

---

#### FAIL-5 — `canvas-generator.ts:385-388` — `containerId: undefined` is wrong for label attachment in Excalidraw

**What is wrong:**

```typescript
containerId: undefined,
```

The comment says labels must NOT use `containerId` because it auto-centers. However, the `ExcalidrawElement` type probably defines `containerId` as `string | null | undefined`. Excalidraw's JSON format treats `containerId: undefined` (field absent) differently from `containerId: null` (explicitly unbound). Most serializers (`JSON.stringify`) will **drop** fields with `undefined` values, so this is equivalent to omitting the field, which is fine. But if `ExcalidrawElement` has `containerId?: string | null`, the explicit `undefined` on a required-absent field may cause Excalidraw to still attempt to resolve the container. 

The safer and more explicit form is `containerId: null` (explicit null = no container, not inherited).

**What the fix should be:**

```typescript
containerId: null,
```

---

#### FAIL-6 — `auto-layout.ts:301` — Global `rankSpacing` reduction to 40 affects all diagram types

**What is wrong:**

```typescript
rankSpacing: options?.rankSpacing ?? 40,
```

The previous default was 80. This was halved globally affecting `flowchart`, `classDiagram`, `stateDiagram-v2`, and `erDiagram`. The user-reported symptom is that some diagrams are now too compressed while others still have excessive spacing. This is because the 40px default only resolves the visual overcrowding for diagrams with small node sizes (e.g., `stateStart`/`stateEnd` at 30×30px), but compresses diagrams with tall nodes (rectangles at 60px height + 40px rank gap leaves barely any whitespace).

The root cause of excessive spacing in state diagrams with composite states is that edges to/from **cluster nodes** are silently skipped (line 173 filter: `clusterIds.has(edge.from) || clusterIds.has(edge.to)`) while dagre still places the ranks for those nodes. This means the rank count inflates without visual benefit, causing vertical bloat unrelated to `rankSpacing`.

Halving `rankSpacing` globally is the wrong lever. Per-type defaults are a better approach.

**What the fix should be:**

Restore the global default to 80 (or 60) and add a per-type override:

```typescript
const PER_TYPE_RANK_SPACING: Partial<Record<string, number>> = {
  "stateDiagram-v2": 50,
};

const opts: Required<LayoutOptions> = {
  rankdir:     options?.rankdir     ?? typeDefaultRankdir,
  nodeSpacing: options?.nodeSpacing ?? 60,
  rankSpacing: options?.rankSpacing ?? (PER_TYPE_RANK_SPACING[parsed.type] ?? 80),
};
```

This preserves adequate spacing for flowcharts and class diagrams while tightening state diagrams.

---

### Test Coverage Gaps

These tests are missing and should be added:

| Missing test | Requirement |
|---|---|
| **ER-auto-bidirectional-separation**: Two bidirectional `"auto"` edges (A→B and B→A) without labels → the two paths do NOT share any point (they are visually separated). Currently only tested indirectly through CG-36 (which checks ≥3 points but not that the two arrows are offset from each other). | Validates the core visual fix. |
| **ER-auto-parallel-same-direction**: Two same-direction edges A→B:0 and A→B:1 → both paths exist and do NOT overlap (they receive offset in opposite perpendicular directions). | Validates the multi-edge case. |
| **CG-label-at-offset-position**: For a bidirectional labeled pair, the two label text elements have different `x` or `y` values (they are not coincident). | Validates FAIL-2 after fix. |
| **ER-auto-vertical-separation**: Two bidirectional `"auto"` edges on a purely vertical arrangement (nodes at same `x`, different `y`) → the two paths are offset horizontally. This is the case the `Math.abs` trick breaks (see FAIL-1). | Specific regression test for the fix. |

---

### Summary

| Item | Status |
|---|---|
| Tests: 613 passing, zero failures | ✅ PASS |
| Type check: zero errors | ✅ PASS |
| Linter: not configured for this package | ⚠️ PRE-EXISTING |
| No banned patterns (any, debug logs, hardcoded config) | ✅ PASS |
| Architectural constraints (no VSCode imports, no cross-layer) | ✅ PASS |
| FAIL-1: Perpendicular formula wrong for non-horizontal edges | ❌ FAIL |
| FAIL-2: Label positioned at unshifted midpoint, ignoring computed offset | ❌ FAIL |
| FAIL-3: Double-offset in label waypoint insertion | ❌ FAIL |
| FAIL-4: Self-loop sibling match on geometric equality (pre-existing, low severity) | ⚠️ NOTE |
| FAIL-5: `containerId: undefined` should be `null` | ❌ FAIL |
| FAIL-6: Global rankSpacing reduction affects all diagram types incorrectly | ❌ FAIL |
| Missing tests for bidirectional offset separation | ❌ FAIL |

**Verdict: FAIL — must fix FAIL-1 through FAIL-3, FAIL-5, FAIL-6, and add missing tests before Phase E.**

Return to developer (FAIL-1, FAIL-2, FAIL-3, FAIL-5, FAIL-6) and test-builder (missing tests). Re-review after fixes.
