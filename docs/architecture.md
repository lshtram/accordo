# Accordo IDE — Phase 1 Architecture

**Status:** APPROVED — incorporates all review corrections and M31–M34 stabilisation  
**Date:** 2026-03-03  
**Scope:** Phase 1 Control Plane MVP (Hub + Bridge + Editor Tools)  
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
- **PID file:** On startup Hub writes its PID to `~/.accordo/hub.pid` (directory created with mode `0700` if absent, file written with mode `0600`). On graceful shutdown the file is removed. Bridge checks the PID file on activation to detect orphaned Hub processes from a previous VSCode crash.
- **Token file:** `~/.accordo/token` is written with mode `0600` (readable only by the owning user). Directory `~/.accordo/` is created with mode `0700`.

### 3.3 Server Endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| `/mcp` | POST | MCP Streamable HTTP. Request body is JSON-RPC. Response is JSON-RPC or SSE stream depending on `Accept` header. |
| `/instructions` | GET | Returns rendered system prompt (markdown). |
| `/health` | GET | Returns `{ ok: true, uptime: <seconds>, bridge: "connected"\|"disconnected", toolCount: <number>, protocolVersion: <string> }` |
| `/bridge` | WebSocket | Bridge connection point. Authenticated via `x-accordo-secret` header. |
| `/bridge/reauth` | POST | Credential rotation without Hub respawn. Auth: `x-accordo-secret: <current-secret>`. Body: `{ "secret": "<new-secret>", "token": "<new-token>" }`. Hub atomically replaces `ACCORDO_BRIDGE_SECRET` and `ACCORDO_TOKEN` then returns 200. Allows Bridge to rotate credentials without terminating active CLI agent sessions (e.g. on `accordo.hub.restart`). Returns 401 if the current secret is wrong. |

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
- **Reconnect behaviour:** If Bridge disconnects, Hub holds state for a grace window (15s). If Bridge reconnects within the window, no state is lost. If the window expires, Hub clears modality state (base IDE state is re-sent on reconnect).
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
  group?: string;                  // optional grouping key for progressive disclosure
}
```

**Progressive tool disclosure:** Each tool may carry a `group` key (e.g. `"editor"`, `"terminal"`, `"comments"`). Grouped tools are still registered in the Hub’s tool registry and are callable via MCP `tools/call`, but they are **hidden from the system prompt** (`GET /instructions`). Instead, a single `accordo.<group>.discover` stub tool is visible per group. When the agent calls the discover tool it receives the full name + description + inputSchema for every tool in that group, enabling it to make subsequent calls. This keeps the system prompt compact while giving the agent on-demand access to the full tool surface.

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
│   ├── index.ts             — CLI entry, arg parsing, process signals
│   ├── server.ts            — HTTP server, route setup, Streamable HTTP MCP
│   ├── mcp-handler.ts       — JSON-RPC dispatch, session management
│   ├── bridge-server.ts     — WebSocket server for Bridge connections
│   ├── tool-registry.ts     — Tool registration, lookup, validation
│   ├── state-cache.ts       — IDEState storage, patch merging, snapshot
│   ├── prompt-engine.ts     — Template rendering, token budget enforcement
│   ├── security.ts          — Origin validation, bearer token, secret management
│   ├── protocol.ts          — Shared message types (Hub ↔ Bridge)
│   └── health.ts            — /health endpoint
├── package.json
├── tsconfig.json
└── README.md
```

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
1. Read stored ACCORDO_BRIDGE_SECRET from VSCode SecretStorage (key: "accordo.bridgeSecret")
2. Read stored ACCORDO_TOKEN from VSCode SecretStorage (key: "accordo.hubToken")
3. Check if Hub is already running (GET http://localhost:{port}/health)
4. If running and healthy:
   a. Use the stored secret to connect WebSocket
   b. If WS upgrade rejected (401/403) → Hub was externally restarted; Bridge does not know the new secret and cannot reauth. Kill Hub and go to step 5.
   c. If WS connects → session resumes, no respawn needed
5. If not running (or step 4b triggered) and autoStart is true:
   a. Generate a new ACCORDO_BRIDGE_SECRET (crypto.randomUUID())
   b. Generate a new ACCORDO_TOKEN (crypto.randomBytes(32).toString('hex'))
   c. Persist both to VSCode SecretStorage
   d. Spawn Hub: execFile(nodePath, ['-e', "require('accordo-hub')"], { env: {...} })
      Where nodePath = accordo.hub.executablePath || process.execPath
      env: { ACCORDO_BRIDGE_SECRET, ACCORDO_TOKEN, ACCORDO_HUB_PORT: port }
   e. Wait for /health (poll every 500ms, timeout 10s)
   f. If timeout → show error notification, abort
6. Connect WebSocket to ws://localhost:{port}/bridge
   headers: { "x-accordo-secret": secret }
7. On connect: send full IDEState snapshot
8. On disconnect: retry with exponential backoff (1s, 2s, 4s, max 30s)

On `accordo.hub.restart` command (soft restart — Hub keeps running, CLI agents uninterrupted):
1. Generate new ACCORDO_BRIDGE_SECRET + ACCORDO_TOKEN
2. POST /bridge/reauth with current secret → Hub updates credentials atomically
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
    const token = await secretStorage.get('accordo.hubToken');
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

**Auth note for remote topologies:** The bearer token is stored in VSCode SecretStorage on the remote host. When configuring agents that run on a different host (e.g., local agent + SSH remote IDE), the token must be manually extracted from `~/.accordo/token` on the remote and provided to the agent.

---

## 7. Security

### 7.1 Hub HTTP Security

| Control | Implementation |
|---|---|
| **Loopback binding** | `127.0.0.1` by default. Explicit `--host` flag required for any other interface. |
| **Origin validation** | All HTTP requests must have either no `Origin` header (non-browser) or an `Origin` of `localhost`/`127.0.0.1`. Reject all other origins. Prevents DNS rebinding. |
| **Bearer token** | `Authorization: Bearer <token>` required on `/mcp` and `/instructions`. Token originates from Bridge: generated on Hub spawn, stored in VSCode `SecretStorage` (key: `accordo.hubToken`), passed to Hub as `ACCORDO_TOKEN` env var. Hub also writes it to `~/.accordo/token` as a fallback for out-of-band agent access (e.g. local CLI agents). Never committed to workspace. |
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
4. Bridge checks GET http://localhost:{port}/health
5. If Hub is running and healthy:
   a. Attempt WS connect with stored secret → if OK, skip to step 7
   b. If WS auth fails → Hub was replaced; generate new secret+token, go to step 6
6. If Hub not running (or step 5b) and autoStart:
   a. Generate new ACCORDO_BRIDGE_SECRET + ACCORDO_TOKEN, persist to SecretStorage
   b. Bridge spawns Hub via execFile(nodePath, ...) with env vars
   c. Bridge polls /health (500ms interval, 10s timeout)
7. Bridge connects WS to ws://localhost:{port}/bridge
8. Bridge sends stateSnapshot (full IDEState) including ACCORDO_PROTOCOL_VERSION
9. Hub validates protocol version; if mismatch → close WS with 4002, log error
10. Hub marks itself ready
11. accordo-editor activates, calls bridge.registerTools()
12. Bridge sends toolRegistry message to Hub
13. Bridge registers Hub via McpHttpServerDefinition (native VSCode MCP, shared Hub instance)
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
- `accordo-voice` — Already implemented. Needs only bridge registration. Added in Phase 4.
- Custom IDE packaging — No.
- Cloud/hosted Hub — No. Local-first only.

**Phase 2 additions (after Phase 1 gate):**

- **Remote topology UX:** When Bridge detects it is running on a remote host (SSH/devcontainer/Codespaces), emit a VSCode notification surfacing the port-forward command and bearer token needed for local agents. Consider `vscode.env.asExternalUri()` auto-forwarding for the Hub port.
- **Checkpoint/rollback:** Lightweight git-stash-based workspace snapshots triggered before `destructive` tool executions. Gives users a recovery path if an agent's terminal commands cause damage. Reference: Cline's checkpoint model.
- **Exact token counting:** Replace `chars / 4` heuristic in `prompt-engine.ts` with `tiktoken` (or equivalent) for accurate token budgeting.
