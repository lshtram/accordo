/**
 * Bar tool handler for accordo-editor — explicit open/close for VS Code areas.
 *
 * Implements a single combined tool (`accordo_layout_panel`) that controls:
 *   - Primary Sidebar (left)
 *   - Bottom Panel (terminal/output/problems area)
 *   - Auxiliary Bar (right sidebar)
 *
 * Optionally opens a specific view within an area (e.g., "explorer" in sidebar).
 *
 * Design document: docs/00-workplan/e-6-bar-tools.md
 * Requirements: requirements-editor.md §4.27
 */

import * as vscode from "vscode";
import type { ExtensionToolDefinition } from "@accordo/bridge-types";
import { errorMessage, wrapHandler } from "../util.js";

// ── Types ─────────────────────────────────────────────────────────────────────

/** Visibility state for a VS Code area container. */
type AreaVisibility = "unknown" | "open" | "closed";

/** Area identifiers matching the tool's `area` parameter. */
type AreaId = "sidebar" | "panel" | "rightBar";

/** Command pair for each area: the open (focus) and close commands. */
interface AreaCommands {
  readonly focus: string;
  readonly close: string;
}

/** Which area a view belongs to, and the VS Code command to show it. */
interface ViewEntry {
  readonly command: string;
  readonly area: AreaId;
}

/** Module-level state tracker for the three area containers. */
interface BarState {
  sidebar: AreaVisibility;
  panel: AreaVisibility;
  rightBar: AreaVisibility;
}

/** Success response for an area-level operation (no view specified). */
type AreaResponse = {
  area: AreaId;
  action: "opened" | "closed";
  previousState: AreaVisibility;
  wasNoOp: boolean;
};

/** Success response for a view-level open operation. */
type ViewResponse = {
  area: AreaId;
  action: "opened";
  view: string;
  previousState: AreaVisibility;
  wasNoOp: false;
};

/** Union of all possible success responses. */
type LayoutPanelResponse = AreaResponse | ViewResponse;

// ── State Tracker ─────────────────────────────────────────────────────────────

/**
 * Module-level visibility state for the three VS Code area containers.
 *
 * Starts as "unknown" for all areas because VS Code has no API to query
 * current visibility (when-clause context keys are not programmatically
 * accessible from extension code).
 *
 * Resets to "unknown" on extension reload — no persistence needed.
 */
const barState: BarState = {
  sidebar: "unknown",
  panel: "unknown",
  rightBar: "unknown",
};

/**
 * Reset all bar state to "unknown".
 * @internal — for testing only
 */
export function _resetBarState(): void {
  barState.sidebar = "unknown";
  barState.panel = "unknown";
  barState.rightBar = "unknown";
}

/**
 * Read current bar state (snapshot).
 * @internal — for testing only
 */
export function _getBarState(): Readonly<BarState> {
  return { ...barState };
}

// ── Area Commands ─────────────────────────────────────────────────────────────

/**
 * VS Code command IDs for each area container.
 *
 * - `focus` commands open the area if closed and give it focus (idempotent open).
 * - `close` commands have a precondition that the area is visible — safe no-op
 *   if already closed.
 *
 * See docs/00-workplan/e-6-bar-tools.md §2.3.1 for source verification.
 */
const AREA_COMMANDS: Readonly<Record<AreaId, AreaCommands>> = {
  sidebar: {
    focus: "workbench.action.focusSideBar",
    close: "workbench.action.closeSidebar",
  },
  panel: {
    focus: "workbench.action.focusPanel",
    close: "workbench.action.closePanel",
  },
  rightBar: {
    focus: "workbench.action.focusAuxiliaryBar",
    close: "workbench.action.closeAuxiliaryBar",
  },
};

// ── View Commands ─────────────────────────────────────────────────────────────

/**
 * View command mapping — maps known view IDs to their VS Code commands.
 *
 * Sidebar views use show/focus commands (idempotent — always opens).
 * Panel views use toggle commands — these require a focus-first pattern
 * (call focusPanel before the view command) to prevent accidentally
 * hiding the panel when it's already showing the requested view.
 *
 * See docs/00-workplan/e-6-bar-tools.md §2.3.2 for rationale.
 */
const VIEW_COMMANDS: Readonly<Record<string, ViewEntry>> = {
  // ── Sidebar views ──
  explorer:        { command: "workbench.view.explorer",                  area: "sidebar" },
  search:          { command: "workbench.view.search",                    area: "sidebar" },
  git:             { command: "workbench.view.scm",                       area: "sidebar" },
  debug:           { command: "workbench.view.debug",                     area: "sidebar" },
  extensions:      { command: "workbench.view.extensions",                area: "sidebar" },
  comments:        { command: "accordo-comments-panel.focus",             area: "sidebar" },

  // ── Panel views ──
  terminal:        { command: "workbench.action.terminal.toggleTerminal", area: "panel" },
  output:          { command: "workbench.action.output.toggleOutput",     area: "panel" },
  problems:        { command: "workbench.actions.view.problems",          area: "panel" },
  "debug-console": { command: "workbench.debug.action.toggleRepl",        area: "panel" },
};

/** Valid area IDs for input validation. */
const VALID_AREAS: ReadonlySet<string> = new Set(["sidebar", "panel", "rightBar"]);

/** Valid actions for input validation. */
const VALID_ACTIONS: ReadonlySet<string> = new Set(["open", "close"]);

// ── Handler ───────────────────────────────────────────────────────────────────

/**
 * Handler for the combined `accordo_layout_panel` tool.
 *
 * Controls area-level open/close + optional view-level open.
 *
 * State transition rules (from e-6-bar-tools.md §2.2):
 * - unknown → open:  focus* → state = open
 * - unknown → close: focus* then close* → state = closed
 * - open → open:     no-op (idempotent)
 * - open → close:    close* → state = closed
 * - closed → open:   focus* → state = open
 * - closed → close:  no-op (idempotent)
 *
 * Panel view toggle safety (e-6-bar-tools.md §2.3.2):
 * - When opening a panel view, call focusPanel first to prevent toggle
 *   commands from hiding an already-visible panel.
 *
 * rightBar view restriction (e-6-bar-tools.md §1.6):
 * - { area: "rightBar", view: "..." } is always an error.
 */
export async function layoutPanelHandler(
  args: Record<string, unknown>,
): Promise<LayoutPanelResponse | { error: string }> {
  // ── Step 1: Validate area ──────────────────────────────────────────────────
  const area = args["area"];
  if (area === undefined || area === null) {
    return { error: "Argument 'area' must be one of: sidebar, panel, rightBar" };
  }
  if (typeof area !== "string" || !VALID_AREAS.has(area)) {
    return { error: "Argument 'area' must be one of: sidebar, panel, rightBar" };
  }
  const areaId = area as AreaId;

  // ── Step 2: Validate action ─────────────────────────────────────────────────
  const action = args["action"];
  if (action === undefined || action === null) {
    return { error: "Argument 'action' must be one of: open, close" };
  }
  if (typeof action !== "string" || !VALID_ACTIONS.has(action)) {
    return { error: "Argument 'action' must be one of: open, close" };
  }

  // ── Step 3: Validate view + action: "close" is an error ───────────────────
  const view = args["view"] as string | undefined;
  if (view !== undefined && action === "close") {
    return {
      error:
        "Cannot close a specific view. Omit 'view' to close the area, or use action 'open' to switch to a view.",
    };
  }

  // ── Step 4: rightBar + view is an error ────────────────────────────────────
  if (view !== undefined && areaId === "rightBar") {
    return {
      error:
        "rightBar does not support the 'view' parameter. Use action 'open' or 'close' without specifying a view.",
    };
  }

  // ── Step 5: View-level open operation ──────────────────────────────────────
  if (view !== undefined) {
    const viewEntry = VIEW_COMMANDS[view];

    // Check view-area mismatch for known views
    if (viewEntry !== undefined && viewEntry.area !== areaId) {
      // Construct known view list for error message
      const knownForArea = Object.entries(VIEW_COMMANDS)
        .filter(([, entry]) => entry.area === areaId)
        .map(([name]) => name);
      const list = knownForArea.length > 0 ? knownForArea.join(", ") : "none";
      return { error: `Unknown view '${view}' for area '${areaId}'. Known views: ${list}` };
    }

    // For panel views: focus-first pattern (call focusPanel before view command)
    if (areaId === "panel") {
      try {
        await vscode.commands.executeCommand(AREA_COMMANDS.panel.focus);
      } catch (err) {
        return { error: `Command failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    }

    // Try known view command first, then heuristic for unknown views
    const viewCmd = viewEntry?.command ?? `workbench.view.${view}`;
    try {
      await vscode.commands.executeCommand(viewCmd);
    } catch (err) {
      return {
        error: `Unknown view '${view}' for area '${areaId}'. Known views: ${Object.entries(VIEW_COMMANDS)
          .filter(([, entry]) => entry.area === areaId)
          .map(([name]) => name)
          .join(", ")}. If this is a third-party view, check the extension's documentation for the correct view ID.`,
      };
    }

    const previousState = barState[areaId];
    barState[areaId] = "open";
    return {
      area: areaId,
      action: "opened",
      view,
      previousState,
      wasNoOp: false,
    };
  }

  // ── Step 6: Area-level operation ───────────────────────────────────────────
  const currentState = barState[areaId];
  const focusCmd = AREA_COMMANDS[areaId].focus;
  const closeCmd = AREA_COMMANDS[areaId].close;

  // Transition: unknown → open
  if (currentState === "unknown" && action === "open") {
    try {
      await vscode.commands.executeCommand(focusCmd);
    } catch (err) {
      return { error: `Command failed: ${err instanceof Error ? err.message : String(err)}` };
    }
    barState[areaId] = "open";
    return { area: areaId, action: "opened", previousState: currentState, wasNoOp: false };
  }

  // Transition: unknown → close (force open first, then close)
  if (currentState === "unknown" && action === "close") {
    try {
      await vscode.commands.executeCommand(focusCmd);
    } catch (err) {
      return { error: `Command failed: ${err instanceof Error ? err.message : String(err)}` };
    }
    try {
      await vscode.commands.executeCommand(closeCmd);
    } catch (err) {
      return { error: `Command failed: ${err instanceof Error ? err.message : String(err)}` };
    }
    barState[areaId] = "closed";
    return { area: areaId, action: "closed", previousState: currentState, wasNoOp: false };
  }

  // Transition: open → open (idempotent no-op)
  if (currentState === "open" && action === "open") {
    return { area: areaId, action: "opened", previousState: currentState, wasNoOp: true };
  }

  // Transition: open → close
  if (currentState === "open" && action === "close") {
    try {
      await vscode.commands.executeCommand(closeCmd);
    } catch (err) {
      return { error: `Command failed: ${err instanceof Error ? err.message : String(err)}` };
    }
    barState[areaId] = "closed";
    return { area: areaId, action: "closed", previousState: currentState, wasNoOp: false };
  }

  // Transition: closed → open
  if (currentState === "closed" && action === "open") {
    try {
      await vscode.commands.executeCommand(focusCmd);
    } catch (err) {
      return { error: `Command failed: ${err instanceof Error ? err.message : String(err)}` };
    }
    barState[areaId] = "open";
    return { area: areaId, action: "opened", previousState: currentState, wasNoOp: false };
  }

  // Transition: closed → close (idempotent no-op)
  if (currentState === "closed" && action === "close") {
    return { area: areaId, action: "closed", previousState: currentState, wasNoOp: true };
  }

  // Should never reach here, but TypeScript needs this
  return { area: areaId, action: action === "open" ? "opened" : "closed", previousState: currentState, wasNoOp: true };
}

// ── Tool Definition ──────────────────────────────────────────────────────────

/** All bar tool definitions — single combined tool for area open/close. */
export const barTools: ExtensionToolDefinition[] = [
  {
    name: "accordo_layout_panel",
    group: "layout",
    description:
      "Control VS Code area containers (sidebar, panel, right bar) — open, close, or open a specific view within an area. Use explicit open/close instead of toggle for predictable results.",
    inputSchema: {
      type: "object",
      properties: {
        area: {
          type: "string",
          enum: ["sidebar", "panel", "rightBar"],
          description:
            "Which VS Code area to control: 'sidebar' (primary sidebar, left), 'panel' (bottom panel — terminal/output/problems), 'rightBar' (auxiliary bar, right sidebar)",
        },
        view: {
          type: "string",
          description:
            "Optional: specific view to open within the area. Only valid for 'sidebar' and 'panel' areas (not 'rightBar'). Sidebar: 'explorer', 'search', 'git', 'debug', 'extensions', 'comments'. Panel: 'terminal', 'output', 'problems', 'debug-console'. Other extension views may also work — try the view ID. Only valid with action 'open'.",
        },
        action: {
          type: "string",
          enum: ["open", "close"],
          description: "Action to perform: 'open' or 'close'. No toggle.",
        },
      },
      required: ["area", "action"],
    },
    dangerLevel: "safe",
    idempotent: true,
    handler: wrapHandler("accordo_layout_panel", layoutPanelHandler),
  },
];
