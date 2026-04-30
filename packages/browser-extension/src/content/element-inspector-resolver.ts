import { getElementByRef } from "./page-map-collector.js";
import { normalizeIncomingAnchorKey } from "./anchor-resolution-metadata.js";
import { resolveAnchorKey } from "./enhanced-anchor-resolution.js";
import type { InspectElementArgs } from "./element-inspector-types.js";
import { parseUid } from "./spatial-relations-grammar.js";

function isElementVisible(element: Element): boolean {
  if (element.hasAttribute("hidden")) return false;
  const style = window.getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden" && style.visibility !== "collapse" && style.opacity !== "0";
}

function resolveElementByNodeId(nodeId: number): Element | null {
  return getElementByRef(`ref-${nodeId}`);
}

function resolveElementByUid(uid: string): Element | null {
  const parsed = parseUid(uid);
  if (parsed === null) return null;
  return resolveElementByNodeId(parsed.nodeId);
}

export function resolveElement(args: InspectElementArgs): Element | null {
  // Snapshot-scoped handles (uid, ref, nodeId) take absolute precedence.
  // If present and valid, they are used exclusively — no fallback to anchorKey/selector.
  if (args.uid !== undefined) return resolveElementByUid(args.uid);
  if (args.ref !== undefined) return getElementByRef(args.ref);
  if (args.nodeId !== undefined) return resolveElementByNodeId(args.nodeId);

  // Current-DOM paths — used when no snapshot-scoped handle is present.
  if (args.anchorKey) return resolveAnchorKey(normalizeIncomingAnchorKey(args.anchorKey));
  if (args.selector) {
    const matches = Array.from(document.querySelectorAll(args.selector));
    if (matches.length === 0) return null;
    return matches.find(isElementVisible) ?? matches[0];
  }
  return null;
}
