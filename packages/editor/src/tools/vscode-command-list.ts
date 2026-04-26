/**
 * List handler for accordo_vscode_command_list.
 * Orchestration delegates to validate/audit helpers.
 *
 * Requirements: M75-VCG-02, 03, 04, 05, 06, 07, 07a, 16, 17, 18
 * (requirements-editor.md §4.26)
 */

import type {
  VscodeCommandCatalog,
  VscodeCommandErrorResponse,
  VscodeCommandGatewayDeps,
  VscodeCommandListRequest,
  VscodeCommandListResponse,
} from "./vscode-command-contracts.js";
import {
  validateListArgs,
  buildListRequest,
} from "./vscode-command-list-validate.js";
import { buildListAuditEntry } from "./vscode-command-list-audit.js";

export type VscodeCommandListHandlerDeps = Pick<
  VscodeCommandGatewayDeps,
  "catalog" | "audit"
>;

async function handleListSuccess(
  deps: VscodeCommandListHandlerDeps,
  result: Awaited<ReturnType<VscodeCommandCatalog["listCommands"]>>,
  start: number,
): Promise<VscodeCommandListResponse> {
  const entry = buildListAuditEntry({
    auditId: result.auditId,
    outcome: "success",
    durationMs: performance.now() - start,
  });
  await deps.audit.write(entry);
  return {
    ok: true,
    auditId: result.auditId,
    commands: result.commands,
    totalCount: result.totalCount,
    nextOffset: result.nextOffset,
    truncated: result.truncated,
  };
}

async function handleListError(
  deps: VscodeCommandListHandlerDeps,
  auditId: string,
  start: number,
  err: unknown,
): Promise<VscodeCommandErrorResponse> {
  const msg = err instanceof Error ? err.message : String(err);
  const entry = buildListAuditEntry({
    auditId,
    outcome: "error",
    durationMs: performance.now() - start,
    errorCode: "NOT_IMPLEMENTED",
    errorMessage: msg,
  });
  await deps.audit.write(entry);
  return { ok: false, error: { code: "NOT_IMPLEMENTED", message: msg, retriable: false } };
}

export async function createListHandler(
  deps: VscodeCommandListHandlerDeps,
  args: Record<string, unknown>,
): Promise<VscodeCommandListResponse | VscodeCommandErrorResponse> {
  const validationError = validateListArgs(args);
  if (validationError) return validationError;

  const start = performance.now();
  const req = buildListRequest(args);
  const auditId = "audit-unknown";

  try {
    const result = await deps.catalog.listCommands(req as VscodeCommandListRequest);
    return handleListSuccess(deps, result, start);
  } catch (err) {
    return handleListError(deps, auditId, start, err);
  }
}