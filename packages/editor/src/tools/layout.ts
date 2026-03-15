/**
 * Layout tool handlers for accordo-editor.
 *
 * Implements the following tools from requirements-editor.md §4:
 *   Module 20: §4.14 panel.toggle, §4.15 layout.zen, §4.16 layout.fullscreen,
 *              §4.23 layout.joinGroups, §4.24 layout.evenGroups
 */

import * as vscode from "vscode";
import type { ExtensionToolDefinition, IDEState } from "@accordo/bridge-types";
import { errorMessage, wrapHandler } from "../util.js";

// ── Panel command map (§4.14) ─────────────────────────────────────────────────

const PANEL_COMMANDS: Record<string, string> = {
  explorer: "workbench.view.explorer",
  search: "workbench.view.search",
  git: "workbench.view.scm",
  debug: "workbench.view.debug",
  extensions: "workbench.view.extensions",
};

// ── §4.14 accordo_panel_toggle ────────────────────────────────────────────────

export async function panelToggleHandler(
  args: Record<string, unknown>,
): Promise<{ visible: true; panel: string } | { error: string }> {
  try {
    const panel = args["panel"];
    if (typeof panel !== "string" || !panel) {
      return { error: "Argument 'panel' must be a non-empty string" };
    }

    const command = PANEL_COMMANDS[panel];
    if (!command) {
      return { error: `Unknown panel '${panel}'. Valid panels: ${Object.keys(PANEL_COMMANDS).join(", ")}` };
    }

    await vscode.commands.executeCommand(command);
    return { visible: true, panel };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

// ── §4.15 accordo_layout_zen ─────────────────────────────────────────────────

export async function layoutZenHandler(
  _args: Record<string, unknown>,
): Promise<{ active: true } | { error: string }> {
  try {
    await vscode.commands.executeCommand("workbench.action.toggleZenMode");
    return { active: true };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

// ── §4.16 accordo_layout_fullscreen ──────────────────────────────────────────

export async function layoutFullscreenHandler(
  _args: Record<string, unknown>,
): Promise<{ active: true } | { error: string }> {
  try {
    await vscode.commands.executeCommand("workbench.action.toggleFullScreen");
    return { active: true };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

// ── §4.23 accordo_layout_joinGroups ──────────────────────────────────────────

export async function layoutJoinGroupsHandler(
  _args: Record<string, unknown>,
): Promise<{ groups: number } | { error: string }> {
  try {
    await vscode.commands.executeCommand("workbench.action.joinAllGroups");
    return { groups: 1 };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

// ── §4.24 accordo_layout_evenGroups ──────────────────────────────────────────

export async function layoutEvenGroupsHandler(
  _args: Record<string, unknown>,
): Promise<{ equalized: true } | { error: string }> {
  try {
    await vscode.commands.executeCommand("workbench.action.evenEditorWidths");
    return { equalized: true };
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
      "Toggle visibility of a VSCode sidebar panel (explorer, search, git, debug, extensions).",
    inputSchema: {
      type: "object",
      properties: {
        panel: {
          type: "string",
          enum: ["explorer", "search", "git", "debug", "extensions"],
          description: "Panel to toggle",
        },
      },
      required: ["panel"],
    },
    dangerLevel: "safe",
    idempotent: true,
    handler: wrapHandler("accordo_panel_toggle", panelToggleHandler),
  },
  {
    name: "accordo_layout_zen",
    group: "layout",
    description: "Toggle Zen Mode (distraction-free fullscreen editing).",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
    dangerLevel: "safe",
    idempotent: false,
    handler: wrapHandler("accordo_layout_zen", layoutZenHandler),
  },
  {
    name: "accordo_layout_fullscreen",
    group: "layout",
    description: "Toggle fullscreen mode.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
    dangerLevel: "safe",
    idempotent: false,
    handler: wrapHandler("accordo_layout_fullscreen", layoutFullscreenHandler),
  },
  {
    name: "accordo_layout_joinGroups",
    group: "layout",
    description: "Collapse all editor splits — merge all groups into one.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
    dangerLevel: "safe",
    idempotent: true,
    handler: wrapHandler("accordo_layout_joinGroups", layoutJoinGroupsHandler),
  },
  {
    name: "accordo_layout_evenGroups",
    group: "layout",
    description: "Equalise the width and height of all editor groups.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
    dangerLevel: "safe",
    idempotent: true,
    handler: wrapHandler("accordo_layout_evenGroups", layoutEvenGroupsHandler),
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
    return { ok: true, state };
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
    {
      name: "accordo_layout_state",
      group: "layout",
      description:
        "Return the full current IDE state snapshot. Call this at the start of every task to orientate yourself before taking any action.",
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
