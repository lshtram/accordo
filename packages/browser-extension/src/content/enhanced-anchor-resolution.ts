import { findAnchorElementByKey, parseAnchorKey, parseViewportAnchorKey } from "../content-anchor.js";
import type { AnchorGenerationResult, ParsedEnhancedAnchor } from "./enhanced-anchor-types.js";
import { STRATEGY_PREFIXES } from "./enhanced-anchor-types.js";
import {
  buildCssPath,
  getAriaKey,
  getTestId,
  getViewportPct,
  hasStableAncestor,
  isRenderable,
  queryBest,
  splitAnchorOffset,
} from "./enhanced-anchor-helpers.js";

export function generateAnchorKey(element: Element): AnchorGenerationResult {
  const id = element.id;
  if (id && id.trim()) {
    return { anchorKey: `id:${id}`, strategy: "id", confidence: "high" };
  }

  const testId = getTestId(element);
  if (testId) {
    return { anchorKey: `data-testid:${testId}`, strategy: "data-testid", confidence: "high" };
  }

  const ariaKey = getAriaKey(element);
  if (ariaKey) {
    return { anchorKey: `aria:${ariaKey}`, strategy: "aria", confidence: "medium" };
  }

  if (typeof document !== "undefined" && element.ownerDocument && hasStableAncestor(element)) {
    const cssPath = buildCssPath(element);
    if (cssPath && cssPath !== element.tagName.toLowerCase()) {
      return { anchorKey: `css:${cssPath}`, strategy: "css-path", confidence: "medium" };
    }
  }

  return { anchorKey: getViewportPct(element), strategy: "viewport-pct", confidence: "low" };
}

export function resolveAnchorKey(anchorKey: string): Element | null {
  const { baseKey } = splitAnchorOffset(anchorKey);

  if (baseKey.startsWith("id:")) {
    const id = baseKey.slice(3);
    const byId = document.getElementById(id);
    if (byId && isRenderable(byId)) return byId;
    const bySelector = queryBest(`[id="${id.replace(/"/g, '\\"')}"]`);
    return bySelector ?? byId;
  }

  if (baseKey.startsWith("data-testid:")) {
    const value = baseKey.slice(12);
    return queryBest(`[data-testid="${value.replace(/"/g, '\\"')}"]`);
  }

  if (baseKey.startsWith("aria:")) {
    const value = baseKey.slice(5);
    const slashIdx = value.lastIndexOf("/");
    if (slashIdx === -1) return null;
    const label = value.slice(0, slashIdx);
    const role = value.slice(slashIdx + 1);
    return queryBest(`[aria-label="${label.replace(/"/g, '\\"')}"][role="${role.replace(/"/g, '\\"')}"]`) ?? queryBest(`[aria-label="${label.replace(/"/g, '\\"')}"]`);
  }

  if (baseKey.startsWith("css:")) {
    return queryBest(baseKey.slice(4));
  }

  if (baseKey.startsWith("tag:")) {
    return findAnchorElementByKey(baseKey.slice(4));
  }

  if (baseKey.startsWith("body:")) {
    const parsed = parseViewportAnchorKey(baseKey);
    if (parsed) {
      const x = Math.max(0, Math.min(window.innerWidth - 1, Math.round((window.innerWidth * parsed.xPct) / 100)));
      const y = Math.max(0, Math.min(window.innerHeight - 1, Math.round((window.innerHeight * parsed.yPct) / 100)));
      let candidate = typeof document.elementFromPoint === "function" ? document.elementFromPoint(x, y) : null;
      while (candidate && !isRenderable(candidate)) {
        candidate = candidate.parentElement;
      }
      if (candidate === document.body || candidate === document.documentElement) {
        return null;
      }
      return candidate;
    }
    return findAnchorElementByKey(baseKey);
  }

  return findAnchorElementByKey(baseKey);
}

export function parseEnhancedAnchorKey(anchorKey: string): ParsedEnhancedAnchor | null {
  const { baseKey, offsetX, offsetY } = splitAnchorOffset(anchorKey);
  const offset = offsetX !== undefined && offsetY !== undefined ? { offsetX, offsetY } : {};

  if (baseKey.startsWith("id:")) return { strategy: "id", value: baseKey.slice(3), ...offset };
  if (baseKey.startsWith("data-testid:")) return { strategy: "data-testid", value: baseKey.slice(12), ...offset };
  if (baseKey.startsWith("aria:")) return { strategy: "aria", value: baseKey.slice(5), ...offset };
  if (baseKey.startsWith("css:")) return { strategy: "css-path", value: baseKey.slice(4), ...offset };
  if (baseKey.startsWith("tag:")) return { strategy: "tag-sibling", value: baseKey.slice(4), ...offset };
  if (baseKey.startsWith("body:")) {
    const value = baseKey.slice(5);
    const parsed = parseViewportAnchorKey(baseKey);
    if (parsed) return { strategy: "viewport-pct", value, ...offset };
    const legacyParsed = parseAnchorKey(baseKey);
    if (legacyParsed) return { strategy: "tag-sibling", value, ...offset };
    return null;
  }
  return null;
}

export function isEnhancedAnchorKey(anchorKey: string): boolean {
  const { baseKey } = splitAnchorOffset(anchorKey);
  if (baseKey.startsWith("body:")) {
    return baseKey.includes("%");
  }
  return STRATEGY_PREFIXES.some((prefix) => baseKey.startsWith(prefix));
}

export { findAnchorElementByKey, parseAnchorKey, parseViewportAnchorKey };
