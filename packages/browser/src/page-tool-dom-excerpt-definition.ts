import type { ExtensionToolDefinition } from "@accordo/bridge-types";
import type { BrowserRelayLike } from "./types.js";
import type { SnapshotRetentionStore } from "./snapshot-retention.js";
import type { SecurityConfig } from "./security/index.js";
import { handleGetDomExcerpt, type GetDomExcerptArgs } from "./page-tool-handlers.js";

export function buildGetDomExcerptTool(
  relay: BrowserRelayLike,
  store: SnapshotRetentionStore,
  security: SecurityConfig,
): ExtensionToolDefinition {
  return {
    name: "accordo_browser_get_dom_excerpt",
    description:
      "Get a sanitized HTML excerpt for a DOM subtree rooted at a CSS selector. " +
      "Returns cleaned HTML (scripts and styles stripped) up to maxDepth levels deep. " +
      "Use when you need the raw HTML structure of a specific region — " +
      "e.g. to read a table, a code block, or any element where tag structure matters. " +
      "Prefer get_page_map or get_text_map for general page understanding.",
    inputSchema: {
      type: "object",
      required: ["selector"],
      properties: {
        tabId: { type: "number", description: "B2-CTX-001: Optional tab ID to target; omit for active tab" },
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
