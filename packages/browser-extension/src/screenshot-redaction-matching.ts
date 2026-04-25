import { REDACTION_PADDING_PX, type TextSegment } from "./screenshot-redaction-types.js";

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

export function collectRedactedBboxes(
  segments: TextSegment[],
  captureBounds: { x: number; y: number; width: number; height: number },
  patterns: string[],
): Array<{ x: number; y: number; width: number; height: number }> {
  const bboxes: Array<{ x: number; y: number; width: number; height: number }> = [];

  for (const segment of segments) {
    const { textRaw, textNormalized, bbox } = segment;
    if (!textWouldBeRedacted(textRaw, patterns) && !textWouldBeRedacted(textNormalized, patterns)) {
      continue;
    }

    const overlaps =
      bbox.x < captureBounds.x + captureBounds.width &&
      bbox.x + bbox.width > captureBounds.x &&
      bbox.y < captureBounds.y + captureBounds.height &&
      bbox.y + bbox.height > captureBounds.y;

    if (!overlaps) continue;

    bboxes.push({
      x: bbox.x - REDACTION_PADDING_PX,
      y: bbox.y - REDACTION_PADDING_PX,
      width: bbox.width + REDACTION_PADDING_PX * 2,
      height: bbox.height + REDACTION_PADDING_PX * 2,
    });
  }

  return bboxes;
}
