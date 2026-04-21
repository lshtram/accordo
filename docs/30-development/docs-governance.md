# Documentation Governance

**Status:** ACTIVE  
**Owner:** Accordo maintainers  
**Last reviewed:** 2026-04-21  
**Canonical for:** documentation status/lane rules and placement conventions

---

## 1) Active vs historical rules

### Active lanes (canonical)
- `docs/00-workplan/`
- `docs/10-architecture/`
- `docs/20-requirements/`
- `docs/30-development/`
- `docs/40-testing/`
- `docs/reviews/`

### Historical / archive lanes (non-canonical)
- `docs/40-reviews/`
- `docs/50-reviews/`
- `docs/60-archive/`
- `docs/90-archive/`

Historical docs may be cited as evidence, but active docs must not treat them as the primary contract source.

## 2) Canonical placement rules

- **Architecture docs:** `docs/10-architecture/`
- **Requirements docs:** `docs/20-requirements/`
- **Development standards/plans/patterns:** `docs/30-development/`
- **Active testing guides + index:** `docs/40-testing/`
- **Active reviews:** `docs/reviews/`
- **Archive reviews/evidence:** archive lanes only

## 3) Status metadata requirements

Active docs should include at least:
- Status
- Owner
- Last reviewed
- Canonical for
- Supersedes / superseded-by info when relevant

## 4) Naming conventions

- Lowercase kebab-case filenames (`*.md`)
- Keep `requirements-*.md`, `testing-guide-*.md`, `module-map-*.md` patterns consistent
- Do not create new active docs in archive lanes

## 5) Tool/command naming policy in docs

- MCP tools: use canonical registered names (e.g., underscore format where applicable)
- Internal VS Code commands: use canonical command IDs from owning package/capabilities constants
- When old names are referenced, mark them explicitly as historical

## 6) Review and testing-guide roots

- **Active reviews root:** `docs/reviews/`
- **Active testing-guide root:** `docs/40-testing/`

Root-level legacy `docs/testing-guide-*.md` files are transitional and should be indexed/migrated under `docs/40-testing/` over time.
