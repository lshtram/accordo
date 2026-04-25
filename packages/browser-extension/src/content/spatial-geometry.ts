import type { Rect, SpatialRelation, SpatialRelationsResult, ViewportInfo } from "./spatial-types.js";
import { MAX_SPATIAL_NODE_IDS } from "./spatial-types.js";

export function leftOf(a: Rect, b: Rect): boolean {
  return a.x + a.width < b.x;
}

export function above(a: Rect, b: Rect): boolean {
  return a.y + a.height < b.y;
}

export function contains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

export function overlap(a: Rect, b: Rect): number {
  const intersectionLeft = Math.max(a.x, b.x);
  const intersectionTop = Math.max(a.y, b.y);
  const intersectionRight = Math.min(a.x + a.width, b.x + b.width);
  const intersectionBottom = Math.min(a.y + a.height, b.y + b.height);
  const intersectionWidth = Math.max(0, intersectionRight - intersectionLeft);
  const intersectionHeight = Math.max(0, intersectionBottom - intersectionTop);
  const intersectionArea = intersectionWidth * intersectionHeight;
  const areaA = a.width * a.height;
  const areaB = b.width * b.height;
  const unionArea = areaA + areaB - intersectionArea;
  if (unionArea === 0) return 0;
  return intersectionArea / unionArea;
}

export function distance(a: Rect, b: Rect): number {
  const centerAx = a.x + a.width / 2;
  const centerAy = a.y + a.height / 2;
  const centerBx = b.x + b.width / 2;
  const centerBy = b.y + b.height / 2;
  const dx = centerAx - centerBx;
  const dy = centerAy - centerBy;
  return Math.sqrt(dx * dx + dy * dy);
}

export function viewportIntersectionRatio(rect: Rect, viewport: ViewportInfo): number {
  const viewportRect: Rect = { x: 0, y: 0, width: viewport.width, height: viewport.height };
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

export function computeSpatialRelations(
  nodes: ReadonlyMap<number, Rect>,
): SpatialRelationsResult {
  const nodeCount = nodes.size;
  if (nodeCount < 2) {
    return { relations: [], nodeCount, pairCount: 0 };
  }
  if (nodeCount > MAX_SPATIAL_NODE_IDS) {
    throw new Error(`Too many nodes: ${nodeCount} exceeds limit of ${MAX_SPATIAL_NODE_IDS}`);
  }

  const relations: SpatialRelation[] = [];
  const nodeIds = Array.from(nodes.keys());
  for (let i = 0; i < nodeIds.length; i++) {
    for (let j = i + 1; j < nodeIds.length; j++) {
      const idA = nodeIds[i];
      const idB = nodeIds[j];
      const rectA = nodes.get(idA);
      const rectB = nodes.get(idB);
      if (!rectA || !rectB) continue;
      relations.push({
        sourceNodeId: idA,
        targetNodeId: idB,
        leftOf: leftOf(rectA, rectB),
        above: above(rectA, rectB),
        contains: contains(rectA, rectB),
        containedBy: contains(rectB, rectA),
        overlap: overlap(rectA, rectB),
        distance: distance(rectA, rectB),
      });
    }
  }

  return { relations, nodeCount, pairCount: relations.length };
}
