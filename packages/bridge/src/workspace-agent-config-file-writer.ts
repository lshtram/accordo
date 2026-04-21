import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentConfigParams } from "./agent-config-contract.js";
import { appendGitignore } from "./agent-config-gitignore.js";

export function writeOpencodeConfig(
  buildOpencodeConfig: (port: number, token: string, existingRaw?: string) => Record<string, unknown>,
  params: AgentConfigParams,
): void {
  if (!params.configureOpencode) return;
  const filePath = path.join(params.workspaceRoot, "opencode.json");
  const existingRaw = readOptionalUtf8(filePath);
  const config = buildOpencodeConfig(params.port, params.token, existingRaw);
  if (!config["mcp"]) params.outputChannel.appendLine("[accordo] Warning: opencode.json is missing mcp field");
  if (!config["instructions"]) params.outputChannel.appendLine("[accordo] Warning: opencode.json is missing instructions field");
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
  appendGitignore(path.join(params.workspaceRoot, ".gitignore"), "opencode.json");
}

export function writeClaudeConfig(
  buildClaudeConfig: (port: number, token: string, existingRaw: string | undefined) => Record<string, unknown>,
  params: AgentConfigParams,
): void {
  if (!params.configureClaude) return;
  const claudeDir = path.join(params.workspaceRoot, ".claude");
  const filePath = path.join(claudeDir, "mcp.json");
  const existingRaw = readClaudeConfig(filePath);
  const config = buildClaudeConfig(params.port, params.token, existingRaw);
  fs.mkdirSync(claudeDir, { recursive: true });
  try { fs.chmodSync(claudeDir, 0o700); } catch { /* ignore */ }
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
  appendGitignore(path.join(params.workspaceRoot, ".gitignore"), ".claude/mcp.json");
}

function readOptionalUtf8(filePath: string): string | undefined {
  try { return fs.readFileSync(filePath, "utf8"); } catch { return undefined; }
}

function readClaudeConfig(filePath: string): string | undefined {
  const existingRaw = readOptionalUtf8(filePath);
  if (existingRaw === undefined) return undefined;
  try {
    JSON.parse(existingRaw);
    return existingRaw;
  } catch {
    fs.writeFileSync(filePath + ".bak", existingRaw, "utf8");
    return undefined;
  }
}
