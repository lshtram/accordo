# Module Map: `@accordo/bridge`

## Purpose
The central VSCode extension that bootstraps the Hub process, mediates WebSocket communication between the IDE and Hub, routes tool invocations from agents to registered extension handlers, and publishes IDE state to connected agents.

## Composition Root
`extension.ts` — `activate()` is called by VS Code on `onStartupFinished`. It performs a three-phase bootstrap: (1) `bootstrapExtension()` creates output channel, config, status bar, and secret storage; (2) `createServices()` instantiates HubManager, ExtensionRegistry, CommandRouter, and StatePublisher; (3) `composeExtension()` wires the BridgeAPI and starts the Hub lifecycle.

## Key Modules

| File | Responsibility | Public API |
|------|---------------|------------|
| `extension.ts` | VSCode entry point; owns BridgeAPI interface, activate/deactivate orchestration; imports `vscode` for ExtensionContext and Disposable types | Exports `BridgeAPI` interface and `ExtensionToolDefinition` |
| `extension-bootstrap.ts` | VSCode ceremony; creates output channel, config, status bar, SecretStorage adapter | `bootstrapExtension()`, `syncMcpSettings()`, `BridgeConfig` type |
| `extension-service-factory.ts` | Creates all service instances (HubManager, ExtensionRegistry, CommandRouter, StatePublisher) | `createServices()`, `Services` interface |
| `extension-composition.ts` | Wires BridgeAPI, registers VS Code commands, manages WsClient lifecycle, cleanup on deactivate | `buildHubManagerEvents()`, `composeExtension()`, `cleanupExtension()` |
| `hub-manager.ts` | Manages Hub child process lifecycle: health-check, spawn/kill, secret storage, reauth restart | `HubManager` class, `HubManagerEvents` interface |
| `hub-process.ts` | Spawns and kills the Hub Node.js child process; reads/writes PID files | Internal to HubManager |
| `hub-health.ts` | HTTP health-check polling against Hub; handles reauth rotation via POST /bridge/reauth | Internal to HubManager |
| `extension-registry.ts` | Manages tool registrations from multiple VSCode extensions; debounces toolRegistry WS messages | `ExtensionRegistry` class |
| `command-router.ts` | Routes Hub→Bridge invoke/cancel messages to registered handlers; enforces timeouts and confirmation dialogs | `CommandRouter` class |
| `state-publisher.ts` | Subscribes to 7 VSCode events; maintains local IDEState; sends debounced diffs + periodic keyframe snapshots to Hub | `StatePublisher` class |
| `state-collector.ts` | Raw VSCode event subscription and state collection; path normalization utilities | `HostEnvironment` interface, `collectCurrentState()` |
| `state-diff.ts` | Computes minimal diff patches between IDEState snapshots | `computePatch()`, `emptyState()` |
| `ws-client.ts` | Manages Bridge→Hub WebSocket connection; handles auth, reconnection backoff, ping/pong | `WsClient` class |
| `agent-config.ts` | Generates and writes `opencode.json` and `.claude/mcp.json` agent config files | `writeAgentConfigs()`, `removeWorkspaceThreshold()` |
| `extension-vscode-adapter.ts` | Thin adapter extracting VS Code API surface for injection | `createVsCodeApi()`, `createConfirmationFn()` |

## Extension Points

- **`BridgeAPI`** (exported from `extension.ts`): The interface that consumer extensions receive via `vscode.extensions.getExtension("accordo.accordo-bridge").exports`. Includes `registerTools()`, `publishState()`, `getState()`, `isConnected()`, `onConnectionStatusChanged`, and `invokeTool()`.
- **`ExtensionToolDefinition`**: The tool schema type consumed by `registerTools()`. Each definition includes `name`, `description`, `inputSchema`, `dangerLevel`, `requiresConfirmation`, `idempotent`, and a `handler` function.
- **`HubManagerEvents`**: Callbacks (`onHubReady`, `onHubError`, `onCredentialsRotated`) that wire Hub lifecycle into WsClient creation and agent config writing.
- **`StatePublisherSend`**: Callbacks (`sendSnapshot`, `sendUpdate`) injected at runtime so StatePublisher can send messages through the live WsClient.
- **`ConfirmationDialogFn`**: Injected confirmation callback — in production, maps to `vscode.window.showWarningMessage` for dangerous tool invocations.
- **`HostEnvironment`**: VSCode API surface injected into StatePublisher for testability.

## Internal Boundaries

- **`extension.ts`**, **`extension-bootstrap.ts`**, and **`extension-vscode-adapter.ts`** all import `vscode` directly. The architectural intent is that these three files are the only VSCode-touching layer; all other modules receive VSCode dependencies via injection through typed interfaces. This boundary is critical — breaking it would make the non-adapter modules untestable without a full VSCode host.
- **`CommentStore`** (from `@accordo/comments`) must NOT be imported here — it is a VSCode adapter that belongs in the comments package.
- **`hub-process.ts`** and **`hub-health.ts`** are internal helpers of HubManager and should not be imported directly by other modules.
- **`state-collector.ts`** and **`state-diff.ts`** are internal to StatePublisher — they are not re-exported from any public barrel.
- The **`CommandRouter.invokeTool()`** method is internal to the Bridge; it is used by `extension-composition.ts` but not exposed on BridgeAPI.
