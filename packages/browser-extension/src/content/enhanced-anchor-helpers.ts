export function splitAnchorOffset(anchorKey: string): { baseKey: string; offsetX?: number; offsetY?: number } {
  const at = anchorKey.lastIndexOf("@");
  if (at <= 0) return { baseKey: anchorKey };

  const offsetRaw = anchorKey.slice(at + 1);
  const comma = offsetRaw.indexOf(",");
  if (comma === -1) return { baseKey: anchorKey };

  const offsetX = Number(offsetRaw.slice(0, comma));
  const offsetY = Number(offsetRaw.slice(comma + 1));
  if (!Number.isFinite(offsetX) || !Number.isFinite(offsetY)) {
    return { baseKey: anchorKey };
  }

  return { baseKey: anchorKey.slice(0, at), offsetX, offsetY };
}

export function isRenderable(element: Element): boolean {
  if (typeof window === "undefined") return true;
  if (element.hasAttribute("hidden")) return false;
  const style = window.getComputedStyle(element);
  if (style.display === "none") return false;
  if (style.visibility === "hidden" || style.visibility === "collapse") return false;
  if (style.opacity === "0") return false;
  return true;
}

export function chooseBestElement(candidates: Element[]): Element | null {
  if (candidates.length === 0) return null;
  const renderable = candidates.filter(isRenderable);
  if (renderable.length > 0) return renderable[0];
  return candidates[0];
}

export function queryBest(selector: string): Element | null {
  try {
    const matches = Array.from(document.querySelectorAll(selector));
    return chooseBestElement(matches);
  } catch {
    return null;
  }
}

export function getTestId(element: Element): string | null {
  return element.getAttribute("data-testid") ?? element.getAttribute("data-cy") ?? element.getAttribute("data-test") ?? null;
}

export function getAriaKey(element: Element): string | null {
  const label = element.getAttribute("aria-label");
  const role = element.getAttribute("role") ?? element.tagName.toLowerCase();
  if (label) return `${label}/${role}`;
  return null;
}

export function buildCssPath(element: Element): string {
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
    const siblings = Array.from(parentEl.children).filter((c: Element) => c.tagName === currentTag);
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

export function getViewportPct(element: Element): string {
  if (typeof element.getBoundingClientRect !== "function") return "body:50%x50%";
  const rect = element.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const vw = (typeof window !== "undefined" && window.innerWidth) || 1;
  const vh = (typeof window !== "undefined" && window.innerHeight) || 1;
  const xPct = Math.round((cx / vw) * 100);
  const yPct = Math.round((cy / vh) * 100);
  return `body:${xPct}%x${yPct}%`;
}

export function hasStableAncestor(element: Element): boolean {
  let current = element.parentElement;
  while (current && current !== document.documentElement) {
    if (current.id && current.id.trim()) return true;
    if (current.getAttribute("data-testid")) return true;
    current = current.parentElement;
  }
  return false;
}
