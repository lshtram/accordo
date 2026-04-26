/**
 * VSCode catalog for vscode-command-gateway.
 *
 * Requirements: M75-VCG-02, 03, 17 (requirements-editor.md §4.26)
 */

import * as vscode from "vscode";
import type {
  VscodeCommandCatalog,
  VscodeCommandListRequest,
} from "./vscode-command-contracts.js";
import { classifyCommand } from "./vscode-command-policy.js";

const INTERNAL_PREFIX = "_";

export class VsCodeCatalog implements VscodeCommandCatalog {
  async listCommands(request: VscodeCommandListRequest): Promise<{
    auditId: string;
    commands: readonly {
      command: string;
      source: "core" | "extension";
      internal: boolean;
      policy: ReturnType<typeof classifyCommand>;
    }[];
    totalCount: number;
    nextOffset?: number;
    truncated: boolean;
  }> {
    const allCommands = await vscode.commands.getCommands(request.includeInternal ?? false);
    let filtered = allCommands;
    if (!request.includeInternal) {
      filtered = filtered.filter((cmd) => !cmd.startsWith(INTERNAL_PREFIX));
    }
    if (request.query) {
      const q = request.query.toLowerCase();
      filtered = filtered.filter((cmd) => cmd.toLowerCase().includes(q));
    }
    const offset = request.offset ?? 0;
    const limit = request.limit ?? 100;
    const page = filtered.slice(offset, offset + limit);
    const totalCount = filtered.length;
    const truncated = offset + page.length < totalCount;
    return {
      auditId: `audit-list-${Date.now()}`,
      commands: page.map((command) => ({
        command,
        source: "core" as const,
        internal: command.startsWith(INTERNAL_PREFIX),
        policy: classifyCommand(command, []),
      })),
      totalCount,
      nextOffset: truncated ? offset + page.length : undefined,
      truncated,
    };
  }
}