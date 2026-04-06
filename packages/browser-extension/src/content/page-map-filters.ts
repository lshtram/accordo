/**
 * M102-FILT — Page Map Server-Side Filters
 *
 * Pure filtering functions applied during page map collection in the content
 * script. Each filter is an independent predicate on a DOM Element. Filters
 * compose with AND semantics (B2-FI-007): a node must pass ALL active filters
 * to be included in the result.
 *
 * Implements requirements B2-FI-001 through B2-FI-008.
 *
 * @module
 */

import type { PageMapOptions, FilterSummary } from "./page-map-collector.js";

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * A single element-level filter predicate.
 * Returns `true` if the element should be INCLUDED in the page map.
 */
export type ElementFilter = (element: Element) => boolean;

/**
 * The resolved set of active filters, ready to apply during DOM traversal.
 * Built from PageMapOptions by `buildFilterPipeline`.
 */
export interface FilterPipeline {
  /** Ordered list of filter predicates. All must return true for inclusion. */
  readonly filters: readonly ElementFilter[];
  /** Human-readable names of active filters (for FilterSummary). */
  readonly activeFilterNames: readonly string[];
  /** Whether any filters are active. */
  readonly hasFilters: boolean;
}

// ── Constants ────────────────────────────────────────────────────────────────

/**
 * B2-FI-002: Tags considered intrinsically interactive.
 * Elements with these tags pass the interactiveOnly filter without
 * needing explicit ARIA roles or event handlers.
 */
export const INTERACTIVE_TAGS: ReadonlySet<string> = new Set([
  "button", "a", "input", "select", "textarea",
]);

/**
 * B2-FI-002: Inline event handler attribute names that indicate interactivity.
 * Elements with any of these attributes pass the interactiveOnly filter.
 */
export const INTERACTIVE_EVENT_ATTRS: ReadonlySet<string> = new Set([
  "onclick", "onmousedown", "onmouseup", "onpointerdown", "onpointerup",
  "ontouchstart", "ontouchend", "onkeydown", "onkeyup", "onkeypress",
]);

/**
 * B2-FI-002: ARIA roles considered interactive.
 * Elements with these roles pass the interactiveOnly filter.
 */
export const INTERACTIVE_ROLES: ReadonlySet<string> = new Set([
  "button", "link", "textbox", "combobox", "listbox", "menuitem",
  "menuitemcheckbox", "menuitemradio", "option", "radio", "checkbox",
  "searchbox", "slider", "spinbutton", "switch", "tab",
]);

/**
 * B2-FI-003: Implicit ARIA role mapping for HTML elements.
 * Maps HTML tag names to their implicit ARIA roles, used when the element
 * does not have an explicit `role` attribute.
 *
 * Reference: WAI-ARIA in HTML (W3C) — https://www.w3.org/TR/html-aria/
 */
export const IMPLICIT_ROLE_MAP: Readonly<Record<string, string>> = {
  a: "link",
  article: "article",
  aside: "complementary",
  button: "button",
  details: "group",
  dialog: "dialog",
  footer: "contentinfo",
  form: "form",
  h1: "heading",
  h2: "heading",
  h3: "heading",
  h4: "heading",
  h5: "heading",
  h6: "heading",
  header: "banner",
  hr: "separator",
  img: "img",
  input: "textbox",
  li: "listitem",
  main: "main",
  menu: "list",
  nav: "navigation",
  ol: "list",
  option: "option",
  output: "status",
  progress: "progressbar",
  section: "region",
  select: "combobox",
  summary: "button",
  table: "table",
  tbody: "rowgroup",
  td: "cell",
  textarea: "textbox",
  tfoot: "rowgroup",
  th: "columnheader",
  thead: "rowgroup",
  tr: "row",
  ul: "list",
};

// ── Filter Predicates ────────────────────────────────────────────────────────

/**
 * B2-FI-001: Viewport intersection filter.
 * Returns true if the element's bounding box intersects the current viewport.
 */
export function isInViewport(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return false;
  const viewportHeight =
    typeof window !== "undefined"
      ? window.innerHeight || document.documentElement.clientHeight
      : 768;
  const viewportWidth =
    typeof window !== "undefined"
      ? window.innerWidth || document.documentElement.clientWidth
      : 1024;
  return (
    rect.bottom > 0 &&
    rect.right > 0 &&
    rect.top < viewportHeight &&
    rect.left < viewportWidth
  );
}

/**
 * B2-FI-002: Interactive element filter.
 * Returns true if the element is interactive according to any of:
 * - Intrinsic interactive tag: button, a, input, select, textarea
 * - Explicit interactive ARIA role (button, link, textbox, combobox, etc.)
 * - [contenteditable] attribute present and not "false"
 * - Inline event-handler attribute (onclick="...", onkeydown="...", etc.)
 * - Property-assigned onclick handler (element.onclick is a function)
 *
 * Platform limitation — addEventListener listeners (accepted, not a future TODO):
 * Listeners registered via element.addEventListener('click', ...) are NOT
 * detectable in a content-script context. No synchronous DOM API exposes
 * registered listeners; getEventListeners() is DevTools-only and unavailable
 * to content scripts. This is a hard browser platform constraint. Elements
 * whose only interactivity signal is an addEventListener listener will not be
 * detected and will be omitted by this filter. This is accepted behavior per
 * requirements B2-FI-002.
 */
export function isInteractive(element: Element): boolean {
  const tag = element.tagName.toLowerCase();
  if (INTERACTIVE_TAGS.has(tag)) return true;

  const role = element.getAttribute("role");
  if (role !== null && INTERACTIVE_ROLES.has(role.toLowerCase())) return true;

  const contentEditable = element.getAttribute("contenteditable");
  if (contentEditable !== null && contentEditable !== "false") return true;

  for (const attr of INTERACTIVE_EVENT_ATTRS) {
    if (element.hasAttribute(attr)) return true;
  }

  // Detect property-assigned onclick (e.g. element.onclick = function() {})
  // This is NOT detectable via attributes — requires checking the JS property.
  const htmlEl = element as HTMLElement;
  if (typeof htmlEl.onclick === "function") return true;

  return false;
}

/**
 * B2-FI-003: ARIA role filter factory.
 * Returns a predicate that checks whether an element's effective role
 * (explicit role attribute or implicit role from tag) matches any of the
 * specified roles. Uses IMPLICIT_ROLE_MAP for tag-to-role mapping.
 *
 * @param roles — Array of ARIA role strings to match against
 * @returns Predicate function
 */
export function matchesRoles(roles: readonly string[]): ElementFilter {
  if (roles.length === 0) return () => false;
  const normalised = new Set(roles.map((r) => r.toLowerCase()));
  return (element: Element): boolean => {
    const explicitRole = element.getAttribute("role");
    if (explicitRole !== null) {
      return normalised.has(explicitRole.toLowerCase());
    }
    const tag = element.tagName.toLowerCase();
    const implicitRole = IMPLICIT_ROLE_MAP[tag];
    return implicitRole !== undefined && normalised.has(implicitRole);
  };
}

/**
 * B2-FI-004: Text content match filter factory.
 * Returns a predicate that checks whether the element's text content
 * contains the given substring (case-insensitive).
 *
 * @param text — Substring to search for (case-insensitive)
 * @returns Predicate function
 */
export function matchesText(text: string): ElementFilter {
  if (text === "") return () => false;
  // Normalize whitespace in the needle for consistent matching
  const needle = text.replace(/\s+/g, " ").trim().toLowerCase();
  if (needle === "") return () => false;
  return (element: Element): boolean => {
    const content = (element.textContent ?? "").replace(/\s+/g, " ").trim();
    return content.toLowerCase().includes(needle);
  };
}

/**
 * B2-FI-005: CSS selector match filter factory.
 * Returns a predicate that checks whether the element matches the given
 * CSS selector. Invalid selectors are handled gracefully (always returns true).
 *
 * @param selector — CSS selector string
 * @returns Predicate function
 */
export function matchesSelector(selector: string): ElementFilter {
  if (selector === "") return () => true;
  // Validate the selector eagerly — invalid selectors fall back to always-true
  try {
    document.createElement("div").matches(selector);
  } catch {
    return () => true;
  }
  return (element: Element): boolean => {
    try {
      return element.matches(selector);
    } catch {
      return true;
    }
  };
}

/**
 * B2-FI-006: Region intersection filter factory.
 * Returns a predicate that checks whether the element's bounding box
 * intersects the specified region (viewport coordinates).
 *
 * @param region — Bounding box in viewport coordinates
 * @returns Predicate function
 */
export function intersectsRegion(
  region: { x: number; y: number; width: number; height: number },
): ElementFilter {
  return (element: Element): boolean => {
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    // AABB intersection: no overlap when one box is entirely outside the other
    const regionRight = region.x + region.width;
    const regionBottom = region.y + region.height;
    const elRight = rect.left + rect.width;
    const elBottom = rect.top + rect.height;
    return (
      rect.left < regionRight &&
      elRight > region.x &&
      rect.top < regionBottom &&
      elBottom > region.y
    );
  };
}

/**
 * Treat zero/negative-size regions as unset rather than filtering everything.
 * This matches MCP callers that send a default empty region object.
 */
function hasUsableRegion(
  region: { x: number; y: number; width: number; height: number } | undefined,
): region is { x: number; y: number; width: number; height: number } {
  return region !== undefined && region.width > 0 && region.height > 0;
}

// ── Pipeline Builder ─────────────────────────────────────────────────────────

/**
 * B2-FI-007: Build a filter pipeline from PageMapOptions.
 *
 * Extracts all active filter parameters from the options and returns an
 * ordered pipeline of predicates. During DOM traversal, an element must
 * pass ALL predicates to be included (AND semantics).
 *
 * When no filter parameters are provided, returns a pipeline with
 * `hasFilters: false` so the caller can skip the filtering overhead entirely.
 *
 * @param options — Page map collection options (may contain filter params)
 * @returns Resolved filter pipeline
 */
export function buildFilterPipeline(options: PageMapOptions): FilterPipeline {
  const filters: ElementFilter[] = [];
  const activeFilterNames: string[] = [];

  if (options.visibleOnly) {
    filters.push(isInViewport);
    activeFilterNames.push("visibleOnly");
  }

  if (options.interactiveOnly) {
    filters.push(isInteractive);
    activeFilterNames.push("interactiveOnly");
  }

  if (options.roles && options.roles.length > 0) {
    filters.push(matchesRoles(options.roles));
    activeFilterNames.push("roles");
  }

  if (options.textMatch) {
    filters.push(matchesText(options.textMatch));
    activeFilterNames.push("textMatch");
  }

  if (options.selector) {
    filters.push(matchesSelector(options.selector));
    activeFilterNames.push("selector");
  }

  if (hasUsableRegion(options.regionFilter)) {
    filters.push(intersectsRegion(options.regionFilter));
    activeFilterNames.push("regionFilter");
  }

  const hasFilters = filters.length > 0;
  return { filters, activeFilterNames, hasFilters };
}

/**
 * B2-FI-007: Apply the filter pipeline to a single DOM element.
 *
 * Returns `true` if the element passes all active filters (AND composition).
 * If the pipeline has no filters, always returns `true`.
 *
 * @param pipeline — Resolved filter pipeline from buildFilterPipeline
 * @param element — DOM element to test
 * @returns Whether the element passes all filters
 */
export function applyFilters(pipeline: FilterPipeline, element: Element): boolean {
  for (const filter of pipeline.filters) {
    if (!filter(element)) return false;
  }
  return true;
}

/**
 * B2-FI-008: Build a FilterSummary describing the filtering outcome.
 *
 * Called after collection is complete to report which filters were active,
 * how many nodes were before/after filtering, and the reduction ratio.
 *
 * @param pipeline — The filter pipeline that was applied
 * @param totalBeforeFilter — Total DOM elements before filtering
 * @param totalAfterFilter — Nodes in the result after filtering
 * @returns FilterSummary object, or undefined if no filters were active
 */
export function buildFilterSummary(
  pipeline: FilterPipeline,
  totalBeforeFilter: number,
  totalAfterFilter: number,
): FilterSummary | undefined {
  if (!pipeline.hasFilters) return undefined;
  const reductionRatio =
    totalBeforeFilter === 0
      ? 0
      : (totalBeforeFilter - totalAfterFilter) / totalBeforeFilter;
  return {
    activeFilters: [...pipeline.activeFilterNames],
    totalBeforeFilter,
    totalAfterFilter,
    reductionRatio,
  };
}
