## Review — shared-browser-relay — Phase D2

**Summary verdict: FAIL**

### PASS
- Tests: `pnpm --filter ./packages/browser test -- --run` → **33 files, 931 passing, 0 failing**.
- Type check (module scope): `pnpm --filter ./packages/browser exec tsc --noEmit` → **clean**.
- Baseline lint command (`pnpm --filter ./packages/browser run lint`) returns no errors, but see blocker below on lint scope coverage.

### FAIL — must fix before Phase E

1. **[BLOCKER] `packages/browser/src/extension.ts:282-382`** — Shared-relay activation path does not register browser tools (`bridge.registerTools(...)` is only in per-window path at `:478-492`). In shared mode, relay may start/connect but MCP tools are never registered. This violates SBR-NF-003 and shared integration requirements.  
   **Fix:** Build/register the same tool set in shared mode (using `BrowserRelayLike` abstraction) exactly as in per-window mode.

2. **[BLOCKER] `packages/browser/src/extension.ts:300-305`** — Hub-client connection uses local `token` variable, not discovery-file token (`existingInfo.token`). This can cause auth mismatch and violates SBR-F-031/SBR-F-038 discovery contract.  
   **Fix:** Use token from `readSharedRelayInfo()` when joining an existing owner, with validation/fallback handling.

3. **[BLOCKER] `packages/browser/src/extension.ts:333-373`** — Lock is acquired but not released on success path; `releaseRelayLock()` is only called in catch (`:369`). This can leave stale lock ownership and break ownership transfer/race handling (SBR-F-034/SBR-F-039).  
   **Fix:** Release in a `finally` block after discovery-file write/start decision; preserve ownership semantics without leaking lock files.

4. **[BLOCKER] `packages/browser/src/shared-relay-server.ts:224-229` and `:141-152`** — Response routing is functionally broken: pending map stores placeholder no-op resolvers, and Chrome responses resolve placeholders instead of replying to hub sockets. This violates SBR-F-004/SBR-F-008 behavior.  
   **Fix:** Track pending by requestId with hub socket (or send callback that writes to socket), then send actual `BrowserRelayResponse` back to originating hub.

5. **[BLOCKER] `packages/browser/src/shared-relay-server.ts:216-252`** — Write-lease is not enforced for mutating actions despite being required (SBR-F-020..027). `MUTATING_ACTIONS` is imported (`:18`) but never applied.  
   **Fix:** Gate mutating actions through `WriteLeaseManager.acquire/release`, queue/reject per limits, and bypass lease only for read actions.

6. **[BLOCKER] `packages/browser/src/write-lease.ts:129-140`** — `releaseAll()` for current holder clears queue and resolves all waiters, effectively letting queued callers continue without a lease and discarding unrelated hubs. Violates SBR-F-021/SBR-F-022/SBR-F-026 semantics.  
   **Fix:** On holder disconnect, release holder and transfer lease FIFO to next eligible queued hub; remove only entries belonging to disconnected hub.

7. **[BLOCKER] `packages/browser/src/__tests__/relay-discovery.test.ts:21-86`** — Test file mocks the module under test (`vi.mock("../relay-discovery.js", ...)`), so implementation in `relay-discovery.ts` is not actually verified. This is a weakened-test pattern and invalidates requirement coverage confidence for SBR-F-030..039.  
   **Fix:** Test real module behavior via filesystem/OS seams (temp dir + controlled stubs only for external boundaries), not by replacing the target module.

8. **[BLOCKER] `packages/browser/src/__tests__/shared-relay-feature-flag.test.ts:131-157` and `:161-200`** — Feature-flag tests do not verify actual `activate()` branching; they mostly assert class/method existence. This does not meaningfully cover SBR-F-051/SBR-F-031/SBR-F-032/SBR-F-033 integration behavior.  
   **Fix:** Execute `activate()` with mocked VS Code config (`sharedRelay=true/false`) and assert which path was instantiated + tools registration + discovery interactions.

9. **[WARNING] `packages/browser/src/shared-relay-client.ts:75-76`, `packages/browser/src/shared-relay-server.ts:220`** — Production code contains `as unknown as` casts, disallowed by coding guidelines §1.1/§3.3.  
   **Fix:** Replace with proper type guards/narrowing helpers for message envelopes.

10. **[WARNING] `packages/browser/src/shared-relay-client.ts:109-113` and `:133-142`** — `stop()` can still trigger reconnect via `close` handler (`scheduleReconnect()`), because there is no explicit shutdown flag.  
    **Fix:** Add `isStopping` guard so explicit shutdown does not schedule reconnect.

11. **[WARNING] `packages/browser/package.json:32`** — Lint script scope excludes all new shared-relay files (`shared-relay-*.ts`, `write-lease.ts`, `relay-discovery.ts`, `extension.ts`, and associated tests). D2 lint gate is therefore not satisfied for new code.  
    **Fix:** Expand lint targets (or config globs) to include shared-relay production/test files and rerun lint.
