# Agent B5 Handoff — `browser-extension` Decomposition (Sequential: B5a → shim → B5b → cleanup)

**Date:** 2026-03-29  
**Baseline commit:** `1651a03`  
**Package:** `packages/browser-extension` (pnpm filter: `browser-extension`)  
**Baseline tests:** 764 (all green)

---

## 1. Your Mission

Split two large files in `packages/browser-extension` in a sequential 4-step process:

1. **B5a**: Split `relay-actions.ts` (868 LOC) into definitions + handlers + forwarder + compat shim
2. **Shim verification**: Confirm compat shim works and all tests pass
3. **B5b**: Split `service-worker.ts` (671 LOC) into runtime + store + relay modules
4. **Cleanup**: Remove compat shim, update all imports to point directly at new modules

**B5a MUST complete before B5b** — the service-worker imports from relay-actions.

All existing tests must remain green. No new cross-package dependencies.

---

## 2. B5a — Split `relay-actions.ts` (868 LOC)

### 2.1 Files You OWN (B5a)

| File | Action | Purpose |
|---|---|---|
| `src/relay-actions.ts` | **MODIFY** → shrink to dispatch entry | Keep `handleRelayAction()`, `handleNavigationReset()`, `RelayAction` type, `RelayActionRequest`/`RelayActionResponse` interfaces — delegate to handlers |
| `src/relay-definitions.ts` | **CREATE** | `RelayAction` type union, `RelayActionRequest`/`RelayActionResponse` interfaces, any schema constants |
| `src/relay-handlers.ts` | **CREATE** | Per-feature handler functions (page map, semantic graph, text map, capture region, diff snapshots, wait_for, element inspector, DOM excerpt, comment relay actions) |
| `src/relay-forwarder.ts` | **CREATE** | Bridge forwarding logic — `requestContentScriptEnvelope()`, content-script message routing |
| `src/relay-actions-compat.ts` | **CREATE** | **TEMPORARY** compatibility shim — re-exports everything from the new modules so `service-worker.ts` doesn't need to change yet |
| `tests/relay-definitions.test.ts` | **CREATE** | Tests for definitions |
| `tests/relay-handlers.test.ts` | **CREATE** | Tests for handlers |
| `tests/relay-forwarder.test.ts` | **CREATE** | Tests for forwarder |

### 2.2 Import Chain After B5a

Current imports that MUST keep working during B5a (via compat shim):

```typescript
// service-worker.ts (line 25) — MUST NOT CHANGE during B5a
import { handleRelayAction, handleNavigationReset, type RelayActionRequest, type RelayActionResponse } from "./relay-actions.js";

// relay-bridge.ts (line 1) — MUST NOT CHANGE during B5a
import type { RelayActionRequest, RelayActionResponse } from "./relay-actions.js";
```

The compat shim (`relay-actions-compat.ts`) is NOT needed if you can make `relay-actions.ts` itself act as the barrel that re-exports from the new modules. **Preferred approach**: keep `relay-actions.ts` as the barrel, don't create a separate compat file. The handoff mentions a compat shim but the simpler path is:

```
relay-actions.ts (barrel) → imports from relay-definitions.ts, relay-handlers.ts, relay-forwarder.ts
                           → re-exports everything
service-worker.ts          → still imports from ./relay-actions.js (unchanged)
relay-bridge.ts            → still imports from ./relay-actions.js (unchanged)
```

If you use this approach, skip creating `relay-actions-compat.ts` entirely.

### 2.3 Key Functions to Extract

**To `relay-definitions.ts`:**
- `RelayAction` type union
- `RelayActionRequest` interface
- `RelayActionResponse` interface
- `CapturePayload` interface
- `defaultStore` singleton export

**To `relay-handlers.ts`:**
- `handleCaptureRegion()` 
- `cropImageToBounds()`
- Page understanding action handlers (get_page_map, inspect_element, get_dom_excerpt, get_text_map, get_semantic_graph)
- Comment relay handlers (get_all_comments, get_comments, create_comment, etc.)
- `diff_snapshots` handler
- `wait_for` handler
- `list_pages`, `select_page` handlers

**To `relay-forwarder.ts`:**
- `requestContentScriptEnvelope()`
- `getActiveTabUrl()`
- `resolveRequestedUrl()`
- Content-script messaging helpers

**Keep in `relay-actions.ts` (now thin):**
- `handleRelayAction()` — the big switch/dispatch function (delegates to handlers)
- `handleNavigationReset()`
- Re-exports of types and key symbols

---

## 3. B5b — Split `service-worker.ts` (671 LOC)

**Only start B5b after B5a passes all 764 tests.**

### 3.1 Files You OWN (B5b)

| File | Action | Purpose |
|---|---|---|
| `src/service-worker.ts` | **MODIFY** — shrink to entry point | Keep `registerListeners()`, `onInstalled()` — delegate to sub-modules |
| `src/sw-runtime.ts` | **CREATE** | Service worker lifecycle, Chrome message routing (`handleMessage`), Chrome listeners |
| `src/sw-store.ts` | **CREATE** | Tab state management, Hub ↔ local thread merging, `mergeLocalAndHubThread()`, sync state, `checkAndSync()`, `startPeriodicSync()`, `stopPeriodicSync()` |
| `src/sw-relay.ts` | **CREATE** | Relay forwarding to CDP/Bridge, `forwardToAccordoBrowser()`, `handleRelayActionWithBroadcast()` |
| `tests/sw-runtime.test.ts` | **CREATE** | Tests for runtime module |
| `tests/sw-store.test.ts` | **CREATE** | Tests for store module |
| `tests/sw-relay.test.ts` | **CREATE** | Tests for relay module |

### 3.2 Exported Symbols After B5b

`service-worker.ts` MUST still export:

```typescript
export { MESSAGE_TYPES };
export type { MessageType };
export function mergeLocalAndHubThread(local, hub): BrowserCommentThread  
export interface SwMessage { ... }
export interface SwResponse { ... }
export async function handleMessage(msg): Promise<SwResponse>
export function registerListeners(): void
export async function onInstalled(details): Promise<void>
export async function checkAndSync(): Promise<void>
export function startPeriodicSync(): void
export function stopPeriodicSync(): void
```

These can live in sub-modules and be re-exported from `service-worker.ts`.

### 3.3 Key Functions to Extract

**To `sw-runtime.ts`:**
- Chrome message listener setup
- `handleMessage()` — the big switch/case message router
- `registerListeners()`
- `onInstalled()`

**To `sw-store.ts`:**
- Hub ↔ local thread type adapters (`HubComment`, `HubCommentThread` interfaces)
- `urlsMatch()`
- `coordinatesToAnchorKey()`
- `hubThreadToBrowserThread()`
- `mergeLocalAndHubThread()`
- `broadcastCommentsUpdated()`
- Sync state management (`SyncState`, `getStoredSyncState`, `setStoredSyncState`, `checkAndSync`, `startPeriodicSync`, `stopPeriodicSync`)

**To `sw-relay.ts`:**
- `RelayBridgeClient` instantiation (the `relayBridge` const)
- `isNoReceiverError()`
- `handleRelayActionWithBroadcast()`
- `forwardToAccordoBrowser()`

---

## 4. B5 Cleanup — Remove Compat Shim (if created)

If you created `relay-actions-compat.ts` in B5a:
1. Update `service-worker.ts` imports to point directly at the new modules
2. Update `relay-bridge.ts` import to point at `relay-definitions.ts`
3. Delete `relay-actions-compat.ts`
4. Run all tests

If you used the barrel approach (recommended), this step is a no-op.

---

## 5. Files You MUST NOT Touch (Entire B5)

| File | Reason |
|---|---|
| `src/relay-bridge.ts` | **EXCEPTION: You MAY update its import path in the cleanup step ONLY.** Otherwise do not modify. |
| `src/store.ts` | Shared dependency |
| `src/state-machine.ts` | Shared dependency |
| `src/screenshot.ts` | Shared dependency |
| `src/mcp-handlers.ts` | Shared dependency |
| `src/constants.ts` | Shared dependency |
| `src/types.ts` | Shared dependency |
| `src/popup.ts` | Shared dependency |
| `src/exporter.ts` | Shared dependency |
| `src/snapshot-versioning.ts` | Shared dependency |
| `src/diff-engine.ts` | Shared dependency |
| `src/content/` (entire directory) | Content script modules — not part of this split |
| `src/adapters/` (entire directory) | Adapter modules |
| `tests/relay-actions.test.ts` | Existing test — must pass unchanged |
| `tests/relay-actions-wait.test.ts` | Existing test |
| `tests/relay-actions-notify.test.ts` | Existing test |
| `tests/relay-actions-diff.test.ts` | Existing test |
| `tests/page-understanding-actions.test.ts` | Existing test |
| `tests/service-worker.test.ts` | Existing test |
| `tests/snapshot-versioning.test.ts` | Existing test |
| `tests/*.test.ts` (all 33 existing) | All existing tests stay untouched |
| Any file in `packages/hub/` | Agent B1 |
| Any file in `packages/bridge/` | Agent B2 |
| Any file in `packages/voice/`, `packages/diagram/`, `packages/editor/` | Agent B3 |
| Any file in `packages/comments/` | Agent B4 |
| Any file in `packages/bridge-types/` | Shared types — frozen |

---

## 6. Critical Architecture Constraints

1. **Chrome Extension APIs only** — This is a Chrome MV3 extension. No Node.js APIs (`node:fs`, `node:path`, etc.). Use `chrome.runtime`, `chrome.tabs`, `chrome.storage`.

2. **No `vscode` imports** — This package is a browser extension, not a VS Code extension.

3. **Module resolution** — `tsconfig.json` uses `"moduleResolution": "bundler"` and `"module": "ES2022"`. Imports use `.js` extension suffix.

4. **Test location** — Tests are in `tests/` (NOT `src/__tests__/`). Follow the existing pattern.

5. **No cross-package deps** — Browser extension is standalone. It does NOT import from `@accordo/bridge-types`.

---

## 7. Verification Commands

After B5a:
```bash
pnpm --filter browser-extension test      # 764 tests green
pnpm --filter browser-extension exec tsc --noEmit
```

After B5b:
```bash
pnpm --filter browser-extension test      # 764+ tests green
pnpm --filter browser-extension exec tsc --noEmit
pnpm --filter browser-extension run build
```

After cleanup:
```bash
pnpm --filter browser-extension test
pnpm --filter browser-extension exec tsc --noEmit

# LOC checks
wc -l packages/browser-extension/src/relay-actions.ts packages/browser-extension/src/relay-definitions.ts packages/browser-extension/src/relay-handlers.ts packages/browser-extension/src/relay-forwarder.ts
wc -l packages/browser-extension/src/service-worker.ts packages/browser-extension/src/sw-runtime.ts packages/browser-extension/src/sw-store.ts packages/browser-extension/src/sw-relay.ts
```

---

## 8. Commit Format

Sequential commits:

```
refactor(browser-extension): decompose relay-actions into definitions/handlers/forwarder (B5a)

- relay-actions.ts: 868 LOC → <250 LOC dispatch barrel
- relay-definitions.ts: type definitions + interfaces
- relay-handlers.ts: per-feature handler implementations
- relay-forwarder.ts: content-script messaging
- Tests: 764 existing + N new (all green)
```

```
refactor(browser-extension): decompose service-worker into runtime/store/relay (B5b)

- service-worker.ts: 671 LOC → <250 LOC entry point
- sw-runtime.ts: lifecycle + message routing
- sw-store.ts: thread merging + sync state
- sw-relay.ts: relay forwarding to CDP/Bridge
- Tests: 764+ existing + N new (all green)
```

---

## 9. What NOT to Do

- ❌ Do NOT start B5b before B5a passes all 764 tests
- ❌ Do NOT modify existing test files — only add new ones
- ❌ Do NOT change exported types/interfaces that `service-worker.ts` or `relay-bridge.ts` import
- ❌ Do NOT modify any file in `src/content/` or `src/adapters/`
- ❌ Do NOT use Node.js APIs — this is a Chrome extension
- ❌ Do NOT create cross-package dependencies
- ❌ Do NOT import from `@accordo/bridge-types` — browser-extension is standalone
- ❌ Do NOT change the message protocol between service-worker and content scripts
- ❌ Do NOT change the `RelayBridgeClient` interface or how relay-bridge communicates
