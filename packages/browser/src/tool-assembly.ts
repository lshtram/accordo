/**
 * tool-assembly.ts — Browser Tool Assembly
 *
 * Extracts the `buildBrowserTools` composition function from extension.ts.
 * Assembles all browser MCP tools for a given relay connection.
 *
 * Used for both per-window (BrowserRelayServer) and shared mode
 * (SharedRelayClient / SharedBrowserRelayServer).
 *
 * @module
 */

import type { ExtensionToolDefinition } from "@accordo/bridge-types";
import type { BrowserRelayLike } from "./types.js";
import type { SnapshotRetentionStore } from "./snapshot-retention.js";
import type { SecurityConfig } from "./security/index.js";
import { buildPageUnderstandingTools } from "./page-understanding-tools.js";
import { buildWaitForTool } from "./wait-tool.js";
import { buildTextMapTool } from "./text-map-tool.js";
import { buildSemanticGraphTool } from "./semantic-graph-tool.js";
import { buildDiffSnapshotsTool } from "./diff-tool.js";
import { buildHealthTool } from "./health-tool.js";
import { buildManageSnapshotsTool } from "./manage-snapshots-tool.js";
import { buildSpatialRelationsTool } from "./spatial-relations-tool.js";
import { buildControlTools } from "./control-tool-types.js";
import * as http from "node:http";

const RELAY_HOST = "127.0.0.1";
const RELAY_BASE_PORT = 40111;

/**
 * Build the accordo_browser_pair tool.
 *
 * Calls GET /pair/code on the relay server to issue a one-time pairing
 * code. The agent displays this code to the user, who copies it into the
 * browser extension popup to complete pairing.
 *
 * @see PAIR-04 — MCP tool issues a pairing code
 */
function buildPairTool(): ExtensionToolDefinition {
  return {
    name: "accordo_browser_pair",
    description:
      "Issue a one-time pairing code so the user can connect the Accordo browser extension to VS Code. " +
      "Returns a short code (e.g. '1234-5678') that the user should paste into the browser extension popup. " +
      "The code expires in 5 minutes.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
    dangerLevel: "safe" as const,
    idempotent: false,
    handler: async (): Promise<unknown> => {
      return new Promise((resolve) => {
        const req = http.get(`http://${RELAY_HOST}:${RELAY_BASE_PORT}/pair/code`, (res) => {
          let body = "";
          res.on("data", (chunk: Buffer) => { body += chunk.toString(); });
          res.on("end", () => {
            try {
              const parsed = JSON.parse(body) as { code?: string; expiresIn?: number };
              if (parsed.code) {
                resolve({
                  content: [
                    {
                      type: "text",
                      text: `Pairing code: **${parsed.code}**\n\nAsk the user to open the Accordo browser extension popup, enter this code in the "VS Code code:" field, and click Connect. The code expires in ${Math.round((parsed.expiresIn ?? 300000) / 1000)} seconds.`,
                    },
                  ],
                });
              } else {
                resolve({ content: [{ type: "text", text: "Failed to generate pairing code — relay may not be running." }] });
              }
            } catch {
              resolve({ content: [{ type: "text", text: "Failed to parse pairing code response." }] });
            }
          });
        });
        req.on("error", (err: Error) => {
          resolve({ content: [{ type: "text", text: `Failed to reach relay: ${err.message}` }] });
        });
        req.end();
      });
    },
  };
}

/**
 * Build all browser tools for a given relay (BrowserRelayLike).
 *
 * Composes page-understanding tools, wait-for, text-map, semantic-graph,
 * diff-snapshots, health, manage-snapshots, spatial-relations, and control
 * tools into a single array for registration with the bridge.
 *
 * @param relay          - The browser relay connection
 * @param snapshotStore  - Snapshot retention store for envelope persistence
 * @param securityConfig - Security configuration (origin policy, redaction, audit)
 * @returns Array of all browser tool definitions
 */
export function buildBrowserTools(
  relay: BrowserRelayLike,
  snapshotStore: SnapshotRetentionStore,
  securityConfig: SecurityConfig,
): ExtensionToolDefinition[] {
  return [
    ...buildPageUnderstandingTools(relay, snapshotStore, securityConfig),
    buildWaitForTool(relay),
    buildTextMapTool(relay, snapshotStore, securityConfig),
    buildSemanticGraphTool(relay, snapshotStore, securityConfig),
    buildDiffSnapshotsTool(relay, snapshotStore),
    buildHealthTool(relay),
    buildManageSnapshotsTool(relay, snapshotStore),
    buildSpatialRelationsTool(relay, snapshotStore, securityConfig),
    ...buildControlTools(relay),
    buildPairTool(),
  ];
}