import type { SnapshotEnvelopeFields } from "./types.js";

export const PAGE_MAP_DEFAULT_MAX_NODES = 200;
export const PAGE_MAP_MAX_NODES = 500;

export interface GetPageMapArgs {
  tabId?: number;
  maxDepth?: number;
  maxNodes?: number;
  includeBounds?: boolean;
  viewportOnly?: boolean;
  offset?: number;
  limit?: number;
  visibleOnly?: boolean;
  interactiveOnly?: boolean;
  roles?: string[];
  textMatch?: string;
  selector?: string;
  regionFilter?: { x: number; y: number; width: number; height: number };
  piercesShadow?: boolean;
  traverseFrames?: boolean;
  frameFilter?: Array<"content" | "ad" | "widget" | "unknown">;
  allowedOrigins?: string[];
  deniedOrigins?: string[];
  redactPII?: boolean;
}

/**
 * Public contract for a single node in a page-map response.
 *
 * Matches the actual runtime payload produced by the browser-extension
 * content script (page-map-passed-node.ts + page-map-types.ts).
 *
 * Fields NOT in this type are NOT returned by runtime and must not be
 * claimed in tool descriptions or tests:
 *   - readingOrderIndex  (text-map only)
 *   - per-node visibility / states  (not emitted by page-map builder)
 *   - accessibleName / textContent  (use `name` / `text` instead)
 *   - bbox  (use `bounds` instead)
 */
export interface PageMapNode {
  /** Frame-scoped stable reference for click/type operations (format: "{frameId}:{nodeId}"). */
  uid?: string;
  /**
   * Stable element reference used as an idempotency key by inspect_element.
   * Present in the runtime payload; agents should prefer `uid` for cross-frame
   * targeting but `ref` is available for single-frame lookups.
   */
  ref?: string;
  /** HTML tag name in lowercase. */
  tag: string;
  /** Monotonically increasing node index within the snapshot. */
  nodeId: number;
  /** Persistent content-derived identifier (stable across snapshots of same DOM). */
  persistentId?: string;
  /** Element id attribute, if present. */
  id?: string;
  /** Explicit role attribute value, if set (role="" is not emitted). */
  role?: string;
  /** Computed accessible name, if non-empty. */
  name?: string;
  /** Direct text content of the element's child text nodes, trimmed. */
  text?: string;
  /** Subset of element attributes relevant for UI identification. */
  attrs?: Record<string, string>;
  /** Bounding box in viewport coordinates. Present only when includeBounds=true. */
  bounds?: { x: number; y: number; width: number; height: number };
  /**
   * Intersection ratio of the node's bounds with the viewport.
   * Present only when includeBounds=true.
   */
  viewportRatio?: number;
  /**
   * nodeId of the nearest containing positioned/stacked ancestor.
   * Present only when includeBounds=true and a container is found.
   */
  containerId?: number;
  /** Computed zIndex, if the element establishes a stacking context. */
  zIndex?: number;
  /** True when the element establishes a stacking context. */
  isStacked?: boolean;
  /** True when the node is occluded by another element at its centre point. */
  occluded?: boolean;
  /** True when the element is inside a shadow root. */
  inShadowRoot?: true;
  /** The shadowRoot.state value when the node is a shadow host with a closed root. */
  shadowRoot?: "closed";
  /** nodeId of the shadow host that contains this node. */
  shadowHostId?: number;
  /** Recursive child nodes, present only when depth < maxDepth and children exist. */
  children?: PageMapNode[];
}

export interface PageMapResponse extends SnapshotEnvelopeFields {
  pageUrl: string;
  title: string;
  nodes: PageMapNode[];
  totalElements: number;
  truncated: boolean;
  filterSummary?: {
    activeFilters: string[];
    totalBeforeFilter: number;
    totalAfterFilter: number;
    reductionRatio: number;
  };
  iframes?: readonly IframeMetadata[];
  auditId?: string;
  redactionApplied?: boolean;
  redactionWarning?: string;
  hasMore?: boolean;
  nextOffset?: number;
  totalAvailable?: number;
}

export interface IframeMetadata {
  frameId: string;
  src: string;
  bounds: { x: number; y: number; width: number; height: number };
  sameOrigin: boolean;
  parentFrameId: string | null;
  title?: string;
  depth: number;
  classification: "content" | "ad" | "widget" | "unknown";
  visible: boolean;
}
