/**
 * M113-SEM — Semantic Graph shared node ID registry and visibility helpers.
 *
 * @module
 */

// ── Constants ─────────────────────────────────────────────────────────────────

/** Default maximum depth for a11y tree traversal. B2-SG-008. */
export const DEFAULT_MAX_DEPTH = 8;

/** Maximum allowed depth for a11y tree traversal. B2-SG-008. */
export const MAX_DEPTH_LIMIT = 16;

/** Relay timeout for semantic graph collection (ms). B2-SG-010. */
export const SEMANTIC_GRAPH_TIMEOUT_MS = 15_000;

// ── Node ID Registry ──────────────────────────────────────────────────────────

/**
 * Per-call node ID counter. Shared across all four sub-trees so that
 * the same DOM element always gets the same nodeId regardless of which
 * sub-tree references it. B2-SG-006.
 */
export class NodeIdRegistry {
  private readonly elementIds = new Map<Element, number>();
  private counter = 0;

  /** Get or assign a stable nodeId for an element. */
  idFor(el: Element): number {
    const existing = this.elementIds.get(el);
    if (existing !== undefined) return existing;
    const id = this.counter++;
    this.elementIds.set(el, id);
    return id;
  }
}

// ── Visibility helpers ────────────────────────────────────────────────────────

/**
 * Get bounding client rect for an element.
 *
 * In the test environment, `vi.stubGlobal("getBoundingClientRect", fn)` patches
 * `window.getBoundingClientRect` with a function that uses `this` as the element.
 * This wrapper calls that patched global when available, falling back to the
 * standard element method in real browser contexts.
 */
export function getElementRect(el: HTMLElement): DOMRect {
  const win = window as unknown as Record<string, unknown>;
  if (typeof win["getBoundingClientRect"] === "function") {
    return (win["getBoundingClientRect"] as (this: HTMLElement) => DOMRect).call(el);
  }
  return el.getBoundingClientRect();
}

/**
 * Determine whether an element is hidden (display:none, visibility:hidden, etc.).
 * B2-SG-009.
 */
export function isHidden(el: HTMLElement): boolean {
  const style = window.getComputedStyle(el);
  return (
    style.display === "none" ||
    style.visibility === "hidden" ||
    style.visibility === "collapse" ||
    style.opacity === "0" ||
    el.hasAttribute("hidden")
  );
}

// ── Role Maps ─────────────────────────────────────────────────────────────────

/** Tags excluded from a11y tree traversal (non-content). */
export const EXCLUDED_TAGS: ReadonlySet<string> = new Set([
  "script", "style", "noscript", "template", "link", "meta",
]);

/** Landmark role whitelist. B2-SG-003. */
export const LANDMARK_ROLES: ReadonlySet<string> = new Set([
  "navigation",
  "main",
  "banner",
  "contentinfo",
  "complementary",
  "search",
  "form",
  "region",
]);

/** Implicit ARIA roles for landmark HTML elements. B2-SG-014. */
export const LANDMARK_TAG_ROLES: Readonly<Record<string, string>> = {
  header: "banner",
  nav: "navigation",
  main: "main",
  aside: "complementary",
  footer: "contentinfo",
  form: "form",
  search: "search",
  // <section> is handled with label check — not included here
};

/** Implicit ARIA roles for all recognized HTML elements. B2-SG-014. */
export const TAG_ROLES: Readonly<Record<string, string>> = {
  ...LANDMARK_TAG_ROLES,
  h1: "heading",
  h2: "heading",
  h3: "heading",
  h4: "heading",
  h5: "heading",
  h6: "heading",
  button: "button",
  a: "link",
  img: "img",
  table: "table",
  input: "textbox",
  textarea: "textbox",
  select: "listbox",
  ul: "list",
  ol: "list",
  li: "listitem",
  article: "article",
  div: "generic",
  span: "generic",
};

// ── Accessible name computation ───────────────────────────────────────────────

/**
 * Compute the accessible name for an element.
 * Priority: aria-label > aria-labelledby (resolved text) > alt > title >
 *           direct text content (trimmed).
 */
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

/**
 * Return true when an element has any accessible label
 * (aria-label, aria-labelledby, or title).
 * Used to decide whether <section> maps to "region". B2-SG-014.
 */
export function hasAccessibleLabel(el: HTMLElement): boolean {
  const ariaLabel = el.getAttribute("aria-label");
  if (ariaLabel !== null && ariaLabel.trim().length > 0) return true;

  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy !== null && labelledBy.trim().length > 0) return true;

  const title = el.getAttribute("title");
  if (title !== null && title.trim().length > 0) return true;

  return false;
}

// ── Role resolution ───────────────────────────────────────────────────────────

/**
 * Get the explicit or implicit ARIA role for an element.
 * B2-SG-014: <section> maps to "region" only when it has an accessible label.
 */
export function getRole(el: HTMLElement): string | undefined {
  const explicit = el.getAttribute("role");
  if (explicit !== null && explicit.trim().length > 0) return explicit.trim();

  const tag = el.tagName.toLowerCase();

  // B2-SG-014: <section> → "region" only when labelled
  if (tag === "section") {
    return hasAccessibleLabel(el) ? "region" : undefined;
  }

  return TAG_ROLES[tag];
}
