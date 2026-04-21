# Browser Cleanup Review (2026-04-21)

## Summary

This cleanup reconciled browser-module docs with the current tool surface and shared-relay architecture, normalized MCP tool naming in requirements language, and refreshed browser testing guides with current commands/counts.

## Completed fixes

1. **Module map alignment to current browser architecture**
   - Updated `docs/module-map-browser.md` to better match active code ownership:
     - added shared-relay support modules (`relay-discovery.ts`, `write-lease.ts`)
     - clarified control-tool ownership (`control-tool-types.ts` canonical, `control-tools.ts` barrel)
     - documented deprecated `browser-tools.ts` as legacy/test-only (not active MCP registration)
   - Kept `tool-assembly.ts` as explicit composition root.

2. **Requirements naming normalization**
   - Updated `docs/20-requirements/requirements-browser-mcp.md` date to `2026-04-21`.
   - Normalized requirement prose to consistently use `accordo_browser_*` MCP tool names (instead of mixed unprefixed names).

3. **Browser focus-thread command drift cleanup**
   - Updated `docs/10-architecture/comments-panel-architecture.md` to use the current browser focus command `accordo_browser.focusThread` (dot-form VS Code command), replacing stale underscore wording.

4. **Testing-guide command/count refresh**
   - Updated `docs/testing-guide-shared-browser-relay.md`:
     - replaced stale absolute paths with repo-root `pnpm --filter ...` commands
     - updated shared-relay subset expectation to **116 tests / 6 files**
     - updated full browser suite expectation to **1142 tests / 41 files**
   - Updated `docs/testing-guide-browser-pagination.md`:
     - replaced stale path-based commands with repo-root `pnpm --filter ...` commands
     - updated full-suite expectations to **1142/41** (`accordo-browser`) and **1271/52** (`browser-extension`)

## Validation

Executed from a different working directory (`/tmp`) to verify command robustness:

- `pnpm --dir /home/liorshtram/projects/accordo --filter accordo-browser test` ✅ (1142 passing)
- `pnpm --dir /home/liorshtram/projects/accordo --filter accordo-browser typecheck` ✅
- `pnpm --dir /home/liorshtram/projects/accordo --filter accordo-browser lint` ✅
- `pnpm --dir /home/liorshtram/projects/accordo --filter browser-extension test` ✅ (1271 passing)
- `pnpm --dir /home/liorshtram/projects/accordo --filter browser-extension typecheck` ✅
- `pnpm --dir /home/liorshtram/projects/accordo --filter browser-extension lint` ✅

Focused guide-validation subsets:
- `pnpm --dir /home/liorshtram/projects/accordo --filter accordo-browser exec vitest run src/__tests__/text-map-tool.test.ts src/__tests__/page-understanding-tools.test.ts` ✅ (193 passing)
- `pnpm --dir /home/liorshtram/projects/accordo --filter browser-extension exec vitest run tests/relay-page-map-frames.test.ts` ✅ (16 passing)
- `pnpm --dir /home/liorshtram/projects/accordo --filter accordo-browser exec vitest run src/__tests__/relay-discovery.test.ts src/__tests__/shared-relay-server.test.ts src/__tests__/shared-relay-client.test.ts src/__tests__/write-lease.test.ts src/__tests__/relay-onrelay.test.ts src/__tests__/shared-relay-feature-flag.test.ts` ✅ (116 passing)
