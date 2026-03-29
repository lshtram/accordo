/**
 * M91-PU + M91-CR — Page Understanding MCP Tools
 *
 * Defines and registers 4 MCP tools that give AI agents the ability
 * to inspect live browser pages:
 *   - browser_get_page_map — structured DOM summary
 *   - browser_inspect_element — deep element inspection
 *   - browser_get_dom_excerpt — sanitized HTML fragment
 *   - browser_capture_region — cropped viewport screenshot of a specific element or rect
 *
 * Each tool forwards its request through the browser relay to the
 * Chrome extension's content script, which has live DOM access.
 *
 * Implements requirements PU-F-50 through PU-F-55, CR-F-01 through CR-F-12.
 *
 * @module
 */

import type { ExtensionToolDefinition } from "@accordo/bridge-types";
import type { BrowserRelayLike, SnapshotEnvelopeFields } from "./types.js";
import { hasSnapshotEnvelope } from "./types.js";
import type { SnapshotRetentionStore } from "./snapshot-retention.js";

// ── Tool Input Types ─────────────────────────────────────────────────────────

/** Input for browser_get_page_map */
export interface GetPageMapArgs {
  /** Maximum DOM tree depth to walk (default: 4, max: 8) */
  maxDepth?: number;
  /** Maximum number of nodes to include (default: 200, max: 500) */
  maxNodes?: number;
  /** Include bounding box coordinates for each node (default: false) */
  includeBounds?: boolean;
  /** Filter to only visible elements in current viewport (default: false) */
  viewportOnly?: boolean;

  // ── M102-FILT: Server-Side Filter Parameters (B2-FI-001..008) ──────────

  /**
   * B2-FI-001: When true, only elements whose bounding box intersects the
   * current viewport are returned.
   */
  visibleOnly?: boolean;

  /**
   * B2-FI-002: When true, only interactive elements (buttons, links, inputs,
   * selects, textareas, elements with click handlers, [role="button"],
   * [contenteditable]) are returned.
   */
  interactiveOnly?: boolean;

  /**
   * B2-FI-003: Filter by ARIA role(s). Only elements matching any of the
   * specified roles are returned. Supports implicit role mapping
   * (e.g., h1–h6 → "heading").
   */
  roles?: string[];

  /**
   * B2-FI-004: Filter by text content substring (case-insensitive).
   * Only elements containing the substring in their text content are returned.
   */
  textMatch?: string;

  /**
   * B2-FI-005: Filter by CSS selector. Only elements matching the selector
   * are returned. Invalid selectors are silently ignored.
   */
  selector?: string;

  /**
   * B2-FI-006: Filter by bounding box region (viewport coordinates).
   * Only elements whose bounding box intersects the region are returned.
   */
  regionFilter?: { x: number; y: number; width: number; height: number };
}

/**
 * Input for browser_inspect_element.
 *
 * B2-SV-006: Supports lookup by `nodeId` from a page map snapshot, in addition
 * to `ref` (opaque element reference) and `selector` (CSS selector).
 */
export interface InspectElementArgs {
  /** Element reference from page map (ref field) */
  ref?: string;
  /** CSS selector to find the element (alternative to ref) */
  selector?: string;
  /** B2-SV-006: Stable node ID from a page map snapshot (alternative to ref/selector) */
  nodeId?: number;
}

/** Input for browser_get_dom_excerpt */
export interface GetDomExcerptArgs {
  /** CSS selector for the root element */
  selector: string;
  /** Maximum depth of the excerpt (default: 3) */
  maxDepth?: number;
  /** Maximum character length of the HTML output (default: 2000) */
  maxLength?: number;
}

/** Input for browser_capture_region (M91-CR) */
export interface CaptureRegionArgs {
  /** Anchor key identifying the target element (from inspect_element) */
  anchorKey?: string;
  /** Node ref from page map (ref field) */
  nodeRef?: string;
  /** Explicit viewport-relative rectangle (fallback when no element target) */
  rect?: { x: number; y: number; width: number; height: number };
  /** Padding around the element bounding box in px (default: 8, max: 100) */
  padding?: number;
  /** JPEG quality 1–100 (default: 70, clamped to 30–85) */
  quality?: number;
}

// ── Capture Result Types ─────────────────────────────────────────────────────

type CaptureError =
  | "element-not-found"
  | "element-off-screen"
  | "image-too-large"
  | "capture-failed"
  | "no-target"
  | "browser-not-connected"
  | "timeout";

// ── Tool Timeouts ────────────────────────────────────────────────────────────

/** Page map can be slow on large pages */
const PAGE_MAP_TIMEOUT_MS = 10_000;
/** Element inspection should be fast */
const INSPECT_TIMEOUT_MS = 5_000;
/** DOM excerpt should be fast */
const EXCERPT_TIMEOUT_MS = 5_000;
/** Region capture includes a full-viewport screenshot + crop */
const CAPTURE_REGION_TIMEOUT_MS = 5_000;

// ── Tool Definitions ─────────────────────────────────────────────────────────

/**
 * Build the 4 page understanding tool definitions.
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
 * @param relay — The relay connection to the Chrome extension
 * @param store — Shared snapshot retention store (5-slot FIFO per page)
 * @returns Array of 4 tool definitions
 */
export function buildPageUnderstandingTools(
  relay: BrowserRelayLike,
  store: SnapshotRetentionStore,
): ExtensionToolDefinition[] {
  return [
    {
      name: "browser_get_page_map",
      description: "Collect a structured page map from the current document",
      inputSchema: {
        type: "object",
        properties: {
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
        },
      },
      dangerLevel: "safe",
      idempotent: true,
      handler: (args) => handleGetPageMap(relay, args as GetPageMapArgs, store),
    },
    {
      name: "browser_inspect_element",
      description: "Deep inspection of a specific DOM element",
      inputSchema: {
        type: "object",
        properties: {
          ref: { type: "string", description: "Element reference from page map" },
          selector: { type: "string", description: "CSS selector to find element" },
          nodeId: { type: "number", description: "B2-SV-006: Stable node ID from a page map snapshot" },
        },
      },
      dangerLevel: "safe",
      idempotent: true,
      handler: (args) => handleInspectElement(relay, args as InspectElementArgs, store),
    },
    {
      name: "browser_get_dom_excerpt",
      description: "Get a sanitized HTML excerpt for a DOM subtree",
      inputSchema: {
        type: "object",
        required: ["selector"],
        properties: {
          selector: { type: "string", description: "CSS selector for the root element" },
          maxDepth: { type: "number", description: "Maximum depth (default 3)" },
          maxLength: { type: "number", description: "Maximum character length (default 2000)" },
        },
      },
      dangerLevel: "safe",
      idempotent: true,
      handler: (args) => handleGetDomExcerpt(relay, args as unknown as GetDomExcerptArgs, store),
    },
    {
      name: "browser_capture_region",
      description: "Capture a cropped screenshot of a specific element or region",
      inputSchema: {
        type: "object",
        properties: {
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
        },
      },
      dangerLevel: "safe",
      idempotent: true,
      handler: (args) => handleCaptureRegion(relay, args as CaptureRegionArgs, store),
    },
  ];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Classify relay error messages into structured error codes */
function classifyRelayError(err: unknown): "timeout" | "browser-not-connected" {
  if (err instanceof Error) {
    if (err.message.includes("not-connected") || err.message.includes("disconnected")) {
      return "browser-not-connected";
    }
    return "timeout";
  }
  return "timeout";
}

/**
 * Determine anchor strategy and confidence from inspect_element args.
 * Used when relay returns raw data that lacks anchor metadata.
 */
function resolveAnchorMetadata(args: InspectElementArgs): {
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

// ── Typed Response Contracts ─────────────────────────────────────────────────

/**
 * B2-SV-003: Typed response for page map — includes SnapshotEnvelope fields.
 * The content script populates all envelope fields; this type enforces the
 * contract at the browser package boundary.
 */
export interface PageMapResponse extends SnapshotEnvelopeFields {
  pageUrl: string;
  title: string;
  nodes: unknown[];
  totalElements: number;
  depth: number;
  truncated: boolean;

  /**
   * B2-FI-007/008: Summary of applied filters and their effect.
   * Present only when at least one filter parameter was provided.
   */
  filterSummary?: {
    activeFilters: string[];
    totalBeforeFilter: number;
    totalAfterFilter: number;
    reductionRatio: number;
  };
}

/** Error response from page understanding tools. */
export interface PageToolError {
  success: false;
  error: string;
  pageUrl?: null;
  found?: false;
}

/**
 * B2-SV-003: Typed response for element inspection — includes SnapshotEnvelope.
 */
export interface InspectElementResponse extends SnapshotEnvelopeFields {
  found: boolean;
  anchorKey?: string;
  anchorStrategy?: string;
  anchorConfidence?: string;
  element?: Record<string, unknown>;
  context?: Record<string, unknown>;
  visibilityConfidence?: string;
}

/**
 * B2-SV-003: Typed response for DOM excerpt — includes SnapshotEnvelope.
 */
export interface DomExcerptResponse extends SnapshotEnvelopeFields {
  found: boolean;
  html?: string;
  text?: string;
  nodeCount?: number;
  truncated?: boolean;
}

/**
 * B2-SV-003: Typed response for capture region — includes SnapshotEnvelope.
 */
export interface CaptureRegionResponse extends SnapshotEnvelopeFields {
  success: boolean;
  dataUrl?: string;
  width?: number;
  height?: number;
  sizeBytes?: number;
  /** Anchor source identifier (anchorKey, nodeRef, or "rect") */
  anchorSource?: string;
  error?: CaptureError;
}

// ── Individual Tool Handlers (called by tool definitions) ────────────────────

/**
 * Handler for browser_get_page_map.
 *
 * Forwards to the Chrome relay's `get_page_map` action and returns
 * the structured page map result.
 *
 * B2-SV-003: The canonical SnapshotEnvelope (pageId, frameId, snapshotId,
 * capturedAt, viewport, source) is embedded inside `response.data` by the
 * content script. This handler validates the envelope is present before
 * returning the data.
 *
 * B2-SV-004: On success the envelope is persisted into the shared retention
 * store so agents can retrieve recent snapshots without re-requesting.
 *
 * @see PU-F-50, PU-F-53, PU-F-54, PU-F-55
 */
export async function handleGetPageMap(
  relay: BrowserRelayLike,
  args: GetPageMapArgs,
  store: SnapshotRetentionStore,
): Promise<PageMapResponse | PageToolError> {
  if (!relay.isConnected()) {
    return { success: false, error: "browser-not-connected", pageUrl: null };
  }

  try {
    const response = await relay.request("get_page_map", args as Record<string, unknown>, PAGE_MAP_TIMEOUT_MS);
    if (
      response.success &&
      response.data &&
      typeof response.data === "object" &&
      "pageUrl" in response.data &&
      hasSnapshotEnvelope(response.data)
    ) {
      store.save(response.data.pageId, response.data);
      return response.data as PageMapResponse;
    }
    return { success: false, error: "action-failed", pageUrl: null };
  } catch (err: unknown) {
    return { success: false, error: classifyRelayError(err), pageUrl: null };
  }
}

/**
 * Handler for browser_inspect_element.
 *
 * Forwards to the Chrome relay's `inspect_element` action and returns
 * the detailed element inspection result.
 *
 * B2-SV-003: The canonical SnapshotEnvelope is embedded inside `response.data`
 * by the content script. This handler validates the envelope before returning.
 *
 * B2-SV-004: On success the envelope is persisted into the shared retention store.
 *
 * B2-SV-006: Supports lookup by `nodeId` from a page map snapshot.
 *
 * @see PU-F-51, PU-F-53, PU-F-54, PU-F-55
 */
export async function handleInspectElement(
  relay: BrowserRelayLike,
  args: InspectElementArgs,
  store: SnapshotRetentionStore,
): Promise<InspectElementResponse | PageToolError> {
  if (!relay.isConnected()) {
    return { success: false, error: "browser-not-connected", found: false };
  }

  try {
    const response = await relay.request(
      "inspect_element",
      args as Record<string, unknown>,
      INSPECT_TIMEOUT_MS,
    );
    if (
      response.success &&
      response.data &&
      typeof response.data === "object" &&
      "found" in response.data &&
      hasSnapshotEnvelope(response.data)
    ) {
      store.save(response.data.pageId, response.data);
      return response.data as InspectElementResponse;
    }
    return { success: false, error: "action-failed", found: false };
  } catch (err: unknown) {
    return { success: false, error: classifyRelayError(err), found: false };
  }
}

/**
 * Handler for browser_get_dom_excerpt.
 *
 * Forwards to the Chrome relay's `get_dom_excerpt` action and returns
 * the sanitized HTML fragment.
 *
 * B2-SV-003: The canonical SnapshotEnvelope is embedded inside `response.data`
 * by the content script. This handler validates the envelope before returning.
 *
 * B2-SV-004: On success the envelope is persisted into the shared retention store.
 *
 * @see PU-F-52, PU-F-53, PU-F-54, PU-F-55
 */
export async function handleGetDomExcerpt(
  relay: BrowserRelayLike,
  args: GetDomExcerptArgs,
  store: SnapshotRetentionStore,
): Promise<DomExcerptResponse | PageToolError> {
  if (!relay.isConnected()) {
    return { success: false, error: "browser-not-connected", found: false };
  }

  try {
    const response = await relay.request(
      "get_dom_excerpt",
      args as unknown as Record<string, unknown>,
      EXCERPT_TIMEOUT_MS,
    );
    if (
      response.success &&
      response.data &&
      typeof response.data === "object" &&
      "found" in response.data &&
      hasSnapshotEnvelope(response.data)
    ) {
      store.save(response.data.pageId, response.data);
      return response.data as DomExcerptResponse;
    }
    return { success: false, error: "action-failed", found: false };
  } catch (err: unknown) {
    return { success: false, error: classifyRelayError(err), found: false };
  }
}

/**
 * Handler for browser_capture_region (M91-CR).
 *
 * Forwards to the Chrome relay's `capture_region` action. The content
 * script resolves the target element to viewport-relative bounds, the
 * service worker captures `captureVisibleTab()` and crops using
 * `OffscreenCanvas`, then returns the cropped JPEG data URL.
 *
 * B2-SV-003: The relay embeds the SnapshotEnvelope (sourced from the content
 * script) in the capture response. This handler validates its presence,
 * consistent with the other 3 data-producing tool handlers.
 *
 * B2-SV-004: On success the envelope is persisted into the shared retention store.
 *
 * @see CR-F-01, CR-F-08, CR-F-11, CR-F-12
 */
export async function handleCaptureRegion(
  relay: BrowserRelayLike,
  args: CaptureRegionArgs,
  store: SnapshotRetentionStore,
): Promise<CaptureRegionResponse | PageToolError> {
  if (!relay.isConnected()) {
    return { success: false, error: "browser-not-connected" };
  }

  try {
    const response = await relay.request(
      "capture_region",
      args as Record<string, unknown>,
      CAPTURE_REGION_TIMEOUT_MS,
    );
    if (
      response.success &&
      response.data &&
      typeof response.data === "object" &&
      "success" in response.data &&
      hasSnapshotEnvelope(response.data)
    ) {
      store.save(response.data.pageId, response.data);
      return response.data as CaptureRegionResponse;
    }
    return { success: false, error: "action-failed" };
  } catch (err: unknown) {
    return { success: false, error: classifyRelayError(err) };
  }
}
