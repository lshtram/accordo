/**
 * tools/stop-script.ts
 *
 * MCP tool definition for accordo_script_stop.
 * Idempotent: always safe to call regardless of current state.
 *
 * M52-TOOL-02
 */

import type { ExtensionToolDefinition } from "@accordo/bridge-types";
import type { ScriptRunner } from "../script-runner.js";

export function makeStopScriptTool(runner: ScriptRunner): ExtensionToolDefinition {
  return {
    name: "accordo_script_stop",
    description: "Stop the currently running script. Idempotent — safe to call at any time.",
    dangerLevel: "safe",
    group: "script",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
    handler: async (_args: Record<string, unknown>) => {
      const wasRunning = runner.state === "running";
      void runner.stop();
      return { stopped: true, wasRunning };
    },
  };
}
