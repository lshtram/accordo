import type { ExtensionToolDefinition } from "@accordo/bridge-types";
import type { BrowserRelayLike } from "./types.js";
import type { SnapshotRetentionStore } from "./snapshot-retention.js";
import type { SecurityConfig } from "./security/index.js";
import { handleInspectElement, type InspectElementArgs } from "./page-tool-handlers.js";

export function buildInspectElementTool(
  relay: BrowserRelayLike,
  store: SnapshotRetentionStore,
  security: SecurityConfig,
): ExtensionToolDefinition {
  return {
    name: "accordo_browser_inspect_element",
    description:
      "Deep inspection of a specific DOM element. " +
      "Returns computed styles, full attribute set, states (disabled, readonly, invalid, checked, expanded), " +
      "interaction properties (hasPointerEvents, isObstructed, clickTargetSize), " +
      "bounding box, visibility, and accessible name. " +
      "B2-UID-001: Use uid \"{frameId}:{nodeId}\" from get_page_map to target across frames. " +
      "Otherwise use ref, selector, or nodeId.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number", description: "B2-CTX-001: Optional tab ID to target; omit for active tab" },
        uid: { type: "string", description: "B2-UID-001: Canonical node identity \"{frameId}:{nodeId}\" from get_page_map. Takes precedence over ref/selector/nodeId." },
        ref: { type: "string", description: "Element reference from page map" },
        selector: { type: "string", description: "CSS selector to find element" },
        nodeId: { type: "number", description: "B2-SV-006: Stable node ID from a page map snapshot" },
        frameId: { type: "string", description: "F12: Target a specific iframe by its frameId from get_page_map iframes[]" },
        allowedOrigins: { type: "array", items: { type: "string" }, description: "Only allow data from these origins. Empty = use global policy." },
        deniedOrigins: { type: "array", items: { type: "string" }, description: "Block data from these origins. Takes precedence over allowedOrigins." },
        redactPII: { type: "boolean", description: "I1-text: When true, scan text content for PII and replace with [REDACTED]." },
      },
    },
    dangerLevel: "safe",
    idempotent: true,
    handler: (args) => handleInspectElement(relay, args as InspectElementArgs, store, security),
  };
}
