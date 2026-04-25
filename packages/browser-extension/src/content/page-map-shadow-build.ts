import { computePersistentId } from "../snapshot-versioning.js";
import { applyFilters, type FilterPipeline } from "./page-map-filters.js";
import type { PageNode } from "./page-map-types.js";
import { EXCLUDED_TAGS, MAX_TEXT_LENGTH } from "./page-map-types.js";
import { viewportIntersectionRatio, findNearestContainer } from "./spatial-helpers.js";
import { getShadowRootState } from "./shadow-root-tracker.js";
import { buildAttrs, getAccessibleName, isHidden, isInViewport } from "./page-map-node-utils.js";
import { ensureSyntheticNodeId, getNodeIdByElement, registerNode } from "./page-map-ref-index.js";

export interface TraversalOptions {
  maxDepth: number;
  maxNodes: number;
  includeBounds: boolean;
  viewportOnly: boolean;
  filterPipeline: FilterPipeline;
  totalBeforeFilter: { count: number };
  flatListMode?: boolean;
  piercesShadow?: boolean;
  frameId?: string;
}

export function buildShadowNode(
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
  if (EXCLUDED_TAGS.has(tag) || isHidden(element) || (opts.viewportOnly && !isInViewport(element))) return [];

  opts.totalBeforeFilter.count++;
  const passesFilter = !opts.filterPipeline.hasFilters || applyFilters(opts.filterPipeline, element);

  if (!passesFilter) {
    if (depth >= opts.maxDepth && !opts.flatListMode) {
      if (element.children.length > 0) truncated.value = true;
      return [];
    }
    const promoted: PageNode[] = [];
    const hostNodeId = ensureSyntheticNodeId(element);
    for (const child of Array.from(element.children)) {
      const childNodes = buildShadowNode(child, refCounter, depth + 1, opts, truncated, shadowHostId);
      for (const cn of childNodes) promoted.push(cn);
    }
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

  const ref = `ref-${refCounter.count}`;
  const nodeId = refCounter.count;
  refCounter.count++;
  const frameId = opts.frameId ?? "main";
  registerNode(ref, element, nodeId, `${frameId}:${nodeId}`);

  const node: PageNode = { ref, tag, nodeId, uid: `${frameId}:${nodeId}`, inShadowRoot: true, shadowHostId };
  const directTextForId = Array.from(element.childNodes).filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent ?? "").join("").trim();
  node.persistentId = computePersistentId(tag, element.id || undefined, directTextForId || undefined);
  if (element.id) node.id = element.id;
  const role = element.getAttribute("role");
  if (role) node.role = role;
  const name = getAccessibleName(element);
  if (name) node.name = name;
  const directText = Array.from(element.childNodes).filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent ?? "").join("").trim();
  if (directText) node.text = directText.length > MAX_TEXT_LENGTH ? directText.slice(0, MAX_TEXT_LENGTH) : directText;
  const attrs = buildAttrs(element);
  if (attrs) node.attrs = attrs;

  if (opts.includeBounds) {
    const rect = element.getBoundingClientRect();
    node.bounds = { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) };
    const viewport = { width: window.innerWidth || document.documentElement.clientWidth, height: window.innerHeight || document.documentElement.clientHeight, scrollX: window.scrollX, scrollY: window.scrollY };
    node.viewportRatio = viewportIntersectionRatio(node.bounds, viewport);
    const containerEl = findNearestContainer(element);
    if (containerEl !== null) {
      const containerNodeId = getNodeIdByElement(containerEl);
      if (containerNodeId !== undefined) node.containerId = containerNodeId;
    }
  }

  if (depth < opts.maxDepth) {
    const children: PageNode[] = [];
    for (const child of Array.from(element.children)) {
      const childNodes = buildShadowNode(child, refCounter, depth + 1, opts, truncated, shadowHostId);
      for (const cn of childNodes) children.push(cn);
    }
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
