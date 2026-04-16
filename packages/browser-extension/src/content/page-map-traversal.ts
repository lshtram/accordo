/**
 * M102-FILT — Page Map Traversal Helpers
 *
 * DOM traversal logic extracted from page-map-collector to respect the
 * ~200-line file guideline. Wires the filter pipeline into buildNode()
 * to satisfy B2-FI-001..007.
 *
 * @module
 */

import { computePersistentId } from "../snapshot-versioning.js";
import { applyFilters } from "./page-map-filters.js";
import type { FilterPipeline } from "./page-map-filters.js";
import type { PageNode } from "./page-map-collector.js";
import {
  EXCLUDED_TAGS,
  INCLUDED_ATTRS,
  MAX_TEXT_LENGTH,
} from "./page-map-collector.js";
import { viewportIntersectionRatio, findNearestContainer } from "./spatial-helpers.js";
import { ensureShadowTrackingInstalled, getShadowRootState } from "./shadow-root-tracker.js";

// ── Module-level ref index ────────────────────────────────────────────────────

let refIndex: Map<string, Element> = new Map();

/**
 * GAP-D1 / D5: Reverse lookup from DOM element to its nodeId.
 * Populated alongside `refIndex` in `buildPassedNode()`.
 * Enables O(1) `containerId` resolution (avoids O(n) scan per node).
 */
let elementToNodeId: Map<Element, number> = new Map();
let nextSyntheticNodeId = -1;

/**
 * B2-UID-001: Maps nodeId → uid for the most recent page map.
 * Populated alongside refIndex in `buildPassedNode()` and `buildShadowNode()`.
 * Enables the spatial relations handler to include uid in its response.
 */
let nodeIdToUid: Map<number, string> = new Map();

function ensureSyntheticNodeId(element: Element, refCounter: { count: number }): number {
  const existing = elementToNodeId.get(element);
  if (existing !== undefined) return existing;
  const nodeId = nextSyntheticNodeId--;
  elementToNodeId.set(element, nodeId);
  return nodeId;
}

/** Look up an element by its ref from the most recent page map */
export function getElementByRef(ref: string): Element | null {
  return refIndex.get(ref) ?? null;
}

/**
 * GAP-D1 / D5: Look up a nodeId by its DOM element.
 * Returns undefined if the element was not included in the most recent page map.
 */
export function getNodeIdByElement(element: Element): number | undefined {
  return elementToNodeId.get(element);
}

/**
 * B2-UID-001: Look up the canonical uid for a nodeId from the most recent page map.
 * Returns undefined if the nodeId is not in the most recent page map.
 *
 * @param nodeId - The nodeId to look up
 * @returns The uid string "{frameId}:{nodeId}" or undefined if not found
 */
export function getUidByNodeId(nodeId: number): string | undefined {
  return nodeIdToUid.get(nodeId);
}

/** Clear the ref index and nodeId-to-uid map (called at the start of each collection) */
export function clearRefIndex(): void {
  refIndex = new Map();
  elementToNodeId = new Map();
  nodeIdToUid = new Map();
  nextSyntheticNodeId = -1;
}

ensureShadowTrackingInstalled();

// ── Internal helpers ─────────────────────────────────────────────────────────

function isHidden(element: Element): boolean {
  if (typeof window === "undefined") return false;
  if (element.hasAttribute("hidden")) return true;
  const style = window.getComputedStyle(element);
  return (
    style.display === "none" ||
    style.visibility === "hidden" ||
    style.visibility === "collapse" ||
    style.opacity === "0"
  );
}

function isInViewport(element: Element): boolean {
  if (typeof window === "undefined") return true;
  const rect = element.getBoundingClientRect();
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    rect.bottom > 0 &&
    rect.right > 0 &&
    rect.top < (window.innerHeight || document.documentElement.clientHeight) &&
    rect.left < (window.innerWidth || document.documentElement.clientWidth)
  );
}

function getAccessibleName(element: Element): string | undefined {
  const label = element.getAttribute("aria-label");
  if (label) return label;
  const alt = element.getAttribute("alt");
  if (alt) return alt;
  const title = element.getAttribute("title");
  if (title) return title;
  return undefined;
}

function buildAttrs(element: Element): Record<string, string> | undefined {
  const attrs: Record<string, string> = {};
  for (const attrName of INCLUDED_ATTRS) {
    const val = element.getAttribute(attrName);
    if (val !== null) attrs[attrName] = val;
  }
  return Object.keys(attrs).length > 0 ? attrs : undefined;
}

// ── Traversal options ────────────────────────────────────────────────────────

export interface TraversalOptions {
  maxDepth: number;
  maxNodes: number;
  includeBounds: boolean;
  viewportOnly: boolean;
  filterPipeline: FilterPipeline;
  /** Mutable counter: tracks nodes visited before filtering */
  totalBeforeFilter: { count: number };
  /**
   * B2-FI-002 flat-list mode: when true, non-matching ancestors are traversed
   * to unlimited depth so matching descendants (e.g. interactive elements) are
   * never lost due to maxDepth truncation. Enabled automatically when
   * interactiveOnly: true is set. Matching elements are still returned as a
   * flat promoted list (no wrapper parent node).
   */
  flatListMode?: boolean;
  /**
   * B2-VD-001..003: When true, traverse open shadow DOM trees and annotate
   * closed shadow roots on their hosts. Default: false.
   */
  piercesShadow?: boolean;
  /**
   * B2-UID-001: Frame identifier used when building canonical uid.
   * Defaults to "main" for the top-level document frame.
   * For same-origin iframe nodes assembled in the SW, this is set to the
   * iframe's frameId so uid is globally unique across frames.
   */
  frameId?: string;
}

// ── Core buildNode ────────────────────────────────────────────────────────────

/**
 * Build a PageNode for an element that passed the filter pipeline,
 * recursing into children. Internal — callers should use buildNode.
 *
 * @param frameId - The frameId to use when building the canonical uid.
 *                  Defaults to "main" for top-level documents.
 */
function buildPassedNode(
  element: Element,
  refCounter: { count: number },
  depth: number,
  opts: TraversalOptions,
  truncated: { value: boolean },
  frameId: string = "main",
): PageNode {
  const tag = element.tagName.toLowerCase();

  const ref = `ref-${refCounter.count}`;
  const nodeId = refCounter.count;
  refCounter.count++;
  refIndex.set(ref, element);
  elementToNodeId.set(element, nodeId);
  // B2-UID-001: Populate nodeId→uid lookup for spatial relations handler
  nodeIdToUid.set(nodeId, `${frameId}:${nodeId}`);

  // B2-UID-001: Canonical uid shaped "{frameId}:{nodeId}" enables cross-frame
  // node identity without ambiguity. frameId is "main" for the top-level document.
  const node: PageNode = { ref, tag, nodeId, uid: `${frameId}:${nodeId}` };

  // B2-SV-007: stable persistent ID
  const directTextForId = Array.from(element.childNodes)
    .filter((n) => n.nodeType === Node.TEXT_NODE)
    .map((n) => n.textContent ?? "")
    .join("")
    .trim();
  node.persistentId = computePersistentId(tag, element.id || undefined, directTextForId || undefined);

  if (element.id) node.id = element.id;

  const role = element.getAttribute("role");
  if (role) node.role = role;

  const name = getAccessibleName(element);
  if (name) node.name = name;

  const directText = Array.from(element.childNodes)
    .filter((n) => n.nodeType === Node.TEXT_NODE)
    .map((n) => n.textContent ?? "")
    .join("")
    .trim();
  if (directText) {
    node.text = directText.length > MAX_TEXT_LENGTH
      ? directText.slice(0, MAX_TEXT_LENGTH)
      : directText;
  }

  const attrs = buildAttrs(element);
  if (attrs) node.attrs = attrs;

  if (opts.includeBounds) {
    const rect = element.getBoundingClientRect();
    node.bounds = {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };

    // GAP-D1 / D4: Viewport intersection ratio
    const viewport = {
      width: window.innerWidth || document.documentElement.clientWidth,
      height: window.innerHeight || document.documentElement.clientHeight,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
    };
    node.viewportRatio = viewportIntersectionRatio(node.bounds, viewport);

    // GAP-D1 / D5: Nearest semantic container (resolved to nodeId)
    const containerEl = findNearestContainer(element);
    if (containerEl !== null) {
      const containerNodeId = getNodeIdByElement(containerEl);
      if (containerNodeId !== undefined) {
        node.containerId = containerNodeId;
      }
    }

    // GAP-D2: z-index, stacking context, and occlusion detection
    const computedStyle = window.getComputedStyle(element);
    const zIndexStr = computedStyle.zIndex;
    const parsedZIndex = parseInt(zIndexStr, 10);
    if (!isNaN(parsedZIndex)) {
      node.zIndex = parsedZIndex;
    }

    // isStacked: element creates a new stacking context when:
    // - position is not static AND zIndex is not auto, OR
    // - opacity < 1, OR
    // - transform/filter/etc. are not none
    const position = computedStyle.position;
    const opacity = parseFloat(computedStyle.opacity);
    const transform = computedStyle.transform;
    const filter = computedStyle.filter;
    const isStackingContext =
      (position !== "static" && zIndexStr !== "auto") ||
      opacity < 1 ||
      transform !== "none" ||
      filter !== "none" ||
      computedStyle.mixBlendMode !== "normal" ||
      computedStyle.isolation === "isolate" ||
      computedStyle.webkitMaskImage !== "none" ||
      computedStyle.webkitMask !== "none";
    if (isStackingContext) {
      node.isStacked = true;
    }

    // occluded: use elementFromPoint at center to detect if another element is on top
    if (rect.width > 0 && rect.height > 0 && typeof document.elementFromPoint === "function") {
      const centerX = rect.x + rect.width / 2;
      const centerY = rect.y + rect.height / 2;
      try {
        const top = document.elementFromPoint(centerX, centerY);
        // element is occluded if the top element at center is not this element
        // and is not a descendant of this element
        node.occluded = top !== null && !element.contains(top);
      } catch {
        // elementFromPoint can throw on certain elements (e.g., outside the document)
        node.occluded = undefined;
      }
    }
  }

  if (opts.piercesShadow) {
    const shadowRootState = getShadowRootState(element);
    if (shadowRootState === "closed") {
      node.shadowRoot = "closed";
    }
  }

  if (depth < opts.maxDepth) {
    const children: PageNode[] = [];
    for (const child of Array.from(element.children)) {
      const childNodes = buildNode(child, refCounter, depth + 1, opts, truncated);
      for (const cn of childNodes) children.push(cn);
    }

    // B2-VD-001..003: traverse open shadow DOM if piercesShadow is enabled
    if (opts.piercesShadow) {
      const shadowRootState = getShadowRootState(element);
      if (shadowRootState && shadowRootState !== "closed") {
          // Traverse open shadow root children, annotating each with inShadowRoot + shadowHostId
          for (const shadowChild of Array.from(shadowRootState.children)) {
            const shadowChildNodes = buildShadowNode(shadowChild, refCounter, depth + 1, opts, truncated, nodeId);
            for (const scn of shadowChildNodes) children.push(scn);
          }
      }
    }

    if (children.length > 0) node.children = children;
  } else if (element.children.length > 0) {
    truncated.value = true;
  }

  return node;
}

/**
 * B2-VD-001..002: Build shadow DOM nodes recursively.
 * Annotates each node with inShadowRoot + shadowHostId and recurses into
 * both light-DOM children (via buildShadowNode) and shadow-DOM children
 * (nested shadow roots — also via buildShadowNode) within the shadow subtree.
 */
function buildShadowNode(
  element: Element,
  refCounter: { count: number },
  depth: number,
  opts: TraversalOptions,
  truncated: { value: boolean },
  shadowHostId: number,
): PageNode[] {
  if (refCounter.count >= opts.maxNodes) {
    truncated.value = true;
    return [];
  }

  const tag = element.tagName.toLowerCase();
  if (EXCLUDED_TAGS.has(tag)) return [];
  if (isHidden(element)) return [];
  if (opts.viewportOnly && !isInViewport(element)) return [];

  opts.totalBeforeFilter.count++;

  const passesFilter =
    !opts.filterPipeline.hasFilters || applyFilters(opts.filterPipeline, element);

  if (!passesFilter) {
    // Fails filter — skip this node but recurse into its children (shadow + light)
    if (depth >= opts.maxDepth && !opts.flatListMode) {
      if (element.children.length > 0) truncated.value = true;
      return [];
    }
    const promoted: PageNode[] = [];
    const hostNodeId = ensureSyntheticNodeId(element, refCounter);
    // Light DOM children
    for (const child of Array.from(element.children)) {
      const childNodes = buildShadowNode(child, refCounter, depth + 1, opts, truncated, shadowHostId);
      for (const cn of childNodes) promoted.push(cn);
    }
    // Nested shadow DOM children
    if (opts.piercesShadow) {
      const nestedShadowRoot = getShadowRootState(element);
      if (nestedShadowRoot && nestedShadowRoot !== "closed") {
        for (const nestedShadowChild of Array.from(nestedShadowRoot.children)) {
          const nestedNodes = buildShadowNode(nestedShadowChild, refCounter, depth + 1, opts, truncated, hostNodeId);
          for (const nscn of nestedNodes) promoted.push(nscn);
        }
      }
    }
    return promoted;
  }

  // Element passes — build it with shadow annotations
  const ref = `ref-${refCounter.count}`;
  const nodeId = refCounter.count;
  refCounter.count++;
  refIndex.set(ref, element);
  elementToNodeId.set(element, nodeId);

  // B2-UID-001: Shadow nodes share the frameId of their parent document.
  const frameId = opts.frameId ?? "main";
  // B2-UID-001: Populate nodeId→uid lookup for spatial relations handler
  nodeIdToUid.set(nodeId, `${frameId}:${nodeId}`);

  const node: PageNode = { ref, tag, nodeId, uid: `${frameId}:${nodeId}`, inShadowRoot: true, shadowHostId };

  // Stable persistent ID
  const directTextForId = Array.from(element.childNodes)
    .filter((n) => n.nodeType === Node.TEXT_NODE)
    .map((n) => n.textContent ?? "")
    .join("")
    .trim();
  node.persistentId = computePersistentId(tag, element.id || undefined, directTextForId || undefined);

  if (element.id) node.id = element.id;
  const role = element.getAttribute("role");
  if (role) node.role = role;
  const name = getAccessibleName(element);
  if (name) node.name = name;
  const directText = Array.from(element.childNodes)
    .filter((n) => n.nodeType === Node.TEXT_NODE)
    .map((n) => n.textContent ?? "")
    .join("")
    .trim();
  if (directText) {
    node.text = directText.length > MAX_TEXT_LENGTH
      ? directText.slice(0, MAX_TEXT_LENGTH)
      : directText;
  }
  const attrs = buildAttrs(element);
  if (attrs) node.attrs = attrs;

  if (opts.includeBounds) {
    const rect = element.getBoundingClientRect();
    node.bounds = {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
    const viewport = {
      width: window.innerWidth || document.documentElement.clientWidth,
      height: window.innerHeight || document.documentElement.clientHeight,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
    };
    node.viewportRatio = viewportIntersectionRatio(node.bounds, viewport);
    const containerEl = findNearestContainer(element);
    if (containerEl !== null) {
      const containerNodeId = getNodeIdByElement(containerEl);
      if (containerNodeId !== undefined) node.containerId = containerNodeId;
    }
  }

  // Recurse into children (both light DOM and nested shadow DOM)
  if (depth < opts.maxDepth) {
    const children: PageNode[] = [];
    // Light DOM children
    for (const child of Array.from(element.children)) {
      const childNodes = buildShadowNode(child, refCounter, depth + 1, opts, truncated, shadowHostId);
      for (const cn of childNodes) children.push(cn);
    }
    // Nested shadow DOM children
    if (opts.piercesShadow) {
      const nestedShadowRoot = getShadowRootState(element);
      if (nestedShadowRoot && nestedShadowRoot !== "closed") {
        for (const nestedShadowChild of Array.from(nestedShadowRoot.children)) {
          const nestedNodes = buildShadowNode(nestedShadowChild, refCounter, depth + 1, opts, truncated, nodeId);
          for (const nscn of nestedNodes) children.push(nscn);
        }
      }
    }
    if (children.length > 0) node.children = children;
  } else if (element.children.length > 0) {
    truncated.value = true;
  }

  return [node];
}

/**
 * Build PageNode(s) from a DOM element, recursing into children.
 * Applies the filter pipeline (B2-FI-001..007): elements that fail any
 * filter are excluded from the result, but their descendants are still
 * traversed so matching descendants are not lost (traversal semantics).
 * `totalBeforeFilter` is incremented for every candidate element.
 *
 * Returns an array: normally 0 or 1 elements. When a parent fails the filter
 * but children pass, the children are promoted (returned flat, without the
 * failing parent as a wrapper).
 */
export function buildNode(
  element: Element,
  refCounter: { count: number },
  depth: number,
  opts: TraversalOptions,
  truncated: { value: boolean },
): PageNode[] {
  if (refCounter.count >= opts.maxNodes) {
    truncated.value = true;
    return [];
  }

  const tag = element.tagName.toLowerCase();
  if (EXCLUDED_TAGS.has(tag)) return [];
  if (isHidden(element)) return [];
  if (opts.viewportOnly && !isInViewport(element)) return [];

  // B2-FI-001..007: count every candidate before deciding inclusion
  opts.totalBeforeFilter.count++;

  const passesFilter =
    !opts.filterPipeline.hasFilters || applyFilters(opts.filterPipeline, element);

  if (passesFilter) {
    // Element passes — build it (with its children nested inside)
    return [buildPassedNode(element, refCounter, depth, opts, truncated, opts.frameId ?? "main")];
  }

  // Element fails filter — skip it BUT recurse into children so matching
  // descendants are not pruned (traversal semantics fix).
  //
  // B2-FI-002 flat-list mode: when flatListMode is true (set by interactiveOnly),
  // we bypass the maxDepth guard for non-matching ancestors so that interactive
  // elements at any depth are reachable. Without this, a non-interactive element
  // sitting exactly at maxDepth would swallow all its interactive children.
  if (depth >= opts.maxDepth && !opts.flatListMode) {
    if (element.children.length > 0) truncated.value = true;
    return [];
  }

  const promoted: PageNode[] = [];
  for (const child of Array.from(element.children)) {
    const childNodes = buildNode(child, refCounter, depth + 1, opts, truncated);
    for (const cn of childNodes) promoted.push(cn);
  }
  if (opts.piercesShadow) {
    const shadowRootState = getShadowRootState(element);
    if (shadowRootState && shadowRootState !== "closed") {
      const hostNodeId = ensureSyntheticNodeId(element, refCounter);
      for (const shadowChild of Array.from(shadowRootState.children)) {
        const shadowChildNodes = buildShadowNode(shadowChild, refCounter, depth + 1, opts, truncated, hostNodeId);
        for (const scn of shadowChildNodes) promoted.push(scn);
      }
    }
  }
  return promoted;
}
