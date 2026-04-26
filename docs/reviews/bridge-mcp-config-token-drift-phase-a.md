# Bridge MCP config token drift — Phase A design

**Date:** 2026-04-21  
**Scope:** `packages/bridge` minimal bugfix design for MCP config token drift after reconnect, credential rotation, or restart.

---

## Problem statement

Bridge currently lets MCP credentials drift across three lifecycle paths:

1. `buildHubManagerEvents().onHubReady(..., isReconnect=true)` skips `writeAgentConfigs()`, assuming reconnect never needs config refresh.
2. `onCredentialsRotated()` updates only in-memory state/WS secret and does not rewrite Copilot or workspace MCP config files.
3. `HubManager._doRestart()` hard-fallback ordering can emit `onHubReady()` before `processState.token` is updated, so downstream config sync can observe the old token.

Result: user-level `~/.vscode/mcp.json` (Copilot authority) and workspace `opencode.json` / `.claude/mcp.json` can contain an older bearer token than the Hub now expects, leading to `401 Unauthorized` for Copilot or CLI agents after reconnect / restart / credential rotation.

---

## Requirement mapping

| Requirement ID | Why it applies | Planned design mapping |
|---|---|---|
| MCP-02 | Copilot entry must contain correct HTTP bearer config | Keep `syncMcpSettings()` in `extension-bootstrap.ts` as the authoritative writer for user-level `~/.vscode/mcp.json` |
| MCP-04 | Re-write Copilot config when token rotates | Fire `syncMcpSettings()` from ready/rotation lifecycle paths |
| CFG-01 / CFG-02 / CFG-03 | Workspace agent configs must point at shared HTTP Hub | Keep `writeAgentConfigs()` scoped to workspace `opencode.json` + `.claude/mcp.json` only |
| CFG-05 / CFG-06 | Preserve merge/permissions/gitignore behaviour | No writer-format change; reuse current writer helpers |
| CFG-07 | Token must be read from SecretStorage at write time; rewrite on restarted Hub | Introduce a SecretStorage-backed token-read abstraction for config sync entrypoints |
| LCM-03 | Healthy existing Hub still emits `onHubReady` | Reconnect-ready remains valid, but now also requests idempotent config sync |
| LCM-12 | Restart rotates credentials, persists them, reconnects Bridge | Reorder fallback state update so config sync sees the new token |
| WS-07 | Reconnect behaves like fresh connection | Extend this to include idempotent config sync, not only WS snapshot/registry replay |

No new requirement IDs are needed; the bug is a coherence failure against existing requirements.

---

## Proposed minimal code changes by file/function

### 1) `packages/bridge/src/agent-config-contract.ts`

**Design change:** move workspace-agent-config interfaces into a focused contract module.

- `AgentConfigParams` is now explicitly **workspace-only** (`opencode.json`, `.claude/mcp.json`)
- it no longer models Copilot/user-level MCP writes

### 2) `packages/bridge/src/agent-config-sync.ts`

**Design change:** add a focused storage-backed sync contract module.

Planned public surface:

- `AgentConfigTokenSource` — async token reader abstraction
- `WorkspaceAgentConfigTarget` — explicit target union:
  - `{ kind: "workspace", workspaceRoot }`
  - `{ kind: "none" }`
- `StoredAgentConfigParams` — storage-backed workspace sync params
- `writeAgentConfigsFromStorage()` — stubbed Phase A entrypoint for workspace configs only

Why: CFG-07 explicitly requires read-at-write-time token lookup, and the contract must model the no-workspace-root case without ambiguity. When `target.kind === "none"`, workspace config sync is a safe no-op by design.

### 3) `packages/bridge/src/workspace-agent-config-builders.ts` + `workspace-agent-config.ts`

**Design change:** split pure builders from workspace writers/orchestrator.

- `workspace-agent-config-builders.ts` contains pure config object builders only
- `workspace-agent-config.ts` contains workspace file writer wrappers and `writeAgentConfigs()` orchestration only

This removes the modularity blocker from the previous all-in-one `agent-config.ts` file.

### 4) `packages/bridge/src/extension-composition.ts` + focused wiring modules

**`buildHubManagerEvents()`**

Replace split lifecycle assumptions with one idempotent config-sync trigger:

- `onHubReady(port, token, isReconnect?)`
  - still updates in-memory `currentHubPort/currentHubToken`
  - no longer treats `isReconnect=true` as a blanket “skip config sync” case
  - requests **two** sync paths:
    - `syncMcpSettings()` for authoritative Copilot/user-level config
    - `writeAgentConfigsFromStorage()` for workspace agent configs
  - continues to build/connect `WsClient`

- `onCredentialsRotated(token, secret)`
  - still updates in-memory token and WS secret
  - additionally requests the same two sync paths so Copilot + workspace configs are refreshed after rotation

Design note: Copilot and workspace configs have different authorities and different no-op rules, so they are triggered together but written through separate modules.

Phase A extraction direction:

- `extension-config-sync-seams.ts` owns the authority split and request flow
- `extension-hub-manager-events.ts` owns Hub lifecycle callback wiring
- `extension-ws-client-setup.ts` / `extension-ws-client-events.ts` keep WS setup separate from lifecycle policy
- `extension-composition.ts` remains a small barrel

### 5) `packages/bridge/src/hub-manager.ts`

**`_doRestart()` hard-fallback branch**

Current issue: `_pollAndNotify()` can emit `onHubReady()` before `processState.token` is replaced.

Minimal fix shape:

- set `processState.secret` and `processState.token` to the newly generated credentials before emitting the ready callback in the hard-fallback path, or
- pass the explicit new token through the ready-notify path so callback consumers never depend on stale `processState`

Preferred minimal direction: make `_pollAndNotify()` accept the authoritative token for the spawn it is confirming, so lifecycle ordering is explicit and less error-prone.

### 6) `packages/bridge/src/__tests__/extension-composition.test.ts`

Update/rewrite expectations:

- old reconnect test that asserts workspace config sync is skipped becomes the opposite: reconnect requests both sync triggers
- add credential-rotation expectation: `onCredentialsRotated()` requests both sync triggers
- mock/assert `syncMcpSettings()` separately from `writeAgentConfigsFromStorage()`

### 7) `packages/bridge/src/__tests__/hub-manager.test.ts`

Add/adjust tests proving hard-fallback restart notifies with the new token, not the stale pre-rotation token.

---

## Invariants

1. **SecretStorage is authoritative** for bridge secret and hub token.
2. **Ready/rotation lifecycle hooks are sync triggers, not token authorities.**
3. **Config sync is idempotent.** Calling it on reconnect must not cause harmful churn; underlying writers decide whether disk changes are needed.
4. **WS credentials and MCP config credentials must converge to the same token/secret generation event.**
5. **Copilot authority is user-level only.** `syncMcpSettings()` owns `MCP-02/MCP-04`; workspace-agent-config modules do not.
6. **No format change** to `opencode.json`, `.claude/mcp.json`, or `~/.vscode/mcp.json` beyond updating the bearer token / URL when needed.

---

## Acceptance criteria

1. After Bridge reconnects to an already-running Hub, Bridge requests MCP config sync using the persisted token for that project.
2. After successful soft rotation (`/bridge/reauth`), Bridge refreshes Copilot and workspace MCP configs without waiting for a later reconnect.
3. After hard-fallback restart (kill + respawn), the first ready callback observes the new token, not the old one.
4. Copilot `~/.vscode/mcp.json` still skips no-op rewrites when URL/token already match.
5. Workspace config writers still preserve existing merge/permissions/gitignore behaviour.
6. When no workspace root exists, workspace config sync is an explicit no-op (`target.kind === "none"`) while Copilot sync remains valid.
7. No VSCode imports are added outside `extension-bootstrap.ts`.

---

## Risk notes

1. **Consent churn risk (Copilot):** mitigated by keeping `syncMcpSettings()` no-op skip logic intact.
2. **Extra disk writes on reconnect:** acceptable if writers are idempotent; if noise appears, optimize inside the sync helper rather than by skipping reconnect outright.
3. **Ordering regressions during restart:** mitigated by making token propagation explicit in `HubManager` instead of relying on mutable shared state timing.
4. **No-workspace-root cases:** mitigated by the explicit `WorkspaceAgentConfigTarget` union; Copilot sync remains valid while workspace sync becomes a documented no-op.

---

## Non-technical explanation

This fix keeps the AI connection settings in sync with the Hub’s current password-like token. Right now, the Bridge sometimes reconnects or rotates credentials without updating those settings files, so the agent keeps trying an old token and gets rejected. The corrected design makes every “Hub is ready” or “credentials changed” event refresh the right files through the right owners: Copilot through the user-level writer, and workspace agent files through the workspace writer only when a workspace exists.

## Technical explanation

The bug is lifecycle drift, not file-format drift. Current code assumes reconnect means token stability and assumes callback arguments are always fresher than persisted state; both assumptions are false under restart/rotation races. The corrected Phase A surface also makes module boundaries explicit: `syncMcpSettings()` remains the sole Copilot/user-level writer, workspace agent config helpers remain workspace-only, and the storage-backed sync contract explicitly models the no-workspace-root case via a discriminated union. This preserves existing responsibilities while removing the ambiguity that caused the review failure.
