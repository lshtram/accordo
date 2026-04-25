import { getElementByRef } from "./page-map-collector.js";
import { normalizeIncomingAnchorKey } from "./anchor-resolution-metadata.js";
import { resolveAnchorKey } from "./enhanced-anchor-resolution.js";
import type { InspectElementArgs } from "./element-inspector-types.js";

function isElementVisible(element: Element): boolean {
  if (element.hasAttribute("hidden")) return false;
  const style = window.getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden" && style.visibility !== "collapse" && style.opacity !== "0";
}

function resolveElementByNodeId(nodeId: number): Element | null {
  return getElementByRef(`ref-${nodeId}`);
}

function resolveElementByUid(uid: string): Element | null {
  const colonIdx = uid.indexOf(":");
  if (colonIdx < 0) return null;
  const nodeId = parseInt(uid.slice(colonIdx + 1), 10);
  if (isNaN(nodeId)) return null;
  return resolveElementByNodeId(nodeId);
}

export function resolveElement(args: InspectElementArgs): Element | null {
  const resolveVisibleFallback = (el: Element | null): Element | null => {
    if (!el) return null;
    if (isElementVisible(el)) return el;
    const parent = el.parentElement;
    if (!parent) return el;
    const visibleSibling = Array.from(parent.children).find((s) => s !== el && isElementVisible(s));
    return visibleSibling ?? el;
  };

  if (args.uid !== undefined) return resolveElementByUid(args.uid);
  if (args.anchorKey) return resolveAnchorKey(normalizeIncomingAnchorKey(args.anchorKey));
  if (args.ref) return getElementByRef(args.ref);
  if (args.selector) {
    try {
      const matches = Array.from(document.querySelectorAll(args.selector));
      if (matches.length === 0) return null;
      return matches.find(isElementVisible) ?? matches[0];
    } catch {
      return null;
    }
  }
  if (args.nodeId !== undefined) return resolveElementByNodeId(args.nodeId);
  return null;
}
