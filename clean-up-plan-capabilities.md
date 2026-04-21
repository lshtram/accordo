# Capabilities Module Cleanup Plan

## A. Must update

### `packages/capabilities/src/index.ts`
- [ ] Fix the top-level package comment so it no longer falsely claims “No runtime code” if runtime factory exports remain
- [ ] Clarify the real package surface:
  - stable commands
  - deferred commands
  - stable interfaces
  - deferred interfaces (if still root-exported)
  - navigation registry contracts/factory
- [ ] Reconcile root exports with the intended deferred-contract policy

### `packages/capabilities/src/deferred.ts`
- [ ] Update stale command comments to match current canonical command IDs
- [ ] Clarify whether these interfaces are truly deferred-only or part of the package’s supported surface
- [ ] Remove historical wording that no longer reflects current consumers/call paths

### `docs/30-development/capabilities-foundation-phase-a.md`
- [ ] Reconcile the Phase A design rules with the current implemented package
- [ ] Decide whether the package is still supposed to be “types/constants only”
- [ ] If runtime registry factory is intentional, update the doc
- [ ] Decide whether deferred interfaces may be root-exported
- [ ] If yes, update the doc and gates; if no, update the package/tests

### `docs/10-architecture/architecture.md`
- [ ] Update the navigation architecture section so it matches actual repo state
- [ ] Avoid claiming deferred fallback is effectively gone if router still uses it
- [ ] Make registry-first architecture clearly either:
  - current state, or
  - target state with remaining exceptions documented

## B. High-priority cross-module contract cleanup

### Browser focus command naming
- [ ] Choose one canonical browser focus command ID and freeze it repo-wide
- [ ] Align:
  - `packages/capabilities/src/index.ts`
  - `packages/browser/src/extension.ts`
  - `packages/comments/src/panel/navigation-router.ts`
  - architecture/docs/reviews/testing guides
- [ ] Remove or clearly deprecate the losing form

### Navigation contract truth source
- [ ] Create or update one canonical matrix for:
  - command ID
  - producer package
  - consumer package(s)
  - stable vs deferred status
  - adapter vs fallback path
- [ ] Make that matrix the source of truth for future reviews

## C. Should add / improve documentation

### `packages/capabilities/README.md`
- [ ] Expand README beyond a minimal import example
- [ ] Document:
  - package purpose
  - stable vs deferred surface
  - command naming conventions
  - navigation registry API
  - compatibility / deprecation expectations
  - which packages consume these contracts

### `docs/testing-guide-capabilities-foundation.md`
- [ ] Update test inventory to include all current test files
- [ ] Document what `navigation-registry.test.ts` protects
- [ ] Reconcile guide language with current package reality, not original foundation split only
- [ ] Verify that downstream validation commands are still the ones you actually want to advertise

### Missing requirements-style doc
- [ ] Decide whether `@accordo/capabilities` needs a formal requirements/spec doc under `docs/20-requirements/`
- [ ] If yes, add one for the package as a shared contract module

## D. Test cleanup candidates

### `packages/capabilities/src/__tests__/capabilities-foundation.test.ts`
- [ ] Remove stale “Phase B failing tests” wording
- [ ] Tighten tests to assert the actual intended deferred-export policy, not just source-shape loopholes
- [ ] Decide whether tests should enforce root-surface restrictions via real imports/exports rather than source text heuristics

### `packages/capabilities/src/__tests__/navigation-registry.test.ts`
- [ ] Remove stale comments claiming Marp adapter registration is still missing
- [ ] Rewrite descriptions to describe current guarantees only

### `packages/capabilities/src/__tests__/capability-commands.test.ts`
- [ ] Review overlap with `capabilities-foundation.test.ts`
- [ ] Either keep as a focused narrow test or merge/reduce duplication

## E. Governance / verification improvements

### Cross-package contract verification
- [ ] Add or document a repo-level verification step for command parity:
  - capabilities constants
  - producer registrations
  - consumer command usage
- [ ] Add a check for raw command-string drift where constants should be used
- [ ] Add a check for stable/deferred export policy consistency

### Shared-package policy clarity
- [ ] Update docs so contributors know whether `@accordo/capabilities` is frozen/minimal or allowed to evolve with small runtime helpers
- [ ] Make the editing policy explicit in one current place instead of scattering it across historical modularity docs

## F. Repo hygiene

### Generated/package-local artifacts
- [ ] Confirm `packages/capabilities/dist/**` is treated as generated output only
- [ ] Clean or ignore `packages/capabilities/tsconfig.tsbuildinfo`
- [ ] Clean or ignore package-local Vitest result artifacts under `node_modules/.vite/vitest/`

## G. Archive / review cleanup

### Review docs with stale current-state claims
- [ ] Revisit modularity/consolidation review docs that still describe old command mismatches as current
- [ ] Mark them historical where appropriate instead of letting them read like active state

### Planning docs overlap
- [ ] Decide which modularity/planning doc is canonical now:
  - `docs/30-development/capabilities-foundation-phase-a.md`
  - `docs/modularity-perfect-score-plan.md`
  - review docs
- [ ] Reduce overlap or mark superseded docs clearly

## Recommended execution order
1. Decide/fix canonical browser focus command ID
2. reconcile `src/index.ts` + `src/deferred.ts` with intended package policy
3. update `capabilities-foundation-phase-a.md`
4. update architecture section on navigation reality
5. expand `packages/capabilities/README.md`
6. refresh testing guide
7. tighten/clean tests
8. add cross-package contract verification guidance
9. clean generated artifacts / mark stale review docs historical
