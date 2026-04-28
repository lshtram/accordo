# Review — spatial-relations-identity — Phase A

**Date:** 2026-04-26
**Reviewer:** Reviewer agent
**Verdict:** FAIL — not implementation-ready yet

## PASS
- The chosen direction is coherent: explicit stale failure, no historical geometry replay, and a narrowed mixed-input contract.
- The plan correctly brings `snapshotId` into the request contract, preserves partial-success semantics for unresolved identities under the current owner, and explicitly includes public error propagation and runtime-facing docs updates.
- The plan acknowledges the modularity risk in the touched browser/browser-extension paths and requires splitting modified files/functions to stay within project limits.

## FAIL — must fix before implementation
- `packages/browser/src/page-tool-meta-types.ts:33` — The request contract is still underspecified for `nodeIds[]` element validation. The plan says `nodeIds` must be an array if present, but it does not explicitly require every entry to be a finite non-negative integer, nor does it state that any malformed entry fails the whole request with `invalid-request` instead of being filtered. **Done when:** the contract explicitly says `nodeIds[]` entries must each be integers `>= 0`, malformed entries fail the whole request as `invalid-request`, and focused tests cover malformed `nodeIds[]` members.
- `packages/browser-extension/src/content/spatial-relations-handler.ts:30` — “Shared / single-source-of-truth” validation is not yet implementable as written because the plan does not name where the runtime `snapshotId`/`uid` validators live without violating package boundaries (`bridge-types` is types-only; browser and browser-extension must not solve this with ad hoc duplicated parsers). **Done when:** the plan names the canonical validator ownership/modules for both packages and makes clear how both sides consume the same contract rules without cross-layer imports or logic in `@accordo/bridge-types`.

## Required adjustments
1. Add explicit `nodeIds[]` member validation rules and tests:
   - each entry must be a JSON number
   - finite
   - integer
   - `>= 0`
   - any bad member => whole-request `invalid-request`
2. Add explicit focused tests for malformed `nodeIds[]` entries (e.g. string, float, negative, `null`).
3. Name the concrete validator modules/files for canonical `snapshotId` and UID parsing/validation, and ensure the design respects package boundaries and the “bridge-types contains only types” rule.
4. As a modularity safeguard, name the intended extraction seams for the current 351-line `packages/browser/src/spatial-relations-tool.ts` before implementation starts (schema/input narrowing, relay handler, error mapping, contract text/constants, etc.).

## Approved implementation scope (after fixes above)
- Require `snapshotId` end-to-end for `get_spatial_relations`.
- Enforce the authoritative precedence pipeline exactly as listed.
- Support only one identity mode per request: main-frame `nodeIds[]` or same-frame `uids[]`; mixed mode rejects with `invalid-request`.
- Classify snapshots using page-map-owner snapshots only, with `snapshot-stale` vs `snapshot-not-found` preserved as first-class public errors and recovery hints.
- Preserve current live-DOM/partial-success behavior only for current-owner requests.
- Update runtime docs/schema/architecture wording and tests to match the final contract.
- Keep scope narrow: no historical bbox store, no retained-snapshot replay, no retention redesign, no unrelated page-map changes.
