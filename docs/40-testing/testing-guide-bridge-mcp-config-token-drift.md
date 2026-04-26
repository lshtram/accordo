# Testing Guide — bridge-mcp-config-token-drift

## 1) Automated tests

All commands below were executed and passed.

1. **Focused regression tests for this module**

   **Command:**
   ```bash
   cd packages/bridge
   pnpm exec vitest run src/__tests__/hub-manager-restart-token-ordering.test.ts src/__tests__/storage-writer-token-at-write-time.test.ts src/__tests__/token-source-contract.test.ts src/__tests__/workspace-agent-sync-target.test.ts src/__tests__/extension-config-sync-seams.test.ts
   ```

   **Verifies:**
   - hard-fallback restart emits `onHubReady` with the new token ordering (`LCM-12`)
   - storage-backed token lookup is used for workspace config sync (`CFG-07`)
   - workspace target dispatch (`workspace` vs `none`) is wired correctly
   - config sync seam routes correctly between Copilot sync and workspace sync flows

2. **Bridge package type safety**

   **Command:**
   ```bash
   cd packages/bridge
   pnpm --filter accordo-bridge typecheck
   ```

   **Verifies:**
   - TypeScript compile checks pass for the Bridge package after the refactor/fix

3. **Full Bridge package test suite**

   **Command:**
   ```bash
   cd packages/bridge
   pnpm --filter accordo-bridge test
   ```

   **Verifies:**
   - no regressions across all Bridge tests (full package behavior remains green)

## 2) User journey tests

1. **Reconnect keeps MCP working**
   - Open the project in VS Code with Accordo Bridge active.
   - Ensure `opencode.json` is present in the workspace root.
   - Trigger a temporary Bridge reconnect (for example, reload the VS Code window).
   - Use an MCP client/tool call against `http://localhost:3000/mcp` using the token from `opencode.json`.
   - **Expected result:** request succeeds (no 401), indicating token parity was maintained through reconnect.

2. **Credential rotation updates workspace config token**
   - With Bridge running, run the Accordo Hub restart command from VS Code (`accordo.hub.restart`).
   - Re-open `opencode.json` and confirm the bearer token value changed.
   - Make an MCP request with the new token from the file.
   - **Expected result:** request succeeds; old token should no longer be trusted.

3. **Hard-fallback restart still recovers with valid token**
   - Simulate a Hub mismatch/restart scenario (for example, restart Hub path that causes credential refresh).
   - Wait for Bridge to report ready/connected state.
   - Execute an MCP tool request via the generated workspace config token.
   - **Expected result:** request succeeds immediately after recovery, showing ordering is correct (no stale-token window).
