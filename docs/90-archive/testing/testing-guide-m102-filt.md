# Testing Guide — M102-FILT (`browser_get_page_map` filtering)

**Module:** M102-FILT  
**Packages:** `packages/browser-extension`, `packages/browser`  
**Requirements:** B2-FI-001..B2-FI-008 (`docs/requirements-browser2.0.md`)  
**Date:** 2026-03-28

---

## Section 1 — Automated tests

### Commands run

```bash
# Extension filtering behavior + collector integration
cd /data/projects/accordo-browser2.0/packages/browser-extension
pnpm exec vitest run tests/page-map-filters.test.ts tests/page-map-collector.test.ts

# Browser-side tool schema/forwarding for filter args
cd /data/projects/accordo-browser2.0/packages/browser
pnpm exec vitest run src/__tests__/page-understanding-tools.test.ts
```

### Results from this run

- `browser-extension` (2 files): **179 passed, 0 failed**
- `browser` (1 file): **86 passed, 0 failed**

### Requirement coverage

| Requirement | Verified by | What it validates |
|---|---|---|
| **B2-FI-001** visibleOnly | `page-map-filters.test.ts`, `page-map-collector.test.ts` | viewport visibility filtering at predicate + collector runtime level |
| **B2-FI-002** interactiveOnly | `page-map-filters.test.ts`, `page-map-collector.test.ts` | interactive element detection (native interactive tags, ARIA roles, `onclick` property) and collector output narrowing |
| **B2-FI-003** roles | `page-map-filters.test.ts`, `page-map-collector.test.ts` | explicit + implicit role matching and runtime role filtering |
| **B2-FI-004** textMatch | `page-map-filters.test.ts`, `page-map-collector.test.ts` | case-insensitive text filtering and collector-level filtered payload |
| **B2-FI-005** selector | `page-map-filters.test.ts`, `page-map-collector.test.ts` | CSS selector filtering, invalid selector handling, runtime selector-filtered output |
| **B2-FI-006** regionFilter | `page-map-filters.test.ts`, `page-map-collector.test.ts` | bbox intersection filtering and collector-level region restriction |
| **B2-FI-007** AND composition | `page-map-filters.test.ts`, `page-map-collector.test.ts` | combined filters require all active predicates to pass; descendant promotion behavior validated |
| **B2-FI-008** payload reduction | `page-map-filters.test.ts`, `page-map-collector.test.ts` | real collector benchmark fixtures verify >=40% average reduction using filtered vs unfiltered results |

Additionally, `page-understanding-tools.test.ts` verifies MCP-facing schema and forwarding of all six filter arguments to relay payloads.

---

## Section 2 — User journey tests

These checks are designed for a non-technical user interacting with Accordo through the normal chat/agent workflow (with browser extension active).

### Journey 1 — Only visible items in current viewport

1. Ask the agent to run `browser_get_page_map` with `visibleOnly: true`.
2. Scroll down significantly.
3. Ask for `browser_get_page_map` again with `visibleOnly: true`.

**Expected:** the returned node set changes to match what is currently visible after scrolling.

### Journey 2 — Interactive controls only

1. Ask the agent to run `browser_get_page_map` with `interactiveOnly: true`.
2. Ask it to summarize returned controls.

**Expected:** output is mostly links/buttons/inputs/interactive widgets; non-interactive text blocks are largely excluded.

### Journey 3 — Focus by text and role

1. Ask for `browser_get_page_map` with `textMatch: "sign in"`.
2. Ask again with `roles: ["button"]` and `textMatch: "sign in"`.

**Expected:** second call is narrower and returns only matching button-like elements containing/signaling that text.

### Journey 4 — Restrict to a page region

1. Ask for a page map with no filters.
2. Ask for `browser_get_page_map` with `regionFilter` targeting one part of the viewport.

**Expected:** filtered response only includes elements intersecting the selected region.

### Journey 5 — Combined filtering shrinks payload meaningfully

1. Ask the agent for unfiltered `browser_get_page_map` and note node count.
2. Ask again with combined filters (example: `visibleOnly + interactiveOnly + roles`).

**Expected:** filtered result is significantly smaller while still containing relevant actionable elements; the response includes `filterSummary` with reduction metrics.
