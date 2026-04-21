# Hub Cleanup Review

**Date:** 2026-04-21  
**Scope:** `clean-up-plan-hub.md` alignment pass

## Summary

- Updated hub requirements, architecture, module map, and package README to match implemented endpoint and lifecycle behavior.
- Removed stale/stub comments in hub source where implementation is already complete.
- Confirmed hub quality gates from `/tmp`: lint + typecheck + tests all pass.

## Key alignments completed

1. **Endpoint and transport contracts**
   - Documented `POST /mcp` JSON-RPC and `GET /mcp` SSE roles consistently.
   - Added/clarified `/bridge/disconnect` and `/browser/status` in requirements/architecture docs.

2. **Reconnect/token lifecycle contracts**
   - Aligned docs with reconnect-first grace window behavior.
   - Aligned token rotation text with `tokenFilePath` persistence behavior.

3. **Heartbeat and liveness accuracy**
   - Updated heartbeat wording to current implementation (30s ping; no enforced missed-pong timeout).

4. **Code comment hygiene**
   - Removed stale `STUB` note in `disconnect-handler.ts`.
   - Corrected `tool-registry.ts` list-order comment to reflect actual merge semantics.

## Validation evidence

Run from `/tmp`:

- `pnpm --dir "/home/liorshtram/projects/accordo/packages/hub" lint`
- `pnpm --dir "/home/liorshtram/projects/accordo/packages/hub" typecheck`
- `pnpm --dir "/home/liorshtram/projects/accordo/packages/hub" test`

Result: **PASS** (`25` files, `555` tests).
