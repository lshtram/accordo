/**
 * tools/script-discover.ts
 *
 * MCP tool: accordo_script_discover
 *
 * Returns the full NarrationScript format reference — all step types with their
 * fields and constraints, plus the complete list of Accordo tool names that are
 * available as VS Code commands (and therefore usable in "command" steps).
 *
 * Call this tool before authoring a script to know exactly what is available.
 *
 * M52-TOOL-04
 */

import type { ExtensionToolDefinition } from "@accordo/bridge-types";

/**
 * All Accordo tool names that are dual-registered as VS Code commands by the
 * Bridge when the corresponding extension activates. Use these as the
 * "command" field in a "command" step.
 *
 * Tool names use underscores (MCP convention) — these are the exact strings
 * to pass to the "command" field. Example:
 *   { "type": "command", "command": "accordo_editor_open", "args": { "path": "src/index.ts" } }
 */
const ACCORDO_COMMAND_IDS: Record<
  string,
  { args: string; description: string }
> = {
  // ── Editor tools (accordo-editor) ────────────────────────────────────────
  accordo_editor_open: {
    args: '{ "path": "src/index.ts", "line": 10 }',
    description: "Open a file in the editor, optionally scrolling to a line.",
  },
  accordo_editor_close: {
    args: '{ "path": "src/index.ts" }',
    description: "Close an editor tab.",
  },
  accordo_editor_scroll: {
    args: '{ "line": 42 }',
    description: "Scroll the active editor to a line.",
  },
  accordo_editor_split: {
    args: '{ "direction": "right" }',
    description: "Split the editor pane.",
  },
  accordo_editor_focus: {
    args: '{ "group": 1 }',
    description: "Focus an editor group.",
  },
  accordo_editor_reveal: {
    args: '{ "line": 10 }',
    description: "Reveal a line in the active editor.",
  },
  accordo_editor_highlight: {
    args: '{ "startLine": 1, "endLine": 5 }',
    description: "Apply a highlight decoration to lines in the active editor.",
  },
  accordo_editor_clearHighlights: {
    args: "{}",
    description: "Clear all highlight decorations in the active editor.",
  },
  accordo_editor_save: {
    args: "{}",
    description: "Save the active file.",
  },
  accordo_editor_saveAll: {
    args: "{}",
    description: "Save all open files.",
  },
  accordo_editor_format: {
    args: "{}",
    description: "Format the active document.",
  },

  // ── Terminal tools (accordo-editor) ─────────────────────────────────────
  accordo_terminal_open: {
    args: '{ "name": "My Terminal" }',
    description: "Open a new terminal panel.",
  },
  accordo_terminal_run: {
    args: '{ "command": "echo hello" }',
    description: "Run a shell command in the active terminal.",
  },
  accordo_terminal_focus: {
    args: "{}",
    description: "Focus the terminal panel.",
  },
  accordo_terminal_list: {
    args: "{}",
    description: "List open terminals.",
  },
  accordo_terminal_close: {
    args: '{ "name": "My Terminal" }',
    description: "Close a terminal.",
  },

  // ── Layout tools (accordo-editor) ────────────────────────────────────────
  accordo_panel_toggle: {
    args: '{ "panel": "sidebar" }',
    description: "Toggle a sidebar or panel.",
  },
  accordo_layout_zen: {
    args: "{}",
    description: "Toggle Zen Mode.",
  },
  accordo_layout_fullscreen: {
    args: "{}",
    description: "Toggle fullscreen mode.",
  },
  accordo_layout_joinGroups: {
    args: "{}",
    description: "Collapse all editor splits into one group.",
  },
  accordo_layout_evenGroups: {
    args: "{}",
    description: "Equalize editor group sizes.",
  },
  accordo_layout_state: {
    args: "{}",
    description: "Return the full current IDE state snapshot. Call at the start of every task.",
  },
  accordo_layout_panel: {
    args: '{ "area": "sidebar", "action": "open" }',
    description:
      "Control VS Code area containers (sidebar, panel, right bar) — open, close, or open a specific view within an area. Use explicit open/close instead of toggle for predictable results.",
  },

  // ── Comment tools (accordo-comments) ─────────────────────────────────────
  comment_list: {
    args: "{}",
    description: "List all review comment threads.",
  },
  comment_create: {
    args: '{ "uri": "file:///src/index.ts", "anchor": { "kind": "text", "startLine": 10 }, "body": "Needs review" }',
    description: "Create a review comment thread.",
  },

  // ── Presentation tools (accordo-slidev) ──────────────────────────────────
  accordo_presentation_open: {
    args: '{ "file": "demo/slides.deck.md" }',
    description: "Open a Slidev presentation deck.",
  },
  accordo_presentation_next: {
    args: "{}",
    description: "Advance to the next slide.",
  },
  accordo_presentation_prev: {
    args: "{}",
    description: "Go back to the previous slide.",
  },
  accordo_presentation_goto: {
    args: '{ "slide": 3 }',
    description: "Navigate to a specific slide number.",
  },
  accordo_presentation_close: {
    args: "{}",
    description: "Close the active presentation session.",
  },

  // ── Voice commands (accordo-voice) ───────────────────────────────────────
  // Note: use the built-in "speak" step type instead of this for TTS.
  // These VS Code command IDs are for advanced cases.
  "accordo.voice.stopNarration": {
    args: "{}",
    description: "Stop any currently playing narration.",
  },
  "accordo.voice.pauseNarration": {
    args: "{}",
    description: "Pause narration playback.",
  },
  "accordo.voice.resumeNarration": {
    args: "{}",
    description: "Resume paused narration.",
  },
};

export function makeScriptDiscoverTool(): ExtensionToolDefinition {
  return {
    name: "accordo_script_discover",
    description:
      "Get the full NarrationScript format reference: all step types with fields/constraints, and all Accordo command IDs usable in 'command' steps. Call this before authoring a script.",
    dangerLevel: "safe",
    idempotent: true,
    group: "script",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
    handler: async (_args: Record<string, unknown>) => {
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
              "All Accordo MCP tools are automatically available as VS Code commands using their tool name (e.g. 'accordo_editor_open'). " +
              "See the 'accordoCommandIds' section for the full list with args.",
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

        accordoCommandIds: Object.fromEntries(
          Object.entries(ACCORDO_COMMAND_IDS).map(([name, info]) => [
            name,
            { description: info.description, exampleArgs: info.args },
          ]),
        ),

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
