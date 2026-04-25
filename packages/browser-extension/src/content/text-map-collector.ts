/**
 * M112-TEXT — Text Map Collector facade
 *
 * @module
 */

import { captureSnapshotEnvelope } from "../snapshot-versioning.js";
import type { SnapshotEnvelope } from "../snapshot-versioning.js";
import { assignReadingOrder, collectRawSegments } from "./text-map-runtime.js";
import {
  DEFAULT_MAX_SEGMENTS,
  MAX_SEGMENTS_LIMIT,
  type TextMapOptions,
  type TextMapResult,
  type TextSegment,
  type TextVisibility,
} from "./text-map-types.js";

export {
  DEFAULT_MAX_SEGMENTS,
  MAX_SEGMENTS_LIMIT,
  TAG_ROLES,
  TEXT_EXCLUDED_TAGS,
  VERTICAL_BAND_TOLERANCE_PX,
} from "./text-map-types.js";
export type { TextMapOptions, TextMapResult, TextSegment, TextVisibility } from "./text-map-types.js";
export {
  assignReadingOrder,
  collectRawSegments,
  getAccessibleName,
  getDirectText,
  getElementRect,
  getRole,
  getVisibility,
} from "./text-map-runtime.js";

export function collectTextMap(options?: TextMapOptions): TextMapResult {
  const envelope: SnapshotEnvelope = captureSnapshotEnvelope("dom");
  const frameId = options?.logicalFrameId ?? envelope.frameId ?? "main";
  const requestedMax = options?.maxSegments ?? DEFAULT_MAX_SEGMENTS;
  const effectiveMax = Math.min(requestedMax, MAX_SEGMENTS_LIMIT);
  const allSegments = collectRawSegments(document, frameId);
  assignReadingOrder(allSegments, document);

  const totalSegments = allSegments.length;
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
