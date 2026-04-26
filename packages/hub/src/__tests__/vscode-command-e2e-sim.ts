/**
 * VSCode simulation constants and response builders for E2E harness.
 * Shared by all vscode-command E2E test files.
 */

export const VSCODE_SIM_CATALOG = [
  { command: "workbench.action.splitEditorRight", internal: false },
  { command: "workbench.action.splitEditorDown", internal: false },
  { command: "workbench.action.joinAllGroups", internal: false },
  { command: "workbench.action.files.save", internal: false },
  { command: "workbench.action.files.saveAll", internal: false },
  { command: "editor.action.formatDocument", internal: false },
  { command: "workbench.action.closeActiveEditor", internal: false },
  { command: "accordo_editor_open", internal: false },
  { command: "_private.internal.command", internal: true },
];

export function buildCatalogResp(query?: string, includeInternal?: boolean, offset = 0, limit = 100) {
  let cmds = VSCODE_SIM_CATALOG;
  if (!includeInternal) cmds = cmds.filter((c) => !c.internal);
  if (query) cmds = cmds.filter((c) => c.command.toLowerCase().includes(query.toLowerCase()));
  const totalCount = cmds.length;
  const page = cmds.slice(offset, offset + limit);
  const truncated = offset + page.length < totalCount;
  return {
    auditId: "audit-list-1",
    ok: true,
    commands: page.map((c) => ({
      command: c.command,
      policy: {
        action: c.command.startsWith("accordo_") ? "deny" : "allow",
        riskClass: c.command.startsWith("workbench.action.files") ? "moderate" : "low",
        reason: c.command.startsWith("accordo_") ? "accordo internal" : "safe",
        preferredTool: c.command.startsWith("accordo_") ? c.command : undefined,
      },
    })),
    totalCount,
    truncated,
    nextOffset: truncated ? offset + page.length : undefined,
  };
}

export function buildExecuteResp(command: string | undefined, _args?: readonly unknown[]) {
  if (!command) {
    return {
      ok: false,
      error: { code: "INVALID_ARGUMENT", message: "command is required", retriable: false },
    };
  }
  // NOTE: accordo_* commands are NOT pre-denied here. The gateway's own
  // vscode-command policy layer (M75-VCG-09) performs its own deny check before
  // forwarding to the bridge. Stub always returns allow — simulates real VSCode.
  return {
    ok: true,
    auditId: "audit-exec-fixed",
    command,
    policy: { action: "allow", riskClass: "low", requiresConfirmation: false, reason: "safe" },
    result: { kind: "void" },
  };
}
