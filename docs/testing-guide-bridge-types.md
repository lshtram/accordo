# Testing Guide — `bridge-types` Module

## Automated Tests

All automated tests for this module are in `packages/bridge-types/src/__tests__/`.

### Run all tests

```bash
pnpm --filter @accordo/bridge-types test
```

**What it verifies:** 10 vitest tests covering REQ-1 through REQ-7, plus compilation cleanliness.

---

### Test inventory

| Test file | What it covers | Requirement |
|---|---|---|
| `bridge-types.test.ts` | Barrel re-export structure (5 domain files referenced, multiple export lines) | REQ-1 |
| `bridge-types.test.ts` | `IDEState` interface has all required fields including `openTabs: OpenTab[]` | REQ-6 |
| `bridge-types.test.ts` | `ToolRegistration` is flat (name, description, inputSchema, dangerLevel) — no `definition` wrapper | REQ-7 |
| `bridge-types.test.ts` | `ToolRegistration` has no `handler` property (handler stays on `ExtensionToolDefinition` only) | REQ-7 |
| `bridge-types.test.ts` | `MCP_PROTOCOL_VERSION = "2025-03-26"` | REQ-2 |
| `bridge-types.test.ts` | `ACCORDO_PROTOCOL_VERSION = "1.0.0"` | REQ-2 |
| `bridge-types.test.ts` | `HubToBridgeMessage` and `BridgeToHubMessage` union types are correctly structured | REQ-3 |
| `bridge-types.test.ts` | Comment/surface types + `COMMENT_*` constants are exported | REQ-4 |
| `bridge-types.test.ts` | `HealthResponse`, `ReauthRequest`, `ConcurrencyStats`, `AuditEntry` constants exported | REQ-5 |

### Type contract compile checks

```bash
pnpm --filter @accordo/bridge-types run typecheck
```

**What it verifies:** `tsc --noEmit` passes on all source files, including `type-contracts.ts` which contains compile-checked assertions for:
- `_REQ7_flat_name` — `ToolRegistration.name` is top-level
- `_REQ7_flat_description` — `ToolRegistration.description` is top-level
- `_REQ7_flat_dangerLevel` — `ToolRegistration.dangerLevel` is top-level
- `_REQ7_no_handler` — `ToolRegistration` does not include `handler`

### Lint

```bash
pnpm --filter @accordo/bridge-types run lint
```

**What it verifies:** ESLint 10 flat config passes on all 6 source files.

---

## User Journey Tests

N/A — `bridge-types` is a pure TypeScript type-definition package. It has no user-visible behaviour, no UI, and no runtime API. It only exports types and constants consumed by `accordo-hub` and `accordo-bridge` at compile time.

The module is validated exclusively through automated tests (TypeScript compilation, ESLint, and vitest unit tests) listed above.