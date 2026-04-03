# Agent B2 Handoff — `bridge/extension.ts` Decomposition

**Date:** 2026-03-29  
**Baseline commit:** `1651a03`  
**Package:** `packages/bridge` (pnpm filter: `accordo-bridge`)  
**Baseline tests:** 334 (all green)

---

## 1. Your Mission

Split `packages/bridge/src/extension.ts` (726 LOC) into 3 focused modules while keeping `extension.ts` as a thin bootstrap that delegates to the new files. Every existing test must remain green. No new cross-package dependencies.

---

## 2. Files You OWN (may create / modify)

| File | Action | Purpose |
|---|---|---|
| `src/extension.ts` | **MODIFY** — shrink to thin bootstrap | Keep `activate()` and `deactivate()` signatures, `BridgeAPI` interface, `ExtensionToolDefinition` re-export |
| `src/extension-bootstrap.ts` | **CREATE** | VSCode activation ceremony: output channel, config reads, copilot threshold, status bar, MCP config writes |
| `src/extension-composition.ts` | **CREATE** | Tool registration wiring, `BridgeAPI` object construction, WsClient event wiring, state publisher hookup |
| `src/extension-service-factory.ts` | **CREATE** | Service instantiation: HubManager creation, WsClient creation, ExtensionRegistry creation, CommandRouter creation, StatePublisher creation |
| `src/__tests__/extension-bootstrap.test.ts` | **CREATE** | Tests for bootstrap module |
| `src/__tests__/extension-composition.test.ts` | **CREATE** | Tests for composition module |
| `src/__tests__/extension-service-factory.test.ts` | **CREATE** | Tests for service factory module |

---

## 3. Files You MUST NOT Touch

| File | Reason |
|---|---|
| `src/hub-manager.ts` | Shared dependency — B2 imports from it but MUST NOT modify |
| `src/ws-client.ts` | Shared dependency |
| `src/extension-registry.ts` | Shared dependency |
| `src/command-router.ts` | Shared dependency |
| `src/state-publisher.ts` | Shared dependency |
| `src/agent-config.ts` | Shared dependency |
| `src/__tests__/*.test.ts` (all existing) | Existing test files — must pass unchanged |
| Any file in `packages/hub/` | Agent B1's territory |
| Any file in `packages/bridge-types/` | Shared types package — frozen |
| Any file in `packages/voice/`, `packages/diagram/`, `packages/editor/` | Agent B3's territory |
| Any file in `packages/comments/` | Agent B4's territory |
| Any file in `packages/browser-extension/` | Agent B5's territory |

---

## 4. Exported Symbol Contract

After the refactor, `extension.ts` must still export:

```typescript
export type { ExtensionToolDefinition };   // re-export from extension-registry
export interface BridgeAPI { ... }          // unchanged interface
export async function activate(context: vscode.ExtensionContext): Promise<BridgeAPI>
export async function deactivate(): Promise<void>
```

`command-router.ts` imports `import type { ExtensionRegistry } from "./extension-registry.js"` — that file is untouched.

No other files in the package currently import from `extension.ts` (confirmed — only `command-router.ts` imports from `extension-registry.ts`, not from `extension.ts`). The only consumer of `extension.ts` is VS Code itself via the activation entry point.

---

## 5. Critical Architecture Constraints

1. **VSCode imports STAY in bootstrap** — `vscode.window`, `vscode.workspace`, `vscode.commands` go into `extension-bootstrap.ts`. The composition and factory modules should receive VSCode dependencies via injection (function parameters), not direct imports — except `vscode.Disposable` and `vscode.EventEmitter` which are needed for types.

2. **No `vscode` imports in Hub** — `packages/hub/` must have zero `vscode` imports. But since you're only touching `packages/bridge/`, this is just a reminder: don't accidentally create shared code that leaks into hub.

3. **`@accordo/bridge-types` barrel only** — `import type { IDEState } from "@accordo/bridge-types"`. No subpath imports.

4. **Module globals** — `extension.ts` currently has module-level `let` variables (`wsClient`, `statePublisher`, `registry`, `router`, `hubManager`, `connectionStatusEmitter`, `currentHubToken`, `currentHubPort`). These should live in a single module (likely the composition module or a shared context object). Do NOT scatter them across files.

---

## 6. How to Split

### 6.1 `extension-bootstrap.ts`
Extract from `activate()`:
- Output channel creation
- MCP config path derivation
- Configuration reads (`vscode.workspace.getConfiguration("accordo")`)
- Copilot threshold configuration
- Status bar item creation and `updateStatusBar()` function
- Disposable registration patterns
- `syncMcpSettings()` private function (line 669+)

Export a function like `bootstrapExtension(context: vscode.ExtensionContext): BootstrapResult` that returns the config values, output channel, status bar item, etc.

### 6.2 `extension-service-factory.ts`
Extract service creation:
- `HubManager` instantiation with config
- `ExtensionRegistry` instantiation
- `CommandRouter` instantiation
- `StatePublisher` instantiation with VscodeApi
- Secret storage adapter creation

Export a factory function: `createServices(config, secretStorage, outputChannel): Services`

### 6.3 `extension-composition.ts`
Extract the wiring logic:
- `makeWsClientEvents()` callback factory
- `BridgeAPI` object construction (the object literal returned from `activate`)
- Tool registration/unregistration flow
- WsClient event handlers (onToolInvoke, onOpen, onClose, etc.)
- Hub-ready callback wiring
- Reauth confirmation dialog logic

Export: `composeExtension(services, bootstrap, context): BridgeAPI`

### 6.4 `extension.ts` (after split)
Becomes ~50-100 LOC:
- `BridgeAPI` interface definition (stays here — it's the public contract)
- `ExtensionToolDefinition` re-export
- `activate()` calls bootstrap → factory → compose → return BridgeAPI
- `deactivate()` calls cleanup

---

## 7. Verification Commands

```bash
# 1. All existing tests pass (334 tests)
pnpm --filter accordo-bridge test

# 2. Type check clean
pnpm --filter accordo-bridge exec tsc --noEmit

# 3. Build clean  
pnpm --filter accordo-bridge run build

# 4. Verify LOC targets
wc -l packages/bridge/src/extension.ts packages/bridge/src/extension-bootstrap.ts packages/bridge/src/extension-composition.ts packages/bridge/src/extension-service-factory.ts
```

---

## 8. Commit Format

```
refactor(bridge): decompose extension.ts into bootstrap/composition/factory modules

- extension.ts: 726 LOC → <250 LOC thin bootstrap
- extension-bootstrap.ts: VSCode activation, config, status bar
- extension-composition.ts: tool registration, BridgeAPI wiring
- extension-service-factory.ts: service instantiation
- Tests: 334 existing + N new (all green)
```

---

## 9. What NOT to Do

- ❌ Do NOT change the `BridgeAPI` interface shape — consumer extensions depend on it
- ❌ Do NOT change `activate()` or `deactivate()` function signatures
- ❌ Do NOT modify any file outside `packages/bridge/src/extension*.ts` and new test files
- ❌ Do NOT modify existing test files — only add new ones
- ❌ Do NOT create new cross-package dependencies
- ❌ Do NOT move `BridgeAPI` to a different file — it's the public contract of this extension
- ❌ Do NOT scatter module-level state across multiple files — keep it centralized
