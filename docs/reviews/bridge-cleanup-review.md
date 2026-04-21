# Bridge Cleanup Review (2026-04-21)

## Summary

This cleanup aligned bridge lifecycle/docs/contracts with the current reconnect-first implementation, removed dead composition surface, and added focused utility-module tests that were previously only covered indirectly.

## Completed fixes

1. **Lifecycle and status requirements aligned to implementation**
   - Updated `docs/20-requirements/requirements-bridge.md` to reflect reconnect-first deactivation (`softDisconnect`) and current show-status semantics.
   - Updated MCP registration/config expectations to current `mcp.json` + config schema behavior.

2. **Architecture/module-map/README drift removed**
   - Updated `docs/10-architecture/architecture.md` bridge registration/file-layout sections.
   - Updated `docs/module-map-bridge.md` to current module responsibilities.
   - Updated `packages/bridge/README.md` for current lifecycle semantics, BridgeAPI import guidance, and settings table coverage.

3. **Dead bridge composition surface removed**
   - Removed unused `buildShowStatusHandler()` export from `packages/bridge/src/extension-composition.ts`.
   - Removed stale comments and an unused import in the same file.

4. **Stale bridge process/lifecycle comments refreshed**
   - Updated comments in `hub-manager.ts` and `hub-process.ts` so docs/comments no longer imply obsolete hard-kill/PID ownership behavior as the canonical path.

5. **Focused utility tests added**
   - Added direct tests for:
     - `hub-registry.ts`
     - `project-identity.ts`
     - `state-diff.ts`
     - `state-collector.ts`
   - Also removed stale RED/stub wording in `extension-composition.test.ts`.

6. **Bridge testing guide refreshed**
   - Added `docs/testing-guide-bridge.md` with:
     - automated test commands and coverage scope
     - user-journey checks for startup/status/restart/reload behavior

## Validation

- `pnpm --filter accordo-bridge test` ✅ (441 passing)
- `pnpm --filter accordo-bridge typecheck` ✅
- `pnpm --filter accordo-bridge lint` ✅

Additional reliability check (from a different working directory, `/tmp`):
- `pnpm --dir /home/liorshtram/projects/accordo --filter accordo-bridge test` ✅
- `pnpm --dir /home/liorshtram/projects/accordo --filter accordo-bridge typecheck` ✅
- `pnpm --dir /home/liorshtram/projects/accordo --filter accordo-bridge lint` ✅

## Follow-up (non-blocking)

- Optional long-horizon hardening from cleanup plan remains open by design:
  - repeated activate/deactivate leak-focused scenario test
  - lightweight real runtime Bridge↔Hub WS integration test beyond mocked coverage
