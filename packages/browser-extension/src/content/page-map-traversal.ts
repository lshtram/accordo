/**
 * M102-FILT — Page Map Traversal Helpers
 *
 * DOM traversal logic extracted from page-map-collector to respect the
 * ~200-line file guideline. Wires the filter pipeline into buildNode()
 * to satisfy B2-FI-001..007.
 *
 * @module
 */

import { applyFilters } from "./page-map-filters.js";
import type { FilterPipeline } from "./page-map-filters.js";
import type { PageNode } from "./page-map-types.js";
import { EXCLUDED_TAGS } from "./page-map-types.js";
import { ensureShadowTrackingInstalled, getShadowRootState } from "./shadow-root-tracker.js";
import { buildPassedNode } from "./page-map-passed-node.js";
import { buildShadowNode, type TraversalOptions } from "./page-map-shadow-build.js";
export type { TraversalOptions } from "./page-map-shadow-build.js";
export { getElementByRef, getNodeIdByElement, getUidByNodeId, clearRefIndex } from "./page-map-ref-index.js";
import { ensureSyntheticNodeId } from "./page-map-ref-index.js";
import { isHidden, isInViewport } from "./page-map-node-utils.js";

ensureShadowTrackingInstalled();


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
    return [buildPassedNode(element, refCounter, depth, opts, truncated, buildNode, opts.frameId ?? "main")];
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
      const hostNodeId = ensureSyntheticNodeId(element);
      for (const shadowChild of Array.from(shadowRootState.children)) {
        const shadowChildNodes = buildShadowNode(shadowChild, refCounter, depth + 1, opts, truncated, hostNodeId);
        for (const scn of shadowChildNodes) promoted.push(scn);
      }
    }
  }
  return promoted;
}
