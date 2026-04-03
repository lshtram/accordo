## Review — tests-B1-hub-server

### Overall verdict: **FAIL** (coverage is close, but not yet adequate)

The suite is strong in breadth (62 tests across 4 modules), but there are important behavior gaps and a few test-quality issues that can produce false negatives/positives against the original `server.ts` contract.

---

## 1) `server-routing.test.ts`

### Requested checks
- Auth paths (no-auth, bearer, bridge-secret): **Mostly PASS**
- 405 for wrong method on `/mcp`: **PASS**
- 404 for unknown endpoints: **PASS**
- Delegation to `handleMcp`, `handleMcpSse`, `handleReauth`: **PASS**

### Missing cases that could catch bugs
1. **Origin validation (`403`) is not covered** for authenticated endpoints.
   - Original `server.ts` runs `validateOrigin()` before endpoint-specific auth on all authenticated routes.
   - Add tests for invalid `Origin` on at least: `POST /mcp`, `GET /mcp`, `GET /instructions`, `GET /state`, `POST /bridge/reauth`.
2. **Middleware order is not asserted** (origin check should happen before bearer/secret checks).
   - Add tests where both origin and auth are bad and assert `403` (not `401`).

---

## 2) `server-sse.test.ts`

### Requested checks
- SSE headers: **PASS**
- Keep-alive mechanism: **PARTIAL**
- `pushSseNotification` with multiple connections: **PASS**
- Cleanup on client disconnect: **FAIL**

### Missing cases that could catch bugs
1. **No test for periodic keep-alive ping timer** (`: ping\n\n` every 30s).
   - Use fake timers and assert ping writes over time.
2. **No explicit test for cleanup on request `close` event**.
   - Must assert connection is removed and timer is cleared when client disconnects.

### Test quality concerns
1. **Socket assertions target the wrong object** in current tests.
   - Original implementation calls `req.socket.setTimeout(0)` and `req.socket.setKeepAlive(...)`.
   - Tests currently assert calls on `res.socket.*`.
   - This can fail even with correct implementation or accidentally pass with incorrect wiring.

---

## 3) `server-mcp.test.ts`

### Requested checks
- Content-Type validation: **PASS**
- Session ID validation (400 on unknown session): **PASS**
- JSON parse error (400): **PASS**
- `extractAgentHint` known agents + edge cases: **PASS**

### Missing cases that could catch bugs
1. **Existing-session response header behavior not fully asserted**.
   - Test name says no new `Mcp-Session-Id`, but assertion only checks `createSession` wasn’t called.
   - Add assertion that response does **not** set `Mcp-Session-Id` for existing session.
2. **Error path for `mcpHandler.handleRequest` rejection is not covered**.
   - Original flow catches and `res.end()`; should be tested.

### Test quality concerns
1. In `"null response from handler calls res.end() without body"`, `res.end` is not a spy in the fixture, but is asserted with `toHaveBeenCalled()`.
   - This test will not reliably validate intended behavior.
2. Several async tests depend on `setTimeout(10)` polling; this is fragile/flaky.
   - Prefer promise-driven synchronization tied to `end`/handler completion.

---

## 4) `server-reauth.test.ts`

### Requested checks
- All 4 error cases (no content-type, bad JSON, missing fields): **PASS**
- All 3 update callbacks are called: **PASS**

### Missing cases that could catch bugs
1. **No assertion that update callbacks are not called on invalid input**.
2. **No explicit non-string field-type test** (e.g., `newToken: 123`, `newSecret: {}`) to ensure strict string validation path.

---

## Will these tests correctly pass once implementation is correct?

**Not fully yet.**

Most tests should pass with a correct implementation, but some are currently mis-specified or fragile:
- `server-sse.test.ts` socket assertions (`res.socket` vs `req.socket`) are inconsistent with original behavior.
- `server-mcp.test.ts` includes at least one matcher expecting spy behavior on a non-spy function.

These should be fixed before treating B1 as a reliable gate.

---

## Recommendation to test-builder

Before moving to implementation, patch the highlighted test gaps/quality issues (especially origin checks, SSE disconnect/timer behavior, and MCP fixture matcher correctness). After that, coverage adequacy should be strong for the decomposition.
