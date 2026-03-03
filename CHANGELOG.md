# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — 2026-03-03

### Added

#### `@accordo/bridge-types` v0.1.0
- `IDEState` interface: active file, open editors, workspace folders, terminals, remote authority
- `ExtensionToolDefinition` and `ToolRegistration` types for tool lifecycle
- `BridgeAPI` interface for extension-to-bridge communication
- `WsBridgeMessage` / `WsHubMessage` WebSocket message types
- `AuditEntry` schema for audit log entries

#### `accordo-hub` v0.1.0
- MCP server over HTTP (Streamable HTTP) and stdio transports
- WebSocket bridge for real-time IDE communication
- State cache with snapshot/patch merging and modality clearing
- Tool registry with registration, lookup, and metrics
- Prompt engine generating system prompts from IDE state and registered tools
- Security middleware: Bearer token auth, Origin validation, Bridge secret
- Concurrency control: 16-slot limit with 64-deep FIFO queue
- Audit logging with JSONL format and size-based rotation
- Session management with configurable timeouts
- Protocol version negotiation (WS close 4002 on mismatch)
- Credential rotation endpoint (`/bridge/reauth`)
- PID file lifecycle (`~/.accordo/hub.pid`)
- Grace window: 15s state hold on Bridge disconnect
- Idempotent retry: single retry on timeout for `idempotent: true` tools
- Flood protection: configurable per-second WebSocket message rate limit
- Message size limit: configurable `maxPayload` on WebSocket server

#### `accordo-bridge` v0.1.0
- Hub process lifecycle management (spawn, health poll, shutdown)
- WebSocket client with exponential backoff reconnect
- Extension registry with debounced tool registration
- Command router: invoke dispatch, cancel, confirmation dialogs
- State publisher: real-time IDE state snapshots and patches
- Agent config generation: OpenCode (`opencode.json`) and Claude (`.claude/mcp.json`)
- Native MCP registration for VSCode Copilot integration
- PID file written from parent process (race-free)
- Reconnect hardening with state hold coordination

#### `accordo-editor` v0.1.0
- 11 editor tools: open, close, scroll, reveal, focus, split, highlight, clearHighlights, save, saveAll, format
- 5 terminal tools: open, run, focus, list, close (with terminal ID mapping)
- 5 layout tools: panel.toggle, zen, fullscreen, joinGroups, evenGroups

#### Infrastructure
- pnpm monorepo with 4 packages and TypeScript project references
- 797 tests (Hub: 329, Bridge: 296, Editor: 172)
- Pre-push git hook running full test suite
- GitHub Actions CI (build, test, type-check)
- Architecture documentation, requirements specs, development process guide
