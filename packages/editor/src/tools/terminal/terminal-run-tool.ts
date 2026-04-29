import type { ExtensionToolDefinition } from "@accordo/bridge-types";
import { wrapHandler } from "../../util.js";
import { terminalRunHandler } from "./terminal-run.js";

export const terminalRunTool: ExtensionToolDefinition = {
  name: "accordo_terminal_run",
  group: "terminal",
  description:
    "Execute a shell command in a terminal. Optional observeMaxLines/observeMaxChars request a bounded inline output preview; omit observeMaxLines or pass 0 for legacy dispatch-only behavior. Requires confirmation — this is destructive.",
  inputSchema: {
    type: "object",
    properties: {
      command: { type: "string", description: "Shell command to execute" },
      terminalId: { type: "string", description: "Terminal to use (stable ID). If omitted, uses active or creates one." },
      observeMaxLines: {
        type: "number",
        description:
          "Optional inline observe line bound. Omit or pass 0 for legacy dispatch-only behavior; positive values request bounded output preview. Hard cap 500.",
      },
      observeMaxChars: {
        type: "number",
        description:
          "Optional inline observe character bound used only when observeMaxLines > 0. Default 12000; hard cap 20000.",
      },
    },
    required: ["command"],
  },
  dangerLevel: "destructive",
  idempotent: false,
  handler: wrapHandler("accordo_terminal_run", terminalRunHandler),
};
