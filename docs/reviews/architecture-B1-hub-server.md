## Review — architecture-B1-hub-server

### Result: PASS

The proposed split of `packages/hub/src/server.ts` into:

- `server-routing.ts`
- `server-sse.ts`
- `server-mcp.ts`
- `server-reauth.ts`

is architecturally sound and preserves the current behavior envelope, with a couple of non-blocking concerns noted below.

---

### What was reviewed

- Original implementation: `packages/hub/src/server.ts`
- New stubs/interfaces:
  - `packages/hub/src/server-routing.ts`
  - `packages/hub/src/server-sse.ts`
  - `packages/hub/src/server-mcp.ts`
  - `packages/hub/src/server-reauth.ts`

---

### PASS checks

1. **Factory pattern choice is appropriate**
   - `createSseManager` is clearly stateful (connection map + keepalive timers), so factory construction is the right pattern.
   - Using factories consistently across all 4 modules keeps wiring predictable in `HubServer`.

2. **Deps interfaces are complete for the extracted responsibilities**
   - `RouterDeps` covers dynamic auth values (`getToken`, `getBridgeSecret`) and all delegated handlers/data providers needed for route handling.
   - `McpRequestHandlerDeps` has required dispatcher (`mcpHandler`) and optional logger.
   - `SseDeps` covers logger and agent hint extraction.
   - `ReauthDeps` covers the three state update operations required by current behavior.

3. **Auth middleware order can be preserved exactly**
   - `server-routing.ts` documents the required sequence explicitly (`/health` exception, then `validateOrigin`, then route-specific auth).
   - This matches `server.ts` current order and satisfies the expected bypass (`/bridge/reauth` uses bridge secret auth, not bearer auth).

4. **No circular dependency risk in current design**
   - With DI wiring from `server.ts`, modules can remain acyclic:
     - router depends on handler functions via `Deps`
     - SSE depends on a function contract (`extractAgentHint`) rather than importing router/mcp internals
     - mcp and reauth modules are independent

5. **SSE registry-update notification flow remains viable**
   - Existing `bridgeServer.onRegistryUpdate(...) -> pushSseNotification(...)` behavior can be preserved by delegating to `SseManager.pushSseNotification`.
   - `SseManager.closeAll()` gives a clear shutdown hook equivalent to current `stop()` cleanup logic.

---

### Non-blocking concerns (flagged)

1. **Shared utility placement is slightly misleading**
   - Reference: `packages/hub/src/server-mcp.ts:8-10,69-71`
   - Concern: `extractAgentHint` is documented as shared across modules but located in `server-mcp.ts`, which suggests MCP ownership.
   - Recommendation: move to a neutral utility file (e.g. `packages/hub/src/server-agent-hint.ts`) to avoid conceptual coupling and future import-direction drift.
   - **Blocking?** No.

2. **Reauth callback granularity can allow invariant drift over time**
   - Reference: `packages/hub/src/server-reauth.ts:21-39`
   - Concern: three separate callbacks (`updateToken`, `updateBridgeSecret`, `updateOptionsBridgeSecret`) are faithful to current behavior, but future edits could accidentally call only subset(s).
   - Recommendation: consider a single higher-level dependency like `applyReauth({ newToken, newSecret })` inside `HubServer` that performs all updates together, even if internally split.
   - **Blocking?** No (current design is still correct).

---

### Implementation guardrails for Phase C/D (not blockers)

- Ensure `HubServer.stop()` calls `sseManager.closeAll()` **before** HTTP server close.
- Keep `onRegistryUpdate` dedup hash logic (`lastNotifiedToolHash`) in `HubServer` (or equivalent coordinator), not in SSE transport layer.
- Ensure `HubServer` delegates only orchestration/wiring after extraction, targeting the stated `<250 LOC` shell.
