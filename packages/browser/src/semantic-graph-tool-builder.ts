import type { ExtensionToolDefinition } from "@accordo/bridge-types";
import type { BrowserRelayLike } from "./types.js";
import type { SnapshotRetentionStore } from "./snapshot-retention.js";
import type { SecurityConfig } from "./security/index.js";
import { DEFAULT_SECURITY_CONFIG } from "./security/index.js";
import { handleGetSemanticGraph } from "./semantic-graph-tool-handler.js";
import { narrowSemanticGraphArgs } from "./semantic-graph-tool-narrowing.js";

export function buildSemanticGraphTool(
  relay: BrowserRelayLike,
  store: SnapshotRetentionStore,
  security: SecurityConfig = DEFAULT_SECURITY_CONFIG,
): ExtensionToolDefinition {
  return {
    name: "accordo_browser_get_semantic_graph",
    description:
      "Extract the semantic structure of the current page: accessibility tree, " +
      "landmark regions, document heading outline (H1–H6), and form models " +
      "with field details. Returns all four sub-trees in a single call. " +
      "The a11y tree includes role, name, states, and parent/child relationships. " +
      "Landmark regions identify banner, navigation, main, and complementary areas. " +
      "Form models list every field with its label, type, value, and validation state. " +
      "Use when you need to audit accessibility, understand page layout by region, " +
      "or enumerate all form fields. Use get_page_map for interactive element references.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: {
          type: "number",
          description: "B2-CTX-001: Optional tab ID to target; omit for active tab",
        },
        maxDepth: {
          type: "integer",
          description: "Maximum depth for the accessibility tree (default: 8, max: 16).",
          minimum: 1,
          maximum: 16,
        },
        frameId: {
          type: "string",
          description: "F12: Target a specific iframe by its frameId from get_page_map iframes[]",
        },
        visibleOnly: {
          type: "boolean",
          description: "Exclude hidden elements from all sub-trees (default: true).",
        },
        piercesShadow: {
          type: "boolean",
          description:
            "B2-VD-001..004: Traverse open shadow DOM trees and annotate shadow nodes with " +
            "inShadowRoot: true and shadowHostId. Default: false.",
        },
        redactPII: {
          type: "boolean",
          description:
            "When true, scan text content for email addresses, phone numbers, " +
            "and API keys and replace with [REDACTED]. I1-text.",
        },
        allowedOrigins: {
          type: "array",
          items: { type: "string" },
          description: "Only allow data from these origins. Empty = use global policy.",
        },
        deniedOrigins: {
          type: "array",
          items: { type: "string" },
          description: "Block data from these origins. Takes precedence over allowedOrigins.",
        },
      },
    },
    dangerLevel: "safe",
    idempotent: true,
    handler: (rawArgs) => handleGetSemanticGraph(relay, narrowSemanticGraphArgs(rawArgs), store, security),
  };
}
