## Review — bridge reconnect config sync / cross-project isolation

### Verdict
- **FAIL**

### Scope reviewed
- `packages/bridge/src/extension-composition.ts`
- `packages/bridge/src/__tests__/extension-composition.test.ts`
- `docs/10-architecture/reload-reconnect-test-scenarios.md`
- `docs/10-architecture/adr-reload-reconnect.md`
- HEAD sanity-checks for Hub reuse/isolation and storage-backed agent config sync

### Evidence run
- `pnpm test` in `packages/bridge` → **27 files, 469 tests passing, 0 failures**
- `pnpm typecheck` in `packages/bridge` → **clean**
- `pnpm lint` in `packages/bridge` → **clean**

### What looks correct
- The patch changes `buildHubManagerEvents.onHubReady()` to call `requestConfigSyncs(deps, port, token)` on both reconnect and fresh-ready paths.
- `requestConfigSyncs()` splits authority correctly:
  - Copilot/user MCP config sync uses the effective `port` + callback `token`.
  - Workspace agent config sync re-reads the token from storage at write time via `writeAgentConfigsFromStorage()`.
- Existing HEAD behavior still looks correct for cross-project isolation:
  - `HubManager.activate()` scopes SecretStorage by `projectId` and probes registry entries by that same `projectId`.
  - Registry reuse is per-project, not cross-project.
  - `hub-manager.test.ts` covers same-project reuse and different-project isolation paths.

### User-reported symptom check
- **Likely addressed by this patch:** yes.
- Why: when reconnect finds a live Hub on runtime port `3001`, `onHubReady(3001, token, true)` now requests config sync immediately. Copilot sync receives `3001` directly, and workspace agent config sync writes using `port=3001` while resolving the token from storage at write time.
- Residual risk: I did **not** see a real integration/E2E assertion that reproduces the exact user symptom (`runtime 3001`, `opencode 3000 after reconnect`). Current coverage is composition/seam/unit level, not an end-to-end reconnect-with-existing-config fixture.

### FAIL — must fix before approval
- `packages/bridge/src/extension-composition.ts:1` — **automatic modularity blocker**: file is 493 lines and owns multiple responsibilities (Hub-ready wiring, WS event wiring, Bridge API composition, command registration, cleanup). **Done when:** this file is split into focused modules so each file is ≤150 lines and each file has one primary responsibility.
- `packages/bridge/src/extension-composition.ts:127` — **automatic modularity blocker**: `onHubReady` callback is >30 lines and mixes state mutation, config sync triggering, secret lookup, WsClient construction, service wiring, publisher start, connect, and error handling. **Done when:** `onHubReady` is decomposed into short helpers (≤30 lines each) with one responsibility each.
- `packages/bridge/src/__tests__/extension-composition.test.ts:1` — **automatic modularity blocker**: test file is 876 lines and covers multiple unrelated units (`buildHubManagerEvents`, `makeWsClientEvents`, `composeExtension`, `registerCommands`, `cleanupExtension`). **Done when:** tests are split by module/concern into files ≤150 lines each, with each file focused on one exported unit or one narrow behavior group.

### Reviewer note
- Functionally, the reconnect config-sync change is directionally correct and appears to close the specific port drift gap.
- Structurally, the reviewed patch still fails the repository’s modularity iron rule, so this review cannot pass.
