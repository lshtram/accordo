import { INCLUDED_ATTRS } from "./page-map-types.js";

export function isHidden(element: Element): boolean {
  if (typeof window === "undefined") return false;
  if (element.hasAttribute("hidden")) return true;
  const style = window.getComputedStyle(element);
  return style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse" || style.opacity === "0";
}

export function isInViewport(element: Element): boolean {
  if (typeof window === "undefined") return true;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < (window.innerHeight || document.documentElement.clientHeight) && rect.left < (window.innerWidth || document.documentElement.clientWidth);
}

export function getAccessibleName(element: Element): string | undefined {
  return element.getAttribute("aria-label") ?? element.getAttribute("alt") ?? element.getAttribute("title") ?? undefined;
}

export function buildAttrs(element: Element): Record<string, string> | undefined {
  const attrs: Record<string, string> = {};
  for (const attrName of INCLUDED_ATTRS) {
    const val = element.getAttribute(attrName);
    if (val !== null) attrs[attrName] = val;
  }
  return Object.keys(attrs).length > 0 ? attrs : undefined;
}
