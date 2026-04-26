export type VscodeCommandToolName =
  | "accordo_vscode_command_list"
  | "accordo_vscode_command_execute";

export type VscodeCommandSource = "core" | "extension";
export type VscodeCommandPolicyAction = "allow" | "confirm" | "deny";
export type VscodeCommandRiskClass = "low" | "moderate" | "high";

export type VscodeCommandErrorCode =
  | "INVALID_ARGUMENT"
  | "COMMAND_NOT_FOUND"
  | "POLICY_DENIED"
  | "POLICY_CONFIRMATION_REQUIRED"
  | "COMMAND_EXECUTION_FAILED"
  | "COMMAND_RESULT_NOT_SERIALIZABLE"
  | "AUDIT_WRITE_FAILED"
  | "NOT_IMPLEMENTED";

export type VscodeCommandResultEnvelope =
  | { kind: "void" }
  | { kind: "json"; value: unknown }
  | { kind: "unsupported"; summary: string };

export interface VscodeCommandListRequest {
  query?: string;
  includeInternal?: boolean;
  offset?: number;
  limit?: number;
}

export interface VscodeCommandConfirmation {
  confirmed: boolean;
  command: string;
  reason?: string;
}

export interface VscodeCommandExecuteRequest {
  command: string;
  args?: readonly unknown[];
  confirmation?: VscodeCommandConfirmation;
}

export interface VscodeCommandPolicyDecision {
  action: VscodeCommandPolicyAction;
  riskClass: VscodeCommandRiskClass;
  requiresConfirmation: boolean;
  reason: string;
  matchedRuleId?: string;
  preferredTool?: string;
}

export interface VscodeCommandDescriptor {
  command: string;
  title?: string;
  source: VscodeCommandSource;
  internal: boolean;
  policy: VscodeCommandPolicyDecision;
}

export interface VscodeCommandToolError {
  code: VscodeCommandErrorCode;
  message: string;
  retriable: boolean;
  details?: Record<string, unknown>;
}

export interface VscodeCommandListResponse extends Record<string, unknown> {
  ok: true;
  auditId: string;
  commands: readonly VscodeCommandDescriptor[];
  totalCount: number;
  nextOffset?: number;
  truncated: boolean;
}

export interface VscodeCommandExecuteResponse extends Record<string, unknown> {
  ok: true;
  auditId: string;
  command: string;
  policy: VscodeCommandPolicyDecision;
  result: VscodeCommandResultEnvelope;
}

export interface VscodeCommandErrorResponse extends Record<string, unknown> {
  ok: false;
  auditId?: string;
  command?: string;
  policy?: VscodeCommandPolicyDecision;
  error: VscodeCommandToolError;
}

export interface VscodeCommandArgumentShape {
  index: number;
  kind: "string" | "number" | "boolean" | "null" | "array" | "object" | "unknown";
  summary: string;
}

export interface VscodeCommandAuditEntry {
  auditId: string;
  ts: string;
  toolName: VscodeCommandToolName;
  command?: string;
  argsShape: readonly VscodeCommandArgumentShape[];
  policyAction: VscodeCommandPolicyAction;
  riskClass: VscodeCommandRiskClass;
  outcome: "success" | "denied" | "error";
  durationMs: number;
  errorCode?: VscodeCommandErrorCode;
  errorMessage?: string;
  activeFile?: string | null;
}

export interface VscodeCommandCatalog {
  listCommands(request: VscodeCommandListRequest): Promise<{
    auditId: string;
    commands: readonly VscodeCommandDescriptor[];
    totalCount: number;
    nextOffset?: number;
    truncated: boolean;
  }>;
}

export interface VscodeCommandExecutor {
  execute(request: VscodeCommandExecuteRequest): Promise<{
    auditId: string;
    command: string;
    policy: VscodeCommandPolicyDecision;
    result: VscodeCommandResultEnvelope;
  }>;
}

export interface VscodeCommandPolicy {
  classify(command: string, args: readonly unknown[]): Promise<VscodeCommandPolicyDecision>;
}

export interface VscodeCommandAuditSink {
  write(entry: VscodeCommandAuditEntry): Promise<void>;
}

export interface VscodeCommandGatewayDeps {
  catalog: VscodeCommandCatalog;
  executor: VscodeCommandExecutor;
  policy: VscodeCommandPolicy;
  audit: VscodeCommandAuditSink;
}

// Re-exported here so handler helpers can reference this type without a
// circular import back to vscode-command-execute.ts
export type VscodeCommandExecuteHandlerDeps = Pick<
  VscodeCommandGatewayDeps,
  "executor" | "policy" | "audit"
>;
