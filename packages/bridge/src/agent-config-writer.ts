/**
 * Agent Config Writer — Raw filesystem I/O for MCP config files
 *
 * Pure file I/O responsibilities:
 * - appendGitignore: read + write .gitignore (CFG-06)
 * - writeOpencodeConfig: write opencode.json with mode 0600 (CFG-01, CFG-03, CFG-06)
 * - writeClaudeConfig: write .claude/mcp.json with merge + backup (CFG-02, CFG-05, CFG-09)
 * - writeCopilotConfig: write .vscode/mcp.json (CFG-11)
 * - writeVscodeSettings: write .vscode/settings.json with merge + backup (CFG-11)
 * - removeWorkspaceThreshold: clean up threshold key from settings (CFG-11)
 *
 * Requirements: requirements-bridge.md §8.2–§8.5
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentConfigParams } from "./agent-config.js";

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
  const lines = contents.split("\n").map((l) => l.trim());
  if (lines.includes(entry)) return;

  const separator = contents.length > 0 && !contents.endsWith("\n") ? "\n" : "";
  fs.writeFileSync(gitignorePath, contents + separator + entry + "\n", "utf8");
}

/**
 * Write opencode.json to workspaceRoot with mode 0600, then append to .gitignore.
 * CFG-01, CFG-03, CFG-06, CFG-08
 *
 * @param buildOpencodeConfig - Config builder function
 * @param params              - AgentConfigParams controlling what to write
 */
export function writeOpencodeConfig(
  buildOpencodeConfig: (port: number, token: string, existingRaw?: string) => Record<string, unknown>,
  params: AgentConfigParams,
): void {
  if (!params.configureOpencode) return;

  const filePath = path.join(params.workspaceRoot, "opencode.json");

  let existingRaw: string | undefined;
  try {
    existingRaw = fs.readFileSync(filePath, "utf8");
  } catch {
    // absent
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
 * entries, back up corrupt existing file as .bak. CFG-02, CFG-05, CFG-09
 *
 * @param buildClaudeConfig - Config builder function
 * @param params           - AgentConfigParams
 */
export function writeClaudeConfig(
  buildClaudeConfig: (port: number, token: string, existingRaw: string | undefined) => Record<string, unknown>,
  params: AgentConfigParams,
): void {
  if (!params.configureClaude) return;

  const claudeDir = path.join(params.workspaceRoot, ".claude");
  const filePath = path.join(claudeDir, "mcp.json");

  // CFG-09: back up corrupt existing file before reading it
  let existingRaw: string | undefined;
  try {
    existingRaw = fs.readFileSync(filePath, "utf8");
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
  // Attempt chmod so the write succeeds even if another tool created .claude/ restrictively
  try { fs.chmodSync(claudeDir, 0o700); } catch { /* ignore */ }
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2) + "\n", {
    encoding: "utf8",
    mode: 0o600,
  });

  appendGitignore(path.join(params.workspaceRoot, ".gitignore"), ".claude/mcp.json");
}

/**
 * Write .vscode/mcp.json to workspaceRoot for VS Code Copilot MCP discovery.
 * Merges with existing server entries. CFG-11
 *
 * @param buildCopilotConfig - Config builder function
 * @param params            - AgentConfigParams
 */
export function writeCopilotConfig(
  buildCopilotConfig: (port: number, token: string, existingRaw: string | undefined) => Record<string, unknown>,
  params: AgentConfigParams,
): void {
  if (!params.configureCopilot) return;

  const vscodeDir = path.join(params.workspaceRoot, ".vscode");
  const filePath = path.join(vscodeDir, "mcp.json");

  let existingRaw: string | undefined;
  try {
    existingRaw = fs.readFileSync(filePath, "utf8");
  } catch {
    // absent
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
 * Write or update .vscode/settings.json to set the VS Code virtualTools
 * threshold high enough that Accordo tools are not hidden behind activation
 * functions. CFG-11
 *
 * - Creates .vscode/ if absent.
 * - Merges with existing settings — does not overwrite unrelated keys.
 * - Skips the write if the threshold is already set to ≥ 300.
 * - Corrupt JSON is backed up as .bak before overwrite.
 *
 * @param workspaceRoot  - Absolute path to the workspace root
 * @param outputChannel  - For warnings
 * @returns true if the file was written (new/changed), false if skipped
 */
export function writeVscodeSettings(
  workspaceRoot: string,
  outputChannel?: { appendLine(value: string): void },
): boolean {
  const THRESHOLD_KEY = "github.copilot.chat.virtualTools.threshold";
  const THRESHOLD_VALUE = 300;

  const vscodeDir = path.join(workspaceRoot, ".vscode");
  const settingsPath = path.join(vscodeDir, "settings.json");

  let settings: Record<string, unknown> = {};
  try {
    const raw = fs.readFileSync(settingsPath, "utf8");
    try {
      settings = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      fs.writeFileSync(settingsPath + ".bak", raw, "utf8");
      outputChannel?.appendLine(
        "[accordo-bridge] .vscode/settings.json was corrupt — backed up as settings.json.bak",
      );
      settings = {};
    }
  } catch {
    // File absent
  }

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
 * if present. CFG-11 cleanup
 *
 * @param workspaceRoot  - Absolute path to the workspace root
 * @param outputChannel  - For logging
 */
export function removeWorkspaceThreshold(
  workspaceRoot: string,
  outputChannel?: { appendLine(value: string): void },
): void {
  const THRESHOLD_KEY = "github.copilot.chat.virtualTools.threshold";
  const settingsPath = path.join(workspaceRoot, ".vscode", "settings.json");

  let raw: string;
  try {
    raw = fs.readFileSync(settingsPath, "utf8");
  } catch {
    return; // absent
  }

  let settings: Record<string, unknown>;
  try {
    settings = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return; // corrupt
  }

  if (!(THRESHOLD_KEY in settings)) {
    return; // key not present
  }

  delete settings[THRESHOLD_KEY];

  if (Object.keys(settings).length === 0) {
    fs.unlinkSync(settingsPath);
  } else {
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 4) + "\n", { encoding: "utf8" });
  }
  outputChannel?.appendLine(
    `[accordo-bridge] Removed stale ${THRESHOLD_KEY} from workspace .vscode/settings.json ✓`,
  );
}
