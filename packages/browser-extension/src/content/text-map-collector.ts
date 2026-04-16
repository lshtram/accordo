/**
 * M112-TEXT — Text Map Collector
 *
 * Walks the visible DOM tree and returns an ordered array of TextSegment
 * objects representing the text content of the page. Each segment includes
 * raw and normalized text, bounding box, visibility state, semantic context,
 * and reading-order index.
 *
 * Implements requirements B2-TX-001 through B2-TX-008.
 *
 * @module
 */

import { captureSnapshotEnvelope } from "../snapshot-versioning.js";
import type { SnapshotEnvelope } from "../snapshot-versioning.js";

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * Visibility state of a text segment.
 *
 * B2-TX-005:
 * - `"visible"` — element is not hidden and bbox intersects viewport.
 * - `"hidden"` — element has display:none, visibility:hidden/collapse, opacity:0, or [hidden].
 * - `"offscreen"` — element is not hidden but bbox does not intersect viewport.
 */
export type TextVisibility = "visible" | "hidden" | "offscreen";

/**
 * A single text segment in the text map.
 *
 * B2-TX-001..006: Each segment corresponds to a contiguous run of text
 * within a single DOM element.
 */
export interface TextSegment {
  /** B2-TX-003: Original text with whitespace preserved. */
  textRaw: string;
  /** B2-TX-003: Whitespace-normalized text (collapsed runs, trimmed). */
  textNormalized: string;
  /** B2-TX-002: Node ID matching the ref index (same space as page map nodeId). */
  nodeId: number;
  /**
   * B2-UID-001: Canonical node identity across frames.
   * Shaped as "{frameId}:{nodeId}" — e.g. "main:3" or "iframe-1:0".
   */
  uid?: string;
  /** B2-TX-006: ARIA role or implicit HTML role (e.g. "heading" for h1–h6). */
  role?: string;
  /** B2-TX-006: Accessible name (aria-label, alt, title, or derived). */
  accessibleName?: string;
  /** B2-TX-002: Bounding box in viewport coordinates. */
  bbox: { x: number; y: number; width: number; height: number };
  /** B2-TX-005: Visibility state of the containing element. */
  visibility: TextVisibility;
  /** B2-TX-004: 0-based reading order index (top-to-bottom, left-to-right). */
  readingOrderIndex: number;
}

/**
 * Options for text map collection.
 *
 * B2-TX-008: maxSegments caps the number of returned segments.
 */
export interface TextMapOptions {
  /** Maximum number of segments to return (default: 500, max: 2000). B2-TX-008. */
  maxSegments?: number;
}

/**
 * Result of text map collection — includes full SnapshotEnvelope (B2-TX-007).
 */
export interface TextMapResult extends SnapshotEnvelope {
  /** Page URL (normalized: origin + pathname). */
  pageUrl: string;
  /** Page title. */
  title: string;
  /** Ordered array of text segments. B2-TX-001. */
  segments: TextSegment[];
  /** Total number of text segments found (before truncation). */
  totalSegments: number;
  /** Whether the result was truncated by maxSegments. B2-TX-008. */
  truncated: boolean;
}

// ── Constants ────────────────────────────────────────────────────────────────

/** Default maximum segment count. B2-TX-008. */
export const DEFAULT_MAX_SEGMENTS = 500;

/** Maximum allowed segment count. B2-TX-008. */
export const MAX_SEGMENTS_LIMIT = 2000;

/** Tags excluded from text extraction (non-content). */
export const TEXT_EXCLUDED_TAGS: ReadonlySet<string> = new Set([
  "script", "style", "noscript", "template", "link", "meta",
]);

/**
 * Vertical band tolerance in pixels for reading-order grouping.
 * B2-TX-004: Two segments are in the same vertical band when their
 * vertical midpoints are within this threshold.
 */
export const VERTICAL_BAND_TOLERANCE_PX = 5;

/** Implicit ARIA roles by HTML tag name. B2-TX-006. */
const TAG_ROLES: Readonly<Record<string, string>> = {
  h1: "heading",
  h2: "heading",
  h3: "heading",
  h4: "heading",
  h5: "heading",
  h6: "heading",
  button: "button",
  a: "link",
  img: "img",
  nav: "navigation",
  main: "main",
  header: "banner",
  footer: "contentinfo",
  form: "form",
  table: "table",
  input: "textbox",
  textarea: "textbox",
  select: "listbox",
  ul: "list",
  ol: "list",
  li: "listitem",
};

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Get bounding client rect for an element.
 *
 * In the test environment, `vi.stubGlobal("getBoundingClientRect", fn)` patches
 * `window.getBoundingClientRect` with a function that uses `this` as the element.
 * This wrapper calls that patched global when available, falling back to the
 * standard element method in real browser contexts.
 */
function getElementRect(el: HTMLElement): DOMRect {
  const win = window as unknown as Record<string, unknown>;
  if (typeof win["getBoundingClientRect"] === "function") {
    return (win["getBoundingClientRect"] as (this: HTMLElement) => DOMRect).call(el);
  }
  return el.getBoundingClientRect();
}

/**
 * Determine the visibility state of a DOM element. B2-TX-005.
 */
function getVisibility(el: HTMLElement): TextVisibility {
  const style = window.getComputedStyle(el);
  if (
    style.display === "none" ||
    style.visibility === "hidden" ||
    style.visibility === "collapse" ||
    style.opacity === "0" ||
    el.hasAttribute("hidden")
  ) {
    return "hidden";
  }
  const rect = getElementRect(el);
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (rect.right <= 0 || rect.bottom <= 0 || rect.left >= vw || rect.top >= vh) {
    return "offscreen";
  }
  return "visible";
}

/**
 * Get the implicit or explicit ARIA role for an element. B2-TX-006.
 * Returns `undefined` for elements with no applicable role.
 */
function getRole(el: HTMLElement): string | undefined {
  const explicit = el.getAttribute("role");
  if (explicit !== null && explicit.length > 0) return explicit;
  const tag = el.tagName.toLowerCase();
  return TAG_ROLES[tag];
}

/**
 * Get the accessible name for an element. B2-TX-006.
 * Priority: aria-label > alt > title > text content.
 * For elements where the accessible name IS the text content (buttons, links, headings),
 * the normalized text content is returned as the accessible name (ARIA spec § 4.3 accname).
 * Returns `undefined` when no name is derivable (e.g. non-semantic div with no label).
 */
function getAccessibleName(el: HTMLElement, textContent?: string): string | undefined {
  const ariaLabel = el.getAttribute("aria-label");
  if (ariaLabel !== null && ariaLabel.length > 0) return ariaLabel;
  const alt = el.getAttribute("alt");
  if (alt !== null && alt.length > 0) return alt;
  const title = el.getAttribute("title");
  if (title !== null && title.length > 0) return title;
  // Fall back to text content for semantic roles where text IS the accessible name.
  // This matches the ARIA spec (accname-1.1 §4.3): links, buttons, headings, etc.
  const tag = el.tagName.toLowerCase();
  const TEXT_NAME_TAGS = new Set(["a", "button", "h1", "h2", "h3", "h4", "h5", "h6", "label", "summary"]);
  if (TEXT_NAME_TAGS.has(tag) && textContent && textContent.length > 0) {
    return textContent;
  }
  // Also use text content when element has an explicit role that implies text-naming
  const explicitRole = el.getAttribute("role");
  if (explicitRole !== null) {
    const TEXT_NAME_ROLES = new Set(["link", "button", "heading", "tab", "menuitem", "option", "treeitem"]);
    if (TEXT_NAME_ROLES.has(explicitRole.toLowerCase()) && textContent && textContent.length > 0) {
      return textContent;
    }
  }
  return undefined;
}

/**
 * Get the direct text content of an element (from text-node children only,
 * not recursively from descendants). Returns empty string when no direct text.
 */
function getDirectText(el: HTMLElement): string {
  let text = "";
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      text += child.textContent ?? "";
    }
  }
  return text;
}

/**
 * Collect raw segments by walking the DOM with a TreeWalker. B2-TX-001..006.
 * Assigns sequential nodeId values (0-based, per-call scoped). B2-TX-002.
 *
 * @param doc - Document to walk
 * @param frameId - Frame identifier used when building canonical uid. Defaults to "main".
 * @returns Unsorted array of segments before reading-order assignment
 */
function collectRawSegments(doc: Document, frameId: string = "main"): TextSegment[] {
  const segments: TextSegment[] = [];
  let nodeIdCounter = 0;

  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_ELEMENT);

  let current: Node | null = walker.currentNode;
  while (current !== null) {
    if (current instanceof HTMLElement) {
      const tag = current.tagName.toLowerCase();

      if (!TEXT_EXCLUDED_TAGS.has(tag)) {
        const rawText = getDirectText(current);
        if (rawText.trim().length > 0) {
          const rect = getElementRect(current);
          const visibility = getVisibility(current);
          const role = getRole(current);
          const normalizedText = rawText.replace(/\s+/g, " ").trim();
          const accessibleName = getAccessibleName(current, normalizedText);
          const nodeId = nodeIdCounter++;

          const segment: TextSegment = {
            textRaw: rawText,
            textNormalized: normalizedText,
            nodeId,
            uid: `${frameId}:${nodeId}`,
            bbox: {
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
            },
            visibility,
            readingOrderIndex: 0, // assigned after sorting
          };

          if (role !== undefined) segment.role = role;
          if (accessibleName !== undefined) segment.accessibleName = accessibleName;

          segments.push(segment);
        }
      }
    }
    current = walker.nextNode();
  }

  return segments;
}

/**
 * Sort segments into reading order (top-to-bottom, LTR or RTL within bands).
 * Assigns `readingOrderIndex` to each segment after sorting. B2-TX-004.
 *
 * @param segments - Segments to sort in-place
 * @param doc - Document (used to check `document.dir` for RTL)
 */
function assignReadingOrder(segments: TextSegment[], doc: Document): void {
  const isRTL = doc.dir === "rtl";

  segments.sort((a, b) => {
    const aMidY = a.bbox.y + a.bbox.height / 2;
    const bMidY = b.bbox.y + b.bbox.height / 2;
    if (Math.abs(aMidY - bMidY) > VERTICAL_BAND_TOLERANCE_PX) {
      return aMidY - bMidY;
    }
    // Same vertical band — sort by x (LTR: ascending, RTL: descending)
    return isRTL ? b.bbox.x - a.bbox.x : a.bbox.x - b.bbox.x;
  });

  for (let i = 0; i < segments.length; i++) {
    // Safe: we just created these segments above so non-null index is guaranteed
    const seg = segments[i];
    if (seg !== undefined) {
      seg.readingOrderIndex = i;
    }
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Collect a text map from the current document.
 *
 * Walks the DOM tree, extracts text nodes, computes bounding boxes,
 * determines visibility state, assigns reading-order indices, and
 * returns structured TextSegment objects.
 *
 * B2-TX-001: Visible text extraction.
 * B2-TX-002: Per-segment source mapping (nodeId + bbox).
 * B2-TX-003: Raw and normalized text modes.
 * B2-TX-004: Reading-order indices.
 * B2-TX-005: Visibility flags.
 * B2-TX-006: Semantic context (role + accessibleName).
 * B2-TX-007: SnapshotEnvelope compliance.
 * B2-TX-008: maxSegments truncation.
 *
 * @param options - Collection options (maxSegments)
 * @returns Text map with segments and metadata
 */
export function collectTextMap(options?: TextMapOptions): TextMapResult {
  // B2-TX-007: capture snapshot envelope first so we can use its frameId
  const envelope: SnapshotEnvelope = captureSnapshotEnvelope("dom");
  const frameId = envelope.frameId ?? "main";

  // B2-TX-008: resolve effective max, clamp to MAX_SEGMENTS_LIMIT
  const requestedMax = options?.maxSegments ?? DEFAULT_MAX_SEGMENTS;
  const effectiveMax = Math.min(requestedMax, MAX_SEGMENTS_LIMIT);

  // Collect all raw segments with uid built from frameId
  const allSegments = collectRawSegments(document, frameId);

  // B2-TX-004: assign reading order indices after sorting
  assignReadingOrder(allSegments, document);

  const totalSegments = allSegments.length;

  // B2-TX-008: truncate if needed
  const truncated = totalSegments > effectiveMax;
  const segments = truncated ? allSegments.slice(0, effectiveMax) : allSegments;

  return {
    ...envelope,
    pageUrl: window.location.origin + window.location.pathname,
    title: document.title,
    segments,
    totalSegments,
    truncated,
  };
}
