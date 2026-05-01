import { computePersistentId } from "../snapshot-versioning.js";
import type { PageNode } from "./page-map-types.js";
import { MAX_TEXT_LENGTH } from "./page-map-types.js";
import { viewportIntersectionRatio, findNearestContainer } from "./spatial-helpers.js";
import { getShadowRootState } from "./shadow-root-tracker.js";
import { buildAttrs, getAccessibleName } from "./page-map-node-utils.js";
import { getNodeIdByElement, registerNode } from "./page-map-ref-index.js";
import { buildShadowNode, type TraversalOptions } from "./page-map-shadow-build.js";

export function buildPassedNode(
  element: Element,
  refCounter: { count: number },
  depth: number,
  opts: TraversalOptions,
  truncated: { value: boolean },
  recurseNode: (element: Element, refCounter: { count: number }, depth: number, opts: TraversalOptions, truncated: { value: boolean }) => PageNode[],
  frameId: string = "main",
): PageNode {
  const tag = element.tagName.toLowerCase();
  const ref = `ref-${refCounter.count}`;
  const nodeId = refCounter.count;
  refCounter.count++;
  registerNode(ref, element, nodeId, `${frameId}:${nodeId}`);

  const node: PageNode = { ref, tag, nodeId, uid: `${frameId}:${nodeId}` };
  const directTextForId = Array.from(element.childNodes).filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent ?? "").join("").trim();
  node.persistentId = computePersistentId(tag, element.id || undefined, nodeId);
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

    const computedStyle = window.getComputedStyle(element);
    const zIndexStr = computedStyle.zIndex;
    const parsedZIndex = parseInt(zIndexStr, 10);
    if (!isNaN(parsedZIndex)) node.zIndex = parsedZIndex;
    const position = computedStyle.position;
    const opacity = parseFloat(computedStyle.opacity);
    const transform = computedStyle.transform;
    const filter = computedStyle.filter;
    const isStackingContext =
      (position !== "static" && zIndexStr !== "auto") || opacity < 1 || transform !== "none" || filter !== "none" || computedStyle.mixBlendMode !== "normal" || computedStyle.isolation === "isolate" || computedStyle.webkitMaskImage !== "none" || computedStyle.webkitMask !== "none";
    if (isStackingContext) node.isStacked = true;

    if (rect.width > 0 && rect.height > 0 && typeof document.elementFromPoint === "function") {
      const centerX = rect.x + rect.width / 2;
      const centerY = rect.y + rect.height / 2;
      try {
        const top = document.elementFromPoint(centerX, centerY);
        node.occluded = top !== null && !element.contains(top);
      } catch {
        node.occluded = undefined;
      }
    }
  }

  if (opts.piercesShadow) {
    const shadowRootState = getShadowRootState(element);
    if (shadowRootState === "closed") node.shadowRoot = "closed";
  }

  if (depth < opts.maxDepth) {
    const children: PageNode[] = [];
    for (const child of Array.from(element.children)) {
      const childNodes = recurseNode(child, refCounter, depth + 1, opts, truncated);
      for (const cn of childNodes) children.push(cn);
    }
    if (opts.piercesShadow) {
      const shadowRootState = getShadowRootState(element);
      if (shadowRootState && shadowRootState !== "closed") {
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
