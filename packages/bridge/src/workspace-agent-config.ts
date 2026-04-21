/**
 * Workspace agent config writers/orchestrator.
 *
 * Scope: workspace files only. Copilot/user-level MCP sync is handled by
 * `syncMcpSettings()` in `extension-bootstrap.ts`.
 */

import {
  appendGitignore,
  writeOpencodeConfig as writerWriteOpencodeConfig,
  writeClaudeConfig as writerWriteClaudeConfig,
  writeVscodeSettings,
  removeWorkspaceThreshold,
} from "./agent-config-writer.js";
import type { AgentConfigParams } from "./agent-config.js";
import { buildClaudeConfig, buildOpencodeConfig } from "./workspace-agent-config-builders.js";

export function writeOpencodeConfig(params: AgentConfigParams): void {
  writerWriteOpencodeConfig(buildOpencodeConfig, params);
}

export function writeClaudeConfig(params: AgentConfigParams): void {
  writerWriteClaudeConfig(buildClaudeConfig, params);
}

export function writeAgentConfigs(params: AgentConfigParams): void {
  try {
    writeOpencodeConfig(params);
  } catch (err: unknown) {
    params.outputChannel.appendLine(
      `[accordo-bridge] Failed to write opencode.json: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  try {
    writeClaudeConfig(params);
  } catch (err: unknown) {
    params.outputChannel.appendLine(
      `[accordo-bridge] Failed to write .claude/mcp.json: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export { appendGitignore, writeVscodeSettings, removeWorkspaceThreshold };
