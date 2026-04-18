## Review — diag-2-6-upstream-placement — Phase D2

### PASS
- Tests: `pnpm test` in `packages/diagram` → **998 passing, 0 failing**.
- Type check: `pnpm typecheck` in `packages/diagram` → **clean**.
- Lint: `pnpm lint` runs and returns clean for this package (`no lint configured yet`).
- Placement-only boundary and reopen/view path remain intact (`loadAndPost` continues using persisted layout + `host:load-scene`; no regression introduced by this change set).
- Debug instrumentation is gated and safe by default (`layout-debug.ts` defaults OFF and logs only when explicitly enabled).

### FAIL — must fix before Phase E
- `packages/diagram/src/layout/element-mapper.ts:93-97` + `packages/diagram/src/layout/state-identity.ts:63-106` — **SUP-S02 not fully satisfied**: pseudostate identity matching is implemented but not reachable in production path because `extractGeometry()` filters out label-less circles before state matching runs. Result: `matchStatePseudostates()` receives no pseudostate geometries and initial/final states fall back to dagre instead of upstream shape+position matching. **Fix:** ensure state path can see pseudostate geometries (e.g., include small unlabeled circles for `stateDiagram-v2`, or run pseudostate extraction before label filtering).
- `packages/diagram/src/layout/state-identity.ts:117-134` — **SUP-S03 convention mismatch**: cluster mapping for state diagrams writes raw upstream group bounds directly, but requirement/architecture call for same `CLUSTER_MARGIN` + `CLUSTER_LABEL_HEIGHT` convention as dagre. **Fix:** normalize state cluster bounds using the same margin/label-height policy (or reuse shared cluster normalization logic) while preserving nested parent mapping.
- `packages/diagram/src/__tests__/state-placement.test.ts` (coverage gap) — tests assert pseudostates are “defined”, but do not prove upstream pseudostate coordinates are used, so regression above is not caught. **Fix:** add assertion-level tests that verify pseudostates map to expected upstream coordinates and do not silently pass via dagre fallback.
