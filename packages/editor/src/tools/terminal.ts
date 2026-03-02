/**
 * Terminal tool handlers for accordo-editor.
 *
 * Implements the following tools from requirements-editor.md §4:
 *   Module 18: §4.9 terminal.open, §4.10 terminal.run, §4.11 terminal.focus,
 *              §4.21 terminal.list, §4.22 terminal.close
 *              + Terminal ID Map (§5.3)
 */

import type { ExtensionToolDefinition } from "@accordo/bridge-types";

// ── Terminal ID Map (§5.3) ────────────────────────────────────────────────────

/** Maintained across the extension host session. Never reset. */
export const terminalMap = new Map<string, unknown /* vscode.Terminal */>();
let terminalCounter = 0;

/** Generate the next stable accordo terminal ID. */
export function createTerminalId(): string {
  return `accordo-terminal-${++terminalCounter}`;
}

// ── §4.9 accordo.terminal.open ────────────────────────────────────────────────

export async function terminalOpenHandler(
  args: Record<string, unknown>,
): Promise<{ terminalId: string; name: string }> {
  throw new Error("not implemented");
}

// ── §4.10 accordo.terminal.run ────────────────────────────────────────────────

export async function terminalRunHandler(
  args: Record<string, unknown>,
): Promise<{ sent: true; terminalId: string }> {
  throw new Error("not implemented");
}

// ── §4.11 accordo.terminal.focus ─────────────────────────────────────────────

export async function terminalFocusHandler(
  _args: Record<string, unknown>,
): Promise<{ focused: true }> {
  throw new Error("not implemented");
}

// ── §4.21 accordo.terminal.list ──────────────────────────────────────────────

export interface TerminalInfo {
  terminalId: string;
  name: string;
  isActive: boolean;
}

export async function terminalListHandler(
  _args: Record<string, unknown>,
): Promise<{ terminals: TerminalInfo[] }> {
  throw new Error("not implemented");
}

// ── §4.22 accordo.terminal.close ─────────────────────────────────────────────

export async function terminalCloseHandler(
  args: Record<string, unknown>,
): Promise<{ closed: true; terminalId: string }> {
  throw new Error("not implemented");
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
    handler: terminalOpenHandler,
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
    requiresConfirmation: true,
    idempotent: false,
    handler: terminalRunHandler,
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
    handler: terminalFocusHandler,
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
    handler: terminalListHandler,
  },
  {
    name: "accordo.terminal.close",
    description: "Close a specific terminal by its stable accordo ID.",
    inputSchema: {
      type: "object",
      properties: {
        terminalId: { type: "string", description: "Stable accordo terminal ID (from terminal.open or terminal.list)" },
      },
      required: ["terminalId"],
    },
    dangerLevel: "moderate",
    idempotent: true,
    handler: terminalCloseHandler,
  },
];
