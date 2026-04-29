import type { ExtensionToolDefinition } from "@accordo/bridge-types";
import { wrapHandler } from "../../util.js";
import { terminalCloseHandler } from "./terminal-close.js";
import { terminalFocusHandler } from "./terminal-focus.js";
import { terminalListHandler } from "./terminal-list.js";
import { terminalOpenHandler } from "./terminal-open.js";

export const terminalBasicTools: ExtensionToolDefinition[] = [
  {
    name: "accordo_terminal_open",
    group: "terminal",
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
    handler: wrapHandler("accordo_terminal_open", terminalOpenHandler),
  },
  {
    name: "accordo_terminal_focus",
    group: "terminal",
    description: "Focus the terminal panel (make it visible and active).",
    inputSchema: { type: "object", properties: {}, required: [] },
    dangerLevel: "safe",
    idempotent: true,
    handler: wrapHandler("accordo_terminal_focus", terminalFocusHandler),
  },
  {
    name: "accordo_terminal_list",
    group: "terminal",
    description: "List all currently open terminal instances with their stable accordo IDs.",
    inputSchema: { type: "object", properties: {}, required: [] },
    dangerLevel: "safe",
    idempotent: true,
    handler: wrapHandler("accordo_terminal_list", terminalListHandler),
  },
  {
    name: "accordo_terminal_close",
    group: "terminal",
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
    handler: wrapHandler("accordo_terminal_close", terminalCloseHandler),
  },
];
