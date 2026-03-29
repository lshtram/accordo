# Testing Guide — M101-DIFF (`browser_diff_snapshots`)

**Module:** M101-DIFF  
**Packages:** `packages/browser-extension`, `packages/browser`  
**Requirements:** B2-DE-001..B2-DE-007 (`docs/requirements-browser2.0.md`)  
**Date:** 2026-03-28

---

## Section 1 — Automated tests

The module is covered by a focused extension suite (diff engine + relay action) and browser tool suite (MCP tool boundary behavior).

### Commands run

```bash
# Extension-side M101 tests
cd /data/projects/accordo-browser2.0/packages/browser-extension
pnpm exec vitest run tests/diff-engine.test.ts tests/relay-actions-diff.test.ts

# Browser package M101 tests
cd /data/projects/accordo-browser2.0/packages/browser
pnpm exec vitest run src/__tests__/diff-tool.test.ts src/__tests__/snapshot-retention.test.ts
```

### Results from this run

- `packages/browser-extension` (2 files): **32 passed, 0 failed**
- `packages/browser` (2 files): **52 passed, 0 failed**

### What these tests verify

| Requirement | Verification |
|---|---|
| **B2-DE-001** | Tool is registered as safe/idempotent and callable through browser tool layer |
| **B2-DE-002** | Diff engine returns `added`, `removed`, `changed` arrays correctly for snapshot comparisons |
| **B2-DE-003** | Implicit `toSnapshotId` flow resolves via fresh capture behavior path |
| **B2-DE-004** | Implicit `fromSnapshotId` flow resolves to previous snapshot behavior path |
| **B2-DE-005** | Summary fields (`addedCount`, `removedCount`, `changedCount`, `textDelta`) align with diff output |
| **B2-DE-006** | Missing snapshot IDs return `snapshot-not-found` |
| **B2-DE-007** | Stale snapshots after navigation return `snapshot-stale` |

---

## Section 2 — User journey tests

These are manual end-to-end checks from a user perspective (using Accordo chat + live browser session).

### Journey 1 — Compare two known snapshots

1. Ask the agent to call `browser_get_page_map` (snapshot A).
2. Make a visible change on the page (expand section, open a panel, etc.).
3. Ask for another `browser_get_page_map` (snapshot B).
4. Ask the agent to call `browser_diff_snapshots` with `fromSnapshotId=A`, `toSnapshotId=B`.

**Expected:** response includes `added`, `removed`, and/or `changed` arrays, plus summary counts and `textDelta`.

### Journey 2 — Implicit "to" snapshot

1. Get one snapshot ID via `browser_get_page_map`.
2. Ask the agent to call `browser_diff_snapshots` with only `fromSnapshotId`.

**Expected:** tool succeeds by taking a fresh current snapshot as `to`, then returns diff + summary.

### Journey 3 — Implicit "from" snapshot

1. Get a current snapshot ID.
2. Ask the agent to call `browser_diff_snapshots` with only `toSnapshotId`.

**Expected:** tool resolves previous snapshot for `from` and returns a valid diff response.

### Journey 4 — Error semantics for missing/stale snapshots

1. Call `browser_diff_snapshots` with a fake ID (`page:99999`) for from or to.
2. Navigate to a different page/tab context and try to diff using an old snapshot ID.

**Expected:**
- fake/evicted IDs return `snapshot-not-found`
- pre-navigation stale IDs return `snapshot-stale`

### Journey 5 — No-change scenario

1. Collect two snapshots with no meaningful page changes between them.
2. Diff them.

**Expected:** empty or near-empty `added/removed/changed` arrays and summary showing no significant change (`textDelta` indicates no changes).
