import type { ExtensionToolDefinition } from "@accordo/bridge-types";
import type { BrowserRelayLike } from "./types.js";
import type { SnapshotRetentionStore } from "./snapshot-retention.js";
import type { SecurityConfig } from "./security/index.js";
import { DEFAULT_SECURITY_CONFIG } from "./security/index.js";
import { handleGetTextMap } from "./text-map-tool-handler.js";
import { TEXT_MAP_DEFAULT_MAX_SEGMENTS, TEXT_MAP_MAX_SEGMENTS, type GetTextMapArgs } from "./text-map-tool-contracts.js";
import { IMPLICIT_TARGET_TAB_DESCRIPTION } from "./tab-target-contract.js";

export function buildTextMapTool(
  relay: BrowserRelayLike,
  store: SnapshotRetentionStore,
  security: SecurityConfig = DEFAULT_SECURITY_CONFIG,
): ExtensionToolDefinition {
  return {
    name: "accordo_browser_get_text_map",
    description:
      "Extract the text content of the current page as structured segments with raw/normalized text, " +
      "bounding box (`bbox`) coordinates, visibility flags, semantic context (role, accessible name), and reading-order indices. " +
      "Default output is ordered as visible text first, then offscreen text, then hidden text, " +
      "while preserving geometric reading order within each visibility class. " +
      "Each segment includes: textRaw, textNormalized, readingOrderIndex, role, accessibleName, bbox, and visibility. " +
      "Set visibleOnly=true to return only visible segments. " +
      "Use when you need to read page content in natural reading order, verify text presence, " +
      "or extract link labels and button names with their a11y context. " +
      "Use get_page_map instead when you need interactive element references (uid) for clicking or typing. " +
      "Read accordo://skills/browser for browser workflow and recovery guidance.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: {
          type: "number",
          description: IMPLICIT_TARGET_TAB_DESCRIPTION,
        },
        maxSegments: {
          type: "integer",
          description:
            `Maximum number of text segments to return (default: ${TEXT_MAP_DEFAULT_MAX_SEGMENTS}, max: ${TEXT_MAP_MAX_SEGMENTS}).`,
          minimum: 1,
          maximum: TEXT_MAP_MAX_SEGMENTS,
        },
        visibleOnly: {
          type: "boolean",
          description: "When true, return only segments with visibility='visible'.",
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
          description: `Pagination limit — max segments to return (default: effective cap = min(maxSegments ?? ${TEXT_MAP_DEFAULT_MAX_SEGMENTS}, ${TEXT_MAP_MAX_SEGMENTS})).`,
        },
      },
    },
    dangerLevel: "safe",
    idempotent: true,
    handler: (args) => handleGetTextMap(relay, args as GetTextMapArgs, store, security),
  };
}
