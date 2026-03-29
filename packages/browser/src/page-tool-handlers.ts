/**
 * M91-PU + M91-CR — Page Tool Handlers
 *
 * All handler functions that forward requests through the browser relay
 * to the Chrome extension's content script.
 *
 * @module
 */

import type { BrowserRelayLike, SnapshotEnvelopeFields } from "./types.js";
import { hasSnapshotEnvelope } from "./types.js";
import type { SnapshotRetentionStore } from "./snapshot-retention.js";

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

// ── Tool Handlers ─────────────────────────────────────────────────────────────

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

/**
 * Handler for browser_wait_for (inlined into buildPageUnderstandingTools).
 */
export async function handleWaitForInline(
  relay: BrowserRelayLike,
  args: WaitForArgs,
): Promise<unknown> {
  if (!relay.isConnected()) {
    return { success: false, error: "browser-not-connected" };
  }
  try {
    const response = await relay.request("wait_for", args as Record<string, unknown>, WAIT_FOR_RELAY_TIMEOUT_MS);
    if (response.success && response.data !== undefined) {
      return response.data;
    }
    const errCode = response.error ?? "timeout";
    if (errCode === "navigation-interrupted" || errCode === "page-closed") {
      return { met: false, error: errCode, elapsedMs: 0 };
    }
    return response.data ?? { met: false, error: "timeout", elapsedMs: 0 };
  } catch (err: unknown) {
    return { success: false, error: classifyRelayError(err) };
  }
}

/**
 * Handler for browser_get_text_map (inlined into buildPageUnderstandingTools).
 */
export async function handleGetTextMapInline(
  relay: BrowserRelayLike,
  args: GetTextMapArgs,
  store: SnapshotRetentionStore,
): Promise<unknown> {
  if (!relay.isConnected()) {
    return { success: false, error: "browser-not-connected" };
  }
  try {
    const response = await relay.request("get_text_map", args as Record<string, unknown>, TEXT_MAP_TIMEOUT_MS);
    if (!response.success || response.data === undefined) {
      return { success: false, error: response.error ?? "action-failed" };
    }
    if (hasSnapshotEnvelope(response.data)) {
      store.save(response.data.pageId, response.data);
    }
    return response.data;
  } catch (err: unknown) {
    return { success: false, error: classifyRelayError(err) };
  }
}

/**
 * Handler for browser_get_semantic_graph (inlined into buildPageUnderstandingTools).
 */
export async function handleGetSemanticGraphInline(
  relay: BrowserRelayLike,
  args: GetSemanticGraphArgs,
  store: SnapshotRetentionStore,
): Promise<unknown> {
  if (!relay.isConnected()) {
    return { success: false, error: "browser-not-connected" };
  }
  try {
    const payload: Record<string, unknown> = {};
    if (args.tabId !== undefined) payload["tabId"] = args.tabId;
    if (args.maxDepth !== undefined) payload["maxDepth"] = args.maxDepth;
    if (args.visibleOnly !== undefined) payload["visibleOnly"] = args.visibleOnly;

    const response = await relay.request("get_semantic_graph", payload, SEMANTIC_GRAPH_TIMEOUT_MS);
    if (!response.success || response.data === undefined) {
      return { success: false, error: response.error ?? "action-failed" };
    }
    if (hasSnapshotEnvelope(response.data)) {
      store.save(response.data.pageId, response.data as SnapshotEnvelopeFields);
    }
    return response.data;
  } catch (err: unknown) {
    return { success: false, error: classifyRelayError(err) };
  }
}

/**
 * Handler for browser_list_pages (B2-CTX-001).
 * Forwards to relay's "list_pages" action.
 */
export async function handleListPages(
  relay: BrowserRelayLike,
  args: ListPagesArgs,
): Promise<ListPagesResponse | PageToolError> {
  if (!relay.isConnected()) {
    return { success: false, error: "browser-not-connected", pageUrl: null };
  }
  try {
    const response = await relay.request("list_pages", args as Record<string, unknown>, TAB_MGMT_TIMEOUT_MS);
    if (response.success && response.data && typeof response.data === "object" && "pages" in response.data) {
      return response.data as ListPagesResponse;
    }
    return { success: false, error: "action-failed", pageUrl: null };
  } catch (err: unknown) {
    return { success: false, error: classifyRelayError(err), pageUrl: null };
  }
}

/**
 * Handler for browser_select_page (B2-CTX-001).
 * Forwards to relay's "select_page" action.
 */
export async function handleSelectPage(
  relay: BrowserRelayLike,
  args: SelectPageArgs,
): Promise<SelectPageResponse | PageToolError> {
  if (!relay.isConnected()) {
    return { success: false, error: "browser-not-connected", pageUrl: null };
  }
  try {
    const response = await relay.request("select_page", args as unknown as Record<string, unknown>, TAB_MGMT_TIMEOUT_MS);
    if (response.success) {
      return { success: true };
    }
    return { success: false, error: response.error ?? "action-failed", pageUrl: null };
  } catch (err: unknown) {
    return { success: false, error: classifyRelayError(err), pageUrl: null };
  }
}
