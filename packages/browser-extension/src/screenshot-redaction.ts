/**
 * GAP-I1 — Screenshot Redaction via Bbox Correlation
 *
 * Cross-references the latest text map snapshot with a captured screenshot
 * to paint solid redaction rectangles over PII text regions.
 *
 * Approach (Option B from the 45/45 plan):
 * 1. After capture, query the latest text map for the same page.
 * 2. Apply configured redaction patterns to each segment's text.
 * 3. For segments where redaction was applied AND whose bbox overlaps
 *    with the captured region, paint a solid rectangle over that bbox
 *    in the OffscreenCanvas.
 * 4. Return the redacted image and a `screenshotRedactionApplied: true` flag.
 *
 * Coordinate mapping:
 * - Screenshot is captured at full DPR resolution → cropped to target bounds
 *   → scaled to fit within MAX_CAPTURE_DIMENSION.
 * - Text map bboxes are in CSS/viewport pixel coordinates.
 * - Scale factor = (croppedWidth / originalBounds.width, croppedHeight / originalBounds.height)
 * - Scaled bbox = { x: (bbox.x - originalBounds.x) * scaleX,
 *                   y: (bbox.y - originalBounds.y) * scaleY,
 *                   width: bbox.width * scaleX,
 *                   height: bbox.height * scaleY }
 *
 * @module
 */

import type { VersionedSnapshot } from "./snapshot-versioning.js";

// ── Constants ─────────────────────────────────────────────────────────────────

/** Redaction rectangle padding in CSS pixels (applied before scaling). */
export const REDACTION_PADDING_PX = 4;

// ── Types ────────────────────────────────────────────────────────────────────

export interface RedactionPattern {
  pattern: string;
}

/**
 * Minimal TextSegment shape needed for screenshot redaction.
 * Matches TextSegment from text-map-collector.ts.
 */
interface TextSegment {
  textRaw: string;
  textNormalized: string;
  bbox: { x: number; y: number; width: number; height: number };
}

/**
 * TextMap result shape (matches TextMapResult from text-map-collector.ts).
 */
interface TextMapSnapshot {
  segments: TextSegment[];
  pageUrl: string;
}

/**
 * Result of applying screenshot redaction.
 */
export interface ScreenshotRedactionResult {
  redactedDataUrl: string;
  width: number;
  height: number;
  screenshotRedactionApplied: boolean;
  redactedSegmentCount: number;
}

/**
 * Cropped capture result before redaction.
 */
interface CroppedCapture {
  dataUrl: string;
  width: number;
  height: number;
  originalBounds: { x: number; y: number; width: number; height: number };
}

// ── Redaction Pattern Matching ───────────────────────────────────────────────

/**
 * Check if a text string matches any redaction pattern.
 * Returns true if at least one pattern matches.
 *
 * @param text — Text to check
 * @param patterns — Array of pattern strings (compiled as case-insensitive regex)
 * @returns true if any pattern matches
 */
function textWouldBeRedacted(text: string, patterns: string[]): boolean {
  if (!text || patterns.length === 0) return false;
  for (const pattern of patterns) {
    try {
      const regex = new RegExp(pattern, "gi");
      if (regex.test(text)) return true;
    } catch {
      // Invalid regex — skip
    }
  }
  return false;
}

/**
 * Collect bounding boxes of all text segments that would be redacted.
 * Only includes segments whose bbox overlaps with the captured region.
 *
 * @param segments — Text segments from the text map
 * @param captureBounds — The original bounds of the captured region (CSS pixels)
 * @param patterns — Redaction patterns to apply
 * @returns Array of bboxes (with padding) that should be painted over
 */
function collectRedactedBboxes(
  segments: TextSegment[],
  captureBounds: { x: number; y: number; width: number; height: number },
  patterns: string[],
): Array<{ x: number; y: number; width: number; height: number }> {
  const bboxes: Array<{ x: number; y: number; width: number; height: number }> = [];

  for (const segment of segments) {
    const { textRaw, textNormalized, bbox } = segment;

    // Check if this segment would be redacted
    if (!textWouldBeRedacted(textRaw, patterns) && !textWouldBeRedacted(textNormalized, patterns)) {
      continue;
    }

    // Check if bbox overlaps with captured region
    const overlaps =
      bbox.x < captureBounds.x + captureBounds.width &&
      bbox.x + bbox.width > captureBounds.x &&
      bbox.y < captureBounds.y + captureBounds.height &&
      bbox.y + bbox.height > captureBounds.y;

    if (!overlaps) continue;

    // Apply padding
    bboxes.push({
      x: bbox.x - REDACTION_PADDING_PX,
      y: bbox.y - REDACTION_PADDING_PX,
      width: bbox.width + REDACTION_PADDING_PX * 2,
      height: bbox.height + REDACTION_PADDING_PX * 2,
    });
  }

  return bboxes;
}

// ── Image Processing ─────────────────────────────────────────────────────────

/**
 * Decode a dataUrl to an ImageBitmap.
 */
async function decodeImage(dataUrl: string): Promise<ImageBitmap> {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  return createImageBitmap(blob);
}

/**
 * Paint redaction rectangles over a captured image.
 *
 * @param dataUrl — Original screenshot dataUrl
 * @param originalBounds — The CSS-pixel bounds used for the capture crop
 * @param bboxes — Scaled bbox coordinates to paint over (already in image pixel space)
 * @returns Redacted image as dataUrl
 */
async function paintRedactionRectangles(
  dataUrl: string,
  bboxes: Array<{ x: number; y: number; width: number; height: number }>,
): Promise<string> {
  if (bboxes.length === 0) return dataUrl;

  const bitmap = await decodeImage(dataUrl);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) return dataUrl;

  // Draw the original image
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();

  // Paint black rectangles over each redacted bbox
  ctx.fillStyle = "black";
  for (const bbox of bboxes) {
    // Clamp to canvas bounds
    const x = Math.max(0, Math.round(bbox.x));
    const y = Math.max(0, Math.round(bbox.y));
    const w = Math.min(bitmap.width - x, Math.round(bbox.width));
    const h = Math.min(bitmap.height - y, Math.round(bbox.height));
    if (w > 0 && h > 0) {
      ctx.fillRect(x, y, w, h);
    }
  }

  // Convert back to PNG dataUrl
  const blob = await canvas.convertToBlob({ type: "image/png" });
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result;
      if (typeof result === "string") {
        resolve(result);
      } else {
        reject(new Error("FileReader result is not a string"));
      }
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// ── Main Redaction Function ─────────────────────────────────────────────────

/**
 * Apply screenshot redaction to a cropped capture result.
 *
 * 1. Finds the latest text map snapshot from the store.
 * 2. Identifies text segments that would be redacted by the patterns
 *    AND whose bbox overlaps with the captured region.
 * 3. Scales bboxes from CSS pixel space to image pixel space.
 * 4. Paints black rectangles over those bboxes.
 *
 * @param cropped — The cropped capture result with its original bounds
 * @param patterns — Redaction regex patterns to apply
 * @param textMapSnapshot — The latest text map snapshot for the page (or null)
 * @returns Redacted screenshot result
 */
export async function applyScreenshotRedaction(
  cropped: CroppedCapture,
  patterns: string[],
  textMapSnapshot: TextMapSnapshot | null,
): Promise<ScreenshotRedactionResult> {
  // If no text map or no patterns, return original without redaction
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

  // Scale factor from CSS pixel coordinates to image pixel coordinates.
  // CSS bbox / originalBounds.size = image bbox / capturedImage.size
  // image_bbox_x = (css_bbox_x - originalBounds.x) * (capturedImageWidth / originalBounds.width)
  const scaleX = width / originalBounds.width;
  const scaleY = height / originalBounds.height;

  // Collect bboxes of redacted text that overlap with the captured region
  const rawBboxes = collectRedactedBboxes(
    textMapSnapshot.segments,
    originalBounds,
    patterns,
  );

  if (rawBboxes.length === 0) {
    return {
      redactedDataUrl: dataUrl,
      width,
      height,
      screenshotRedactionApplied: false,
      redactedSegmentCount: 0,
    };
  }

  // Scale bboxes to image pixel space
  const scaledBboxes = rawBboxes.map((bbox) => ({
    x: (bbox.x - originalBounds.x) * scaleX,
    y: (bbox.y - originalBounds.y) * scaleY,
    width: bbox.width * scaleX,
    height: bbox.height * scaleY,
  }));

  // Paint redaction rectangles
  const redactedDataUrl = await paintRedactionRectangles(dataUrl, scaledBboxes);

  return {
    redactedDataUrl,
    width,
    height,
    screenshotRedactionApplied: true,
    redactedSegmentCount: rawBboxes.length,
  };
}

/**
 * Extract the latest TextMapSnapshot from a VersionedSnapshot's nodes.
 * Returns null if the snapshot is not a text map.
 *
 * VersionedSnapshot stores full node data in the `nodes` field.
 * A text map snapshot has source === "dom" and contains text segments
 * in a structured format.
 */
export function extractTextMapFromSnapshot(
  snapshot: VersionedSnapshot,
): TextMapSnapshot | null {
  try {
    // VersionedSnapshot.nodes is NodeIdentity[] but the text map stores
    // text segment data differently. We need the full TextMapResult.
    // The snapshot store keeps the complete response data.
    // Since VersionedSnapshot.nodes is NodeIdentity[] (minimal),
    // we check if the snapshot has a `segments` field (from TextMapResult).
    // The relay stores the full response in the VersionedSnapshot.
    const nodes = (snapshot as unknown as { nodes?: TextSegment[] }).nodes;
    if (!nodes || !Array.isArray(nodes)) return null;

    // This is a text map snapshot if it has segments with bboxes
    const first = nodes[0];
    if (!first || !("bbox" in first) || !("textRaw" in first)) return null;

    return {
      segments: nodes as TextSegment[],
      pageUrl: snapshot.pageId,
    };
  } catch {
    return null;
  }
}

/**
 * Find the latest text map snapshot from the store.
 * Returns null if no text map snapshot exists for this page.
 *
 * @param store — The snapshot store
 * @param pageId — The page to look up
 * @returns The latest text map snapshot, or null
 */
export async function findLatestTextMapSnapshot(
  store: { getLatest(pageId: string): Promise<{ snapshotId: string; pageId: string; capturedAt: string } | undefined> },
  pageId: string,
): Promise<TextMapSnapshot | null> {
  const latest = await store.getLatest(pageId);
  if (!latest) return null;
  return extractTextMapFromSnapshot(latest as unknown as VersionedSnapshot);
}
