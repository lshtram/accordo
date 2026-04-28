# Review — spatial-relations-identity — Phase A Final Re-check

**Date:** 2026-04-26
**Reviewer:** Reviewer agent
**Verdict:** PASS — implementation-ready

## PASS
- The remaining Phase A blocker is closed. `snapshotId` grammar validation now has a single runtime owner in the browser-extension content-side helper.
- The browser package no longer duplicates canonical `snapshotId` grammar logic; it stays limited to public request-shape validation and preserves browser-extension `invalid-request` results as first-class public errors.
- This satisfies the single-source-of-truth rule while respecting package boundaries and the `bridge-types` types-only constraint.
- The added end-to-end malformed-string `snapshotId` test and `NaN`/`Infinity` `nodeIds[]` tests close the remaining coverage gaps.
- The modular split plan for the oversized browser tool file remains explicit and adequate for the modularity gate.

## Blocking issues
- None.

## Required adjustments
- None before implementation.

## Approved implementation scope
- Require `snapshotId` end-to-end for `get_spatial_relations`.
- Browser package validates request shape only; browser-extension owns canonical `snapshotId` grammar validation.
- Reject mixed `nodeIds[]` + `uids[]` with `invalid-request`.
- Enforce `uids[]` same-frame only and `nodeIds[]` main-frame only.
- Use content-side canonical UID validation and same-frame checks.
- Use page-map-owner snapshot registry/current-owner classification for `snapshot-stale` vs `snapshot-not-found`.
- Apply the fixed validation/error precedence exactly as specified.
- Preserve partial-success behavior for unresolved identities under valid current-owner snapshots.
- Preserve current live-DOM geometry behavior only for current-owner requests.
- Update public error typing, recovery hints, runtime-facing schema/tool text, and architecture docs.
- Keep scope narrow: no historical geometry replay, no retained-snapshot bbox store, no retention redesign, no unrelated page-map behavior changes.
