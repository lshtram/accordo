# Browser Extension Cleanup Review (2026-04-21)

## Summary

This cleanup aligned browser-extension requirements/architecture/module docs with the current runtime topology and transport model, refreshed stale testing evidence, and removed outdated workplan claims.

## Completed fixes

1. **Requirements alignment (`requirements-browser-extension.md`)**
   - Updated document date.
   - Corrected manifest contract note (commands present; icons omitted).
   - Reconciled comments-mode/context-menu wording with current in-page Add Comment flow.
   - Updated build contract to 4 output entry points (`service-worker.js`, `content-script.js`, `popup.js`, `shadow-tracker.js`).
   - Replaced stale create-tool naming with relay-action contract wording.
   - Normalized PU tool names to current `accordo_browser_*` MCP surface.

2. **Architecture cleanup (`browser-extension-architecture.md`)**
   - Bumped to v2.2 and updated status/date.
   - Removed stale “in progress / not yet forwarded” language around adapter/relay behavior.
   - Updated source-tree section to current file topology (`service-worker.ts`, `sw-lifecycle.ts`, `relay-*`, `content/*`, popup).
   - Corrected keyboard shortcut references to current `Alt+Shift+C` command.
   - Replaced stale “future relay integration” narrative with current active relay path.
   - Replaced outdated module-list section with current-runtime module inventory and pointer to canonical module map.

3. **Module map cleanup (`module-map-browser-extension.md`)**
   - Added `content/comment-ui.ts` as canonical runtime UI module.
   - Downgraded `content-pins.ts` to legacy/tests-only note (not primary runtime path).

4. **Requirements index cleanup (`docs/20-requirements/README.md`)**
   - Updated last-updated date.
   - Clarified authoritative browser-document reading order and active vs archival status.

5. **Workplan cleanup (`docs/00-workplan/workplan.md`)**
   - Updated date.
   - Removed stale hard-coded historical test-count text in Priority A bullets.
   - Updated current browser/browser-extension test totals in Priority A summary.

6. **Testing guide cleanup (`docs/40-testing/testing-guide-browser-tab-control.md`)**
   - Updated date and test-status totals to current baselines.
   - Refreshed expected output and evidence summary counts (`browser-extension` + `accordo-browser`).
   - Removed outdated environmental-failure note that no longer matches current runs.

## Validation

Validation executed from another working directory (`/tmp`):

- `pnpm --dir /home/liorshtram/projects/accordo --filter accordo-browser test` ✅ (1142 passing)
- `pnpm --dir /home/liorshtram/projects/accordo --filter browser-extension test` ✅ (1271 passing)
- `pnpm --dir /home/liorshtram/projects/accordo --filter browser-extension typecheck` ✅
- `pnpm --dir /home/liorshtram/projects/accordo --filter browser-extension lint` ✅
