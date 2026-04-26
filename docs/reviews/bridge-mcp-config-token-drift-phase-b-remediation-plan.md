# Phase B Second Remediation Plan — bridge-mcp-config-token-drift

**Date:** 2026-04-21  
**Problem:** Phase B gate FAIL — 4 remaining blockers after first remediation.

---

## Blocker Analysis and Exact Fixes

### Blocker 1 — hub-manager.test.ts modularity (touched, ~1502 lines)

**Root cause:** I edited hub-manager.test.ts to remove HFT-01 — this made it a "touched" file in scope for the modularity cap. Even after removing HFT-01 it is ~1502 lines.

**Fix:** Revert hub-manager.test.ts to its original state (restore the HFT-01 describe block I removed). Leave hub-manager.test.ts COMPLETELY UNTOUCHED. The modularity cap applies to files created or edited in this Phase B pass — hub-manager.test.ts was already large before this pass, so leaving it untouched is the correct action. hub-manager-restart-token-ordering.test.ts is a new standalone file and stays.

**Action:** Restore HFT-01 block to hub-manager.test.ts exactly as it was before my edit. No other changes.

---

### Blocker 2 — HFT-01 wrong events spy instance

**Root cause:** In the IIFE inside the HFT-01 test, `makeEvents()` is called twice — once inside `new HubManager(...)` (which stores it internally) and once in the return object used for assertions. The assertions check the second instance, not the one passed to HubManager.

**Fix:**
```typescript
// WRONG (current):
const { manager, events } = (() => {
  const events = makeEvents(); // passed to HubManager
  return { manager: new HubManager(secrets, output, config, events), events: makeEvents() }; // second instance!
})();

// CORRECT:
const events = makeEvents(); // single instance
const manager = new HubManager(secrets, output, config, events);
```
The same `events` object is passed to HubManager AND used for assertions.

---

### Blocker 3 — token-source-contract.test.ts overclaims SecretStorage-backed getHubToken

**Root cause:** Test descriptions say "tokenSource.getHubToken(...) called" but assertions only check `projectId` was in the params. They never call `tokenSource.getHubToken` or verify SecretStorage key usage.

**Fix (TSC-02):** Capture the `writeAgentConfigsFromStorage` call args, extract `params.tokenSource`, invoke `await params.tokenSource.getHubToken(params.projectId)`, and assert it resolves to the token stored in secretStorage.

**Updated TSC test descriptions** to match what they actually assert — no overclaim.

---

### Blocker 4 — SWR-03 naming/assertion mismatch

**Root cause:** Test name says "function handles it gracefully" but asserts rejection with "not implemented". These are incompatible.

**Fix:** Rename to `SWR-03: CFG-07 — when getHubToken returns undefined, writeAgentConfigsFromStorage rejects with not implemented (stub body empty, graceful path not yet implemented)`. The assertion accurately reflects what is actually proved: the spy was not called before the rejection.

---

## Exact Files to Touch

| File | Action | Lines (before → after) |
|---|---|---|
| `packages/bridge/src/__tests__/hub-manager.test.ts` | **Restore** HFT-01 block (revert first remediation edit) | 1502 (unchanged large existing file — left untouched) |
| `packages/bridge/src/__tests__/hub-manager-restart-token-ordering.test.ts` | **Edit** — fix events spy instance bug | 78 → 78 |
| `packages/bridge/src/__tests__/token-source-contract.test.ts` | **Edit** — rewrite TSC-02 to actually invoke tokenSource.getHubToken | 110 → ~110 |
| `packages/bridge/src/__tests__/storage-writer-token-at-write-time.test.ts` | **Edit** — rename SWR-03 to match assertion | 62 → 62 |

**hub-manager.test.ts is NOT edited in this pass** — it is left in its original state. The modularity cap applies to files modified in this pass; leaving a pre-existing oversized file untouched is the correct action.

---

## Execution Steps

1. Restore HFT-01 block to hub-manager.test.ts
2. Fix events spy instance in hub-manager-restart-token-ordering.test.ts
3. Rewrite TSC-02 in token-source-contract.test.ts to invoke tokenSource.getHubToken
4. Rename SWR-03 in storage-writer-token-at-write-time.test.ts
5. Run targeted tests and capture failures
6. Verify line counts

---

## Done-When Checklist

**A) hub-manager modularity:**
- [ ] hub-manager.test.ts is NOT edited in this pass
- [ ] hub-manager-restart-token-ordering.test.ts is the only new artifact (<=150 lines)

**B) HFT-01 events spy:**
- [ ] Single `events` object created before HubManager construction
- [ ] Same `events` instance passed to `new HubManager(...)` AND used in assertions

**C) token-source contract:**
- [ ] TSC-02 captures `writeAgentConfigsFromStorage` call args
- [ ] `await args.tokenSource.getHubToken(args.projectId)` is actually called
- [ ] Assertion verifies token resolves from SecretStorage

**D) SWR-03 naming:**
- [ ] Test name does not claim graceful handling
- [ ] Assertion matches what is actually proved (spy not called before rejection)