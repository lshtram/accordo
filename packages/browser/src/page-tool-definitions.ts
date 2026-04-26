/**
 * M91-PU + M91-CR — Page Tool Definitions
 *
 * Defines and registers 6 MCP tools that give AI agents the ability
 * to inspect live browser pages:
 *   - browser_get_page_map — structured DOM summary
 *   - browser_inspect_element — deep element inspection
 *   - browser_get_dom_excerpt — sanitized HTML fragment
 *   - browser_capture_region — cropped viewport screenshot of a specific element or rect
 *   - browser_list_pages — enumerate open tabs (B2-CTX-001)
 *   - browser_select_page — activate a tab (B2-CTX-001)
 *
 * @module
 */

import type { ExtensionToolDefinition } from "@accordo/bridge-types";
import type { BrowserRelayLike } from "./types.js";
import type { SnapshotRetentionStore } from "./snapshot-retention.js";
import type { ScreenshotRetentionStore } from "./screenshot-retention.js";
import type { SecurityConfig } from "./security/index.js";
import { DEFAULT_SECURITY_CONFIG } from "./security/index.js";
import type {
  CaptureRegionArgs,
  CaptureRegionResponse,
  DomExcerptResponse,
  GetDomExcerptArgs,
  GetPageMapArgs,
  InspectElementArgs,
  InspectElementResponse,
  ListPagesArgs,
  ListPagesResponse,
  PageMapResponse,
  PageToolError,
  SelectPageArgs,
  SelectPageResponse,
} from "./page-tool-handlers.js";
import { buildCaptureRegionTool } from "./page-tool-capture-definition.js";
import { buildGetDomExcerptTool } from "./page-tool-dom-excerpt-definition.js";
import { buildInspectElementTool } from "./page-tool-inspect-definition.js";
import { buildGetPageMapTool } from "./page-tool-page-map-definition.js";
import { resolveAnchorMetadata } from "./page-tool-anchor-metadata.js";
import { buildListPagesTool, buildSelectPageTool } from "./page-tool-tab-definitions.js";

export type {
  CaptureRegionArgs,
  DomExcerptResponse,
  GetDomExcerptArgs,
  GetPageMapArgs,
  InspectElementArgs,
  InspectElementResponse,
  ListPagesArgs,
  ListPagesResponse,
  PageMapResponse,
  PageToolError,
  SelectPageArgs,
  SelectPageResponse,
};

// ── Type Guards ──────────────────────────────────────────────────────────────

function isSelectPageArgs(obj: unknown): obj is SelectPageArgs {
  return (
    typeof obj === "object" &&
    obj !== null &&
    typeof (obj as { tabId?: unknown }).tabId === "number"
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

// ── Tool Definitions ─────────────────────────────────────────────────────────

/**
 * Build the 6 page understanding tool definitions (4 existing + list_pages + select_page).
 *
 * Returns an array of `ExtensionToolDefinition` to be registered
 * via `bridge.registerTools('accordo-browser', tools)`.
 *
 * Each tool's handler forwards the request to the Chrome relay
 * using the provided relay instance. On success, the SnapshotEnvelope
 * embedded in the response is persisted into the retention store so
 * agents can retrieve recent snapshots without re-requesting.
 *
 * B2-SV-004: All 4 data-producing paths share the same store instance
 * with coherent per-page FIFO retention semantics.
 *
 * B2-CTX-001: All existing tools accept an optional `tabId` parameter.
 * New `browser_list_pages` and `browser_select_page` tools are included.
 *
 * @param relay — The relay connection to the Chrome extension
 * @param store — Shared snapshot retention store
 * @param security — Security configuration
 * @param screenshotStore — Optional shared screenshot retention store (GAP-G1)
 * @returns Array of 6 tool definitions
 */
export function buildPageUnderstandingTools(
  relay: BrowserRelayLike,
  store: SnapshotRetentionStore,
  security: SecurityConfig = DEFAULT_SECURITY_CONFIG,
  screenshotStore?: ScreenshotRetentionStore,
): ExtensionToolDefinition[] {
  return [
    buildGetPageMapTool(relay, store, security),
    buildInspectElementTool(relay, store, security),
    buildGetDomExcerptTool(relay, store, security),
    buildCaptureRegionTool(relay, store, security, screenshotStore),
    buildListPagesTool(relay),
    buildSelectPageTool(relay, isSelectPageArgs),
  ];
}
