import type { ExtensionToolDefinition } from "@accordo/bridge-types";
import type { BrowserRelayLike } from "./types.js";
import type { SnapshotRetentionStore } from "./snapshot-retention.js";
import type { SecurityConfig } from "./security/index.js";
import { DEFAULT_SECURITY_CONFIG } from "./security/index.js";
import { handleGetTextMap } from "./text-map-tool-handler.js";
import type { GetTextMapArgs } from "./text-map-tool-contracts.js";

export function buildTextMapTool(
  relay: BrowserRelayLike,
  store: SnapshotRetentionStore,
  security: SecurityConfig = DEFAULT_SECURITY_CONFIG,
): ExtensionToolDefinition {
  return {
    name: "accordo_browser_get_text_map",
    description:
      "Extract the text content of the current page as structured segments with raw/normalized text, " +
      "bounding boxes, visibility flags, semantic context (role, accessible name), and reading-order indices. " +
      "Each segment includes: textRaw, textNormalized, readingOrderIndex, role, accessibleName, " +
      "bounds (x/y/width/height), isVisible, and isInViewport. " +
      "Use when you need to read page content in natural reading order, verify text presence, " +
      "or extract link labels and button names with their a11y context. " +
      "Use get_page_map instead when you need interactive element references (uid) for clicking or typing.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: {
          type: "number",
          description: "B2-CTX-001: Optional tab ID to target; omit for active tab",
        },
        maxSegments: {
          type: "integer",
          description:
            "Maximum number of text segments to return (default: 500, max: 2000).",
          minimum: 1,
          maximum: 2000,
        },
        frameId: {
          type: "string",
          description: "F12: Target a specific iframe by its frameId from get_page_map iframes[]",
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
        offset: {
          type: "number",
          description: "Pagination offset — 0-based index of first segment to return (default: 0).",
        },
        limit: {
          type: "number",
          description: "Pagination limit — max segments to return (default: effective cap = min(maxSegments ?? 500, 2000)).",
        },
      },
    },
    dangerLevel: "safe",
    idempotent: true,
    handler: (args) => handleGetTextMap(relay, args as GetTextMapArgs, store, security),
  };
}
