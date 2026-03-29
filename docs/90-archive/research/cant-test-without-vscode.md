# Tests We Cannot Automate Without a Live VS Code Host

This document lists test scenarios that would provide valuable regression coverage
but **cannot be exercised in the current CI test setup** because they require
the VS Code extension host, VS Code APIs, real process spawning, or the
VS Code SecretStorage API.

These scenarios are covered manually by the D3 testing guides.

---

## How tests are categorised

| Tag | Reason |
|---|---|
| `vscode-api` | Requires live `vscode.*` namespace (ExtensionContext, SecretStorage, EventEmitter, etc.) |
| `process-spawn` | Requires spawning and killing a real Node.js Hub process |
| `vscode-ui` | Requires VS Code UI: status bar, output channel, notifications, command palette |
| `filesystem-integration` | Requires real user home-dir or workspace-root filesystem paths in extension context |

---

## Week 4 (M21–M30)

### M26 — Agent config file generation (CFG-01 – CFG-09)

| Scenario | Tag | Notes |
|---|---|---|
| `writeAgentConfigs` is called from `onHubReady` when `configureOpencode: true` | `vscode-api` | Requires live `vscode.workspace.getConfiguration` and `ExtensionContext.extensionPath` |
| `writeAgentConfigs` is called from `onHubReady` when `configureClaude: true` | `vscode-api` | Same as above |
| `writeAgentConfigs` is NOT called when both options are false | `vscode-api` | Guard logic in extension.ts |
| Config files are re-written on `onCredentialsRotated` with the new token | `vscode-api` | CFG-07: rotation path in extension.ts |
| `writeAgentConfigs` uses workspace root for config paths | `vscode-api` | Requires `vscode.workspace.workspaceFolders` |

### M27 — Claude / opencode config survives token rotation

| Scenario | Tag | Notes |
|---|---|---|
| Opencode `opencode.json` is re-written with new token after `accordo.hub.restart` (soft path) | `vscode-api` | Triggered via `onCredentialsRotated` in extension.ts |
| Claude `.claude/mcp.json` is re-written with new token after restart | `vscode-api` | Same path |
| Existing non-accordo `mcpServers` keys in Claude config are preserved (CFG-05) | `filesystem-integration` | Requires real file on disk via extension path |

### M29 — PID detection at startup

| Scenario | Tag | Notes |
|---|---|---|
| `activate()` reads PID file and skips health-check / re-spawns when Hub process is dead | `process-spawn` | `isProcessAlive` integration with a real PID requires a real process |
| `activate()` skips spawn and connects when Hub is already alive (PID matches live process) | `process-spawn` | Requires a running Hub process to test the "alive" path end-to-end |
| Default `pidFilePath` resolves to `~/.accordo/hub.pid` in production | `vscode-api` | `os.homedir()` resolution happens in extension.ts `activate` context |

### M30-bridge — Token/secret persistence via SecretStorage

| Scenario | Tag | Notes |
|---|---|---|
| `restart()` (soft path) stores new token + secret via `secretStorage.store(...)` | `vscode-api` | `ExtensionContext.secrets` (SecretStorage) is a live VSCode API |
| `restart()` (hard path) stores new token + secret after respawn | `vscode-api` | Same |
| Stored secrets are read back correctly on next `activate()` | `vscode-api` | `secretStorage.get(...)` round-trip |

---

## Week 3 (M17–M20)

### Copilot MCP registration (M20 / configureCopilot)

| Scenario | Tag | Notes |
|---|---|---|
| `vscode.lm.registerMcpServer` is called when `configureCopilot: true` | `vscode-api` | VS Code proposed API; no mock available in vitest |
| Copilot registration is skipped when `configureCopilot: false` | `vscode-api` | Guard in extension.ts |
| Registration is updated after token rotation | `vscode-api` | Re-registration path |

### State publisher (M18) — live workspace observation

| Scenario | Tag | Notes |
|---|---|---|
| `StatePublisher` sends `stateUpdate` when active editor changes in VS Code | `vscode-api` | Requires `vscode.window.onDidChangeActiveTextEditor` event to fire from the real editor |
| `StatePublisher` sends `stateUpdate` when terminal list changes | `vscode-api` | Requires real VS Code terminal events |
| `StatePublisher` sends `stateSnapshot` on WS connection (first-connect flush) | `vscode-api` | Requires real `ExtensionContext` + live Bridge WS |

### Extension lifecycle (M16)

| Scenario | Tag | Notes |
|---|---|---|
| Extension activates when VS Code workspace opens | `vscode-api` | `activationEvents` in package.json; requires real extension host |
| `deactivate()` stops Hub and closes WS cleanly | `vscode-api` | Extension lifecycle; requires real host |
| Status bar item shows "Accordo: connected" after Bridge connects | `vscode-ui` | `vscode.window.createStatusBarItem` and real rendering |
| Output channel receives Hub stdout/stderr log lines | `vscode-ui` | `vscode.window.createOutputChannel` |

---

## Weeks 1–2 (M01–M15)

### Security middleware — real HTTPS / TLS (M03)

| Scenario | Tag | Notes |
|---|---|---|
| Origin header validation in a browser-initiated request | `vscode-api` | Browser same-origin policy is not reproducible in Node fetch |

### Bridge WS reconnect from extension host (M07, M12)

| Scenario | Tag | Notes |
|---|---|---|
| Bridge reconnects automatically after Hub restart without extension restart | `process-spawn` + `vscode-api` | Requires real Hub process kill + VS Code WS reconnect loop |
| Bridge reconnect emits `connectionStatus` event that updates the status bar | `vscode-ui` | Requires `vscode.EventEmitter` listener chained to status bar |

### Hub process spawn (M10)

| Scenario | Tag | Notes |
|---|---|---|
| `executablePath` setting routes spawn through a custom Node binary | `process-spawn` | Requires ability to write a shim executable and verify process arguments |
| `autoStart: false` prevents Hub spawn on workspace open | `vscode-api` | Guard tested in unit tests; integration requires real extension activation |
| Hub stdout captured to output channel before Bridge connects | `vscode-ui` | Requires both real process and VS Code output channel |

### SecretStorage round-trip on first activation (M11)

| Scenario | Tag | Notes |
|---|---|---|
| First-ever activation generates and stores token + secret | `vscode-api` | `ExtensionContext.secrets` is the VS Code native credential store |
| Credentials survive VS Code restart (persisted across sessions) | `vscode-api` | Requires actual VS Code session restart — untestable in any automated framework |

---

## Notes for future work

1. **VS Code Extension Test runner** (`@vscode/test-electron`) could replace most `vscode-api` items above. This was explicitly out of scope for the current project phase.
2. **`process-spawn` items** could partially be covered by a purpose-built integration harness that manages a real Hub process as a child process. The existing `bridge-e2e.test.ts` already does this for the running Hub; adding a "managed spawn lifecycle" fixture would address the spawn scenarios.
3. Items tagged `vscode-ui` will likely remain manual-only unless the project adopts a full VS Code integration test suite with screenshot or accessibility assertions.
