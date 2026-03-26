/**
 * M90-ANC — Enhanced Anchor System
 *
 * Extends the existing anchor system with a tiered strategy hierarchy
 * for more stable element identification. Backward compatible with
 * existing tagName:siblingIndex:textFingerprint anchor keys.
 *
 * Implements requirements PU-F-20 through PU-F-26.
 *
 * @module
 */

import { findAnchorElementByKey, parseAnchorKey, parseViewportAnchorKey } from "../content-anchor.js";

// ── Types ────────────────────────────────────────────────────────────────────

/** Anchor strategies in order of stability (most stable first) */
export type AnchorStrategy =
  | "id"           // element has a unique id attribute
  | "data-testid"  // element has data-testid (or data-cy, data-test)
  | "aria"         // element has aria-label + role combination
  | "css-path"     // generated CSS selector path
  | "tag-sibling"  // existing tagName:siblingIndex:textFingerprint
  | "viewport-pct" // viewport percentage (least stable)
  ;

/** Result of anchor key generation */
export interface AnchorGenerationResult {
  /** The generated anchor key */
  anchorKey: string;
  /** Which strategy was used */
  strategy: AnchorStrategy;
  /** Confidence level based on strategy stability */
  confidence: "high" | "medium" | "low";
}

/** Parsed enhanced anchor key */
export interface ParsedEnhancedAnchor {
  /** The strategy used to create this anchor */
  strategy: AnchorStrategy;
  /** The strategy-specific value */
  value: string;
  /** Optional offset coordinates */
  offsetX?: number;
  offsetY?: number;
}

// ── Strategy Confidence Mapping ──────────────────────────────────────────────

/** Maps each strategy to its confidence level */
export const STRATEGY_CONFIDENCE: Readonly<Record<AnchorStrategy, "high" | "medium" | "low">> = {
  "id": "high",
  "data-testid": "high",
  "aria": "medium",
  "css-path": "medium",
  "tag-sibling": "low",
  "viewport-pct": "low",
};

/** Strategy prefixes used in anchor key encoding */
export const STRATEGY_PREFIXES: readonly string[] = [
  "id:", "data-testid:", "aria:", "css:", "tag:", "body:",
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function getTestId(element: Element): string | null {
  return (
    element.getAttribute("data-testid") ??
    element.getAttribute("data-cy") ??
    element.getAttribute("data-test") ??
    null
  );
}

function getAriaKey(element: Element): string | null {
  const label = element.getAttribute("aria-label");
  const role = element.getAttribute("role") ?? element.tagName.toLowerCase();
  if (label) return `${label}/${role}`;
  return null;
}

function buildCssPath(element: Element): string {
  const parts: string[] = [];
  let current: Element | null = element;
  while (current && current !== document.documentElement) {
    const tag = current.tagName.toLowerCase();
    const parentEl: Element | null = current.parentElement;
    if (!parentEl) {
      parts.unshift(tag);
      break;
    }
    const currentTag = current.tagName;
    const siblings = Array.from(parentEl.children).filter(
      (c) => c.tagName === currentTag,
    );
    if (siblings.length === 1) {
      parts.unshift(tag);
    } else {
      const idx = siblings.indexOf(current) + 1;
      parts.unshift(`${tag}:nth-of-type(${idx})`);
    }
    current = parentEl;
  }
  return parts.join(">");
}

function getViewportPct(element: Element): string {
  // Guard: mock elements in tests may not have getBoundingClientRect
  if (typeof element.getBoundingClientRect !== "function") {
    return "body:50%x50%";
  }
  const rect = element.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const vw = (typeof window !== "undefined" && window.innerWidth) || 1;
  const vh = (typeof window !== "undefined" && window.innerHeight) || 1;
  const xPct = Math.round((cx / vw) * 100);
  const yPct = Math.round((cy / vh) * 100);
  return `body:${xPct}%x${yPct}%`;
}

/** Returns true if any ancestor element in the DOM has a stable id or data-testid */
function hasStableAncestor(element: Element): boolean {
  let current = element.parentElement;
  while (current && current !== document.documentElement) {
    if (current.id && current.id.trim()) return true;
    if (current.getAttribute("data-testid")) return true;
    current = current.parentElement;
  }
  return false;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Generate the best anchor key for a DOM element.
 *
 * Tries strategies in order: id → data-testid → aria → css-path → tag-sibling → viewport.
 * Returns the first available stable strategy with its confidence level.
 *
 * @param element - The DOM element to generate an anchor for
 * @returns The anchor key, strategy used, and confidence level
 */
export function generateAnchorKey(element: Element): AnchorGenerationResult {
  // 1. id strategy
  const id = element.id;
  if (id && id.trim()) {
    return { anchorKey: `id:${id}`, strategy: "id", confidence: "high" };
  }

  // 2. data-testid strategy
  const testId = getTestId(element);
  if (testId) {
    return { anchorKey: `data-testid:${testId}`, strategy: "data-testid", confidence: "high" };
  }

  // 3. aria strategy
  const ariaKey = getAriaKey(element);
  if (ariaKey) {
    return { anchorKey: `aria:${ariaKey}`, strategy: "aria", confidence: "medium" };
  }

  // 4. css-path strategy (only if element is in a real document AND has a stable ancestor)
  if (typeof document !== "undefined" && element.ownerDocument && hasStableAncestor(element)) {
    const cssPath = buildCssPath(element);
    if (cssPath && cssPath !== element.tagName.toLowerCase()) {
      return { anchorKey: `css:${cssPath}`, strategy: "css-path", confidence: "medium" };
    }
  }

  // 5. viewport-pct as last resort
  const viewportKey = getViewportPct(element);
  return { anchorKey: viewportKey, strategy: "viewport-pct", confidence: "low" };
}

/**
 * Resolve an anchor key back to a DOM element.
 *
 * Dispatches resolution based on the strategy prefix in the anchor key.
 * Falls back through the strategy hierarchy if the primary strategy fails.
 *
 * Backward compatible: existing unprefixed keys (e.g. "button:3:submit")
 * are resolved through the existing findAnchorElementByKey() path.
 *
 * @param anchorKey - The anchor key to resolve
 * @returns The matching DOM element, or null if not found
 */
export function resolveAnchorKey(anchorKey: string): Element | null {
  // Enhanced keys: dispatch by prefix
  if (anchorKey.startsWith("id:")) {
    const id = anchorKey.slice(3);
    return document.getElementById(id);
  }

  if (anchorKey.startsWith("data-testid:")) {
    const value = anchorKey.slice(12);
    return document.querySelector(`[data-testid="${value}"]`);
  }

  if (anchorKey.startsWith("aria:")) {
    const value = anchorKey.slice(5);
    const slashIdx = value.lastIndexOf("/");
    if (slashIdx === -1) return null;
    const label = value.slice(0, slashIdx);
    const role = value.slice(slashIdx + 1);
    return (
      document.querySelector(`[aria-label="${label}"][role="${role}"]`) ??
      document.querySelector(`[aria-label="${label}"]`)
    );
  }

  if (anchorKey.startsWith("css:")) {
    const selector = anchorKey.slice(4);
    try {
      return document.querySelector(selector);
    } catch (error: unknown) {
      return null;
    }
  }

  if (anchorKey.startsWith("tag:")) {
    const legacyKey = anchorKey.slice(4);
    return findAnchorElementByKey(legacyKey);
  }

  if (anchorKey.startsWith("body:")) {
    // viewport-pct format: body:x%xy%
    const parsed = parseViewportAnchorKey(anchorKey);
    if (parsed) {
      return document.body;
    }
    // Could be a legacy tag-sibling key starting with "body" tag
    return findAnchorElementByKey(anchorKey);
  }

  // Legacy unprefixed keys (e.g. "button:3:submit")
  return findAnchorElementByKey(anchorKey);
}

/**
 * Parse an enhanced anchor key into its components.
 *
 * Handles both new strategy-prefixed keys and legacy unprefixed keys.
 *
 * @param anchorKey - The anchor key to parse
 * @returns Parsed anchor components, or null if unparseable
 */
export function parseEnhancedAnchorKey(anchorKey: string): ParsedEnhancedAnchor | null {
  if (anchorKey.startsWith("id:")) {
    return { strategy: "id", value: anchorKey.slice(3) };
  }

  if (anchorKey.startsWith("data-testid:")) {
    return { strategy: "data-testid", value: anchorKey.slice(12) };
  }

  if (anchorKey.startsWith("aria:")) {
    return { strategy: "aria", value: anchorKey.slice(5) };
  }

  if (anchorKey.startsWith("css:")) {
    return { strategy: "css-path", value: anchorKey.slice(4) };
  }

  if (anchorKey.startsWith("tag:")) {
    return { strategy: "tag-sibling", value: anchorKey.slice(4) };
  }

  if (anchorKey.startsWith("body:")) {
    const value = anchorKey.slice(5);
    const parsed = parseViewportAnchorKey(anchorKey);
    if (parsed) {
      return { strategy: "viewport-pct", value };
    }
    // Legacy tag-sibling body key — treat as legacy, not parseable as enhanced
    const legacyParsed = parseAnchorKey(anchorKey);
    if (legacyParsed) {
      return { strategy: "tag-sibling", value };
    }
    return null;
  }

  return null;
}

/**
 * Check if an anchor key uses the enhanced format (has strategy prefix).
 *
 * The "body:" prefix is shared between the viewport-pct strategy
 * (e.g. body:42%x63%) and legacy tag-sibling keys (e.g. body:0:center).
 * Only viewport-pct keys (containing a "%" character) are enhanced;
 * legacy tag-sibling body keys are NOT enhanced.
 *
 * @param anchorKey - The anchor key to check
 * @returns true if the key uses enhanced format
 */
export function isEnhancedAnchorKey(anchorKey: string): boolean {
  if (anchorKey.startsWith("body:")) {
    // Only viewport-pct body keys (e.g. body:42%x63%) are enhanced
    return anchorKey.includes("%");
  }
  return STRATEGY_PREFIXES.some((prefix) => anchorKey.startsWith(prefix));
}

// Re-export existing anchor functions for backward compatibility
export { findAnchorElementByKey, parseAnchorKey, parseViewportAnchorKey };
