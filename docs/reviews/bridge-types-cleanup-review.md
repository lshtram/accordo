# Bridge Types Cleanup Review (2026-04-21)

## Summary

This cleanup aligned `@accordo/bridge-types` public surface, lint/build coverage, and documentation with current repository reality.

## Completed fixes

1. **Relay contract made canonical at package root**
   - `src/index.ts` now exports `relay-types.ts` symbols from the root barrel.
   - This aligns with root-only import policy and removes ambiguity about relay type ownership.

2. **Lint coverage corrected**
   - `eslint.config.mjs` now lints all `src/**/*.ts` files (excluding tests), including `src/relay-types.ts`.
   - Removed contradictory duplicate rule entries.

3. **Build/publish hygiene improved**
   - Added `tsconfig.build.json` excluding `src/__tests__/**`.
   - Build now uses `tsc -p tsconfig.build.json`.
   - After clean build, `dist/` no longer emits `__tests__/` artifacts.

4. **Contract tests updated**
   - `bridge-types.test.ts` now asserts barrel coverage includes `relay-types.js`.
   - Added contract assertion that relay shared types are available from root exports.

5. **Docs refreshed**
   - Updated package README constants/examples and consumer list.
   - Rewrote testing guide to current command coverage and scope.
   - Updated architecture package map to include `relay-types.ts`.
   - Marked old bridge-types review docs as historical where they contain superseded examples.

## Validation

- `pnpm --filter @accordo/bridge-types test` ✅ (11 passing)
- `pnpm --filter @accordo/bridge-types run typecheck` ✅
- `pnpm --filter @accordo/bridge-types run lint` ✅
- `pnpm --filter @accordo/bridge-types clean && pnpm --filter @accordo/bridge-types build` ✅
