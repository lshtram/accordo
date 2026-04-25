/**
 * GAP-I1 — Screenshot Redaction facade
 *
 * @module
 */

import { paintRedactionRectangles } from "./screenshot-redaction-image.js";
import { collectRedactedBboxes } from "./screenshot-redaction-matching.js";
import type {
  CroppedCapture,
  RedactionPattern,
  ScreenshotRedactionResult,
  TextMapSnapshot,
  TextSegment,
  VersionedSnapshot,
} from "./screenshot-redaction-types.js";

export { REDACTION_PADDING_PX } from "./screenshot-redaction-types.js";
export type {
  CroppedCapture,
  RedactionPattern,
  ScreenshotRedactionResult,
  TextMapSnapshot,
  TextSegment,
  VersionedSnapshot,
} from "./screenshot-redaction-types.js";
export { collectRedactedBboxes } from "./screenshot-redaction-matching.js";
export { decodeImage, paintRedactionRectangles } from "./screenshot-redaction-image.js";
export { extractTextMapFromSnapshot, findLatestTextMapSnapshot } from "./screenshot-redaction-store.js";

export async function applyScreenshotRedaction(
  cropped: CroppedCapture,
  patterns: string[],
  textMapSnapshot: TextMapSnapshot | null,
): Promise<ScreenshotRedactionResult> {
  if (!textMapSnapshot || patterns.length === 0) {
    return {
      redactedDataUrl: cropped.dataUrl,
      width: cropped.width,
      height: cropped.height,
      screenshotRedactionApplied: false,
      redactedSegmentCount: 0,
    };
  }

  const { dataUrl, width, height, originalBounds } = cropped;
  const scaleX = width / originalBounds.width;
  const scaleY = height / originalBounds.height;
  const rawBboxes = collectRedactedBboxes(textMapSnapshot.segments, originalBounds, patterns);

  if (rawBboxes.length === 0) {
    return {
      redactedDataUrl: dataUrl,
      width,
      height,
      screenshotRedactionApplied: false,
      redactedSegmentCount: 0,
    };
  }

  const scaledBboxes = rawBboxes.map((bbox) => ({
    x: (bbox.x - originalBounds.x) * scaleX,
    y: (bbox.y - originalBounds.y) * scaleY,
    width: bbox.width * scaleX,
    height: bbox.height * scaleY,
  }));

  const redactedDataUrl = await paintRedactionRectangles(dataUrl, scaledBboxes);
  return {
    redactedDataUrl,
    width,
    height,
    screenshotRedactionApplied: true,
    redactedSegmentCount: rawBboxes.length,
  };
}
