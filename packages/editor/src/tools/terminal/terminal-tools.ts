import type { ExtensionToolDefinition } from "@accordo/bridge-types";
import { terminalBasicTools } from "./terminal-basic-tools.js";
import { terminalRunTool } from "./terminal-run-tool.js";

/** All terminal tool definitions for module 18. */
export const terminalTools: ExtensionToolDefinition[] = [
  terminalBasicTools[0],
  terminalRunTool,
  terminalBasicTools[1],
  terminalBasicTools[2],
  terminalBasicTools[3],
];
