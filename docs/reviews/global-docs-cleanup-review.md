# Global Docs Cleanup Review (2026-04-21)

## Scope reviewed

- `docs/README.md`
- `docs/20-requirements/README.md`
- `docs/20-requirements/ownership-matrix.md` (new)
- `docs/30-development/docs-governance.md` (new)
- `docs/30-development/tool-catalog.md` (new)
- `docs/40-testing/README.md` (new)
- `docs/reviews/README.md` (new)
- `docs/00-workplan/README.md` (new)
- `docs/00-workplan/retired-modules.md` (new)
- `docs/00-workplan/accomplished-tasks.md`

## Decisions made

1. **Canonical active review root:** `docs/reviews/`
2. **Canonical active testing-guide root:** `docs/40-testing/`
3. **Historical/non-canonical lanes remain readable** (`40-reviews`, `50-reviews`, `60-archive`, `90-archive`) but are explicitly marked non-primary.

## Findings addressed

- Top-level docs index was rewritten as a strict router (removed mixed/stale planning commentary).
- Requirements index was normalized to current package ownership language (`accordo-marp`, `accordo-md-viewer`, `accordo-diagram`, `accordo-voice`, `accordo-comments`).
- Added a package ownership matrix to reduce cross-doc drift.
- Added docs governance policy with active vs historical rules and placement conventions.
- Added one canonical tool catalog to reduce duplicated tool-count references.
- Added explicit retired-capability index (`accordo-script`).

## Deferred / intentionally not changed in this batch

- Historical files were not physically moved between archive lanes; this batch establishes canonical roots and indexing first.
- Root-level legacy `docs/40-testing/testing-guide-*.md` files remain and are documented as transitional.
