## Code Review — Wave 7 (diff_snapshots GAP-G2 ergonomics)

### Overall assessment: **FAIL**

The GAP-G2 direction is good and mostly implemented cleanly (error shape extension, pre-flight branch, and relay-level enrichment). However, there is one correctness issue in the pre-flight gating logic and one test-quality gap that should be fixed before calling this production-ready.

---

## Required fixes

1. **Whitespace snapshot IDs are treated as “explicit”, causing incorrect pre-flight behavior**
   - **File:** `packages/browser/src/diff-tool.ts:605`, `packages/browser/src/diff-tool.ts:629`
   - **Issue:** Pre-flight uses raw truthiness checks (`if (args.fromSnapshotId && ...)`, `if (args.toSnapshotId && ...)`).
     - But IDs are normalized earlier (`normalizeSnapshotId`) where whitespace-only input is treated as omitted.
     - Result: a value like `"   "` is incorrectly treated as explicit by pre-flight even though it should be omitted.
     - This can short-circuit with a false `snapshot-not-found` in sessions where the resolved page has retained snapshots.
   - **Fix:** gate pre-flight on normalized-explicit flags, e.g.:
     - `const hasExplicitFrom = normalizeSnapshotId(args.fromSnapshotId) !== undefined;`
     - `const hasExplicitTo = normalizeSnapshotId(args.toSnapshotId) !== undefined;`
     - Use these booleans in place of raw `args.*SnapshotId` checks.

2. **Test claims relay-level `availableSnapshotIds` behavior but does not assert it**
   - **File:** `packages/browser/src/__tests__/diff-tool.test.ts:944-966`
   - **Issue:** Test name says relay-level `snapshot-not-found` includes `availableSnapshotIds`, but assertion only checks `details?.reason`.
   - **Fix:** assert the actual contract:
     - `expect(error.details?.availableSnapshotIds).toEqual(expect.arrayContaining(["page-g2d:5", "page-g2d:6"]));`
     - This prevents false-green if that field regresses.

---

## Notes / suggestions

- **Interface design is good:** `details.availableSnapshotIds?: string[]` is the right placement and field name is clear.
- **`listAvailableSnapshotIds` parsing is reasonable:** using `lastIndexOf(":")` is correct for `{pageId}:{version}` and robust if `pageId` contains colons.
- **Pre-flight trigger condition (`available.length > 0`) is appropriate:** it avoids masking transient/remote truth when local store has no page context.
- **Minor maintainability suggestion:** pre-flight `from`/`to` branches are duplicated; consider extracting a helper to reduce drift risk.

---

## Coverage assessment of the 5 new GAP-G2 tests

What is covered well:
- explicit stale `fromSnapshotId` pre-flight short-circuit
- explicit stale `toSnapshotId` pre-flight handling
- recovery hints include available IDs
- no pre-flight short-circuit when store has no page snapshots
- relay-level path exercised

What is missing:
- whitespace-only explicit ID edge case (normalization vs pre-flight explicit detection)
- relay-level contract assertion for `availableSnapshotIds` presence

---

## Validation run results (for this review session)

- `pnpm test -- src/__tests__/diff-tool.test.ts` → pass (suite green)
- `pnpm typecheck` → pass
- ESLint on the two touched files reported they are ignored by current config (no actionable lint result for these files)
