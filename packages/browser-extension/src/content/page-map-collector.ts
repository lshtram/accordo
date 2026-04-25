/**
 * M90-MAP — Page Map Collector
 *
 * Orchestrates page-map collection using traversal, filters, and snapshot envelope capture.
 * Contracts/constants live in `page-map-types.ts`; iframe metadata logic lives in
 * `page-map-iframes.ts`.
 *
 * @module
 */

import { generateAnchorKey } from "./enhanced-anchor.js";
import { captureSnapshotEnvelope } from "../snapshot-versioning.js";
import { buildFilterPipeline, buildFilterSummary } from "./page-map-filters.js";
import { buildNode, clearRefIndex as _clearRefIndex, getElementByRef as _getElementByRef } from "./page-map-traversal.js";
import type { TraversalOptions } from "./page-map-traversal.js";
import {
  DEFAULT_MAX_DEPTH,
  DEFAULT_MAX_NODES,
  MAX_DEPTH_LIMIT,
  MAX_NODES_LIMIT,
  type FilterSummary,
  type IframeMetadata,
  type PageMapOptions,
  type PageMapResult,
  type PageNode,
} from "./page-map-types.js";
import { enumerateIframes } from "./page-map-iframes.js";

export {
  DEFAULT_MAX_DEPTH,
  DEFAULT_MAX_NODES,
  EXCLUDED_TAGS,
  INCLUDED_ATTRS,
  MAX_DEPTH_LIMIT,
  MAX_NODES_LIMIT,
  MAX_TEXT_LENGTH,
} from "./page-map-types.js";
export { enumerateIframes } from "./page-map-iframes.js";
export type {
  FilterSummary,
  IframeMetadata,
  PageMapOptions,
  PageMapResult,
  PageNode,
} from "./page-map-types.js";

export function getElementByRef(ref: string): Element | null {
  return _getElementByRef(ref);
}

export function clearRefIndex(): void {
  _clearRefIndex();
}

export function collectPageMap(options?: PageMapOptions): PageMapResult {
  clearRefIndex();

  const maxDepth = Math.min(options?.maxDepth ?? DEFAULT_MAX_DEPTH, MAX_DEPTH_LIMIT);
  const maxNodes = Math.min(options?.maxNodes ?? DEFAULT_MAX_NODES, MAX_NODES_LIMIT);
  const includeBounds = options?.includeBounds ?? false;
  const viewportOnly = options?.viewportOnly ?? false;
  const envelope = captureSnapshotEnvelope("dom");
  const filterPipeline = buildFilterPipeline(options ?? {});
  const totalBeforeFilter = { count: 0 };
  const frameId = options?.logicalFrameId ?? envelope.frameId ?? "main";

  const traversalOpts: TraversalOptions = {
    maxDepth,
    maxNodes,
    includeBounds,
    viewportOnly,
    filterPipeline,
    totalBeforeFilter,
    flatListMode: options?.interactiveOnly === true
      || (Array.isArray(options?.roles) && options.roles.length > 0)
      || (typeof options?.selector === "string" && options.selector.length > 0)
      || (typeof options?.textMatch === "string" && options.textMatch.length > 0)
      || options?.visibleOnly === true,
    piercesShadow: options?.piercesShadow ?? false,
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

  void generateAnchorKey;

  const filterSummary: FilterSummary | undefined = filterPipeline.hasFilters
    ? buildFilterSummary(filterPipeline, totalBeforeFilter.count, refCounter.count)
    : undefined;
  const iframes: IframeMetadata[] | undefined = options?.traverseFrames === true
    ? enumerateIframes(frameId)
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
