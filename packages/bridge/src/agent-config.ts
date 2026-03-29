/**
 * Agent Config Generation
 *
 * Writes MCP configuration files for AI agent CLI tools so they can
 * connect to the already-running Accordo Hub via HTTP+Bearer auth.
 *
 * Files written (when enabled):
 *   - opencode.json      (workspace root)   — CFG-01, CFG-03, CFG-04
 *   - .claude/mcp.json   (workspace root)   — CFG-02, CFG-03, CFG-05
 *
 * Both files are written with mode 0600 (owner read/write only).
 * Both paths are appended to .gitignore (workspace root) — CFG-06.
 * A `_accordo_schema` version field is embedded — CFG-10.
 * Existing entries in .claude/mcp.json are preserved — CFG-05.
 * A corrupt .claude/mcp.json is backed up before overwrite — CFG-09.
 *
 * Split: I/O operations moved to agent-config-writer.ts; this module retains
 * pure config-building functions and the writeAgentConfigs orchestrator.
 *
 * Requirements: requirements-bridge.md §8.2–§8.5
 */

import {
  appendGitignore,
  writeOpencodeConfig as writerWriteOpencodeConfig,
  writeClaudeConfig as writerWriteClaudeConfig,
  writeCopilotConfig as writerWriteCopilotConfig,
  writeVscodeSettings,
  removeWorkspaceThreshold,
} from "./agent-config-writer.js";

/**
 * Current schema version. Embedded as `_accordo_schema` in every file
 * written so future Bridge versions can detect and migrate stale configs.
 * CFG-10
 */
export const ACCORDO_SCHEMA_VERSION = "1.0";

/**
 * Output channel abstraction for warnings. Matches the relevant subset
 * of vscode.OutputChannel used in this module.
 */
export interface AgentConfigOutputChannel {
  appendLine(value: string): void;
}

/**
 * Parameters driving what to write and where.
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
  /** Whether to write .vscode/mcp.json for Copilot */
  configureCopilot: boolean;
  /** Output channel for warnings (CFG-08) */
  outputChannel: AgentConfigOutputChannel;
}

/**
 * Build the opencode.json content object, merging with any existing entries.
 * CFG-03, CFG-04, CFG-08, CFG-10
 *
 * opencode uses strict JSON schema validation (`$schema: "https://opencode.ai/config.json"`).
 * Only keys defined by that schema are allowed — custom fields like `_accordo_schema` or
 * `instructions_url` will cause opencode to reject the file at startup.
 *
 * The Hub instructions URL is provided via the `instructions` array so that
 * opencode loads it as a rules file (equivalent to CFG-04).
 *
 * If existingRaw is provided, existing MCP server entries and other opencode-compatible
 * keys are preserved. This prevents overwriting user-added MCP servers.
 *
 * @param port  - Hub port
 * @param token - Bearer token
 * @param existingRaw - Raw string content of the existing opencode.json, or undefined
 * @returns Plain object ready for JSON.stringify
 */
export function buildOpencodeConfig(
  port: number,
  token: string,
  existingRaw?: string | undefined,
): Record<string, unknown> {
  let existing: Record<string, unknown> = {};
  if (existingRaw !== undefined) {
    try {
      existing = JSON.parse(existingRaw) as Record<string, unknown>;
    } catch {
      existing = {};
    }
  }
  delete existing["_accordo_schema"];
  delete existing["instructions_url"];
  delete existing["instructions"];

  const existingMcp = (existing["mcp"] ?? {}) as Record<string, unknown>;
  return {
    ...existing,
    $schema: "https://opencode.ai/config.json",
    mcp: {
      ...existingMcp,
      accordo: {
        type: "remote",
        url: `http://localhost:${port}/mcp`,
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    },
  };
}

/**
 * Build the .claude/mcp.json content object, merging with any existing entries.
 * CFG-02, CFG-03, CFG-05, CFG-09, CFG-10
 *
 * If existingRaw is provided and is invalid JSON, it is treated as absent
 * (caller is responsible for backing up the file before calling this — CFG-09).
 *
 * @param port        - Hub port
 * @param token       - Bearer token
 * @param existingRaw - Raw string content of the existing .claude/mcp.json, or undefined
 * @returns Plain object ready for JSON.stringify
 */
export function buildClaudeConfig(
  port: number,
  token: string,
  existingRaw: string | undefined,
): Record<string, unknown> {
  let existing: Record<string, unknown> = {};
  if (existingRaw !== undefined) {
    try {
      existing = JSON.parse(existingRaw) as Record<string, unknown>;
    } catch {
      existing = {};
    }
  }
  const existingServers = (existing["mcpServers"] ?? {}) as Record<string, unknown>;
  return {
    ...existing,
    _accordo_schema: ACCORDO_SCHEMA_VERSION,
    mcpServers: {
      ...existingServers,
      accordo: {
        type: "http",
        url: `http://localhost:${port}/mcp`,
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    },
  };
}

/**
 * Build the .vscode/mcp.json content object for VS Code Copilot, merging
 * with any existing server entries.
 *
 * VS Code expects { "servers": { "<name>": { type, url, headers } } }.
 *
 * @param port        - Hub port
 * @param token       - Bearer token
 * @param existingRaw - Raw string content of the existing .vscode/mcp.json, or undefined
 * @returns Plain object ready for JSON.stringify
 */
export function buildCopilotConfig(
  port: number,
  token: string,
  existingRaw: string | undefined,
): Record<string, unknown> {
  let existing: Record<string, unknown> = {};
  if (existingRaw !== undefined) {
    try {
      existing = JSON.parse(existingRaw) as Record<string, unknown>;
    } catch {
      existing = {};
    }
  }
  const existingServers = (existing["servers"] ?? {}) as Record<string, unknown>;
  return {
    ...existing,
    servers: {
      ...existingServers,
      accordo: {
        type: "http",
        url: `http://localhost:${port}/mcp`,
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    },
  };
}

// ── Writer wrappers (delegate to agent-config-writer.ts) ─────────────────────

/**
 * Write opencode.json to workspaceRoot with mode 0600, then append to .gitignore.
 * Validates the generated object has the required fields and warns via outputChannel
 * if they are missing (CFG-08). No-op when configureOpencode is false.
 *
 * @param params - AgentConfigParams controlling what to write
 */
export function writeOpencodeConfig(params: AgentConfigParams): void {
  writerWriteOpencodeConfig(buildOpencodeConfig, params);
}

/**
 * Write .claude/mcp.json to workspaceRoot with mode 0600, merge with existing
 * entries (CFG-05), back up corrupt existing file as .bak (CFG-09), then append
 * to .gitignore. No-op when configureClaude is false.
 *
 * @param params - AgentConfigParams controlling what to write
 */
export function writeClaudeConfig(params: AgentConfigParams): void {
  writerWriteClaudeConfig(buildClaudeConfig, params);
}

/**
 * Write .vscode/mcp.json to workspaceRoot for VS Code Copilot MCP discovery.
 * Merges with existing server entries. No-op when configureCopilot is false.
 *
 * @param params - AgentConfigParams
 */
export function writeCopilotConfig(params: AgentConfigParams): void {
  writerWriteCopilotConfig(buildCopilotConfig, params);
}

// ── Orchestrator ─────────────────────────────────────────────────────────────

/**
 * Write all enabled agent config files (opencode + Claude + Copilot) for the
 * given params. Called from HubManager's onCredentialsRotated and onHubReady
 * callbacks.
 *
 * Each file is written independently: a failure writing one does not prevent
 * the other from being attempted, and per-file errors are reported through
 * the output channel rather than thrown.
 *
 * @param params - AgentConfigParams
 */
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
  try {
    writeCopilotConfig(params);
  } catch (err: unknown) {
    params.outputChannel.appendLine(
      `[accordo-bridge] Failed to write .vscode/mcp.json: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// Re-export I/O helpers for convenience
export { appendGitignore, writeVscodeSettings, removeWorkspaceThreshold };
