import type { TextSegment, TextVisibility } from "./text-map-types.js";

const VISIBILITY_ORDER: Record<TextVisibility, number> = {
  visible: 0,
  offscreen: 1,
  hidden: 2,
};

export function orderSegmentsForResponse(
  segments: TextSegment[],
  visibleOnly: boolean,
): TextSegment[] {
  const filtered = visibleOnly
    ? segments.filter((segment) => segment.visibility === "visible")
    : [...segments].sort(compareByVisibilityPriority);
  return filtered.map((segment, index) => ({ ...segment, readingOrderIndex: index }));
}

function compareByVisibilityPriority(a: TextSegment, b: TextSegment): number {
  return VISIBILITY_ORDER[a.visibility] - VISIBILITY_ORDER[b.visibility];
}
