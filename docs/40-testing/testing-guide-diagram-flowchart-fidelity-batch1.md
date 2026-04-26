# Testing Guide — diagram-flowchart-fidelity-batch1

**Package:** `accordo-diagram`  
**Module:** Flowchart Fidelity Batch 1 (cases 12, 13, 14, 16, 17, 19, 21, 29, 32)  
**Phase:** D3  
**Date:** 2026-04-08

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

**Result:** `819 passed, 0 failed`  
**Verifies:** Batch 1 fidelity fixes did not regress existing diagram functionality.

### 1.2 Type safety

```bash
pnpm typecheck
```

**Result:** clean (no TypeScript errors).

### 1.3 Batch 1 requirement suites

#### `src/__tests__/flowchart-fidelity.test.ts`

Verifies:
- **FC-01 (cases 12/13):** trapezoid orientation geometry is correct (normal vs inverse).
- **FC-02 (case 14):** circle nodes are enforced as true circles (`w === h`) with `Math.max` behavior.
- **FC-03 (cases 16/17/19/21):** edge labels are preserved and appear decoded in parse→canvas flow.
- **FC-04 (case 29):** cross marker mapping uses the documented Excalidraw approximation (`bar`) and is preserved through rendering data structures.
- **FC-05f/g (case 32 path integration):** decoded entities flow through parser and edge label paths.

#### `src/__tests__/decode-html.test.ts`

Verifies:
- **FC-05a:** decoder export exists and is callable.
- **FC-05b:** required named entities decode (`&amp;`, `&lt;`, `&gt;`, `&quot;`, `&#39;`).
- **FC-05c:** decimal entities decode (`&#NNN;`).
- **FC-05d:** hex entities decode (`&#xHHHH;`).
- **FC-05e:** unknown named entities remain unchanged.

---

## Section 2 — User journey tests

### Journey 1 — Case 12/13 trapezoid direction
1. Open `demo/flowchart-v2/flowchart-12.mmd` and `flowchart-13.mmd` in diagram panel.
2. Render both.
3. **Expected:**
   - Case 12 trapezoid has wider bottom face.
   - Case 13 inverse trapezoid has wider top face.

### Journey 2 — Case 14 true circle
1. Open `demo/flowchart-v2/flowchart-14.mmd`.
2. Render in panel.
3. **Expected:** shape is a true circle (no oval stretch).

### Journey 3 — Edge text visibility (cases 16/17/19/21)
1. Open each `.mmd` file for 16, 17, 19, 21.
2. Render and inspect edges with text labels.
3. **Expected:** label text appears on edge and is readable.

### Journey 4 — Cross endpoint mapping (case 29)
1. Open `demo/flowchart-v2/flowchart-29.mmd`.
2. Render and inspect arrow ends.
3. **Expected:**
   - circle end marker appears on `--o` edge.
   - cross-style endpoint is represented by Excalidraw `bar` approximation on `--x` edge.

### Journey 5 — Entity/emoji decode (case 32)
1. Open `demo/flowchart-v2/flowchart-32.mmd`.
2. Render diagram and inspect node/edge label text.
3. **Expected:** encoded entities are decoded in final labels (e.g., `#quot;` and numeric references resolve correctly instead of raw encoded strings).

---

## Notes

- Lint command exists but is currently a no-op in this package.
- This module has user-visible behavior in the diagram panel and compare outputs, so user journeys are applicable.
