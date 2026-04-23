import type { ExtensionToolDefinition } from "@accordo/bridge-types";
import type { BrowserRelayLike } from "./types.js";
import type { SnapshotRetentionStore } from "./snapshot-retention.js";
import type { SecurityConfig } from "./security/index.js";
import { handleGetPageMap, type GetPageMapArgs } from "./page-tool-handlers.js";

export function buildGetPageMapTool(
  relay: BrowserRelayLike,
  store: SnapshotRetentionStore,
  security: SecurityConfig,
): ExtensionToolDefinition {
  return {
    name: "accordo_browser_get_page_map",
    description:
      "Collect a structured page map from the current document. " +
      "Returns an array of nodes, each with: uid (stable reference for click/type), " +
      "role (ARIA role), accessibleName, textContent, bounds (x/y/width/height when includeBounds:true), " +
      "readingOrderIndex, visibility flags, states (disabled/checked/expanded), and containerId. " +
      "Use this as your primary tool to understand page structure and find interactive elements. " +
      "Use get_text_map instead when you need reading-order text with per-segment accessible names. " +
      "Use get_semantic_graph instead when you need the full a11y tree, landmark regions, or form models.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number", description: "B2-CTX-001: Optional tab ID to target; omit for active tab" },
        maxDepth: { type: "number", description: "Maximum DOM tree depth (default 4, max 8)" },
        maxNodes: { type: "number", description: "Maximum number of nodes (default 200, max 500)", maximum: 500 },
        includeBounds: { type: "boolean", description: "Include bounding box coordinates" },
        viewportOnly: { type: "boolean", description: "Only visible elements in viewport" },
        visibleOnly: { type: "boolean", description: "B2-FI-001: Only elements visible in current viewport" },
        interactiveOnly: { type: "boolean", description: "B2-FI-002: Only interactive elements (buttons, links, inputs, etc.)" },
        roles: { type: "array", items: { type: "string" }, description: "B2-FI-003: Filter by ARIA role(s) — implicit mapping included (e.g. h1–h6 → heading)" },
        textMatch: { type: "string", description: "B2-FI-004: Filter by text content substring (case-insensitive)" },
        selector: { type: "string", description: "B2-FI-005: Filter by CSS selector" },
        regionFilter: { type: "object", description: "B2-FI-006: Filter by bounding box region (viewport coordinates)", properties: { x: { type: "number" }, y: { type: "number" }, width: { type: "number" }, height: { type: "number" } }, required: ["x", "y", "width", "height"] },
        piercesShadow: { type: "boolean", description: "B2-VD-001..004: Traverse open shadow roots and annotate closed hosts. Default: false" },
        traverseFrames: { type: "boolean", description: "B2-VD-005..009: Enumerate top-level iframes and return metadata (frameId, src, bounds, sameOrigin). Child-frame DOM traversal NOT included — this feature only. Default: false" },
        frameFilter: { type: "array", items: { type: "string", enum: ["content", "ad", "widget", "unknown"] }, description: "A4: Filter iframes by classification. Only iframes matching one of the specified types are returned. Requires traverseFrames: true." },
        allowedOrigins: { type: "array", items: { type: "string" }, description: "Only allow data from these origins. Empty = use global policy." },
        deniedOrigins: { type: "array", items: { type: "string" }, description: "Block data from these origins. Takes precedence over allowedOrigins." },
        redactPII: { type: "boolean", description: "I1-text: When true, scan text content for PII and replace with [REDACTED]." },
        offset: { type: "number", description: "Pagination offset — 0-based index of first node to return (default: 0)." },
        limit: { type: "number", description: "Pagination limit — max nodes to return (default: effective cap = min(maxNodes ?? 200, 500))." },
      },
    },
    dangerLevel: "safe",
    idempotent: true,
    handler: (args) => handleGetPageMap(relay, args as GetPageMapArgs, store, security),
  };
}
