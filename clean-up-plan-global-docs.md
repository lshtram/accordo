# Global Documentation Cleanup Plan

## A. Establish canonical active doc structure

### Canonical active roots
- [ ] Make these the only clearly active top-level doc lanes:
  - `docs/README.md`
  - `docs/00-workplan/workplan.md`
  - `docs/00-workplan/accomplished-tasks.md`
  - `docs/10-architecture/`
  - `docs/20-requirements/`
  - `docs/30-development/`
  - `docs/40-testing/`
  - `docs/40-reviews/` **or** `docs/reviews/` (choose one active review root)
- [ ] Make every other location clearly historical or generated-supporting only

### Docs governance policy
- [ ] Add a `docs-governance.md` (or equivalent) defining:
  - active vs draft vs superseded vs archived
  - canonical folder for each doc type
  - review/test-guide/module-map placement rules
  - naming/status metadata rules

## B. Fix top-level index truthfulness

### `docs/README.md`
- [ ] Rewrite it as a strict router/index, not a mixed status/planning/history doc
- [ ] Update current-priority references to match `docs/00-workplan/workplan.md`
- [ ] Remove or clearly demote removed module references from the active path
- [ ] Link to one canonical architecture index and one canonical requirements index

### `docs/20-requirements/README.md`
- [ ] Make this the authoritative requirements router
- [ ] Fix package classification drift across modules:
  - `accordo-marp`
  - `accordo-md-viewer`
  - `accordo-diagram`
  - `accordo-voice`
  - comments package ownership
- [ ] Include all active requirements docs that are currently missing from the index
- [ ] Remove or relocate archived/removed requirements docs from the active index
- [ ] Ensure each row’s package identity matches the file header and actual package

### `docs/10-architecture/architecture.md`
- [ ] Keep it as the canonical cross-module architecture doc
- [ ] Remove or mark clearly any legacy/historical sections that read like current state
- [ ] Normalize command naming and active package/tool ownership references
- [ ] Reduce dependency on archive docs for understanding active architecture

## C. Unify tool-contract truth

### Global tool catalog
- [ ] Create one canonical generated or maintained tool catalog doc containing:
  - tool name
  - owning package
  - public/internal status
  - command/tool family
  - current count per package
- [ ] Stop hardcoding tool counts in multiple READMEs/requirements/module maps unless sourced from this catalog

### Naming normalization
- [ ] Normalize active docs to the canonical command/tool naming conventions:
  - underscore MCP tool names where applicable
  - dotted internal command names where applicable
- [ ] Remove stale dotted-name examples where underscore is canonical
- [ ] Remove stale underscore deferred command examples where dotted internal command is canonical

## D. Collapse review sprawl

### Choose one active review root
- [ ] Decide whether active reviews live in:
  - `docs/reviews/`, or
  - `docs/40-reviews/`
- [ ] Move or reindex the other as non-canonical

### Archive review consolidation
- [ ] Collapse review history into one clearly historical archive lane
- [ ] Reduce overlap between:
  - `docs/reviews/archive/`
  - `docs/50-reviews/`
  - `docs/60-archive/reviews/`
  - `docs/90-archive/reviews/`
- [ ] Mark older reviews as historical evidence, not current gate state

### Current-review visibility
- [ ] Ensure each active module has one obvious current review location
- [ ] Avoid duplicate filenames across active and archive trees where possible

## E. Collapse testing-guide sprawl

### Choose one active testing-guide root
- [ ] Make `docs/40-testing/` the canonical active testing-guide location
- [ ] Move or reindex root-level `docs/testing-guide-*.md` files
- [ ] Move or reindex `docs/30-development/testing-guide-*.md` files that are really active test guides

### Archive testing guides
- [ ] Move clearly historical/manual batch guides into a single archive testing area
- [ ] Avoid active-looking testing guide names outside the canonical testing folder

### Active testing guide index
- [ ] Add a `docs/40-testing/README.md` index listing active guides by module/domain

## F. Clean workplan area

### `docs/00-workplan/`
- [ ] Keep only active planning/state docs in the main workplan folder
- [ ] Move old handoffs/session notes out of `00-workplan/` into archive/history
- [ ] Keep `workplan.md` as the only current-state plan
- [ ] Keep `accomplished-tasks.md` as the only completion ledger

### Removed capability handling
- [ ] Add a small tombstone/retired-modules index for removed surfaces (e.g. script)
- [ ] Update `accomplished-tasks.md` so removed capabilities don’t read like still-active product commitments

## G. Module-map cleanup

### Module map placement and role
- [ ] Decide whether module maps are:
  - active maintained docs, or
  - design snapshots/historical aids
- [ ] If active, move them under a single architecture/module-maps area
- [ ] If not actively maintained, demote/archive them instead of leaving them as active-looking root docs

### Module-map refresh sweep
- [ ] Refresh stale active module maps to current package layout and ownership
- [ ] Remove references to non-existent files and outdated abstraction boundaries

## H. Requirements directory cleanup

### Active vs archived requirements
- [ ] Keep only active requirement specs in `docs/20-requirements/`
- [ ] Move removed/archived requirement docs out of the active directory, including likely candidates such as:
  - `requirements-script.md`
  - `requirements-narration-plugin.md`
  - legacy browser requirement docs if superseded

### Package ownership matrix
- [ ] Add one central matrix mapping every active requirements doc to:
  - owning package
  - status
  - canonical architecture doc
  - canonical testing guide

## I. Decisions / ADR cleanup

### `docs/decisions.md`
- [ ] Decide whether to keep the monolith or split into ADR-style files
- [ ] Preferred: split into `docs/10-architecture/decisions/DEC-xxx-*.md`
- [ ] Mark superseded decisions clearly and link current ones from an index

## J. Status metadata / lintable standards

### Add status metadata to active docs
- [ ] Require active docs to include at least:
  - Status
  - Owner
  - Last reviewed
  - Canonical for
  - Supersedes / Superseded by
- [ ] Apply this especially to:
  - architecture docs
  - requirements docs
  - testing guides
  - review docs
  - module maps

### Docs linting / validation
- [ ] Add a docs validation pass for:
  - broken local links
  - active docs referencing archive paths as canonical
  - stale package classification in requirements index
  - duplicate active review filenames
  - archived docs living in active folders

## Recommended execution order
1. choose canonical active roots for reviews and testing guides
2. fix `docs/README.md`, `docs/20-requirements/README.md`, and `docs/10-architecture/architecture.md`
3. create a single tool catalog + package ownership matrix
4. clean `docs/00-workplan/` active vs historical split
5. relocate or demote root-level module maps and testing guides
6. move removed/archived requirements out of active requirements folder
7. consolidate reviews/testing archives and add status metadata/linting
