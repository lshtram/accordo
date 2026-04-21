/**
 * Storage-backed sync contract for workspace agent configs.
 *
 * Scope: workspace config sync only. The authoritative Copilot/user-level MCP
 * writer remains `syncMcpSettings()` in `extension-bootstrap.ts`.
 */

import type { AgentConfigOutputChannel } from "./agent-config-contract.js";
import { writeAgentConfigs } from "./workspace-agent-config.js";

/** SecretStorage-backed token lookup for CFG-07. */
export interface AgentConfigTokenSource {
  getHubToken(projectId: string): Promise<string | undefined>;
}

/** Explicit workspace-target model for no-workspace-root handling. */
export type WorkspaceAgentConfigTarget =
  | { kind: "workspace"; workspaceRoot: string }
  | { kind: "none" };

/**
 * Parameters for storage-backed workspace config sync.
 *
 * When `target.kind === "none"`, Phase C will treat workspace config sync as a
 * safe no-op. Copilot/user-level sync remains valid via `syncMcpSettings()`.
 */
export interface StoredAgentConfigParams {
  projectId: string;
  port: number;
  configureOpencode: boolean;
  configureClaude: boolean;
  target: WorkspaceAgentConfigTarget;
  tokenSource: AgentConfigTokenSource;
  outputChannel: AgentConfigOutputChannel;
}

/**
 * Write workspace agent configs using the storage-backed token.
 *
 * CFG-07: token is read from the storage-backed tokenSource at write time,
 * not captured at request time. This ensures hard-fallback restart cycles
 * which update SecretStorage always produce configs with the latest token.
 *
 * Authority split preserved:
 * - syncMcpSettings() → user-level Copilot path (extension-bootstrap.ts)
 * - writeAgentConfigsFromStorage() → workspace path (this module)
 */
export async function writeAgentConfigsFromStorage(
  params: StoredAgentConfigParams,
): Promise<void> {
  // CFG-07: resolve token from storage-backed source at write time.
  const token = await params.tokenSource.getHubToken(params.projectId);
  if (token === undefined) {
    throw new Error("token unavailable");
  }

  // Safe no-op when no workspace root is configured.
  if (params.target.kind === "none") {
    return;
  }

  // Write workspace configs using the resolved token.
  // configureCopilot is false — user-level Copilot path stays in syncMcpSettings().
  writeAgentConfigs({
    workspaceRoot: params.target.workspaceRoot,
    port: params.port,
    token,
    configureOpencode: params.configureOpencode,
    configureClaude: params.configureClaude,
    configureCopilot: false,
    outputChannel: params.outputChannel,
  });
}