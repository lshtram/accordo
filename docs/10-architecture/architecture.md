# Accordo IDE — Architecture

**Status:** ACTIVE — incorporates browser MCP waves 1-8 and DEC-024 reload-reconnect lifecycle  
**Date:** 2026-04-08  
**Scope:** Current Accordo control plane and active modality architecture  
**Supersedes:** VSCODE-OPENSPACE-ARCHITECTURE.md §§1–5, 11, 13 (for Phase 1 scope)

---

## 1. Vision

Accordo IDE is an AI-native development environment where a human developer and an AI agent are **equal participants in a shared workspace**. The agent can see what the human sees, navigate code, open files, run terminals, and — in future phases — control presentations, drawing canvases, and voice. This is not "agent as assistant." It is "agent as co-present collaborator."

The project is built as a **layer on top of VSCode**. The human keeps their existing editor. The agent gains control through a structured MCP interface.

### Guiding Principles

| Principle | Implication |
|---|---|
| **VSCode as host** | Users install extensions, not a new IDE |
| **Hub is the product** | The MCP server + state engine is the core. It is editor-agnostic. |
| **Bridge is the only VSCode-specific piece** | Swapping VSCode for another editor means replacing only the bridge |
| **Extensions are independent** | Each modality is separately published, separately installable |
| **Zero prompt engineering** | When a new extension registers tools, the system prompt regenerates automatically |
| **Agent-agnostic** | The Hub speaks MCP. Any MCP-capable agent connects without modification |
| **Remote-first** | Architecture must work in local, SSH, devcontainer, and Codespaces without changes |

---

## 2. System Overview (Phase 1)

```
┌──────────────────────────────────────────────────────────────────────────┐
│  VSCode                                                                  │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────────┐│
│  │  accordo-editor   (extensionKind: ["workspace"])                     ││
│  │  • 16 editor/terminal/workspace MCP tools                            ││
│  │  • Registers tools via BridgeAPI.registerTools()                     ││
│  └──────────────────────┬───────────────────────────────────────────────┘│
│                         │ BridgeAPI (same extension host, direct import)  │
│  ┌──────────────────────▼───────────────────────────────────────────────┐│
│  │  accordo-bridge  (extensionKind: ["workspace"])                      ││
│  │  • WebSocket CLIENT connecting to Hub                                ││
│  │  • Routes Hub → VSCode command invocations                           ││
│  │  • Publishes IDE state events → Hub                                  ││
│  │  • Extension registration API (BridgeAPI)                            ││
│  │  • Hub lifecycle manager                                             ││
│  │  • Native MCP registration via McpHttpServerDefinition               ││
│  └──────────────────────┬───────────────────────────────────────────────┘│
└─────────────────────────┼────────────────────────────────────────────────┘
                          │ WebSocket (ws://localhost:3000/bridge)
┌─────────────────────────▼────────────────────────────────────────────────┐
│  accordo-hub  (Node.js standalone process)                               │
│                                                                          │
│  SERVERS:                                                                │
│  • MCP Streamable HTTP — single POST endpoint at /mcp                   │
│  • MCP stdio — when launched with --stdio flag                          │
│  • WebSocket server — /bridge path for Bridge connections               │
│  • HTTP GET /instructions — system prompt generation                    │
│  • HTTP GET /health — liveness check                                    │
│                                                                          │
│  INTERNAL:                                                               │
│  • Tool registry (runtime registration, no hardcoded tools)             │
│  • State cache (flat JSON snapshot, patched from Bridge events)         │
│  • Prompt engine (template rendering with token budget)                 │
│  • Security: loopback-only, Origin validation, bearer token auth        │
└─────────────────────────┬────────────────────────────────────────────────┘
                          │ MCP (Streamable HTTP or stdio)
┌─────────────────────────▼────────────────────────────────────────────────┐
│  AI Agent (any MCP-capable agent)                                        │
│  • GitHub Copilot → VSCode native MCP (auto-registered by Bridge)       │
│  • Claude Code → .claude/mcp.json (stdio)                               │
│  • OpenCode → opencode.json (Streamable HTTP + instructions URL)        │
│  • Cursor, Windsurf → their respective MCP config files                 │
└──────────────────────────────────────────────────────────────────────────┘
```

### Key architectural corrections from review

1. **Hub is the server, Bridge is the client.** Hub runs the WebSocket server. Bridge reconnects to it. If Bridge reloads (extension update, VSCode restart), it reconnects. Hub buffers events during the reconnection window.
2. **Streamable HTTP replaces HTTP+SSE.** The Hub exposes a single `POST /mcp` endpoint following MCP spec 2025-03-26. Deprecated two-endpoint `POST /mcp` + `GET /mcp/sse` is not implemented.
3. **`extensionKind` is declared explicitly.** Bridge and Editor are `["workspace"]` to guarantee access to files, terminals, and the workspace filesystem.
4. **`handler` is never on the wire.** Tool definitions sent from Bridge to Hub contain `{ name, description, inputSchema }` only. Handlers live in the extension host.
5. **Security baseline from day one.** Loopback-only binding, Origin header validation, bearer token authentication, per-tool confirmation policy.

---

## 3. Component: accordo-hub

### 3.1 Role

The Hub is the **central control plane**. It has zero VSCode dependency.

1. Maintain a live snapshot of IDE state (pushed by Bridge)
2. Generate a system prompt from that state + registered tools
3. Serve that prompt at `GET /instructions`
4. Run an MCP server exposing all registered tools
5. Route MCP tool calls to the Bridge via WebSocket
6. Enforce security policy (auth, Origin validation, tool confirmation rules)

### 3.2 Runtime

- **Language:** TypeScript on Node.js (>=20)
- **Process model:** Standalone. Bridge auto-starts it, or it runs manually via `npx accordo-hub`
- **Port:** `3000` (configurable via `--port` / `ACCORDO_HUB_PORT`)
- **Loopback only:** Binds to `127.0.0.1` by default. Flag `--host 0.0.0.0` for explicit opt-in to external access.
- **Reconnect-first model:** Hub is still normally bridge-managed, but reload/restart no longer assumes immediate termination. Bridge computes a stable `projectId` per workspace, keeps credentials in project-scoped SecretStorage keys, and uses a machine-global registry file at `~/.accordo/hubs.json` to discover the running Hub for that project. A fresh extension host can therefore reconnect to the correct live Hub after VS Code reload, while a different project spawns its own Hub. See `adr-reload-reconnect.md` for the lifecycle contract.

### 3.3 Server Endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| `/mcp` | POST | MCP Streamable HTTP. Request body is JSON-RPC. Response is JSON-RPC or SSE stream depending on `Accept` header. |
| `/instructions` | GET | Returns rendered system prompt (markdown). |
| `/health` | GET | Returns `{ ok: true, uptime: <seconds>, bridge: "connected"\|"disconnected", toolCount: <number>, protocolVersion: <string> }` |
| `/bridge` | WebSocket | Bridge connection point. Authenticated via `x-accordo-secret` header. |
| `/bridge/reauth` | POST | Credential rotation without Hub respawn. Auth: `x-accordo-secret: <current-secret>`. Body: `{ "newToken": "<new-token>", "newSecret": "<new-secret>" }`. Hub atomically replaces `ACCORDO_BRIDGE_SECRET` and `ACCORDO_TOKEN` in memory, then returns 200. No files are written. Allows Bridge to rotate credentials without terminating active agent sessions (e.g. on `accordo.hub.restart`). Returns 401 if the current secret is wrong. |
| `/bridge/disconnect` | POST | Graceful Bridge disconnect. Auth: `x-accordo-secret: <current-secret>`. Starts the Hub grace timer for reload survival and returns `{ ok: true, graceWindowMs }`. If no Bridge reconnects before the timer expires, Hub exits. |

### 3.4 MCP Transport — Streamable HTTP

Per MCP spec 2025-03-26:

- **Single endpoint:** `POST /mcp`
- **Request body:** JSON-RPC 2.0 request or batch
- **Response:** JSON-RPC 2.0 response, OR `text/event-stream` (SSE) for streaming results
- **Session management:** `Mcp-Session-Id` header issued by server on initialize, required on subsequent requests
- **Protocol version:** Negotiated during `initialize` handshake. Hub advertises `2025-03-26`.
- **Origin validation:** Hub MUST check `Origin` header on all HTTP requests. Reject requests from browser origins (prevents DNS rebinding/SSRF).

### 3.5 MCP Transport — stdio

When launched with `--stdio`, the Hub reads JSON-RPC from stdin and writes to stdout. No HTTP server is started. This mode is used by Claude Code and agents that spawn the Hub as a child process.

### 3.6 WebSocket Server (Bridge connection)

- Path: `/bridge`
- Authentication: `x-accordo-secret` header validated against `ACCORDO_BRIDGE_SECRET` env var (auto-generated by Bridge on Hub spawn)
- **Reconnect behaviour:** If Bridge disconnects intentionally, Hub starts a 10s grace timer via `POST /bridge/disconnect`. If a Bridge reconnects within the window, the timer is cancelled and the existing Hub process continues serving the same MCP surface. If the window expires, Hub exits cleanly and the next Bridge activation spawns a fresh Hub.
- **Heartbeat:** Hub sends `ping` every 5s. If no `pong` within 15s, considers Bridge disconnected.
- **Credential rotation:** `POST /bridge/reauth` allows Bridge to rotate secrets while Hub continues serving CLI agent sessions uninterrupted. Used for planned rotation only (e.g., `accordo.hub.restart`). If Bridge discovers an existing Hub whose secret it doesn't know (WS 4001 after Hub was externally replaced), kill-and-respawn is the only recovery path.

### 3.7 Tool Registry

Tools are registered at runtime by Bridge. The registry stores metadata only — no handlers.

```typescript
// Wire format: what Bridge sends to Hub
interface ToolRegistration {
  name: string;                    // "accordo.editor.open"
  description: string;
  inputSchema: JSONSchema;
  dangerLevel: 'safe' | 'moderate' | 'destructive';
  requiresConfirmation: boolean;
  idempotent: boolean;             // safe to retry on timeout
  group?: string;                  // optional grouping key — metadata only, no visibility effect
}
```

**Tool grouping (`group` field):** Each tool may carry a `group` key (e.g. `"editor"`, `"terminal"`, `"voice"`). This is **metadata only**. All tools, whether grouped or not, appear in MCP `tools/list` (unfiltered) and in the system prompt (`GET /instructions`). Hub strips `group` from the MCP wire output but it is present in the Bridge → Hub registration payload and is useful for UI categorisation. There is no hidden-tools / progressive-disclosure mechanism — agents always see the full tool surface from the first call.

When a tool call arrives via MCP:
1. Hub looks up tool by name in registry
2. Hub sends `invoke` message to Bridge over WebSocket
3. Bridge routes to the extension that registered the tool
4. Extension handler runs in the VSCode extension host
5. Result returns via WebSocket → Hub → MCP response

### 3.8 State Cache

```typescript
interface IDEState {
  activeFile: string | null;
  activeFileLine: number;
  activeFileColumn: number;
  openEditors: string[];
  visibleEditors: string[];
  workspaceFolders: string[];
  activeTerminal: string | null;
  modalities: {
    [extensionId: string]: Record<string, unknown>;
  };
}
```

Updated via `stateUpdate` WebSocket messages from Bridge. Merges patches (partial updates). Full snapshot sent on Bridge connect/reconnect.

### 3.9 Prompt Engine

`GET /instructions` renders a template with:
- Current `IDEState`
- Registered tool names and descriptions (NOT full input schemas — those are served via MCP `tools/list`)
- Behaviour guidelines

**Token budget:** Hard cap of **1,500 tokens** for the dynamic section (state + tool list). Core instructions are a fixed ~300 token prefix. If state + tools exceeds budget:
1. Compact state by omitting empty/null fields
2. Summarise tool list (name only, no descriptions for tools beyond top 10)
3. Only include modality state for modalities that have `isOpen: true`

### 3.10 Internal File Structure

```
accordo-hub/
├── src/
│   ├── index.ts             — CLI entry, arg parsing, process signals, registry registration
│   ├── server.ts            — HubServer class (thin delegation shell), HubServerOptions
│   ├── server-routing.ts    — createRouter(): URL switch, auth middleware, /health, /state, /instructions
│   ├── server-sse.ts        — createSseManager(): SSE connections, keep-alive, tool-list-changed push
│   ├── server-mcp.ts        — createMcpRequestHandler(): POST /mcp body read + session + dispatch; extractAgentHint()
│   ├── server-reauth.ts     — createReauthHandler(): POST /bridge/reauth credential rotation
│   ├── mcp-handler.ts       — JSON-RPC dispatch, session management
│   ├── bridge-server.ts     — WebSocket server for Bridge connections
│   ├── tool-registry.ts     — Tool registration, lookup, validation
│   ├── state-cache.ts       — IDEState storage, patch merging, snapshot
│   ├── prompt-engine.ts     — Template rendering, token budget enforcement
│   ├── security.ts          — Origin validation, bearer token, secret management
│   ├── protocol.ts          — Shared message types (Hub ↔ Bridge)
│   ├── health.ts            — /health endpoint
│   └── hub-registry.ts      — `~/.accordo/hubs.json` read/write helpers
├── package.json
├── tsconfig.json
└── README.md
```

**server.ts modular split (MOD-P2-B1):** The original 615-line `server.ts` was decomposed
into a thin delegation shell (`server.ts` < 250 LOC) plus four focused modules. Each module
exports a factory function that receives a typed `Deps` interface — no direct class references
leak across module boundaries. HubServer's constructor wires all factories together. The
`HubServer` class and `HubServerOptions` interface remain the only public exports from
`server.ts`; `index.ts` continues to `import { HubServer } from "./server.js"` unchanged.

---

## 4. Component: accordo-bridge

### 4.1 Role

The Bridge is the **only VSCode-specific core component**. It is the nervous system connecting the Hub to the editor.

1. Start and monitor the Hub process
2. Connect to Hub as a WebSocket client
3. Translate Hub invocations into VSCode API calls
4. Watch VSCode events and push state to Hub
5. Export a registration API (`BridgeAPI`) for other extensions
6. Register Hub as a native MCP server via VSCode `lm` API

### 4.2 Extension Manifest

```json
{
  "name": "accordo-bridge",
  "publisher": "accordo",
  "extensionKind": ["workspace"],
  "activationEvents": ["onStartupFinished"],
  "extensionDependencies": [],
  "contributes": {
    "configuration": {
      "title": "Accordo IDE",
      "properties": {
        "accordo.hub.port": { "type": "number", "default": 3000 },
        "accordo.hub.autoStart": { "type": "boolean", "default": true },
        "accordo.hub.executablePath": {
          "type": "string",
          "default": "",
          "description": "Absolute path to the Node.js executable used to spawn Hub. Empty = use PATH-resolved node. MACHINE/USER scope only — workspace settings are ignored to prevent RCE via repository configuration.",
          "scope": "machine"
        },
        "accordo.agent.configureOpencode": { "type": "boolean", "default": true },
        "accordo.agent.configureCopilot": { "type": "boolean", "default": true }
      }
    }
  }
}
```

### 4.3 Hub Lifecycle Manager

```
On activation:
1. Compute a stable `projectId` from the current workspace identity.
2. Read stored `accordo.<projectId>.bridgeSecret` and `accordo.<projectId>.hubToken` from VS Code SecretStorage.
3. If either is absent, generate fresh credentials, persist them, and use them for first launch for that project.
4. If `autoStart` is enabled, probe `~/.accordo/hubs.json` for the current `projectId`:
   a. If an entry exists, verify the recorded PID is alive.
   b. Call `GET /health` on the recorded port.
   c. If healthy, emit reconnect-ready state and skip spawn.
   d. If stale or unhealthy, ignore the entry and continue to spawn.
5. If no healthy Hub is found and `autoStart` is true:
   a. Spawn Hub: `execFile(nodePath, [hubEntry, '--port', port, '--project-id', projectId, '--registry', ~/.accordo/hubs.json], { env })`
   b. `env` includes `ACCORDO_BRIDGE_SECRET`, `ACCORDO_TOKEN`, `ACCORDO_HUB_PORT`, `ACCORDO_REGISTRY_PATH`.
   c. Hub picks the first free port and writes/updates its own `~/.accordo/hubs.json` entry for `projectId`.
   d. Poll `/health` at 500ms intervals (max 10s).
5. Connect WebSocket to `ws://127.0.0.1:{port}/bridge` with `x-accordo-secret`.
6. On connect: send full IDE state snapshot and current tool registry.
7. On disconnect: retry with exponential backoff unless auth/protocol failure requires hard recovery.

On deactivate() — async:
1. Call `POST /bridge/disconnect` (`softDisconnect`) so Hub starts its grace timer.
2. Close WebSocket connection.
3. Do not kill Hub immediately on normal reload/extension-host shutdown.
4. If the Bridge is intentionally performing hard recovery, use SIGTERM → wait 2s → SIGKILL.

On `accordo.hub.restart` command (soft restart — Hub keeps running, agents uninterrupted):
1. Generate new ACCORDO_BRIDGE_SECRET + ACCORDO_TOKEN
2. POST /bridge/reauth with current secret → Hub updates credentials in memory
3. Persist new credentials to SecretStorage
4. Close and reconnect WS with new secret
5. Rewrite agent config files with new token

On `accordo.hub.restart` when reauth fails (Hub not reachable or returns 401):
1. Kill Hub process (if running)
2. Generate new credentials, spawn new Hub, connect WS (normal spawn path)
```

### 4.4 WebSocket Protocol

All messages are JSON over WebSocket.

**Hub → Bridge:**

```typescript
// Invoke a registered tool
interface InvokeMessage {
  type: "invoke";
  id: string;                    // UUID for correlation
  tool: string;                  // "accordo.editor.open"
  args: Record<string, unknown>;
  timeout: number;               // ms — Hub's deadline for this call
}

// Request full state snapshot
interface GetStateMessage {
  type: "getState";
  id: string;
}

// Cancel an in-flight tool invocation
interface CancelMessage {
  type: "cancel";
  id: string;        // UUID of the InvokeMessage to cancel
}

// Heartbeat
interface PingMessage {
  type: "ping";
  ts: number;
}
```

**Bridge → Hub:**

```typescript
// Tool invocation result
interface ResultMessage {
  type: "result";
  id: string;                    // correlates with invoke id
  success: boolean;
  data?: unknown;
  error?: string;
}

// State patch (partial update)
interface StateUpdateMessage {
  type: "stateUpdate";
  patch: Partial<IDEState>;
}

// Full state snapshot
interface StateSnapshotMessage {
  type: "stateSnapshot";
  state: IDEState;
}

// Tool registry update
interface ToolRegistryMessage {
  type: "toolRegistry";
  tools: ToolRegistration[];     // full current list
}

// Acknowledgement that a cancellation was processed
interface CancelledMessage {
  type: "cancelled";
  id: string;        // correlates with CancelMessage.id
  late: boolean;     // true if handler had already completed before cancel arrived
}

// Heartbeat response
interface PongMessage {
  type: "pong";
  ts: number;
}
```

### 4.5 BridgeAPI (exported to other extensions)

```typescript
export interface BridgeAPI {
  /**
   * Register MCP tools for this extension.
   * Tools become available to agents immediately.
   * Returns a Disposable to unregister.
   */
  registerTools(extensionId: string, tools: ExtensionToolDefinition[]): Disposable;

  /**
   * Push a state update for this extension's modality namespace.
   * Merged into IDEState.modalities[extensionId].
   */
  publishState(extensionId: string, state: Record<string, unknown>): void;

  /**
   * Returns current full IDE state snapshot.
   */
  getState(): IDEState;
}

// What extensions pass to registerTools:
interface ExtensionToolDefinition {
  name: string;
  description: string;
  inputSchema: JSONSchema;
  dangerLevel: 'safe' | 'moderate' | 'destructive';
  requiresConfirmation?: boolean;  // default: true for destructive
  idempotent?: boolean;            // default: false
  handler: (args: unknown) => Promise<unknown>;  // STAYS LOCAL — never serialised
}
```

**Critical:** `handler` is stored in Bridge's in-process map. It is NEVER sent to Hub. Hub receives `ToolRegistration` (without handler). When Hub sends an `invoke`, Bridge looks up the handler by tool name and calls it locally.

### 4.6 State Publisher

Watches VSCode API events and sends state patches to Hub:

| VSCode Event | State Fields Updated |
|---|---|
| `onDidChangeActiveTextEditor` | `activeFile`, `activeFileLine`, `activeFileColumn` |
| `onDidChangeVisibleTextEditors` | `visibleEditors`, `openEditors` |
| `onDidChangeTextEditorSelection` | `activeFileLine`, `activeFileColumn` |
| `onDidChangeActiveTerminal` | `activeTerminal` |
| `onDidChangeWorkspaceFolders` | `workspaceFolders` |

**Debouncing:** All state patches are debounced at 50ms to avoid flooding during rapid cursor movement.

### 4.7 Native MCP Registration

Bridge registers the already-running Hub as a native MCP server with VSCode using the Streamable HTTP transport:

```typescript
vscode.lm.registerMcpServerDefinitionProvider('accordo', {
  provideMcpServerDefinitions(): vscode.McpServerDefinition[] {
    const port = config.get('accordo.hub.port', 3000);
    const token = await secretStorage.get(`accordo.${projectId}.hubToken`);
    return [
      new vscode.McpHttpServerDefinition(
        'accordo-hub',
        vscode.Uri.parse(`http://localhost:${port}/mcp`),
        { 'Authorization': `Bearer ${token}` }
      )
    ];
  }
});
```

**Critical:** This uses `McpHttpServerDefinition` (Streamable HTTP), NOT `McpStdioServerDefinition`. Pointing to the already-running Hub ensures Copilot and all VSCode-native MCP clients share the same Hub instance, with the same live state and tool registry, that the Bridge manages. A stdio definition would spawn a second, isolated Hub process with no active Bridge connection.

### 4.8 Remote Development Handling

In remote scenarios (SSH, devcontainer, Codespaces), the Bridge runs on the **remote host** (because `extensionKind: ["workspace"]`). The Hub is spawned on the same remote host. All communication is localhost-on-remote, which works correctly.

For future modality extensions that use WebViews: WebViews run in the **UI extension host** (local/browser). Any localhost URL injected into a WebView must be wrapped with `vscode.env.asExternalUri()` to ensure correct port forwarding.

### 4.9 Inter-Extension Communication

- **Same-host extensions** (all `["workspace"]`): `vscode.extensions.getExtension().exports` works reliably. This is the primary path.
- **Cross-host extensions** (e.g., future UI-kind modality): Must use `vscode.commands.executeCommand()`, which routes automatically regardless of extension host location.

Phase 1 has no UI-kind extensions, so `exports` API is sufficient.

### 4.10 Internal File Structure

```
accordo-bridge/
├── src/
│   ├── extension.ts           — activate(), deactivate(), export BridgeAPI
│   ├── hub-manager.ts         — spawn, health-check, restart Hub
│   ├── ws-client.ts           — WebSocket client to Hub, reconnect logic
│   ├── command-router.ts      — routes invoke messages to registered handlers
│   ├── state-publisher.ts     — watches VSCode events, debounced state patches
│   ├── extension-registry.ts  — stores ExtensionToolDefinition[], handler map
│   ├── mcp-registration.ts    — registers Hub with VSCode lm API
│   ├── protocol.ts            — shared message types
│   └── config.ts              — reads VSCode settings, defaults
├── package.json
├── tsconfig.json
└── README.md
```

---

## 5. Component: accordo-editor

### 5.1 Role

Exposes VSCode's built-in editor, terminal, and workspace capabilities as MCP tools. This is the foundational modality: the agent's ability to navigate and manipulate the workspace.

### 5.2 Extension Manifest

```json
{
  "name": "accordo-editor",
  "publisher": "accordo",
  "extensionKind": ["workspace"],
  "activationEvents": ["onStartupFinished"],
  "extensionDependencies": ["accordo.accordo-bridge"]
}
```

### 5.3 Activation

```typescript
export async function activate(context: vscode.ExtensionContext) {
  const bridge = vscode.extensions.getExtension('accordo.accordo-bridge')
    ?.exports as BridgeAPI;
  if (!bridge) return; // Bridge not installed — extension is inert

  const disposable = bridge.registerTools('accordo-editor', editorTools);
  context.subscriptions.push(disposable);
}
```

### 5.4 Tool Set

| Tool | Args | Returns | Danger | Idempotent |
|---|---|---|---|---|
| `accordo.editor.open` | `path`, `line?`, `column?` | `{ opened, path }` | safe | yes |
| `accordo.editor.close` | `path?` | `{ closed }` | safe | yes |
| `accordo.editor.scroll` | `direction` (up\|down), `by` (lines\|page) | `{ line }` | safe | no |
| `accordo.editor.highlight` | `path`, `startLine`, `endLine`, `color?` | `{ highlighted }` | safe | yes |
| `accordo.editor.clearHighlights` | — | `{ cleared }` | safe | yes |
| `accordo.editor.split` | `direction` (right\|down) | `{ groups }` | safe | no |
| `accordo.editor.focus` | `group` (1–9) | `{ focused }` | safe | yes |
| `accordo.editor.reveal` | `path` | `{ revealed }` | safe | yes |
| `accordo.terminal.open` | `name?`, `cwd?` | `{ terminalId }` | moderate | no |
| `accordo.terminal.run` | `command`, `terminalId?` | `{ sent, terminalId }` | destructive | no |
| `accordo.terminal.focus` | — | `{ focused }` | safe | yes |
| `accordo.workspace.getTree` | `depth?`, `path?` | `{ tree: TreeNode[] }` | safe | yes |
| `accordo.workspace.search` | `query`, `include?`, `maxResults?` | `{ results: Match[] }` | safe | yes |
| `accordo.panel.toggle` | `panel` (explorer\|search\|git\|debug\|extensions) | `{ visible }` | safe | yes |
| `accordo.layout.zen` | — | `{ active }` | safe | no |
| `accordo.layout.fullscreen` | — | `{ active }` | safe | no |

### 5.5 Implementation Notes

- File paths in tool arguments are resolved by the `resolvePath(input, context)` utility, which is multi-root-aware: it accepts either an absolute path or a path in the form `<workspaceFolderPath>/<relativePath>`. If the workspace has exactly one folder, a bare relative path is accepted and resolved against that folder. Tools always return absolute paths in their responses. Paths that resolve outside all workspace folders are rejected.
- `accordo.editor.highlight` uses `vscode.window.createTextEditorDecorationType`
- `accordo.terminal.run` uses `terminal.sendText(command, true)`
- `accordo.workspace.getTree` respects VSCode file excludes + .gitignore
- `accordo.workspace.search` uses `vscode.workspace.findTextInFiles()`

### 5.6 Internal File Structure

```
accordo-editor/
├── src/
│   ├── extension.ts           — activate(), tool registration
│   ├── tools/
│   │   ├── editor.ts          — open, close, scroll, highlight, split, focus, reveal
│   │   ├── terminal.ts        — open, run, focus
│   │   ├── workspace.ts       — getTree, search
│   │   └── layout.ts          — panel.toggle, zen, fullscreen
│   └── util.ts                — path resolution, error wrapping
├── package.json
├── tsconfig.json
└── README.md
```

---

## 6. Runtime Topology

### 6.1 Local Development (macOS/Linux/Windows)

```
User machine:
  VSCode process
    ├── Workspace Extension Host
    │     ├── accordo-bridge  → WS client → localhost:3000/bridge
    │     └── accordo-editor  → BridgeAPI.registerTools()
    └── (no UI extensions in Phase 1)

  accordo-hub process (spawned by bridge)
    ├── HTTP:  127.0.0.1:3000
    ├── WS:    127.0.0.1:3000/bridge
    └── stdio: (if launched with --stdio by agent)

  Agent process (separate)
    └── MCP client → POST http://localhost:3000/mcp
        OR stdio pipe to accordo-hub
```

### 6.2 SSH Remote

```
Local machine:                 Remote host:
  VSCode UI ─── SSH ──────►     Remote Extension Host
                                  ├── accordo-bridge → WS → localhost:3000/bridge
                                  └── accordo-editor
                                accordo-hub (spawned on remote)
                                  └── 127.0.0.1:3000 (on remote)
```

Hub binds to loopback **on the remote host**. Bridge runs on the same remote host. All communication is local-to-remote. Works correctly.

### 6.3 Dev Containers

Same as SSH — the extension host runs inside the container. Hub is spawned inside the container. `localhost` means container-local. Works correctly if `npx` / Node.js is available inside the container.

### 6.4 Codespaces

Same topology as SSH. The Codespace VM runs the workspace extension host + Hub. VSCode UI runs in the browser. No WebViews in Phase 1, so no port-forwarding edge cases.

### 6.5 Topology Matrix: Agent Location vs IDE Location

| Topology | Agent runs on | VSCode + Bridge runs on | Hub runs on | Net path: Agent → Hub |
|---|---|---|---|---|
| **Local** | Developer machine | Developer machine | Developer machine | `localhost:3000` direct |
| **SSH Remote** | Developer machine (local terminal) | Remote host (extension host) | Remote host | SSH port-forward required. Agent must forward `remote:3000 → localhost:3000` via `ssh -L 3000:localhost:3000 user@host` or equivalent. |
| **Dev Container** | Host machine (local terminal) | Container (extension host) | Container | Container port-forward required via Docker `-p 3000:3000` or VS Code auto-forwarded port. |
| **Codespaces** | Browser / local VS Code UI | Codespace VM | Codespace VM | Codespace port-forwarding: the forwarded port URL for port 3000, with the same bearer token. |
| **All remote** | Remote host | Remote host | Remote host | `localhost:3000` direct — identical to Local. |

**Auth note for remote topologies:** The bearer token is stored in VSCode SecretStorage on the remote host and written to workspace config files (e.g., `opencode.json`). When configuring agents that run on a different host (e.g., local agent + SSH remote IDE), the token must be extracted from the workspace config file on the remote host (e.g., `ssh user@host cat /path/to/project/opencode.json | jq '.mcp.accordo.headers.Authorization'`). See `multi-session-architecture.md` §7 for the full remote topology matrix.

---

## 7. Security

### 7.1 Hub HTTP Security

| Control | Implementation |
|---|---|
| **Loopback binding** | `127.0.0.1` by default. Explicit `--host` flag required for any other interface. |
| **Origin validation** | All HTTP requests must have either no `Origin` header (non-browser) or an `Origin` of `localhost`/`127.0.0.1`. Reject all other origins. Prevents DNS rebinding. |
| **Bearer token** | `Authorization: Bearer <token>` required on `/mcp` and `/instructions`. Token originates from Bridge: generated on Hub spawn, stored in VSCode `SecretStorage` (key: `accordo.<projectId>.hubToken`), passed to Hub as `ACCORDO_TOKEN` env var. Hub holds the token in memory only — no file is written. Token is workspace-local (written to workspace config files by Bridge). Never committed to workspace (config files are in `.gitignore`). |
| **CORS** | No CORS headers served by default. Agents use same-origin or non-browser requests. |

### 7.2 WebSocket Security

| Control | Implementation |
|---|---|
| **Shared secret** | Bridge generates UUID, passes to Hub via `ACCORDO_BRIDGE_SECRET` env var on spawn. Hub validates `x-accordo-secret` header on WebSocket upgrade. |
| **Single client** | Hub accepts at most one Bridge connection. Second connection is rejected with 409. |

### 7.3 Tool Confirmation Policy

| Danger Level | Default Behaviour |
|---|---|
| `safe` | Execute immediately, no prompt |
| `moderate` | Execute immediately (user can change to "confirm" in settings) |
| `destructive` | Confirmation dialog in VSCode before execution (user can change to "auto-approve" per tool) |

### 7.4 Audit Log

All tool invocations are logged to `~/.accordo/audit.jsonl`:

```json
{"ts":"2026-03-02T10:30:00Z","tool":"accordo.terminal.run","args_hash":"sha256:abc123","agent":"opencode","result":"success","duration_ms":150}
```

Args are hashed (not logged in cleartext) to avoid logging secrets. Result is `success` or `error`. Log uses size-based rotation: when the file exceeds **10 MB** it is renamed to `audit.1.jsonl` (overwriting any previous rotation); Hub then starts a new `audit.jsonl`. Maximum retained: 2 files (~20 MB total).

---

## 8. Reliability Contracts

### 8.1 Heartbeat and Liveness

| Parameter | Value |
|---|---|
| Hub → Bridge ping interval | 5 seconds |
| Pong grace window | 15 seconds |
| Bridge reconnect backoff | 1s, 2s, 4s, 8s, 16s, max 30s |
| Hub state hold window after disconnect | 15 seconds |

### 8.2 Timeout Taxonomy

| Operation Class | Timeout | Behaviour on Timeout |
|---|---|---|
| **Fast** (editor.open, panel.toggle) | 5 seconds | Return error to agent |
| **Interactive** (terminal.run, workspace.search) | 30 seconds | Return error to agent |
| **Long-running** (future: build, deploy) | Indefinite | Cancellable via `cancel` message. Agent polls for status. |

Hub sets the `timeout` field on every `invoke` message. Bridge enforces it locally and returns an error result if exceeded.

### 8.3 Idempotency

Tools marked `idempotent: true` (e.g., `editor.open`, `editor.focus`) can be safely retried by the Hub if the first invocation timed out but the Bridge may have received it. Hub retries once after timeout for idempotent tools. The audit log records both the original timeout and the retry outcome.

### 8.4 Concurrent Invocations

Multiple agents may connect to the same Hub simultaneously (swarm scenario) and issue tool calls in parallel. Each MCP session is independent; the Hub may receive concurrent `tools/call` requests from different agents.

| Parameter | Value | Notes |
|---|---|---|
| Max concurrent in-flight invocations (Hub-wide) | 16 | Across all sessions combined |
| Queue depth (waiting for a slot) | 64 | FIFO queue per Hub instance |
| Configuration constant | `ACCORDO_MAX_CONCURRENT_INVOCATIONS` | Can be changed without code edit |

**Behaviour:**
- Hub maintains a counter of in-flight invocations (forwarded to Bridge, awaiting result).
- Invocations below the limit are forwarded to Bridge immediately.
- Invocations at the limit are queued (FIFO across all sessions).
- If the queue is full (64 waiting), Hub returns MCP error `-32004` (`"Server busy — invocation queue full"`) immediately.
- Bridge processes invocations concurrently (each handler is `async`); Bridge imposes no serialisation.
- The 16-slot limit exists to protect the VSCode extension host from saturation, not to limit per-session parallelism. A single highly-parallel agent and a swarm of single-threaded agents are treated identically.

### 8.5 WebSocket Flood Protection

The Hub enforces a per-connection message rate limit on the Bridge WebSocket. Implementation uses a sliding 1-second window counter:

| Parameter | Default | Notes |
|---|---|---|
| `maxMessagesPerSecond` | 100 | Configurable via `BridgeServerOptions` |

**Behaviour:**
- Each incoming message increments a counter for the current 1-second window.
- If the counter exceeds `maxMessagesPerSecond`, the message is silently dropped (not processed).
- The window resets on the first message received after the previous window expires.
- The WebSocket connection is **never closed** due to rate limiting — messages are simply discarded.

### 8.6 WebSocket Message Size Limit

The Hub sets `maxPayload` on the `WebSocketServer` constructor to reject oversized messages at the protocol level:

| Parameter | Default | Notes |
|---|---|---|
| `maxPayload` | 1 MB (1048576 bytes) | Configurable via `BridgeServerOptions` |

Messages exceeding this limit cause `ws` to close the connection with a protocol error. The Bridge should keep state patches well under this limit via debouncing and incremental updates.

---

## 9. Startup Sequence (Phase 1)

```
1. VSCode opens workspace
2. accordo-bridge activates (onStartupFinished)
3. Bridge reads stored secret + token from VSCode SecretStorage
   (If absent: generate new ones, persist immediately)
4. Bridge checks GET http://localhost:{port}/health
5. If Hub is running and healthy:
   a. Attempt WS connect with stored secret → if OK, skip to step 8
   b. If WS close code 4001 → Hub is orphaned/foreign; kill and fall through to step 6
6. If Hub not running (or step 5b) and autoStart:
   a. Generate new ACCORDO_BRIDGE_SECRET + ACCORDO_TOKEN, persist to SecretStorage
   b. Bridge spawns Hub via execFile(nodePath, ...) with env vars
   c. Parse Hub stderr for actual port
   d. Bridge polls /health (500ms interval, 10s timeout)
7. Bridge connects WS to ws://localhost:{port}/bridge
8. Bridge sends stateSnapshot (full IDEState) including ACCORDO_PROTOCOL_VERSION
9. Hub validates protocol version; if mismatch → close WS with 4002, log error
10. Hub marks itself ready
11. accordo-editor activates, calls bridge.registerTools()
12. Bridge sends toolRegistry message to Hub
13. Bridge registers Hub as native MCP server (Copilot — via settings or lm API)
14. Bridge writes opencode.json / .claude/mcp.json if configured (token from SecretStorage)
15. Agent starts, connects MCP, fetches /instructions
16. Agent sees IDE state + 16 editor tools. Session is live.
```

---

## 10. Package Structure (Phase 1)

```
accordo-hub/                  npm package — "accordo-hub"
  Published: npmjs.com
  Install: npm install -g accordo-hub (or auto-spawned by bridge)

@accordo/bridge-types/        npm package — TypeScript type definitions only
  Published: npmjs.com
  Used by: all extension authors for typed BridgeAPI
  Internal structure (barrel re-export, no subpath imports):
    src/index.ts          — barrel: re-exports all public symbols
    src/ide-types.ts      — IDEState, OpenTab, OPEN_TAB_TYPES
    src/tool-types.ts     — ExtensionToolDefinition, ToolRegistration, McpTool, schemas
    src/ws-types.ts       — Hub↔Bridge WebSocket message types
    src/comment-types.ts  — comment anchors, threads, storage, scale constants
    src/constants.ts      — protocol constants, AuditEntry, HealthResponse, etc.

accordo-bridge/               VSCode extension — "accordo.accordo-bridge"
  Published: VSCode Marketplace
  extensionKind: ["workspace"]
  Exports: BridgeAPI

accordo-editor/               VSCode extension — "accordo.accordo-editor"
  Published: VSCode Marketplace
  extensionKind: ["workspace"]
  extensionDependencies: ["accordo.accordo-bridge"]
```

---

## 11. What Is NOT in Phase 1

The following are explicitly deferred:

- `accordo-chat` — Users have Copilot Chat, Cline, Claude, etc. No custom chat.
- `accordo-slidev` — Modality. Requires Phase 1 gate to pass first.
- `accordo-tldraw` — Modality. Requires Phase 1 gate to pass first.
- `accordo-voice` — Voice modality (TTS read-aloud only — no STT/dictation). Implemented in Phase 2 Session 10. Architecture: [`docs/voice-architecture.md`](voice-architecture.md).
- `accordo-script` — **Removed (2026-04-16).** Previously implemented in Session 10D. The built-in scripting engine has been removed. External script authoring via Python skill remains available.
- Custom IDE packaging — No.
- Cloud/hosted Hub — No. Local-first only.

**Phase 2 additions (after Phase 1 gate):**

- **Remote topology UX:** When Bridge detects it is running on a remote host (SSH/devcontainer/Codespaces), emit a VSCode notification surfacing the port-forward command and bearer token needed for local agents. Consider `vscode.env.asExternalUri()` auto-forwarding for the Hub port.
- **Checkpoint/rollback:** Lightweight git-stash-based workspace snapshots triggered before `destructive` tool executions. Gives users a recovery path if an agent's terminal commands cause damage. Reference: Cline's checkpoint model.
- **Exact token counting:** Replace `chars / 4` heuristic in `prompt-engine.ts` with `tiktoken` (or equivalent) for accurate token budgeting.

## 12. Component: @accordo/comment-sdk (Phase 2)

> **Agent note [2026-03-05]:** Established during Week 7 / UX polish session. The SDK is the shared display layer for all commenting surfaces.

### 12.1 Role

A framework-free, browser-bundled JS library (`sdk.browser.js` + `sdk.css`) that any Accordo webview can embed to get pins, popovers, and comment interactions. It has **no VS Code dependency** — it communicates with the host extension exclusively via `postMessage`.

### 12.2 Surface-agnostic contract

Any webview that wants commenting support:

1. Loads `sdk.browser.js` + `sdk.css` (copied into the extension's WebviewPanel via `localResourceRoots`)
2. Calls `sdk.init({ container, callbacks: { onReply, onResolve, onReopen, onDelete, onNew } })`
3. Assigns `data-block-id` attributes to content nodes
4. Handles inbound `postMessage` types: `comments:load`, `comments:add`, `comments:update`, `comments:remove`, `comments:focus`

Improvements to the SDK (richer popover, threaded reply view, reactions, markdown rendering) automatically propagate to **all surfaces that embed it**: markdown preview (`accordo-md-viewer`), future HTML viewer, image viewer, diagram viewer, presentation extensions.

### 12.3 Data flow

```
CommentStore (accordo-comments)
    └── PreviewBridge (per-panel)
           └── postMessage → webview
                   └── CommentSDK (sdk.browser.js)
                           └── pin + popover DOM
                                   └── callback → postMessage → extension command → CommentStore
```

### 12.4 Built-in Comments panel limitation

The VS Code **built-in Comments panel** (bottom-bar `workbench.panel.comments`) does **not** support custom context menu contributions or click-to-navigate overrides. See `docs/patterns.md` P-12 for full analysis. A custom **Accordo Comments TreeView** sidebar panel is tracked in `docs/workplan.md` deferred backlog #7 and will replace the built-in panel as the primary navigation surface.

---

## 13. Former Component: accordo-script (Removed)

> **Agent note [2026-04-16]:** The built-in scripting engine has been removed. The `accordo_script_*` tools are no longer registered. External script authoring via the Python skill + NarrationScript approach remains available.

The built-in `accordo-script` module (Session 10D, M52) has been removed. The Hub's `HubToolRegistration` / `localHandler` infrastructure (DEC-005) remains available for future Hub-native tools.

**What was removed:**
- `packages/hub/src/script/` — Hub-native script runner, tools, and types
- `packages/script/` — VS Code extension package

**What remains:**
- `packages/hub/src/hub-tool-types.ts` — `HubToolRegistration` type and `isHubTool()` guard (generic, not script-specific)
- `packages/hub/src/mcp-call-executor.ts` — `isHubTool()` short-circuit for local handler execution (generic)

**Migration path for script-style demos:** Use the Python skill approach with external script execution, or implement a dedicated script runner as a standalone service.

---

## 14. Browser Page Understanding (Session 15+)

> **Agent note [2026-03-26]:** Established during Phase A design. Gives AI agents the ability to inspect live browser pages and place comments on precisely identified DOM elements.

### 14.1 Role

The page understanding capability extends the existing browser relay infrastructure with read-only DOM inspection tools. Agents gain a structured view of the browser page's content and can identify specific elements for targeted comment placement.

### 14.2 Architecture Placement

Page understanding tools flow through the existing relay path:

```
Agent → Hub (MCP) → Bridge → accordo-browser → Chrome relay → content script → DOM
                                                                         ↓
Agent ← Hub (MCP) ← Bridge ← accordo-browser ← Chrome relay ← structured result
```

> **Shared Browser Relay [2026-04-08]:** When multiple VS Code windows are open, the relay
> becomes a shared service. Each window's `accordo-browser` extension connects to a single
> `SharedBrowserRelayServer` as a Hub client (via `SharedRelayClient`). The Chrome extension
> connects once to the same shared server. Request routing uses `hubId` to ensure responses
> reach the correct window. Mutating actions use a write lease for safety.
> See `docs/10-architecture/shared-browser-relay-architecture.md` for the full design.
> This is an explicit exception to DECISION-MS-07 (see `multi-session-architecture.md`).

Nineteen page-understanding, interaction, and control MCP tools are registered by `accordo-browser` via `buildBrowserTools()` in `tool-assembly.ts`:
- `accordo_browser_get_page_map` — structured DOM tree summary (breadth-first, depth/node-limited)
- `accordo_browser_inspect_element` — deep single-element inspection with anchor generation
- `accordo_browser_get_dom_excerpt` — raw HTML fragment for a CSS selector subtree
- `accordo_browser_capture_region` — cropped viewport screenshot of a specific element or rect
- `accordo_browser_list_pages` — enumerate open tabs
- `accordo_browser_select_page` — activate a tab by tabId
- `accordo_browser_wait_for` — wait for a condition on the active page (text appearance, CSS selector match, or layout stability) with configurable timeout and clear error semantics (B2-WA-001..007)
- `accordo_browser_get_text_map` — visible text with reading order
- `accordo_browser_get_semantic_graph` — a11y tree + landmarks + outline + forms
- `accordo_browser_diff_snapshots` — DOM change tracking between snapshots
- `accordo_browser_health` — relay connection health check
- `accordo_browser_manage_snapshots` — list/clear retained snapshots (GAP-F1)
- `accordo_browser_manage_screenshots` — list/clear retained screenshots (GAP-G1)
- `accordo_browser_get_spatial_relations` — pairwise spatial relationships between elements
- `accordo_browser_navigate` — URL navigation + back/forward/reload
- `accordo_browser_click` — click an element
- `accordo_browser_type` — type text into an element
- `accordo_browser_press_key` — press keyboard key/combo
- `accordo_browser_pair` — issue pairing code for browser extension connection

These are registered as standard MCP tools (not routed through `comment_*`) because they are read-only inspection/synchronisation tools, not comment operations. Interaction tools (`navigate`, `click`, `type`, `press_key`) follow the same relay → content-script dispatch path as the page-understanding tools.

### 14.3 Enhanced Anchor Strategy

The existing anchor system (`tagName:siblingIndex:textFingerprint`) is extended with a tiered strategy hierarchy. Each anchor key is prefixed with its strategy type:

| Priority | Strategy | Format | Stability |
|---|---|---|---|
| 1 | `id` | `id:<value>` | High — survives page reloads |
| 2 | `data-testid` | `data-testid:<value>` | High — designed to be stable |
| 3 | `aria` | `aria:<label>/<role>` | Medium — semantic, resilient |
| 4 | `css-path` | `css:<selector>` | Medium — position-dependent |
| 5 | `tag-sibling` | `tag:<tagName>:<idx>:<fingerprint>` | Low — session-scoped |
| 6 | `viewport-pct` | `body:<x>%x<y>%` | Low — viewport-dependent |

Backward compatible: existing unprefixed keys are treated as `tag-sibling` strategy.

### 14.4 Portability Layer

A `CommentBackendAdapter` interface abstracts comment storage so the browser extension can operate with different backends:
- **VS Code relay adapter** (current) — routes through `RelayBridgeClient` → `onRelayRequest` → `comment_*` tools
- **Local storage adapter** (fallback) — uses `chrome.storage.local` directly
- **Standalone MCP adapter** (future) — connects directly to Hub without VS Code

### 14.5 Region Capture (`accordo_browser_capture_region`)

> **Agent note [2026-03-26]:** Added during Phase A extension. Gives agents a targeted screenshot of a specific page element or region — avoiding full-viewport screenshots that bloat agent context windows.

**Design principle:** This tool is implemented as a **crop from the existing full-viewport screenshot** (`chrome.tabs.captureVisibleTab()`), not through CDP element-screenshot APIs. This avoids new browser API complexity while achieving the product goal of smaller, focused images.

**Input schema:**

```typescript
interface BrowserCaptureRegionArgs {
  /** Anchor key or node ref identifying the target element (from page map / inspect) */
  anchorKey?: string;
  /** Node ref from accordo_browser_get_page_map */
  nodeRef?: string;
  /** Explicit viewport-relative rectangle (fallback when no element target) */
  rect?: { x: number; y: number; width: number; height: number };
  /** Padding around the element bounding box in pixels (default: 8, max: 100) */
  padding?: number;
  /** JPEG quality 1–100 (default: 70) */
  quality?: number;
}
```

**Output schema:**

```typescript
interface BrowserCaptureRegionResult {
  /** Whether the capture succeeded */
  success: boolean;
  /** Cropped image as JPEG data URL */
  dataUrl?: string;
  /** Actual dimensions of the cropped image */
  width?: number;
  height?: number;
  /** Size of the data URL in bytes */
  sizeBytes?: number;
  /** Which input was used: "anchorKey" | "nodeRef" | "rect" | "fallback" */
  source?: string;
  /** Error message when success=false */
  error?: string;
}
```

**Hard limits:**

| Limit | Value | Rationale |
|---|---|---|
| Max output width | 1200 px | Avoids oversized images that waste agent tokens |
| Max output height | 1200 px | Same — caps area to ~1.44 Mpx |
| Min output dimension | 10 px | Reject degenerate zero-area rects |
| JPEG quality range | 30–85 (default 70) | Clamped — prevents bloated high-quality or unusable low-quality |
| Max data URL size | 500 KB | Hard reject if cropped image exceeds this; agent should use `dom_excerpt` or `inspect_element` instead |
| Max padding | 100 px | Prevents "padding the whole page" anti-pattern |

**Failure modes and fallback behaviour:**

| Failure | Behaviour |
|---|---|
| `anchorKey` or `nodeRef` cannot be resolved | Return `{ success: false, error: "element-not-found" }` |
| Resolved bounding box is entirely off-screen | Return `{ success: false, error: "element-off-screen" }` — agent should scroll first |
| Cropped result exceeds 500 KB byte cap | Reduce quality by 10 and retry once; if still over, return `{ success: false, error: "image-too-large" }` |
| `captureVisibleTab` fails (e.g., restricted page) | Return `{ success: false, error: "capture-failed" }` |
| No input provided (no anchorKey, no nodeRef, no rect) | Return `{ success: false, error: "no-target" }` |
| `rect` partially off-screen | Clamp to visible viewport bounds; crop what's visible |

**Danger level:** `safe` (read-only)  
**Idempotent:** `true`  
**MCP tool name:** `accordo_browser_capture_region`

**Implementation approach:** The content script resolves the target element to viewport-relative bounding box coordinates, then the service worker captures `captureVisibleTab()` and crops using `OffscreenCanvas` (or `createImageBitmap` + canvas). No CDP, no new browser APIs — the only new API surface is `OffscreenCanvas` for pixel-level cropping.

### 14.6 Context-Budget Guidance

> **Purpose:** Help agents (and agent-system-prompt authors) choose the right page understanding tool for each situation, minimising context window consumption.

**Tool selection hierarchy (cheapest first):**

| Tool | Token cost | Use when |
|---|---|---|
| `accordo_browser_get_page_map` | ~200–800 tokens (structured JSON) | Agent needs to understand page layout, find elements, or decide where to place a comment. Start here. |
| `accordo_browser_inspect_element` | ~50–150 tokens | Agent has a target element (from page map `ref` or CSS selector) and needs its anchor key, bounding box, or ARIA context. |
| `accordo_browser_get_dom_excerpt` | ~100–500 tokens (bounded by `maxLength`) | Agent needs the raw structure of a specific subtree (table data, form fields, list items). |
| `accordo_browser_capture_region` | ~1–5 KB base64 (JPEG) | Agent needs *visual* context that structured data cannot convey (styling, color, layout, rendered text, charts). Use only when DOM structure is insufficient. |
| Full viewport screenshot | ~10–50 KB base64 | Almost never. Only when agent explicitly needs to see the entire visible page (e.g., layout review). Prefer `capture_region` for focused areas. |

**Anti-patterns (AVOID):**

| Anti-pattern | Why it's bad | Use instead |
|---|---|---|
| Calling `get_page_map` with `maxNodes: 500` on every turn | Floods context with 500+ nodes each time | Use `maxNodes: 50` or `viewportOnly: true` for orientation; drill down with `inspect_element` |
| Repeated full-viewport screenshots | Each screenshot is 10–50 KB of base64 in the context window | Use `capture_region` targeting the specific element of interest |
| Calling `get_dom_excerpt` with `maxLength: 10000` | Returns multi-KB HTML blobs | Keep `maxLength` at default (2000) or lower; increase only when parsing a data table |
| Capturing a region immediately without checking the page map first | Agent doesn't know what's on the page; capture may be misaligned | Start with `get_page_map` → `inspect_element` → then `capture_region` if visual context is needed |
| Re-fetching page map after every comment placement | Page map is stable for short periods; DOM doesn't change between agent actions unless the user navigates | Cache page map results for the duration of a single agent turn |

**Recommended workflow for comment placement:**

1. `accordo_browser_get_page_map({ maxDepth: 3, maxNodes: 100 })` — orientation
2. `accordo_browser_inspect_element({ ref: "..." })` — get anchor key for target element
3. (Optional) `accordo_browser_capture_region({ anchorKey: "..." })` — only if visual confirmation needed
4. `comment_create({ scope: { modality: "browser" }, anchor: { anchorKey: "..." }, body: "..." })`

### 14.7 Server-Side Filtering (`accordo_browser_get_page_map` — M102-FILT)

**Module:** M102-FILT  
**Requirements:** [`docs/20-requirements/requirements-browser2.0.md`](../20-requirements/requirements-browser2.0.md) — B2-FI-001..008  
**Architecture:** [`docs/browser2.0-architecture.md`](browser2.0-architecture.md) §7

#### Purpose

Agents frequently need only a subset of the page map — interactive elements, nodes matching a role, or elements within a region. Without server-side filtering, agents must receive the entire page map and discard irrelevant nodes client-side, wasting context tokens. M102-FILT adds six composable filter parameters to `accordo_browser_get_page_map` that reduce the returned node set before it leaves the content script.

#### Filter Parameters

All parameters are optional. When omitted, no filtering is applied (backwards-compatible).

| Parameter | Type | Requirement | Description |
|---|---|---|---|
| `visibleOnly` | `boolean` | B2-FI-001 | Only elements whose bounding box intersects the current viewport |
| `interactiveOnly` | `boolean` | B2-FI-002 | Only interactive elements (button, a, input, select, textarea, `[role="button"]`, `[contenteditable]`, click handlers) |
| `roles` | `string[]` | B2-FI-003 | Filter by ARIA role(s); implicit role mapping applied (e.g., `h1`–`h6` → `heading`) |
| `textMatch` | `string` | B2-FI-004 | Substring match on visible text content (case-insensitive) |
| `selector` | `string` | B2-FI-005 | CSS selector match; invalid selectors silently ignored (returns all elements) |
| `regionFilter` | `{ x, y, width, height }` | B2-FI-006 | Bounding box region filter (viewport coordinates); all four fields required |

#### AND-Composition Semantics (B2-FI-007)

When multiple filters are provided, they compose with **AND semantics**: a node must pass **all** active filters to be included in the result. The filter pipeline is built once per request and each element is tested against every active predicate during DOM traversal.

Example: `{ interactiveOnly: true, roles: ["button"], textMatch: "submit" }` returns only interactive elements that have role `button` AND contain the text "submit".

#### `filterSummary` Output (B2-FI-008)

When at least one filter parameter is provided, the response includes a `filterSummary` object:

```typescript
interface FilterSummary {
  /** Names of the filters that were active. */
  activeFilters: string[];
  /** Number of nodes before filtering. */
  totalBeforeFilter: number;
  /** Number of nodes after filtering. */
  totalAfterFilter: number;
  /** Reduction ratio (0.0–1.0) — e.g. 0.6 means 60% reduction. */
  reductionRatio: number;
}
```

The reduction ratio links to the ≥40% reduction target defined in [`browser2.0-architecture.md` §7.2](browser2.0-architecture.md): filtered requests on a medium-complexity page (~1,000 nodes) should achieve at least 40% node reduction.

#### Ownership Boundaries

| Layer | Responsibility |
|---|---|
| Hub (`browser` package) | Exposes filter parameters in tool schema; passes them through relay |
| Content script (`page-map-collector.ts`) | Calls filter pipeline during DOM traversal; emits `filterSummary` |
| Content script (`page-map-filters.ts`) | Pure filter predicates + pipeline builder + summary builder |

### 14.8 Design Document

Full architecture: [`docs/90-archive/research/page-understanding-architecture.md`](../90-archive/research/page-understanding-architecture.md)  
Requirements: [`docs/20-requirements/requirements-browser-extension.md`](../20-requirements/requirements-browser-extension.md) §3.15, §3.18

### 14.9 Snapshot Diffing (`accordo_browser_diff_snapshots`)

**Module:** M101-DIFF  
**Requirements:** [`docs/20-requirements/requirements-browser2.0.md`](../20-requirements/requirements-browser2.0.md) — B2-DE-001..007, B2-PF-002  
**Architecture:** [`docs/browser2.0-architecture.md`](browser2.0-architecture.md) §5

#### Purpose

Agents need to detect what changed on a page between observations. `accordo_browser_diff_snapshots` compares two page-map snapshots and returns structural additions, removals, and changes — enabling change-driven workflows (form fill verification, SPA transition tracking, polling-until-ready) without re-transferring the entire page map.

#### Tool Flow

```
Agent                 Hub (browser pkg)           Extension (relay)         Service Worker
  │                        │                            │                        │
  ├─ accordo_browser_diff_snapshots ─►                          │                        │
  │  (fromSnapshotId?,      │                           │                        │
  │   toSnapshotId?)        │                           │                        │
  │                        ├─ relay "diff_snapshots" ───►                        │
  │                        │                            ├─ dispatch to SW ───────►
  │                        │                            │                        ├─ computeDiff()
  │                        │                            │                        │  (pure function,
  │                        │                            │                        │   ≤1.0s budget)
  │                        │                            ◄── DiffResult ──────────┤
  │                        ◄── relay response ──────────┤                        │
  │  ◄── DiffToolResult ───┤                            │                        │
```

#### Ownership Boundaries

| Layer | Package | Responsibility |
|---|---|---|
| MCP tool definition | `packages/browser` | `buildDiffSnapshotsTool()` — args validation, relay dispatch, timeout, response shaping |
| Relay action | `packages/browser-extension` | `relay-actions.ts` — routes `diff_snapshots` to the diff engine |
| Diff engine | `packages/browser-extension` | `diff-engine.ts` — pure functions: `computeDiff`, `flattenNodes`, `buildNodeIndex`, `formatTextDelta` |
| Snapshot storage | `packages/browser-extension` | `SnapshotRetentionStore` — holds last N snapshots per page for diffing |

#### Active-Page Inference

The tool does **not** accept a `pageId` input. Page identity is encoded in the `snapshotId` format (`{pageId}:{version}`). When both `fromSnapshotId` and `toSnapshotId` are omitted, the relay targets the currently active tab. The `DiffResult` response carries `pageId` via `SnapshotEnvelope` fields.

#### Performance Budget

- **Diff computation** (B2-PF-002): ≤1.0s — pure diff engine time in service worker
- **Tool-level timeout**: 5.0s — covers full relay round-trip (WebSocket transport + serialization + computation)

#### Error Codes (B2-DE-006, B2-DE-007)

| Error | Condition |
|---|---|
| `snapshot-not-found` | Referenced snapshot ID does not exist in the retention store |
| `snapshot-stale` | Snapshot is from a previous navigation (URL/page changed) |
| `browser-not-connected` | No active relay connection to the Chrome extension |
| `timeout` | Relay round-trip exceeded 5.0s |
| `action-failed` | Unclassified relay or engine failure |

### 14.10 Text Map (`accordo_browser_get_text_map` — M112-TEXT)

**Module:** M112-TEXT  
**Requirements:** [`docs/20-requirements/requirements-browser2.0.md`](../20-requirements/requirements-browser2.0.md) — B2-TX-001..010  
**Evaluation category:** B (Text Extraction Quality) — [`docs/30-development/mcp-webview-agent-evaluation-checklist.md`](../30-development/mcp-webview-agent-evaluation-checklist.md) §B, §3.4

#### Purpose

Agents need to read and reason about the text content of a page — not just the DOM structure. Existing tools (`accordo_browser_get_page_map`, `accordo_browser_inspect_element`) provide structural information with truncated text per element, but they do not offer: (a) all visible text in reading order, (b) raw vs. normalized text modes, (c) per-text-node bounding boxes, or (d) visibility flags. `accordo_browser_get_text_map` closes evaluation checklist Category B by providing a flat, ordered array of `TextSegment` objects representing every text run on the page.

#### Tool Flow

```
Agent                  Hub (browser pkg)            Extension (relay)          Content Script
  │                         │                             │                         │
  ├─ accordo_browser_get_text_map ──►                             │                         │
  │  (maxSegments?)         │                             │                         │
  │                         ├─ relay "get_text_map" ──────►                         │
  │                         │                             ├─ dispatch to CS ────────►
  │                         │                             │                         ├─ collectTextMap()
  │                         │                             │                         │  - walk DOM text nodes
  │                         │                             │                         │  - compute bbox per node
  │                         │                             │                         │  - classify visibility
  │                         │                             │                         │  - assign reading order
  │                         │                             ◄── TextMapResult ────────┤
  │                         ◄── relay response ───────────┤                         │
  │  ◄── TextMapResponse ───┤                             │                         │
```

#### TextSegment Shape (§3.4 compliance)

Each text segment carries all fields from the evaluation checklist §3.4:

```typescript
interface TextSegment {
  textRaw: string;          // Original whitespace preserved
  textNormalized: string;   // Collapsed whitespace, trimmed
  nodeId: number;           // Per-call scoped ID (see Node ID Scope below)
  role?: string;            // ARIA/implicit HTML role (e.g. "heading")
  accessibleName?: string;  // aria-label / alt / title
  bbox: { x: number; y: number; width: number; height: number };
  visibility: "visible" | "hidden" | "offscreen";
  readingOrderIndex: number; // 0-based, top-to-bottom LTR
}
```

#### Reading Order Algorithm (B2-TX-004)

1. Collect all text segments with their bounding boxes.
2. Sort segments by vertical midpoint (`bbox.y + bbox.height / 2`).
3. Group into vertical bands: two segments are in the same band when their vertical midpoints differ by ≤5px.
4. Within each band, sort by `bbox.x` (ascending for LTR, descending for RTL content).
5. Assign `readingOrderIndex` 0, 1, 2, ... across all bands in order.

RTL detection: check `document.documentElement.dir` or `getComputedStyle(document.documentElement).direction`.

#### Visibility Classification (B2-TX-005)

Reuses existing helpers from `page-map-traversal.ts`:

| State | Condition |
|---|---|
| `"hidden"` | `isHidden(element)` returns `true` (display:none, visibility:hidden/collapse, opacity:0, [hidden]) |
| `"offscreen"` | Not hidden, but `isInViewport(element)` returns `false` |
| `"visible"` | Not hidden and in viewport |

#### Reuse of Existing Infrastructure

| Existing module | What M112 reuses |
|---|---|
| `page-map-traversal.ts` | `isHidden()`, `isInViewport()`, `getAccessibleName()` — imported directly |
| `snapshot-versioning.ts` | `captureSnapshotEnvelope("dom")` — identical to page map |
| `page-map-collector.ts` | `EXCLUDED_TAGS` set, ref index pattern (M112 maintains its own independent node ID counter — see Node ID Scope below) |
| `types.ts` | `BrowserRelayAction` (gains `"get_text_map"`), `SnapshotEnvelopeFields`, `hasSnapshotEnvelope()` |
| `snapshot-retention.ts` | `SnapshotRetentionStore` — shared 5-slot FIFO store |

#### Node ID Scope

Text-map `nodeId` values are **per-call scoped** — they are assigned by M112's own counter during each `collectTextMap()` invocation and reset to 0 on every call. They do **not** share identity with page-map ref indices. An agent cannot pass a text-map `nodeId` to `accordo_browser_inspect_element` and expect a match; cross-tool element correlation uses `bbox` intersection or CSS-selector re-lookup instead.

This is intentional: text-map traversal visits text nodes (DOM `Text` type), while page-map traversal visits element nodes. A shared counter would produce misleading identities — the same integer would reference different DOM objects across the two tools. Keeping the ID spaces independent avoids correctness bugs and simplifies both collectors.

#### Ownership Boundaries

| Layer | Package | File | Responsibility |
|---|---|---|---|
| MCP tool definition | `packages/browser` | `text-map-tool.ts` | `buildTextMapTool()` — args validation, relay dispatch, envelope validation, store persistence |
| Relay action type | `packages/browser` | `types.ts` | `BrowserRelayAction` union includes `"get_text_map"` |
| Relay dispatch | `packages/browser-extension` | `content-entry.ts` | Routes `"get_text_map"` action to `collectTextMap()` |
| Text extraction | `packages/browser-extension` | `text-map-collector.ts` | `collectTextMap()` — DOM traversal, bbox, visibility, reading order, truncation |
| Tool registration | `packages/browser` | `extension.ts` | Wires `buildTextMapTool()` into the `allBrowserTools` array |

#### Performance Budget

- **Text map collection**: ≤2.5s on a medium-complexity page (~1,000 nodes) — same as page map (B2-PF-001).
- **Tool-level relay timeout**: 10s — covers full relay round-trip.

#### Token Cost Estimate

With `maxSegments: 500` (default), a typical response produces ~800–1,500 tokens of structured JSON. With `maxSegments: 50`, ~100–200 tokens.

### 14.11 Semantic Graph (`accordo_browser_get_semantic_graph` — M113-SEM)

**Module:** M113-SEM  
**Requirements:** [`docs/20-requirements/requirements-browser2.0.md`](../20-requirements/requirements-browser2.0.md) — B2-SG-001..015  
**Evaluation category:** C (Semantic Structure) — [`docs/30-development/mcp-webview-agent-evaluation-checklist.md`](../30-development/mcp-webview-agent-evaluation-checklist.md) §C, §3.5

#### Problem Statement (Non-Technical)

When an AI agent looks at a web page, it needs to understand the page's *meaning*, not just its text or visual layout. The semantic graph answers questions like: "What sections does this page have?", "Where is the navigation?", "What forms can the user fill out?", and "What is the heading structure?" This is the accessibility-aware structural understanding layer — the same information that screen readers use to help visually impaired users navigate a page.

#### Design Rationale

A single tool provides four complementary sub-trees in one relay round-trip (B2-SG-001):

1. **Accessibility tree** — the full ARIA-aware hierarchy that assistive technologies see
2. **Landmarks** — navigational regions (nav, main, banner, etc.)
3. **Document outline** — heading hierarchy (H1–H6) for table-of-contents style navigation
4. **Form models** — structured extraction of forms and their fields

Returning all four in one call eliminates the latency of four separate relay round-trips and gives the agent a coherent snapshot where all `nodeId` values are consistent (B2-SG-006).

#### Data Flow

```
Agent                        Hub (MCP)    Bridge       Browser Extension
  │                             │            │            │
  │ ── get_semantic_graph ──►   │            │            │
  │                             │ ── relay ──►            │
  │                             │            │ ── WS ──►  │
  │                             │            │            │── content script:
  │                             │            │            │   collectSemanticGraph()
  │                             │            │            │   ├─ a11yTree walk
  │                             │            │            │   ├─ landmark scan
  │                             │            │            │   ├─ outline scan
  │                             │            │            │   └─ form scan
  │                             │            │            │   (single shared nodeId counter)
  │                             │            │  ◄── data ─┤
  │                             │ ◄── resp ──┤            │
  │  ◄── SemanticGraphResponse ─┤            │            │
```

#### Key Types (Content Script)

```typescript
interface SemanticA11yNode {
  role: string;            // ARIA role (explicit or implicit)
  name?: string;           // Computed accessible name
  level?: number;          // Heading level (1-6), only for role="heading"
  nodeId: number;          // Per-call scoped, shared across sub-trees
  children: SemanticA11yNode[];
}

interface Landmark {
  role: string;            // Landmark role (navigation, main, etc.)
  label?: string;          // aria-label or aria-labelledby text
  nodeId: number;
  tag: string;             // HTML tag name
}

interface OutlineHeading {
  level: number;           // 1-6
  text: string;            // Trimmed text content
  nodeId: number;
  id?: string;             // Element id attribute if present
}

interface FormField {
  tag: string;             // input, select, textarea, button
  type?: string;           // type attribute (text, email, submit, etc.)
  name?: string;           // name attribute
  label?: string;          // Associated label text or aria-label
  required: boolean;
  value?: string;          // Current value (REDACTED for passwords)
  nodeId: number;
}

interface FormModel {
  formId?: string;         // id attribute
  name?: string;           // name attribute
  action?: string;         // form action URL
  method: string;          // GET or POST
  nodeId: number;
  fields: FormField[];
}
```

#### Node ID Scope (B2-SG-006)

All four sub-trees share a **single per-call node ID counter**, starting at 0. When the same DOM element appears in multiple sub-trees (e.g. a `<nav>` appears as both an a11y tree node and a landmark), it gets the same `nodeId` in both. This is achieved by assigning node IDs during a single DOM walk, then distributing the results to the four sub-tree builders.

Semantic graph `nodeId` values do **not** share identity with page-map ref indices or text-map node IDs. Cross-tool element correlation uses `bbox` intersection or CSS-selector re-lookup.

#### Implicit ARIA Role Mapping (B2-SG-014)

| HTML Element | Implicit Role | Condition |
|---|---|---|
| `<nav>` | `navigation` | Always |
| `<main>` | `main` | Always |
| `<header>` | `banner` | When scoped to `<body>` (not nested in sectioning content) |
| `<footer>` | `contentinfo` | When scoped to `<body>` (not nested in sectioning content) |
| `<aside>` | `complementary` | Always |
| `<section>` | `region` | When labelled (has `aria-label` or `aria-labelledby`) |
| `<form>` | `form` | When labelled |
| `<search>` | `search` | Always |
| `<h1>`–`<h6>` | `heading` | Always, with `level` = 1–6 |
| `<button>` | `button` | Always |
| `<a href>` | `link` | When `href` is present |
| `<input>` | `textbox`/`checkbox`/etc. | Based on `type` attribute |
| `<select>` | `listbox` | Always |
| `<textarea>` | `textbox` | Always |
| `<img>` | `img` | Always |
| `<ul>` / `<ol>` | `list` | Always |
| `<li>` | `listitem` | Always |
| `<table>` | `table` | Always |

#### Password Redaction (B2-SG-013)

Form fields with `type="password"` have their `value` replaced with `"[REDACTED]"`. This is enforced in the content-script collector to ensure password content never reaches the relay layer.

#### Ownership Boundaries

| Layer | Package | File | Responsibility |
|---|---|---|---|
| MCP tool definition | `packages/browser` | `semantic-graph-tool.ts` | `buildSemanticGraphTool()` — args validation, relay dispatch, envelope validation, store persistence |
| Relay action type | `packages/browser` | `types.ts` | `BrowserRelayAction` union includes `"get_semantic_graph"` |
| Relay dispatch | `packages/browser-extension` | `content-entry.ts` | Routes `"get_semantic_graph"` action to `collectSemanticGraph()` |
| Semantic extraction | `packages/browser-extension` | `semantic-graph-collector.ts` | `collectSemanticGraph()` — DOM traversal, a11y tree, landmarks, outline, forms |
| Tool registration | `packages/browser` | `extension.ts` | Wires `buildSemanticGraphTool()` into the `allBrowserTools` array |

#### Performance Budget

- **Semantic graph collection** (B2-SG-010): ≤15s on a complex page (~5,000 nodes).
- **Tool-level relay timeout**: 15s — covers full relay round-trip.

#### Token Cost Estimate

With default settings, a typical response produces ~1,000–3,000 tokens of structured JSON. Pages with many forms or deep a11y trees may produce up to ~5,000 tokens.

---

### 14.12 Spatial Relations (`accordo_browser_get_spatial_relations` — GAP-D1)

#### Problem Statement (Non-Technical)

Agents can see where elements are on a page (bounding boxes), but they cannot reason about how elements relate to each other spatially — "is the Submit button below the form?", "does the sidebar overlap the main content?", "what percentage of the hero image is visible?" GAP-D1 adds geometry helpers so agents understand spatial layout, not just positions.

#### Design Rationale

Three components satisfy checklist items D2, D4, and D5:

1. **Content script `spatial-helpers.ts`** — Pure geometry functions (leftOf, above, contains, overlap as IoU, distance, viewportIntersectionRatio) plus `findNearestContainer()` for semantic grouping. All functions except `findNearestContainer` operate on plain `Rect` objects — no DOM dependency.

2. **Page map enrichment** — When `includeBounds: true`, each `PageNode` gains two fields:
   - `viewportRatio` (0–1): fraction of the element's bbox visible in the viewport (D4)
   - `containerId` (nodeId): nearest semantic container ancestor — article, section, aside, main, dialog, details, nav, header, footer, form (D5)

3. **New MCP tool `accordo_browser_get_spatial_relations`** — Takes `nodeIds: number[]` (max 50, O(n²) cap) from a prior page map and returns pairwise relationships for all pairs (D2). This avoids bloating every page map response with O(n²) data.

#### Data Flow

```
Agent                   Hub/Bridge               Chrome Extension
  │                         │                         │
  ├─ get_page_map ──────────►                         │
  │  (includeBounds:true)   ├─ relay "get_page_map" ──►
  │                         │                         ├─ collectPageMap()
  │                         │                         │  enriched with viewportRatio, containerId
  │                         ◄─────── page map ────────┤
  │◄── nodes with bounds ───┤                         │
  │                         │                         │
  ├─ get_spatial_relations ─►                         │
  │  (nodeIds: [1,2,5])     ├─ relay "get_spatial_  ──►
  │                         │    relations"           ├─ handleGetSpatialRelationsAction()
  │                         │                         │  → computeSpatialRelations()
  │                         ◄── pairwise relations ───┤
  │◄── relations array ─────┤                         │
```

#### Key Types (Content Script)

| Type | File | Purpose |
|------|------|---------|
| `Rect` | `spatial-helpers.ts` | Minimal bbox shape (x, y, width, height) |
| `ViewportInfo` | `spatial-helpers.ts` | Viewport dimensions for ratio computation |
| `SpatialRelation` | `spatial-helpers.ts` | Single pairwise relationship |
| `SpatialRelationsResult` | `spatial-helpers.ts` | Batch result with relations + counts |

#### Ownership Boundaries

| Concern | Package | File | Responsibility |
|---------|---------|------|----------------|
| Geometry functions | `packages/browser-extension` | `content/spatial-helpers.ts` | Pure math — leftOf, above, contains, overlap, distance, viewportIntersectionRatio, findNearestContainer |
| Relay action handler | `packages/browser-extension` | `content/spatial-relations-handler.ts` | Resolves node IDs → bboxes, calls spatial helpers, wraps in SnapshotEnvelope |
| Relay dispatch | `packages/browser-extension` | `content/message-handlers.ts` | Routes `"get_spatial_relations"` action |
| MCP tool definition | `packages/browser` | `spatial-relations-tool.ts` | Tool schema, arg narrowing, handler with security/audit |
| Relay action type | `packages/browser` | `types.ts` | `BrowserRelayAction` union includes `"get_spatial_relations"` |
| Type contracts | `packages/browser` | `page-tool-types.ts` | `GetSpatialRelationsArgs`, `SpatialRelationsResponse` |
| Page map enrichment | `packages/browser-extension` | `content/page-map-collector.ts` | `PageNode.viewportRatio`, `PageNode.containerId` fields |

#### Performance Budget

- Page map enrichment: O(n) per node — viewportRatio is a simple rect intersection, containerId walks a short ancestor chain (typically < 10 levels).
- Spatial relations: O(n²) pairwise, capped at 50 nodes = 1,225 pairs max. Each pair does 6 arithmetic comparisons. Expected < 5ms for max input.
- No additional DOM reads beyond what page map already collects (bounds are cached).

---

## 15. Future Visual Annotation Layer (Deferred — Not MVP)

> **Agent note [2026-03-26]:** Architectural reservation for a future capability where agents can visually mark page elements during conversation (lines, frames, circles, highlights, callouts), making the browser page interactive for collaborative discussion. **No implementation in current scope.** This section exists to ensure the architecture does not foreclose the capability.

### 15.1 Problem Statement (Non-Technical)

When an agent and a human discuss a live web page, the agent can place *comments* (sticky-note-style text threads) on elements — but it cannot *point at* or *draw on* the page. Imagine a design review where a collaborator can circle a button, draw an arrow between two components, or highlight a heading in yellow — that is what visual annotations enable. Annotations are ephemeral visual marks, not persistent data. They exist for the duration of a conversation and disappear when dismissed.

### 15.2 Distinction from Comments

| Aspect | Comments (existing) | Annotations (future) |
|---|---|---|
| Purpose | Persistent discussion thread anchored to an element | Ephemeral visual emphasis during live conversation |
| Persistence | Stored in `.accordo/comments.json` or `chrome.storage.local` | Ephemeral by default; optional persist-to-session |
| Visual form | Pin icon + popover with text thread | Geometric shapes: line, rectangle, circle, highlight, callout |
| Lifecycle | Survive page reloads, VS Code restarts | Disappear on dismiss, tab close, or TTL expiry |
| Interaction | Click to open thread, reply, resolve | Click-through (non-blocking) or click to dismiss |

### 15.3 Rendering Model

Annotations render in a dedicated **overlay layer** (`<div id="accordo-annotation-overlay">`) that is:
- Separate from and independent of the comment pin layer
- Positioned with `position: fixed; top: 0; left: 0; width: 100%; height: 100%`
- `pointer-events: none` by default (click-through), with `pointer-events: auto` only on interactive annotation handles (dismiss button, drag handle)
- `z-index: 2147483645` — one level below comment pins (`2147483646`) so comments always win in overlap
- Inserted by the content script alongside (but independent from) the existing pin container

The overlay uses an **SVG root** for lines, rectangles, circles, and arrows, with HTML sub-elements for callout text and highlight backgrounds. This avoids canvas rendering complexity while preserving crisp vector output at any zoom level.

### 15.4 Annotation Primitives

| Primitive | Description | Key Properties |
|---|---|---|
| `line` | Straight line between two points or elements | `from`, `to` (point or anchor ref), `strokeWidth`, `arrowHead` |
| `rectangle` | Frame/border around a region or element | `target` (anchor ref or bounds), `padding`, `borderStyle` |
| `circle` | Circle drawn around an element or point | `center` (anchor ref or point), `radius` |
| `highlight` | Background color overlay on an element's bounding box | `target` (anchor ref), `color`, `opacity` |
| `callout` | Text label with leader line pointing to an element | `target` (anchor ref), `text`, `position` (auto or cardinal) |

Each primitive is typed as a discriminated union on `type` field, following the existing `ScriptStep` flat-union pattern from `accordo-script`.

### 15.5 Style and State Model

```typescript
/** Future — not implemented. Architectural reservation only. */
interface Annotation {
  /** Unique annotation ID (UUID v4) */
  id: string;
  /** Discriminated union tag */
  type: "line" | "rectangle" | "circle" | "highlight" | "callout";
  /** Who created this annotation */
  author: "agent" | "user";
  /** Source agent session ID (for multi-agent disambiguation) */
  sourceSessionId?: string;
  /** Visual style */
  style: AnnotationStyle;
  /** Time-to-live in seconds. null = manual dismiss only. */
  ttl: number | null;
  /** Creation timestamp (ISO 8601) */
  createdAt: string;
  /** Tab ID scope — annotations are always tab-scoped */
  tabId: number;
  /** Anchoring — reuses the enhanced anchor strategy from §14.3 */
  anchors: AnnotationAnchorRef[];
}

interface AnnotationStyle {
  /** CSS color value */
  color: string;
  /** Opacity 0.0–1.0 (default 0.4 for highlights, 1.0 for lines) */
  opacity: number;
  /** Z-index offset within the annotation layer (default 0) */
  zOffset: number;
  /** Stroke width for line/rectangle/circle primitives (px) */
  strokeWidth?: number;
  /** Dash pattern for lines (e.g., "5,3" for dashed) */
  dashArray?: string;
  /** Fill color for rectangle/circle (default: transparent) */
  fill?: string;
}

interface AnnotationAnchorRef {
  /** Reuses the same enhanced anchor key format from §14.3 / §5 of page-understanding-architecture */
  anchorKey?: string;
  /** Explicit viewport coordinates (fallback when no DOM element) */
  point?: { x: number; y: number };
}
```

### 15.6 Interaction Model

| Behaviour | Default | Configurable |
|---|---|---|
| Click-through | Yes — annotations do not intercept clicks on underlying page elements | Per-annotation `interactive: true` enables drag/resize |
| Dismiss | Click the annotation's dismiss handle (small × icon at corner), or agent calls `browser_remove_annotation` | — |
| Batch dismiss | `browser_remove_annotation` with `all: true` clears all annotations on the tab | — |
| Persist/ephemeral | Ephemeral by default; `persist: true` saves to `chrome.storage.session` for tab lifetime | Per-annotation at creation time |
| TTL auto-dismiss | Annotation fades out after `ttl` seconds (if set) | Per-annotation; agent can set `ttl: null` for persistent |
| Scroll tracking | Annotations anchored to elements reposition on scroll/resize (same rAF strategy as comment pins) | Always on |

### 15.7 Anchoring Model Reuse

Annotations reuse the **same enhanced anchor/locator strategy** defined in §14.3 and detailed in [`docs/90-archive/research/page-understanding-architecture.md`](../90-archive/research/page-understanding-architecture.md) §5. This means:

- Agents use `accordo_browser_inspect_element` to get an `anchorKey` for a target element
- That same `anchorKey` is passed to `browser_add_annotation` to anchor the visual mark
- `resolveAnchorKey()` (from the enhanced anchor module M90-ANC) resolves the key to a DOM element for positioning
- The tiered strategy hierarchy (id → data-testid → aria → css-path → tag-sibling → viewport-pct) applies identically
- No new anchoring logic is needed — the annotation layer is a pure consumer of the existing anchor infrastructure

### 15.8 Transport / Tooling Model (Future MCP Actions)

Future MCP tools for annotation management, registered by `accordo-browser` via `bridge.registerTools()`:

| Tool | Args | Returns | Danger | Idempotent |
|---|---|---|---|---|
| `browser_add_annotation` | `{ type, anchors, style?, ttl?, persist? }` | `{ annotationId }` | safe | no |
| `browser_update_annotation` | `{ annotationId, style?, anchors? }` | `{ updated: true }` | safe | yes |
| `browser_remove_annotation` | `{ annotationId?, all? }` | `{ removed: number }` | safe | yes |
| `browser_list_annotations` | `{ tabId? }` | `{ annotations: Annotation[] }` | safe | yes |

These tools follow the same relay path as page understanding tools:
```
Agent → Hub (MCP) → Bridge → accordo-browser → Chrome relay → content script → annotation overlay
```

**Standalone MCP compatibility:** The `CommentBackendAdapter` portability pattern from §14.4 extends to annotations. A future `AnnotationBackendAdapter` interface would allow annotation tools to work via:
- VS Code relay adapter (current path, same as comments and page understanding)
- Standalone MCP adapter (direct Hub connection, no VS Code required)
- Local-only adapter (annotations managed purely in browser, no relay)

This ensures that if the Hub is run as a standalone MCP server (without VS Code / without Bridge), annotation actions can still be served directly.

### 15.9 Security and Abuse Constraints

| Constraint | Value | Rationale |
|---|---|---|
| Max annotations per tab | 50 | Prevent visual clutter and DOM bloat |
| Max concurrent annotation tabs | 10 | Bound total memory/DOM overhead |
| Rate limit: `browser_add_annotation` | 20/min per session | Prevent agent annotation spam |
| TTL upper bound | 3600 seconds (1 hour) | Prevent indefinitely stale annotations |
| Annotation text length (callout) | 500 chars | Prevent DOM bloat from oversized callouts |
| Tab scope enforcement | Always — annotations never cross tab boundaries | Isolation between browsing contexts |
| Style constraints | `opacity` clamped to [0.1, 1.0]; `strokeWidth` clamped to [1, 10]; `zOffset` clamped to [0, 100] | Prevent invisible or visually overwhelming annotations |
| `color` validation | Must be valid CSS color (hex, rgb, rgba, named) | Prevent injection via style properties |

### 15.10 Explicit Non-Goal — Current MVP

**Visual annotations are NOT part of the current implementation scope.** This section (§15) is an architectural reservation only. No code, no stubs, no types, no tests will be created for annotations in the current session or any MVP milestone.

The annotation layer is a **future roadmap item** that depends on:
1. Page understanding (§14) being complete and stable
2. Enhanced anchor strategy (§14.3) being battle-tested with real comment placement
3. User/product validation that agent visual marking is a priority

The architectural reservation ensures that:
- The enhanced anchor model is designed broadly enough to serve both comments and annotations
- The relay transport path is extensible for new tool categories without structural changes
- The `CommentBackendAdapter` portability pattern generalises to other browser capabilities
- The content script overlay architecture leaves room for a second visual layer alongside pins

---

## 16. Component: OpenCode Narration Plugin

**Location:** `.opencode/plugins/narration.ts`  
**Runtime:** Bun (OpenCode's runtime — native `fetch`, no Node.js)  
**Architecture ref:** Alternative to `voice-architecture.md` ADR-03 for the OpenCode agent client  
**Requirements:** `docs/20-requirements/requirements-narration-plugin.md`

### 16.1 Purpose

The narration plugin provides automatic voice narration of agent responses in OpenCode.
It exists because OpenCode lacks a reliable hook to inject voice directives into the
system prompt (the standard ADR-03 approach for Copilot/Claude). Instead, the plugin
operates **post-hoc**: it observes when the agent finishes, extracts the response,
optionally summarizes it, and calls Accordo's `readAloud` tool.

### 16.2 Data Flow

```
┌─────────────┐     session.idle      ┌───────────────────┐
│  OpenCode   │ ───────────────────► │  Narration Plugin  │
│  Agent Loop │    (event + sessionID) │  (.opencode/       │
└─────────────┘                       │   plugins/)        │
                                      └────────┬──────────┘
                                               │
                              ┌────────────────┼────────────────┐
                              │                │                │
                              ▼                ▼                ▼
                     ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
                     │ OpenCode     │ │ Gemini Flash │ │ Accordo Hub  │
                     │ Session API  │ │ (summarize)  │ │ POST /mcp    │
                     │ (messages)   │ │              │ │ (readAloud)  │
                     └──────────────┘ └──────────────┘ └──────────────┘
```

1. OpenCode emits `session.idle` when the agent finishes a response
2. Plugin debounces (1500ms) to filter subagent intermediate completions
3. Plugin calls `client.session.messages()` to extract the last assistant message
4. If `narrationMode === "summary"`: plugin calls Gemini 2.0 Flash to produce a 2-3 sentence spoken summary
5. If `narrationMode === "everything"`: plugin uses the full response text (no LLM call)
6. Plugin calls `accordo_voice_readAloud` via JSON-RPC 2.0 on the Hub's `/mcp` endpoint
7. On any failure: plugin silently skips (logs to stderr only)

### 16.3 Boundary Rules

| Rule | Rationale |
|---|---|
| Plugin NEVER modifies Hub, Bridge, or voice extension | Client-side only — zero backend changes |
| Plugin NEVER imports `vscode` | Runs in Bun, not in VSCode extension host |
| Plugin NEVER imports npm packages | Zero dependencies — raw `fetch` only |
| Plugin reads `opencode.json` for MCP auth only | Same token the agent uses; no separate auth flow |
| All errors are swallowed (logged to stderr) | Plugin must never interrupt the agent workflow |

### 16.4 Integration Points

| System | Interface | Direction |
|---|---|---|
| OpenCode plugin API | `session.idle` event, `client.session.messages()` | Plugin ← OpenCode |
| Google AI API | `POST generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent` | Plugin → Google |
| Accordo Hub MCP | `POST /mcp` (JSON-RPC 2.0, bearer auth) — `tools/call` for `accordo_voice_readAloud` and `accordo_voice_discover` | Plugin → Hub |
| `opencode.json` | Read Hub URL + bearer token from `mcp.accordo` config | Plugin ← Filesystem |
| Environment variables | `GEMINI_API_KEY`, `ACCORDO_NARRATION_MODE` | Plugin ← Environment |

### 16.5 Relationship to ADR-03

This plugin is a **complement** to ADR-03 (agent-driven summary narration), not a replacement:

| Aspect | ADR-03 (agent-driven) | §16 Plugin (client-driven) |
|---|---|---|
| Mechanism | System prompt injects `readAloud` directive | Plugin observes idle, calls readAloud externally |
| Summarization | Agent summarizes its own response | External LLM (Gemini Flash) summarizes |
| Clients | Copilot, Claude (instruction URL consumers) | OpenCode only |
| Hub changes | Prompt engine renders voice section | None |
| Reliability | Depends on agent following instructions | Deterministic (always triggers on idle) |

---

## 17. Navigation Adapter Registry

### 17.1 Purpose

The `NavigationAdapterRegistry` (`packages/capabilities/src/navigation.ts`) provides a host-agnostic, plug-and-play mechanism for routing comment thread focus and anchor navigation to any surface type. Instead of hard-coding surface-specific `if` branches in the comments panel router, each modality registers a `NavigationAdapter` at activation time.

### 17.2 Interface

```typescript
interface NavigationAdapter {
  readonly surfaceType: string;           // e.g. "slide", "browser", "diagram"
  navigateToAnchor(anchor, env): Promise<boolean>;
  focusThread(threadId, anchor, env): Promise<boolean>;
  dispose?(): void;
}

interface NavigationAdapterRegistry {
  register(adapter: NavigationAdapter): void;
  unregister(surfaceType: string): void;
  get(surfaceType: string): NavigationAdapter | undefined;
  dispose(): void;
}
```

### 17.3 Lifecycle

| Event | What happens |
|-------|---------------|
| Surface extension activates | Calls `registry.register(adapter)` |
| Surface extension deactivates | Calls `registry.unregister(surfaceType)` — adapter's `dispose()` called if present |
| VS Code restarts | All adapters cleared; re-registered on next activation |
| `get(surfaceType)` → undefined | Router falls back to generic file-open (never silently fails) |

### 17.4 Registered Adapters

| Surface Type | Package | Command(s) called |
|---|---|---|
| `slide` | `packages/marp/` | `accordo.presentation.internal.focusThread` |
| `browser` | `packages/browser/` | `accordo_browser.focusThread` |
| `diagram` | `packages/diagram/` | `accordo_diagram_focusThread` |
| `markdown-preview` | `packages/comments/` (navigation-router.ts) | `accordo_preview_internal_focusThread` |

### 17.5 Router Contract

The comments panel router (`packages/comments/src/panel/navigation-router.ts`) uses explicit branching for most surface types, with registry-based dispatch for `browser` (primary) and `slide` (primary with deferred fallback):

```
anchor.kind === "text"     → VS Code commands.executeCommand with PREVIEW_FOCUS_THREAD
anchor.kind === "surface"  → explicit switch by surfaceType:
  markdown-preview          → PREVIEW_FOCUS_THREAD command directly
  browser                  → registry.get("browser").focusThread() (primary);
                              falls back to DEFERRED_COMMANDS.BROWSER_FOCUS_THREAD
  slide                    → registry adapter (primary) then DEFERRED_COMMANDS fallback
  diagram                  → DIAGRAM_FOCUS_THREAD command
no adapter registered      → env.openTextDocument (generic fallback)
```

The `DEFERRED_COMMANDS` fallback path remains active for `slide` and `browser` surfaces when the registry adapter is unavailable. All four surface adapters (browser, preview, diagram, slide) are registered at module-load time in `navigation-router.ts`; marp registers the slide adapter at package activation.

### 17.6 Adding a New Surface

To add comment support for a new surface type (e.g. PDF viewer):

1. Implement `NavigationAdapter` with `surfaceType: "pdf"`
2. In the surface's `extension.ts` activation, call `registry.register(myAdapter)`
3. No changes to `navigation-router.ts` — the router discovers the adapter automatically

### 17.7 State Ownership

- The registry is owned by the comments panel (`packages/comments/`)
- Adapters are owned by their respective surface packages
- The registry is a plain `Map` — no persistence, cleared on VS Code restart
- Adapters must re-register on every activation (no persistence requirement)
