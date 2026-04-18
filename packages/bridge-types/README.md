# @accordo/bridge-types

Shared TypeScript type definitions, schemas, and protocol constants for the Accordo IDE system. This package is the single source of truth for all types and constants used across Hub, Bridge, and Editor packages.

**Import policy:** All consumers import from the package root only (`@accordo/bridge-types`). Subpath imports (`@accordo/bridge-types/foo`) are prohibited — see [REQ-2 barrel-only import policy](./src/__tests__/bridge-types.test.ts).

## Installation

```bash
pnpm add @accordo/bridge-types
```

Or as a workspace dependency:
```json
{
  "devDependencies": {
    "@accordo/bridge-types": "workspace:*"
  }
}
```

## Exports

All types and constants are exported from the package root:

```typescript
import type {
  IDEState,
  OpenTab,
  ExtensionToolDefinition,
  ToolRegistration,
  InvokeMessage,
  HubToBridgeMessage,
  BridgeToHubMessage,
  AuditEntry,
  AccordoComment,
} from "@accordo/bridge-types";

import {
  ACCORDO_PROTOCOL_VERSION,
  MCP_PROTOCOL_VERSION,
  COMMENT_MAX_THREADS,
} from "@accordo/bridge-types";
```

### Key Types

| Type | Purpose |
|---|---|
| `IDEState` | Flat snapshot of IDE state (active file, open editors, workspace folders, etc.) |
| `ExtensionToolDefinition` | Tool definition with handler — stays in extension host, never serialized |
| `ToolRegistration` | Wire-safe tool metadata (no handler) sent from Bridge to Hub |
| `InvokeMessage` | Tool invocation request sent from Hub to Bridge over WebSocket |
| `HubToBridgeMessage` | Union of all message types Bridge receives from Hub |
| `BridgeToHubMessage` | Union of all message types Hub receives from Bridge |
| `AuditEntry` | Schema for audit log JSONL entries |
| `AccordoComment` | Core comment entity with anchor, author, and status fields |

### Key Constants

| Constant | Value | Purpose |
|---|---|---|
| `ACCORDO_PROTOCOL_VERSION` | `"1.0"` | Accordo wire protocol version |
| `MCP_PROTOCOL_VERSION` | `"2025-03-26"` | MCP transport protocol version |
| `COMMENT_MAX_THREADS` | `100` | Max comment threads per store |
| `HEARTBEAT_INTERVAL_MS` | `30_000` | WebSocket heartbeat interval |

## Development

```bash
pnpm build       # Compile TypeScript
pnpm typecheck   # Type-check without emitting
pnpm test        # Run vitest test suite
pnpm clean       # Remove build artifacts
```

## Consumers

This package is consumed by:
- `accordo-hub` — MCP server, imports types for Hub↔Bridge WebSocket protocol
- `accordo-bridge` — VSCode extension host side, imports types and constants
- `accordo-editor` — Editor tools (16 tools), imports types for tool registration
- `voice`, `browser`, `browser-extension`, `marp`, `script`, `md-viewer`, `diagram`, `comments`, `comment-sdk` — Feature packages

## License

[MIT](../../LICENSE)
