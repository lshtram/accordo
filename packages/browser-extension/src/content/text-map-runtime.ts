import type { TextSegment, TextVisibility } from "./text-map-types.js";
import { TAG_ROLES, TEXT_EXCLUDED_TAGS, VERTICAL_BAND_TOLERANCE_PX } from "./text-map-types.js";

export function getElementRect(el: HTMLElement): DOMRect {
  const win = window as unknown as Record<string, unknown>;
  if (typeof win["__accordoTestGetBoundingClientRect"] === "function") {
    return (win["__accordoTestGetBoundingClientRect"] as (this: HTMLElement) => DOMRect).call(el);
  }
  return el.getBoundingClientRect();
}

export function getVisibility(el: HTMLElement): TextVisibility {
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

export function getRole(el: HTMLElement): string | undefined {
  const explicit = el.getAttribute("role");
  if (explicit !== null && explicit.length > 0) return explicit;
  return TAG_ROLES[el.tagName.toLowerCase()];
}

export function getAccessibleName(el: HTMLElement, textContent?: string): string | undefined {
  const ariaLabel = el.getAttribute("aria-label");
  if (ariaLabel !== null && ariaLabel.length > 0) return ariaLabel;
  const alt = el.getAttribute("alt");
  if (alt !== null && alt.length > 0) return alt;
  const title = el.getAttribute("title");
  if (title !== null && title.length > 0) return title;
  const tag = el.tagName.toLowerCase();
  const TEXT_NAME_TAGS = new Set(["a", "button", "h1", "h2", "h3", "h4", "h5", "h6", "label", "summary"]);
  if (TEXT_NAME_TAGS.has(tag) && textContent && textContent.length > 0) return textContent;
  const explicitRole = el.getAttribute("role");
  if (explicitRole !== null) {
    const TEXT_NAME_ROLES = new Set(["link", "button", "heading", "tab", "menuitem", "option", "treeitem"]);
    if (TEXT_NAME_ROLES.has(explicitRole.toLowerCase()) && textContent && textContent.length > 0) return textContent;
  }
  return undefined;
}

export function getDirectText(el: HTMLElement): string {
  let text = "";
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      text += child.textContent ?? "";
    }
  }
  return text;
}

export function collectRawSegments(doc: Document, frameId: string = "main"): TextSegment[] {
  const segments: TextSegment[] = [];
  let nodeIdCounter = 0;
  if (!(doc.body instanceof HTMLElement)) return segments;

  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_ELEMENT);
  let current: Node | null = walker.currentNode;
  while (current !== null) {
    if (current instanceof HTMLElement) {
      const tag = current.tagName.toLowerCase();
      if (!TEXT_EXCLUDED_TAGS.has(tag)) {
        try {
          const rawText = getDirectText(current);
          if (rawText.trim().length === 0) {
            current = walker.nextNode();
            continue;
          }

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
            bbox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            visibility,
            readingOrderIndex: 0,
          };
          if (role !== undefined) segment.role = role;
          if (accessibleName !== undefined) segment.accessibleName = accessibleName;
          segments.push(segment);
        } catch {
          // Skip only the problematic element
        }
      }
    }
    current = walker.nextNode();
  }

  return segments;
}

export function assignReadingOrder(segments: TextSegment[], doc: Document): void {
  const isRTL = doc.dir === "rtl";
  segments.sort((a, b) => {
    const aMidY = a.bbox.y + a.bbox.height / 2;
    const bMidY = b.bbox.y + b.bbox.height / 2;
    if (Math.abs(aMidY - bMidY) > VERTICAL_BAND_TOLERANCE_PX) {
      return aMidY - bMidY;
    }
    return isRTL ? b.bbox.x - a.bbox.x : a.bbox.x - b.bbox.x;
  });

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg !== undefined) seg.readingOrderIndex = i;
  }
}
