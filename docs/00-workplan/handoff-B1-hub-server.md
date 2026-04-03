# Agent B1 Handoff — `hub/server.ts` Decomposition

**Date:** 2026-03-29  
**Baseline commit:** `1651a03`  
**Package:** `packages/hub` (pnpm filter: `accordo-hub`)  
**Baseline tests:** 376 (all green)

---

## 1. Your Mission

Split `packages/hub/src/server.ts` (615 LOC) into 4 focused modules while keeping the `HubServer` class as a thin delegation shell. Every existing test must remain green. No new cross-package dependencies.

---

## 2. Files You OWN (may create / modify)

| File | Action | Purpose |
|---|---|---|
| `src/server.ts` | **MODIFY** — shrink to delegation shell | Keep `HubServer` class, `HubServerOptions` interface, `start()`, `stop()` |
| `src/server-routing.ts` | **CREATE** | HTTP routing dispatcher (`handleHttpRequest`), auth middleware chain, `handleHealth`, `handleState`, `handleInstructions` |
| `src/server-sse.ts` | **CREATE** | SSE endpoint setup, `handleMcpSse`, `pushSseNotification`, `sseConnections` map, keep-alive logic |
| `src/server-mcp.ts` | **CREATE** | MCP protocol handler wiring — `handleMcp` (POST /mcp JSON-RPC dispatch) |
| `src/server-reauth.ts` | **CREATE** | `handleReauth` flow + token rotation logic |
| `src/__tests__/server-routing.test.ts` | **CREATE** | Unit tests for extracted routing module |
| `src/__tests__/server-sse.test.ts` | **CREATE** | Unit tests for extracted SSE module |
| `src/__tests__/server-mcp.test.ts` | **CREATE** | Unit tests for extracted MCP wiring module |
| `src/__tests__/server-reauth.test.ts` | **CREATE** | Unit tests for extracted reauth module |

---

## 3. Files You MUST NOT Touch

These files belong to other agents or are shared infrastructure. **Do not modify them under any circumstances.**

| File | Reason |
|---|---|
| `src/index.ts` | Barrel entry / CLI — imports `HubServer` from `./server.js` — that import MUST still work unchanged |
| `src/bridge-server.ts` | Shared dependency — other modules and tests import this |
| `src/mcp-handler.ts` | Shared dependency — B1 may import from it but MUST NOT modify it |
| `src/tool-registry.ts` | Shared dependency |
| `src/state-cache.ts` | Shared dependency |
| `src/prompt-engine.ts` | Shared dependency |
| `src/security.ts` | Shared dependency — contains `validateOrigin`, `validateBearer`, `validateBridgeSecret` |
| `src/debug-log.ts` | Shared dependency |
| `src/audit-log.ts` | Shared dependency |
| `src/errors.ts` | Shared dependency |
| `src/stdio-transport.ts` | Shared dependency |
| `src/__tests__/server.test.ts` | Existing test file — DO NOT modify. It must pass as-is after your refactor |
| `src/__tests__/*.test.ts` (all others) | Other existing tests — must pass unchanged |
| Any file in `packages/bridge/` | Different package — Agent B2's territory |
| Any file in `packages/bridge-types/` | Shared types package — frozen |
| Any file in `packages/voice/`, `packages/diagram/`, `packages/editor/` | Agent B3's territory |
| Any file in `packages/comments/` | Agent B4's territory |
| Any file in `packages/browser-extension/` | Agent B5's territory |

---

## 4. Exported Symbol Contract

The **public API of `server.ts` must not change.** After the refactor, these must still be importable from `./server.js`:

```typescript
export interface HubServerOptions { ... }  // unchanged
export class HubServer { ... }             // unchanged constructor + start() + stop()
```

`index.ts` does `import { HubServer } from "./server.js"` — this MUST keep working.

The new modules (`server-routing.ts`, `server-sse.ts`, `server-mcp.ts`, `server-reauth.ts`) are **internal** — they are imported only by `server.ts`. They do NOT need to be re-exported from `index.ts`.

---

## 5. Critical Architecture Constraints

1. **Auth middleware FIRST** — `validateOrigin` and `validateBearer` must execute before any handler on authenticated endpoints. When extracting routing, the auth → handler chain must be preserved exactly. See `AGENTS.md §4.2`.

2. **No `vscode` imports** — Hub is editor-agnostic. Zero `vscode` imports anywhere in `packages/hub/`. This is a hard failure.

3. **`@accordo/bridge-types` barrel only** — Import types via `import type { ... } from "@accordo/bridge-types"`. Never use subpath imports like `@accordo/bridge-types/health`.

4. **Handler functions stay in-process** — All handlers are private methods on `HubServer`. They move to helper modules but remain in the same process. Nothing crosses the wire.

---

## 6. How to Split — Step by Step

### 6.1 `server-routing.ts`
Extract from `server.ts`:
- `handleHttpRequest()` — the URL-based routing switch
- `handleHealth()` — the `/health` endpoint
- `handleState()` — the `/state` endpoint  
- `handleInstructions()` — the `/instructions` endpoint
- Auth middleware invocations (`validateOrigin`, `validateBearer`)

Pattern: export a function like `createRouter(deps: RouterDeps)` that returns a `handleHttpRequest` function. The deps object receives references to the MCP handler, SSE setup, reauth handler, etc.

### 6.2 `server-sse.ts`
Extract from `server.ts`:
- `handleMcpSse()` — SSE connection setup
- `sseConnections` map management
- `pushSseNotification()` — server → client notification push
- Keep-alive interval logic
- `lastNotifiedToolHash` dedup logic

### 6.3 `server-mcp.ts`
Extract from `server.ts`:
- `handleMcp()` — POST `/mcp` JSON-RPC request handling
- `extractAgentHint()` helper

### 6.4 `server-reauth.ts`
Extract from `server.ts`:
- `handleReauth()` — reauth flow
- Token rotation / file writing

### 6.5 `server.ts` (after split)
Becomes a thin shell:
- `HubServerOptions` interface (stays here)
- `HubServer` class with `start()` and `stop()`
- Constructor wires up the sub-modules
- `handleHttpRequest` delegates to the router

Target: `server.ts` < 250 LOC after split. Each new file < 300 LOC.

---

## 7. Verification Commands

Run these in order after implementation:

```bash
# 1. All existing tests pass (376 tests)
pnpm --filter accordo-hub test

# 2. Type check clean
pnpm --filter accordo-hub exec tsc --noEmit

# 3. Build clean
pnpm --filter accordo-hub run build

# 4. Verify LOC targets
wc -l packages/hub/src/server.ts packages/hub/src/server-routing.ts packages/hub/src/server-sse.ts packages/hub/src/server-mcp.ts packages/hub/src/server-reauth.ts
```

---

## 8. Commit Format

```
refactor(hub): decompose server.ts into routing/SSE/MCP/reauth modules

- server.ts: 615 LOC → <250 LOC delegation shell
- server-routing.ts: HTTP routing + auth middleware chain
- server-sse.ts: SSE connection management + notifications
- server-mcp.ts: MCP JSON-RPC POST handling
- server-reauth.ts: reauth flow + token rotation
- Tests: 376 existing + N new (all green)
```

---

## 9. What NOT to Do

- ❌ Do NOT change the WebSocket protocol or message types
- ❌ Do NOT modify `HubToBridgeMessage` / `BridgeToHubMessage` unions
- ❌ Do NOT add new cross-package runtime dependencies
- ❌ Do NOT modify any file outside `packages/hub/src/server*.ts` and test files
- ❌ Do NOT change existing test files — only add new ones
- ❌ Do NOT rename the `HubServer` class or `HubServerOptions` interface
- ❌ Do NOT change the constructor signature or `start()`/`stop()` methods
