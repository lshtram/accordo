# Testing Guide — Hub Cleanup Alignment

**Status:** ACTIVE  
**Owner:** Accordo maintainers  
**Last reviewed:** 2026-04-21  
**Canonical for:** hub cleanup verification (docs + comment/contract alignment)

---

## 1) Automated tests

All commands below were run from **outside the repo root** (`/tmp`) and passed.

1. `pnpm --dir "/home/liorshtram/projects/accordo/packages/hub" lint`
   - Verifies hub source passes ESLint after cleanup edits.

2. `pnpm --dir "/home/liorshtram/projects/accordo/packages/hub" typecheck`
   - Verifies hub TypeScript contracts compile cleanly (`tsc --noEmit`).

3. `pnpm --dir "/home/liorshtram/projects/accordo/packages/hub" test`
   - Verifies full hub unit/integration/e2e test suite is green.
   - Current passing count: **555 tests**.

## 2) User journey tests

These checks validate documented behavior against runtime reality.

1. **Hub endpoint surface sanity**
   - Start hub + bridge normally.
   - Confirm `GET /health` responds with `ok`, `bridge`, `toolCount`, `protocolVersion`, `inflight`, `queued`.
   - Confirm authenticated `GET /mcp` opens an SSE stream.
   - Confirm authenticated `POST /mcp` accepts JSON-RPC requests.

2. **Reconnect-first bridge lifecycle**
   - Trigger a soft bridge disconnect (`POST /bridge/disconnect` with valid bridge secret).
   - Verify response includes `graceWindowMs`.
   - Reconnect bridge before grace expiry and verify hub remains alive.

3. **Token rotation behavior**
   - Call `POST /bridge/reauth` with valid current secret and new token/secret.
   - Verify old token no longer authenticates and new token does.
   - Verify rotated token persistence behavior matches configured `tokenFilePath`.
