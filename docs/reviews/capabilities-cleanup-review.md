# Capabilities Cleanup Review (2026-04-21)

## Summary

This cleanup reconciled `@accordo/capabilities` contract docs/comments/tests with the package’s current real surface: stable command/constants + minimal runtime registry factory + deferred (non-stable) type contracts that are root type-exported for convenience.

## Completed fixes

1. **Root contract comment alignment (`packages/capabilities/src/index.ts`)**
   - Removed incorrect “No runtime code” claim.
   - Clarified minimal runtime scope (`createNavigationAdapterRegistry` re-export).
   - Clarified deferred type re-export policy in source comments.

2. **Deferred contract wording cleanup (`packages/capabilities/src/deferred.ts`)**
   - Replaced stale “not yet wired” language.
   - Clarified deferred status as non-stable contracts that may still be root type-exported.

3. **README cleanup (`packages/capabilities/README.md`)**
   - Updated deferred-surface explanation to match current root type-export behavior.
   - Fixed MCP naming example drift (`accordo_comment_list` example).

4. **Foundation policy doc update (`docs/30-development/capabilities-foundation-phase-a.md`)**
   - Updated status wording from proposed-only to implemented-baseline reference.
   - Reconciled deferred-interface policy: deferred contracts must live in `deferred.ts`; root type re-export is allowed but remains non-stable.

5. **Testing guide alignment (`docs/testing-guide-capabilities-foundation.md`)**
   - Updated assertions to describe actual current policy and runtime-scope guarantees.

6. **Test wording cleanup (`packages/capabilities/src/__tests__/*`)**
   - `capabilities-foundation.test.ts`: REQ-6 wording now enforces “no active root interface declaration” (while allowing type re-export).
   - `navigation-registry.test.ts`: removed stale “adapter missing” narrative; descriptions now reflect current guarantees only.

## Validation

Executed from a different working directory (`/tmp`):

- `pnpm --dir /home/liorshtram/projects/accordo --filter @accordo/capabilities test` ✅ (85 passing)
- `pnpm --dir /home/liorshtram/projects/accordo --filter @accordo/capabilities build` ✅
- `pnpm --dir /home/liorshtram/projects/accordo --filter accordo-comments test` ✅ (509 passing)
- `pnpm --dir /home/liorshtram/projects/accordo --filter accordo-comments typecheck` ✅
- `pnpm --dir /home/liorshtram/projects/accordo --filter accordo-comments lint` ✅ (`no lint configured yet`)
