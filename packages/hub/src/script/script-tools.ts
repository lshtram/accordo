/**
 * script-tools.ts
 *
 * Factory functions that create the 4 Hub-native script tools as
 * HubToolRegistration objects with localHandler.
 *
 * These tools execute directly in the Hub process — they never route
 * through bridgeServer.invoke(). The McpCallExecutor short-circuits
 * to localHandler when it detects a HubToolRegistration.
 *
 * Tools:
 *   accordo_script_run     — M52-TOOL-01
 *   accordo_script_stop    — M52-TOOL-02
 *   accordo_script_status  — M52-TOOL-03
 *   accordo_script_discover — M52-TOOL-04
 *
 * DEC-005 — Hub-native tool local handler pattern
 */

import { randomUUID } from "node:crypto";
import type { HubToolRegistration } from "../hub-tool-types.js";
import type { ScriptRunner } from "./script-runner.js";
import type { ToolRegistry } from "../tool-registry.js";
import { validateScript, type NarrationScript } from "./script-types.js";

/**
 * Dependencies for creating script tools.
 */
export interface ScriptToolDeps {
  /** The ScriptRunner instance that executes narration scripts. */
  runner: ScriptRunner;
  /** The ToolRegistry, used by discover to list available commands dynamically. */
  toolRegistry: ToolRegistry;
}

/**
 * Create the accordo_script_run tool.
 * Validates the script, starts execution, returns immediately.
 *
 * M52-TOOL-01
 */
export function makeRunScriptTool(deps: ScriptToolDeps): HubToolRegistration {
  return {
    name: "accordo_script_run",
    description:
      'Run a NarrationScript — executes steps sequentially in the IDE. Call accordo_script_discover first to see all available step types and Accordo command IDs.\n\nQuick example — say hello, wait 5 s, say you waited:\n{"steps":[{"type":"speak","text":"Hello"},{"type":"delay","ms":5000},{"type":"speak","text":"I waited 5 seconds"}]}',
    dangerLevel: "moderate",
    requiresConfirmation: false,
    idempotent: false,
    group: "script",
    inputSchema: {
      type: "object" as const,
      properties: {
        script: {
          type: "object",
          description:
            'A NarrationScript object. Required field: steps (array). Optional: label (string), errPolicy ("abort"|"skip").',
          required: ["steps"],
          properties: {
            label: {
              type: "string",
              description: "Optional human-readable name shown in status/logs.",
            },
            errPolicy: {
              type: "string",
              enum: ["abort", "skip"],
              description:
                '"abort" (default): stop on first error. "skip": log error and continue.',
            },
            steps: {
              type: "array",
              description:
                'Ordered list of 1–200 step objects. Each step must have a "type" field. Types: "speak" (required: text), "subtitle" (required: text), "delay" (required: ms 1-30000), "highlight" (required: file, startLine, endLine), "clear-highlights" (no extra fields), "command" (required: command — any VS Code command ID or Accordo tool name like "accordo_editor_open").',
              items: {
                type: "object",
                required: ["type"],
                properties: {
                  type: {
                    type: "string",
                    enum: [
                      "speak",
                      "subtitle",
                      "delay",
                      "highlight",
                      "clear-highlights",
                      "command",
                    ],
                    description: "Step type discriminator.",
                  },
                  text: {
                    type: "string",
                    description: "For speak/subtitle: the text content.",
                  },
                  ms: {
                    type: "number",
                    description: "For delay: milliseconds to wait (1–30000).",
                  },
                  block: {
                    type: "boolean",
                    description:
                      "For speak: true (default) = wait for speech to finish.",
                  },
                  voice: {
                    type: "string",
                    description: 'For speak: voice ID override, e.g. "af_sarah".',
                  },
                  speed: {
                    type: "number",
                    description: "For speak: TTS speed multiplier (default 1.0).",
                  },
                  durationMs: {
                    type: "number",
                    description:
                      "For subtitle/highlight: display duration in ms.",
                  },
                  file: {
                    type: "string",
                    description:
                      "For highlight: workspace-relative or absolute file path.",
                  },
                  startLine: {
                    type: "number",
                    description: "For highlight: 1-based start line.",
                  },
                  endLine: {
                    type: "number",
                    description: "For highlight: 1-based end line.",
                  },
                  command: {
                    type: "string",
                    description:
                      'For command: VS Code command ID or Accordo tool name (e.g. "accordo_editor_open", "accordo_presentation_next").',
                  },
                  args: {
                    description:
                      "For command: optional args passed to the command.",
                  },
                },
              },
            },
          },
        },
      },
      required: ["script"],
    },
    // localHandler returns immediately after starting the runner (fire-and-forget).
    // The runner executes steps asynchronously — the MCP caller gets a response
    // in <10 ms with { started, scriptId, steps } and polls accordo_script_status
    // for progress. A4: scriptId is a real UUID generated via crypto.randomUUID().
    localHandler: async (args: Record<string, unknown>): Promise<unknown> => {
      const { valid, errors } = validateScript(args.script);
      if (!valid) {
        throw new Error(`Invalid script: ${errors.join("; ")}`);
      }
      if (deps.runner.state === "running" || deps.runner.state === "stopping") {
        throw new Error("Script already running — call accordo_script_stop first");
      }
      const script = args.script as NarrationScript;
      // A4: generate a real UUID instead of the old Date.now()-based ID.
      const scriptId = randomUUID();
      // Pass scriptId via the second optional parameter so status.scriptId is seeded.
      deps.runner.run(script, scriptId);
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

/**
 * Create the accordo_script_stop tool.
 * Idempotent: always safe to call regardless of current state.
 *
 * M52-TOOL-02
 */
export function makeStopScriptTool(deps: ScriptToolDeps): HubToolRegistration {
  return {
    name: "accordo_script_stop",
    description:
      "Stop the currently running script. Idempotent — safe to call at any time.",
    dangerLevel: "safe",
    requiresConfirmation: false,
    idempotent: true,
    group: "script",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
    localHandler: async (_args: Record<string, unknown>): Promise<unknown> => {
      const wasRunning = deps.runner.state === "running";
      // stop() is idempotent and returns a promise we intentionally discard here —
      // the caller receives { stopped: true } immediately; the runner cleans up async.
      void deps.runner.stop();
      return { stopped: true, wasRunning };
    },
  };
}

/**
 * Create the accordo_script_status tool.
 * Read-only: returns the current ScriptStatus without side effects.
 *
 * M52-TOOL-03
 */
export function makeScriptStatusTool(deps: ScriptToolDeps): HubToolRegistration {
  return {
    name: "accordo_script_status",
    description:
      "Return the current script execution status without side effects.",
    dangerLevel: "safe",
    requiresConfirmation: false,
    idempotent: true,
    group: "script",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
    localHandler: async (_args: Record<string, unknown>): Promise<unknown> => {
      return { ...deps.runner.status };
    },
  };
}

/**
 * Create the accordo_script_discover tool.
 * Returns the full reference card with dynamically resolved command IDs
 * from toolRegistry.list() instead of hardcoded ACCORDO_COMMAND_IDS.
 *
 * M52-TOOL-04
 */
export function makeScriptDiscoverTool(deps: ScriptToolDeps): HubToolRegistration {
  return {
    name: "accordo_script_discover",
    description:
      "Get the full NarrationScript format reference: all step types with fields/constraints, and all Accordo command IDs usable in 'command' steps. Call this before authoring a script.",
    dangerLevel: "safe",
    requiresConfirmation: false,
    idempotent: true,
    group: "script",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
    localHandler: async (_args: Record<string, unknown>): Promise<unknown> => {
      // Dynamically resolve available tool names from the registry
      const registeredTools = deps.toolRegistry.list();
      const commandIds: Record<string, { description: string }> = {};
      for (const tool of registeredTools) {
        commandIds[tool.name] = { description: tool.description };
      }

      return {
        overview:
          "A NarrationScript is a JSON object with a 'steps' array. Steps execute sequentially. " +
          "Use 'command' steps to invoke any Accordo tool or VS Code built-in command by name.",

        scriptTopLevelFields: {
          steps: "Required. Array of 1–200 step objects.",
          label: "Optional. Human-readable script name shown in status/logs.",
          errPolicy:
            'Optional. "abort" (default): stop on first error. "skip": log error and continue.',
        },

        stepTypes: {
          speak: {
            description:
              "Speak text aloud via the voice extension. Automatically falls back to a subtitle display if voice is not installed.",
            required: ["type", "text"],
            fields: {
              type: '"speak"',
              text: "string — text to speak",
              voice: 'string? — voice ID override, e.g. "af_sarah", "bm_george"',
              speed: "number? — TTS speed multiplier (default 1.0)",
              block:
                "boolean? — true (default): wait for speech to finish before next step. false: fire-and-forget.",
            },
            example: { type: "speak", text: "Welcome to the demo.", block: true },
          },

          subtitle: {
            description:
              "Show a line of text in the VS Code status bar for a fixed duration. Does not speak.",
            required: ["type", "text"],
            fields: {
              type: '"subtitle"',
              text: "string — text to display",
              durationMs: "number? — display duration in ms (default 3000)",
            },
            example: { type: "subtitle", text: "Opening the main module…", durationMs: 4000 },
          },

          command: {
            description:
              "Execute any VS Code command or Accordo tool by name. " +
              "Use the tool names from 'registeredCommandIds' — these are dynamically resolved from the current tool registry.",
            required: ["type", "command"],
            fields: {
              type: '"command"',
              command: "string — VS Code command ID or Accordo tool name",
              args: "any? — serialisable argument passed to executeCommand",
            },
            examples: [
              { type: "command", command: "accordo_editor_open", args: { path: "src/index.ts", line: 10 } },
              { type: "command", command: "accordo_presentation_next" },
              { type: "command", command: "workbench.action.showCommands" },
            ],
          },

          delay: {
            description: "Pause execution for a fixed number of milliseconds.",
            required: ["type", "ms"],
            fields: {
              type: '"delay"',
              ms: "number — milliseconds to wait (1–30 000)",
            },
            example: { type: "delay", ms: 2000 },
          },

          highlight: {
            description:
              "Open a file and apply a highlight decoration to a range of lines. " +
              "Uses the editor.findMatchHighlightBackground theme colour. " +
              "Persists until a clear-highlights step or end of script unless durationMs is set.",
            required: ["type", "file", "startLine", "endLine"],
            fields: {
              type: '"highlight"',
              file: "string — workspace-relative or absolute path",
              startLine: "number — 1-based start line (inclusive, ≥ 1)",
              endLine: "number — 1-based end line (inclusive, ≥ startLine, span ≤ 500 lines)",
              durationMs: "number? — auto-clear after this many ms",
            },
            example: { type: "highlight", file: "src/index.ts", startLine: 10, endLine: 25 },
          },

          "clear-highlights": {
            description: "Remove all highlight decorations applied by previous highlight steps.",
            required: ["type"],
            fields: { type: '"clear-highlights"' },
            example: { type: "clear-highlights" },
          },
        },

        registeredCommandIds: commandIds,

        vsCodeBuiltinExamples: {
          "workbench.action.showCommands": "Open Command Palette",
          "workbench.action.gotoLine": "Go to Line (prompts user)",
          "editor.action.selectAll": "Select all text in active editor",
          "workbench.action.closeActiveEditor": "Close the active editor tab",
        },

        fullScriptExample: {
          label: "Intro walkthrough",
          errPolicy: "abort",
          steps: [
            { type: "speak", text: "Let me show you the main entry point.", block: true },
            { type: "command", command: "accordo_editor_open", args: { path: "src/index.ts", line: 1 } },
            { type: "delay", ms: 500 },
            { type: "highlight", file: "src/index.ts", startLine: 1, endLine: 20 },
            { type: "speak", text: "These first 20 lines handle initialisation.", block: true },
            { type: "clear-highlights" },
            { type: "subtitle", text: "Walkthrough complete.", durationMs: 3000 },
          ],
        },
      };
    },
  };
}

/**
 * Create all 4 script tools as HubToolRegistration objects.
 * Convenience wrapper for registering all script tools at once.
 *
 * @param deps - ScriptRunner and ToolRegistry
 * @returns Array of 4 HubToolRegistration objects
 */
export function createScriptTools(deps: ScriptToolDeps): HubToolRegistration[] {
  return [
    makeRunScriptTool(deps),
    makeStopScriptTool(deps),
    makeScriptStatusTool(deps),
    makeScriptDiscoverTool(deps),
  ];
}
