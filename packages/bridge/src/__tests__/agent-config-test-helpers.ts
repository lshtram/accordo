import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AgentConfigParams } from "../agent-config.js";

export function makeTmpDir(prefix = "accordo-agent-config-test-"): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function removeTmpDir(tmpDir: string): void {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

export function makeOutputChannel(): { appendLine(value: string): void; lines: string[] } {
  const lines: string[] = [];
  return { appendLine: (value: string) => { lines.push(value); }, lines };
}

export function makeParams(
  workspaceRoot: string,
  overrides: Partial<Omit<AgentConfigParams, "configureCopilot">> & { configureCopilot?: boolean } = {},
): AgentConfigParams {
  return {
    workspaceRoot,
    port: 3000,
    token: "test-token-abc",
    configureOpencode: true,
    configureClaude: true,
    configureCopilot: false,
    outputChannel: makeOutputChannel(),
    ...overrides,
  };
}
