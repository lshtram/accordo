import type { VersionedSnapshot } from "./snapshot-versioning.js";

export const REDACTION_PADDING_PX = 4;

export interface RedactionPattern {
  pattern: string;
}

export interface TextSegment {
  textRaw: string;
  textNormalized: string;
  bbox: { x: number; y: number; width: number; height: number };
}

export interface TextMapSnapshot {
  segments: TextSegment[];
  pageUrl: string;
}

export interface ScreenshotRedactionResult {
  redactedDataUrl: string;
  width: number;
  height: number;
  screenshotRedactionApplied: boolean;
  redactedSegmentCount: number;
}

export interface CroppedCapture {
  dataUrl: string;
  width: number;
  height: number;
  originalBounds: { x: number; y: number; width: number; height: number };
}

export type { VersionedSnapshot };
