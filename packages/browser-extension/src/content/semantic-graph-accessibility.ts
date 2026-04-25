import { TAG_ROLES } from "./semantic-graph-types.js";

export function getAccessibleName(el: HTMLElement): string | undefined {
  const ariaLabel = el.getAttribute("aria-label");
  if (ariaLabel !== null && ariaLabel.trim().length > 0) return ariaLabel.trim();

  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy !== null && labelledBy.trim().length > 0) {
    const ids = labelledBy.trim().split(/\s+/);
    const parts: string[] = [];
    for (const id of ids) {
      const ref = document.getElementById(id);
      if (ref !== null) {
        const text = ref.textContent?.trim();
        if (text) parts.push(text);
      }
    }
    if (parts.length > 0) return parts.join(" ");
  }

  const alt = el.getAttribute("alt");
  if (alt !== null && alt.trim().length > 0) return alt.trim();
  const title = el.getAttribute("title");
  if (title !== null && title.trim().length > 0) return title.trim();

  const tag = el.tagName.toLowerCase();
  if (["button", "h1", "h2", "h3", "h4", "h5", "h6", "a", "label"].includes(tag)) {
    const text = el.textContent?.trim();
    if (text && text.length > 0) return text;
  }
  return undefined;
}

export function hasAccessibleLabel(el: HTMLElement): boolean {
  const ariaLabel = el.getAttribute("aria-label");
  if (ariaLabel !== null && ariaLabel.trim().length > 0) return true;
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy !== null && labelledBy.trim().length > 0) return true;
  const title = el.getAttribute("title");
  if (title !== null && title.trim().length > 0) return true;
  return false;
}

export function getRole(el: HTMLElement): string | undefined {
  const explicit = el.getAttribute("role");
  if (explicit !== null && explicit.trim().length > 0) return explicit.trim();
  const tag = el.tagName.toLowerCase();
  if (tag === "section") {
    return hasAccessibleLabel(el) ? "region" : undefined;
  }
  return TAG_ROLES[tag];
}
