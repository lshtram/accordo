import type { BrowserCommentThread, ScreenshotRecord } from "./comment-types.js";

export interface ExportPayload {
  url: string;
  exportedAt: string;
  threads: BrowserCommentThread[];
  screenshot?: ScreenshotRecord;
}

/** Result returned from an exporter */
export interface ExportResult {
  success: boolean;
  error?: string;
  /** Human-readable description of what happened */
  summary: string;
}

/** Abstract exporter interface — clipboard is v1, others are additive */
export interface Exporter {
  readonly name: string;
  export(payload: ExportPayload, format?: "markdown" | "json"): Promise<ExportResult>;
}

/** Args for the capture_region relay action (content script side).
 *  Implements CR-F-02 through CR-F-06.
 */
export interface CaptureRegionArgs {
  /** Anchor key identifying the target element (from inspect_element) */
  anchorKey?: string;
  /** Node ref from page map (ref field) */
  nodeRef?: string;
  /** Explicit viewport-relative rectangle (fallback when no element target) */
  rect?: { x: number; y: number; width: number; height: number };
  /** Padding around the element bounding box in px (default: 8, max: 100) */
  padding?: number;
  /** JPEG quality 1–100 (default: 70, clamped to 30–85) */
  quality?: number;
  /** GAP-I1: Redaction patterns to apply to screenshot (bbox-based). */
  redactPatterns?: string[];
}

/** Result from the capture_region relay action.
 *  Implements CR-F-08, CR-F-12.
 */
export interface CaptureRegionResult {
  /** Whether the capture succeeded */
  success: boolean;
  /** Cropped image as JPEG data URL */
  dataUrl?: string;
  /** Actual width of the cropped image in px */
  width?: number;
  /** Actual height of the cropped image in px */
  height?: number;
  /** Size of the data URL string in bytes */
  sizeBytes?: number;
  /** Which input resolved the target */
  source?: "anchorKey" | "nodeRef" | "rect" | "fallback";
  /** Error code when success is false */
  error?:
    | "element-not-found"
    | "element-off-screen"
    | "image-too-large"
    | "capture-failed"
    | "no-target";
  /** GAP-I1: True when screenshot redaction was applied */
  screenshotRedactionApplied?: boolean;
  /** GAP-I1: Number of text regions that were redacted */
  redactedSegmentCount?: number;
}
