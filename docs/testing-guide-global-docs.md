# Testing Guide — Global Docs Cleanup

## 1) Automated checks

This cleanup batch is documentation-only. No runtime/package source behavior changed.

Validation performed from outside the repo root (`/tmp`):

1. Canonical docs existence check
   - Command executed:
     - `test -f ...` checks for all newly introduced canonical index/governance files
   - Result: `docs-index-check: ok`

## 2) User journey checks

1. **Find current work status quickly**
   - Open `docs/README.md`.
   - Follow link to `docs/00-workplan/workplan.md`.
   - Expected: user reaches the active plan without searching archives.

2. **Find active requirements ownership**
   - Open `docs/20-requirements/README.md`.
   - Follow to `ownership-matrix.md`.
   - Expected: each active requirements doc has a clear owning package and architecture/testing pointers.

3. **Find active reviews and testing guides**
   - Open `docs/reviews/README.md` and `docs/40-testing/README.md`.
   - Expected: clear separation between active roots and historical lanes.
