/**
 * M90-INS — Element Inspector
 *
 * Provides deep inspection of a specific DOM element, including
 * computed styles, full attributes, context, and anchor generation.
 *
 * Implements requirements PU-F-10 through PU-F-15.
 *
 * @module
 */

import type { AnchorStrategy } from "./enhanced-anchor.js";
import { generateAnchorKey } from "./enhanced-anchor.js";
import { getElementByRef } from "./page-map-collector.js";
import { captureSnapshotEnvelope } from "../snapshot-versioning.js";
import type { SnapshotEnvelope } from "../snapshot-versioning.js";

// ── Types ────────────────────────────────────────────────────────────────────

/** Result of DOM excerpt extraction — includes full SnapshotEnvelope (B2-SV-003) */
export interface DomExcerptResult extends SnapshotEnvelope {
  /** Whether the element was found */
  found: boolean;
  /** Sanitized HTML excerpt */
  html?: string;
  /** Text content of the subtree */
  text?: string;
  /** Number of nodes in the excerpt */
  nodeCount?: number;
  /** Whether the HTML was truncated by maxLength */
  truncated?: boolean;
}

/**
 * Arguments for element inspection.
 *
 * Must supply at least one of: ref, selector, or nodeId.
 * B2-SV-006: nodeId is the DFS traversal index from a page map snapshot,
 * allowing agents to inspect elements by their stable snapshot node ID.
 */
export type InspectElementArgs =
  | { ref: string; selector?: string; nodeId?: undefined }
  | { ref?: string; selector: string; nodeId?: undefined }
  | { ref?: undefined; selector?: undefined; nodeId: number };

/** Context about the element's position in the DOM */
export interface ElementContext {
  /** Parent chain descriptions (tag#id.class, up to 3 ancestors) */
  parentChain: string[];
  /** Number of siblings at the same level */
  siblingCount: number;
  /** Position among siblings (0-indexed) */
  siblingIndex: number;
  /** Nearest ARIA landmark ancestor (header, nav, main, footer, etc.) */
  nearestLandmark?: string;
}

/** Detailed element information */
export interface ElementDetail {
  /** HTML tag name (lowercase) */
  tag: string;
  /** Element id attribute */
  id?: string;
  /** CSS class list */
  classList?: string[];
  /** ARIA role */
  role?: string;
  /** ARIA label */
  ariaLabel?: string;
  /** Text content (truncated) */
  textContent?: string;
  /** All attributes as key-value pairs */
  attributes: Record<string, string>;
  /** Bounding box relative to viewport */
  bounds: { x: number; y: number; width: number; height: number };
  /** Whether the element is visible (computed from CSS) */
  visible: boolean;
  /** Visibility confidence: high = truly visible, medium = offscreen/obscured, low = hidden */
  visibleConfidence: "high" | "medium" | "low";
  /** Computed accessible name */
  accessibleName?: string;
  /** Data-test-related attributes */
  testIds?: Record<string, string>;
}

/** Result of element inspection — includes full SnapshotEnvelope (B2-SV-003) */
export interface InspectElementResult extends SnapshotEnvelope {
  /** Whether the element was found */
  found: boolean;
  /** Generated anchor key using best available strategy */
  anchorKey?: string;
  /** Anchor strategy used */
  anchorStrategy?: AnchorStrategy;
  /** Anchor confidence level */
  anchorConfidence?: "high" | "medium" | "low";
  /** Element details */
  element?: ElementDetail;
  /** Surrounding context for agent reasoning */
  context?: ElementContext;
  /** Visibility confidence — always present to help agent filter unreliable results */
  visibilityConfidence?: "high" | "medium" | "low";
}

// ── Safe attribute list for HTML serialization ────────────────────────────────

const SAFE_ATTRS = new Set([
  "id", "class", "role", "aria-label", "aria-labelledby", "aria-describedby",
  "href", "src", "alt", "title", "type", "name", "value", "data-testid",
  "data-cy", "data-test", "placeholder", "for", "rel",
]);

/** Tags that must never appear in serialized output (executable/invisible content) */
const FORBIDDEN_TAGS = new Set([
  "script", "style", "iframe", "object", "embed", "link", "meta",
  "noscript", "template", "svg", "canvas",
]);

/** URL attribute names that must be checked for dangerous schemes */
const URL_ATTRS = new Set(["href", "src", "action"]);

/** Dangerous URL scheme prefixes that must be stripped */
const DANGEROUS_URL_PREFIXES = ["javascript:", "data:"];

function isSafeUrl(value: string): boolean {
  const lower = value.trim().toLowerCase();
  return !DANGEROUS_URL_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const LANDMARK_TAGS = new Set(["header", "nav", "main", "footer", "aside", "section", "article", "form"]);

/**
 * Compute a real visibility confidence for an element.
 * "high" = truly visible (has pixels, not hidden by CSS)
 * "medium" = has bounding box but may be obscured or have zero opacity
 * "low" = no meaningful bounding box (display:none, collapsed, hidden)
 */
function computeVisibilityConfidence(element: Element): "high" | "medium" | "low" {
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return "low";

  const style = window.getComputedStyle(element);
  if (
    style.display === "none" ||
    style.visibility === "hidden" ||
    style.visibility === "collapse" ||
    style.opacity === "0" ||
    element.hasAttribute("hidden")
  ) {
    return "low";
  }

  // Check z-index against viewport — if element is entirely below visible area, downgrade
  if (rect.top > window.innerHeight || rect.left > window.innerWidth) return "medium";

  return "high";
}

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
  const siblingIndex = siblings.indexOf(element);
  const siblingCount = siblings.length;
  const nearestLandmark = getNearestLandmark(element);

  return { parentChain, siblingCount, siblingIndex, nearestLandmark };
}

function buildDetail(element: Element): ElementDetail {
  const tag = element.tagName.toLowerCase();
  const id = element.id || undefined;
  const classList = element.classList.length > 0 ? Array.from(element.classList) : undefined;
  const role = element.getAttribute("role") ?? undefined;
  const ariaLabel = element.getAttribute("aria-label") ?? undefined;
  const textContent = (element.textContent ?? "").trim().slice(0, 100) || undefined;

  // Collect all attributes
  const attributes: Record<string, string> = {};
  for (const attr of Array.from(element.attributes)) {
    attributes[attr.name] = attr.value;
  }

  // Collect test-id attributes
  const testIds: Record<string, string> = {};
  for (const attr of ["data-testid", "data-cy", "data-test"]) {
    const val = element.getAttribute(attr);
    if (val !== null) testIds[attr] = val;
  }

  const rect = element.getBoundingClientRect();
  const bounds = {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };

  // Compute accessible name
  const accessibleName = ariaLabel ??
    element.getAttribute("alt") ??
    element.getAttribute("title") ??
    undefined;

  const visibleConfidence = computeVisibilityConfidence(element);
  const visible = visibleConfidence === "high";

  return {
    tag,
    id,
    classList,
    role,
    ariaLabel,
    textContent,
    attributes,
    bounds,
    visible: visibleConfidence !== "low",
    visibleConfidence,
    accessibleName,
    testIds: Object.keys(testIds).length > 0 ? testIds : undefined,
  };
}

function isElementVisible(element: Element): boolean {
  if (element.hasAttribute("hidden")) return false;
  const style = window.getComputedStyle(element);
  return (
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    style.visibility !== "collapse" &&
    style.opacity !== "0"
  );
}

/**
 * Resolve an element by nodeId (DFS traversal index) from the page map ref index.
 *
 * B2-SV-006: The nodeId is the DFS traversal index assigned during collectPageMap().
 * The ref index maps `ref-{nodeId}` → Element, so we can look up by constructing
 * the ref string from the nodeId.
 */
function resolveElementByNodeId(nodeId: number): Element | null {
  return getElementByRef(`ref-${nodeId}`);
}

function resolveElement(args: InspectElementArgs): Element | null {
  // B2-SV-006: Support lookup by nodeId from page map snapshot
  if (args.nodeId !== undefined) {
    const el = resolveElementByNodeId(args.nodeId);
    if (!el) return null;
    if (!isElementVisible(el)) {
      const parent = el.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children);
        const visibleSibling = siblings.find(
          (s) => s !== el && isElementVisible(s),
        );
        if (visibleSibling) return visibleSibling;
      }
    }
    return el;
  }
  if (args.ref) {
    const el = getElementByRef(args.ref);
    if (!el) return null;
    // If element is hidden, try to find a visible sibling or neighbour instead
    if (!isElementVisible(el)) {
      const parent = el.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children);
        const visibleSibling = siblings.find(
          (s) => s !== el && isElementVisible(s),
        );
        if (visibleSibling) return visibleSibling;
      }
    }
    return el;
  }
  if (args.selector) {
    try {
      const matches = Array.from(document.querySelectorAll(args.selector));
      if (matches.length === 0) return null;
      // Prefer a fully visible element; fall back to first match
      const visible = matches.find(isElementVisible);
      return visible ?? matches[0];
    } catch {
      return null;
    }
  }
  return null;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Inspect a specific DOM element identified by ref or CSS selector.
 *
 * Returns detailed element information including computed properties,
 * ARIA attributes, bounding box, and a generated anchor key using
 * the best available anchoring strategy.
 *
 * @param args - Element reference (from page map) or CSS selector
 * @returns Detailed element inspection result
 */
export function inspectElement(args: InspectElementArgs): InspectElementResult {
  // B2-SV-003: Capture full envelope from authoritative content script manager
  const envelope = captureSnapshotEnvelope("dom");
  const element = resolveElement(args);
  if (!element) return { ...envelope, found: false };

  const { anchorKey, strategy, confidence } = generateAnchorKey(element);
  const detail = buildDetail(element);
  const context = buildContext(element);

  return {
    ...envelope,
    found: true,
    anchorKey,
    anchorStrategy: strategy,
    anchorConfidence: confidence,
    element: detail,
    context,
    visibilityConfidence: detail.visibleConfidence,
  };
}

// ── Serialization helpers ─────────────────────────────────────────────────────

function serializeElement(
  element: Element,
  currentDepth: number,
  maxDepth: number,
  counter: { count: number },
): string {
  const tag = element.tagName.toLowerCase();

  // Skip forbidden tags entirely — do not serialize them or their children
  if (FORBIDDEN_TAGS.has(tag)) return "";

  // Collect safe attributes only — skip on* event handlers and dangerous URLs
  const attrParts: string[] = [];
  for (const attr of Array.from(element.attributes)) {
    if (attr.name.startsWith("on")) continue;
    if (!SAFE_ATTRS.has(attr.name)) continue;
    if (URL_ATTRS.has(attr.name) && !isSafeUrl(attr.value)) continue;
    attrParts.push(`${attr.name}="${attr.value.replace(/"/g, "&quot;")}"`);
  }

  const attrStr = attrParts.length > 0 ? ` ${attrParts.join(" ")}` : "";
  const openTag = `<${tag}${attrStr}>`;
  const closeTag = `</${tag}>`;

  counter.count++;

  if (currentDepth >= maxDepth || element.children.length === 0) {
    // Serialize text content only
    const text = (element.textContent ?? "").trim();
    const inner = text ? text.replace(/</g, "&lt;").replace(/>/g, "&gt;") : "";
    return `${openTag}${inner}${closeTag}`;
  }

  let inner = "";
  for (const child of Array.from(element.children)) {
    inner += serializeElement(child, currentDepth + 1, maxDepth, counter);
  }
  return `${openTag}${inner}${closeTag}`;
}

/**
 * Get a sanitized HTML excerpt for a DOM subtree.
 *
 * Returns the HTML fragment with only safe attributes retained
 * (id, class, role, aria-*). All other attributes are stripped.
 *
 * @param selector - CSS selector for the root element
 * @param maxDepth - Maximum depth of the excerpt (default: 3)
 * @param maxLength - Maximum character length of HTML output (default: 2000)
 * @returns HTML excerpt result
 */
export function getDomExcerpt(
  selector: string,
  maxDepth = 3,
  maxLength = 2000,
): DomExcerptResult {
  // B2-SV-003: Capture full envelope from authoritative content script manager
  const envelope = captureSnapshotEnvelope("dom");
  const element = resolveElement({ selector });

  if (!element) return { ...envelope, found: false };

  const counter = { count: 0 };
  let html = serializeElement(element, 0, maxDepth, counter);
  const text = (element.textContent ?? "").trim();
  const nodeCount = counter.count;

  let truncated = false;
  if (html.length > maxLength) {
    html = html.slice(0, maxLength);
    truncated = true;
  }

  return { ...envelope, found: true, html, text, nodeCount, truncated };
}
