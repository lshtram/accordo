# Testing Guide — `accordo-bridge`

## Section 1 — Automated tests

Run from repo root:

```bash
pnpm --filter accordo-bridge test
pnpm --filter accordo-bridge typecheck
pnpm --filter accordo-bridge lint
```

What this verifies:
- Hub lifecycle behavior (spawn/probe/restart/soft-disconnect paths)
- WebSocket protocol handling and reconnect behavior
- command routing (`invoke`, `cancel`, timeout/confirmation flow)
- extension registry + state publishing behavior
- bootstrap/config writers for OpenCode/Claude/Copilot
- utility-contract coverage (`hub-registry`, `project-identity`, `state-diff`, `state-collector`)

Current suite size: **441 tests** (`packages/bridge/src/__tests__`).

## Section 2 — User journey tests

### Bridge startup and status bar
1. Start VS Code in this workspace.
2. Wait for startup activation to complete.
3. Verify the status bar shows `Accordo` with a state icon (`check`, `warning`, or `error`).

Expected:
- Bridge activates without prompting the user.
- Status icon reflects connection/tool readiness.

### Show system health
1. Run command: `Accordo: Show Connection Status` (`accordo.bridge.showStatus`).
2. Inspect quick-pick entries.

Expected:
- Hub connection line is shown.
- Registered module lines appear when tools are present.
- Best-effort browser/voice enrichment appears when those modalities are active.

### Restart Hub command
1. Run command: `Accordo: Restart Hub`.
2. Observe status bar and output channel (`Accordo Hub`).

Expected:
- Bridge performs restart flow (soft reauth preferred, hard fallback if needed).
- Connection recovers and status updates.

### Reload-survival behavior
1. With Bridge connected, reload window (`Developer: Reload Window`).
2. Wait for extension re-activation.

Expected:
- Bridge sends `softDisconnect` during teardown.
- On re-activation, Bridge reconnects to existing Hub when still within grace window.
