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
 * Requirements: requirements-bridge.md §8.2–§8.5
 */

import * as fs from "node:fs";
import * as path from "node:path";

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
      // corrupt — treat as absent
      existing = {};
    }
  }
  // Remove legacy keys that opencode rejects
  delete existing["_accordo_schema"];
  delete existing["instructions_url"];
  delete existing["instructions"];

  const existingMcp = (existing["mcp"] ?? {}) as Record<string, unknown>;
  return {
    ...existing,
    $schema: "https://opencode.ai/config.json",
    mcp: {
      ...existingMcp,
      "accordo-hub": {
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
      // corrupt — treat as absent (caller backs up the file per CFG-09)
      existing = {};
    }
  }
  const existingServers = (existing["mcpServers"] ?? {}) as Record<string, unknown>;
  return {
    ...existing,
    _accordo_schema: ACCORDO_SCHEMA_VERSION,
    mcpServers: {
      ...existingServers,
      "accordo-hub": {
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
 * Append a line to .gitignore if it is not already present.
 * Creates .gitignore if absent. CFG-06
 *
 * @param gitignorePath - Absolute path to the .gitignore file
 * @param entry         - Line to append (e.g. "opencode.json")
 */
export function appendGitignore(gitignorePath: string, entry: string): void {
  let contents = "";
  try {
    contents = fs.readFileSync(gitignorePath, "utf8");
  } catch {
    // absent — will create it
  }
  // Check for exact line match
  const lines = contents.split("\n").map((l) => l.trim());
  if (lines.includes(entry)) return;

  const separator = contents.length > 0 && !contents.endsWith("\n") ? "\n" : "";
  fs.writeFileSync(gitignorePath, contents + separator + entry + "\n", "utf8");
}

/**
 * Write opencode.json to workspaceRoot with mode 0600, then append to .gitignore.
 * Validates the generated object has the required fields and warns via outputChannel
 * if they are missing (CFG-08). No-op when configureOpencode is false.
 *
 * @param params - AgentConfigParams controlling what to write
 */
export function writeOpencodeConfig(params: AgentConfigParams): void {
  if (!params.configureOpencode) return;

  const filePath = path.join(params.workspaceRoot, "opencode.json");

  // Read existing file for merge (preserve user-added MCP servers)
  let existingRaw: string | undefined;
  try {
    existingRaw = fs.readFileSync(filePath, "utf8");
  } catch {
    // absent — will create fresh
  }

  const config = buildOpencodeConfig(params.port, params.token, existingRaw);

  // CFG-08: warn if required fields are missing
  if (!config["mcp"]) {
    params.outputChannel.appendLine("[accordo] Warning: opencode.json is missing mcp field");
  }
  if (!config["instructions"]) {
    params.outputChannel.appendLine("[accordo] Warning: opencode.json is missing instructions field");
  }

  fs.writeFileSync(filePath, JSON.stringify(config, null, 2) + "\n", {
    encoding: "utf8",
    mode: 0o600,
  });

  appendGitignore(path.join(params.workspaceRoot, ".gitignore"), "opencode.json");
}

/**
 * Write .claude/mcp.json to workspaceRoot with mode 0600, merge with existing
 * entries (CFG-05), back up corrupt existing file as .bak (CFG-09), then append
 * to .gitignore. No-op when configureClaude is false.
 *
 * @param params - AgentConfigParams controlling what to write
 */
export function writeClaudeConfig(params: AgentConfigParams): void {
  if (!params.configureClaude) return;

  const claudeDir = path.join(params.workspaceRoot, ".claude");
  const filePath = path.join(claudeDir, "mcp.json");

  // CFG-09: back up corrupt existing file before reading it
  let existingRaw: string | undefined;
  try {
    existingRaw = fs.readFileSync(filePath, "utf8");
    // Verify it parses; if not, back it up then treat as absent
    try {
      JSON.parse(existingRaw);
    } catch {
      fs.writeFileSync(filePath + ".bak", existingRaw, "utf8");
      existingRaw = undefined;
    }
  } catch {
    existingRaw = undefined;
  }

  const config = buildClaudeConfig(params.port, params.token, existingRaw);

  fs.mkdirSync(claudeDir, { recursive: true });
  // Ensure the directory is owner-writable. When another tool (e.g. the
  // opencode CLI) created .claude/ with restrictive permissions the Bridge
  // cannot write inside it. Attempt a chmod so the write succeeds.
  try { fs.chmodSync(claudeDir, 0o700); } catch { /* ignore — not our dir */ }
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2) + "\n", {
    encoding: "utf8",
    mode: 0o600,
  });

  appendGitignore(path.join(params.workspaceRoot, ".gitignore"), ".claude/mcp.json");
}

/**
 * Write or update .vscode/settings.json to set the VS Code virtualTools
 * threshold high enough that Accordo tools are not hidden behind activation
 * functions. CFG-11
 *
 * - Creates .vscode/ if absent.
 * - Merges with existing settings — does not overwrite unrelated keys.
 * - Skips the write if the threshold is already set to ≥ 300.
 * - Corrupt JSON is backed up as .bak before overwrite.
 *
 * @param workspaceRoot - Absolute path to the workspace root
 * @param outputChannel - For warnings
 * @returns true if the file was written (new/changed), false if skipped
 */
export function writeVscodeSettings(
  workspaceRoot: string,
  outputChannel?: AgentConfigOutputChannel,
): boolean {
  const THRESHOLD_KEY = "github.copilot.chat.virtualTools.threshold";
  const THRESHOLD_VALUE = 300;

  const vscodeDir = path.join(workspaceRoot, ".vscode");
  const settingsPath = path.join(vscodeDir, "settings.json");

  // Read existing settings
  let settings: Record<string, unknown> = {};
  try {
    const raw = fs.readFileSync(settingsPath, "utf8");
    try {
      settings = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      // Corrupt JSON — back up and overwrite
      fs.writeFileSync(settingsPath + ".bak", raw, "utf8");
      outputChannel?.appendLine(
        "[accordo-bridge] .vscode/settings.json was corrupt — backed up as settings.json.bak",
      );
      settings = {};
    }
  } catch {
    // File absent — will create it
  }

  // Skip if already set to an adequate value
  const existing = settings[THRESHOLD_KEY];
  if (typeof existing === "number" && existing >= THRESHOLD_VALUE) {
    return false;
  }

  settings[THRESHOLD_KEY] = THRESHOLD_VALUE;

  fs.mkdirSync(vscodeDir, { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 4) + "\n", {
    encoding: "utf8",
  });
  outputChannel?.appendLine(
    `[accordo-bridge] .vscode/settings.json: set ${THRESHOLD_KEY}=${THRESHOLD_VALUE} ✓`,
  );
  return true;
}

/**
 * Remove the virtualTools.threshold key from the workspace .vscode/settings.json
 * if present. Call this after writing it to user-level global config, to
 * clean up any stale workspace-level entry left by an earlier approach.
 *
 * @param workspaceRoot - Absolute path to the workspace root
 * @param outputChannel - For logging
 */
export function removeWorkspaceThreshold(
  workspaceRoot: string,
  outputChannel?: AgentConfigOutputChannel,
): void {
  const THRESHOLD_KEY = "github.copilot.chat.virtualTools.threshold";
  const settingsPath = path.join(workspaceRoot, ".vscode", "settings.json");

  let raw: string;
  try {
    raw = fs.readFileSync(settingsPath, "utf8");
  } catch {
    return; // file absent — nothing to clean
  }

  let settings: Record<string, unknown>;
  try {
    settings = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return; // corrupt — leave it alone, don't make things worse
  }

  if (!(THRESHOLD_KEY in settings)) {
    return; // key not present — nothing to do
  }

  delete settings[THRESHOLD_KEY];

  // If the object is now empty, remove the file entirely to keep the workspace clean.
  if (Object.keys(settings).length === 0) {
    fs.unlinkSync(settingsPath);
  } else {
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 4) + "\n", { encoding: "utf8" });
  }
  outputChannel?.appendLine(
    `[accordo-bridge] Removed stale ${THRESHOLD_KEY} from workspace .vscode/settings.json ✓`,
  );
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
      "accordo-hub": {
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
 * Write .vscode/mcp.json to workspaceRoot for VS Code Copilot MCP discovery.
 * Merges with existing server entries. No-op when configureCopilot is false.
 *
 * @param params - AgentConfigParams
 */
export function writeCopilotConfig(params: AgentConfigParams): void {
  if (!params.configureCopilot) return;

  const vscodeDir = path.join(params.workspaceRoot, ".vscode");
  const filePath = path.join(vscodeDir, "mcp.json");

  let existingRaw: string | undefined;
  try {
    existingRaw = fs.readFileSync(filePath, "utf8");
  } catch {
    // absent — will create fresh
  }

  const config = buildCopilotConfig(params.port, params.token, existingRaw);

  fs.mkdirSync(vscodeDir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2) + "\n", {
    encoding: "utf8",
    mode: 0o600,
  });

  appendGitignore(path.join(params.workspaceRoot, ".gitignore"), ".vscode/mcp.json");
}

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
