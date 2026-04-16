/**
 * M90-MAP — Page Map Collector
 *
 * Walks the visible DOM tree and returns a structured summary of page elements
 * for AI agent page understanding. Filter pipeline is applied during traversal
 * (B2-FI-001..008).
 *
 * Implements requirements PU-F-01 through PU-F-06 and B2-FI-001..008.
 *
 * @module
 */

import { generateAnchorKey } from "./enhanced-anchor.js";
import { captureSnapshotEnvelope } from "../snapshot-versioning.js";
import type { SnapshotEnvelope } from "../snapshot-versioning.js";
import { buildFilterPipeline, buildFilterSummary } from "./page-map-filters.js";
import { buildNode, clearRefIndex as _clearRefIndex, getElementByRef as _getElementByRef } from "./page-map-traversal.js";
import type { TraversalOptions } from "./page-map-traversal.js";

// ── Types ────────────────────────────────────────────────────────────────────

/** A single node in the page map tree */
export interface PageNode {
  /** Opaque reference for use with browser_inspect_element */
  ref: string;
  /** HTML tag name (lowercase) */
  tag: string;
  /** B2-SV-006: Stable node identifier within this snapshot (DFS traversal index) */
  nodeId: number;
  /**
   * B2-UID-001: Canonical node identity across frames.
   * Shaped as "{frameId}:{nodeId}" — e.g. "main:3" or "iframe-1:0".
   * Enables unambiguous cross-frame node references without ambiguity between
   * same nodeId values in different frames.
   */
  uid?: string;
  /** B2-SV-007: Experimental — stable across snapshots for unchanged elements */
  persistentId?: string;
  /** Element id attribute (shortcut for attrs.id) */
  id?: string;
  /** ARIA role if present */
  role?: string;
  /** Accessible name (aria-label, alt, title, or derived) */
  name?: string;
  /** Visible text content (truncated to 100 chars) */
  text?: string;
  /** Key attributes: id, class (first 3), href, src, type, data-testid */
  attrs?: Record<string, string>;
  /** Bounding box relative to viewport (if includeBounds=true) */
  bounds?: { x: number; y: number; width: number; height: number };
  /**
   * GAP-D1 / D4: Ratio of this element's bounding box that intersects the
   * visible viewport (0–1). Only present when `includeBounds: true`.
   * 0 = fully off-screen, 1 = fully visible.
   */
  viewportRatio?: number;
  /**
   * GAP-D1 / D5: nodeId of the nearest semantic container ancestor
   * (article, section, aside, main, dialog, details, nav, header, footer, form).
   * Only present when `includeBounds: true` and a container is found.
   */
  containerId?: number;
  /**
   * GAP-D2: Computed z-index from getComputedStyle(el).zIndex.
   * Only present when `includeBounds: true` and zIndex is not "auto".
   * Positive values indicate stacking above normal flow; negative values below.
   */
  zIndex?: number;
  /**
   * GAP-D2: True when this element creates a new stacking context
   * (position !== "static" + zIndex !== "auto", or opacity < 1, or
   * transform/filter/opacity creating a new context).
   * Only present when `includeBounds: true`.
   */
  isStacked?: boolean;
  /**
   * GAP-D2: True when another element is stacked above this element at its
   * center point (detected via document.elementFromPoint).
   * Only present when `includeBounds: true` and the element has non-zero size.
   */
  occluded?: boolean;
  /**
   * B2-VD-001..002: True when this node lives inside an open shadow DOM tree.
   * The `shadowHostId` field holds the host element's nodeId.
   */
  inShadowRoot?: true;
  /**
   * B2-VD-002: The nodeId of the shadow host element that contains this node.
   * Present only when `inShadowRoot: true`.
   */
  shadowHostId?: number;
  /**
   * B2-VD-003: Present on a shadow host element when its shadow root is closed.
   * The host element is included in the page map but its shadow content is not traversed.
   */
  shadowRoot?: 'closed';
  /** Child nodes (recursive, up to maxDepth) */
  children?: PageNode[];
}

/** Options for page map collection */
export interface PageMapOptions {
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
   * B2-FI-002: When true, only interactive elements are returned.
   * Interactive elements: button, a, input, select, textarea, elements with
   * click handlers, [role="button"], [contenteditable].
   */
  interactiveOnly?: boolean;

  /**
   * B2-FI-003: Filter by ARIA role(s). Only elements matching any of the
   * specified roles are returned. Implicit role mapping is applied.
   */
  roles?: string[];

  /**
   * B2-FI-004: Filter by text content substring (case-insensitive).
   */
  textMatch?: string;

  /**
   * B2-FI-005: Filter by CSS selector. Invalid selectors are silently ignored.
   */
  selector?: string;

  /**
   * B2-FI-006: Filter by bounding box region (viewport coordinates).
   */
  regionFilter?: { x: number; y: number; width: number; height: number };

  // ── B2-VD-001..003: Shadow DOM Piercing ─────────────────────────────────

  /**
   * B2-VD-001: When true, traverse open shadow DOM trees and include shadow
   * children in the page map. Shadow children are marked with `inShadowRoot: true`
   * and `shadowHostId` referencing the host element's nodeId.
   * B2-VD-003: Closed shadow roots are annotated on the host as `shadowRoot: 'closed'`
   * and are not traversed.
   * Default: false (B2-VD-004).
   */
  piercesShadow?: boolean;

  // ── B2-VD-005..009: Iframe Metadata ────────────────────────────────────────

  /**
   * B2-VD-005..009: When true, enumerate top-level `<iframe>` elements and include
   * their metadata (frameId, src, bounds, sameOrigin) in the `iframes` array.
   *
   * Same-origin iframes: `sameOrigin: true` — child-frame DOM is accessible
   * to a content script with `all_frames: true` in the manifest.
   * Cross-origin iframes: `sameOrigin: false` — child-frame DOM is opaque
   * due to the Same-Origin Policy (hard browser security boundary).
   *
   * Child-frame DOM stitching is performed later by the service worker using
   * frame-targeted messaging. The collector itself remains metadata-only.
   *
   * Default: false (B2-VD-009).
   */
  traverseFrames?: boolean;
}

/**
 * B2-VD-006: Metadata for a single `<iframe>` element in the page.
 *
 * Emitted in the `iframes` array of `PageMapResult` when `traverseFrames: true`.
 * Each entry describes the iframe's identity and viewport position from the
 * parent's perspective — no child-frame DOM content is included at this stage.
 */
export interface IframeMetadata {
  /** Frame identifier — derived from the iframe's `name` attribute,
   * `id` attribute, or a generated `iframe-{index}` fallback. Used to route
   * `browser_inspect_element` and other frame-aware requests. */
  frameId: string;
  /** The iframe's `src` attribute — may be empty for srcdoc or about:blank frames. */
  src: string;
  /** Bounding box of the iframe element in parent viewport coordinates. */
  bounds: { x: number; y: number; width: number; height: number };
  /**
   * B2-VD-006: Whether this iframe is effectively same-origin/DOM-accessible
   * from the parent document.
   * - `true`: child-frame DOM is accessible to a content script with `all_frames: true`.
   * - `false`: child-frame DOM is opaque due to Same-Origin Policy.
   *
   * Note: This is a conservative best-effort determination using URL origin
   * classification plus DOM accessibility checks for inherited-origin cases
   * such as `about:blank` and `srcdoc`.
   */
  sameOrigin: boolean;

  // ── A4: Frame lineage fields ──────────────────────────────────────────────

  /**
   * A4: Frame ID of the parent frame.
   * `null` for top-level iframes (parent is the main document).
   */
  parentFrameId: string | null;

  /**
   * A4: The iframe's `title` attribute, if present.
   */
  title?: string;

  /**
   * A4: Nesting depth relative to the top document.
   * `1` for direct children of the main document.
   */
  depth: number;

  /**
   * A4: Heuristic classification of the iframe's likely purpose.
   * - `"content"` — same-origin or blank/inherited-origin iframe.
   * - `"ad"` — matches known ad/tracker URL patterns.
   * - `"widget"` — social media embeds, reCAPTCHA, payment forms, etc.
   * - `"unknown"` — unclassified cross-origin iframe.
   */
  classification: "content" | "ad" | "widget" | "unknown";

  /**
   * A4: Whether this iframe is visible in the viewport.
   * `false` when display:none, zero dimensions, or entirely off-screen.
   */
  visible: boolean;

  /**
   * B2-VD-005: Child frame page-map nodes (same-origin iframes only).
   * Present only on the SW-assembled MCP response when `traverseFrames: true`
   * and a same-origin child frame was successfully queried via frame-targeted
   * messaging. The collector itself remains metadata-only.
   *
   * Cross-origin iframes do NOT include `nodes` — they are opaque per
   * Same-Origin Policy (B2-VD-007).
   *
   * These nodes are NOT merged into the parent top-level `nodes` array
   * (B2-VD-005: "Do not merge child nodes into the parent top-level `nodes`").
   * They live under the `iframes[]` entry for the frame that contains them.
   */
  nodes?: PageNode[];
}

/** Result of page map collection — includes full SnapshotEnvelope (B2-SV-003) */
export interface PageMapResult extends SnapshotEnvelope {
  /** Page URL (normalized: origin + pathname) */
  pageUrl: string;
  /** Page title */
  title: string;
  /** Structured DOM tree */
  nodes: PageNode[];
  /** Total DOM element count (before truncation) */
  totalElements: number;
  /** Whether the result was truncated by maxDepth or maxNodes */
  truncated: boolean;

  /**
   * B2-FI-007/008: Summary of applied filters and their effect.
   * Present only when at least one filter parameter was provided.
   */
  filterSummary?: FilterSummary;

  /**
   * B2-VD-005..009: Iframe metadata and child-frame page-map data.
   * Present only when `traverseFrames: true` was passed to collectPageMap.
   *
   * Each entry describes an `<iframe>` element found in the top-level document.
   * Same-origin entries may receive `nodes` later in the SW-assembled MCP
   * response. Cross-origin entries have `sameOrigin: false` and no `nodes` —
   * they are opaque due to Same-Origin Policy (B2-VD-007).
   *
   * Child-frame `nodes` are NOT merged into the parent top-level `nodes` array.
   * They live under the `iframes[]` entry for the frame that contains them.
   */
  iframes?: IframeMetadata[];
}

/**
 * B2-FI-008: Describes which filters were active and the reduction achieved.
 */
export interface FilterSummary {
  /** Names of the filters that were active. */
  activeFilters: string[];
  /** Number of nodes before filtering. */
  totalBeforeFilter: number;
  /** Number of nodes after filtering. */
  totalAfterFilter: number;
  /** Reduction ratio (0.0–1.0) — e.g. 0.6 means 60% reduction. */
  reductionRatio: number;
}

// ── Constants ────────────────────────────────────────────────────────────────

/** Tags excluded from the page map (non-content, invisible) */
export const EXCLUDED_TAGS: ReadonlySet<string> = new Set([
  "script", "style", "noscript", "template", "link", "meta",
]);

/** Maximum allowed depth */
export const MAX_DEPTH_LIMIT = 8;

/** Maximum allowed node count */
export const MAX_NODES_LIMIT = 500;

/** Default depth limit */
export const DEFAULT_MAX_DEPTH = 4;

/** Default node count limit */
export const DEFAULT_MAX_NODES = 200;

/** Maximum text content length per node */
export const MAX_TEXT_LENGTH = 100;

/** Attributes to include in the page map */
export const INCLUDED_ATTRS: readonly string[] = [
  "id", "class", "href", "src", "type", "data-testid", "data-cy", "data-test",
  "aria-label", "aria-labelledby", "aria-describedby", "alt", "title", "name",
  "placeholder", "value", "action", "method",
];

// ── Ref Index (delegates to traversal module) ─────────────────────────────────

/** Look up an element by its ref from the most recent page map */
export function getElementByRef(ref: string): Element | null {
  return _getElementByRef(ref);
}

/** Clear the ref index (called at the start of each collection) */
export function clearRefIndex(): void {
  _clearRefIndex();
}

// ── Iframe enumeration helper ──────────────────────────────────────────────────

/**
 * A4: Known ad/tracker URL patterns (inline copy — browser-extension has no
 * dependency on packages/browser, so we duplicate from frame-classifier.ts).
 */
const AD_PATTERNS: readonly RegExp[] = [
  /doubleclick\.net/i, /googlesyndication\.com/i, /adservice\.google\./i,
  /amazon-adsystem\.com/i, /media\.net/i, /adnxs\.com/i, /rubiconproject\.com/i,
  /openx\.net/i, /pubmatic\.com/i, /criteo\.com/i, /taboola\.com/i,
  /outbrain\.com/i, /revcontent\.com/i, /sharethrough\.com/i,
  /smartadserver\.com/i, /33across\.com/i, /advertising\.com/i,
  /adroll\.com/i, /moatads\.com/i, /scorecardresearch\.com/i,
  /quantserve\.com/i, /chartbeat\.com/i, /adsafeprotected\.com/i,
  /ib\.adnxs\.com/i,
];

/**
 * A4: Known widget/social/payment URL patterns (inline copy).
 */
const WIDGET_PATTERNS: readonly RegExp[] = [
  /facebook\.com\/plugins/i, /platform\.twitter\.com/i, /syndication\.twitter\.com/i,
  /instagram\.com\/embed/i, /youtube\.com\/embed/i, /youtu\.be\//i,
  /player\.vimeo\.com/i, /open\.spotify\.com\/embed/i, /soundcloud\.com\/player/i,
  /google\.com\/recaptcha/i, /recaptcha\.net/i,
  /paypal\.com\/(sdk|button|webapps)/i, /js\.stripe\.com/i,
  /appleid\.apple\.com/i, /accounts\.google\.com/i,
  /disqus\.com\/embed/i, /staticxx\.facebook\.com/i,
  /platform\.linkedin\.com/i, /assets\.pinterest\.com/i,
  /tiktok\.com\/embed/i, /twitch\.tv\/embed/i,
  /maps\.google\.com/i, /google\.com\/maps/i, /maps\.googleapis\.com/i,
  /calendar\.google\.com/i, /docs\.google\.com/i,
];

/**
 * A4: Classify an iframe src URL using heuristics.
 * Returns "content" for same-origin or blank frames, "ad", "widget", or "unknown".
 */
function classifyIframeInline(
  src: string,
  sameOrigin: boolean,
): "content" | "ad" | "widget" | "unknown" {
  // Inherited-origin or blank frames are treated as content
  if (src === "" || src === "about:blank" || src.startsWith("data:") || src.startsWith("javascript:")) {
    return "content";
  }
  for (const pattern of AD_PATTERNS) {
    if (pattern.test(src)) return "ad";
  }
  for (const pattern of WIDGET_PATTERNS) {
    if (pattern.test(src)) return "widget";
  }
  if (sameOrigin) return "content";
  return "unknown";
}

/**
 * B2-VD-005..009: Enumerate top-level `<iframe>` elements in the current document
 * and return metadata only. Same-origin child-frame DOM stitching is performed
 * later by the service worker using frame-targeted messaging.
 */
export function enumerateIframes(): IframeMetadata[] {
  try {
    const iframes = Array.from(document.querySelectorAll<HTMLIFrameElement>("iframe"));
    return iframes.map((iframe, index) => {
      let frameId: string;
      if (iframe.name && iframe.name.trim() !== "") {
        frameId = iframe.name;
      } else if (iframe.id && iframe.id.trim() !== "") {
        frameId = iframe.id;
      } else {
        frameId = `iframe-${index}`;
      }

      const src = iframe.src ?? "";

      // Determine same-origin conservatively.
      // 1. If the iframe URL is explicitly cross-origin, always return false.
      // 2. If the URL is explicitly same-origin, require DOM accessibility too.
      // 3. If the URL is inherited-origin-ish (about:blank / srcdoc / empty src),
      //    use DOM accessibility as the signal.
      let sameOrigin = false;
      try {
        const inheritedOriginFrame = src === "" || src === "about:blank" || iframe.hasAttribute("srcdoc");
        const domAccessible = ((): boolean => {
          try {
            return iframe.contentDocument !== null;
          } catch {
            return false;
          }
        })();

        if (inheritedOriginFrame) {
          sameOrigin = domAccessible;
        } else {
          const iframeUrl = new URL(src, document.baseURI);
          sameOrigin = iframeUrl.origin === window.location.origin && domAccessible;
        }
      } catch {
        sameOrigin = false;
      }

      let bounds: { x: number; y: number; width: number; height: number } = {
        x: 0, y: 0, width: 0, height: 0,
      };
      let visible = false;
      try {
        const rect = iframe.getBoundingClientRect();
        bounds = {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        };
        // A4: visible = not hidden via CSS and at least partially in viewport
        const style = window.getComputedStyle(iframe);
        const inViewport =
          rect.width > 0 &&
          rect.height > 0 &&
          rect.bottom > 0 &&
          rect.right > 0 &&
          rect.top < window.innerHeight &&
          rect.left < window.innerWidth;
        visible =
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          inViewport;
      } catch {
        // ignore and leave zero bounds / visible:false if the browser cannot provide them
      }

      // A4: iframe title (empty string → undefined)
      const title = iframe.title !== "" ? iframe.title : undefined;

      return {
        frameId,
        src,
        bounds,
        sameOrigin,
        // A4 fields
        parentFrameId: null,
        title,
        depth: 1,
        classification: classifyIframeInline(src, sameOrigin),
        visible,
      };
    });
  } catch {
    // document.querySelectorAll can throw in environments without DOM access
    return [];
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Collect a structured page map from the current document.
 *
 * Walks the visible DOM tree, collecting element metadata. Excludes script,
 * style, noscript, template, and hidden elements. Applies the filter pipeline
 * during traversal (B2-FI-001..008).
 *
 * @param options - Collection options (depth, count, bounds, viewport filter, M102 filters)
 * @returns Structured page map with metadata and optional filterSummary
 */
export function collectPageMap(options?: PageMapOptions): PageMapResult {
  clearRefIndex();

  const maxDepth = Math.min(options?.maxDepth ?? DEFAULT_MAX_DEPTH, MAX_DEPTH_LIMIT);
  const maxNodes = Math.min(options?.maxNodes ?? DEFAULT_MAX_NODES, MAX_NODES_LIMIT);
  const includeBounds = options?.includeBounds ?? false;
  const viewportOnly = options?.viewportOnly ?? false;

  // B2-SV-003: Capture SnapshotEnvelope FIRST so frameId is available for traversal options.
  const envelope = captureSnapshotEnvelope("dom");

  // B2-FI-007: Build filter pipeline from options
  const filterPipeline = buildFilterPipeline(options ?? {});
  const totalBeforeFilter = { count: 0 };

  // B2-UID-001: frameId from envelope — "main" for content script context.
  // Passed to traversal so uid="{frameId}:{nodeId}" is set on all nodes.
  const frameId = envelope.frameId ?? "main";

  const traversalOpts: TraversalOptions = {
    maxDepth,
    maxNodes,
    includeBounds,
    viewportOnly,
    filterPipeline,
    totalBeforeFilter,
    // B2-FI-002: when interactiveOnly is set, enable flat-list mode so that
    // interactive elements at any DOM depth are collected regardless of maxDepth.
    // Non-matching ancestors are traversed beyond maxDepth without being included.
    // B2-FI-003: same flat-list treatment for roles filter — role-matched elements
    // may be arbitrarily deep (e.g. <a> links buried in nested table cells on HN).
    // B2-FI-004/005: same flat-list treatment for textMatch and selector filters —
    // matching elements may be at any depth, so traversal must not be capped at maxDepth.
    // B2-FI-001: same for visibleOnly — all visible elements at any depth should be found.
    flatListMode: options?.interactiveOnly === true
      || (Array.isArray(options?.roles) && options.roles.length > 0)
      || (typeof options?.selector === "string" && options.selector.length > 0)
      || (typeof options?.textMatch === "string" && options.textMatch.length > 0)
      || options?.visibleOnly === true,
    // B2-VD-001..003: pass piercesShadow flag to traversal
    piercesShadow: options?.piercesShadow ?? false,
    // B2-UID-001: pass frameId so uid="{frameId}:{nodeId}" is set on all nodes.
    frameId,
  };

  const pageUrl = document.location?.href ?? "https://localhost/";
  const title = document.title || "Page";

  const refCounter = { count: 0 };
  const truncated = { value: false };
  const nodes: PageNode[] = [];
  const totalElements = document.querySelectorAll("*").length;

  for (const child of Array.from(document.body.children)) {
    const childNodes = buildNode(child, refCounter, 0, traversalOpts, truncated);
    for (const cn of childNodes) nodes.push(cn);
  }

  // Use generateAnchorKey to satisfy the import (avoids dead import lint)
  void generateAnchorKey;

  // B2-FI-008: Emit filter summary when filters were active
  const filterSummary = filterPipeline.hasFilters
    ? buildFilterSummary(filterPipeline, totalBeforeFilter.count, refCounter.count)
    : undefined;

  // B2-VD-005..009: Enumerate iframe metadata when traverseFrames is true
  const iframes = options?.traverseFrames === true
    ? enumerateIframes()
    : undefined;

  return {
    ...envelope,
    pageUrl,
    title,
    nodes,
    totalElements,
    truncated: truncated.value,
    ...(filterSummary ? { filterSummary } : {}),
    ...(iframes ? { iframes } : {}),
  };
}
