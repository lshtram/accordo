/**
 * Layout tool handlers for accordo-editor.
 *
 * Implements the following tools from requirements-editor.md §4:
 *   Module 20: §4.14 panel.toggle, §4.15 layout.zen, §4.16 layout.fullscreen,
 *              §4.23 layout.joinGroups, §4.24 layout.evenGroups
 */

import * as vscode from "vscode";
import type { ExtensionToolDefinition } from "@accordo/bridge-types";
import { errorMessage, wrapHandler } from "../util.js";

// ── Panel command map (§4.14) ─────────────────────────────────────────────────

const PANEL_COMMANDS: Record<string, string> = {
  explorer: "workbench.view.explorer",
  search: "workbench.view.search",
  git: "workbench.view.scm",
  debug: "workbench.view.debug",
  extensions: "workbench.view.extensions",
};

// ── §4.14 accordo.panel.toggle ────────────────────────────────────────────────

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

// ── §4.15 accordo.layout.zen ─────────────────────────────────────────────────

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

// ── §4.16 accordo.layout.fullscreen ──────────────────────────────────────────

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

// ── §4.23 accordo.layout.joinGroups ──────────────────────────────────────────

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

// ── §4.24 accordo.layout.evenGroups ──────────────────────────────────────────

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
    name: "accordo.panel.toggle",
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
    handler: wrapHandler("accordo.panel.toggle", panelToggleHandler),
  },
  {
    name: "accordo.layout.zen",
    group: "layout",
    description: "Toggle Zen Mode (distraction-free fullscreen editing).",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
    dangerLevel: "safe",
    idempotent: false,
    handler: wrapHandler("accordo.layout.zen", layoutZenHandler),
  },
  {
    name: "accordo.layout.fullscreen",
    group: "layout",
    description: "Toggle fullscreen mode.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
    dangerLevel: "safe",
    idempotent: false,
    handler: wrapHandler("accordo.layout.fullscreen", layoutFullscreenHandler),
  },
  {
    name: "accordo.layout.joinGroups",
    group: "layout",
    description: "Collapse all editor splits — merge all groups into one.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
    dangerLevel: "safe",
    idempotent: true,
    handler: wrapHandler("accordo.layout.joinGroups", layoutJoinGroupsHandler),
  },
  {
    name: "accordo.layout.evenGroups",
    group: "layout",
    description: "Equalise the width and height of all editor groups.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
    dangerLevel: "safe",
    idempotent: true,
    handler: wrapHandler("accordo.layout.evenGroups", layoutEvenGroupsHandler),
  },
];
