# Module Map: `@accordo/hub`

## Purpose
Standalone MCP server that acts as the intelligence hub: accepts MCP connections from AI agents, routes tool invocations to the Bridge over WebSocket, maintains a cached snapshot of IDE state, serves SSE streams for prompt context, and handles credential rotation and health monitoring.

## Composition Root
`index.ts` — CLI entry point. Parses arguments and environment variables, then starts either a StdioTransport (for stdio mode) or an HTTP+WebSocket HubServer. Writes token, PID, and port to `~/.accordo/`.

`server.ts` — `HubServer` class. Creates the HTTP server, wires BridgeServer, ToolRegistry, StateCache, McpHandler, and four sub-modules (SSE, MCP request handling, reauth, routing). Enforces security middleware first in all request paths.

## Key Modules

| File | Responsibility | Public API |
|------|---------------|------------|
| `index.ts` | CLI bootstrap; argument parsing; config resolution; main() async orchestration | `main()`, `parseArgs()`, `resolveConfig()`, `findFreePort()`, `isPortFree()` |
| `server.ts` | HubServer class; HTTP server lifecycle; wires all sub-modules; graceful shutdown | `HubServer` class, `HubServerOptions` interface |
| `server-routing.ts` | HTTP request routing with security middleware (origin validation, bearer auth); delegates to SSE/MCP/reauth/health/state/tools sub-handlers | `createRouter()`, `Router` interface |
| `server-sse.ts` | Manages SSE client connections; broadcasts tool list changes; handles /mcp/sse endpoint | `createSseManager()` |
| `server-mcp.ts` | Handles raw MCP JSON-RPC requests over HTTP; extracts agent hint header | `createMcpRequestHandler()` |
| `server-reauth.ts` | Handles credential rotation via POST /bridge/reauth | `createReauthHandler()` |
| `mcp-handler.ts` | Facade that composes McpSessionRegistry and McpDispatch; exposed as the `McpHandler` class consumed by server.ts | `McpHandler` class, `McpHandlerDeps` interface |
| `mcp-session.ts` | Manages MCP session lifecycle (create, get, track); each `initialize` request gets a new session | `McpSessionRegistry` class, `Session` type |
| `mcp-dispatch.ts` | JSON-RPC method routing for MCP (initialize, tools/list, tools/call, ping); validates protocol, enforces concurrency limits | `McpDispatch` class, `JsonRpcRequest/Response` types |
| `mcp-call-executor.ts` | Executes a tools/call invocation: validates input, checks concurrency, sends to BridgeServer, handles result/error/timeout/cancel | `McpCallExecutor` class |
| `mcp-error-mapper.ts` | Maps tool invocation errors to JSON-RPC error codes | `mapToolError()` |
| `bridge-server.ts` | WebSocket server accepting Bridge connections; dispatches to BridgeConnection per connection | `BridgeServer` class |
| `bridge-connection.ts` | Per-Bridge WebSocket connection; manages invoke/cancel message pump, heartbeat, graceful shutdown | `BridgeConnection` class, `BridgeConnectionState` interface |
| `bridge-dispatch.ts` | Per-connection message routing for Bridge→Hub messages; manages in-flight invocations, concurrency queue, state snapshots, tool registry updates | `BridgeDispatch` class |
| `tool-registry.ts` | In-memory registry of all tools exposed to MCP agents; stores ToolRegistration[] | `ToolRegistry` class |
| `state-cache.ts` | Caches IDE state received from Bridge (stateSnapshot/stateUpdate messages); serves /state endpoint | `StateCache` class |
| `prompt-engine.ts` | Renders the full system prompt text (## Voice, ## Open Comment Threads, live IDE state) for MCP initialize response | `renderPrompt()` |
| `debug-log.ts` | Optional JSONL debug logger; every JSON-RPC message is written to file and echoed to stderr | `McpDebugLogger` class |
| `audit-log.ts` | JSONL audit log of every tool invocation completion | `writeAuditEntry()` |
| `security.ts` | Bearer token validation, origin allowlist, shared secret validation | `validateBearerToken()`, `validateOrigin()` |
| `errors.ts` | JSON-RPC error code constants and `JsonRpcError` class | `JsonRpcError`, error code constants |
| `stdio-transport.ts` | Stdio transport for Hub running as a child subprocess MCP server | `StdioTransport` class |

## Extension Points

- **`McpHandler.handleRequest()`**: The core method that dispatches any MCP JSON-RPC request. External callers (stdio-transport, HTTP handler) all route through this.
- **`BridgeServer`**: The WebSocket server factory — accepts Bridge connections. The `onStateUpdate()` and `onRegistryUpdate()` callbacks let Hub react to Bridge messages.
- **`ToolRegistry`**: The tool registry that MCP agents query via `tools/list`. Tools are registered when Bridge sends `toolRegistry` messages.
- **`StateCache`**: Provides the IDE state snapshot for prompt rendering and `/state` endpoint. Updated via `applyPatch()` from Bridge state messages.
- **`McpDebugLogger`**: Optional debug logging injected at HubServer construction — when set, every JSON-RPC exchange is written to a JSONL file.
- **`renderPrompt()`**: Produces the full system prompt text. Adding a new section (e.g., a new modality's state) is done here.

## Internal Boundaries

- **`bridge-dispatch.ts`** and **`bridge-connection.ts`** are internal to the BridgeServer — they manage per-connection state and should not be imported by other Hub modules.
- **`mcp-call-executor.ts`** is internal to `mcp-dispatch.ts` — it encapsulates the tools/call execution logic but is not a public extension point.
- **`mcp-error-mapper.ts`** is internal to the call execution path — it maps errors but is not consumed directly by external callers.
- **`state-cache.ts`** is internal to HubServer — it is created and owned by HubServer, not exposed as a standalone extension point.
- **`security.ts`** is internal to the routing layer — its validators are called inside `server-routing.ts`'s middleware chain and are not re-exported from the Hub's public API.
- The Hub has **no VSCode imports** — it is editor-agnostic and runs as a standalone Node.js process.
