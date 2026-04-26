/**
 * vscode-command-gateway — public interface and injectable factory.
 *
 * The factory (createVscodeCommandGateway) is the Phase B seam used by unit tests
 * with mocked deps. The exported handlers (vscodeCommandListHandler /
 * vscodeCommandExecuteHandler) are wired in extension.ts and vscode-command-tools.ts
 * at runtime; they delegate to the real implementation via a singleton deps instance.
 *
 * Requirements: M75-VCG-01..18 (requirements-editor.md §4.26, §4.28)
 */

import type {
  VscodeCommandCatalog,
  VscodeCommandErrorResponse,
  VscodeCommandExecuteResponse,
  VscodeCommandExecutor,
  VscodeCommandGatewayDeps,
  VscodeCommandListResponse,
  VscodeCommandPolicy,
  VscodeCommandAuditSink,
} from "./vscode-command-contracts.js";

// Re-export helpers for DRY
export { summarizeArguments, classifyExecutionError, getArgumentShapeKind } from "./vscode-command-shared.js";

// Re-export handler creators (extracted for file-size compliance)
export { createListHandler } from "./vscode-command-list.js";
export type { VscodeCommandListHandlerDeps } from "./vscode-command-list.js";
export { createExecuteHandler } from "./vscode-command-execute.js";
export type { VscodeCommandExecuteHandlerDeps } from "./vscode-command-execute.js";

export type VscodeCommandListHandler = (
  args: Record<string, unknown>,
) => Promise<VscodeCommandListResponse | VscodeCommandErrorResponse>;

export type VscodeCommandExecuteHandler = (
  args: Record<string, unknown>,
) => Promise<VscodeCommandExecuteResponse | VscodeCommandErrorResponse>;

interface VscodeCommandGatewayHandlers {
  listHandler: (
    args: Record<string, unknown>,
  ) => Promise<VscodeCommandListResponse | VscodeCommandErrorResponse>;
  executeHandler: (
    args: Record<string, unknown>,
  ) => Promise<VscodeCommandExecuteResponse | VscodeCommandErrorResponse>;
}

// ── Injectable factory (Phase B seam) ──────────────────────────────────────

/**
 * Creates gateway handler functions bound to the provided dependency bag.
 * Tests MUST call this factory with mocked deps to verify interaction contracts.
 */
export function createVscodeCommandGateway(
  deps: VscodeCommandGatewayDeps,
): VscodeCommandGatewayHandlers {
  return {
    listHandler: (args) => import("./vscode-command-list.js").then(({ createListHandler }) => createListHandler(deps, args)),
    executeHandler: (args) => import("./vscode-command-execute.js").then(({ createExecuteHandler }) => createExecuteHandler(deps, args)),
  };
}

// ── Runtime handler singletons (set during extension activation) ────────────

// These are populated by initVscodeCommandGateway() called from extension.ts
// with real VSCode-backed deps before any tool calls arrive.
let _listHandler: (args: Record<string, unknown>) => Promise<VscodeCommandListResponse | VscodeCommandErrorResponse> = () =>
  Promise.resolve({ ok: false, error: { code: "NOT_IMPLEMENTED", message: "vscodeCommandGateway not initialized", retriable: false } });
let _executeHandler: (args: Record<string, unknown>) => Promise<VscodeCommandExecuteResponse | VscodeCommandErrorResponse> = () =>
  Promise.resolve({ ok: false, error: { code: "NOT_IMPLEMENTED", message: "vscodeCommandGateway not initialized", retriable: false } });

/**
 * Initialize the runtime handler singletons with real VSCode deps.
 * Called once during extension activation before any tool calls.
 */
export function initVscodeCommandGateway(deps: VscodeCommandGatewayDeps): void {
  const { listHandler, executeHandler } = createVscodeCommandGateway(deps);
  _listHandler = listHandler;
  _executeHandler = executeHandler;
}

/**
 * Runtime list handler — delegates to the initialized gateway.
 * Used by vscode-command-tools.ts and extension.ts.
 */
export async function vscodeCommandListHandler(
  args: Record<string, unknown>,
): Promise<VscodeCommandListResponse | VscodeCommandErrorResponse> {
  return _listHandler(args);
}

/**
 * Runtime execute handler — delegates to the initialized gateway.
 * Used by vscode-command-tools.ts and extension.ts.
 */
export async function vscodeCommandExecuteHandler(
  args: Record<string, unknown>,
): Promise<VscodeCommandExecuteResponse | VscodeCommandErrorResponse> {
  return _executeHandler(args);
}