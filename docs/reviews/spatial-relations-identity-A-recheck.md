# Review — spatial-relations-identity — Phase A Re-check

**Date:** 2026-04-26
**Reviewer:** Reviewer agent
**Verdict:** FAIL — one blocker remains before implementation

## PASS
- **Blocker 1 closed:** `nodeIds[]` validation is now explicit enough at the contract level: array-only, every member numeric/finite/integer/`>= 0`, and any malformed member fails the whole request with `invalid-request`.
- The added malformed-`nodeIds[]` test cases close the previously missing coverage for string/float/negative/`null` members.
- The browser-package modular split direction is now explicit and consistent with the modularity gate for the currently oversized `packages/browser/src/spatial-relations-tool.ts`.
- The overall behavioral contract remains coherent: required `snapshotId`, no mixed identity modes, same-frame `uids[]`, main-frame-only `nodeIds[]`, current-owner-only live geometry, and explicit `snapshot-stale` / `snapshot-not-found` propagation.

## FAIL — must fix before implementation
- `docs/30-development/coding-guidelines.md:75` — The `snapshotId` validator is still not truly single-source-of-truth. The adjusted plan says the browser package owns a canonical validator, but the browser-extension will keep a package-local `snapshotId` format check that only “reuses the same grammar contract.” That still defines the same runtime meaning in two places, which conflicts with the project SSOT rule. **Done when:** the plan names one canonical runtime owner for `snapshotId` grammar/validation and shows how both browser and browser-extension consume that single implementation without violating package-boundary rules.

## Required adjustments
1. Resolve the remaining `snapshotId` SSOT issue with a concrete ownership model:
   - one canonical runtime validator implementation
   - both packages consume that implementation
   - no duplicated parser/grammar logic
   - no violation of `bridge-types` being types-only or other architecture constraints
2. Add explicit malformed non-finite `nodeIds[]` test coverage (`NaN`/`Infinity`-style runtime cases) so the new “finite” rule is exercised, not just stated.

## Approved implementation scope (after fix above)
- Require `snapshotId` end-to-end for `get_spatial_relations`.
- Keep the fixed validation/error precedence exactly as specified.
- Reject mixed `nodeIds[]` + `uids[]` with `invalid-request`.
- Enforce `uids[]` same-frame only and `nodeIds[]` main-frame only.
- Use page-map-owner snapshot registry/current-owner classification for `snapshot-stale` vs `snapshot-not-found`.
- Preserve partial-success behavior for unresolved identities under valid current-owner snapshots.
- Preserve current live-DOM geometry behavior only for current-owner requests.
- Update public error typing, recovery hints, runtime-facing schema/tool text, and architecture docs.
- Keep scope narrow: no historical geometry replay, no retained-snapshot bbox store, no retention redesign, no unrelated page-map behavior changes.
