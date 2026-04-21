/**
 * Shared contracts for workspace agent config writers.
 *
 * Scope: workspace files only (`opencode.json`, `.claude/mcp.json`).
 * Authoritative Copilot/user-level MCP sync remains `syncMcpSettings()` in
 * `extension-bootstrap.ts`.
 */

/** Output channel abstraction for warnings. */
export interface AgentConfigOutputChannel {
  appendLine(value: string): void;
}

/**
 * Parameters for workspace-scoped agent config writes.
 *
 * Scope is intentionally limited to workspace files. User-level Copilot config
 * is not written through this contract.
 */
export interface AgentConfigParams {
  /** Absolute path to the workspace root directory */
  workspaceRoot: string;
  /** Hub HTTP port, e.g. 3000 */
  port: number;
  /** Bearer token for Hub authentication */
  token: string;
  /** Whether to write opencode.json (CFG-01) */
  configureOpencode: boolean;
  /** Whether to write .claude/mcp.json (CFG-02) */
  configureClaude: boolean;
  /** Output channel for warnings (CFG-08) */
  outputChannel: AgentConfigOutputChannel;
}
