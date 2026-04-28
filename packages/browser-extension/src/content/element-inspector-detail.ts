/**
 * element-inspector-detail.ts — Element detail and context builder facade.
 *
 * Thin facade. Actual logic lives in element-inspector-detail-build.ts.
 *
 * @module
 */

import { generateAnchorKey } from "./enhanced-anchor.js";
import { buildDetail } from "./element-inspector-detail-build.js";
import type { ElementContext, ElementDetail } from "./element-inspector-types.js";

const LANDMARK_TAGS = new Set(["header", "nav", "main", "footer", "aside", "section", "article", "form"]);

function getNearestLandmark(element: Element): string | undefined {
  let current = element.parentElement;
  while (current) {
    const tag = current.tagName.toLowerCase();
    if (LANDMARK_TAGS.has(tag)) return tag;
    const role = current.getAttribute("role");
    if (role && LANDMARK_TAGS.has(role)) return role;
    current = current.parentElement;
  }
  return undefined;
}

function describeElement(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const id = el.id ? `#${el.id}` : "";
  const cls = el.classList.length > 0 ? `.${Array.from(el.classList).slice(0, 2).join(".")}` : "";
  return `${tag}${id}${cls}`;
}

function buildContext(element: Element): ElementContext {
  const parentChain: string[] = [];
  let current = element.parentElement;
  let depth = 0;
  while (current && depth < 3) {
    parentChain.unshift(describeElement(current));
    current = current.parentElement;
    depth++;
  }

  const parent = element.parentElement;
  const siblings = parent ? Array.from(parent.children) : [element];
  return {
    parentChain,
    siblingCount: siblings.length,
    siblingIndex: siblings.indexOf(element),
    nearestLandmark: getNearestLandmark(element),
  };
}

export function inspectResolvedElement(element: Element): {
  anchorKey: string;
  strategy: "id" | "data-testid" | "aria" | "css-path" | "tag-sibling" | "viewport-pct";
  confidence: "high" | "medium" | "low";
  detail: ElementDetail;
  context: ElementContext;
} {
  const { anchorKey, strategy, confidence } = generateAnchorKey(element);
  const detail = buildDetail(element);
  const context = buildContext(element);
  return { anchorKey, strategy, confidence, detail, context };
}
