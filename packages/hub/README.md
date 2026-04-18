# accordo-hub

Editor-agnostic MCP server with WebSocket bridge for the Accordo IDE system.

The Hub is the central coordination point: AI agents connect via MCP (HTTP or stdio), IDE extensions connect via WebSocket. The Hub caches IDE state, generates system prompts, routes tool calls, manages concurrency, and produces audit logs.

## Installation

```bash
npm install -g accordo-hub
```

Or run directly from the monorepo:
```bash
node packages/hub/dist/index.js --port 3000
```

## Usage

### Environment Variables

| Variable | Required | Description |
|---|---|---|
| `ACCORDO_TOKEN` | Yes | Bearer token for MCP agent authentication |
| `ACCORDO_BRIDGE_SECRET` | Yes | Shared secret for Bridge WebSocket authentication |
| `ACCORDO_HUB_PORT` | No | HTTP port (default: 3000, overridden by `--port`) |
| `ACCORDO_MAX_CONCURRENT_INVOCATIONS` | No | Max concurrent tool calls (default: 16) |

### CLI Flags

```
--port <number>       HTTP server port (default: 3000 or ACCORDO_HUB_PORT)
--host <address>      Bind address (default: 127.0.0.1)
--stdio               Run in MCP stdio transport mode (reads stdin, writes stdout)
--log-level <level>   Log level: debug, info, warn, error (default: info)
--project-id <id>     Register this Hub in hubs.json under this identifier
--registry <path>      Path to hubs.json registry (default: ~/.accordo/hubs.json)
```

### Start the Hub

```bash
# HTTP mode (default)
ACCORDO_TOKEN=my-token ACCORDO_BRIDGE_SECRET=my-secret accordo-hub --port 3000

# Stdio mode (for MCP clients that support stdin/stdout)
ACCORDO_TOKEN=my-token ACCORDO_BRIDGE_SECRET=my-secret accordo-hub --stdio
```

### Health Check

```bash
curl http://localhost:3000/health
# {"ok":true,"uptime":5,"bridge":"disconnected","toolCount":0,"protocolVersion":"1","inflight":0,"queued":0}
```

## HTTP Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/health` | None | Health check with bridge status |
| POST | `/mcp` | Bearer token | MCP Streamable HTTP endpoint |
| GET | `/mcp` | Bearer token | SSE notification stream for MCP clients |
| GET | `/instructions` | Bearer token | System prompt for agent consumption |
| GET | `/state` | Bearer token | Current IDE state snapshot |
| POST | `/bridge/reauth` | Bridge secret | Credential rotation endpoint |
| POST | `/bridge/disconnect` | Bridge secret | Graceful Bridge disconnection (starts grace window) |
| GET | `/browser/status` | Bearer token | Browser extension relay connection status |

## Architecture

```
AI Agent ─── POST /mcp ───► Hub ─── WebSocket ───► Bridge ───► VSCode
                              │
                              ├── StateCache (IDE state)
                              ├── ToolRegistry (registered tools)
                              ├── PromptEngine (system prompt generation)
                              ├── AuditLog (JSONL audit trail)
                              └── Security (bearer + origin validation)
```

### Key Features

- **MCP protocol**: Full MCP support over HTTP and stdio transports
- **State caching**: IDE state cached in Hub, delivered via system prompt
- **Concurrency control**: 16-slot concurrent invocation limit with 64-deep FIFO queue
- **Grace window**: 10s hold on Bridge disconnect; self-terminates if no reconnect; reconnect cancels timer
- **Flood protection**: Rate-limited WebSocket messages (configurable per-second limit)
- **Message size limit**: Configurable max WebSocket payload size
- **Idempotent retry**: Tools marked `idempotent: true` are retried once on timeout
- **Audit logging**: JSONL audit trail with size-based rotation (10 MB threshold, 2 files retained)
- **Security**: Bearer token auth, Origin validation, loopback-only binding

## Development

```bash
pnpm build         # Compile TypeScript
pnpm test          # Run 552 tests
pnpm typecheck     # Type-check without emitting
pnpm test:watch    # Watch mode
```

## Tests

552 unit and integration tests covering:
- Security middleware (token, origin, bridge secret validation)
- State cache (snapshots, patches, modality clearing)
- Tool registry (registration, lookup, metrics)
- Prompt engine (system prompt generation, token budgeting)
- Bridge server (WebSocket protocol, grace window, flood protection)
- MCP handler (initialize, tools/list, tools/call, idempotent retry)
- HTTP server (routing, middleware, lifecycle)
- CLI entry point (arg parsing, config resolution)
- E2E pipeline (full HTTP + WS + JSON-RPC stack)
- Stdio transport (buffer handling, message framing)
- Audit log (append, rotation)

## License

[MIT](../../LICENSE)
