/**
 * Terminal tool handlers for accordo-editor.
 *
 * Implements the following tools from requirements-editor.md §4:
 *   Module 18: §4.9 terminal.open, §4.10 terminal.run, §4.11 terminal.focus,
 *              §4.21 terminal.list, §4.22 terminal.close
 *              + Terminal ID Map (§5.3)
 */

import * as vscode from "vscode";
import type { ExtensionToolDefinition } from "@accordo/bridge-types";
import { errorMessage, wrapHandler } from "../util.js";

// ── Terminal ID Map (§5.3) ────────────────────────────────────────────────────

/** Maintained across the extension host session. Never reset outside tests. */
export const terminalMap = new Map<string, vscode.Terminal>();
let terminalCounter = 0;

/** Generate the next stable accordo terminal ID. */
export function createTerminalId(): string {
  return `accordo-terminal-${++terminalCounter}`;
}

/** Reverse lookup: vscode.Terminal → accordo terminal ID. */
function findTerminalId(terminal: vscode.Terminal): string | undefined {
  for (const [id, t] of terminalMap) {
    if (t === terminal) return id;
  }
  return undefined;
}

/**
 * Look up a terminal by stable ID with liveness validation (§5.3).
 * If the terminal was closed by the user its stale map entry is removed.
 */
function getTerminal(id: string): vscode.Terminal | undefined {
  const t = terminalMap.get(id);
  if (t && (vscode.window.terminals as vscode.Terminal[]).includes(t)) return t;
  if (t) terminalMap.delete(id); // stale entry cleanup
  return undefined;
}

/** Test-only helper — resets the terminal map and counter. */
export function _resetTerminalMap(): void {
  terminalMap.clear();
  terminalCounter = 0;
}

/**
 * Register the onDidCloseTerminal listener for stale-entry cleanup (§5.3 lifecycle).
 * Must be called once during extension activation.
 */
export function registerTerminalLifecycle(
  context: vscode.ExtensionContext,
): void {
  context.subscriptions.push(
    vscode.window.onDidCloseTerminal((closed) => {
      for (const [id, t] of terminalMap) {
        if (t === closed) {
          terminalMap.delete(id);
          break;
        }
      }
    }),
  );
}

// ── §4.9 accordo.terminal.open ────────────────────────────────────────────────

export async function terminalOpenHandler(
  args: Record<string, unknown>,
): Promise<{ terminalId: string; name: string } | { error: string }> {
  try {
    const rawName = typeof args["name"] === "string" ? args["name"] : "Accordo";
    const rawCwd = typeof args["cwd"] === "string" ? args["cwd"] : undefined;
    const cwd = rawCwd ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    const terminal = vscode.window.createTerminal({ name: rawName, cwd });
    terminal.show();

    const terminalId = createTerminalId();
    terminalMap.set(terminalId, terminal);

    return { terminalId, name: rawName };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

// ── §4.10 accordo.terminal.run ────────────────────────────────────────────────

export async function terminalRunHandler(
  args: Record<string, unknown>,
): Promise<{ sent: true; terminalId: string } | { error: string }> {
  try {
    const command = args["command"];
    if (typeof command !== "string" || !command) {
      return { error: "Argument 'command' must be a non-empty string" };
    }

    const requestedId =
      typeof args["terminalId"] === "string" ? args["terminalId"] : undefined;

    let terminal: vscode.Terminal;
    let terminalId: string;

    if (requestedId) {
      const found = getTerminal(requestedId);
      if (!found) return { error: `Terminal ${requestedId} not found` };
      terminal = found;
      terminalId = requestedId;
    } else {
      const active = vscode.window.activeTerminal;
      if (active) {
        let existingId = findTerminalId(active);
        if (!existingId) {
          existingId = createTerminalId();
          terminalMap.set(existingId, active);
        }
        terminal = active;
        terminalId = existingId;
      } else {
        const newTerminal = vscode.window.createTerminal({ name: "Accordo" });
        terminalId = createTerminalId();
        terminalMap.set(terminalId, newTerminal);
        terminal = newTerminal;
      }
    }

    terminal.sendText(command, true);
    terminal.show();

    return { sent: true, terminalId };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

// ── §4.11 accordo.terminal.focus ─────────────────────────────────────────────

export async function terminalFocusHandler(
  _args: Record<string, unknown>,
): Promise<{ focused: true } | { error: string }> {
  try {
    await vscode.commands.executeCommand("workbench.action.terminal.focus");
    return { focused: true };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

// ── §4.21 accordo.terminal.list ──────────────────────────────────────────────

export interface TerminalInfo {
  terminalId: string;
  name: string;
  isActive: boolean;
}

export async function terminalListHandler(
  _args: Record<string, unknown>,
): Promise<{ terminals: TerminalInfo[] } | { error: string }> {
  try {
    const activeTerminal = vscode.window.activeTerminal;
    const terminals: TerminalInfo[] = vscode.window.terminals.map((t) => ({
      terminalId: findTerminalId(t) ?? "(untracked)",
      name: t.name,
      isActive: t === activeTerminal,
    }));
    return { terminals };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

// ── §4.22 accordo.terminal.close ─────────────────────────────────────────────

export async function terminalCloseHandler(
  args: Record<string, unknown>,
): Promise<{ closed: true; terminalId: string } | { error: string }> {
  try {
    const requestedId =
      typeof args["terminalId"] === "string" ? args["terminalId"] : undefined;
    const requestedName =
      typeof args["name"] === "string" ? args["name"] : undefined;

    if (!requestedId && !requestedName) {
      return { error: "Argument 'terminalId' or 'name' must be provided" };
    }

    let terminal: vscode.Terminal | undefined;
    let terminalId: string;

    if (requestedId) {
      terminal = getTerminal(requestedId);
      if (!terminal) return { error: `Terminal ${requestedId} not found` };
      terminalId = requestedId;
      terminalMap.delete(terminalId);
    } else {
      // Name-based lookup — allows closing terminals not opened via accordo
      terminal = (vscode.window.terminals as vscode.Terminal[]).find(
        (t) => t.name === requestedName,
      );
      if (!terminal) return { error: `Terminal with name '${requestedName}' not found` };
      const existingId = findTerminalId(terminal);
      if (existingId) terminalMap.delete(existingId);
      terminalId = existingId ?? `(name:${requestedName})`;
    }

    terminal.dispose();

    return { closed: true, terminalId };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

// ── Tool definitions (Module 18) ─────────────────────────────────────────────

/** All terminal tool definitions for module 18. */
export const terminalTools: ExtensionToolDefinition[] = [
  {
    name: "accordo.terminal.open",
    description: "Create and show a new terminal instance. Returns a stable accordo terminal ID.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Terminal display name. Default: 'Accordo'" },
        cwd: { type: "string", description: "Working directory. Default: workspace root" },
      },
      required: [],
    },
    dangerLevel: "moderate",
    idempotent: false,
    handler: wrapHandler("accordo.terminal.open", terminalOpenHandler),
  },
  {
    name: "accordo.terminal.run",
    description: "Execute a shell command in a terminal. Requires confirmation — this is destructive.",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", description: "Shell command to execute" },
        terminalId: { type: "string", description: "Terminal to use (stable ID). If omitted, uses active or creates one." },
      },
      required: ["command"],
    },
    dangerLevel: "destructive",
    idempotent: false,
    handler: wrapHandler("accordo.terminal.run", terminalRunHandler),
  },
  {
    name: "accordo.terminal.focus",
    description: "Focus the terminal panel (make it visible and active).",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
    dangerLevel: "safe",
    idempotent: true,
    handler: wrapHandler("accordo.terminal.focus", terminalFocusHandler),
  },
  {
    name: "accordo.terminal.list",
    description: "List all currently open terminal instances with their stable accordo IDs.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
    dangerLevel: "safe",
    idempotent: true,
    handler: wrapHandler("accordo.terminal.list", terminalListHandler),
  },
  {
    name: "accordo.terminal.close",
    description: "Close a specific terminal by its stable accordo ID. Untracked terminals (not opened via accordo) can be closed by name.",
    inputSchema: {
      type: "object",
      properties: {
        terminalId: { type: "string", description: "Stable accordo terminal ID (from terminal.open or terminal.list)" },
        name: { type: "string", description: "Terminal name. Alternative to terminalId — works for untracked terminals." },
      },
      required: [],
    },
    dangerLevel: "moderate",
    idempotent: true,
    handler: wrapHandler("accordo.terminal.close", terminalCloseHandler),
  },
];
