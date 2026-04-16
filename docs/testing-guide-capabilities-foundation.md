# Testing Guide — capabilities-foundation

## 1. Automated tests

### `pnpm --filter @accordo/capabilities test`
Verifies the capabilities foundation contract surface.

- `packages/capabilities/src/__tests__/capability-commands.test.ts`
  - checks that `CapabilityCommandMap` contains all and only the 8 stable commands
- `packages/capabilities/src/__tests__/capabilities-foundation.test.ts`
  - checks stable vs deferred command separation
  - checks deferred commands live in `DEFERRED_COMMANDS`
  - checks stable interfaces remain on the active package surface
  - checks deferred interfaces live outside the active root surface
  - checks interface signatures stay frozen
  - checks the package remains runtime-free

### `pnpm --filter @accordo/capabilities build`
Verifies the capabilities package compiles cleanly with the approved public contract split.

### `pnpm --filter accordo-comments test`
Verifies the comments consumer still works with the foundation split, including navigation routing that now uses deferred capability commands through `DEFERRED_COMMANDS`.

### `pnpm --filter accordo-comments build`
Verifies the comments package compiles cleanly against the updated `@accordo/capabilities` surface.

## 2. User journey tests

N/A — this module has no user-visible behaviour.
