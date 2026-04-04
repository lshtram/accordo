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

// ── Module-level ref index ────────────────────────────────────────────────────

let refIndex: Map<string, Element> = new Map();

/** Look up an element by its ref from the most recent page map */
export function getElementByRef(ref: string): Element | null {
  return refIndex.get(ref) ?? null;
}

/** Clear the ref index (called at the start of each collection) */
export function clearRefIndex(): void {
  refIndex = new Map();
}

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
}

// ── Core buildNode ────────────────────────────────────────────────────────────

/**
 * Build a PageNode for an element that passed the filter pipeline,
 * recursing into children. Internal — callers should use buildNode.
 */
function buildPassedNode(
  element: Element,
  refCounter: { count: number },
  depth: number,
  opts: TraversalOptions,
  truncated: { value: boolean },
): PageNode {
  const tag = element.tagName.toLowerCase();

  const ref = `ref-${refCounter.count}`;
  const nodeId = refCounter.count;
  refCounter.count++;
  refIndex.set(ref, element);

  const node: PageNode = { ref, tag, nodeId };

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
  }

  if (depth < opts.maxDepth) {
    const children: PageNode[] = [];
    for (const child of Array.from(element.children)) {
      const childNodes = buildNode(child, refCounter, depth + 1, opts, truncated);
      for (const cn of childNodes) children.push(cn);
    }
    if (children.length > 0) node.children = children;
  } else if (element.children.length > 0) {
    truncated.value = true;
  }

  return node;
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
    return [buildPassedNode(element, refCounter, depth, opts, truncated)];
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
  return promoted;
}
