# @accordo/bridge-types

Shared TypeScript type definitions for the Accordo IDE system. This package contains **no runtime code** — only interfaces and type exports used by Hub, Bridge, and Editor packages.

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

All types are exported from the package root:

```typescript
import type {
  IDEState,
  ExtensionToolDefinition,
  ToolRegistration,
  BridgeAPI,
  WsBridgeMessage,
  WsHubMessage,
  AuditEntry,
} from "@accordo/bridge-types";
```

### Key Types

| Type | Purpose |
|---|---|
| `IDEState` | Flat snapshot of IDE state (active file, open editors, workspace folders, etc.) |
| `ExtensionToolDefinition` | Tool definition with handler — stays in extension host, never serialized |
| `ToolRegistration` | Wire-safe tool metadata (no handler) sent from Bridge to Hub |
| `BridgeAPI` | Public API surface that `accordo-bridge` exports to other extensions |
| `WsBridgeMessage` | Messages sent from Bridge → Hub over WebSocket |
| `WsHubMessage` | Messages sent from Hub → Bridge over WebSocket |
| `AuditEntry` | Schema for audit log JSONL entries |

## Development

```bash
pnpm build       # Compile TypeScript
pnpm typecheck   # Type-check without emitting
pnpm clean       # Remove build artifacts
```

This is a types-only package — there are no tests to run.

## License

[MIT](../../LICENSE)
