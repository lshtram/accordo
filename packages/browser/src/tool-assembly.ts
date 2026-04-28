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
import type { BrowserBridgeAPI, BrowserRelayLike } from "./types.js";
import type { SnapshotRetentionStore } from "./snapshot-retention.js";
import { ScreenshotRetentionStore } from "./screenshot-retention.js";
import type { SecurityConfig } from "./security/index.js";
import { buildCommentContextTool } from "./comment-context-tool.js";
import { buildPageUnderstandingTools } from "./page-understanding-tools.js";
import { buildWaitForTool } from "./wait-tool.js";
import { buildTextMapTool } from "./text-map-tool.js";
import { buildSemanticGraphTool } from "./semantic-graph-tool.js";
import { buildDiffSnapshotsTool } from "./diff-tool.js";
import { buildHealthTool } from "./health-tool.js";
import { buildManageSnapshotsTool } from "./manage-snapshots-tool.js";
import { buildManageScreenshotsTool } from "./manage-screenshots-tool.js";
import { buildSpatialRelationsTool } from "./spatial-relations-tool.js";
import { buildControlTools } from "./control-tool-types.js";
import { readRelayPort } from "./relay-lifecycle-primitives.js";
import { PAIR_CODE_TTL_MS } from "./shared-relay-pairing.js";
import { PAIRING_CODE_ENDPOINT_PATH, RELAY_BASE_PORT, RELAY_HOST } from "./relay-transport-constants.js";
import * as http from "node:http";

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
      const relayPort = readRelayPort() ?? RELAY_BASE_PORT;
      return new Promise((resolve) => {
        const req = http.get(`http://${RELAY_HOST}:${relayPort}${PAIRING_CODE_ENDPOINT_PATH}`, (res) => {
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
                      text: `Pairing code: **${parsed.code}**\n\nAsk the user to open the Accordo browser extension popup, enter this code in the "VS Code code:" field, and click Connect. The code expires in ${Math.round((parsed.expiresIn ?? PAIR_CODE_TTL_MS) / 1000)} seconds.`,
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
 * diff-snapshots, health, manage-snapshots, manage-screenshots, spatial-relations,
 * and control tools into a single array for registration with the bridge.
 *
 * @param relay            - The browser relay connection
 * @param snapshotStore    - Snapshot retention store for envelope persistence
 * @param securityConfig   - Security configuration (origin policy, redaction, audit)
 * @param screenshotStore  - Screenshot retention store for file-ref capture (GAP-G1)
 * @returns Array of all browser tool definitions
 */
export function buildBrowserTools(
  bridge: BrowserBridgeAPI,
  relay: BrowserRelayLike,
  snapshotStore: SnapshotRetentionStore,
  securityConfig: SecurityConfig,
  screenshotStore?: ScreenshotRetentionStore,
): ExtensionToolDefinition[] {
  return [
    ...buildPageUnderstandingTools(relay, snapshotStore, securityConfig, screenshotStore),
    buildWaitForTool(relay),
    buildTextMapTool(relay, snapshotStore, securityConfig),
    buildSemanticGraphTool(relay, snapshotStore, securityConfig),
    buildDiffSnapshotsTool(relay, snapshotStore),
    buildHealthTool(relay),
    buildManageSnapshotsTool(relay, snapshotStore),
    buildManageScreenshotsTool(relay, screenshotStore ?? new ScreenshotRetentionStore()),
    buildSpatialRelationsTool(relay, snapshotStore, securityConfig),
    ...buildControlTools(relay),
    buildCommentContextTool(bridge, relay, snapshotStore, securityConfig),
    buildPairTool(),
  ].map(withBrowserRuntimeContract);
}

function withBrowserRuntimeContract(tool: ExtensionToolDefinition): ExtensionToolDefinition {
  const idempotence = tool.idempotent
    ? "This tool is deterministic/idempotent for unchanged page and retained-state inputs."
    : "This tool is not idempotent: it may change browser focus, page state, retained artifacts, or pairing state.";
  return {
    ...tool,
    description: `${tool.description}\n\nRuntime contract: Preconditions: the Accordo browser relay and paired extension must be connected unless this is the pairing tool; tabId targets a specific tab and omitted tabId uses the implicit target tab. Success shape: returns the documented tool-specific object, usually with pageId/snapshotId/capturedAt/source for page data and artifactMode for screenshots. Failure shape: returns success:false with a stable error code plus retryable/retryAfterMs/recoveryHints when available. Common error codes include browser-not-connected, no-target, invalid-request, element-not-found, element-off-screen, snapshot-not-found, snapshot-stale, timeout, capture-failed, image-too-large, origin-blocked, control-not-granted, tab-not-found, and page-closed. Recovery: pair or reconnect the browser extension for browser-not-connected, call list_pages/select_page or pass tabId for no-target/tab-not-found, reacquire a fresh page_map snapshot for stale or missing node/snapshot errors, grant browser control permission before control actions, relax origin filters only when appropriate for origin-blocked, and retry transient timeout/navigation-interrupted/page-closed errors after the page stabilizes. ${idempotence}`,
  };
}
