import type { ExtensionToolDefinition } from "@accordo/bridge-types";
import type { BrowserRelayLike } from "./types.js";
import type { SnapshotRetentionStore } from "./snapshot-retention.js";
import type { SecurityConfig } from "./security/index.js";
import { handleGetDomExcerpt, type GetDomExcerptArgs } from "./page-tool-handlers.js";
import { IMPLICIT_TARGET_TAB_DESCRIPTION } from "./tab-target-contract.js";

export function buildGetDomExcerptTool(
  relay: BrowserRelayLike,
  store: SnapshotRetentionStore,
  security: SecurityConfig,
): ExtensionToolDefinition {
  return {
    name: "accordo_browser_get_dom_excerpt",
    description:
      "Get a sanitized HTML excerpt for a DOM subtree rooted at a CSS selector or browser anchor key. " +
      "Returns cleaned HTML (scripts and styles stripped) up to maxDepth levels deep. " +
      "When called from a stored browser anchor, anchorStrategy/anchorConfidence/resolvedTier describe the actual re-resolution path, while canonicalAnchor* describes the best current anchor for the found element. " +
      "Use when you need the raw HTML structure of a specific region — " +
      "e.g. to read a table, a code block, or any element where tag structure matters. " +
      "Prefer get_page_map or get_text_map for general page understanding.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number", description: IMPLICIT_TARGET_TAB_DESCRIPTION },
        anchorKey: { type: "string", description: "Browser comment or capture anchor key identifying the root element" },
        creationSnapshotId: { type: "string", description: "Original snapshotId recorded when the browser comment anchor was created; used to detect drift on re-resolution" },
        selector: { type: "string", description: "CSS selector for the root element" },
        maxDepth: { type: "number", description: "Maximum depth (default 3)" },
        maxLength: { type: "number", description: "Maximum character length (default 2000)" },
        frameId: { type: "string", description: "F12: Target a specific iframe by its frameId from get_page_map iframes[]" },
        allowedOrigins: { type: "array", items: { type: "string" }, description: "Only allow data from these origins. Empty = use global policy." },
        deniedOrigins: { type: "array", items: { type: "string" }, description: "Block data from these origins. Takes precedence over allowedOrigins." },
        redactPII: { type: "boolean", description: "I1-text: When true, scan text content for PII and replace with [REDACTED]." },
      },
    },
    dangerLevel: "safe",
    idempotent: true,
    handler: (args) => handleGetDomExcerpt(relay, args as unknown as GetDomExcerptArgs, store, security),
  };
}
