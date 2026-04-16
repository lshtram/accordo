# Voice Modularity — Phase A Design

## Scope

- `packages/voice`

## Target layering

- **Host:** `extension.ts`, bootstrap/factory/registration files, UI implementations
- **Runtime:** `voice-runtime.ts`, `voice-narration.ts`, tool handlers, adapter interfaces
- **Core:** `core/**/*`, `text/**/*`

Rule: **Host → Runtime → Core** only.

## Core goals

1. remove host leakage from runtime
2. keep UI adapter-only
3. abstract policy persistence
4. thin activation/composition root

## Final `VoiceUiAdapter` contract

```ts
interface VoiceUiAdapter {
  executeCommand(command: string, ...args: unknown[]): Promise<unknown>;
  showWarningMessage(message: string): Promise<string | undefined>;
  showErrorMessage(message: string): Promise<string | undefined>;
  showInformationMessage(message: string): Promise<string | undefined>;
  hasActiveEditor(): boolean;
  getSelectedText(): string | undefined;
  insertAtCursor(text: string): Promise<boolean>;
}
```

Rules:

- no `vscode` types cross the boundary
- no editor handles cross the boundary
- runtime receives plain data only

## `PolicyPersistenceAdapter` contract

```ts
interface PolicyPersistenceAdapter {
  save(key: string, value: unknown, scope: "global" | "workspace"): Promise<void>;
}
```

Behavior contract:

- allowed scopes: `global`, `workspace`
- runtime/session FSM applies policy first
- persistence is best-effort follow-up
- individual persistence failures do not fail the tool result
- only changed keys are persisted
- adapter is write-only; reads remain host-side in bootstrap

## Files expected to change

- `src/voice-runtime.ts`
- `src/voice-narration.ts`
- `src/voice-ui-adapter.ts`
- `src/tools/set-policy.ts`
- `src/voice-bootstrap.ts`
- `src/extension.ts`

New expected files:

- `src/policy-persistence-adapter.ts`
- `src/voice-service-factory.ts`
- `src/voice-command-registration.ts`
- `src/voice-tool-registration.ts`
- `src/voice-availability-bootstrap.ts`

## Slice plan

1. extend `VoiceUiAdapter`
2. refactor `voice-narration.ts` to stop importing `vscode`
3. remove runtime fallback imports from `voice-runtime.ts`
4. add `PolicyPersistenceAdapter` and refactor `set-policy.ts`
5. split `voice-bootstrap.ts` responsibilities
6. thin `extension.ts` through focused factory/registration files

## Lifecycle parity checklist for `extension.ts` extraction

Must preserve:

1. logger created first
2. status bar exists before sync functions can run
3. policy load happens before commands use FSM policy
4. runtime/narration deps exist before command registration
5. tool registration happens before initial state publish
6. availability check runs last
7. disposable registration remains complete
8. deactivate cleanup order stays correct

## Architecture documentation delta required

Update architecture docs to explicitly document:

- Host → Runtime → Core layering for voice
- `VoiceUiAdapter` as host/runtime UI seam
- `PolicyPersistenceAdapter` as config seam
- extracted activation/bootstrap structure

## Validation

Per slice:

- `pnpm test` in `packages/voice`
- package typecheck/build
- grep confirms no `vscode` imports in runtime/core after relevant slices

Manual smoke:

- dictation start/stop
- read-aloud still works

## Phase A stub artifacts (traceability)

All stubs compile (`pnpm typecheck` clean) and throw `"not implemented"` at runtime.

| Stub file | Frozen contract(s) | Design goal | Review section |
|---|---|---|---|
| `src/policy-persistence-adapter.ts` | `PolicyPersistenceAdapter` | Abstract `vscode.workspace.getConfiguration` writes behind a write-only seam | §`PolicyPersistenceAdapter` contract |
| `src/voice-service-factory.ts` | `VoiceServiceBundle`, `VoiceServiceFactoryInput` | Single factory composes runtime + narration deps; callers never import internals | §Core goals (4) |
| `src/voice-command-registration.ts` | `CommandRegistrationDeps`, `Disposable` | Extract command registration block from `extension.ts`; deps injected, no direct `vscode` import | §Lifecycle parity (4) |
| `src/voice-tool-registration.ts` | `ToolRegistrationDeps`, `BridgeAPI` | Extract MCP tool registration block from `extension.ts`; bridge API injected | §Lifecycle parity (5) |
| `src/voice-availability-bootstrap.ts` | `AvailabilityBootstrapDeps`, `AvailabilityResult` | Extract availability check from `extension.ts`; returns plain result object | §Lifecycle parity (6) |
| `src/voice-ui-adapter.ts` (updated) | `VoiceUiAdapterContract` (new export) | Frozen plain-data UI seam — no `vscode` types cross the boundary; legacy `VoiceUiAdapter` preserved for migration | §Final `VoiceUiAdapter` contract |

### Key design notes

- **`VoiceUiAdapterContract`** is added alongside the legacy `VoiceUiAdapter` in the same file. The legacy interface is preserved until Phase C slices replace callers. The frozen contract uses only plain data (`boolean`, `string`, `Promise<boolean>`).
- **`PolicyPersistenceAdapter`** is write-only per the behavior contract above. Reads stay in `voice-bootstrap.ts` (`loadPolicyFromConfiguration`).
- **Command/tool registration stubs** accept injected callbacks (`registerCommand`, `executeCommand`) rather than importing `vscode` directly — this enforces the Host → Runtime boundary at the type level.
- **`VoiceServiceBundle`** bundles `runtime`, `narration`, `statusBar`, and `uiAdapter` so `extension.ts` activation can call one factory instead of wiring internals.

## Phase A acceptance criteria

- [x] plain-data adapter contract frozen (`VoiceUiAdapterContract` in `src/voice-ui-adapter.ts`)
- [x] persistence contract frozen (`PolicyPersistenceAdapter` in `src/policy-persistence-adapter.ts`)
- [x] architecture delta specified (§Architecture documentation delta required)
- [x] extraction parity checklist frozen for implementation (§Lifecycle parity checklist)
- [x] all 5 stub files created and importable
- [x] typecheck clean (`pnpm typecheck` passes)
