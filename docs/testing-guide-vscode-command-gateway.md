## Section 1 — Automated tests

Run these from the repository root.

1. `pnpm --filter accordo-editor typecheck`
   - Verifies editor-side gateway wiring compiles cleanly (extension activation, gateway deps init, shim registration types).

2. `pnpm --filter accordo-editor lint`
   - Verifies editor-side code follows project lint and structural rules after gateway refactors.

3. `pnpm --filter accordo-editor test -- --run src/__tests__/extension*.test.ts`
   - Verifies extension activation and command-shim behavior, including:
     - inert behavior when bridge is missing,
     - full tool/shim registration when bridge is present,
     - gateway runtime handler reachability via MCP tool and via shim command.

4. `pnpm --filter accordo-hub typecheck`
   - Verifies hub-side call executor refactor compiles (bridge/local routing, gateway deny precheck, audit writer path).

5. `pnpm --filter accordo-hub test -- --run src/__tests__/vscode-command-policy-e2e*.test.ts`
   - Verifies policy-oriented gateway E2E flows in default mode:
     - deny-class command returns policy denial,
     - confirm-class command returns confirmation-required contract,
     - explicit confirmation executes the command and returns success envelope.

6. `ACCORDO_E2E_LIVE=1 pnpm --filter accordo-hub test -- --run src/__tests__/vscode-command-*-e2e.test.ts`
   - Verifies live-gated end-to-end behavior with real bridge/hub wiring, including deny/confirm/confirmed execution semantics and list/execute policy integration.

## Section 2 — User journey tests

1. Denied command path (safe policy guard)
   - Open an MCP client connected to Hub and call `accordo_vscode_command_execute` with:
     - `command: "accordo_editor_open"`
   - Expected result:
     - `ok: false`
     - error code indicates policy denial (for example `POLICY_DENIED`)
     - no command execution side effect is observed in VS Code.

2. Confirmation-required path
   - Call `accordo_vscode_command_execute` with a confirm-class command, for example:
     - `command: "workbench.action.reloadWindow"`
   - Expected result:
     - request is rejected until confirmation is provided,
     - response clearly indicates confirmation is required and includes the command id.

3. Confirmed execution path
   - Repeat the previous call, this time including confirmation payload:
     - `confirmation: { confirmed: true, command: "workbench.action.reloadWindow", reason: "intentional test" }`
   - Expected result:
     - `ok: true` response envelope,
     - command executes through VS Code command gateway,
     - operation appears in gateway audit trail as successful.

4. Command listing and filtering path
   - Call `accordo_vscode_command_list` with and without a query string.
   - Expected result:
     - command list is returned,
     - query narrows results,
     - policy metadata appears for commands requiring deny/confirm handling.
