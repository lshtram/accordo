/**
 * tools/run-script.ts
 *
 * MCP tool definition for accordo_script_run.
 * Fire-and-forget: starts execution and returns in <10 ms.
 *
 * M52-TOOL-01
 */

import type { ExtensionToolDefinition } from "@accordo/bridge-types";
import type { ScriptRunner } from "../script-runner.js";
import { validateScript, type NarrationScript } from "../script-types.js";

export function makeRunScriptTool(runner: ScriptRunner): ExtensionToolDefinition {
  return {
    name: "accordo_script_run",
    description: "Run a NarrationScript — executes steps sequentially in the IDE. Call accordo_script_discover first to see all available step types and Accordo command IDs.\n\nQuick example — say hello, wait 5 s, say you waited:\n{\"steps\":[{\"type\":\"speak\",\"text\":\"Hello\"},{\"type\":\"delay\",\"ms\":5000},{\"type\":\"speak\",\"text\":\"I waited 5 seconds\"}]}",
    dangerLevel: "safe",
    group: "script",
    inputSchema: {
      type: "object" as const,
      required: ["script"],
      properties: {
        script: {
          type: "object",
          description: "A NarrationScript object. Required field: steps (array). Optional: label (string), errPolicy (\"abort\"|\"skip\").",
          required: ["steps"],
          properties: {
            label: {
              type: "string",
              description: "Optional human-readable name shown in status/logs.",
            },
            errPolicy: {
              type: "string",
              enum: ["abort", "skip"],
              description: '"abort" (default): stop on first error. "skip": log error and continue.',
            },
            steps: {
              type: "array",
              description: "Ordered list of 1–200 step objects. Each step must have a \"type\" field. Types: \"speak\" (required: text), \"subtitle\" (required: text), \"delay\" (required: ms 1-30000), \"highlight\" (required: file, startLine, endLine), \"clear-highlights\" (no extra fields), \"command\" (required: command — any VS Code command ID or Accordo tool name like \"accordo_editor_open\").",
              items: {
                type: "object",
                required: ["type"],
                properties: {
                  type: {
                    type: "string",
                    enum: ["speak", "subtitle", "delay", "highlight", "clear-highlights", "command"],
                    description: "Step type discriminator.",
                  },
                  text: { type: "string", description: "For speak/subtitle: the text content." },
                  ms: { type: "number", description: "For delay: milliseconds to wait (1–30000)." },
                  block: { type: "boolean", description: "For speak: true (default) = wait for speech to finish." },
                  voice: { type: "string", description: "For speak: voice ID override, e.g. \"af_sarah\"." },
                  speed: { type: "number", description: "For speak: TTS speed multiplier (default 1.0)." },
                  durationMs: { type: "number", description: "For subtitle/highlight: display duration in ms." },
                  file: { type: "string", description: "For highlight: workspace-relative or absolute file path." },
                  startLine: { type: "number", description: "For highlight: 1-based start line." },
                  endLine: { type: "number", description: "For highlight: 1-based end line." },
                  command: { type: "string", description: "For command: VS Code command ID or Accordo tool name (e.g. \"accordo_editor_open\", \"accordo_presentation_next\")." },
                  args: { description: "For command: optional args passed to the command." },
                },
              },
            },
          },
        },
      },
    },
    handler: async (args: Record<string, unknown>) => {
      const { valid, errors } = validateScript(args.script);
      if (!valid) {
        return { error: `Invalid script: ${errors.join("; ")}` };
      }
      if (runner.state === "running" || runner.state === "stopping") {
        return { error: "Script already running — call accordo_script_stop first" };
      }
      const script = args.script as NarrationScript;
      const scriptId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      runner.run(script);
      const result: Record<string, unknown> = {
        started: true,
        scriptId,
        steps: script.steps.length,
      };
      if (script.label !== undefined) result.label = script.label;
      return result;
    },
  };
}
