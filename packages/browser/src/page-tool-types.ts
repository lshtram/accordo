/**
 * M91-PU + M91-CR — Page Tool Types
 *
 * All exported interface types, response contracts, error codes,
 * timeout constants, and the `classifyRelayError` helper.
 *
 * This module has NO runtime dependencies on BrowserRelayLike.
 *
 * @module
 */

import type { SnapshotEnvelopeFields } from "./types.js";

// ── Tool Input Types ─────────────────────────────────────────────────────────

/** Input for browser_get_page_map */
export interface GetPageMapArgs {
  /** B2-CTX-001: Optional tab ID to target; omit for active tab */
  tabId?: number;
  /** Maximum DOM tree depth to walk (default: 4, max: 8) */
  maxDepth?: number;
  /** Maximum number of nodes to include (default: 200, max: 500) */
  maxNodes?: number;
  /** Include bounding box coordinates for each node (default: false) */
  includeBounds?: boolean;
  /** Filter to only visible elements in current viewport (default: false) */
  viewportOnly?: boolean;

  // ── Pagination (PAG-01) ─────────────────────────────────────────────────

  /** Pagination offset — 0-based index of first node to return (default: 0). */
  offset?: number;
  /** Pagination limit — maximum nodes to return (default: effective cap = min(maxNodes ?? 200, 500)). */
  limit?: number;

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

  /** B2-VD-001..004: Traverse open shadow roots and annotate closed hosts. Default: false. */
  piercesShadow?: boolean;

  /** B2-VD-005..009: Enumerate top-level iframes and return metadata (frameId, src, bounds, sameOrigin).
   * Child-frame DOM stitching is NOT included in this feature.
   * Default: false. */
  traverseFrames?: boolean;

  /**
   * A4: Filter returned iframes by classification.
   * When provided, only iframes matching one of the specified classifications
   * are included in the `iframes[]` array. Requires `traverseFrames: true`.
   * Example: `["content", "widget"]` to exclude ad frames.
   */
  frameFilter?: Array<"content" | "ad" | "widget" | "unknown">;

  // ── MCP-SEC: Security Parameters ──────────────────────────────────────────

  /** I2-001: Allowed origins for this request. Overrides global policy. */
  allowedOrigins?: string[];
  /** I2-001: Denied origins for this request. Overrides global policy. */
  deniedOrigins?: string[];
  /** I1-text: When true, scan text for PII and replace with [REDACTED]. MCP-SEC-002. */
  redactPII?: boolean;
}

/**
 * Input for browser_inspect_element.
 *
 * B2-SV-006: Supports lookup by `nodeId` from a page map snapshot, in addition
 * to `ref` (opaque element reference) and `selector` (CSS selector).
 */
export interface InspectElementArgs {
  /** B2-CTX-001: Optional tab ID to target; omit for active tab */
  tabId?: number;
  /** Element reference from page map (ref field) */
  ref?: string;
  /** CSS selector to find the element (alternative to ref) */
  selector?: string;
  /** B2-SV-006: Stable node ID from a page map snapshot (alternative to ref/selector) */
  nodeId?: number;
  /** F12: Target a specific iframe by its frameId from the page map's iframes[]. */
  frameId?: string;
  /** I2-001: Allowed origins for this request. Overrides global policy. */
  allowedOrigins?: string[];
  /** I2-001: Denied origins for this request. Overrides global policy. */
  deniedOrigins?: string[];
  /** I1-text: When true, scan text for PII and replace with [REDACTED]. MCP-SEC-002. */
  redactPII?: boolean;
}

/** Input for browser_get_dom_excerpt */
export interface GetDomExcerptArgs {
  /** B2-CTX-001: Optional tab ID to target; omit for active tab */
  tabId?: number;
  /** CSS selector for the root element */
  selector: string;
  /** Maximum depth of the excerpt (default: 3) */
  maxDepth?: number;
  /** Maximum character length of the HTML output (default: 2000) */
  maxLength?: number;
  /** F12: Target a specific iframe by its frameId from the page map's iframes[]. */
  frameId?: string;
  /** I2-001: Allowed origins for this request. Overrides global policy. */
  allowedOrigins?: string[];
  /** I2-001: Denied origins for this request. Overrides global policy. */
  deniedOrigins?: string[];
  /** I1-text: When true, scan text for PII and replace with [REDACTED]. MCP-SEC-002. */
  redactPII?: boolean;
}

/** Input for browser_capture_region (M91-CR) */
export interface CaptureRegionArgs {
  /** B2-CTX-001: Optional tab ID to target; omit for active tab */
  tabId?: number;
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
  /** P4-CR: Capture mode — "viewport" captures visible area, "fullPage" captures entire scrollable page.
   * When omitted, capture behaves as region mode and requires rect, anchorKey, or nodeRef.
   * When mode is "viewport" or "fullPage", rect, anchorKey, and nodeRef are ignored. */
  mode?: "viewport" | "fullPage";
  /** GAP-E1 / E4: Output format for the captured image — "jpeg" (default), "png", or "webp". */
  format?: "jpeg" | "png" | "webp";
  /** I2-001: Allowed origins for this request. Overrides global policy. */
  allowedOrigins?: string[];
  /** I2-001: Denied origins for this request. Overrides global policy. */
  deniedOrigins?: string[];
  /**
   * I1-text: When true, scan text content for PII and replace with [REDACTED].
   * When false, suppress PII redaction even if global policy has patterns.
   * When omitted, honour the global redaction policy. MCP-SEC-002.
   */
  redactPII?: boolean;
  /**
   * G6: Artifact transport mode for the captured screenshot.
   * "file-ref" (default) — writes the screenshot to disk and returns `fileUri` + `filePath` instead of inline data.
   * "inline" — returns base64 data URL in `dataUrl`. Opt in explicitly to avoid large payloads in the response.
   */
  transport?: "inline" | "file-ref";
}

/** Input for browser_wait_for (inlined from wait-tool.ts for multi-tab support) */
export interface WaitForArgs {
  /** B2-CTX-001: Optional tab ID to target; omit for active tab */
  tabId?: number;
  texts?: string[];
  selector?: string;
  stableLayoutMs?: number;
  timeout?: number;
}

/** Input for browser_get_text_map (inlined for multi-tab support) */
export interface GetTextMapArgs {
  /** B2-CTX-001: Optional tab ID to target; omit for active tab */
  tabId?: number;
  maxSegments?: number;
  /** F12: Target a specific iframe by its frameId from the page map's iframes[]. */
  frameId?: string;
  /** I1-text: When true, scan text for PII and replace with [REDACTED]. */
  redactPII?: boolean;
  /** I2-001: Allowed origins for this request. Overrides global policy. */
  allowedOrigins?: string[];
  /** I2-001: Denied origins for this request. Overrides global policy. */
  deniedOrigins?: string[];

  // ── Pagination (PAG-01) ─────────────────────────────────────────────────

  /** Pagination offset — 0-based index of first segment to return (default: 0). */
  offset?: number;
  /** Pagination limit — max segments to return (default: effective cap = min(maxSegments ?? 500, 2000)). */
  limit?: number;
}

/** Input for browser_get_semantic_graph (inlined for multi-tab support) */
export interface GetSemanticGraphArgs {
  /** B2-CTX-001: Optional tab ID to target; omit for active tab */
  tabId?: number;
  maxDepth?: number;
  visibleOnly?: boolean;
  /**
   * B2-VD-001..004: Traverse open shadow DOM trees and annotate shadow nodes.
   * Shadow children are marked with `inShadowRoot: true` and `shadowHostId`.
   * Default: false.
   */
  piercesShadow?: boolean;
  /** F12: Target a specific iframe by its frameId from the page map's iframes[]. */
  frameId?: string;
  /** I1-text: When true, scan text for PII and replace with [REDACTED]. */
  redactPII?: boolean;
  /** I2-001: Allowed origins for this request. Overrides global policy. */
  allowedOrigins?: string[];
  /** I2-001: Denied origins for this request. Overrides global policy. */
  deniedOrigins?: string[];
}

/** Input for browser_list_pages (B2-CTX-001) */
export interface ListPagesArgs {
  tabId?: number;
}

/** Input for browser_select_page (B2-CTX-001) */
export interface SelectPageArgs {
  tabId: number;
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

  /**
   * B2-VD-005..009: Iframe metadata array.
   * Present only when `traverseFrames: true` was passed to browser_get_page_map.
   * Each entry describes an `<iframe>` element's identity and position.
   * Child-frame DOM content is NOT included — same-origin iframe DOM traversal
   * requires manifest `all_frames: true` and is planned for a future feature.
   */
  iframes?: readonly IframeMetadata[];

  /** Unique audit ID for this invocation (UUIDv4). MCP-SEC-004. Set by MCP handler. */
  auditId?: string;
  /** True when PII redaction was applied to text content. MCP-SEC-002. */
  redactionApplied?: boolean;
  /** Warning when PII may be present in response. MCP-VC-005. */
  redactionWarning?: string;

  // ── Pagination (PAG-03..06) ─────────────────────────────────────────────────
  // Present only when offset or limit is explicitly provided.

  /** True if there are more nodes beyond the returned slice. */
  hasMore?: boolean;
  /** Suggested offset for the next page (offset + nodes.length). */
  nextOffset?: number;
  /** Total nodes available for pagination (post-filter, post-cap, pre-slice). */
  totalAvailable?: number;
}

/**
 * B2-VD-006 / A4: Metadata for a single `<iframe>` element in the page.
 * Emitted in the `iframes` array of `PageMapResponse` when `traverseFrames: true`.
 */
export interface IframeMetadata {
  /** Unique frame identifier (name, id, or auto-generated). */
  frameId: string;
  /** The iframe's `src` attribute (may be empty for srcdoc/about:blank). */
  src: string;
  /** Bounding box in parent viewport coordinates. */
  bounds: { x: number; y: number; width: number; height: number };
  /**
   * Whether the iframe is same-origin as the parent document.
   * - `true`: child-frame DOM is accessible to content script with `all_frames: true`.
   * - `false`: child-frame DOM is opaque due to Same-Origin Policy.
   */
  sameOrigin: boolean;

  // ── A4: Frame lineage fields ───────────────────────────────────────────────

  /**
   * A4: Frame ID of this iframe's parent frame.
   * - `null` for top-level iframes (parent is the main document).
   * - A `frameId` string for nested iframes.
   * Enables tree reconstruction from the flat `iframes[]` array.
   */
  parentFrameId: string | null;

  /**
   * A4: The iframe's `title` attribute, if present.
   * Useful for accessibility identification of frame purpose.
   */
  title?: string;

  /**
   * A4: Nesting depth relative to the top document.
   * - `1` for direct children of the main document.
   * - `2` for iframes nested inside another iframe.
   * Agents can use this to prioritize shallow frames.
   */
  depth: number;

  /**
   * A4: Heuristic classification of the iframe's likely purpose.
   * Helps agents skip ad/tracker frames and focus on content frames.
   * - `"content"` — appears to contain meaningful page content.
   * - `"ad"` — matches known ad/tracker URL patterns.
   * - `"widget"` — social media embeds, reCAPTCHA, payment forms, etc.
   * - `"unknown"` — could not be classified.
   */
  classification: "content" | "ad" | "widget" | "unknown";

  /**
   * A4: Whether this iframe is visible in the viewport.
   * Iframes with `display: none`, zero dimensions, or entirely off-screen
   * position are marked `false`. Agents can filter to visible-only frames.
   */
  visible: boolean;
}

/**
 * Structured error response from page understanding tools.
 * MCP-ER-001: All error responses are structured objects.
 * MCP-ER-002: Includes retry hints for transient errors.
 */
export interface PageToolError {
  success: false;
  /** Machine-readable error code. */
  error: string;
  /** Whether the agent should retry this operation. MCP-ER-002. */
  retryable?: boolean;
  /** Suggested delay before retry in ms. MCP-ER-002. */
  retryAfterMs?: number;
  /** Human-readable detail for diagnostics. */
  details?: string;
  /** Human-readable recovery guidance for the caller. MCP-ER-002. */
  recoveryHints?: string;
  /** Preserved for backward compatibility on specific tools. */
  pageUrl?: null;
  found?: false;
}

/**
 * B2-SV-003: Typed response for element inspection — includes SnapshotEnvelope.
 */

/**
 * F2: Typed actionability states for interactive elements.
 * Agents can check disabled/readonly without parsing untyped string arrays.
 */
export interface ElementStates {
  /** Raw state strings from the browser extension (e.g. "disabled", "readonly", "required"). */
  states?: string[];
  /** Whether the element is disabled (non-interactive). */
  disabled?: boolean;
  /** Whether the element is read-only (visible but not editable). */
  readonly?: boolean;
  /** Whether the element is required in a form context. */
  required?: boolean;
  /** Whether the element is checked (checkboxes, radio buttons). */
  checked?: boolean;
  /** Whether the element is expanded (details, comboboxes). */
  expanded?: boolean;
  /** Whether the element currently has keyboard focus. */
  focused?: boolean;
  /** Whether the element is selected (listbox options, tabs). */
  selected?: boolean;
  /** Whether the element is in an invalid/error state (form validation). */
  invalid?: boolean;
}

export interface InspectElementResponse extends SnapshotEnvelopeFields {
  found: boolean;
  anchorKey?: string;
  anchorStrategy?: string;
  anchorConfidence?: string;
  element?: Record<string, unknown> & Partial<ElementStates>;
  context?: Record<string, unknown>;
  visibilityConfidence?: string;
  /** Unique audit ID for this invocation (UUIDv4). MCP-SEC-004. Set by MCP handler. */
  auditId?: string;
  /** True when PII redaction was applied to text content. MCP-SEC-002. */
  redactionApplied?: boolean;
  /** Warning when PII may be present in response. MCP-VC-005. */
  redactionWarning?: string;
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
  /** Unique audit ID for this invocation (UUIDv4). MCP-SEC-004. Set by MCP handler. */
  auditId?: string;
  /** True when PII redaction was applied to text content. MCP-SEC-002. */
  redactionApplied?: boolean;
  /** Warning when PII may be present in response. MCP-VC-005. */
  redactionWarning?: string;
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
  /** P4-CR: Capture mode used — "viewport" or "fullPage" */
  mode?: string;
  error?: CaptureError;
  /** Unique audit ID for this capture (UUIDv4). MCP-SEC-004. Set by MCP handler. */
  auditId?: string;
  /** Warning that screenshots are not subject to redaction policy. MCP-VC-005. */
  redactionWarning?: string;
  /** GAP-E2: Links this visual capture to the most recent DOM snapshot for this page. */
  relatedSnapshotId?: string;
  /** GAP-I1: True when PII redaction was applied to the screenshot (bbox-based). */
  screenshotRedactionApplied?: boolean;
  /** GAP-I1: Number of text regions that were covered by redaction rectangles. */
  redactedSegmentCount?: number;
  /**
   * Feature 5: Artifact transport mode for binary screenshot output.
   * "inline" — screenshot returned as a base64 data URL in `dataUrl` (current, default).
   * "file-ref" — future: screenshot stored to a file and returned by reference.
   * "remote-ref" — future: screenshot uploaded to remote storage and returned by URL.
   * Present only on successful responses. Errors never include this field.
   * MCP checklist §3.1: `artifactMode` must be present when binary output exists.
   */
  artifactMode?: "inline" | "file-ref" | "remote-ref";
  /**
   * G6: Absolute file:// URI for the screenshot file (only when transport="file-ref").
   * Example: "file:///home/user/.accordo/screenshots/abc123.jpeg"
   */
  fileUri?: string;
  /**
   * G6: Absolute OS path to the screenshot file (only when transport="file-ref").
   * Example: "/home/user/.accordo/screenshots/abc123.jpeg"
   */
  filePath?: string;
  /**
   * G6: True when transport="file-ref" was requested but the file write failed,
   * causing a transparent fallback to inline transport. The dataUrl is populated
   * and artifactMode="inline" in this case.
   */
  transportFallback?: boolean;
}

/** Response from browser_list_pages (B2-CTX-001) */
export interface ListPagesResponse {
  pages: { tabId: number; url: string; title: string; active: boolean }[];
}

/** Response from browser_select_page (B2-CTX-001) */
export interface SelectPageResponse {
  success: boolean;
  error?: string;
}

// ── Spatial Relations Types (GAP-D1) ─────────────────────────────────────────

/**
 * Input for `browser_get_spatial_relations`.
 *
 * GAP-D1: Takes node IDs from a prior `get_page_map` call (with `includeBounds: true`)
 * and returns pairwise spatial relationships. Maximum 50 node IDs per request.
 */
export interface GetSpatialRelationsArgs {
  /** B2-CTX-001: Optional tab ID to target; omit for active tab */
  tabId?: number;
  /**
   * Node IDs from a prior `get_page_map` call (with `includeBounds: true`).
   * Maximum 50 IDs — pairwise computation is O(n²).
   */
  nodeIds: number[];
  /** I2-001: Allowed origins for this request. Overrides global policy. */
  allowedOrigins?: string[];
  /** I2-001: Denied origins for this request. Overrides global policy. */
  deniedOrigins?: string[];
}

/**
 * Successful response from `browser_get_spatial_relations`.
 * GAP-D1: Pairwise geometry for requested nodes.
 */
export interface SpatialRelationsResponse extends SnapshotEnvelopeFields {
  pageUrl: string;
  relations: readonly {
    sourceNodeId: number;
    targetNodeId: number;
    leftOf: boolean;
    above: boolean;
    contains: boolean;
    containedBy: boolean;
    overlap: number;
    distance: number;
  }[];
  nodeCount: number;
  pairCount: number;
  missingNodeIds?: number[];
  auditId?: string;
}

/** Relay timeout for spatial relations computation. */
export const SPATIAL_RELATIONS_TIMEOUT_MS = 10_000;

// ── Capture Result Types ─────────────────────────────────────────────────────

export type CaptureError =
  | "element-not-found"
  | "element-off-screen"
  | "image-too-large"
  | "capture-failed"
  | "no-target"
  | "browser-not-connected"
  | "timeout"
  | "origin-blocked"       // B2-ER-007: blocked by origin policy
  | "redaction-failed"     // B2-ER-008: fail-closed redaction error
  | "detached-node"        // MCP-ER-005: stale element reference (node removed from DOM)
  | "blocked-resource"     // MCP-ER-005: CORS/CSP blocked resource
  | "navigation-failed";   // MCP-ER-005: page navigation error

/** Relay-level errors (transient — retryable). MCP-ER-002. */
export type RelayError =
  | "browser-not-connected"
  | "timeout"
  | "action-failed";

/** Frame-targeting errors (permanent — not retryable). */
export type FrameError =
  | "iframe-cross-origin"
  | "no-content-script";

/** Security-related errors (permanent — not retryable). */
export type SecurityError =
  | "origin-blocked"
  | "redaction-failed";

/** Spatial-relations-specific errors (permanent — not retryable). GAP-D1. */
export type SpatialError =
  | "too-many-nodes"
  | "no-bounds";

/** All possible browser tool error codes. MCP-ER-001. */
export type BrowserToolErrorCode = CaptureError | RelayError | SecurityError | SpatialError | FrameError;

// ── Tool Timeouts ────────────────────────────────────────────────────────────

/** Page map can be slow on large pages */
export const PAGE_MAP_TIMEOUT_MS = 10_000;
/** Element inspection should be fast */
export const INSPECT_TIMEOUT_MS = 5_000;
/** DOM excerpt should be fast */
export const EXCERPT_TIMEOUT_MS = 5_000;
/** Region capture includes a full-viewport screenshot + crop */
export const CAPTURE_REGION_TIMEOUT_MS = 5_000;
/** Relay timeout for wait_for (must exceed WAIT_MAX_TIMEOUT_MS = 30000) */
export const WAIT_FOR_RELAY_TIMEOUT_MS = 35_000;
/** Relay timeout for text map */
export const TEXT_MAP_TIMEOUT_MS = 10_000;
/** Relay timeout for semantic graph */
export const SEMANTIC_GRAPH_TIMEOUT_MS = 15_000;
/** Relay timeout for list_pages / select_page */
export const TAB_MGMT_TIMEOUT_MS = 5_000;

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Classify relay error messages into structured error codes */
export function classifyRelayError(err: unknown): "timeout" | "browser-not-connected" {
  if (err instanceof Error) {
    if (err.message.includes("not-connected") || err.message.includes("disconnected")) {
      return "browser-not-connected";
    }
    return "timeout";
  }
  return "timeout";
}

// ── Retry Classification (MCP-ER-002) ────────────────────────────────────────

/** Transient errors that the agent can retry. */
const TRANSIENT_ERRORS: Record<string, number> = {
  "browser-not-connected": 2000,
  "timeout": 1000,
  "action-failed": 1000,
  "detached-node": 1000,  // MCP-ER-006: retryable — node may reappear after re-render
  "capture-failed": 2000, // MCP-ER-002: screenshot failure may be transient (tab not ready)
  "element-off-screen": 1000, // MCP-ER-002: element may scroll into view after retry
};

/** Human-readable recovery hints per error code. MCP-ER-002. */
const RECOVERY_HINTS: Record<string, string> = {
  "browser-not-connected":
    "Check that the browser relay is running and the Chrome extension is connected.",
  "timeout":
    "The operation timed out. Retry with a longer timeout or verify the page has loaded.",
  "action-failed":
    "The browser action failed. The element may have changed — take a fresh snapshot and retry.",
  "detached-node":
    "The target element was removed from the DOM. Take a new snapshot to find the updated element.",
  "capture-failed":
    "Screenshot capture failed. The tab may still be loading — wait briefly and retry.",
  "element-off-screen":
    "The element is outside the visible viewport. Scroll it into view before retrying.",
  "origin-blocked":
    "This origin is blocked by the security policy. Check allowedOrigins/deniedOrigins.",
  "invalid-request":
    "The request parameters are invalid. Check required fields and value constraints.",
};

/**
 * Build a structured error response from an error code.
 *
 * MCP-ER-001: All errors are structured objects with `success`, `error`,
 * `retryable`, and optionally `retryAfterMs` and `details`.
 *
 * MCP-ER-002: Transient errors include retry hints.
 *
 * @param errorCode — Machine-readable error code
 * @param details — Optional human-readable detail
 * @param extra — Optional extra fields (pageUrl, found) for backward compatibility
 * @returns A fully structured PageToolError
 */
export function buildStructuredError(
  errorCode: string,
  details?: string,
  extra?: { pageUrl?: null; found?: false },
): PageToolError {
  const retryable = errorCode in TRANSIENT_ERRORS;
  const retryAfterMs = retryable ? TRANSIENT_ERRORS[errorCode] : undefined;
  const recoveryHints = RECOVERY_HINTS[errorCode];

  return {
    success: false,
    error: errorCode,
    ...(retryable ? { retryable: true, retryAfterMs } : { retryable: false }),
    ...(details !== undefined ? { details } : {}),
    ...(recoveryHints !== undefined ? { recoveryHints } : {}),
    pageUrl: null,
    found: false,
  };
}
