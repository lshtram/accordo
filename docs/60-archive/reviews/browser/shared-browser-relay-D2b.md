## Review — shared-browser-relay — Phase D2b

**Summary verdict: FAIL**

### Verification commands (executed)
- Tests: `pnpm --filter ./packages/browser test -- --run` → **33 files, 928 passing, 0 failing**
- Type check: `pnpm --filter ./packages/browser exec tsc --noEmit` → **clean (0 errors)**
- Lint: `pnpm --filter ./packages/browser run lint` → **clean (0 errors)**

### Prior findings status

1. **BLOCKER-1 (`as unknown as` casts in production code)** — **RESOLVED**  
   Verified none in target production files (`shared-relay-*.ts`, `write-lease.ts`, `relay-discovery.ts`, `extension.ts`).

2. **BLOCKER-2 (`releaseAll()` released all pending simultaneously)** — **RESOLVED**  
   `WriteLeaseManager.releaseAll()` now removes only disconnected hub entries and grants lease FIFO to next hub.

3. **BLOCKER-3 (response routing not wired)** — **RESOLVED**  
   `requestId -> hubId` and per-hub pending resolvers now route responses back to originating hub socket.

4. **BLOCKER-4 (write-lease not enforced for mutating actions)** — **RESOLVED**  
   Mutating actions now call `writeLease.acquire()` before forward, and release on completion/error paths.

5. **BLOCKER-5 (`SharedRelayClient.stop()` missing `isStopping=true`)** — **RESOLVED**  
   `stop()` now sets `isStopping=true` before closing websocket and suppresses reconnect scheduling.

6. **BLOCKER-6 (hub path used local token instead of discovery token)** — **RESOLVED**  
   Hub path now uses `existingInfo.token` when connecting to existing owner.

7. **BLOCKER-7 (relay-discovery tests mocked module under test)** — **RESOLVED**  
   Tests import real `relay-discovery.ts` and mock only external boundaries (`node:fs`, `process`).

8. **BLOCKER-8 (feature-flag tests only checked path, not behavior)** — **RESOLVED**  
   Tests now execute `activate()` and assert class instantiation + `registerTools` behavior in owner/hub/fallback paths.

9. **WARNING-9 (lock not released on success path)** — **RESOLVED**  
   Owner path releases lock after successful write; catch path also releases.

10. **WARNING-10 (`registerBrowserNotifier` called with server object in owner path)** — **RESOLVED**  
    Owner path now registers notifier with `ownerClient` (`BrowserRelayLike`), not server instance.

11. **WARNING-11 (misleading `SBR-F-050` comment)** — **RESOLVED**  
    Comment now correctly states `SharedBrowserRelayServer` does not implement `BrowserRelayLike`; owner uses `SharedRelayClient`.

---

### FAIL — must fix before Phase E

1. **[BLOCKER] `packages/browser/src/write-lease.ts:66-67` — Queue depth limit is off by one vs. requirement SBR-F-023.**  
   Current logic uses `maxQueueDepth - 1` when a holder exists, which caps queued requests at **7** (default) instead of required **8**.  
   **Fix:** enforce `maxQueueDepth` against queue length directly (queue depth limit should be independent of current holder).

2. **[BLOCKER] `packages/browser/src/extension.ts:406-407, 587-589` — graceful Owner shutdown does not clean up `~/.accordo/shared-relay.json` / lock file (SBR-F-039).**  
   Shared relay server is stopped via subscription disposal, but discovery/lock files are not removed on graceful shutdown.  
   **Fix:** add explicit cleanup in owner disposal/deactivation path to remove `shared-relay.json` and `shared-relay.json.lock` (best-effort, safe on already-missing files).

3. **[BLOCKER] `packages/browser/src/relay-discovery.ts:103-117` — stale lock-file recovery is missing (SBR-F-039).**  
   When lock exists, acquisition loops until timeout but never checks whether lock holder PID is dead; stale lock is not removed/overwritten.  
   **Fix:** on `EEXIST`, read lock-holder PID, validate liveness, remove stale lock, then retry acquisition.

### WARNING (non-blocking)

1. **[WARNING] `packages/browser/src/shared-relay-client.ts:88-92` — potential unhandled rejection from `onRelayRequest(...)`.**  
   Promise chain uses `.then(...)` without `.catch(...)`; if handler rejects, this can produce unhandled rejection noise.  
   **Fix:** wrap in `void ...catch(...)` and return an explicit `action-failed` response envelope.
