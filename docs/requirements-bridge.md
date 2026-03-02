# accordo-bridge — Requirements Specification

**Package:** `accordo-bridge`  
**Type:** VSCode extension  
**Publisher:** `accordo`  
**Version:** 0.1.0  
**Date:** 2026-03-02

---

## 1. Purpose

The Bridge is the **only** VSCode-specific core component. It connects the editor-agnostic Hub to the VSCode extension host. It manages the Hub's lifecycle, routes tool invocations, publishes IDE state, and exports a registration API for modality extensions.

---

## 2. Extension Manifest Contract

```json
{
  "name": "accordo-bridge",
  "displayName": "Accordo IDE Bridge",
  "publisher": "accordo",
  "version": "0.1.0",
  "engines": { "vscode": "^1.100.0" },
  "extensionKind": ["workspace"],
  "activationEvents": ["onStartupFinished"],
  "main": "./dist/extension.js",
  "extensionDependencies": [],
  "contributes": {
    "configuration": {
      "title": "Accordo IDE",
      "properties": {
        "accordo.hub.port": {
          "type": "number",
          "default": 3000,
          "description": "Port for the Accordo Hub HTTP server"
        },
        "accordo.hub.autoStart": {
          "type": "boolean",
          "default": true,
          "description": "Automatically start Hub process if not running"
        },
        "accordo.hub.executablePath": {
          "type": "string",
          "default": "",
          "description": "Absolute path to the Node.js executable used to spawn Hub. Empty = use the same node that runs the extension host. MACHINE/USER scope only — workspace settings are silently ignored to prevent arbitrary code execution via repository configuration.",
          "scope": "machine"
        },
        "accordo.agent.configureOpencode": {
          "type": "boolean",
          "default": true,
          "description": "Auto-generate opencode.json MCP config"
        },
        "accordo.agent.configureCopilot": {
          "type": "boolean",
          "default": true,
          "description": "Register Hub as native MCP server for Copilot"
        },
        "accordo.agent.configureClaude": {
          "type": "boolean",
          "default": true,
          "description": "Auto-generate .claude/mcp.json MCP config"
        }
      }
    },
    "commands": [
      {
        "command": "accordo.hub.restart",
        "title": "Accordo: Restart Hub"
      },
      {
        "command": "accordo.hub.showLog",
        "title": "Accordo: Show Hub Log"
      },
      {
        "command": "accordo.bridge.showStatus",
        "title": "Accordo: Show Connection Status"
      }
    ]
  }
}
```

---

## 3. Exported API — `BridgeAPI`

This is the **primary extension interface**. All modality extensions consume it.

```typescript
export interface BridgeAPI {
  /**
   * Register MCP tools for a given extension.
   * Immediately sends a toolRegistry message to Hub containing ALL
   * currently registered tools (this extension's + all others').
   *
   * @param extensionId  Reverse-domain extension ID, e.g. "accordo-editor"
   * @param tools        Array of tool definitions including local handlers
   * @returns            Disposable — calling dispose() unregisters these tools
   *                     and sends an updated toolRegistry to Hub
   */
  registerTools(extensionId: string, tools: ExtensionToolDefinition[]): vscode.Disposable;

  /**
   * Push modality state into IDEState.modalities[extensionId].
   * Sent to Hub as a stateUpdate patch.
   *
   * @param extensionId  Same ID used in registerTools
   * @param state        Arbitrary JSON-serializable object. Replaces
   *                     the previous state for this extensionId entirely.
   */
  publishState(extensionId: string, state: Record<string, unknown>): void;

  /**
   * Returns the current cached IDE state snapshot.
   * This is the same state the Hub uses for prompt generation.
   */
  getState(): IDEState;

  /**
   * Returns true if Bridge has an active WebSocket connection to Hub.
   */
  isConnected(): boolean;

  /**
   * Event that fires when Bridge connection status changes.
   */
  onConnectionStatusChanged: vscode.Event<boolean>;
}
```

### 3.1 ExtensionToolDefinition

```typescript
interface ExtensionToolDefinition {
  /** Fully qualified tool name. Convention: "accordo.<category>.<action>" */
  name: string;

  /** One-line description. Appears in system prompt. Max 120 chars. */
  description: string;

  /** JSON Schema describing the input. Must be type: "object". */
  inputSchema: {
    type: "object";
    properties: Record<string, {
      type: string;
      description: string;
      enum?: string[];
      default?: unknown;
    }>;
    required?: string[];
  };

  /** How dangerous is this tool? Drives confirmation policy. */
  dangerLevel: "safe" | "moderate" | "destructive";

  /**
   * Whether to show a confirmation dialog before execution.
   * Defaults: safe → false, moderate → false, destructive → true.
   * Users can override per-tool in settings.
   */
  requiresConfirmation?: boolean;

  /**
   * Whether this tool is safe to retry on timeout.
   * Default: false.
   */
  idempotent?: boolean;

  /**
   * The actual handler function. Runs in the extension host.
   * NEVER serialized. NEVER sent to Hub.
   *
   * @param args  Validated against inputSchema before calling
   * @returns     Tool result — must be JSON-serializable
   * @throws      If handler throws, Bridge wraps it as { success: false, error: message }
   */
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}
```

### 3.2 Wire Format: ToolRegistration (sent to Hub, handler stripped)

```typescript
interface ToolRegistration {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, {
      type: string;
      description: string;
      enum?: string[];
      default?: unknown;
    }>;
    required?: string[];
  };
  dangerLevel: "safe" | "moderate" | "destructive";
  requiresConfirmation: boolean;
  idempotent: boolean;
}
```

The Bridge constructs `ToolRegistration` from `ExtensionToolDefinition` by:
1. Copying all fields except `handler`
2. Applying defaults for `requiresConfirmation` and `idempotent`
3. Compiling the full list from all registered extensions
4. Sending a single `toolRegistry` message with the complete list

---

## 4. Hub Lifecycle Manager

### 4.1 Requirements

| ID | Requirement |
|---|---|
| LCM-01 | On activation, read `ACCORDO_BRIDGE_SECRET` from `context.secrets.get('accordo.bridgeSecret')` and `ACCORDO_TOKEN` from `context.secrets.get('accordo.hubToken')`. Do NOT generate fresh values on every activation. |
| LCM-02 | Check Hub liveness via `GET http://localhost:{port}/health` with 2s timeout. |
| LCM-03 | If Hub is running and stored secret is valid (WS connect succeeds), reuse the existing Hub. |
| LCM-04 | If WS upgrade is rejected with close code 4001 (Hub is running but has an unknown secret — it was externally restarted): Bridge does **not** know the Hub's current secret and cannot use `/bridge/reauth`. Generate new secret + token, persist to `context.secrets`, kill the existing Hub process, then spawn a new Hub. This is the only recovery path when Hub and Bridge secrets are out of sync. |
| LCM-05 | Spawn uses `child_process.execFile` (NOT `exec` or `spawn` with shell:true). Node executable: `accordo.hub.executablePath` setting (machine-scoped) or `process.execPath` as fallback. Arguments: `[hubEntryPoint, '--port', port]`. No shell string parsing. |
| LCM-06 | Spawn environment: `{ ACCORDO_BRIDGE_SECRET: secret, ACCORDO_TOKEN: token, ACCORDO_HUB_PORT: port }`. |
| LCM-07 | After spawn, poll `/health` at 500ms intervals. Max 10s. |
| LCM-08 | If health check times out, show `vscode.window.showErrorMessage` with "Accordo Hub failed to start" and offer "Retry" and "Show Log" actions. |
| LCM-09 | Stream Hub stdout/stderr to an `OutputChannel` named "Accordo Hub". |
| LCM-10 | If Hub process exits unexpectedly, attempt restart once (generates new secret/token). If second attempt fails, show error and stop. |
| LCM-11 | On VSCode shutdown (`deactivate()`), gracefully close WS connection. Do NOT kill Hub process (it may serve CLI agents). |
| LCM-12 | On `accordo.hub.restart` command — **soft restart (preferred):** Generate new ACCORDO_BRIDGE_SECRET + ACCORDO_TOKEN → POST `/bridge/reauth` with current secret → if 200: persist new credentials, reconnect WS, rewrite agent config files. Hub never stops; CLI agent sessions are uninterrupted. **Hard fallback** (if reauth returns non-200 or Hub is unreachable): close WS → kill Hub process → generate new credentials → re-run spawn sequence. |

### 4.2 Spawn Sequence Diagram

```
activate()
  │
  ├── Read secret + token from context.secrets
  │
  ├── GET /health ──► Hub alive?
  │   │ yes                │ no
  │   │                    ├── autoStart? ──► no → show warning, return
  │   │                    │ yes
  │   │                    ├── generate new secret + token
  │   │                    ├── persist to context.secrets
  │   │                    ├── execFile(nodePath, [hubEntry, '--port', port], {env})
  │   │                    ├── poll /health (500ms × 20 = 10s max)
  │   │                    │   └── timeout → show error, return
  │   │
  │   ├── Connect WS (ws://localhost:{port}/bridge)
  │   │   headers: { "x-accordo-secret": secret }
  │   │   └── If close code 4001 (auth fail): generate + persist new secret,
  │   │                                 kill Hub, respawn from scratch
  │   │
  │   ├── Send stateSnapshot (full IDEState + protocolVersion)
  │   │
  │   ├── Send toolRegistry (all registered tools, if any already present)
  │   │
  │   └── Mark bridge as connected
  │
  └── Register native MCP server (if configured)
```

---

## 5. WebSocket Client

### 5.1 Connection Requirements

| ID | Requirement |
|---|---|
| WS-01 | Connect to `ws://localhost:{port}/bridge`. |
| WS-02 | Pass `x-accordo-secret` in WebSocket upgrade headers. |
| WS-03 | On open: send `stateSnapshot` with full `IDEState` and `protocolVersion: ACCORDO_PROTOCOL_VERSION`. |
| WS-04 | On open: send `toolRegistry` with all currently registered tools. |
| WS-05 | Respond to `ping` messages with `pong` within 5 seconds. |
| WS-06 | On close: start reconnect backoff (1s, 2s, 4s, 8s, 16s, max 30s). |
| WS-07 | On reconnect: re-send `stateSnapshot` (with `protocolVersion`) and `toolRegistry`. Hub treats this as a fresh connection. |
| WS-08 | Messages larger than 1MB MUST be rejected (log warning, skip). |
| WS-09 | If WS close code is 4001 (auth failure), do NOT reconnect automatically. Force secret rotation + Hub respawn. |
| WS-10 | If WS close code is 4002 (protocol version mismatch), do NOT reconnect. Show error: "Accordo Bridge and Hub versions are incompatible. Update both packages." |

### 5.2 Message Routing

When Hub sends an `InvokeMessage`:

```
1. Check concurrent invocation limit (Hub enforces this before forwarding, but Bridge
   should also track in-flight calls for timeout enforcement).
2. Look up handler by tool name in extension registry
3. If not found → send ResultMessage { success: false, error: "Tool not found: <name>" }
4. If requiresConfirmation is true for this tool:
   a. Show vscode.window.showWarningMessage with tool name + args summary
   b. If user cancels → send ResultMessage { success: false, error: "User rejected" }
5. Start timeout timer (invoke.timeout ms)
6. Call handler(invoke.args)
7. On success → send ResultMessage { success: true, data: result }
8. On error → send ResultMessage { success: false, error: err.message }
9. On timeout → send ResultMessage { success: false, error: "Handler timed out" }
```

When Hub sends a `CancelMessage`:

```
1. Look up in-flight invocation by id.
2. If not found or already completed → send CancelledMessage { id, late: true }.
3. If found and still running:
   a. Attempt to abort (cancel the handler Promise if it exposes a cancel token; otherwise
      mark as cancelled and ignore the result when it returns).
   b. Dismiss any pending confirmation dialog.
   c. Send CancelledMessage { id, late: false }.
4. Remove from in-flight tracking.
```

---

## 6. State Publisher

### 6.1 VSCode Events to State Mapping

| VSCode Event | IDEState Field(s) | Source | Debounce |
|---|---|---|---|
| `window.onDidChangeActiveTextEditor` | `activeFile`, `activeFileLine`, `activeFileColumn` | `editor.document.uri`, `selection` | 50ms |
| `window.onDidChangeVisibleTextEditors` | `visibleEditors` | `window.visibleTextEditors` | 50ms |
| `window.onDidChangeTextEditorSelection` | `activeFileLine`, `activeFileColumn` | `selection.active` | 50ms |
| `window.onDidChangeActiveTerminal` | `activeTerminal` | `terminal.name` | 50ms |
| `workspace.onDidChangeWorkspaceFolders` | `workspaceFolders` | `workspace.workspaceFolders` | immediate |
| `window.tabGroups.onDidChangeTabGroups` | `openEditors` | `window.tabGroups.all` (tab API) | 100ms |
| `window.tabGroups.onDidChangeTabs` | `openEditors` | `window.tabGroups.all` (tab API) | 100ms |

**Session-static fields** (captured once in `start()`, no events needed):

| IDEState Field | Source | Notes |
|---|---|---|
| `workspaceName` | `vscode.workspace.name` | Display name of workspace or first root folder, `null` when no folder is open |
| `remoteAuthority` | `vscode.env.remoteName` | `null` when running locally; e.g. `"ssh-remote"`, `"wsl"`, `"dev-container"`, `"codespaces"`, `"tunnel"` |

**`openEditors` derivation:** `openEditors` is derived from `vscode.window.tabGroups.all` — the set of currently open editor tabs. It is **not** derived from `workspace.onDidOpenTextDocument` (which fires for background documents, language server buffers, and untitled files that are not visible tabs). On each relevant tab change, Bridge re-enumerates all tabs from the Tab Groups API and sends a full replacement patch for the `openEditors` field.

### 6.2 Path Normalization

All file paths in IDEState are **multi-root aware**:
- `activeFile`, `openEditors`, `visibleEditors`: stored as absolute paths. The prompt engine in Hub converts to workspace-relative where possible.
- `workspaceFolders`: absolute paths to each workspace root, in VSCode's folder order.
- Paths returned by tools (e.g., `accordo.editor.open`) are always absolute.
- Path inputs to tools accept: (a) absolute path, (b) path relative to a specific workspace folder if that folder's root is known. The `resolvePath` utility resolves (b) against the matching workspace folder, checking all roots. Ambiguous relative paths matching multiple roots are rejected with an error.
- Forward slash separators always (even on Windows).

### 6.3 State Update Strategy

The state publisher uses a **hybrid push-diff + keyframe** model:

| Trigger | Message sent | Why |
|---|---|---|
| WS connect / reconnect | `stateSnapshot` (full) | Hub starts with accurate baseline |
| VSCode event fires (debounced) | `stateUpdate` (changed fields only) | Keeps Hub reasonably current between keyframes |
| Every `KEYFRAME_INTERVAL_MS` (600 s) | `stateSnapshot` (full) | Corrects any accumulated diff drift |
| Hub sends `getState` request | `stateSnapshot` (full) | Agent gets guaranteed-fresh data on demand |
| Extension calls `publishState()` | `stateUpdate` (modalities patch) | Explicit, infrequent, extension-driven |

**Diff behaviour:** StatePublisher tracks `sentState` (the last state sent to Hub as a full snapshot). Between keyframes, only changed scalar fields and array fields (compared by JSON equality) are included in `stateUpdate` patches. If nothing has changed since the last send, no message is sent. After every `stateSnapshot`, `sentState` resets to the current state so subsequent diffs are computed against the fresh keyframe.

**Debounce timing** (same as the event table in §6.1): editor/selection/terminal events debounce 50 ms; tab group events debounce 100 ms; workspace folder changes send immediately (no debounce).

### 6.4 Modality State

When an extension calls `publishState(extensionId, state)`:
1. Store in local cache at `modalities[extensionId] = state`
2. Send `stateUpdate` with `{ modalities: { [extensionId]: state } }`

If the extension disposes (unregisters), remove its key from modalities and send patch.

---

## 7. Extension Registry

### 7.1 Requirements

| ID | Requirement |
|---|---|
| REG-01 | Support multiple extensions registering tools concurrently. |
| REG-02 | Tool names MUST be globally unique. If a duplicate name is registered, throw immediately. |
| REG-03 | When any extension registers or unregisters, schedule a `toolRegistry` message send after a **100ms debounce**. If additional register/unregister calls arrive within that window, reset the timer. This ensures a single combined `toolRegistry` message is sent when multiple extensions activate simultaneously during VSCode startup. |
| REG-04 | The handler map is keyed by tool name → `ExtensionToolDefinition.handler`. |
| REG-05 | When `Disposable.dispose()` is called, remove that extension's tools from the registry. |
| REG-06 | Validate `inputSchema` has `type: "object"` on registration. Throw if invalid. |

---

## 8. Native MCP Registration

### 8.1 Requirements

| ID | Requirement |
|---|---|
| MCP-01 | If `accordo.agent.configureCopilot` is true, register via `vscode.lm.registerMcpServerDefinitionProvider`. |
| MCP-02 | Provide a `McpHttpServerDefinition` pointing to `http://localhost:{port}/mcp` with `Authorization: Bearer <token>` header. This connects Copilot to the **already-running** Bridge-managed Hub, not a new process. |
| MCP-03 | If the `lm` API is not available (older VSCode), skip silently. |
| MCP-04 | Re-register (or update definition) when Hub is restarted and token rotates. |

### 8.2 Agent Config Files

| ID | Requirement |
|---|---|
| CFG-01 | If `accordo.agent.configureOpencode` is true, write `opencode.json` to workspace root. |
| CFG-02 | If `accordo.agent.configureClaude` is true, write `.claude/mcp.json` to workspace root (merge, don't overwrite). |
| CFG-03 | Config files use HTTP transport with the bearer token so agents connect to the **shared running Hub** instance (not a fresh stdio process). |
| CFG-04 | Include `"instructions_url": "http://localhost:{port}/instructions"` in opencode config. |
| CFG-05 | Respect existing entries in `.claude/mcp.json` — merge, never clobber. |
| CFG-06 | After writing config files, append their paths to `.gitignore` (workspace root). These files contain credentials and must not be committed. Write config files with mode `0600` (owner read/write only). |
| CFG-07 | Token is read from `context.secrets.get('accordo.hubToken')` at write time. If Hub is restarted (new token), Bridge rewrites the config files. |

### 8.3 opencode.json format

```json
{
  "mcpServers": {
    "accordo-hub": {
      "type": "http",
      "url": "http://localhost:3000/mcp",
      "headers": {
        "Authorization": "Bearer <TOKEN>"
      }
    }
  },
  "instructions_url": "http://localhost:3000/instructions"
}
```

### 8.4 .claude/mcp.json format

```json
{
  "mcpServers": {
    "accordo-hub": {
      "type": "http",
      "url": "http://localhost:3000/mcp",
      "headers": {
        "Authorization": "Bearer <TOKEN>"
      }
    }
  }
}
```

**Note for remote topologies:** When the agent runs on a different host than the Hub (e.g., local terminal + SSH remote IDE), the token must be extracted manually from `~/.accordo/token` on the remote host and the port must be forwarded. See architecture.md §6.5 for the topology matrix.

### 8.5 Config File Format Validation

| ID | Requirement |
|---|---|
| CFG-08 | Before writing `opencode.json`, validate that the format matches the known schema (presence of `mcpServers`, `instructions_url` fields). Log a warning to the Accordo Hub OutputChannel if the expected fields are absent — this may indicate an OpenCode schema change. |
| CFG-09 | Before merging into `.claude/mcp.json`, validate that the existing file (if present) is parseable JSON. If it is not, back it up as `.claude/mcp.json.bak` before overwriting. |
| CFG-10 | Record the config format version used (e.g., `"_accordo_schema": "1.0"`) as a comment or metadata field so future Bridge versions can detect and migrate stale config files. |

---

## 9. Status Bar

### 9.1 Requirements

| ID | Requirement |
|---|---|
| SB-01 | Show a status bar item with connection status: `$(plug) Accordo: Connected` or `$(warning) Accordo: Disconnected`. |
| SB-02 | Clicking the status bar item runs `accordo.bridge.showStatus` command. |
| SB-03 | The `showStatus` command shows a quick pick with: Hub URL, connection state, tool count, uptime. |

---

## 10. Error Handling

| Scenario | Behaviour |
|---|---|
| BridgeAPI.registerTools called before WS connected | Queue registrations. Send toolRegistry when WS connects. |
| Hub process crashes | Detect via child_process `exit` event. Generate new secret+token, persist to SecretStorage. Attempt single restart. |
| WS close code 4001 (auth fail) | Do NOT reconnect. Generate new secret+token, persist, kill Hub, respawn. |
| WS close code 4002 (protocol mismatch) | Do NOT reconnect or respawn. Show error: incompatible Hub/Bridge versions. |
| WS connection refused (wrong port / Hub not running) | Backoff reconnect loop. Show status bar warning. |
| Hub started externally with unknown secret | WS 4001 received → triggers secret + respawn flow above. |
| Handler throws synchronous error | Catch, wrap as `{ success: false, error: message }`, send result. |
| Handler returns non-JSON-serializable value | JSON.stringify at boundary. If it throws, return error result. |
| Duplicate tool name | Throw `Error("Duplicate tool name: <name>")` immediately on registerTools(). |

---

## 11. Non-Functional Requirements

| Requirement | Target |
|---|---|
| Extension activation time | < 500ms |
| State update latency (VSCode event → WS message sent) | < 100ms (including 50ms debounce) |
| Tool invocation overhead (WS message received → handler called) | < 5ms |
| Memory (idle, no tools) | < 20MB |
| Memory (16 tools, active state publishing) | < 40MB |
| VSCode engine | >= 1.100.0 |
| WebSocket library | Use `ws` npm package (same as Hub) |

---

## 12. Testing Requirements

| Test Type | Coverage |
|---|---|
| Unit: extension-registry | register, unregister, duplicate detection, handler map |
| Unit: state-publisher | debouncing, multi-root path resolution, diff-only patches |
| Unit: command-router | route to correct handler, timeout enforcement, confirmation flow |
| Unit: hub-manager | SecretStorage read/write, execFile spawn (NOT exec/shell), health polling, secret rotation on 4001, restart on crash |
| Integration: WS lifecycle | connect → snapshot (with protocolVersion) → registry → invoke → result → disconnect → reconnect with stored secret |
| Integration: WS 4001 | Hub rejects with 4001 → Bridge rotates secret, respawns Hub, reconnects |
| Integration: WS 4002 | Hub rejects with 4002 → Bridge shows version mismatch error, stops |
| Integration: BridgeAPI | registerTools → Hub receives tools, publishState → Hub receives patch |
| Integration: agent config | opencode.json + .claude/mcp.json generated with HTTP+token; .gitignore updated |
| Integration: token rotation | Hub respawn → new token written → agent config files updated |
| E2E: Full activation | VSCode starts → Bridge activates → Hub spawned → WS connected with auth → tools registered |
