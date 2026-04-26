/**
 * Layout tool handlers for accordo-editor.
 *
 * Implements the remaining layout tool from requirements-editor.md §4:
 *   Module 20: §4.14 panel.toggle
 */

import * as vscode from "vscode";
import type { ExtensionToolDefinition, IDEState } from "@accordo/bridge-types";
import { errorMessage, wrapHandler } from "../util.js";
import { barTools } from "./bar.js";

const LAYOUT_STATE_COMMENT_SUMMARY_LIMIT = 20;

function sanitizeCommentSummaryEntry(entry: unknown): Record<string, unknown> | null {
  if (typeof entry !== "object" || entry === null) {
    return null;
  }
  const source = entry as Record<string, unknown>;
  const sanitized: Record<string, unknown> = {};

  if (typeof source["threadId"] === "string") sanitized["threadId"] = source["threadId"];
  if (typeof source["uri"] === "string") sanitized["uri"] = source["uri"];
  if (typeof source["preview"] === "string") sanitized["preview"] = source["preview"];
  if (typeof source["intent"] === "string") sanitized["intent"] = source["intent"];
  if (typeof source["line"] === "number") sanitized["line"] = source["line"];
  if (typeof source["surfaceType"] === "string") sanitized["surfaceType"] = source["surfaceType"];

  return Object.keys(sanitized).length > 0 ? sanitized : null;
}

function sanitizeLayoutState(state: IDEState): IDEState {
  const commentModality = state.modalities["accordo-comments"];
  if (typeof commentModality !== "object" || commentModality === null) {
    return state;
  }

  const source = commentModality as Record<string, unknown>;
  const summary = Array.isArray(source["summary"]) ? source["summary"] : [];
  const sanitizedSummary = summary
    .slice(0, LAYOUT_STATE_COMMENT_SUMMARY_LIMIT)
    .map(sanitizeCommentSummaryEntry)
    .filter((entry): entry is Record<string, unknown> => entry !== null);

  const sanitizedCommentModality: Record<string, unknown> = {
    isOpen: source["isOpen"] === true,
    openThreadCount:
      typeof source["openThreadCount"] === "number" ? source["openThreadCount"] : 0,
    resolvedThreadCount:
      typeof source["resolvedThreadCount"] === "number" ? source["resolvedThreadCount"] : 0,
    summary: sanitizedSummary,
  };

  return {
    ...state,
    modalities: {
      ...state.modalities,
      "accordo-comments": sanitizedCommentModality,
    },
  };
}

// ── Panel command map (§4.14) ─────────────────────────────────────────────────

/** Area indicates whether the panel lives in the left sidebar or the bottom panel. */
type PanelArea = "sidebar" | "panel";

/** Command entry for a panel: the VS Code command ID and which area it belongs to. */
interface PanelEntry {
  readonly command: string;
  readonly area: PanelArea;
}

/**
 * Panel command mapping.
 *
 * Sidebar views use show/focus commands (idempotent — always opens).
 * Bottom panel views use toggle commands where available (flip visibility).
 * See docs/20-requirements/requirements-editor.md §4.14 for command rationale.
 */
const PANEL_COMMANDS: Readonly<Record<string, PanelEntry>> = {
  // ── Primary sidebar views (show/focus) ──
  explorer:        { command: "workbench.view.explorer",                   area: "sidebar" },
  search:          { command: "workbench.view.search",                     area: "sidebar" },
  git:             { command: "workbench.view.scm",                        area: "sidebar" },
  debug:           { command: "workbench.view.debug",                      area: "sidebar" },
  extensions:      { command: "workbench.view.extensions",                 area: "sidebar" },

  // ── Bottom panel views (toggle or show/focus) ──
  terminal:        { command: "workbench.action.terminal.toggleTerminal",  area: "panel" },
  output:          { command: "workbench.action.output.toggleOutput",      area: "panel" },
  problems:        { command: "workbench.actions.view.problems",           area: "panel" },
  "debug-console": { command: "workbench.debug.action.toggleRepl",         area: "panel" },
};

// ── §4.14 accordo_panel_toggle ────────────────────────────────────────────────

export async function panelToggleHandler(
  args: Record<string, unknown>,
): Promise<{ panel: string; area: PanelArea } | { error: string }> {
  try {
    const panel = args["panel"];
    if (typeof panel !== "string" || !panel) {
      return { error: "Argument 'panel' must be a non-empty string" };
    }

    const entry = PANEL_COMMANDS[panel];
    if (!entry) {
      return { error: `Unknown panel '${panel}'. Valid panels: ${Object.keys(PANEL_COMMANDS).join(", ")}` };
    }

    await vscode.commands.executeCommand(entry.command);
    return { panel, area: entry.area };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

// ── Tool definitions (Module 20) ─────────────────────────────────────────────

/** All layout tool definitions for module 20. */
export const layoutTools: ExtensionToolDefinition[] = [
  {
    name: "accordo_panel_toggle",
    group: "layout",
    description:
      "Toggle visibility of a VSCode sidebar panel (explorer, search, git, debug, extensions) or bottom panel (terminal, output, problems, debug-console).",
    inputSchema: {
      type: "object",
      properties: {
        panel: {
          type: "string",
          enum: [
            "explorer", "search", "git", "debug", "extensions",
            "terminal", "output", "problems", "debug-console",
          ],
          description: "Panel to toggle",
        },
      },
      required: ["panel"],
    },
    dangerLevel: "safe",
    idempotent: false,
    handler: wrapHandler("accordo_panel_toggle", panelToggleHandler),
  },
];

// ── §4.25 accordo_layout_state ─────────────────────────────────────────────────────

/**
 * Return a snapshot of the current IDE state from the Bridge-local cache.
 * Reads StatePublisher.currentState directly — no Hub network call.
 *
 * @param _args   Ignored — tool takes no input parameters.
 * @param getState  Injected accessor for Bridge-local IDEState.
 */
export async function layoutStateHandler(
  _args: Record<string, unknown>,
  getState: () => IDEState,
): Promise<{ ok: true; state: IDEState } | { ok: false; error: string }> {
  try {
    const state = getState();
    return { ok: true, state: sanitizeLayoutState(state) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Factory that returns all layout tool definitions, including accordo_layout_state.
 * The getState callback is injected from extension.ts so the tool can read
 * Bridge-local IDEState without importing from accordo-bridge directly.
 *
 * @param getState  Returns current IDEState from StatePublisher.
 */
export function createLayoutTools(getState: () => IDEState): ExtensionToolDefinition[] {
  return [
    ...layoutTools,
    ...barTools,
    {
      name: "accordo_layout_state",
      group: "layout",
      description:
        "Return the current IDE state snapshot with lightweight comment metadata only (counts + summary). Call this at the start of every task to orientate yourself before taking any action.",
      inputSchema: {
        type: "object",
        properties: {},
        required: [],
      },
      dangerLevel: "safe",
      idempotent: true,
      handler: wrapHandler("accordo_layout_state", (args) => layoutStateHandler(args, getState)),
    },
  ];
}
