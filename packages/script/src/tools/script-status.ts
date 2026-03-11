/**
 * tools/script-status.ts
 *
 * MCP tool definition for accordo_script_status.
 * Read-only: returns the current ScriptStatus without side effects.
 *
 * M52-TOOL-03
 */

import type { ExtensionToolDefinition } from "@accordo/bridge-types";
import type { ScriptRunner } from "../script-runner.js";

export function makeScriptStatusTool(runner: ScriptRunner): ExtensionToolDefinition {
  return {
    name: "accordo_script_status",
    description: "Return the current script execution status without side effects.",
    dangerLevel: "safe",
    idempotent: true,
    group: "script",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
    handler: async (_args: Record<string, unknown>) => {
      return { ...runner.status };
    },
  };
}
