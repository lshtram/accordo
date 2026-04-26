import type { ExtensionToolDefinition } from "@accordo/bridge-types";
import { wrapHandler } from "../util.js";
import {
  vscodeCommandExecuteHandler,
  vscodeCommandListHandler,
} from "./vscode-command-stubs.js";

export const vscodeCommandTools: ExtensionToolDefinition[] = [
  {
    name: "accordo_vscode_command_list",
    group: "editor",
    description:
      "List discoverable VS Code command IDs with paging and policy metadata. Runtime-safe usage guidance lives in this tool description plus MCP docs resources accordo://docs/tool-reference/vscode-command-gateway and accordo://docs/troubleshooting/vscode-command-gateway; prefer first-class accordo_* tools and treat internal commands as unstable.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Optional case-insensitive substring filter against the command ID." },
        includeInternal: { type: "boolean", description: "When true, include internal/underscore-prefixed commands. Default: false." },
        offset: { type: "number", description: "0-based pagination offset. Default: 0." },
        limit: { type: "number", description: "Maximum commands to return. Default: 100, capped by policy." },
      },
      required: [],
    },
    dangerLevel: "safe",
    requiresConfirmation: false,
    idempotent: true,
    handler: wrapHandler("accordo_vscode_command_list", vscodeCommandListHandler),
  },
  {
    name: "accordo_vscode_command_execute",
    group: "editor",
    description:
      "Execute a guarded VS Code command with positional args. Use list first, prefer first-class accordo_* tools, and consult the same MCP docs resources for policy/troubleshooting; risky commands may be denied or require explicit confirmation payloads.",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", description: "VS Code command ID to execute." },
        args: {
          type: "array",
          description: "Positional arguments forwarded to vscode.commands.executeCommand(command, ...args).",
          items: {},
        },
        confirmation: {
          type: "object",
          description: "Required only when policy action is confirm.",
          properties: {
            confirmed: { type: "boolean", description: "Set true to acknowledge execution of a confirm-class command." },
            command: { type: "string", description: "Echo of the command ID being confirmed." },
            reason: { type: "string", description: "Optional short justification for the command execution." },
          },
          required: ["confirmed", "command"],
        },
      },
      required: ["command"],
    },
    dangerLevel: "moderate",
    requiresConfirmation: false,
    idempotent: false,
    handler: wrapHandler("accordo_vscode_command_execute", vscodeCommandExecuteHandler),
  },
];
