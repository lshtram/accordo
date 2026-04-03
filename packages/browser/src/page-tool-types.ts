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
  /** B2-CTX-001: Optional tab ID to target; omit for active tab */
  tabId?: number;
  /** Element reference from page map (ref field) */
  ref?: string;
  /** CSS selector to find the element (alternative to ref) */
  selector?: string;
  /** B2-SV-006: Stable node ID from a page map snapshot (alternative to ref/selector) */
  nodeId?: number;
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
}

/** Input for browser_get_semantic_graph (inlined for multi-tab support) */
export interface GetSemanticGraphArgs {
  /** B2-CTX-001: Optional tab ID to target; omit for active tab */
  tabId?: number;
  maxDepth?: number;
  visibleOnly?: boolean;
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

/** Response from browser_list_pages (B2-CTX-001) */
export interface ListPagesResponse {
  pages: { tabId: number; url: string; title: string; active: boolean }[];
}

/** Response from browser_select_page (B2-CTX-001) */
export interface SelectPageResponse {
  success: boolean;
  error?: string;
}

// ── Capture Result Types ─────────────────────────────────────────────────────

export type CaptureError =
  | "element-not-found"
  | "element-off-screen"
  | "image-too-large"
  | "capture-failed"
  | "no-target"
  | "browser-not-connected"
  | "timeout";

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
