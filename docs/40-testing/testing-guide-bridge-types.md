# Testing Guide — `@accordo/bridge-types`

## Section 1 — Automated tests

Run from repo root:

```bash
pnpm --filter @accordo/bridge-types test
```

What it verifies:
- root barrel references all canonical domain files (`ide`, `tool`, `ws`, `comment`, `relay`, `constants`)
- root-only import policy (no `@accordo/bridge-types/*` subpath imports across workspace packages)
- key wire contracts remain stable:
  - `IDEState.openTabs`
  - flat `ToolRegistration` shape (no `definition` wrapper, no `handler` on wire)
  - `ReauthRequest` shape (`newToken`, `newSecret`)
  - protocol constants (`MCP_PROTOCOL_VERSION`)
- relay shared contract types are exported from root barrel

Current suite size: **11 tests** in `packages/bridge-types/src/__tests__/bridge-types.test.ts`.

Type-check contract:

```bash
pnpm --filter @accordo/bridge-types run typecheck
```

What it verifies:
- package compiles cleanly
- compile-time assertions in `src/__tests__/type-contracts.ts` enforce selected structural guarantees for `IDEState` and `ToolRegistration`

Lint:

```bash
pnpm --filter @accordo/bridge-types run lint
```

What it verifies:
- ESLint flat config runs on `src/**/*.ts` (excluding `src/__tests__/**`)
- type-safety rules are applied consistently, including `src/relay-types.ts`

## Section 2 — User journey tests

N/A — this module has no user-visible behaviour.
