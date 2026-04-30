/**
 * Server lifecycle for vscode-command E2E harness.
 * Re-exports constants and sim helpers from sub-modules for convenience.
 * All vscode-command E2E test files import from here.
 */

import { beforeAll, afterAll } from "vitest";
import { HubServer } from "../server.js";
import type { ToolRegistration } from "@accordo/bridge-types";

// Import E2E_SECRET locally (re-export alone does not create a local binding)
import { E2E_SECRET } from "./vscode-command-e2e-transport.js";

export const E2E_TOKEN = "e2e-gateway-token";
export { E2E_SECRET };
export const ACCORDO_E2E_LIVE = process.env["ACCORDO_E2E_LIVE"] ?? "0";
export const E2E_TIMEOUT_MS = 1500;
export const flush = (ms = 30) => new Promise<void>((r) => setTimeout(r, ms));

// Re-export from sub-modules for convenience
export { VSCODE_SIM_CATALOG, buildCatalogResp, buildExecuteResp } from "./vscode-command-e2e-sim.js";
export { StubBridge, McpSession } from "./vscode-command-e2e-transport.js";

// ── Tool definitions for E2E tests ────────────────────────────────────────────
//
// These are inline copies of the vscodeCommandTools definitions from the editor
// package, used here so the hub E2E tests don't need cross-package imports.
// The real tool definitions live in packages/editor/src/tools/vscode-command-tools.ts.

export const vscodeCommandTools: ToolRegistration[] = [
  {
    name: "accordo_vscode_command_list",
    group: "editor",
    description:
      "List discoverable VS Code command IDs with paging and policy metadata. Prefer first-class accordo_* tools and treat internal commands as unstable. Read accordo://skills/accordo for command gateway examples and policy guidance.",
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
  },
];

// ── Server lifecycle ─────────────────────────────────────────────────────────

export let server: HubServer;
export let baseUrl: string;

beforeAll(async () => {
  server = new HubServer({ port: 0, host: "127.0.0.1", token: E2E_TOKEN, bridgeSecret: E2E_SECRET, toolCallTimeout: E2E_TIMEOUT_MS });
  await server.start();
  const addr = server.getAddress()!;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => { await server.stop(); });
