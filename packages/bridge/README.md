# accordo-bridge

VSCode extension that connects the editor to the Accordo Hub. The Bridge manages the Hub process lifecycle, maintains a WebSocket connection for real-time state synchronization, routes tool calls between Hub and editor extensions, and auto-generates agent configuration files.

## Installation

Install from the VSCode Marketplace (search "Accordo IDE Bridge") or build from source:

```bash
cd packages/bridge
pnpm build
pnpm package       # produces .vsix file
```

Then install the `.vsix` via **Extensions → Install from VSIX**.

## Configuration

All settings are under the `accordo.*` namespace in VSCode settings:

| Setting | Type | Default | Description |
|---|---|---|---|
| `accordo.hub.port` | number | `3000` | Port for the Hub HTTP server |
| `accordo.hub.autoStart` | boolean | `true` | Auto-start Hub process if not running |
| `accordo.hub.executablePath` | string | `""` | Node.js executable path (empty = extension host's node) |
| `accordo.agent.configureOpencode` | boolean | `true` | Auto-generate `opencode.json` MCP config |
| `accordo.agent.configureCopilot` | boolean | `true` | Register Hub as native MCP server for Copilot |

## What It Does

### Hub Lifecycle Management
- Spawns the Hub process on activation (if `autoStart` is true)
- Polls `/health` to confirm Hub is ready
- Writes `~/.accordo/hub.pid` for process tracking
- Cleans up Hub on deactivation

### WebSocket Connection
- Connects to `ws://localhost:{port}/bridge` with exponential backoff
- Sends full IDE state snapshot on connect
- Sends incremental state patches on editor events
- Handles reconnect within 15s grace window (no state loss)

### Tool Call Routing
- Receives `invoke` messages from Hub, dispatches to extension handlers
- Returns results (success or error) back to Hub
- Supports cancellation via `cancel` messages
- Confirmation dialog for destructive tools

### Agent Configuration
- Writes `opencode.json` to workspace root (OpenCode MCP config)
- Writes `.claude/mcp.json` to workspace root (Claude MCP config)
- Registers Hub as native VSCode MCP server (Copilot integration)

### State Publishing
- Tracks active file, open editors, visible editors, workspace folders
- Tracks active terminal, workspace name, remote authority
- Debounces state patches at 50ms to avoid flooding
- Publishes per-extension modality state

## Exports (BridgeAPI)

Other extensions (like `accordo-editor`) consume the Bridge via its exported API:

```typescript
import type { BridgeAPI } from "@accordo/bridge-types";

const bridge = vscode.extensions.getExtension("accordo.accordo-bridge")?.exports as BridgeAPI;

// Register tools
bridge.registerTools("my-extension", myToolDefinitions);

// Update modality state
bridge.publishState("my-extension", { customData: "..." });
```

## Development

```bash
pnpm build         # Compile TypeScript
pnpm test          # Run 296 tests
pnpm typecheck     # Type-check without emitting
pnpm test:watch    # Watch mode
```

## Tests

296 unit tests covering:
- Hub manager (process lifecycle, PID file, health polling)
- WebSocket client (connect, reconnect, backoff, auth)
- Extension registry (tool registration, debouncing, metrics)
- Command router (invoke dispatch, cancel, confirmation flow)
- State publisher (snapshot, patches, debouncing, modalities)
- Agent config (OpenCode, Claude, fault isolation)

## License

[MIT](../../LICENSE)
