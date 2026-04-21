# @accordo/bridge-types

Shared TypeScript contracts and protocol constants for Accordo packages.

This package intentionally ships small runtime JS for constants (for example protocol versions and limits), plus type declarations for cross-package contracts.

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
| `ACCORDO_PROTOCOL_VERSION` | `"1"` | Accordo wire protocol version |
| `MCP_PROTOCOL_VERSION` | `"2025-03-26"` | MCP transport protocol version |
| `COMMENT_MAX_THREADS` | `500` | Max comment threads per workspace |
| `HEARTBEAT_INTERVAL_MS` | `5_000` | WebSocket heartbeat interval |

## Development

```bash
pnpm build       # Compile TypeScript
pnpm lint        # Lint all source files (excluding tests)
pnpm typecheck   # Type-check without emitting
pnpm test        # Run vitest test suite
pnpm clean       # Remove build artifacts
```

## Consumers

This package is consumed by:
- `accordo-hub` — Hub/bridge protocol, state/tool contracts, constants
- `accordo-bridge` — registration/state wire contracts + constants
- `accordo-editor` — tool definition and IDE state types
- `accordo-browser` — tool definitions and shared contracts
- `accordo-comments` — shared comment/thread model
- `accordo-diagram` — tool definitions
- `accordo-marp` — tool definitions
- `accordo-md-viewer` — shared comment/thread model
- `accordo-voice` — tool definitions
- `@accordo/capabilities` — shared comment/navigation contracts

Use `rg '"@accordo/bridge-types"' packages/*/package.json` to refresh this list.

## License

[MIT](../../LICENSE)
