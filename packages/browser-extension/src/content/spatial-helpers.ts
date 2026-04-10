/**
 * GAP-D1 — Spatial Geometry Helpers
 *
 * Pure functions for computing spatial relationships between DOM elements.
 * All functions operate on DOMRect-compatible bounding boxes — no DOM access.
 *
 * Used by:
 * - `page-map-collector.ts` for per-node `viewportRatio` and `containerId`
 * - `get_spatial_relations` MCP action for pairwise geometry queries
 *
 * Satisfies checklist items:
 * - D2: Relative geometry helpers (leftOf, above, contains, overlap, distance)
 * - D4: Viewport intersection ratios
 * - D5: Container / semantic-group membership
 *
 * @module
 */

// ── Types ────────────────────────────────────────────────────────────────────

/** Minimal bounding box — compatible with DOMRect but does not require it. */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Viewport dimensions and scroll position. */
export interface ViewportInfo {
  readonly width: number;
  readonly height: number;
  readonly scrollX: number;
  readonly scrollY: number;
}

/**
 * Pairwise spatial relationship between two elements.
 * Returned by `computeSpatialRelation()`.
 */
export interface SpatialRelation {
  /** Source node identifier */
  readonly sourceNodeId: number;
  /** Target node identifier */
  readonly targetNodeId: number;
  /** True when `source` center is to the left of `target` center. */
  readonly leftOf: boolean;
  /** True when `source` center is above `target` center. */
  readonly above: boolean;
  /** True when `source` fully contains `target`. */
  readonly contains: boolean;
  /** True when `target` fully contains `source`. */
  readonly containedBy: boolean;
  /** Intersection-over-union ratio (0–1). 0 = no overlap, 1 = identical. */
  readonly overlap: number;
  /** Center-to-center Euclidean distance in CSS px. */
  readonly distance: number;
}

/**
 * Result of `computeSpatialRelations()` — a batch of pairwise relations.
 */
export interface SpatialRelationsResult {
  /** Pairwise relationships for all requested node pairs. */
  readonly relations: readonly SpatialRelation[];
  /** Number of nodes requested. */
  readonly nodeCount: number;
  /** Number of pairwise relations computed (≤ n*(n-1)/2). */
  readonly pairCount: number;
}

// ── Constants ────────────────────────────────────────────────────────────────

/**
 * Maximum number of node IDs accepted by `computeSpatialRelations()`.
 * Pairwise computation is O(n²) — 50 nodes = 1,225 pairs max.
 */
export const MAX_SPATIAL_NODE_IDS = 50;

/**
 * Set of HTML tags considered semantic containers for `containerId` resolution.
 * When `includeBounds: true`, each page map node's nearest ancestor matching
 * one of these tags (or matching roles) is recorded as `containerId`.
 */
export const SEMANTIC_CONTAINER_TAGS: ReadonlySet<string> = new Set([
  "article",
  "section",
  "aside",
  "main",
  "dialog",
  "details",
  "nav",
  "header",
  "footer",
  "form",
]);

/**
 * ARIA roles that designate semantic containers (in addition to tag-based matching).
 */
export const SEMANTIC_CONTAINER_ROLES: ReadonlySet<string> = new Set([
  "dialog",
  "region",
  "navigation",
  "main",
  "complementary",
  "banner",
  "contentinfo",
  "form",
]);

// ── Directional helpers ──────────────────────────────────────────────────────

/**
 * Returns true when `a` is strictly to the left of `b` (no overlap or touching).
 *
 * A is strictly left when its right edge is left of b's left edge:
 *   `a.x + a.width < b.x`
 *
 * @param a — Bounding box of the first element
 * @param b — Bounding box of the second element
 * @returns true if `a` is strictly to the left of `b`
 */
export function leftOf(a: Rect, b: Rect): boolean {
  return a.x + a.width < b.x;
}

/**
 * Returns true when `a` is strictly above `b` (no overlap or touching).
 *
 * A is strictly above when its bottom edge is above b's top edge:
 *   `a.y + a.height < b.y`
 *
 * @param a — Bounding box of the first element
 * @param b — Bounding box of the second element
 * @returns true if `a` is strictly above `b`
 */
export function above(a: Rect, b: Rect): boolean {
  return a.y + a.height < b.y;
}

// ── Containment ──────────────────────────────────────────────────────────────

/**
 * Returns true when `outer` fully contains `inner`.
 *
 * All four edges of `inner` must be within or on `outer`:
 *   `inner.x >= outer.x && inner.y >= outer.y &&
 *    inner.x + inner.width <= outer.x + outer.width &&
 *    inner.y + inner.height <= outer.y + outer.height`
 *
 * @param outer — Bounding box of the potential container
 * @param inner — Bounding box of the potential contained element
 * @returns true if `outer` fully contains `inner`
 */
export function contains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

// ── Overlap ──────────────────────────────────────────────────────────────────

/**
 * Computes the Intersection-over-Union (IoU) between two bounding boxes.
 *
 * Algorithm:
 * 1. Compute the intersection rectangle (clamped to non-negative).
 * 2. `intersectionArea = max(0, overlapWidth) * max(0, overlapHeight)`
 * 3. `unionArea = areaA + areaB - intersectionArea`
 * 4. Return `intersectionArea / unionArea` (0 when unionArea is 0).
 *
 * @param a — Bounding box of the first element
 * @param b — Bounding box of the second element
 * @returns IoU ratio in [0, 1]. 0 = no overlap, 1 = identical boxes.
 */
export function overlap(a: Rect, b: Rect): number {
  // Compute intersection coordinates
  const intersectionLeft = Math.max(a.x, b.x);
  const intersectionTop = Math.max(a.y, b.y);
  const intersectionRight = Math.min(a.x + a.width, b.x + b.width);
  const intersectionBottom = Math.min(a.y + a.height, b.y + b.height);

  // Compute intersection dimensions (clamped to non-negative)
  const intersectionWidth = Math.max(0, intersectionRight - intersectionLeft);
  const intersectionHeight = Math.max(0, intersectionBottom - intersectionTop);
  const intersectionArea = intersectionWidth * intersectionHeight;

  // Compute areas
  const areaA = a.width * a.height;
  const areaB = b.width * b.height;
  const unionArea = areaA + areaB - intersectionArea;

  // Handle zero-area case (no union)
  if (unionArea === 0) return 0;

  return intersectionArea / unionArea;
}

// ── Distance ─────────────────────────────────────────────────────────────────

/**
 * Computes the Euclidean distance between the centers of two bounding boxes.
 *
 * Algorithm:
 *   `dx = (a.x + a.width/2) - (b.x + b.width/2)`
 *   `dy = (a.y + a.height/2) - (b.y + b.height/2)`
 *   `return Math.sqrt(dx*dx + dy*dy)`
 *
 * @param a — Bounding box of the first element
 * @param b — Bounding box of the second element
 * @returns Center-to-center distance in CSS pixels
 */
export function distance(a: Rect, b: Rect): number {
  const centerAx = a.x + a.width / 2;
  const centerAy = a.y + a.height / 2;
  const centerBx = b.x + b.width / 2;
  const centerBy = b.y + b.height / 2;
  const dx = centerAx - centerBx;
  const dy = centerAy - centerBy;
  return Math.sqrt(dx * dx + dy * dy);
}

// ── Viewport intersection ────────────────────────────────────────────────────

/**
 * Computes the ratio of a bounding box that intersects the visible viewport.
 *
 * The viewport rectangle is `{ x: 0, y: 0, width: vp.width, height: vp.height }`
 * (viewport-relative coordinates, no scroll offset needed since `rect` is already
 * in viewport-relative space from `getBoundingClientRect()`).
 *
 * Algorithm:
 * 1. Compute intersection of `rect` with viewport rectangle.
 * 2. `intersectionArea = max(0, overlapWidth) * max(0, overlapHeight)`
 * 3. `elementArea = rect.width * rect.height`
 * 4. Return `intersectionArea / elementArea` (0 when elementArea is 0).
 *
 * @param rect — Bounding box of the element (viewport-relative)
 * @param viewport — Viewport dimensions
 * @returns Ratio in [0, 1]. 0 = fully off-screen, 1 = fully visible.
 */
export function viewportIntersectionRatio(rect: Rect, viewport: ViewportInfo): number {
  // Viewport is at origin (0, 0) with given dimensions
  const viewportRect: Rect = { x: 0, y: 0, width: viewport.width, height: viewport.height };

  // Compute intersection of rect with viewport
  const intersectionLeft = Math.max(rect.x, viewportRect.x);
  const intersectionTop = Math.max(rect.y, viewportRect.y);
  const intersectionRight = Math.min(rect.x + rect.width, viewportRect.x + viewportRect.width);
  const intersectionBottom = Math.min(rect.y + rect.height, viewportRect.y + viewportRect.height);

  const intersectionWidth = Math.max(0, intersectionRight - intersectionLeft);
  const intersectionHeight = Math.max(0, intersectionBottom - intersectionTop);
  const intersectionArea = intersectionWidth * intersectionHeight;

  const elementArea = rect.width * rect.height;
  if (elementArea === 0) return 0;

  return intersectionArea / elementArea;
}

// ── Pairwise batch computation ───────────────────────────────────────────────

/**
 * Computes pairwise spatial relationships for a set of node bounding boxes.
 *
 * For N nodes, produces N*(N-1)/2 unique pairs (undirected — each pair once).
 * The `leftOf` and `above` fields are from source→target perspective.
 *
 * Performance: O(n²) comparisons. Capped at MAX_SPATIAL_NODE_IDS (50) nodes
 * to keep response time bounded (~1,225 pairs max).
 *
 * @param nodes — Map of nodeId → bounding box
 * @returns Pairwise spatial relationships
 * @throws Error if nodes.size exceeds MAX_SPATIAL_NODE_IDS
 */
export function computeSpatialRelations(
  nodes: ReadonlyMap<number, Rect>,
): SpatialRelationsResult {
  const nodeCount = nodes.size;

  // Handle empty or single node case
  if (nodeCount < 2) {
    return {
      relations: [],
      nodeCount,
      pairCount: 0,
    };
  }

  // Enforce limit
  if (nodeCount > MAX_SPATIAL_NODE_IDS) {
    throw new Error(`Too many nodes: ${nodeCount} exceeds limit of ${MAX_SPATIAL_NODE_IDS}`);
  }

  const relations: SpatialRelation[] = [];
  const nodeIds = Array.from(nodes.keys());

  // Iterate over all pairs (i < j to avoid duplicates)
  for (let i = 0; i < nodeIds.length; i++) {
    for (let j = i + 1; j < nodeIds.length; j++) {
      const idA = nodeIds[i];
      const idB = nodeIds[j];
      // nodeIds comes from nodes.keys() so the keys are guaranteed to exist.
      // We still check for undefined to satisfy no-non-null-assertion.
      const rectA = nodes.get(idA);
      const rectB = nodes.get(idB);
      if (!rectA || !rectB) continue;

      const relation: SpatialRelation = {
        sourceNodeId: idA,
        targetNodeId: idB,
        leftOf: leftOf(rectA, rectB),
        above: above(rectA, rectB),
        contains: contains(rectA, rectB),
        containedBy: contains(rectB, rectA),
        overlap: overlap(rectA, rectB),
        distance: distance(rectA, rectB),
      };

      relations.push(relation);
    }
  }

  return {
    relations,
    nodeCount,
    pairCount: relations.length,
  };
}

// ── Container resolution ─────────────────────────────────────────────────────

/**
 * Finds the nearest ancestor element that is a semantic container.
 *
 * Walks up the DOM tree from `element.parentElement` looking for:
 * 1. An element whose `tagName` (lowercased) is in `SEMANTIC_CONTAINER_TAGS`
 * 2. An element whose `role` attribute is in `SEMANTIC_CONTAINER_ROLES`
 *
 * Stops at `document.body` (never returns body itself as a container).
 *
 * NOTE: This is the only function in this module that accesses the DOM.
 * It is called during page map collection (not during `get_spatial_relations`).
 *
 * @param element — The element to find the container for
 * @returns The nearest semantic container element, or null if none found
 */
export function findNearestContainer(element: Element): Element | null {
  let current: Element | null = element.parentElement;

  while (current !== null && current !== document.body) {
    const tagName = current.tagName?.toLowerCase();
    if (tagName && SEMANTIC_CONTAINER_TAGS.has(tagName)) {
      return current;
    }

    const role = current.getAttribute?.("role");
    if (role && SEMANTIC_CONTAINER_ROLES.has(role)) {
      return current;
    }

    current = current.parentElement;
  }

  return null;
}
