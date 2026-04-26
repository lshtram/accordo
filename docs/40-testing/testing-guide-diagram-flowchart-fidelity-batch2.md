# Testing Guide — diagram-flowchart-fidelity-batch2

**Package:** `accordo-diagram`  
**Module:** Flowchart Fidelity Batch 2 (routing/subgraph/attachment)  
**Phase:** D3  
**Date:** 2026-04-09

---

## Section 1 — Automated tests

All commands were executed in:

```bash
cd /data/projects/accordo/packages/diagram
```

### 1.1 Full package regression

```bash
pnpm test -- --run
```

**Result:** `842 passed, 0 failed`  
**Verifies:** Batch 2 routing/subgraph changes do not regress existing package behavior.

### 1.2 Type safety

```bash
pnpm typecheck
```

**Result:** clean (no TypeScript errors).

### 1.3 Batch 2 requirement suite

#### `src/__tests__/flowchart-fidelity-batch2.test.ts`

Verifies:
- **FC-06a..e:** curved routing implementation exists and is used as default flowchart routing (not aliased to auto).
- **FC-07a..h:** direction-aware attachment behavior (`TD/LR/RL/BT`), including fallback behavior.
- **FC-08a..e:** subgraph-targeted edges are retained and routed via correct cluster endpoint resolution.
- **FC-09a..c:** tangent-aware clamping for curved routing; non-curved modes remain stable.

### 1.4 Related integration updates

#### `src/__tests__/auto-layout.test.ts`
- Verifies flowchart edge routing defaults align with Batch 2 requirement path.

#### `src/__tests__/diagram-leaf-integration.test.ts`
- Verifies curved routing semantics are distinct from auto in integration path.

---

## Section 2 — User journey tests

### Journey 1 — Curved edge rendering (cases 28, 48, 49)
1. Open compare page and inspect cases 28, 48, 49.
2. **Expected:** Excalidraw output uses visibly curved routes (not all straight two-point arrows).

### Journey 2 — Direction coherence (case 33)
1. Open case 33 in compare and inspect edge entry/exit directions.
2. **Expected:** route attachment sides follow declared diagram direction more naturally (no obvious reversed side attachments).

### Journey 3 — Subgraph edge visibility (cases 35, 36)
1. Open cases 35 and 36.
2. **Expected:** edges involving subgraphs are no longer dropped; they appear and connect via the intended subgraph region.

### Journey 4 — Edge point quality on complex cases (48, 49)
1. Inspect where arrows meet source/target boundaries.
2. **Expected:** endpoints are more natural and less kinked for curved paths; non-curved behavior remains stable.

---

## Notes

- Lint command in this package currently remains a no-op; active quality gates are tests + typecheck.
- This module has direct user-visible behavior in diagram rendering and comparison outputs, so manual visual journeys are applicable.
