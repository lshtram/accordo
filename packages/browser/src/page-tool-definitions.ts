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
import type { BrowserRelayLike, SnapshotEnvelopeFields } from "./types.js";
import { hasSnapshotEnvelope } from "./types.js";
import type { SnapshotRetentionStore } from "./snapshot-retention.js";
import type { ScreenshotRetentionStore } from "./screenshot-retention.js";
import type { SecurityConfig } from "./security/index.js";
import { DEFAULT_SECURITY_CONFIG } from "./security/index.js";

import {
  type CaptureRegionArgs,
  type CaptureRegionResponse,
  type DomExcerptResponse,
  type GetDomExcerptArgs,
  type GetPageMapArgs,
  handleCaptureRegion,
  handleGetDomExcerpt,
  handleGetPageMap,
  handleInspectElement,
  handleListPages,
  handleSelectPage,
  type InspectElementArgs,
  type InspectElementResponse,
  type ListPagesArgs,
  type ListPagesResponse,
  type PageMapResponse,
  type PageToolError,
  type SelectPageArgs,
  type SelectPageResponse,
} from "./page-tool-handlers.js";

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

/**
 * Determine anchor strategy and confidence from inspect_element args.
 * Used when relay returns raw data that lacks anchor metadata.
 */
export function resolveAnchorMetadata(args: InspectElementArgs): {
  anchorStrategy: string;
  anchorConfidence: string;
  anchorKey: string;
} {
  const { ref, selector, nodeId } = args;

  // B2-SV-006: nodeId-based lookup
  if (nodeId !== undefined) {
    return {
      anchorKey: `nodeId:${nodeId}`,
      anchorStrategy: "nodeId",
      anchorConfidence: "high",
    };
  }

  // Use selector if available
  const target = selector ?? ref ?? "";

  // id-based: selector is "#something" or ref targets an id element
  if (selector?.startsWith("#")) {
    const id = selector.slice(1);
    return {
      anchorKey: `id:${id}`,
      anchorStrategy: "id",
      anchorConfidence: "high",
    };
  }

  // data-testid based
  if (selector?.includes("data-testid")) {
    const match = /data-testid=['"]([^'"]+)['"]/.exec(selector);
    const testid = match ? match[1] : selector;
    return {
      anchorKey: `data-testid:${testid}`,
      anchorStrategy: "data-testid",
      anchorConfidence: "high",
    };
  }

  // aria-label based
  if (selector?.includes("aria-label")) {
    return {
      anchorKey: `aria:${selector}`,
      anchorStrategy: "aria",
      anchorConfidence: "high",
    };
  }

  // body element — use viewport-pct (lowest confidence, last fallback)
  if (selector === "body" || target === "body") {
    return {
      anchorKey: "viewport-pct:50x50",
      anchorStrategy: "viewport-pct",
      anchorConfidence: "low",
    };
  }

  // ref-based: use id strategy (ref implies element was found via page map with id)
  if (ref) {
    return {
      anchorKey: `id:${ref}`,
      anchorStrategy: "id",
      anchorConfidence: "high",
    };
  }

  // css-path fallback
  return {
    anchorKey: `css:${target}`,
    anchorStrategy: "css-path",
    anchorConfidence: "medium",
  };
}

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
 * with coherent 5-slot per-page FIFO retention semantics.
 *
 * B2-CTX-001: All existing tools accept an optional `tabId` parameter.
 * New `browser_list_pages` and `browser_select_page` tools are included.
 *
 * @param relay — The relay connection to the Chrome extension
 * @param store — Shared snapshot retention store (5-slot FIFO per page)
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
    {
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
          roles: {
            type: "array",
            items: { type: "string" },
            description: "B2-FI-003: Filter by ARIA role(s) — implicit mapping included (e.g. h1–h6 → heading)",
          },
          textMatch: { type: "string", description: "B2-FI-004: Filter by text content substring (case-insensitive)" },
          selector: { type: "string", description: "B2-FI-005: Filter by CSS selector" },
          regionFilter: {
            type: "object",
            description: "B2-FI-006: Filter by bounding box region (viewport coordinates)",
            properties: {
              x: { type: "number" },
              y: { type: "number" },
              width: { type: "number" },
              height: { type: "number" },
            },
            required: ["x", "y", "width", "height"],
          },
          piercesShadow: {
            type: "boolean",
            description: "B2-VD-001..004: Traverse open shadow roots and annotate closed hosts. Default: false",
          },
          traverseFrames: {
            type: "boolean",
            description: "B2-VD-005..009: Enumerate top-level iframes and return metadata (frameId, src, bounds, sameOrigin). Child-frame DOM traversal NOT included — this feature only. Default: false",
          },
          frameFilter: {
            type: "array",
            items: {
              type: "string",
              enum: ["content", "ad", "widget", "unknown"],
            },
            description: "A4: Filter iframes by classification. Only iframes matching one of the specified types are returned. Requires traverseFrames: true.",
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
          redactPII: {
            type: "boolean",
            description: "I1-text: When true, scan text content for PII and replace with [REDACTED].",
          },
          offset: {
            type: "number",
            description: "Pagination offset — 0-based index of first node to return (default: 0).",
          },
          limit: {
            type: "number",
            description: "Pagination limit — max nodes to return (default: effective cap = min(maxNodes ?? 200, 500)).",
          },
        },
      },
      dangerLevel: "safe",
      idempotent: true,
      handler: (args) => handleGetPageMap(relay, args as GetPageMapArgs, store, security),
    },
    {
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
          redactPII: {
            type: "boolean",
            description: "I1-text: When true, scan text content for PII and replace with [REDACTED].",
          },
        },
      },
      dangerLevel: "safe",
      idempotent: true,
      handler: (args) => handleInspectElement(relay, args as InspectElementArgs, store, security),
    },
    {
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
          redactPII: {
            type: "boolean",
            description: "I1-text: When true, scan text content for PII and replace with [REDACTED].",
          },
        },
      },
      dangerLevel: "safe",
      idempotent: true,
      handler: (args) => handleGetDomExcerpt(relay, args as unknown as GetDomExcerptArgs, store, security),
    },
    {
      name: "accordo_browser_capture_region",
      description: "Capture a cropped screenshot of a specific element or region. Supports viewport mode (mode='viewport'), full-page mode (mode='fullPage'), and region mode (default — requires anchorKey, nodeRef, or rect). Screenshots are returned inline as base64 data URLs. Successful responses include artifactMode: \"inline\" in the response to advertise this contract (MCP checklist §3.1). Use format='png' for lossless output. Use format='webp' for smaller files.",
      inputSchema: {
        type: "object",
        properties: {
          tabId: { type: "number", description: "B2-CTX-001: Optional tab ID to target; omit for active tab" },
          anchorKey: { type: "string", description: "Anchor key identifying target element" },
          nodeRef: { type: "string", description: "Node ref from page map" },
          rect: {
            type: "object",
            description: "Explicit viewport-relative rectangle",
            properties: {
              x: { type: "number" },
              y: { type: "number" },
              width: { type: "number" },
              height: { type: "number" },
            },
          },
          padding: { type: "number", description: "Padding around element (default 8)" },
          quality: { type: "number", description: "JPEG quality 1-100 (default 70)" },
          mode: {
            type: "string",
            enum: ["viewport", "fullPage"],
            description: "GAP-E2 / MCP-VC-001..003: Capture mode. 'viewport' captures the visible area; 'fullPage' captures the entire scrollable page. Default (omitted) = region capture — requires anchorKey, nodeRef, or rect.",
          },
          format: { type: "string", enum: ["jpeg", "png", "webp"], description: "GAP-E1 / MCP-VC-004 / E4: Output image format — 'jpeg' (default), 'png', or 'webp'" },
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
          transport: {
            type: "string",
            enum: ["inline", "file-ref"],
            description:
              "G6: Artifact transport mode. 'file-ref' (default): screenshot saved to ~/.accordo/screenshots/ and returned by fileUri + filePath instead of inline data. 'inline': base64 data URL returned in dataUrl — opt in explicitly to avoid large payloads.",
          },
          redactPII: {
            type: "boolean",
            description:
              "I1-text: When true, scan text content for PII and replace with [REDACTED]. When false, suppress PII redaction even if global policy has patterns. When omitted, honour the global redaction policy. MCP-SEC-002.",
          },
        },
      },
      dangerLevel: "safe",
      idempotent: true,
      handler: (args) => handleCaptureRegion(relay, args as CaptureRegionArgs, store, security, screenshotStore),
    },
    {
      name: "accordo_browser_list_pages",
      description: "List all open browser tabs/pages with their tabId, url, title, and active state.",
      inputSchema: {
        type: "object",
        properties: {
          tabId: { type: "number", description: "Optional tab ID (unused; reserved for future filtering)" },
        },
      },
      dangerLevel: "safe",
      idempotent: true,
      handler: (args) => handleListPages(relay, args as ListPagesArgs),
    },
    {
      name: "accordo_browser_select_page",
      description: "Select (activate) a browser tab by its tabId.",
      inputSchema: {
        type: "object",
        required: ["tabId"],
        properties: {
          tabId: { type: "number", description: "The tab ID to activate." },
        },
      },
      dangerLevel: "safe",
      idempotent: true,
      handler: (args) => {
        if (!isSelectPageArgs(args)) return Promise.resolve({ success: false, error: "invalid-request", pageUrl: null });
        return handleSelectPage(relay, args);
      },
    },
  ];
}
