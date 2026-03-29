# Testing Guide — M100-SNAP (Snapshot Versioning)

**Module:** M100-SNAP  
**Packages:** `packages/browser-extension`, `packages/browser`  
**Requirements:** B2-SV-001..B2-SV-007 (`docs/requirements-browser2.0.md`)  
**Date:** 2026-03-28

---

## Section 1 — Automated Tests

The module is covered by two test suites: one in `browser-extension` (core/versioning + runtime relay/content behavior) and one in `browser` (tool-boundary contract + retention integration).

### Commands run

```bash
# Focused M100 snapshot suite
cd /data/projects/accordo-browser2.0/packages/browser-extension
pnpm exec vitest run tests/snapshot-versioning.test.ts

# Browser package full suite (includes snapshot-retention integration tests)
cd /data/projects/accordo-browser2.0/packages/browser
pnpm test
```

### Results from this run

- `packages/browser-extension/tests/snapshot-versioning.test.ts`: **42 passed, 0 failed**
- `packages/browser` full suite: **142 passed, 0 failed**

### Coverage map (requirement-level)

| Requirement | Primary tests / suites | What is verified |
|---|---|---|
| **B2-SV-001** snapshotId on all data-producing responses | `snapshot-versioning.test.ts` + `page-understanding-tools.test.ts` | `snapshotId` exists and format is `{pageId}:{version}` for page map, inspect, excerpt, and capture paths |
| **B2-SV-002** monotonic version IDs | `snapshot-versioning.test.ts` | version increases strictly and by +1 between consecutive snapshots |
| **B2-SV-003** full `SnapshotEnvelope` | `snapshot-versioning.test.ts` + strengthened runtime assertions | `pageId`, `frameId`, `snapshotId`, `capturedAt`, `viewport`, `source` present and valid on runtime responses |
| **B2-SV-004** 5-slot retention FIFO | `snapshot-versioning.test.ts` + `snapshot-retention.test.ts` | per-page FIFO retention, eviction, newest-first listing, not-found for pruned snapshots, shared runtime retention wiring |
| **B2-SV-005** navigation reset semantics | `snapshot-versioning.test.ts` + `snapshot-retention.test.ts` | version reset + retention clear on top-level navigation path |
| **B2-SV-006** stable `nodeId` within snapshot | `snapshot-versioning.test.ts` (runtime tool-level) | repeated inspect by `nodeId` returns consistent element identity semantics |
| **B2-SV-007** experimental `persistentId` behavior | `snapshot-versioning.test.ts` | unchanged elements retain IDs, changed content can alter IDs, stability threshold behavior validated |

---

## Section 2 — User Journey Tests

This module has no standalone UI. It is user-visible through agent/browser workflows because it enriches browser MCP responses.

### Journey 1 — Snapshot metadata appears on every browser understanding call

**Steps (as a user in Accordo chat):**
1. Ask the agent to call `browser_get_page_map`.
2. Ask it to call `browser_inspect_element` on a visible selector.
3. Ask it to call `browser_get_dom_excerpt` for the same selector.
4. Ask it to call `browser_capture_region`.

**Expected result:**
- Every response includes `snapshotId`.
- Every response includes full envelope fields: `pageId`, `frameId`, `capturedAt`, `viewport`, `source`.

### Journey 2 — Version increments across calls on the same page

**Steps:**
1. Trigger two consecutive `browser_get_page_map` calls.
2. Compare the two `snapshotId` values.

**Expected result:**
- Same `pageId` prefix.
- Second version number is greater than the first.

### Journey 3 — Version resets after navigation

**Steps:**
1. Call one browser understanding tool and note `snapshotId`.
2. Navigate to a different page/tab URL.
3. Call `browser_get_page_map` again.

**Expected result:**
- New call returns a low version index (reset behavior).
- Previous page snapshots are not reused.

### Journey 4 — Stable node targeting path

**Steps:**
1. Call `browser_get_page_map` and obtain a node reference / nodeId path.
2. Inspect that element twice using the same node identity.

**Expected result:**
- Both inspections resolve to the same element identity context.
- Snapshot versions can differ, but identity semantics remain stable.

### Journey 5 — Agent can reason about state changes safely

**Steps:**
1. Ask agent to perform a small action that changes page state.
2. Ask for another map/inspect call.

**Expected result:**
- Agent uses newer `snapshotId` values and does not treat stale snapshots as current.
- The response metadata is sufficient to explain "before vs after" ordering.
